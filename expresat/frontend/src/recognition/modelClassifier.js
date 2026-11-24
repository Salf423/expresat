/**
 * In-browser ONNX Runtime Web neural classifier (`ModelClassifier`, FEATURE_SPEC v1.4.0).
 *
 * Mirrors `expresat/models/inference_engine.py` 1:1 for DS-TCN-1D INT8 (~90 KB) execution
 * 100% locally in the browser with zero backend or internet dependency:
 * - Consumes raw unsmoothed landmarks + real monotonic `t_ms` via `extractWindow` -> `(1, 15, 178)` float32.
 * - Strictly validates `model_metadata.json`:
 *     * `feature_spec_version === "1.4.0"`
 *     * `config_hash` matches canonical SHA-256 `computeConfigHash(...)`
 *     * `production_ready === true` and `is_smoke_test !== true`
 * - Applies post-hoc Temperature Scaling (`logits / temperature`) with numerically stable softmax.
 * - Enforces all 3 calibrated rejection gates:
 *     1. `top1Prob < minConfidence` (default 0.65) -> `'low_confidence'`
 *     2. `top1Prob - top2Prob < minMargin` (default 0.20) -> `'low_margin'`
 *     3. `H(p) / ln(C) > maxNormalizedEntropy` (default 0.55) -> `'high_entropy'`
 *   Rejected windows safely fall back to `label: null` / `safeLabel: 'reposo'`.
 * - Implements the synchronous `Classifier { predict(frame) }` interface for `useSignEngine`
 *   using non-blocking background inference so camera FPS is never stalled.
 */

import { Classifier } from './classifier.js';
import {
  FEATURE_SPEC_VERSION,
  SEQUENCE_LENGTH,
  TOTAL_FEATURES,
  extractWindow,
  computeConfigHash,
} from '../engine/featureExtractor.js';

export const DEFAULT_MODEL_URL = '/models/expresat_dstcn_int8.onnx';
export const DEFAULT_METADATA_URL = '/models/model_metadata.json';
export const DEFAULT_WASM_PATHS = '/wasm/';

export const DEFAULT_NEURAL_MIN_CONFIDENCE = 0.65;
export const DEFAULT_NEURAL_MIN_MARGIN = 0.2;
export const DEFAULT_NEURAL_MAX_ENTROPY = 0.55;
export const DEFAULT_NEURAL_FALLBACK_LABEL = 'reposo';

const WINDOW_RETENTION_MS = 1100;
const WINDOW_MIN_SPAN_MS = 1000 * (14 / 15);
const WINDOW_MIN_FRAMES = 12;
const WINDOW_MAX_FRAMES = 60;
const DEFAULT_INFER_INTERVAL_MS = 180;
const DEFAULT_SAME_SIGN_COOLDOWN_MS = 1200;
const DEFAULT_SWITCH_COOLDOWN_MS = 300;
const DEFAULT_REST_RESET_MS = 400;

const HEX_64_RE = /^[a-f0-9]{64}$/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Strictly validates `model_metadata.json` against FEATURE_SPEC v1.4.0, canonical `config_hash`,
 * and production readiness policy (blocking smoke-test / unready models by default).
 *
 * @param {Object} metadata
 * @param {Object} [options]
 * @param {boolean} [options.allowSmokeTest=false]
 * @param {string|null} [options.expectedDelegate=null]
 * @param {number|null} [options.expectedPoseCadence=null]
 */
