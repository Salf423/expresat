/**
 * src/engine/signEngine.js — Motor de Captura de Cámara + MediaPipe en el Hilo Principal
 *
 * Responsabilidades:
 * - Captura de cámara (`getUserMedia`) e inicialización de MediaPipe en el Hilo Principal (sin Workers).
 * - Expone `start(videoElement)`, `stop()`, `onFrame(cb)`, `onFps(cb)`, `onError(cb)`.
 * - Sin depender de React ni consultar el DOM mediante `getElementById`.
 * - Cleanup 100% idempotente ante el doble montaje de React 19 StrictMode (`runId` incremental y captura de `AbortError` en `video.play()`).
 * - Contadores separados de FPS reales: `cameraFps` (frames leídos de la cámara) e `inferenceFps` (detecciones reales completadas por MediaPipe).
 * - Por defecto ejecuta solo `HandLandmarker` (`@mediapipe/tasks-vision`, WASM en `/wasm`, `delegate: 'CPU'` con fallback a `'GPU'`), y opcionalmente `PoseLandmarker` o la API Legacy (`window.Hands` / `window.Holistic` con versiones fijadas).
 */

import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { CONFIG } from '../config.js';
import { LandmarkEMAFilter } from '../services/landmarkFilter.js';
import {
  DevTelemetryCollector,
  formatReportMarkdown,
  setActiveDevCollector,
  getActiveDevCollector,
} from './devTelemetry.js';

if (typeof window !== 'undefined') {
  window.__TasksVision__ = { FilesetResolver, HandLandmarker, PoseLandmarker };
}

export const ENGINE_ERROR_CODES = Object.freeze({
  CAMERA_UNSUPPORTED: 'CAMERA_UNSUPPORTED',
  CAMERA_DENIED: 'CAMERA_DENIED',
  CAMERA_NOT_FOUND: 'CAMERA_NOT_FOUND',
  CAMERA_IN_USE: 'CAMERA_IN_USE',
  CAMERA_OVERCONSTRAINED: 'CAMERA_OVERCONSTRAINED',
  WASM_LOAD_FAILED: 'WASM_LOAD_FAILED',
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  ENGINE_RUNTIME_ERROR: 'ENGINE_RUNTIME_ERROR',
});

const LEGACY_HANDS_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240';
const LEGACY_HOLISTIC_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629';
const POSE_MODEL_LOCAL = '/models/pose_landmarker_lite.task';
const POSE_MODEL_FALLBACK_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * Carga un script clásico en `document.head` de forma idempotente (usado solo si se selecciona el backend legacy).
 */
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Entorno sin document para cargar script legacy.'));
      return;
    }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        resolve();
      },
      { once: true }
    );
    script.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

/**
 * Protege `window.ModuleFactory` en el hilo principal para que `@mediapipe/tasks-vision`
 * no lo borre (`self.ModuleFactory = void 0`) al instanciar más de un detector o reintentar delegate.
 */
function protectMainThreadModuleFactory() {
  if (typeof window === 'undefined') return;
  const desc = Object.getOwnPropertyDescriptor(window, 'ModuleFactory');
  if (desc && desc.get && desc.set) return;

  let currentFactory = window.ModuleFactory;
  try {
    Object.defineProperty(window, 'ModuleFactory', {
      configurable: true,
      enumerable: true,
      get() {
        return currentFactory;
      },
      set(val) {
        if (typeof val === 'function') {
          currentFactory = val;
        }
      },
    });
  } catch (err) {
    console.warn('[SignEngine] No se pudo proteger window.ModuleFactory:', err.message);
  }
}

/**
 * Desactiva el logger interno ODML de @mediapipe/tasks-vision (POST odml.pa.googleapis.com/v1/log)
 * para evitar salidas a red y errores net::ERR_INTERNET_DISCONNECTED en entorno offline.
 */
function disableMediaPipeOdmlTelemetry(instance) {
  try {
    const odmlClient = instance?.m?.l;
    if (!odmlClient || typeof odmlClient !== 'object') return;
    if (odmlClient.g !== undefined) {
      clearInterval(odmlClient.g);
      odmlClient.g = undefined;
    }
    odmlClient.error = new Error('ODML telemetry disabled offline');
    if (Array.isArray(odmlClient.h)) {
      odmlClient.h.length = 0;
    }
    odmlClient.flush = (onSuccess) => {
      if (typeof onSuccess === 'function') onSuccess();
    };
    odmlClient.close = () => {
      if (odmlClient.g !== undefined) {
        clearInterval(odmlClient.g);
        odmlClient.g = undefined;
      }
    };
  } catch {
    // No crítico si una versión futura cambia estructura interna
  }
}

/**
 * Instancia una tarea de MediaPipe probando primero `delegate: 'CPU'` (óptimo y libre de bloqueos WebGL
 * en Linux/Firefox con iGPU Ryzen 3 7320U) y haciendo fallback a `'GPU'`, y probando ruta local antes de URL remota.
 */
