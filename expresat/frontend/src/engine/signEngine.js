/**
 * Main-thread camera capture and MediaPipe vision engine (no Workers).
 *
 * Exposes `start(videoElement)`, `stop()`, `onFrame(cb)`, `onFps(cb)`, and `onError(cb)`
 * with idempotent cleanup across React 19 StrictMode double-mounts (`runId` cancellation
 * and `video.play()` AbortError handling). Runs `@mediapipe/tasks-vision` (`CPU` or `GPU`
 * delegate) with optional PoseLandmarker and legacy CDN fallback.
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
  buildTelemetryFilename,
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
  INVALID_ASPECT_RATIO: 'ERR_INVALID_ASPECT_RATIO',
  WASM_LOAD_FAILED: 'WASM_LOAD_FAILED',
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  ENGINE_RUNTIME_ERROR: 'ENGINE_RUNTIME_ERROR',
});

export const EXPECTED_ASPECT_RATIO = 4 / 3;
export const ASPECT_RATIO_TOLERANCE = 0.05;

/**
 * Validate camera video dimensions against the canonical 4:3 (±0.05) FEATURE_SPEC v1.4.0 ratio.
 * Returns `{ valid: true, ratio: null }` if metadata dimensions are not yet available.
 */
export function validateVideoAspectRatio(
  videoWidth,
  videoHeight,
  expectedRatio = EXPECTED_ASPECT_RATIO,
  tolerance = ASPECT_RATIO_TOLERANCE
) {
  if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) {
    return { valid: true, ratio: null };
  }
  const ratio = videoWidth / videoHeight;
  const valid = Math.abs(ratio - expectedRatio) <= tolerance;
  return { valid, ratio };
}