export async function validateModelMetadata(
  metadata,
  {
    allowSmokeTest = false,
    expectedDelegate = null,
    expectedPoseCadence = null,
  } = {}
) {
  if (!isPlainObject(metadata)) {
    return {
      valid: false,
      code: 'INVALID_METADATA',
      error: 'model_metadata.json inválido: se esperaba un objeto JSON.',
      normalized: null,
    };
  }

  if (!allowSmokeTest) {
    if (metadata.is_smoke_test === true) {
      return {
        valid: false,
        code: 'SMOKE_TEST_BLOCKED',
        error: 'Artefacto de smoke_test bloqueado en producción (is_smoke_test=true).',
        normalized: null,
      };
    }
    if (metadata.production_ready !== true) {
      return {
        valid: false,
        code: 'NOT_PRODUCTION_READY',
        error: 'Modelo neuronal aún no marcado como listo para producción (production_ready !== true).',
        normalized: null,
      };
    }
  }

  const metaVersion =
    typeof metadata.feature_spec_version === 'string'
      ? metadata.feature_spec_version.trim()
      : '';
  if (metaVersion !== FEATURE_SPEC_VERSION) {
    return {
      valid: false,
      code: 'INCOMPATIBLE_FEATURE_SPEC',
      error: `Versión FEATURE_SPEC incompatible: modelo=${metaVersion || 'ausente'}, runtime=${FEATURE_SPEC_VERSION}.`,
      normalized: null,
    };
  }

  if (
    metadata.sequence_length !== undefined &&
    metadata.sequence_length !== null &&
    Number(metadata.sequence_length) !== SEQUENCE_LENGTH
  ) {
    return {
      valid: false,
      code: 'INCOMPATIBLE_SEQUENCE_LENGTH',
      error: `sequence_length incompatible: modelo=${metadata.sequence_length}, runtime=${SEQUENCE_LENGTH}.`,
      normalized: null,
    };
  }

  if (
    metadata.num_features !== undefined &&
    metadata.num_features !== null &&
    Number(metadata.num_features) !== TOTAL_FEATURES
  ) {
    return {
      valid: false,
      code: 'INCOMPATIBLE_NUM_FEATURES',
      error: `num_features incompatible: modelo=${metadata.num_features}, runtime=${TOTAL_FEATURES}.`,
      normalized: null,
    };
  }

  if (
    !Array.isArray(metadata.labels) ||
    metadata.labels.length === 0 ||
    !metadata.labels.every((lbl) => typeof lbl === 'string' && lbl.trim().length > 0)
  ) {
    return {
      valid: false,
      code: 'INVALID_LABELS',
      error: 'model_metadata.json carece de una lista válida de etiquetas (labels).',
      normalized: null,
    };
  }

  const labels = metadata.labels.map((lbl) => lbl.trim());
  const numClasses =
    metadata.num_classes !== undefined && metadata.num_classes !== null
      ? Number(metadata.num_classes)
      : labels.length;
  if (!Number.isInteger(numClasses) || numClasses !== labels.length) {
    return {
      valid: false,
      code: 'INVALID_NUM_CLASSES',
      error: `num_classes (${metadata.num_classes}) no coincide con labels.length (${labels.length}).`,
      normalized: null,
    };
  }

  const tempRaw = metadata.temperature !== undefined ? metadata.temperature : 1.0;
  const temperature = Number(tempRaw);
  if (!Number.isFinite(temperature) || temperature <= 0) {
    return {
      valid: false,
      code: 'INVALID_TEMPERATURE',
      error: `temperature inválido en model_metadata.json: ${String(tempRaw)}.`,
      normalized: null,
    };
  }

  const delegate = String(metadata.delegate ?? 'GPU');
  const poseCadence = Number(metadata.pose_cadence ?? 1);
  if (!Number.isInteger(poseCadence) || poseCadence < 1) {
    return {
      valid: false,
      code: 'INVALID_POSE_CADENCE',
      error: `pose_cadence inválido en model_metadata.json: ${String(metadata.pose_cadence)}.`,
      normalized: null,
    };
  }

  if (expectedDelegate !== null && delegate !== String(expectedDelegate)) {
    return {
      valid: false,
      code: 'INCOMPATIBLE_DELEGATE',
      error: `Delegado incompatible: modelo=${delegate}, esperado=${expectedDelegate}.`,
      normalized: null,
    };
  }

  if (expectedPoseCadence !== null && poseCadence !== Number(expectedPoseCadence)) {
    return {
      valid: false,
      code: 'INCOMPATIBLE_POSE_CADENCE',
      error: `pose_cadence incompatible: modelo=${poseCadence}, esperado=${expectedPoseCadence}.`,
      normalized: null,
    };
  }

  const metaHash = typeof metadata.config_hash === 'string' ? metadata.config_hash.trim() : '';
  if (!HEX_64_RE.test(metaHash)) {
    return {
      valid: false,
      code: 'INVALID_CONFIG_HASH',
      error: 'model_metadata.json carece de un config_hash SHA-256 válido (64 hex).',
      normalized: null,
    };
  }

  const expectedHash = await computeConfigHash({ delegate, poseCadence });
  if (metaHash.toLowerCase() !== expectedHash.toLowerCase()) {
    return {
      valid: false,
      code: 'CONFIG_HASH_MISMATCH',
      error: `config_hash desalineado (modelo=${metaHash.slice(0, 12)}…, runtime=${expectedHash.slice(0, 12)}…).`,
      normalized: null,
    };
  }

  const policyRaw = isPlainObject(metadata.rejection_policy) ? metadata.rejection_policy : {};
  const minConfidence = Number.isFinite(Number(policyRaw.min_confidence))
    ? Number(policyRaw.min_confidence)
    : DEFAULT_NEURAL_MIN_CONFIDENCE;
  const minMargin = Number.isFinite(Number(policyRaw.min_margin))
    ? Number(policyRaw.min_margin)
    : DEFAULT_NEURAL_MIN_MARGIN;
  const maxNormalizedEntropy = Number.isFinite(Number(policyRaw.max_normalized_entropy))
    ? Number(policyRaw.max_normalized_entropy)
    : DEFAULT_NEURAL_MAX_ENTROPY;
  const fallbackLabel =
    typeof policyRaw.fallback_label === 'string' && policyRaw.fallback_label.trim()
      ? policyRaw.fallback_label.trim()
      : DEFAULT_NEURAL_FALLBACK_LABEL;

  return {
    valid: true,
    code: null,
    error: null,
    normalized: Object.freeze({
      featureSpecVersion: metaVersion,
      configHash: metaHash.toLowerCase(),
      labels: Object.freeze(labels),
      numClasses,
      architecture: String(metadata.architecture || 'DS-TCN-1D'),
      temperature,
      delegate,
      poseCadence,
      productionReady: metadata.production_ready === true,
      isSmokeTest: metadata.is_smoke_test === true,
      modelFiles: isPlainObject(metadata.model_files) ? Object.freeze({ ...metadata.model_files }) : null,
      rejectionPolicy: Object.freeze({
        minConfidence,
        minMargin,
        maxNormalizedEntropy,
        fallbackLabel,
      }),
    }),
  };
}

