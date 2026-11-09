/**
 * src/recognition/classifier.js — Clasificador geométrico declarativo e interfaz Classifier
 *
 * Extiende la interfaz `Classifier { predict(frames) -> { label, category, confidence, details } }`
 * conectando el catálogo declarativo (`src/recognition/signs/`), el matcher con desempate por grupo
 * confundible y el rechazo por baja confianza (`reason: 'LOW_CONFIDENCE'`).
 */

import {
  HAND_LANDMARKS,
  isValidHandLandmarks,
  fingerStates,
  palmScale,
} from './geometry.js';
import {
  getSignCatalog,
  matchCatalog,
  buildTrajectoryContext,
  SIGN_TYPES,
} from './signs/index.js';

/**
 * Etiquetas canónicas base (retrocompatibilidad con rearquitectura-demo).
 */
export const SIGN_LABELS = Object.freeze({
  MANO_ABIERTA: 'Mano Abierta',
  PUNO: 'Puño',
  UNO: 'Uno',
  DOS: 'Dos',
  OK: 'OK / Pinza',
  BIEN: 'Bien',
  TE_QUIERO: 'Te Quiero',
  LUNES: 'Lunes',
  HOLA: 'Hola',
});

/**
 * Extrae `{ landmarks, handedness, timestampMs }` desde cualquier formato de frame soportado:
 * - Arreglo directo de 21 puntos `[{x,y,z}, ...]`
 * - Objeto `{ rightHand, leftHand, hands, landmarks, handedness, timestampMs }`
 */
export function extractHandWithMeta(frame, fallbackTs = null) {
  if (!frame) return null;

  if (Array.isArray(frame)) {
    if (frame.length < 21) return null;
    return {
      landmarks: frame,
      handedness: typeof frame.handedness === 'string' ? frame.handedness : 'Right',
      timestampMs: typeof frame.timestampMs === 'number' ? frame.timestampMs : fallbackTs,
    };
  }

  if (typeof frame === 'object') {
    const ts =
      typeof frame.timestampMs === 'number'
        ? frame.timestampMs
        : typeof frame.timestamp === 'number'
          ? frame.timestamp
          : fallbackTs;

    if (Array.isArray(frame.rightHand) && frame.rightHand.length >= 21) {
      return {
        landmarks: frame.rightHand,
        handedness: frame.handedness || 'Right',
        timestampMs: ts,
      };
    }
    if (Array.isArray(frame.leftHand) && frame.leftHand.length >= 21) {
      return {
        landmarks: frame.leftHand,
        handedness: frame.handedness || 'Left',
        timestampMs: ts,
      };
    }
    if (Array.isArray(frame.hands) && frame.hands.length > 0 && Array.isArray(frame.hands[0])) {
      if (frame.hands[0].length < 21) return null;
      return {
        landmarks: frame.hands[0],
        handedness: frame.handedness || 'Right',
        timestampMs: ts,
      };
    }
    if (Array.isArray(frame.landmarks) && frame.landmarks.length >= 21) {
      return {
        landmarks: frame.landmarks,
        handedness: frame.handedness || 'Right',
        timestampMs: ts,
      };
    }
  }

  return null;
}

/**
 * Extrae el arreglo de 21 landmarks de mano desde distintos formatos de entrada.
 */
export function extractHandFromFrame(frame) {
  const meta = extractHandWithMeta(frame);
  return meta ? meta.landmarks : null;
}

/**
 * Clasifica un único frame de 21 landmarks de mano evaluando las señas estáticas del catálogo declarativo.
 *
 * @param {Array<{x:number, y:number, z?:number}>|Object} frameOrLandmarks
 * @param {Object} [options]
 * @returns {{ label: string|null, category: string|null, confidence: number, states: Object|null, reason: string, details: Object }}
 */
