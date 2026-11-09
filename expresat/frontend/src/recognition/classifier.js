/**
 * src/recognition/classifier.js — Clasificador geométrico puro e interfaz Classifier
 *
 * Define la interfaz base `Classifier { predict(frames) -> { label, confidence, details } }`
 * con la implementación `GeometricClassifier` hoy (100% en navegador, sin modelo entrenado)
 * y el adaptador `ModelClassifier` listo para enchufar el modelo neuronal ONNX/GRU después.
 */

import {
  HAND_LANDMARKS,
  isValidHandLandmarks,
  fingerStates,
  palmScale,
} from './geometry.js';

/**
 * Etiquetas canónicas reconocidas por el clasificador geométrico.
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
 * Extrae el arreglo de 21 landmarks de mano desde distintos formatos de entrada:
 * - Un arreglo directo de 21 puntos `[{x,y,z}, ...]`
 * - Un objeto frame `{ rightHand, leftHand, hands }`
 */
export function extractHandFromFrame(frame) {
  if (!frame) return null;
  if (Array.isArray(frame)) {
    return frame.length >= 21 ? frame : null;
  }
  if (typeof frame === 'object') {
    if (Array.isArray(frame.rightHand) && frame.rightHand.length >= 21) {
      return frame.rightHand;
    }
    if (Array.isArray(frame.leftHand) && frame.leftHand.length >= 21) {
      return frame.leftHand;
    }
    if (Array.isArray(frame.hands) && frame.hands.length > 0 && Array.isArray(frame.hands[0])) {
      return frame.hands[0].length >= 21 ? frame.hands[0] : null;
    }
    if (Array.isArray(frame.landmarks) && frame.landmarks.length >= 21) {
      return frame.landmarks;
    }
  }
  return null;
}

/**
 * Clasifica un único frame de 21 landmarks de mano en un gesto estático.
 * Función pura e invariante a traslación, escala y rotación en el plano XY.
 *
 * @param {Array<{x:number, y:number, z?:number}>|Object} frameOrLandmarks
 * @returns {{ label: string|null, confidence: number, states: Object|null, reason: string }}
 */