const LEGACY_HANDS_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240';
const LEGACY_HOLISTIC_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1675471629';
const POSE_MODEL_LOCAL = '/models/pose_landmarker_lite.task';
const POSE_MODEL_FALLBACK_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/**
 * Load a classic script tag into `document.head` once (used only by the legacy backend).
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
 * Guard `window.ModuleFactory` on the main thread so `@mediapipe/tasks-vision`
 * cannot clear it (`self.ModuleFactory = void 0`) when instantiating multiple tasks.
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
 * Disable @mediapipe/tasks-vision's internal ODML logger (POST odml.pa.googleapis.com/v1/log)
 * to prevent outbound network calls and errors when running offline.
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
    // Non-critical if future versions alter internal fields
  }
}

/**
 * Instantiate a MediaPipe task trying the preferred delegate first (defaults to 'CPU'
 * to avoid WebGL driver stalls on Linux/Firefox iGPUs) before falling back, and local
 * model paths before remote URLs.
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
   * @param {number} [options.targetFps] Target inference FPS (default: CONFIG.targetFps, 15-30)
   * @param {number} [options.width] Camera capture width (default: 640)
   * @param {number} [options.height] Camera capture height (default: 480)
   * @param {boolean} [options.enablePose] Enable PoseLandmarker (default: CONFIG.enablePose)
   * @param {number} [options.modelComplexity] Model complexity 0 or 1 (default: CONFIG.modelComplexity)
   * @param {'tasks'|'legacy'} [options.backend] MediaPipe backend (default: CONFIG.mediapipeBackend)
   * @param {'CPU'|'GPU'} [options.delegate] Preferred delegate (default: 'GPU')
   * @param {boolean} [options.smoothLandmarks] Enable EMA smoothing (default: true)
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
        // Ignore URL parsing errors in non-browser contexts
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
        // Ignore URL parsing errors in non-browser contexts
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
    this._lastInferredVideoTime = -1;
    this._lastMonotonicTimestampMs = 0;
    this._aspectRatioErrorEmitted = false;
    this._lastAspectRatioValid = true;

    this._cameraFrameCount = 0;
    this._inferenceFrameCount = 0;
    this._currentFps = { cameraFps: 0, inferenceFps: 0 };

    this._emaFilter = new LandmarkEMAFilter(0.5);

    if (import.meta.env.DEV) {
      this._devTelemetry = options.devTelemetry ?? new DevTelemetryCollector({ enabled: true });
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
   * Subscribe to processed frame detections (`onFrame(frameData)`).
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onFrame(callback) {
    if (typeof callback === 'function') {
      this._frameListeners.add(callback);
    }
    return () => this._frameListeners.delete(callback);
  }

  /**
   * Subscribe to real FPS metrics (`onFps({ cameraFps, inferenceFps })`).
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onFps(callback) {
    if (typeof callback === 'function') {
      this._fpsListeners.add(callback);
    }
    return () => this._fpsListeners.delete(callback);
  }

  /**
   * Subscribe to camera or WASM errors (`onError({ code, message, cause })`).
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onError(callback) {
    if (typeof callback === 'function') {
      this._errorListeners.add(callback);
    }
    return () => this._errorListeners.delete(callback);
  }

  /**
   * Subscribe to engine lifecycle status changes (`onStatus(statusObj)`).
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onStatus(callback) {
    if (typeof callback === 'function') {
      this._statusListeners.add(callback);
    }
    return () => this._statusListeners.delete(callback);
  }

  onDevSnapshot(callback) {
    if (!import.meta.env.DEV) return () => {};
    if (typeof callback === 'function') {
      this._devSnapshotListeners.add(callback);
    }
    return () => this._devSnapshotListeners.delete(callback);
  }

  getDevSnapshot() {
    if (!import.meta.env.DEV) return null;
    return this._devTelemetry ? this._devTelemetry.getSnapshot() : null;
  }

  getDevReport() {
    if (!import.meta.env.DEV) return null;
    return this._devTelemetry ? this._devTelemetry.buildComparisonReport() : null;
  }

  setDevPhase(phase) {
    if (!import.meta.env.DEV || !this._devTelemetry) return;
    const prevPhase = this._devTelemetry.phase;
    this._devTelemetry.setPhase(phase);
    // Refresh dev panel automatically once recording stops ('grabando' -> 'reposo')
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
    if (!import.meta.env.DEV) return;
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
   * Start camera capture and MediaPipe inference on the main thread.
   * Idempotent across React StrictMode double-mounts.
   * @param {HTMLVideoElement} videoElement
   */
  async start(videoElement) {
    // Incrementing runId invalidates any older in-flight start()
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
          getReportFilename: () => buildTelemetryFilename(this.getDevReport()),
          formatMarkdown: () => formatReportMarkdown(this.getDevReport()),
          reset: () => this.resetDevTelemetry(),
        };
      }
    }

    let stream = null;
    try {
      stream = await this._acquireCameraStream();
    } catch (camErr) {
      if (currentRunId !== this._runId) return false;
      this._running = false;
      this._handleCameraError(camErr);
      return false;
    }

    // Abort if stop() or a newer start() ran while awaiting getUserMedia
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
      // React 19 StrictMode unmount interrupts play() with AbortError
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

    const syncVideoDims = () => {
      if (this._videoElement !== videoElement) return;
      const vw = videoElement.videoWidth || 0;
      const vh = videoElement.videoHeight || 0;
      if (vw > 0 && vh > 0) {
        this._checkVideoAspectRatio(vw, vh);
      }
      if (import.meta.env.DEV && this._devTelemetry) {
        this._devTelemetry.setCameraNegotiation({
          videoWidth: vw,
          videoHeight: vh,
        });
      }
    };
    syncVideoDims();
    if (!videoElement.videoWidth && typeof videoElement.addEventListener === 'function') {
      this._loadedMetadataHandler = syncVideoDims;
      videoElement.addEventListener('loadedmetadata', syncVideoDims, { once: true });
    }

    this._emitStatus({ state: 'loading_wasm', wasmReady: false, cameraReady: true });

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
    if (import.meta.env.DEV && this._devTelemetry) {
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

    // Pause decorative background particles while camera is active
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('camera-active', { detail: true }));
    }

    this._startPassiveCameraObserver(currentRunId);
    this._startFpsTicker();
    this._scheduleNextTick(currentRunId);
    return true;
  }

  /** Idempotently stop camera capture, inference loop, and MediaPipe instances. */
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
        // Ignore teardown cancelVideoFrameCallback errors
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
    this._lastInferredVideoTime = -1;
    this._aspectRatioErrorEmitted = false;
    this._lastAspectRatioValid = true;
    this._currentFps = { cameraFps: 0, inferenceFps: 0 };

    if (import.meta.env.DEV && this._devTelemetry && getActiveDevCollector() === this._devTelemetry) {
      setActiveDevCollector(null);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('camera-active', { detail: false }));
    }
  }

  _recordTrackNegotiation(stream) {
    if (!import.meta.env.DEV || !this._devTelemetry || !stream) return;
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
      if (import.meta.env.DEV) {
        this._devTelemetry?.setCameraNegotiation({
          experimentMode: 'default',
          requestedConstraints: primaryConstraints,
          usedFallback: false,
          fallbackReason: null,
          error: null,
        });
        this._recordTrackNegotiation(stream);
      }
      return stream;
    } catch (primaryErr) {
      // Retry without ideal constraints on virtual cameras unless permission was denied
      if (
        primaryErr?.name === 'NotAllowedError' ||
        primaryErr?.name === 'PermissionDeniedError'
      ) {
        throw primaryErr;
      }
      const fallbackConstraints = { video: true, audio: false };
      const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
      if (import.meta.env.DEV) {
        this._devTelemetry?.setCameraNegotiation({
          experimentMode: 'default',
          requestedConstraints: primaryConstraints,
          usedFallback: true,
          fallbackReason: `${primaryErr?.name || 'Error'}: ${primaryErr?.message || primaryErr}`,
          fallbackConstraints,
          error: null,
        });
        this._recordTrackNegotiation(stream);
      }
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

  _checkVideoAspectRatio(videoWidth, videoHeight) {
    const { valid, ratio } = validateVideoAspectRatio(videoWidth, videoHeight);
    this._lastAspectRatioValid = valid;
    if (!valid && !this._aspectRatioErrorEmitted) {
      this._aspectRatioErrorEmitted = true;
      this._emitError(
        ENGINE_ERROR_CODES.INVALID_ASPECT_RATIO,
        `Resolución de cámara ${videoWidth}x${videoHeight} (ratio ${ratio.toFixed(2)}) fuera de contrato 4:3 (±${ASPECT_RATIO_TOLERANCE}). Usa una resolución 4:3 (p.ej. 640x480).`
      );
    }
    return valid;
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
        // Surface the primary WASM/model error rather than the fallback error
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
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
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
    if (!import.meta.env.DEV || !this._devTelemetry || !this._videoElement) return;
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

      if (import.meta.env.DEV && this._devTelemetry) {
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
        // Skip 1 Hz React UI notifications while actively recording
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
      // Validate 4:3 aspect ratio once real dimensions are available
      if (this._lastAspectRatioValid && !this._aspectRatioErrorEmitted) {
        this._checkVideoAspectRatio(video.videoWidth, video.videoHeight);
      }

      // Count new camera frame when video.currentTime advances
      const currentVideoTime = video.currentTime;
      const videoTimeAdvanced = currentVideoTime !== this._lastVideoTime;
      if (videoTimeAdvanced) {
        this._lastVideoTime = currentVideoTime;
        this._cameraFrameCount++;
      }
      if (import.meta.env.DEV) {
        this._devTelemetry?.recordRafTick(nowMs, videoTimeAdvanced);
      }

      // Deduplicate by video.currentTime: never re-infer an already processed camera frame
      const hasUninferredFrame =
        this._lastInferredVideoTime === -1 || currentVideoTime !== this._lastInferredVideoTime;

      // Throttle inference to targetFps and prevent overlapping async steps
      if (
        !this._busy &&
        hasUninferredFrame &&
        nowMs - this._lastInferenceStartMs >= this.frameIntervalMs
      ) {
        this._busy = true;
        this._lastInferenceStartMs = nowMs;
        this._lastInferredVideoTime = currentVideoTime;
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
    if (import.meta.env.DEV) {
      this._devTelemetry?.beginInferenceStep(video?.currentTime ?? -1, startPerf);
    }
    let stepCompleted = false;

    try {
      // MediaPipe Tasks VIDEO mode requires strictly monotonic timestamps
      const timestampMs = Math.max(Math.floor(nowMs), this._lastMonotonicTimestampMs + 1);
      this._lastMonotonicTimestampMs = timestampMs;

      let rawHands = [];
      let rawHandedness = [];
      let rawPose = null;

      // Detector contract (FEATURE_SPEC v1.4.0): pass unmirrored HTMLVideoElement directly
      // with ImageProcessingOptions `{ rotationDegrees: 0 }`; mirror only on display canvas.
      if (this._handLandmarker) {
        if (import.meta.env.DEV) this._devTelemetry?.mark('expresat:hand:start');
        const handRes = this._handLandmarker.detectForVideo(video, timestampMs, {
          rotationDegrees: 0,
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
            const poseRes = this._poseLandmarker.detectForVideo(video, timestampMs, {
              rotationDegrees: 0,
            });
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
      if (import.meta.env.DEV) {
        this._devTelemetry?.endInferenceStep(performance.now(), stepCompleted);
      }
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
      handedness.push([{ categoryName: 'Left', score: 0.95 }]);
    }
    if (results?.rightHandLandmarks) {
      hands.push(results.rightHandLandmarks);
      handedness.push([{ categoryName: 'Right', score: 0.95 }]);
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

    // Direct v1.4.0 anatomical convention: 'Left' -> leftHand, 'Right' -> rightHand
    const resolveDirectSlots = (handList, handednessList) => {
      let lh = null;
      let rh = null;
      if (Array.isArray(handList)) {
        for (let i = 0; i < handList.length; i++) {
          const lm = handList[i];
          const category = handednessList?.[i]?.[0]?.categoryName;
          if (category === 'Left' && !lh) {
            lh = lm;
          } else if (category === 'Right' && !rh) {
            rh = lm;
          } else if (!lh) {
            lh = lm;
          } else if (!rh) {
            rh = lm;
          }
        }
      }
      return { leftHand: lh, rightHand: rh };
    };

    const { leftHand, rightHand } = resolveDirectSlots(filtered.hands, filtered.handedness);

    const cleanCoords = (arr, includeVisibility = false) => {
      if (!Array.isArray(arr)) return null;
      const len = arr.length;
      const out = new Array(len);
      for (let i = 0; i < len; i++) {
        const pt = arr[i];
        out[i] = includeVisibility
          ? { x: pt.x, y: pt.y, z: pt.z ?? 0, visibility: pt.visibility ?? 1.0 }
          : { x: pt.x, y: pt.y, z: pt.z ?? 0 };
      }
      return out;
    };

    let cachedRaw = null;
    const framePayload = {
      hands: filtered.hands || [],
      handedness: filtered.handedness || [],
      leftHand: cleanCoords(leftHand, false),
      rightHand: cleanCoords(rightHand, false),
      pose: cleanCoords(filtered.pose, true),
      timestamp,
      latencyMs,
      videoWidth: this._videoElement?.videoWidth || 0,
      videoHeight: this._videoElement?.videoHeight || 0,
      aspectRatioValid: this._lastAspectRatioValid,
      delegate: this._activeBackendInfo?.delegate || this.preferredDelegate,
    };

    // Lazy memoized raw getter: zero allocations when no consumer reads `framePayload.raw`
    Object.defineProperty(framePayload, 'raw', {
      enumerable: true,
      configurable: true,
      get() {
        if (cachedRaw === null) {
          const rawHandsClean = Array.isArray(hands) ? hands.map((h) => cleanCoords(h, false)) : [];
          const rawHandedness = handedness || [];
          const rawSlots = resolveDirectSlots(rawHandsClean, rawHandedness);
          cachedRaw = {
            hands: rawHandsClean,
            handedness: rawHandedness,
            leftHand: rawSlots.leftHand,
            rightHand: rawSlots.rightHand,
            pose: cleanCoords(pose, true),
          };
        }
        return cachedRaw;
      },
    });

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