export function classifyStaticHand(frameOrLandmarks, options = {}) {
  const meta = extractHandWithMeta(frameOrLandmarks);
  if (!meta || !isValidHandLandmarks(meta.landmarks)) {
    return {
      label: null,
      category: null,
      confidence: 0,
      states: null,
      reason: 'INVALID_OR_NOISY_LANDMARKS',
      details: { reason: 'INVALID_OR_NOISY_LANDMARKS', states: null },
    };
  }

  const states = fingerStates(meta.landmarks, { handedness: meta.handedness });
  if (!states) {
    return {
      label: null,
      category: null,
      confidence: 0,
      states: null,
      reason: 'DEGENERATE_HAND_GEOMETRY',
      details: { reason: 'DEGENERATE_HAND_GEOMETRY', states: null },
    };
  }

  const staticCatalog = (options.catalog || getSignCatalog()).filter(
    (s) => s.tipo === SIGN_TYPES.ESTATICA
  );

  const matched = matchCatalog(staticCatalog, states, null, options);

  return {
    label: matched.label,
    category: matched.category,
    confidence: matched.confidence,
    states,
    reason: matched.details?.reason || 'LOW_CONFIDENCE',
    details: matched.details,
  };
}

/**
 * Detecta oscilación lateral (saludo "Hola") sobre una ventana temporal de frames.
 * Analiza los cambios de dirección en el desplazamiento de la muñeca relativizados a `palmScale`.
 *
 * @param {Array<Array<{x:number,y:number,z?:number}>>} handFrames
 * @returns {{ isWaving: boolean, directionChanges: number, totalAmplitude: number }}
 */
export function detectWaveMotion(handFrames) {
  if (!Array.isArray(handFrames) || handFrames.length < 5) {
    return { isWaving: false, directionChanges: 0, totalAmplitude: 0 };
  }

  const validWrists = [];
  let scaleSum = 0;

  for (const item of handFrames) {
    const lm = Array.isArray(item) ? item : extractHandFromFrame(item);
    if (lm && isValidHandLandmarks(lm)) {
      const s = palmScale(lm);
      validWrists.push(lm[HAND_LANDMARKS.WRIST].x);
      scaleSum += s;
    }
  }

  if (validWrists.length < 5) {
    return { isWaving: false, directionChanges: 0, totalAmplitude: 0 };
  }

  const avgScale = scaleSum / validWrists.length;
  const minHalfAmp = 0.12 * avgScale;
  const noiseThreshold = 0.015 * avgScale;

  let currentDir = 0;
  const extremes = [validWrists[0]];

  for (let i = 0; i < validWrists.length - 1; i++) {
    const diff = validWrists[i + 1] - validWrists[i];
    if (Math.abs(diff) < noiseThreshold) continue;
    const newDir = diff > 0 ? 1 : -1;
    if (currentDir !== 0 && newDir !== currentDir) {
      extremes.push(validWrists[i]);
    }
    currentDir = newDir;
  }
  extremes.push(validWrists[validWrists.length - 1]);

  let validChanges = 0;
  let totalAmplitude = 0;
  let lastVal = extremes[0];

  for (let i = 1; i < extremes.length; i++) {
    const amp = Math.abs(extremes[i] - lastVal);
    if (amp >= minHalfAmp) {
      validChanges++;
      totalAmplitude += amp / avgScale;
      lastVal = extremes[i];
    }
  }

  return {
    isWaving: validChanges >= 2,
    directionChanges: validChanges,
    totalAmplitude: Number(totalAmplitude.toFixed(4)),
  };
}

/**
 * Suavizador temporal por votación de mayoría sobre los últimos N frames.
 */
export class SmoothingVoter {
  /**
   * @param {number} windowSize Tamaño de la ventana de votación (por defecto 5)
   * @param {number} minVotes Mínimo de votos para confirmar una etiqueta (por defecto ceil(windowSize / 2))
   */
  constructor(windowSize = 5, minVotes = Math.ceil(windowSize / 2)) {
    this.windowSize = Math.max(1, windowSize);
    this.minVotes = Math.max(1, Math.min(this.windowSize, minVotes));
    this.history = [];
  }

