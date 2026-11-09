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

export const ENGINE_ERROR_CODES = Object.freeze({
  CAMERA_UNSUPPORTED: 'CAMERA_UNSUPPORTED',
  CAMERA_DENIED: 'CAMERA_DENIED',
  CAMERA_NOT_FOUND: 'CAMERA_NOT_FOUND',
  CAMERA_IN_USE: 'CAMERA_IN_USE',
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
    this.preferredDelegate = options.delegate ?? 'CPU';
    this.smoothLandmarks = options.smoothLandmarks ?? true;

    this._frameListeners = new Set();
    this._fpsListeners = new Set();
    this._errorListeners = new Set();
    this._statusListeners = new Set();

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
    this._fpsTimerId = null;
    this._busy = false;
    this._lastInferenceStartMs = 0;
    this._lastVideoTime = -1;
    this._lastMonotonicTimestampMs = 0;

    this._cameraFrameCount = 0;
    this._inferenceFrameCount = 0;
    this._currentFps = { cameraFps: 0, inferenceFps: 0 };

    this._emaFilter = new LandmarkEMAFilter(0.5);
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

    // 3. Arrancar contador de FPS reales (cada 1000 ms) y bucle de captura
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
    this._cameraFrameCount = 0;
    this._inferenceFrameCount = 0;
    this._currentFps = { cameraFps: 0, inferenceFps: 0 };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('camera-active', { detail: false }));
    }
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

    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: this.width },
          height: { ideal: this.height },
          frameRate: { ideal: Math.min(30, Math.max(15, this.targetFps)) },
          facingMode: 'user',
        },
        audio: false,
      });
    } catch (primaryErr) {
      // Si las restricciones ideales fallan en cámaras virtuales (ej. Playwright fake device),
      // reintentar con `{ video: true, audio: false }` salvo que haya sido permiso denegado.
      if (
        primaryErr?.name === 'NotAllowedError' ||
        primaryErr?.name === 'PermissionDeniedError'
      ) {
        throw primaryErr;
      }
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
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
      if (video.currentTime !== this._lastVideoTime) {
        this._lastVideoTime = video.currentTime;
        this._cameraFrameCount++;
      }

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

    if (this._handLandmarker) {
      const handRes = this._handLandmarker.detectForVideo(video, timestampMs);
      rawHands = handRes?.landmarks || [];
      rawHandedness = handRes?.handedness || [];

      if (this._poseLandmarker) {
        const poseRes = this._poseLandmarker.detectForVideo(video, timestampMs);
        rawPose = poseRes?.landmarks?.[0] || null;
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
    const latencyMs = Number((performance.now() - startPerf).toFixed(2));
    this._dispatchNormalizedResults({
      pose: rawPose,
      hands: rawHands,
      handedness: rawHandedness,
      timestamp: timestampMs,
      latencyMs,
    });
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
      ? this._emaFilter.filter({ pose, hands, handedness })
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
      timestamp,
      latencyMs,
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