async function createTaskWithFallback(TaskClass, vision, modelPaths, taskOptions, preferredDelegate = 'CPU') {
  const delegates = preferredDelegate === 'GPU' ? ['GPU', 'CPU'] : ['CPU', 'GPU'];
  let lastError = null;

  for (const modelPath of modelPaths) {
    for (const delegate of delegates) {
      try {
        const instance = await TaskClass.createFromOptions(vision, {
          ...taskOptions,
          baseOptions: {
            modelAssetPath: modelPath,
            delegate,
          },
        });
        disableMediaPipeOdmlTelemetry(instance);
        return { instance, delegate, modelPath };
      } catch (err) {
        lastError = err;
        console.warn(
          `[SignEngine] Falló creación con modelo=${modelPath} delegate=${delegate}:`,
          err?.message || err
        );
      }
    }
  }

  throw lastError || new Error('No se pudo inicializar el modelo de MediaPipe.');
}

export class SignEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.targetFps] FPS objetivo de inferencia (default: CONFIG.targetFps, 15-30)
   * @param {number} [options.width] Ancho de captura de cámara (default: 640)
   * @param {number} [options.height] Alto de captura de cámara (default: 480)
   * @param {boolean} [options.enablePose] Activar detección de pose (default: CONFIG.enablePose = false)
   * @param {number} [options.modelComplexity] Complejidad 0 o 1 (default: CONFIG.modelComplexity = 0)
   * @param {'tasks'|'legacy'} [options.backend] Backend MediaPipe (default: CONFIG.mediapipeBackend = 'tasks')
   * @param {'CPU'|'GPU'} [options.delegate] Delegate preferido (default: 'CPU')
   * @param {boolean} [options.smoothLandmarks] Suavizado EMA (default: true)
   */
  constructor(options = {}) {
    this.targetFps = options.targetFps ?? CONFIG.targetFps ?? 20;
    this.frameIntervalMs = 1000 / Math.max(5, Math.min(60, this.targetFps));
    this.width = options.width ?? 640;
    this.height = options.height ?? 480;
    this.enablePose = options.enablePose ?? CONFIG.enablePose ?? false;
    this.modelComplexity = options.modelComplexity ?? CONFIG.modelComplexity ?? 0;
    this.backend = options.backend ?? CONFIG.mediapipeBackend ?? 'tasks';
    let queryDelegate = null;
    if (typeof window !== 'undefined' && window.location?.search) {
      try {
        const q = new URLSearchParams(window.location.search).get('delegate');
        if (q && (q.toUpperCase() === 'GPU' || q.toUpperCase() === 'CPU')) {
          queryDelegate = q.toUpperCase();
        }
      } catch {
        // Ignorar errores de URL en entornos no-browser
      }
    }
    this.preferredDelegate = options.delegate ?? queryDelegate ?? 'GPU';
    this.poseCadence = Math.max(1, Math.min(5, options.poseCadence ?? 1));
    this.smoothLandmarks = options.smoothLandmarks ?? true;

    let queryCamExp = null;
    if (import.meta.env.DEV && typeof window !== 'undefined' && window.location?.search) {
      try {
        const exp = new URLSearchParams(window.location.search).get('camExp');
        if (exp === 'exact15' || exp === 'default') {
          queryCamExp = exp;
        }
      } catch {
        // Ignorar errores de URL en entornos no-browser
      }
    }
    this.cameraExperiment =
      (import.meta.env.DEV ? (options.cameraExperiment ?? queryCamExp) : null) || 'default';

    this._frameStepIndex = 0;
    this._lastDetectedPose = null;

    this._frameListeners = new Set();
    this._fpsListeners = new Set();
    this._errorListeners = new Set();
    this._statusListeners = new Set();
    this._devSnapshotListeners = new Set();

    this._runId = 0;
    this._running = false;
    this._wasmReady = false;
    this._activeBackendInfo = null;

    this._videoElement = null;
    this._mediaStream = null;
    this._handLandmarker = null;
    this._poseLandmarker = null;
    this._legacyDetector = null;

    this._rafId = null;
    this._rvfcId = null;
    this._loadedMetadataHandler = null;
    this._fpsTimerId = null;
    this._busy = false;
    this._lastInferenceStartMs = 0;
    this._lastVideoTime = -1;
    this._lastMonotonicTimestampMs = 0;

    this._cameraFrameCount = 0;
    this._inferenceFrameCount = 0;
    this._currentFps = { cameraFps: 0, inferenceFps: 0 };

    this._emaFilter = new LandmarkEMAFilter(0.5);

    this._devTelemetry =
      options.devTelemetry ??
      (import.meta.env.DEV ? new DevTelemetryCollector({ enabled: true }) : null);
    if (this._devTelemetry) {
      this._devTelemetry.setRuntimeConfig({
        targetFps: this.targetFps,
        frameIntervalMs: Number(this.frameIntervalMs.toFixed(2)),
        width: this.width,
        height: this.height,
        enablePose: this.enablePose,
        poseCadence: this.poseCadence,
        modelComplexity: this.modelComplexity,
        backend: this.backend,
        preferredDelegate: this.preferredDelegate,
        smoothLandmarks: this.smoothLandmarks,
        cameraExperiment: this.cameraExperiment,
        crossOriginIsolated:
          typeof window !== 'undefined' ? Boolean(window.crossOriginIsolated) : false,
        hardwareConcurrency:
          typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
    }
  }

  /**
   * Suscribe un listener para cada detección procesada (`onFrame(frameData)`).
   * @param {Function} callback
   * @returns {Function} Función para desuscribir
   */
  onFrame(callback) {
    if (typeof callback === 'function') {
      this._frameListeners.add(callback);
    }
    return () => this._frameListeners.delete(callback);
  }

  /**
   * Suscribe un listener para las métricas reales de FPS (`onFps({ cameraFps, inferenceFps })`).
   * @param {Function} callback
   * @returns {Function} Función para desuscribir
   */
  onFps(callback) {
    if (typeof callback === 'function') {
      this._fpsListeners.add(callback);
    }
    return () => this._fpsListeners.delete(callback);
  }

  /**
   * Suscribe un listener para errores visibles de cámara o WASM (`onError({ code, message, cause })`).
   * @param {Function} callback
   * @returns {Function} Función para desuscribir
   */
  onError(callback) {
    if (typeof callback === 'function') {
      this._errorListeners.add(callback);
    }
    return () => this._errorListeners.delete(callback);
  }

  /**
   * Suscribe un listener para cambios de estado del motor (`onStatus(statusObj)`).
   * @param {Function} callback
   * @returns {Function} Función para desuscribir
   */
  onStatus(callback) {
    if (typeof callback === 'function') {
      this._statusListeners.add(callback);
    }
    return () => this._statusListeners.delete(callback);
  }

  onDevSnapshot(callback) {
    if (typeof callback === 'function') {
      this._devSnapshotListeners.add(callback);
    }
    return () => this._devSnapshotListeners.delete(callback);
  }

  getDevSnapshot() {
    return this._devTelemetry ? this._devTelemetry.getSnapshot() : null;
  }

  getDevReport() {
    return this._devTelemetry ? this._devTelemetry.buildComparisonReport() : null;
  }

  setDevPhase(phase) {
    if (!this._devTelemetry) return;
    const prevPhase = this._devTelemetry.phase;
    this._devTelemetry.setPhase(phase);
    // Refrescar UI del panel dev automáticamente al terminar una grabación ('grabando' -> 'reposo')
    if (prevPhase === 'grabando' && this._devTelemetry.phase === 'reposo') {
      const snap = this._devTelemetry.getSnapshot();
      for (const listener of this._devSnapshotListeners) {
        try {
          listener(snap);
        } catch (err) {
          console.warn('[SignEngine] Error en listener onDevSnapshot:', err);
        }
      }
    }
  }

  resetDevTelemetry() {
    this._devTelemetry?.reset();
    if (this._devTelemetry) {
      const snap = this._devTelemetry.getSnapshot();
      for (const listener of this._devSnapshotListeners) {
        try {
          listener(snap);
        } catch (err) {
          console.warn('[SignEngine] Error en listener onDevSnapshot:', err);
        }
      }
    }
  }

  /**
   * Inicia la cámara y el motor MediaPipe en el hilo principal.
   * Es idempotente y resistente al doble montaje de React StrictMode.
   *
   * @param {HTMLVideoElement} videoElement
   */
  async start(videoElement) {
    // Incrementar runId invalida cualquier start() anterior en vuelo
    const currentRunId = ++this._runId;
    this._cleanupResourcesOnly();

    if (!videoElement) {
      this._emitError(
        ENGINE_ERROR_CODES.ENGINE_RUNTIME_ERROR,
        'No se proporcionó un elemento <video> válido al iniciar el motor.'
      );
      return false;
    }

    this._videoElement = videoElement;
    this._running = true;
    this._emitStatus({ state: 'starting', wasmReady: false, cameraReady: false });

    if (import.meta.env.DEV && this._devTelemetry) {
      setActiveDevCollector(this._devTelemetry);
      if (typeof window !== 'undefined') {
        window.__EXPRESAT_DEV_TELEMETRY__ = {
          getSnapshot: () => this.getDevSnapshot(),
          getReport: () => this.getDevReport(),
          formatMarkdown: () => formatReportMarkdown(this.getDevReport()),
          reset: () => this.resetDevTelemetry(),
        };
      }
    }

    // 1. Iniciar cámara y cargar WASM/MediaPipe
    let stream = null;
    try {
      stream = await this._acquireCameraStream();
    } catch (camErr) {
      if (currentRunId !== this._runId) return false;
      this._running = false;
      this._handleCameraError(camErr);
      return false;
    }

    // Si stop() o un nuevo start() ocurrió mientras getUserMedia esperaba permiso:
    if (currentRunId !== this._runId || !this._running) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }

    this._mediaStream = stream;
    videoElement.srcObject = stream;
    videoElement.playsInline = true;
    videoElement.muted = true;

    try {
      await videoElement.play();
    } catch (playErr) {
      // En React 19 StrictMode, play() puede lanzar AbortError si el componente se desmonta rápido
      if (currentRunId !== this._runId || !this._running || playErr?.name === 'AbortError') {
        if (currentRunId === this._runId) {
          this._cleanupResourcesOnly();
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
        return false;
      }
      this._cleanupResourcesOnly();
      this._emitError(
        ENGINE_ERROR_CODES.CAMERA_IN_USE,
        `No se pudo reproducir el flujo de cámara: ${playErr.message}`,
        playErr
      );
      return false;
    }

    if (currentRunId !== this._runId || !this._running) {
      this._cleanupResourcesOnly();
      return false;
    }

    if (this._devTelemetry) {
      const syncVideoDims = () => {
        if (!this._devTelemetry || this._videoElement !== videoElement) return;
        this._devTelemetry.setCameraNegotiation({
          videoWidth: videoElement.videoWidth || 0,
          videoHeight: videoElement.videoHeight || 0,
        });
      };
      syncVideoDims();
      if (!videoElement.videoWidth && typeof videoElement.addEventListener === 'function') {
        this._loadedMetadataHandler = syncVideoDims;
        videoElement.addEventListener('loadedmetadata', syncVideoDims, { once: true });
      }
    }

    this._emitStatus({ state: 'loading_wasm', wasmReady: false, cameraReady: true });

    // 2. Inicializar MediaPipe en el hilo principal
    try {
      await this._initializeMediaPipe(currentRunId);
    } catch (mpErr) {
      if (currentRunId !== this._runId) return false;
      this._cleanupResourcesOnly();
      this._emitError(
        mpErr.code || ENGINE_ERROR_CODES.WASM_LOAD_FAILED,
        mpErr.userMessage || `No se pudo inicializar el motor de visión MediaPipe: ${mpErr.message}`,
        mpErr
      );
      return false;
    }

    if (currentRunId !== this._runId || !this._running) {
      this._cleanupResourcesOnly();
      return false;
    }

    this._wasmReady = true;
    if (this._devTelemetry) {
      this._devTelemetry.setRuntimeConfig({
        targetFps: this.targetFps,
        frameIntervalMs: Number(this.frameIntervalMs.toFixed(2)),
        width: this.width,
        height: this.height,
        enablePose: this.enablePose,
        poseEnabledActual: Boolean(this._poseLandmarker),
        poseCadence: this.poseCadence,
        modelComplexity: this.modelComplexity,
        backend: this._activeBackendInfo?.type || this.backend,
        delegate: this._activeBackendInfo?.delegate || this.preferredDelegate,
        smoothLandmarks: this.smoothLandmarks,
        cameraExperiment: this.cameraExperiment,
        crossOriginIsolated:
          typeof window !== 'undefined' ? Boolean(window.crossOriginIsolated) : false,
        hardwareConcurrency:
          typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
    }
    this._emitStatus({
      state: 'running',
      wasmReady: true,
      cameraReady: true,
      backendInfo: this._activeBackendInfo,
    });

    // Notificar a partículas de fondo para ahorrar CPU
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('camera-active', { detail: true }));
    }

    // 3. Arrancar observador pasivo de cámara (solo dev), ticker FPS (1000 ms) y bucle de captura
    this._startPassiveCameraObserver(currentRunId);
    this._startFpsTicker();
    this._scheduleNextTick(currentRunId);
    return true;
  }

  /**
   * Detiene de forma idempotente la cámara, el bucle de inferencia y libera MediaPipe.
   */
  stop() {
    this._runId++;
    this._cleanupResourcesOnly();
    this._emitStatus({ state: 'stopped', wasmReady: false, cameraReady: false });
  }

  _cleanupResourcesOnly() {
    this._running = false;
    this._wasmReady = false;
    this._busy = false;

    if (this._rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (
      this._rvfcId !== null &&
      this._videoElement &&
      typeof this._videoElement.cancelVideoFrameCallback === 'function'
    ) {
      try {
        this._videoElement.cancelVideoFrameCallback(this._rvfcId);
      } catch {
        // Ignorar errores de cancelVideoFrameCallback en teardown
      }
    }
    this._rvfcId = null;

    if (this._loadedMetadataHandler && this._videoElement?.removeEventListener) {
      try {
        this._videoElement.removeEventListener('loadedmetadata', this._loadedMetadataHandler);
      } catch {
        // ignore
      }
    }
    this._loadedMetadataHandler = null;

    if (this._fpsTimerId !== null) {
      clearInterval(this._fpsTimerId);
      this._fpsTimerId = null;
    }

    if (this._mediaStream) {
      try {
        this._mediaStream.getTracks().forEach((track) => track.stop());
      } catch (err) {
        console.warn('[SignEngine] Error deteniendo tracks de cámara:', err.message);
      }
      this._mediaStream = null;
    }

    if (this._videoElement) {
      try {
        this._videoElement.pause();
        this._videoElement.srcObject = null;
      } catch (err) {
        console.warn('[SignEngine] Error limpiando videoElement:', err.message);
      }
      this._videoElement = null;
    }

    if (this._handLandmarker) {
      try {
        this._handLandmarker.close();
      } catch (err) {
        console.warn('[SignEngine] Error cerrando HandLandmarker:', err.message);
      }
      this._handLandmarker = null;
    }

    if (this._poseLandmarker) {
      try {
        this._poseLandmarker.close();
      } catch (err) {
        console.warn('[SignEngine] Error cerrando PoseLandmarker:', err.message);
      }
      this._poseLandmarker = null;
    }

    if (this._legacyDetector) {
      try {
        if (typeof this._legacyDetector.close === 'function') {
          this._legacyDetector.close();
        }
      } catch (err) {
        console.warn('[SignEngine] Error cerrando detector legacy:', err.message);
      }
      this._legacyDetector = null;
    }

    this._emaFilter.reset();
    this._frameStepIndex = 0;
    this._lastDetectedPose = null;
    this._cameraFrameCount = 0;
    this._inferenceFrameCount = 0;
    this._lastVideoTime = -1;
    this._currentFps = { cameraFps: 0, inferenceFps: 0 };

    if (this._devTelemetry && getActiveDevCollector() === this._devTelemetry) {
      setActiveDevCollector(null);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('camera-active', { detail: false }));
    }
  }

  _recordTrackNegotiation(stream) {
    if (!this._devTelemetry || !stream) return;
    const track = stream.getVideoTracks?.()?.[0] || stream.getTracks?.()?.[0] || null;
    let settings = null;
    let capabilities = null;
    let constraintsApplied = null;
    try {
      settings = typeof track?.getSettings === 'function' ? { ...track.getSettings() } : null;
    } catch {
      settings = null;
    }
    try {
      capabilities =
        typeof track?.getCapabilities === 'function'
          ? { ...track.getCapabilities() }
          : { unsupported: true };
    } catch {
      capabilities = { unsupported: true };
    }
    try {
      constraintsApplied =
        typeof track?.getConstraints === 'function' ? { ...track.getConstraints() } : null;
    } catch {
      constraintsApplied = null;
    }
    this._devTelemetry.setCameraNegotiation({
      trackLabel: track?.label || null,
      trackReadyState: track?.readyState || null,
      settings,
      capabilities,
      constraintsApplied,
    });
  }

  async _acquireCameraStream() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      const err = new Error('getUserMedia no está disponible en este navegador o contexto inseguro.');
      err.code = ENGINE_ERROR_CODES.CAMERA_UNSUPPORTED;
      throw err;
    }

    if (import.meta.env.DEV && this.cameraExperiment === 'exact15') {
      const exactConstraints = {
        video: {
          width: { exact: this.width },
          height: { exact: this.height },
          frameRate: { min: 15 },
          facingMode: 'user',
        },
        audio: false,
      };
      this._devTelemetry?.setCameraNegotiation({
        experimentMode: 'exact15',
        requestedConstraints: exactConstraints,
        usedFallback: false,
        fallbackReason: null,
        error: null,
      });
      try {
        const stream = await navigator.mediaDevices.getUserMedia(exactConstraints);
        this._recordTrackNegotiation(stream);
        return stream;
      } catch (expErr) {
        this._devTelemetry?.setCameraNegotiation({
          error: {
            name: expErr?.name || 'Error',
            constraint: expErr?.constraint || null,
            message: expErr?.message || String(expErr),
          },
        });
        throw expErr;
      }
    }

    const primaryConstraints = {
      video: {
        width: { ideal: this.width },
        height: { ideal: this.height },
        frameRate: { ideal: Math.min(30, Math.max(15, this.targetFps)) },
        facingMode: 'user',
      },
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(primaryConstraints);
      this._devTelemetry?.setCameraNegotiation({
        experimentMode: 'default',
        requestedConstraints: primaryConstraints,
        usedFallback: false,
        fallbackReason: null,
        error: null,
      });
      this._recordTrackNegotiation(stream);
      return stream;
    } catch (primaryErr) {
      // Si las restricciones ideales fallan en cámaras virtuales (ej. Playwright fake device),
      // reintentar con `{ video: true, audio: false }` salvo que haya sido permiso denegado.
      if (
        primaryErr?.name === 'NotAllowedError' ||
        primaryErr?.name === 'PermissionDeniedError'
      ) {
        throw primaryErr;
      }
      const fallbackConstraints = { video: true, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      this._devTelemetry?.setCameraNegotiation({
        experimentMode: 'default',
        requestedConstraints: primaryConstraints,
        usedFallback: true,
        fallbackReason: `${primaryErr?.name || 'Error'}: ${primaryErr?.message || primaryErr}`,
        fallbackConstraints,
        error: null,
      });
      this._recordTrackNegotiation(stream);
      return stream;
    }
  }

  _handleCameraError(err) {
    const name = err?.name || '';
    if (err?.code === ENGINE_ERROR_CODES.CAMERA_UNSUPPORTED) {
      this._emitError(
        ENGINE_ERROR_CODES.CAMERA_UNSUPPORTED,
        'Tu navegador no soporta acceso a la cámara web o la página no se cargó por HTTPS/localhost.',
        err
      );
      return;
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      this._emitError(
        ENGINE_ERROR_CODES.CAMERA_DENIED,
        'Permiso de cámara denegado. Por favor autoriza el acceso a la cámara en la barra de direcciones del navegador.',
        err
      );
      return;
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      this._emitError(
        ENGINE_ERROR_CODES.CAMERA_NOT_FOUND,
        'No se detectó ninguna cámara conectada en este dispositivo.',
        err
      );
      return;
    }
    if (name === 'OverconstrainedError') {
      this._emitError(
        ENGINE_ERROR_CODES.CAMERA_OVERCONSTRAINED,
        `La cámara no cumplió las restricciones exactas (${err?.constraint || 'desconocida'}): ${err?.message || 'OverconstrainedError'}`,
        err
      );
      return;
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      this._emitError(
        ENGINE_ERROR_CODES.CAMERA_IN_USE,
        'La cámara está siendo utilizada por otra aplicación o pestaña.',
        err
      );
      return;
    }
    this._emitError(
      ENGINE_ERROR_CODES.CAMERA_IN_USE,
      `Error al acceder a la cámara: ${err?.message || 'Error desconocido'}`,
      err
    );
  }

  async _initializeMediaPipe(currentRunId) {
    protectMainThreadModuleFactory();

    if (this.backend === 'legacy') {
      await this._initLegacyBackend(currentRunId);
      return;
    }

    try {
      await this._initTasksVisionBackend(currentRunId);
    } catch (tasksErr) {
      console.warn(
        '[SignEngine] Falló inicialización de @mediapipe/tasks-vision, intentando fallback legacy:',
        tasksErr?.message || tasksErr
      );
      try {
        await this._initLegacyBackend(currentRunId);
      } catch {
        // Reportar el error original de WASM/Modelo con mensaje específico
        throw tasksErr;
      }
    }
  }

  async _initTasksVisionBackend(currentRunId) {
    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(CONFIG.wasmPath || '/wasm');
    } catch (wasmErr) {
      const err = new Error(`Fallo al cargar runtime WASM desde ${CONFIG.wasmPath}: ${wasmErr.message}`);
      err.code = ENGINE_ERROR_CODES.WASM_LOAD_FAILED;
      err.userMessage = `No se pudo cargar el motor WebAssembly de MediaPipe (${CONFIG.wasmPath}). Verifica que los archivos WASM existan en /public/wasm.`;
      throw err;
    }

    if (currentRunId !== this._runId) return;
    protectMainThreadModuleFactory();

    const handModelCandidates = [CONFIG.handModelPath, CONFIG.handModelFallbackUrl].filter(Boolean);
    let handSetup;
    try {
      handSetup = await createTaskWithFallback(
        HandLandmarker,
        vision,
        handModelCandidates,
        {
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        },
        this.preferredDelegate
      );
      this._handLandmarker = handSetup.instance;
    } catch (modelErr) {
      const err = new Error(`Fallo al cargar modelo HandLandmarker: ${modelErr.message}`);
      err.code = ENGINE_ERROR_CODES.MODEL_LOAD_FAILED;
      err.userMessage =
        'El motor WASM cargó, pero no se pudo inicializar el modelo de detección de manos (hand_landmarker.task).';
      throw err;
    }

    if (this.enablePose && currentRunId === this._runId) {
      try {
        const poseSetup = await createTaskWithFallback(
          PoseLandmarker,
          vision,
          [POSE_MODEL_LOCAL, POSE_MODEL_FALLBACK_URL],
          {
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          },
          this.preferredDelegate
        );
        this._poseLandmarker = poseSetup.instance;
      } catch (poseErr) {
        console.warn('[SignEngine] PoseLandmarker opcional no pudo cargarse, continuando solo con manos:', poseErr);
      }
    }

    this._activeBackendInfo = {
      type: 'tasks-vision',
      delegate: handSetup.delegate,
      modelPath: handSetup.modelPath,
      poseEnabled: Boolean(this._poseLandmarker),
    };
  }

  async _initLegacyBackend(currentRunId) {
    if (this.enablePose) {
      await loadScriptOnce(`${LEGACY_HOLISTIC_CDN}/holistic.js`);
      if (currentRunId !== this._runId) return;
      if (typeof window.Holistic !== 'function') {
        throw new Error('window.Holistic no disponible tras cargar script legacy.');
      }
      const holistic = new window.Holistic({
        locateFile: (file) => `${LEGACY_HOLISTIC_CDN}/${file}`,
      });
      holistic.setOptions({
        modelComplexity: this.modelComplexity,
        smoothLandmarks: true,
        enableSegmentation: false,
        refineFaceLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      holistic.onResults((res) => this._onLegacyHolisticResults(res));
      this._legacyDetector = holistic;
      this._activeBackendInfo = {
        type: 'legacy-holistic',
        version: '0.5.1675471629',
        poseEnabled: true,
      };
    } else {
      await loadScriptOnce(`${LEGACY_HANDS_CDN}/hands.js`);
      if (currentRunId !== this._runId) return;
      if (typeof window.Hands !== 'function') {
        throw new Error('window.Hands no disponible tras cargar script legacy.');
      }
      const hands = new window.Hands({
        locateFile: (file) => `${LEGACY_HANDS_CDN}/${file}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: this.modelComplexity,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      hands.onResults((res) => this._onLegacyHandsResults(res));
      this._legacyDetector = hands;
      this._activeBackendInfo = {
        type: 'legacy-hands',
        version: '0.4.1675469240',
        poseEnabled: false,
      };
    }
  }

  _startPassiveCameraObserver(currentRunId) {
    if (!this._devTelemetry || !this._videoElement) return;
    const video = this._videoElement;
    if (typeof video.requestVideoFrameCallback !== 'function') {
      this._devTelemetry.setRvfcSupported(false);
      return;
    }
    this._devTelemetry.setRvfcSupported(true);

    const onVideoFrame = (nowMs, metadata) => {
      if (!this._running || currentRunId !== this._runId || this._videoElement !== video) {
        return;
      }
      this._devTelemetry.recordRealCameraFrame(nowMs, metadata);
      try {
        this._rvfcId = video.requestVideoFrameCallback(onVideoFrame);
      } catch {
        this._rvfcId = null;
      }
    };

    try {
      this._rvfcId = video.requestVideoFrameCallback(onVideoFrame);
    } catch {
      this._devTelemetry.setRvfcSupported(false);
    }
  }

  _startFpsTicker() {
    if (this._fpsTimerId !== null) {
      clearInterval(this._fpsTimerId);
    }
    this._cameraFrameCount = 0;
    this._inferenceFrameCount = 0;

    this._fpsTimerId = setInterval(() => {
      if (!this._running) return;
      this._currentFps = {
        cameraFps: this._cameraFrameCount,
        inferenceFps: this._inferenceFrameCount,
      };
      this._cameraFrameCount = 0;
      this._inferenceFrameCount = 0;

      for (const listener of this._fpsListeners) {
        try {
          listener(this._currentFps);
        } catch (err) {
          console.warn('[SignEngine] Error en listener onFps:', err);
        }
      }

      if (this._devTelemetry) {
        let playbackQuality = null;
        try {
          playbackQuality =
            typeof this._videoElement?.getVideoPlaybackQuality === 'function'
              ? this._videoElement.getVideoPlaybackQuality()
              : null;
        } catch {
          playbackQuality = null;
        }
        const devSnap = this._devTelemetry.flushSecondMetrics(playbackQuality);
        // No notificar re-renders 1 Hz a React mientras está grabando
        if (devSnap && this._devTelemetry.phase !== 'grabando') {
          for (const listener of this._devSnapshotListeners) {
            try {
              listener(devSnap);
            } catch (err) {
              console.warn('[SignEngine] Error en listener onDevSnapshot:', err);
            }
          }
        }
      }
    }, 1000);
  }

  _scheduleNextTick(currentRunId) {
    if (!this._running || currentRunId !== this._runId) return;
    if (typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame((now) => this._tick(now, currentRunId));
    }
  }

  async _tick(nowMs, currentRunId) {
    if (!this._running || currentRunId !== this._runId) return;

    const video = this._videoElement;
    if (
      video &&
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      (typeof document === 'undefined' || !document.hidden)
    ) {
      // Contar frame nuevo entregado por la cámara cuando avanza currentTime
      const videoTimeAdvanced = video.currentTime !== this._lastVideoTime;
      if (videoTimeAdvanced) {
        this._lastVideoTime = video.currentTime;
        this._cameraFrameCount++;
      }
      this._devTelemetry?.recordRafTick(nowMs, videoTimeAdvanced);

      // Respetar el intervalo objetivo de inferencia (15 a 30 FPS) y evitar solapamiento
      if (!this._busy && nowMs - this._lastInferenceStartMs >= this.frameIntervalMs) {
        this._busy = true;
        this._lastInferenceStartMs = nowMs;
        try {
          await this._runInferenceStep(video, nowMs);
        } catch (inferErr) {
          console.warn('[SignEngine] Error procesando frame:', inferErr?.message || inferErr);
        } finally {
          this._busy = false;
        }
      }
    }

    this._scheduleNextTick(currentRunId);
  }

  async _runInferenceStep(video, nowMs) {
    const startPerf = performance.now();
    this._devTelemetry?.beginInferenceStep(video?.currentTime ?? -1, startPerf);
    let stepCompleted = false;

    try {
      // Asegurar timestamp estrictamente creciente para MediaPipe Tasks runningMode: 'VIDEO'
      const timestampMs = Math.max(Math.floor(nowMs), this._lastMonotonicTimestampMs + 1);
      this._lastMonotonicTimestampMs = timestampMs;

      // Soporte de inyección para pruebas automatizadas (Playwright con cámara sintética)
      // Una vez que el motor WASM real ya cargó y corrió `detectForVideo`, si MediaPipe no ve
      // una mano humana en el patrón de barras de color de Chromium (`--use-fake-device-for-media-stream`),
      // permite que el arnés E2E inyecte landmarks sintéticos verificando todo el pipeline real.
      let rawHands = [];
      let rawHandedness = [];
      let rawPose = null;

      // [CONTRATO DE ENTRADA Y TRANSFORMACIÓN DE DETECTOR - Punto 5]
      // 1. Elemento de entrada: detectForVideo() recibe DIRECTAMENTE el elemento HTMLVideoElement (`video`).
      // 2. Sin transformaciones: El video se entrega en su orientación nativa de sensor (NO espejado).
      // 3. Convención de lateralidad: En cámara frontal (selfie), la mano derecha física del usuario
      //    aparece en el lado izquierdo del encuadre nativo, por lo que MediaPipe le asigna categoryName: 'Left'.
      // 4. Modo espejo: El flip horizontal se aplica EXCLUSIVAMENTE en el canvas de renderizado
      //    (renderCanvasFrame vía `ctx.scale(-1, 1)`) para confort visual del usuario.
      if (this._handLandmarker) {
        if (import.meta.env.DEV) this._devTelemetry?.mark('expresat:hand:start');
        const handRes = this._handLandmarker.detectForVideo(video, timestampMs, {
          imageProcessingOptions: { rotationDegrees: 0 },
        });
        if (import.meta.env.DEV && this._devTelemetry) {
          const handMs = this._devTelemetry.endAndMeasure(
            'expresat:stage:hand',
            'expresat:hand:start',
            'expresat:hand:end'
          );
          if (handMs !== null && handMs !== undefined) {
            this._devTelemetry.recordStageDuration('hand', handMs);
          }
        }
        rawHands = handRes?.landmarks || [];
        rawHandedness = handRes?.handedness || [];

        this._frameStepIndex++;
        if (this._poseLandmarker) {
          if ((this._frameStepIndex - 1) % this.poseCadence === 0) {
            if (import.meta.env.DEV) this._devTelemetry?.mark('expresat:pose:start');
            const poseRes = this._poseLandmarker.detectForVideo(video, timestampMs);
            if (import.meta.env.DEV && this._devTelemetry) {
              const poseMs = this._devTelemetry.endAndMeasure(
                'expresat:stage:pose',
                'expresat:pose:start',
                'expresat:pose:end'
              );
              if (poseMs !== null && poseMs !== undefined) {
                this._devTelemetry.recordStageDuration('pose', poseMs);
              }
            }
            this._lastDetectedPose = poseRes?.landmarks?.[0] || null;
          }
          rawPose = this._lastDetectedPose;
        }
      } else if (this._legacyDetector) {
        await this._legacyDetector.send({ image: video });
        return;
      }

      if (
        rawHands.length === 0 &&
        typeof window !== 'undefined' &&
        window.__EXPRESAT_SYNTHETIC_FRAME__
      ) {
        const injected =
          typeof window.__EXPRESAT_SYNTHETIC_FRAME__ === 'function'
            ? window.__EXPRESAT_SYNTHETIC_FRAME__(timestampMs)
            : window.__EXPRESAT_SYNTHETIC_FRAME__;
        if (injected && Array.isArray(injected.hands)) {
          rawHands = injected.hands;
          rawHandedness = injected.handedness || [[{ categoryName: 'Left', score: 0.99 }]];
          rawPose = injected.pose || rawPose;
        }
      }

      this._inferenceFrameCount++;
      stepCompleted = true;
      const latencyMs = Number((performance.now() - startPerf).toFixed(2));
      this._dispatchNormalizedResults({
        pose: rawPose,
        hands: rawHands,
        handedness: rawHandedness,
        timestamp: timestampMs,
        latencyMs,
      });
    } finally {
      this._devTelemetry?.endInferenceStep(performance.now(), stepCompleted);
    }
  }

  _onLegacyHandsResults(results) {
    this._inferenceFrameCount++;
    const hands = results?.multiHandLandmarks || [];
    const handedness = (results?.multiHandedness || []).map((h) => [
      { categoryName: h.label || 'Right', score: h.score ?? 0.9 },
    ]);
    this._dispatchNormalizedResults({
      pose: null,
      hands,
      handedness,
      timestamp: performance.now(),
      latencyMs: 0,
    });
  }

  _onLegacyHolisticResults(results) {
    this._inferenceFrameCount++;
    const hands = [];
    const handedness = [];
    if (results?.leftHandLandmarks) {
      hands.push(results.leftHandLandmarks);
      handedness.push([{ categoryName: 'Right', score: 0.95 }]);
    }
    if (results?.rightHandLandmarks) {
      hands.push(results.rightHandLandmarks);
      handedness.push([{ categoryName: 'Left', score: 0.95 }]);
    }
    this._dispatchNormalizedResults({
      pose: results?.poseLandmarks || null,
      hands,
      handedness,
      timestamp: performance.now(),
      latencyMs: 0,
    });
  }

  _dispatchNormalizedResults({ pose, hands, handedness, timestamp, latencyMs }) {
    const filtered = this.smoothLandmarks
      ? this._emaFilter.smoothResults({ pose, hands, handedness })
      : { pose, hands, handedness };

    // En cámara frontal (selfie), MediaPipe etiqueta la mano derecha del usuario como 'Left'
    // porque aparece a la izquierda de la imagen no espejada.
    let leftHand = null;
    let rightHand = null;

    if (Array.isArray(filtered.hands)) {
      for (let i = 0; i < filtered.hands.length; i++) {
        const lm = filtered.hands[i];
        const category = filtered.handedness?.[i]?.[0]?.categoryName;
        if (category === 'Left' && !rightHand) {
          rightHand = lm;
        } else if (category === 'Right' && !leftHand) {
          leftHand = lm;
        } else if (!rightHand) {
          rightHand = lm;
        } else if (!leftHand) {
          leftHand = lm;
        }
      }
    }

    const cleanCoords = (arr, includeVisibility = false) => {
      if (!Array.isArray(arr)) return null;
      return arr.map((pt) => {
        const base = { x: pt.x, y: pt.y, z: pt.z ?? 0 };
        if (includeVisibility) {
          base.visibility = pt.visibility ?? 1.0;
        }
        return base;
      });
    };

    const framePayload = {
      hands: filtered.hands || [],
      handedness: filtered.handedness || [],
      leftHand: cleanCoords(leftHand, false),
      rightHand: cleanCoords(rightHand, false),
      pose: cleanCoords(filtered.pose, true),
      raw: {
        hands: Array.isArray(hands) ? hands.map((h) => cleanCoords(h, false)) : [],
        handedness: handedness || [],
        pose: cleanCoords(pose, true),
      },
      timestamp,
      latencyMs,
      delegate: this._activeBackendInfo?.delegate || this.preferredDelegate,
    };

    for (const listener of this._frameListeners) {
      try {
        listener(framePayload);
      } catch (err) {
        console.warn('[SignEngine] Error en listener onFrame:', err);
      }
    }
  }

  _emitError(code, message, cause = null) {
    const errorObj = {
      code,
      message,
      cause: cause ? String(cause?.message || cause) : null,
      timestamp: Date.now(),
    };
    for (const listener of this._errorListeners) {
      try {
        listener(errorObj);
      } catch (err) {
        console.warn('[SignEngine] Error en listener onError:', err);
      }
    }
  }

  _emitStatus(statusObj) {
    for (const listener of this._statusListeners) {
      try {
        listener(statusObj);
      } catch (err) {
        console.warn('[SignEngine] Error en listener onStatus:', err);
      }
    }
  }
}