export function classifyStaticHand(frameOrLandmarks) {
  const landmarks = extractHandFromFrame(frameOrLandmarks);
  if (!landmarks || !isValidHandLandmarks(landmarks)) {
    return {
      label: null,
      confidence: 0,
      states: null,
      reason: 'INVALID_OR_NOISY_LANDMARKS',
    };
  }

  const states = fingerStates(landmarks);
  if (!states) {
    return {
      label: null,
      confidence: 0,
      states: null,
      reason: 'DEGENERATE_HAND_GEOMETRY',
    };
  }

  const {
    thumb,
    index,
    middle,
    ring,
    pinky,
    isPinching,
    thumbIndexTipDist,
    thumbIndexAngleDeg,
    indexMiddleSpread,
  } = states;

  // 1. OK / Pinza: Puntas de pulgar e índice unidas (< 0.36 * palmScale)
  // Puede hacerse con los otros 3 dedos extendidos (gesto OK clásico) o con los otros 3 doblados (pinza fina)
  if (isPinching && (!index || middle)) {
    const tightness = Math.max(0, Math.min(1, 1 - thumbIndexTipDist / 0.45));
    const bonus = middle && ring && pinky ? 0.06 : 0.0;
    const confidence = Number(Math.min(0.98, 0.85 + tightness * 0.1 + bonus).toFixed(4));
    return {
      label: SIGN_LABELS.OK,
      confidence,
      states,
      reason: 'Pulgar e índice formando pinza/círculo OK',
    };
  }

  // 2. Mano Abierta: Los 5 dedos extendidos
  if (thumb && index && middle && ring && pinky) {
    return {
      label: SIGN_LABELS.MANO_ABIERTA,
      confidence: 0.96,
      states,
      reason: 'Cinco dedos extendidos',
    };
  }

  // 3. Puño: Los 5 dedos doblados
  if (!thumb && !index && !middle && !ring && !pinky) {
    return {
      label: SIGN_LABELS.PUNO,
      confidence: 0.95,
      states,
      reason: 'Cinco dedos cerrados en puño',
    };
  }

  // 4. Uno: Solo el dedo índice extendido
  if (!thumb && index && !middle && !ring && !pinky) {
    return {
      label: SIGN_LABELS.UNO,
      confidence: 0.95,
      states,
      reason: 'Solo dedo índice extendido',
    };
  }

  // 5. Dos: Dedos índice y medio extendidos, resto cerrado
  if (!thumb && index && middle && !ring && !pinky) {
    const conf = indexMiddleSpread > 0.2 ? 0.96 : 0.91;
    return {
      label: SIGN_LABELS.DOS,
      confidence: conf,
      states,
      reason: 'Dedos índice y medio extendidos',
    };
  }

  // 6. Te Quiero (ILY): Pulgar, índice y meñique extendidos, medio y anular cerrados
  if (thumb && index && !middle && !ring && pinky) {
    return {
      label: SIGN_LABELS.TE_QUIERO,
      confidence: 0.95,
      states,
      reason: 'Pulgar, índice y meñique extendidos (ILY)',
    };
  }

  // 7. Lunes (Letra L): Pulgar e índice extendidos formando ángulo (~45° a 135°)
  if (thumb && index && !middle && !ring && !pinky) {
    const conf = thumbIndexAngleDeg >= 45 && thumbIndexAngleDeg <= 135 ? 0.94 : 0.88;
    return {
      label: SIGN_LABELS.LUNES,
      confidence: conf,
      states,
      reason: 'Pulgar e índice extendidos en L',
    };
  }

  // 8. Bien (Pulgar extendido solo)
  if (thumb && !index && !middle && !ring && !pinky) {
    return {
      label: SIGN_LABELS.BIEN,
      confidence: 0.93,
      states,
      reason: 'Solo pulgar extendido',
    };
  }

  return {
    label: null,
    confidence: 0,
    states,
    reason: 'UNRECOGNIZED_CONFIGURATION',
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

  for (const lm of handFrames) {
    if (isValidHandLandmarks(lm)) {
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
   * Registra una nueva predicción `{ label, confidence }` y devuelve el consenso suavizado.
   * @param {{ label: string|null, confidence: number }} prediction
   */
  push(prediction) {
    this.history.push({
      label: prediction?.label ?? null,
      confidence: prediction?.confidence ?? 0,
    });
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    const counts = new Map();
    const confSums = new Map();

    for (const item of this.history) {
      if (!item.label) continue;
      counts.set(item.label, (counts.get(item.label) || 0) + 1);
      confSums.set(item.label, (confSums.get(item.label) || 0) + item.confidence);
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
        confidence: Number(avgConf.toFixed(4)),
        votes: bestCount,
        windowSize: this.history.length,
      };
    }

    return {
      label: null,
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
   * @returns {{ label: string|null, confidence: number, details?: Object }}
   */
  predict(_frames) {
    throw new Error('Classifier.predict(frames) debe ser implementado por la subclase');
  }

  reset() {}
}

/**
 * Implementación geométrica determinista en navegador.
 * Soporta tanto predicción directa sobre una ventana de frames `predict(frames)`
 * como acumulación progresiva frame a frame con buffer temporal interno y votación de N frames.
 */
export class GeometricClassifier extends Classifier {
  /**
   * @param {Object} [options]
   * @param {number} [options.bufferSize=15] Tamaño del buffer temporal para señas dinámicas
   * @param {number} [options.smoothingWindow=5] Ventana de frames para suavizado por votación
   * @param {number} [options.minVotes=3] Votos mínimos para emitir etiqueta suavizada
   */
  constructor(options = {}) {
    super();
    this.bufferSize = options.bufferSize ?? 15;
    this.frameBuffer = [];
    this.voter = new SmoothingVoter(
      options.smoothingWindow ?? 5,
      options.minVotes ?? Math.ceil((options.smoothingWindow ?? 5) / 2)
    );
  }

  /**
   * Clasifica un frame o una lista de frames.
   * - Si recibe un arreglo de frames (`[frame1, frame2, ...]`), evalúa los gestos sobre esa ventana
   *   aplicando votación sobre los frames del lote y detección de movimiento dinámico ("Hola").
   * - Si recibe un único frame (`{ rightHand, leftHand }` o `landmarks[21]`), lo añade al buffer
   *   temporal interno y aplica suavizado por votación.
   *
   * @param {Array<any>|Object} framesInput
   * @returns {{ label: string|null, confidence: number, details: Object }}
   */
  predict(framesInput) {
    if (!framesInput) {
      return {
        label: null,
        confidence: 0,
        details: { reason: 'EMPTY_INPUT', states: null },
      };
    }

    // Distinguir si `framesInput` es un único arreglo de 21 puntos (`[{x,y,z}, ...]`)
    // o una secuencia temporal de varios frames (`[frame1, frame2, ...]`).
    const isSingleHandArray =
      Array.isArray(framesInput) &&
      framesInput.length === 21 &&
      framesInput[0] &&
      typeof framesInput[0].x === 'number';

    if (Array.isArray(framesInput) && !isSingleHandArray) {
      return this._predictBatch(framesInput);
    }

    // Modo frame individual con buffer temporal y suavizado
    const hand = extractHandFromFrame(framesInput);
    if (!hand || !isValidHandLandmarks(hand)) {
      const voted = this.voter.push({ label: null, confidence: 0 });
      return {
        label: voted.label,
        confidence: voted.confidence,
        details: {
          rawLabel: null,
          reason: 'INVALID_OR_NOISY_LANDMARKS',
          states: null,
          votes: voted.votes,
        },
      };
    }

    this.frameBuffer.push(hand);
    if (this.frameBuffer.length > this.bufferSize) {
      this.frameBuffer.shift();
    }

    const staticRes = classifyStaticHand(hand);
    let rawLabel = staticRes.label;
    let rawConfidence = staticRes.confidence;
    let reason = staticRes.reason;

    // Si la mano está abierta y hay oscilación lateral en el buffer temporal -> "Hola"
    const wave = detectWaveMotion(this.frameBuffer);
    if (rawLabel === SIGN_LABELS.MANO_ABIERTA && wave.isWaving) {
      rawLabel = SIGN_LABELS.HOLA;
      rawConfidence = 0.97;
      reason = `Mano abierta con saludo dinámico (${wave.directionChanges} cambios de dirección)`;
    }

    const voted = this.voter.push({ label: rawLabel, confidence: rawConfidence });

    return {
      label: voted.label,
      confidence: voted.confidence,
      details: {
        rawLabel,
        rawConfidence,
        smoothedLabel: voted.label,
        votes: voted.votes,
        reason,
        states: staticRes.states,
        wave,
      },
    };
  }

  /**
   * Evalúa un lote completo de frames (p. ej. 5 a 15 frames) de forma determinista y sin estado residual.
   */
  _predictBatch(frames) {
    if (frames.length === 0) {
      return {
        label: null,
        confidence: 0,
        details: { reason: 'EMPTY_BATCH', states: null },
      };
    }

    const hands = [];
    const batchVoter = new SmoothingVoter(
      frames.length,
      Math.max(1, Math.ceil(frames.length * 0.5))
    );
    let lastValidStatic = null;

    for (const frame of frames) {
      const hand = extractHandFromFrame(frame);
      if (hand && isValidHandLandmarks(hand)) {
        hands.push(hand);
        const res = classifyStaticHand(hand);
        lastValidStatic = res;
        batchVoter.push({ label: res.label, confidence: res.confidence });
      } else {
        batchVoter.push({ label: null, confidence: 0 });
      }
    }

    if (hands.length === 0 || !lastValidStatic) {
      return {
        label: null,
        confidence: 0,
        details: { reason: 'INVALID_OR_NOISY_LANDMARKS', states: null },
      };
    }

    const wave = detectWaveMotion(hands);
    const consensus = batchVoter.history.reduce(
      (acc, cur) => {
        if (cur.label) {
          acc.counts[cur.label] = (acc.counts[cur.label] || 0) + 1;
          acc.conf[cur.label] = (acc.conf[cur.label] || 0) + cur.confidence;
        }
        return acc;
      },
      { counts: {}, conf: {} }
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
        confidence: 0,
        details: {
          reason: 'NO_CONSENSUS_OR_NOISY_BATCH',
          states: lastValidStatic.states,
          wave,
        },
      };
    }

    let finalLabel = bestLabel;
    let finalConf = Number((consensus.conf[bestLabel] / bestCount).toFixed(4));

    if (finalLabel === SIGN_LABELS.MANO_ABIERTA && wave.isWaving) {
      finalLabel = SIGN_LABELS.HOLA;
      finalConf = 0.97;
    }

    return {
      label: finalLabel,
      confidence: finalConf,
      details: {
        reason: lastValidStatic.reason,
        states: lastValidStatic.states,
        votes: bestCount,
        totalFrames: frames.length,
        wave,
      },
    };
  }

  reset() {
    this.frameBuffer = [];
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
      confidence: 0,
      details: { reason: 'MODEL_NOT_LOADED' },
    };
  }
}

/**
 * Función de conveniencia `classify(framesOrLandmarks)` para uso funcional directo.
 */
export function classify(framesOrLandmarks) {
  const isSingleHand =
    Array.isArray(framesOrLandmarks) &&
    framesOrLandmarks.length === 21 &&
    framesOrLandmarks[0] &&
    typeof framesOrLandmarks[0].x === 'number';

  if (isSingleHand || (!Array.isArray(framesOrLandmarks) && typeof framesOrLandmarks === 'object')) {
    const res = classifyStaticHand(framesOrLandmarks);
    return {
      label: res.label,
      confidence: res.confidence,
      details: { reason: res.reason, states: res.states },
    };
  }

  const clf = new GeometricClassifier();
  return clf.predict(framesOrLandmarks);
}