  /**
   * Registra una nueva predicción `{ label, category, confidence }` y devuelve el consenso suavizado.
   * @param {{ label: string|null, category?: string|null, confidence: number }} prediction
   */
  push(prediction) {
    this.history.push({
      label: prediction?.label ?? null,
      category: prediction?.category ?? null,
      confidence: prediction?.confidence ?? 0,
    });
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    const counts = new Map();
    const confSums = new Map();
    const categories = new Map();

    for (const item of this.history) {
      if (!item.label) continue;
      counts.set(item.label, (counts.get(item.label) || 0) + 1);
      confSums.set(item.label, (confSums.get(item.label) || 0) + item.confidence);
      if (item.category) {
        categories.set(item.label, item.category);
      }
    }

    let bestLabel = null;
    let bestCount = 0;

    for (const [label, count] of counts.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestLabel = label;
      }
    }

    if (bestLabel && bestCount >= this.minVotes) {
      const avgConf = confSums.get(bestLabel) / bestCount;
      return {
        label: bestLabel,
        category: categories.get(bestLabel) || null,
        confidence: Number(avgConf.toFixed(4)),
        votes: bestCount,
        windowSize: this.history.length,
      };
    }

    return {
      label: null,
      category: null,
      confidence: 0,
      votes: bestCount,
      windowSize: this.history.length,
    };
  }

  reset() {
    this.history = [];
  }
}

/**
 * Interfaz base Classifier.
 * Permite intercambiar `GeometricClassifier` hoy por `ModelClassifier` después sin tocar `engine/` ni `ui/`.
 */
export class Classifier {
  /**
   * @param {Array<any>|any} _frames Secuencia de frames o un frame individual
   * @returns {{ label: string|null, category?: string|null, confidence: number, details?: Object }}
   */
  predict(_frames) {
    throw new Error('Classifier.predict(frames) debe ser implementado por la subclase');
  }

  reset() {}
}

/**
 * Implementación geométrica declarativa en navegador.
 * Soporta tanto predicción directa sobre un lote de frames `predict(frames)`
 * como acumulación progresiva frame a frame con ventana temporal en milisegundos y suavizado por votación.
 */