/**
 * Numerically stable Temperature-Scaled Softmax: `softmax(logits / temperature)`.
 *
 * @param {ArrayLike<number>} logits
 * @param {number} [temperature=1.0]
 * @returns {Float64Array}
 */
export function softmaxWithTemperature(logits, temperature = 1.0) {
  if (!logits || typeof logits.length !== 'number' || logits.length === 0) {
    throw new Error('logits debe ser un vector no vacío.');
  }
  const T = Number(temperature);
  if (!Number.isFinite(T) || T <= 0) {
    throw new Error(`temperature debe ser un número finito > 0 (recibido: ${temperature}).`);
  }

  const n = logits.length;
  const scaled = new Float64Array(n);
  let maxVal = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = Number(logits[i]) / T;
    if (!Number.isFinite(v)) {
      throw new Error(`logit no finito detectado en índice ${i}.`);
    }
    scaled[i] = v;
    if (v > maxVal) maxVal = v;
  }

  const probs = new Float64Array(n);
  let sumExp = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(scaled[i] - maxVal);
    probs[i] = e;
    sumExp += e;
  }

  const invSum = sumExp > 0 ? 1 / sumExp : 1 / n;
  for (let i = 0; i < n; i++) {
    probs[i] *= invSum;
  }
  return probs;
}

/**
 * Evaluates the 3 calibrated rejection gates matching `expresat/models/inference_engine.py`:
 *   1. `top1Prob < minConfidence` -> `'low_confidence'`
 *   2. `top1Prob - top2Prob < minMargin` -> `'low_margin'`
 *   3. `H(p) / ln(C) > maxNormalizedEntropy` -> `'high_entropy'`
 *
 * Rejected predictions return `label: null` and `safeLabel: fallbackLabel` (`'reposo'`).
 */
