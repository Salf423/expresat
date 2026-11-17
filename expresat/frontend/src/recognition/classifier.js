/**
 * Pure geometric classifier and Classifier interface.
 *
 * Defines the base `Classifier { predict(frames) -> { label, confidence, details } }`
 * interface implemented by `GeometricClassifier` (in-browser, no trained model required)
 * and the `ModelClassifier` adapter for plugging in an ONNX/GRU neural model later.
 */

import {
  HAND_LANDMARKS,
  isValidHandLandmarks,
  fingerStates,
  palmScale,
} from './geometry.js';

/**
 * Canonical sign labels recognized by the geometric classifier.
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
 * Extracts the 21-point hand landmark array from supported input formats:
 * - A direct array of 21 points `[{x,y,z}, ...]`
 * - A frame object `{ rightHand, leftHand, hands }`
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
 * Classifies a single frame of 21 hand landmarks into a static gesture.
 * Pure function invariant to translation, scale, and XY-plane rotation.
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

  // 1. OK / Pinch: thumb and index tips joined (< 0.36 * palmScale), with remaining fingers open or curled
  // Allows either classic OK (other 3 fingers extended) or fine pinch (other 3 curled)
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

  // 2. Open hand: all 5 fingers extended
  if (thumb && index && middle && ring && pinky) {
    return {
      label: SIGN_LABELS.MANO_ABIERTA,
      confidence: 0.96,
      states,
      reason: 'Cinco dedos extendidos',
    };
  }

  // 3. Fist: all 5 fingers curled
  if (!thumb && !index && !middle && !ring && !pinky) {
    return {
      label: SIGN_LABELS.PUNO,
      confidence: 0.95,
      states,
      reason: 'Cinco dedos cerrados en puño',
    };
  }

  // 4. One: index finger extended only
  if (!thumb && index && !middle && !ring && !pinky) {
    return {
      label: SIGN_LABELS.UNO,
      confidence: 0.95,
      states,
      reason: 'Solo dedo índice extendido',
    };
  }

  // 5. Two: index and middle fingers extended, remaining fingers curled
  if (!thumb && index && middle && !ring && !pinky) {
    const conf = indexMiddleSpread > 0.2 ? 0.96 : 0.91;
    return {
      label: SIGN_LABELS.DOS,
      confidence: conf,
      states,
      reason: 'Dedos índice y medio extendidos',
    };
  }

  // 6. ILY (Te Quiero): thumb, index, and pinky extended; middle and ring curled
  if (thumb && index && !middle && !ring && pinky) {
    return {
      label: SIGN_LABELS.TE_QUIERO,
      confidence: 0.95,
      states,
      reason: 'Pulgar, índice y meñique extendidos (ILY)',
    };
  }

  // 7. Lunes (letter L): thumb and index extended forming ~45 to 135 deg angle
  if (thumb && index && !middle && !ring && !pinky) {
    const conf = thumbIndexAngleDeg >= 45 && thumbIndexAngleDeg <= 135 ? 0.94 : 0.88;
    return {
      label: SIGN_LABELS.LUNES,
      confidence: conf,
      states,
      reason: 'Pulgar e índice extendidos en L',
    };
  }

  // 8. Good (Bien): extended thumb alone
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
 * Detects lateral oscillation ("Hola" greeting wave) across a temporal frame window.
 * Counts horizontal wrist direction reversals normalized by `palmScale`.
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
 * Temporal majority-voting smoother across the last N frames.
 */
export class SmoothingVoter {
  /**
   * @param {number} windowSize Voting window size (default 5)
   * @param {number} minVotes Minimum votes required to confirm a label (default ceil(windowSize / 2))
   */
  constructor(windowSize = 5, minVotes = Math.ceil(windowSize / 2)) {
    this.windowSize = Math.max(1, windowSize);
    this.minVotes = Math.max(1, Math.min(this.windowSize, minVotes));
    this.history = [];
  }

  /**
   * Records a new `{ label, confidence }` prediction and returns the smoothed consensus.
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
 * Base Classifier interface.
 * Swapping `GeometricClassifier` for `ModelClassifier` leaves `engine/` and `ui/` untouched.
 */
export class Classifier {
  /**
   * @param {Array<any>|any} _frames Sequence of frames or a single frame
   * @returns {{ label: string|null, confidence: number, details?: Object }}
   */
  predict(_frames) {
    throw new Error('Classifier.predict(frames) debe ser implementado por la subclase');
  }

  reset() {}
}

/**
 * Deterministic in-browser geometric classifier.
 * Supports batch window prediction `predict(frames)` as well as progressive
 * frame-by-frame streaming with internal buffering and majority smoothing.
 */
export class GeometricClassifier extends Classifier {
  /**
   * @param {Object} [options]
   * @param {number} [options.bufferSize=15] Temporal buffer size for dynamic signs
   * @param {number} [options.smoothingWindow=5] Majority-voting window size
   * @param {number} [options.minVotes=3] Minimum votes required to emit a smoothed label
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
   * Classifies a single frame or a batch of frames.
   * - Given an array of frames (`[frame1, frame2, ...]`), evaluates gestures across the
   *   window using majority voting and dynamic motion detection ("Hola").
   * - Given a single frame (`{ rightHand, leftHand }` or `landmarks[21]`), appends it
   *   to the internal temporal buffer and applies majority smoothing.
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

    // Distinguish a single 21-point hand array (`[{x,y,z}, ...]`) from a batch of frames
    // o una secuencia temporal de varios frames (`[frame1, frame2, ...]`).
    const isSingleHandArray =
      Array.isArray(framesInput) &&
      framesInput.length === 21 &&
      framesInput[0] &&
      typeof framesInput[0].x === 'number';

    if (Array.isArray(framesInput) && !isSingleHandArray) {
      return this._predictBatch(framesInput);
    }

    // Single-frame mode with temporal buffer and smoothing
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

    // Open hand plus lateral oscillation in the temporal buffer -> "Hola"
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
   * Evaluates a complete batch of frames (e.g., 5 to 15 frames) deterministically without residual state.
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
 * Adapter stub for a future trained neural model classifier (ONNX / WebSocket).
 * Implements the same `Classifier { predict(frames) -> { label, confidence } }` interface.
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
 * Convenience wrapper `classify(framesOrLandmarks)` for stateless functional usage.
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