export class GeometricClassifier extends Classifier {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowMs=750] Ventana temporal en milisegundos para señas dinámicas (15–30 FPS)
   * @param {number} [options.bufferSize=30] Límite máximo de muestras en el buffer temporal
   * @param {number} [options.smoothingWindow=5] Ventana de frames para suavizado por votación
   * @param {number} [options.minVotes=3] Votos mínimos para emitir etiqueta suavizada
   * @param {number} [options.minConfidence=0.72] Umbral mínimo de confianza para no rechazar
   * @param {number} [options.minMargin=0.05] Margen mínimo sobre el segundo mejor candidato distinto
   * @param {'all'|'legacy'|'alphabet'|'numbers'} [options.mode='all'] Filtro de categoría del catálogo
   */
  constructor(options = {}) {
    super();
    this.windowMs = options.windowMs ?? 750;
    this.bufferSize = options.bufferSize ?? 30;
    this.minConfidence = options.minConfidence ?? 0.72;
    this.minMargin = options.minMargin ?? 0.05;
    this.mode = options.mode ?? 'all';
    this.assumedFps = options.assumedFps ?? 25;
    this.frameBuffer = [];
    this._seqCounter = 0;
    this.voter = new SmoothingVoter(
      options.smoothingWindow ?? 5,
      options.minVotes ?? Math.ceil((options.smoothingWindow ?? 5) / 2)
    );
  }

  setMode(mode) {
    this.mode = mode || 'all';
    this.voter.reset();
  }

  /**
   * Clasifica un frame individual o una lista de frames.
   *
   * @param {Array<any>|Object} framesInput
   * @returns {{ label: string|null, category: string|null, confidence: number, details: Object }}
   */
  predict(framesInput) {
    if (!framesInput) {
      return {
        label: null,
        category: null,
        confidence: 0,
        details: { reason: 'EMPTY_INPUT', states: null },
      };
    }

    const isSingleHandArray =
      Array.isArray(framesInput) &&
      framesInput.length === 21 &&
      framesInput[0] &&
      typeof framesInput[0].x === 'number';

    if (Array.isArray(framesInput) && !isSingleHandArray) {
      return this._predictBatch(framesInput);
    }

    // Modo frame individual con ventana temporal en milisegundos y votación
    const fallbackTs = this._seqCounter++ * (1000 / this.assumedFps);
    const meta = extractHandWithMeta(framesInput, fallbackTs);

    if (!meta || !isValidHandLandmarks(meta.landmarks)) {
      const voted = this.voter.push({ label: null, category: null, confidence: 0 });
      return {
        label: voted.label,
        category: voted.category,
        confidence: voted.confidence,
        details: {
          rawLabel: null,
          reason: 'INVALID_OR_NOISY_LANDMARKS',
          states: null,
          votes: voted.votes,
        },
      };
    }

    this.frameBuffer.push(meta);
    // Podar entradas fuera de la ventana temporal en ms o por tope de memoria
    const cutoffTs = meta.timestampMs - this.windowMs;
    while (
      this.frameBuffer.length > this.bufferSize ||
      (this.frameBuffer.length > 2 && this.frameBuffer[0].timestampMs < cutoffTs)
    ) {
      this.frameBuffer.shift();
    }

    const states = fingerStates(meta.landmarks, { handedness: meta.handedness });
    const trajContext = buildTrajectoryContext(this.frameBuffer, this.windowMs);
    const matched = matchCatalog(getSignCatalog(), states, trajContext, {
      minConfidence: this.minConfidence,
      minMargin: this.minMargin,
      mode: this.mode,
    });

    const voted = this.voter.push({
      label: matched.label,
      category: matched.category,
      confidence: matched.confidence,
    });

    const wave = detectWaveMotion(this.frameBuffer.map((f) => f.landmarks));

    return {
      label: voted.label,
      category: voted.category || matched.category,
      confidence: voted.confidence,
      details: {
        ...matched.details,
        rawLabel: matched.label,
        rawCategory: matched.category,
        rawConfidence: matched.confidence,
        smoothedLabel: voted.label,
        votes: voted.votes,
        reason: voted.label ? matched.details.reason : matched.details.reason || 'LOW_CONFIDENCE',
        states,
        wave,
        trajectory: trajContext,
      },
    };
  }

  /**
   * Evalúa un lote completo de frames de forma determinista y sin estado residual.
   */
  _predictBatch(frames) {
    if (frames.length === 0) {
      return {
        label: null,
        category: null,
        confidence: 0,
        details: { reason: 'EMPTY_BATCH', states: null },
      };
    }

    const stepMs = 1000 / this.assumedFps;
    const validMetas = [];
    const batchVoter = new SmoothingVoter(
      frames.length,
      Math.max(1, Math.ceil(frames.length * 0.5))
    );
    let lastValidStates = null;
    let lastStaticMatch = null;
    const catalog = getSignCatalog();
    const staticCatalog = catalog.filter((s) => s.tipo === SIGN_TYPES.ESTATICA);
    const dynamicCatalog = catalog.filter((s) => s.tipo === SIGN_TYPES.DINAMICA);

    for (let i = 0; i < frames.length; i++) {
      const meta = extractHandWithMeta(frames[i], i * stepMs);
      if (meta && isValidHandLandmarks(meta.landmarks)) {
        validMetas.push(meta);
        const st = fingerStates(meta.landmarks, { handedness: meta.handedness });
        lastValidStates = st;
        const m = matchCatalog(staticCatalog, st, null, {
          minConfidence: this.minConfidence,
          minMargin: this.minMargin,
          mode: this.mode,
        });
        lastStaticMatch = m;
        batchVoter.push({
          label: m.label,
          category: m.category,
          confidence: m.confidence,
        });
      } else {
        batchVoter.push({ label: null, category: null, confidence: 0 });
      }
    }

    if (validMetas.length === 0 || !lastValidStates) {
      return {
        label: null,
        category: null,
        confidence: 0,
        details: { reason: 'INVALID_OR_NOISY_LANDMARKS', states: null },
      };
    }

    const trajContext = buildTrajectoryContext(validMetas, Math.max(this.windowMs, frames.length * stepMs));
    const wave = detectWaveMotion(validMetas.map((m) => m.landmarks));

    // Evaluar primero si la secuencia completa activa una seña dinámica sobre el estado representativo
    const representativeMeta = validMetas[Math.floor(validMetas.length / 2)];
    const repStates = fingerStates(representativeMeta.landmarks, {
      handedness: representativeMeta.handedness,
    });
    const dynamicMatch = matchCatalog(dynamicCatalog, repStates, trajContext, {
      minConfidence: this.minConfidence,
      minMargin: this.minMargin,
      mode: this.mode,
    });

    if (dynamicMatch.label && validMetas.length >= Math.max(3, Math.ceil(frames.length * 0.5))) {
      return {
        label: dynamicMatch.label,
        category: dynamicMatch.category,
        confidence: dynamicMatch.confidence,
        details: {
          ...dynamicMatch.details,
          states: repStates,
          votes: validMetas.length,
          totalFrames: frames.length,
          wave,
          trajectory: trajContext,
        },
      };
    }

    // Consenso estático sobre el lote
    const consensus = batchVoter.history.reduce(
      (acc, cur) => {
        if (cur.label) {
          acc.counts[cur.label] = (acc.counts[cur.label] || 0) + 1;
          acc.conf[cur.label] = (acc.conf[cur.label] || 0) + cur.confidence;
          acc.cat[cur.label] = cur.category;
        }
        return acc;
      },
      { counts: {}, conf: {}, cat: {} }
    );

    let bestLabel = null;
    let bestCount = 0;
    for (const [lbl, cnt] of Object.entries(consensus.counts)) {
      if (cnt > bestCount) {
        bestCount = cnt;
        bestLabel = lbl;
      }
    }

    const minRequired = Math.max(1, Math.ceil(frames.length * 0.5));
    if (!bestLabel || bestCount < minRequired) {
      return {
        label: null,
        category: null,
        confidence: lastStaticMatch?.confidence ?? 0,
        details: {
          ...(lastStaticMatch?.details || {}),
          reason:
            validMetas.length < minRequired
              ? 'NO_CONSENSUS_OR_NOISY_BATCH'
              : 'LOW_CONFIDENCE',
          states: lastValidStates,
          wave,
          trajectory: trajContext,
        },
      };
    }

    const finalConf = Number((consensus.conf[bestLabel] / bestCount).toFixed(4));
    const finalCategory = consensus.cat[bestLabel] || null;

    return {
      label: bestLabel,
      category: finalCategory,
      confidence: finalConf,
      details: {
        ...(lastStaticMatch?.details || {}),
        category: finalCategory,
        states: lastValidStates,
        votes: bestCount,
        totalFrames: frames.length,
        wave,
        trajectory: trajContext,
      },
    };
  }

  reset() {
    this.frameBuffer = [];
    this._seqCounter = 0;
    this.voter.reset();
  }
}