export function evaluateRejectionGates(
  probabilities,
  labels,
  {
    minConfidence = DEFAULT_NEURAL_MIN_CONFIDENCE,
    minMargin = DEFAULT_NEURAL_MIN_MARGIN,
    maxNormalizedEntropy = DEFAULT_NEURAL_MAX_ENTROPY,
    fallbackLabel = DEFAULT_NEURAL_FALLBACK_LABEL,
  } = {}
) {
  if (!probabilities || !Array.isArray(labels) || probabilities.length !== labels.length || labels.length === 0) {
    return {
      label: null,
      safeLabel: fallbackLabel,
      rawTop1Label: null,
      confidence: 0,
      margin: 0,
      normalizedEntropy: 1,
      rejected: true,
      rejectionReason: 'invalid_probabilities',
      isRestClass: true,
      topPredictions: {},
    };
  }

  const n = probabilities.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => probabilities[b] - probabilities[a]);

  const top1Idx = indices[0];
  const top1Prob = Number(probabilities[top1Idx]);
  const top2Prob = n >= 2 ? Number(probabilities[indices[1]]) : 0;
  const margin = top1Prob - top2Prob;

  let normalizedEntropy = 0;
  if (n >= 2) {
    let entropy = 0;
    for (let i = 0; i < n; i++) {
      const p = Math.max(1e-12, Math.min(1, Number(probabilities[i])));
      entropy -= p * Math.log(p);
    }
    normalizedEntropy = entropy / Math.log(n);
  }

  let rejectionReason = null;
  if (top1Prob < minConfidence) {
    rejectionReason = 'low_confidence';
  } else if (margin < minMargin) {
    rejectionReason = 'low_margin';
  } else if (normalizedEntropy > maxNormalizedEntropy) {
    rejectionReason = 'high_entropy';
  }

  const rejected = rejectionReason !== null;
  const rawTop1Label = labels[top1Idx];
  const isRestClass = rawTop1Label.toLowerCase() === fallbackLabel.toLowerCase();

  const topPredictions = {};
  const topK = Math.min(5, n);
  for (let i = 0; i < topK; i++) {
    const idx = indices[i];
    topPredictions[labels[idx]] = Number(Number(probabilities[idx]).toFixed(4));
  }

  return {
    label: rejected ? null : rawTop1Label,
    safeLabel: rejected ? fallbackLabel : rawTop1Label,
    rawTop1Label,
    confidence: Number(top1Prob.toFixed(4)),
    margin: Number(margin.toFixed(4)),
    normalizedEntropy: Number(normalizedEntropy.toFixed(4)),
    rejected,
    rejectionReason,
    isRestClass,
    topPredictions,
  };
}

function isHtmlResponse(response) {
  const ct = response?.headers?.get?.('content-type') || '';
  return ct.toLowerCase().includes('text/html');
}

function resolveModelUrlFromMetadata(defaultUrl, metadataUrl, metadata) {
  if (defaultUrl && defaultUrl !== DEFAULT_MODEL_URL) {
    return defaultUrl;
  }
  const int8File = metadata?.modelFiles?.int8;
  if (typeof int8File === 'string' && int8File.trim()) {
    const baseDir = metadataUrl.includes('/')
      ? metadataUrl.slice(0, metadataUrl.lastIndexOf('/') + 1)
      : '/models/';
    return `${baseDir}${int8File.trim()}`;
  }
  return defaultUrl || DEFAULT_MODEL_URL;
}

/**
 * Probes whether a validated production DS-TCN-1D ONNX model + `model_metadata.json`
 * is deployed in `public/models/` without throwing errors or stalling startup.
 */
export async function probeNeuralModelAvailability({
  modelUrl = DEFAULT_MODEL_URL,
  metadataUrl = DEFAULT_METADATA_URL,
  fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
} = {}) {
  if (typeof fetchFn !== 'function') {
    return {
      available: false,
      status: 'unavailable',
      reason: 'FETCH_UNAVAILABLE',
      message: 'Modelo neuronal en preparación',
      metadata: null,
      modelUrl,
    };
  }

  let metadataRaw = null;
  try {
    const metaRes = await fetchFn(metadataUrl, { cache: 'no-cache' });
    if (!metaRes || !metaRes.ok || isHtmlResponse(metaRes)) {
      return {
        available: false,
        status: 'unavailable',
        reason: 'MODEL_NOT_DEPLOYED',
        message: 'Modelo neuronal en preparación',
        metadata: null,
        modelUrl,
      };
    }
    metadataRaw = await metaRes.json();
  } catch {
    return {
      available: false,
      status: 'unavailable',
      reason: 'MODEL_NOT_DEPLOYED',
      message: 'Modelo neuronal en preparación',
      metadata: null,
      modelUrl,
    };
  }

  const validation = await validateModelMetadata(metadataRaw);
  if (!validation.valid) {
    return {
      available: false,
      status: 'invalid',
      reason: validation.code,
      message: 'Modelo neuronal en preparación',
      detail: validation.error,
      metadata: null,
      modelUrl,
    };
  }

  const candidateUrls = Array.from(
    new Set([modelUrl, resolveModelUrlFromMetadata(modelUrl, metadataUrl, validation.normalized)])
  );

  for (const url of candidateUrls) {
    try {
      const headRes = await fetchFn(url, { method: 'HEAD', cache: 'no-cache' });
      if (headRes && headRes.ok && !isHtmlResponse(headRes)) {
        return {
          available: true,
          status: 'ready',
          reason: null,
          message: 'Modelo neuronal listo (local en navegador)',
          metadata: validation.normalized,
          modelUrl: url,
        };
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    available: false,
    status: 'unavailable',
    reason: 'ONNX_WEIGHTS_MISSING',
    message: 'Modelo neuronal en preparación',
    metadata: validation.normalized,
    modelUrl: candidateUrls[0],
  };
}

function buildRawInferenceFrame(frameData) {
  const raw = frameData?.raw || frameData;
  const tMs =
    typeof frameData?.t_ms === 'number' && Number.isFinite(frameData.t_ms)
      ? frameData.t_ms
      : typeof frameData?.timestamp_ms === 'number' && Number.isFinite(frameData.timestamp_ms)
        ? frameData.timestamp_ms
        : typeof frameData?.timestamp === 'number' && Number.isFinite(frameData.timestamp)
          ? frameData.timestamp
          : performance.now();

  return {
    t_ms: tMs,
    pose: raw?.pose ?? null,
    hands: Array.isArray(raw?.hands) ? raw.hands : [],
    handedness: Array.isArray(raw?.handedness) ? raw.handedness : [],
    leftHand: raw?.leftHand ?? null,
    rightHand: raw?.rightHand ?? null,
  };
}

/**
 * Browser ONNX Runtime Web neural classifier implementing the `Classifier` contract.
 * Also supports legacy `new ModelClassifier(inferFn)` function injection for tests.
 */
export class ModelClassifier extends Classifier {
  constructor(optionsOrInferFn = {}) {
    super();

    if (typeof optionsOrInferFn === 'function') {
      this.inferFn = optionsOrInferFn;
      this.options = {};
    } else {
      this.inferFn = null;
      this.options = isPlainObject(optionsOrInferFn) ? { ...optionsOrInferFn } : {};
    }

    this.modelUrl = this.options.modelUrl || DEFAULT_MODEL_URL;
    this.metadataUrl = this.options.metadataUrl || DEFAULT_METADATA_URL;
    this.wasmPaths = this.options.wasmPaths ?? null;
    this.inferIntervalMs = this.options.inferIntervalMs ?? DEFAULT_INFER_INTERVAL_MS;
    this.sameSignCooldownMs = this.options.sameSignCooldownMs ?? DEFAULT_SAME_SIGN_COOLDOWN_MS;
    this.switchCooldownMs = this.options.switchCooldownMs ?? DEFAULT_SWITCH_COOLDOWN_MS;
    this.restResetMs = this.options.restResetMs ?? DEFAULT_REST_RESET_MS;

    this.session = null;
    this.ort = null;
    this.inputName = null;
    this.outputName = null;
    this.metadata = null;

    this.status = 'idle'; // 'idle' | 'loading' | 'ready' | 'unavailable' | 'invalid' | 'error'
    this.statusReason = 'MODEL_NOT_LOADED';
    this.statusMessage = 'Modelo neuronal en preparación';

    this._frameBuffer = [];
    this._inferInFlight = false;
    this._lastInferMs = -Infinity;
    this._generation = 0;

    this._latestPrediction = this._makeIdlePrediction('MODEL_NOT_LOADED');
    this._pendingCommit = null;
    this._lastCommittedLabel = null;
    this._lastCommittedMs = -Infinity;
    this._restSinceMs = null;
    this._sawRestEnough = true;
  }

  get isReady() {
    return this.status === 'ready' && Boolean(this.session) && Boolean(this.metadata);
  }

  _makeIdlePrediction(reason = 'MODEL_NOT_LOADED') {
    return {
      label: null,
      confidence: 0,
      committed: false,
      committedLabel: null,
      state: 'idle',
      details: {
        engine: 'neural-web',
        reason,
        safeLabel: this.metadata?.rejectionPolicy?.fallbackLabel || DEFAULT_NEURAL_FALLBACK_LABEL,
      },
    };
  }

  /**
   * Loads and strictly validates `model_metadata.json` + `.onnx` weights into an
   * ONNX Runtime Web session (or validates an injected mocked session in unit tests).
   */
  async load({
    modelUrl = this.modelUrl,
    metadataUrl = this.metadataUrl,
    fetchFn = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
    ortModule = null,
    session = null,
    metadata = null,
    allowSmokeTest = false,
  } = {}) {
    this.status = 'loading';
    this.statusReason = null;
    this.statusMessage = 'Cargando modelo neuronal local…';

    // 1. Obtain metadata (either injected or fetched)
    let rawMetadata = metadata;
    if (!rawMetadata) {
      if (typeof fetchFn !== 'function') {
        this.status = 'unavailable';
        this.statusReason = 'FETCH_UNAVAILABLE';
        this.statusMessage = 'Modelo neuronal en preparación';
        return { ready: false, status: this.status, reason: this.statusReason, message: this.statusMessage };
      }
      try {
        const res = await fetchFn(metadataUrl, { cache: 'no-cache' });
        if (!res || !res.ok || isHtmlResponse(res)) {
          this.status = 'unavailable';
          this.statusReason = 'MODEL_NOT_DEPLOYED';
          this.statusMessage = 'Modelo neuronal en preparación';
          return { ready: false, status: this.status, reason: this.statusReason, message: this.statusMessage };
        }
        rawMetadata = await res.json();
      } catch {
        this.status = 'unavailable';
        this.statusReason = 'MODEL_NOT_DEPLOYED';
        this.statusMessage = 'Modelo neuronal en preparación';
        return { ready: false, status: this.status, reason: this.statusReason, message: this.statusMessage };
      }
    }

    // 2. Strictly validate FEATURE_SPEC v1.4.0, config_hash, and production readiness
    const validation = await validateModelMetadata(rawMetadata, { allowSmokeTest });
    if (!validation.valid) {
      this.status = 'invalid';
      this.statusReason = validation.code;
      this.statusMessage = validation.error;
      this.metadata = null;
      this.session = null;
      return { ready: false, status: this.status, reason: this.statusReason, message: this.statusMessage };
    }

    // 3. Create or bind ONNX Runtime Web session
    let resolvedOrt = ortModule;
    let resolvedSession = session;

    if (!resolvedSession) {
      if (typeof fetchFn !== 'function') {
        this.status = 'unavailable';
        this.statusReason = 'FETCH_UNAVAILABLE';
        this.statusMessage = 'Modelo neuronal en preparación';
        return { ready: false, status: this.status, reason: this.statusReason, message: this.statusMessage };
      }

      const candidateUrls = Array.from(
        new Set([modelUrl, resolveModelUrlFromMetadata(modelUrl, metadataUrl, validation.normalized)])
      );
      let modelBuffer = null;

      for (const candidateUrl of candidateUrls) {
        try {
          const modelRes = await fetchFn(candidateUrl, { cache: 'no-cache' });
          if (modelRes && modelRes.ok && !isHtmlResponse(modelRes)) {
            modelBuffer = await modelRes.arrayBuffer();
            if (modelBuffer && modelBuffer.byteLength > 0) {
              this.modelUrl = candidateUrl;
              break;
            }
          }
        } catch {
          // Try next candidate
        }
      }

      if (!modelBuffer || modelBuffer.byteLength === 0) {
        this.status = 'unavailable';
        this.statusReason = 'ONNX_WEIGHTS_MISSING';
        this.statusMessage = 'Modelo neuronal en preparación';
        return { ready: false, status: this.status, reason: this.statusReason, message: this.statusMessage };
      }

      try {
        if (!resolvedOrt) {
          resolvedOrt = await import('onnxruntime-web/wasm');
        }
        if (resolvedOrt?.env?.wasm) {
          resolvedOrt.env.wasm.numThreads = 1;
          resolvedOrt.env.wasm.proxy = false;
          if (this.wasmPaths) {
            resolvedOrt.env.wasm.wasmPaths = this.wasmPaths;
          }
        }
        resolvedSession = await resolvedOrt.InferenceSession.create(new Uint8Array(modelBuffer), {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
      } catch (err) {
        this.status = 'error';
        this.statusReason = 'ORT_SESSION_ERROR';
        this.statusMessage = err?.message || 'Error al inicializar la sesión ONNX local.';
        this.session = null;
        return { ready: false, status: this.status, reason: this.statusReason, message: this.statusMessage };
      }
    }

    this.ort = resolvedOrt;
    this.session = resolvedSession;
    this.metadata = validation.normalized;
    this.inputName =
      (Array.isArray(resolvedSession.inputNames) && resolvedSession.inputNames[0]) || 'input';
    this.outputName =
      (Array.isArray(resolvedSession.outputNames) && resolvedSession.outputNames[0]) || null;

    this.status = 'ready';
    this.statusReason = null;
    this.statusMessage = 'IA Neuronal (Local) activa';
    this._latestPrediction = this._makeIdlePrediction('AWAITING_WINDOW');

    return {
      ready: true,
      status: this.status,
      reason: null,
      message: this.statusMessage,
      metadata: this.metadata,
    };
  }

  _createInputTensor(flatFloat32) {
    const dims = [1, SEQUENCE_LENGTH, TOTAL_FEATURES];
    if (this.ort && typeof this.ort.Tensor === 'function') {
      return new this.ort.Tensor('float32', flatFloat32, dims);
    }
    return {
      type: 'float32',
      dims,
      data: flatFloat32,
    };
  }

  /**
   * Runs ONNX inference + Temperature Scaling + 3-gate rejection on a `(1, 15, 178)` float32 buffer.
   */
  async predictTensor(flatFloat32) {
    if (!this.isReady) {
      return this._makeIdlePrediction(this.statusReason || 'MODEL_NOT_LOADED');
    }

    const expectedLen = SEQUENCE_LENGTH * TOTAL_FEATURES;
    if (!(flatFloat32 instanceof Float32Array) || flatFloat32.length !== expectedLen) {
      return {
        label: null,
        confidence: 0,
        committed: false,
        committedLabel: null,
        state: 'rejected',
        details: {
          engine: 'neural-web',
          reason: 'INVALID_TENSOR_SHAPE',
          safeLabel: this.metadata.rejectionPolicy.fallbackLabel,
        },
      };
    }

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const inputTensor = this._createInputTensor(flatFloat32);
    const outputs = await this.session.run({ [this.inputName]: inputTensor });
    const outKey =
      (this.outputName && outputs[this.outputName] ? this.outputName : null) ||
      Object.keys(outputs)[0];
    const logitsTensor = outputs[outKey];
    const logits = logitsTensor?.data ?? logitsTensor;

    const probabilities = softmaxWithTemperature(logits, this.metadata.temperature);
    const gate = evaluateRejectionGates(
      probabilities,
      this.metadata.labels,
      this.metadata.rejectionPolicy
    );

    const latencyMs = Number(
      ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0).toFixed(2)
    );

    const isEmittable = !gate.rejected && !gate.isRestClass && Boolean(gate.label);
    const state = isEmittable ? 'confirmed' : gate.rejected ? 'rejected' : 'idle';

    return {
      label: isEmittable ? gate.label : null,
      confidence: isEmittable ? gate.confidence : 0,
      committed: false,
      committedLabel: null,
      state,
      details: {
        engine: 'neural-web',
        architecture: this.metadata.architecture,
        rawLabel: gate.rawTop1Label,
        safeLabel: gate.safeLabel,
        calibratedConfidence: gate.confidence,
        margin: gate.margin,
        normalizedEntropy: gate.normalizedEntropy,
        temperature: this.metadata.temperature,
        rejected: gate.rejected,
        rejectionReason: gate.rejectionReason,
        reason: gate.rejected
          ? gate.rejectionReason
          : gate.isRestClass
            ? 'REST_CLASS'
            : 'NEURAL_CONFIRMED',
        latencyMs,
        topPredictions: gate.topPredictions,
      },
    };
  }

  /**
   * Preprocesses a raw window (`[{ t_ms, pose, hands, handedness, leftHand, rightHand }]`)
   * with canonical `extractWindow` (`FEATURE_SPEC v1.4.0`) and runs ONNX inference.
   */
  async predictAsync(rawFrames) {
    if (!this.isReady) {
      return this._makeIdlePrediction(this.statusReason || 'MODEL_NOT_LOADED');
    }

    const { tensor, valid, error } = extractWindow(rawFrames);
    if (!valid || !tensor) {
      return {
        label: null,
        confidence: 0,
        committed: false,
        committedLabel: null,
        state: 'idle',
        details: {
          engine: 'neural-web',
          reason: error || 'INVALID_WINDOW',
          safeLabel: this.metadata.rejectionPolicy.fallbackLabel,
          valid: false,
        },
      };
    }

    return this.predictTensor(tensor);
  }

  _updateCommitEdge(prediction, nowMs) {
    if (!prediction.label) {
      if (this._restSinceMs === null) {
        this._restSinceMs = nowMs;
      } else if (nowMs - this._restSinceMs >= this.restResetMs) {
        this._sawRestEnough = true;
      }
      return;
    }

    this._restSinceMs = null;
    const isSame = prediction.label === this._lastCommittedLabel;
    const elapsed = nowMs - this._lastCommittedMs;
    const canCommit = isSame
      ? this._sawRestEnough && elapsed >= this.sameSignCooldownMs
      : elapsed >= this.switchCooldownMs;

    if (canCommit) {
      this._lastCommittedLabel = prediction.label;
      this._lastCommittedMs = nowMs;
      this._sawRestEnough = false;
      this._pendingCommit = {
        label: prediction.label,
        confidence: prediction.confidence,
      };
    }
  }

  /**
   * Synchronous `Classifier.predict` entry point for `useSignEngine`'s frame loop.
   * Buffers raw frames + `t_ms`, triggers non-blocking background ONNX inference,
   * and returns the latest calibrated prediction immediately (zero FPS stall).
   */
  predict(frameOrFrames) {
    if (typeof this.inferFn === 'function') {
      return this.inferFn(frameOrFrames);
    }

    if (!this.isReady) {
      return this._makeIdlePrediction(this.statusReason || 'MODEL_NOT_LOADED');
    }

    if (Array.isArray(frameOrFrames)) {
      this._frameBuffer = frameOrFrames.map(buildRawInferenceFrame).slice(-WINDOW_MAX_FRAMES);
    } else if (frameOrFrames && typeof frameOrFrames === 'object') {
      const entry = buildRawInferenceFrame(frameOrFrames);
      this._frameBuffer.push(entry);
      const latestTs = entry.t_ms;
      while (
        this._frameBuffer.length > WINDOW_MIN_FRAMES &&
        latestTs - this._frameBuffer[0].t_ms > WINDOW_RETENTION_MS
      ) {
        this._frameBuffer.shift();
      }
      while (this._frameBuffer.length > WINDOW_MAX_FRAMES) {
        this._frameBuffer.shift();
      }
    }

    const buf = this._frameBuffer;
    const spanMs = buf.length >= 2 ? buf[buf.length - 1].t_ms - buf[0].t_ms : 0;
    const windowReady = buf.length >= WINDOW_MIN_FRAMES && spanMs >= WINDOW_MIN_SPAN_MS;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (windowReady && !this._inferInFlight && nowMs - this._lastInferMs >= this.inferIntervalMs) {
      this._inferInFlight = true;
      this._lastInferMs = nowMs;
      const gen = this._generation;
      const snapshot = buf.slice();

      this.predictAsync(snapshot)
        .then((pred) => {
          if (gen !== this._generation) return;
          const finishNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
          this._updateCommitEdge(pred, finishNow);
          this._latestPrediction = pred;
        })
        .catch((err) => {
          if (gen !== this._generation) return;
          this._latestPrediction = this._makeIdlePrediction(err?.message || 'INFERENCE_ERROR');
        })
        .finally(() => {
          if (gen === this._generation) {
            this._inferInFlight = false;
          }
        });
    }

    // Consume one-shot commit edge so sentence history / TTS fires exactly once per sign
    if (this._pendingCommit) {
      const commit = this._pendingCommit;
      this._pendingCommit = null;
      return {
        ...this._latestPrediction,
        committed: true,
        committedLabel: commit.label,
      };
    }

    return this._latestPrediction;
  }

  reset() {
    this._generation += 1;
    this._frameBuffer = [];
    this._inferInFlight = false;
    this._lastInferMs = -Infinity;
    this._pendingCommit = null;
    this._lastCommittedLabel = null;
    this._lastCommittedMs = -Infinity;
    this._restSinceMs = null;
    this._sawRestEnough = true;
    this._latestPrediction = this._makeIdlePrediction(
      this.isReady ? 'AWAITING_WINDOW' : this.statusReason || 'MODEL_NOT_LOADED'
    );
  }

  async dispose() {
    this.reset();
    if (this.session && typeof this.session.release === 'function') {
      try {
        await this.session.release();
      } catch {
        // Ignore release errors
      }
    }
    this.session = null;
    this.status = 'idle';
    this.statusReason = 'DISPOSED';
  }

  getInfo() {
    return {
      engine: 'onnxruntime-web',
      ready: this.isReady,
      status: this.status,
      statusReason: this.statusReason,
      statusMessage: this.statusMessage,
      modelUrl: this.modelUrl,
      metadataUrl: this.metadataUrl,
      metadata: this.metadata,
    };
  }
}