/**
 * Punto de enchufe para el futuro clasificador con modelo neuronal entrenado (ONNX / WebSocket).
 * Cumple la misma interfaz `Classifier { predict(frames) -> { label, confidence } }`.
 */
export class ModelClassifier extends Classifier {
  constructor(inferFn = null) {
    super();
    this.inferFn = inferFn;
  }

  predict(frames) {
    if (typeof this.inferFn === 'function') {
      return this.inferFn(frames);
    }
    return {
      label: null,
      category: null,
      confidence: 0,
      details: { reason: 'MODEL_NOT_LOADED' },
    };
  }
}

/**
 * Función de conveniencia `classify(framesOrLandmarks, options)` para uso funcional directo.
 */
export function classify(framesOrLandmarks, options = {}) {
  const isSingleHand =
    Array.isArray(framesOrLandmarks) &&
    framesOrLandmarks.length === 21 &&
    framesOrLandmarks[0] &&
    typeof framesOrLandmarks[0].x === 'number';

  if (
    isSingleHand ||
    (!Array.isArray(framesOrLandmarks) && typeof framesOrLandmarks === 'object' && framesOrLandmarks !== null)
  ) {
    const res = classifyStaticHand(framesOrLandmarks, options);
    return {
      label: res.label,
      category: res.category,
      confidence: res.confidence,
      details: res.details,
    };
  }

  const clf = new GeometricClassifier(options);
  return clf.predict(framesOrLandmarks);
}
