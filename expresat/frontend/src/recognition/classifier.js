/**
 * Pure geometric classifier, canonical demo catalog, and Classifier interface.
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
  resolveAspectRatio,
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
 * Single source of truth for the verified geometric signs supported in local demo mode.
 * Consumed directly by `Translator.jsx` (Quick Guide + offline TTS) and `GeometricClassifier`.
 */
export const SIGN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'mano_abierta',
    label: SIGN_LABELS.MANO_ABIERTA,
    type: 'static',
    hint: '5 dedos extendidos',
    speakText: 'Mano abierta',
  }),
  Object.freeze({
    id: 'puno',
    label: SIGN_LABELS.PUNO,
    type: 'static',
    hint: 'Puño cerrado',
    speakText: 'Puño',
  }),
  Object.freeze({
    id: 'uno',
    label: SIGN_LABELS.UNO,
    type: 'static',
    hint: 'Solo índice',
    speakText: 'Uno',
  }),
  Object.freeze({
    id: 'dos',
    label: SIGN_LABELS.DOS,
    type: 'static',
    hint: 'Índice y medio',
    speakText: 'Dos',
  }),
  Object.freeze({
    id: 'ok',
    label: SIGN_LABELS.OK,
    type: 'static',
    hint: 'Círculo pulgar-índice y 3 dedos arriba',
    speakText: 'OK',
  }),
  Object.freeze({
    id: 'bien',
    label: SIGN_LABELS.BIEN,
    type: 'static',
    hint: 'Pulgar arriba',
    speakText: 'Bien',
  }),
  Object.freeze({
    id: 'te_quiero',
    label: SIGN_LABELS.TE_QUIERO,
    type: 'static',
    hint: 'Pulgar, índice y meñique',
    speakText: 'Te quiero',
  }),
  Object.freeze({
    id: 'lunes',
    label: SIGN_LABELS.LUNES,
    type: 'static',
    hint: 'Pulgar e índice en L',
    speakText: 'Lunes',
  }),
  Object.freeze({
    id: 'hola',
    label: SIGN_LABELS.HOLA,
    type: 'dynamic',
    hint: 'Saludo lateral con mano abierta',
    speakText: 'Hola',
  }),
]);

const CATALOG_BY_LABEL = new Map(SIGN_CATALOG.map((entry) => [entry.label, entry]));

/**
 * Looks up catalog metadata (id, type, hint, speakText) by canonical sign label.
 */
export function getSignCatalogEntry(label) {
  return CATALOG_BY_LABEL.get(label) || null;
}

export const DEFAULT_MIN_CONFIDENCE = 0.68;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scoreGeometricMargins(margins, shapeFactor = 1.0) {
  if (!Array.isArray(margins) || margins.length === 0) return 0;
  let minM = 1;
  let sumM = 0;
  for (let i = 0; i < margins.length; i++) {
    const m = clamp01(margins[i]);
    if (m < minM) minM = m;
    sumM += m;
  }
  const avgM = sumM / margins.length;
  const blended = 0.55 * minM + 0.45 * avgM;
  const base = 0.62 + 0.37 * blended;
  const shaped = base * (0.86 + 0.14 * clamp01(shapeFactor));
  return Number(Math.max(0, Math.min(0.99, shaped)).toFixed(4));
}

/**
 * Extracts all candidate 21-point hand landmark arrays with their v1.4.0 anatomical slot id.
 * Preserves symmetry between left and right hands so neither side is blindly discarded.
 *
 * @param {Array|Object} frame
 * @returns {Array<{ handId: string, landmarks: Array }>}
 */
export function extractHandsFromFrame(frame) {
  if (!frame) return [];
  if (Array.isArray(frame)) {
    return frame.length >= 21 ? [{ handId: 'hand_0', landmarks: frame }] : [];
  }
  if (typeof frame === 'object') {
    const out = [];
    if (Array.isArray(frame.rightHand) && frame.rightHand.length >= 21) {
      out.push({ handId: 'rightHand', landmarks: frame.rightHand });
    }
    if (Array.isArray(frame.leftHand) && frame.leftHand.length >= 21) {
      out.push({ handId: 'leftHand', landmarks: frame.leftHand });
    }
    if (out.length > 0) return out;

    if (Array.isArray(frame.hands) && frame.hands.length > 0) {
      for (let i = 0; i < frame.hands.length; i++) {
        const item = frame.hands[i];
        const lm = Array.isArray(item) ? item : item?.landmarks;
        if (Array.isArray(lm) && lm.length >= 21) {
          const cat =
            (!Array.isArray(item) && (item?.categoryName || item?.label)) ||
            frame.handedness?.[i]?.[0]?.categoryName ||
            frame.handedness?.[i]?.[0]?.label ||
            null;
          const handId =
            cat === 'Left' ? 'leftHand' : cat === 'Right' ? 'rightHand' : `hand_${i}`;
          out.push({ handId, landmarks: lm });
        }
      }
      if (out.length > 0) return out;
    }

    if (Array.isArray(frame.landmarks) && frame.landmarks.length >= 21) {
      return [{ handId: 'hand_0', landmarks: frame.landmarks }];
    }
  }
  return [];
}

/**
 * Extracts the primary 21-point hand landmark array from supported input formats.
 */
export function extractHandFromFrame(frame) {
  const candidates = extractHandsFromFrame(frame);
  return candidates.length > 0 ? candidates[0].landmarks : null;
}

/**
 * Classifies a single validated 21-point hand array into a static gesture with
 * continuous margin-based confidence and explicit ambiguity/low-confidence rejection.
 */
function classifySingleHandLandmarks(landmarks, { aspectRatio = 1.0, minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  if (!landmarks || !isValidHandLandmarks(landmarks, { aspectRatio })) {
    return {
      label: null,
      confidence: 0,
      states: null,
      reason: 'INVALID_OR_NOISY_LANDMARKS',
    };
  }

  const states = fingerStates(landmarks, { aspectRatio, _skipValidation: true });
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
    thumbUpScore,
    indexMiddleSpread,
    details,
  } = states;

  const tD = details.thumb;
  const iD = details.index;
  const mD = details.middle;
  const rD = details.ring;
  const pD = details.pinky;

  const finalize = (label, confidence, reason) => {
    if (confidence < minConfidence) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'LOW_CONFIDENCE_AMBIGUOUS',
      };
    }
    return { label, confidence, states, reason };
  };

  // 1. OK / Pinza: thumb and index tips joined (< 0.36 * palmScale), index NOT straight,
  // and remaining three fingers (middle, ring, pinky) clearly extended.
  // Disjoint from natural closed fists where middle/ring/pinky are curled.
  if (isPinching && !index && middle && ring && pinky) {
    const tightness = clamp01(1 - thumbIndexTipDist / 0.38);
    const confidence = scoreGeometricMargins(
      [tightness, mD.extensionMargin, rD.extensionMargin, pD.extensionMargin],
      0.5 + 0.5 * tightness
    );
    return finalize(
      SIGN_LABELS.OK,
      confidence,
      'Pulgar e índice en círculo OK con medio, anular y meñique extendidos'
    );
  }

  // 2. Open hand (Mano Abierta): all 5 fingers clearly extended
  if (thumb && index && middle && ring && pinky) {
    const confidence = scoreGeometricMargins([
      tD.extensionMargin,
      iD.extensionMargin,
      mD.extensionMargin,
      rD.extensionMargin,
      pD.extensionMargin,
    ]);
    return finalize(SIGN_LABELS.MANO_ABIERTA, confidence, 'Cinco dedos extendidos');
  }

  // 3. Fist (Puño): all 5 fingers explicitly curled (rejects relaxed / Letra C / Letra A postures)
  if (tD.curled && iD.curled && mD.curled && rD.curled && pD.curled) {
    const confidence = scoreGeometricMargins([
      tD.curlMargin,
      iD.curlMargin,
      mD.curlMargin,
      rD.curlMargin,
      pD.curlMargin,
    ]);
    return finalize(SIGN_LABELS.PUNO, confidence, 'Cinco dedos flexionados en puño');
  }

  // 4. One (Uno): index extended only, thumb and remaining fingers explicitly curled
  if (tD.curled && index && mD.curled && rD.curled && pD.curled) {
    const confidence = scoreGeometricMargins([
      tD.curlMargin,
      iD.extensionMargin,
      mD.curlMargin,
      rD.curlMargin,
      pD.curlMargin,
    ]);
    return finalize(SIGN_LABELS.UNO, confidence, 'Solo dedo índice extendido');
  }

  // 5. Two (Dos): index and middle extended, thumb/ring/pinky explicitly curled
  if (tD.curled && index && middle && rD.curled && pD.curled) {
    const spreadScore = clamp01((indexMiddleSpread - 0.1) / 0.25);
    const confidence = scoreGeometricMargins(
      [tD.curlMargin, iD.extensionMargin, mD.extensionMargin, rD.curlMargin, pD.curlMargin],
      0.55 + 0.45 * spreadScore
    );
    return finalize(SIGN_LABELS.DOS, confidence, 'Dedos índice y medio extendidos');
  }

  // 6. ILY (Te Quiero): thumb, index, and pinky extended; middle and ring explicitly curled
  if (thumb && index && mD.curled && rD.curled && pinky) {
    const confidence = scoreGeometricMargins([
      tD.extensionMargin,
      iD.extensionMargin,
      mD.curlMargin,
      rD.curlMargin,
      pD.extensionMargin,
    ]);
    return finalize(
      SIGN_LABELS.TE_QUIERO,
      confidence,
      'Pulgar, índice y meñique extendidos (ILY)'
    );
  }

  // 7. Lunes (letter L): thumb and index extended forming an explicit L angle [35°, 140°]
  if (thumb && index && mD.curled && rD.curled && pD.curled) {
    if (thumbIndexAngleDeg < 35 || thumbIndexAngleDeg > 140) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'AMBIGUOUS_THUMB_INDEX_ANGLE',
      };
    }
    // Peak shape factor around 65..105 deg; smooth taper near 35 deg and 140 deg
    const distFromIdeal = Math.abs(thumbIndexAngleDeg - 85);
    const angleFactor = clamp01(1 - Math.max(0, distFromIdeal - 20) / 45);
    const confidence = scoreGeometricMargins(
      [tD.extensionMargin, iD.extensionMargin, mD.curlMargin, rD.curlMargin, pD.curlMargin],
      0.5 + 0.5 * angleFactor
    );
    return finalize(SIGN_LABELS.LUNES, confidence, 'Pulgar e índice extendidos en L');
  }

  // 8. Good (Bien): extended thumb pointing upward/tilted (rejects thumbs-down), 4 long fingers curled
  if (thumb && iD.curled && mD.curled && rD.curled && pD.curled) {
    if (thumbUpScore < 0.05) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'THUMB_NOT_UPWARD',
      };
    }
    const upFactor = clamp01((thumbUpScore - 0.05) / 0.55);
    const confidence = scoreGeometricMargins(
      [tD.extensionMargin, iD.curlMargin, mD.curlMargin, rD.curlMargin, pD.curlMargin],
      0.5 + 0.5 * upFactor
    );
    return finalize(SIGN_LABELS.BIEN, confidence, 'Pulgar extendido hacia arriba');
  }

  const anyAmbiguous =
    tD.ambiguous || iD.ambiguous || mD.ambiguous || rD.ambiguous || pD.ambiguous;

  return {
    label: null,
    confidence: 0,
    states,
    reason: anyAmbiguous ? 'AMBIGUOUS_OR_REST_POSTURE' : 'UNRECOGNIZED_CONFIGURATION',
  };
}

/**
 * Classifies a single frame (one or two hands) into a static gesture.
 * When both hands are visible, evaluates both symmetrically under v1.4.0 direct slots
 * and prioritizes the hand actively forming a recognized sign (with optional sticky `preferredHandId`).
 *
 * @param {Array<{x:number, y:number, z?:number}>|Object} frameOrLandmarks
 * @param {Object} [options]
 * @param {number} [options.aspectRatio]
 * @param {number} [options.minConfidence]
 * @param {string|null} [options.preferredHandId]
 * @returns {{ label: string|null, confidence: number, states: Object|null, reason: string, handId?: string|null, landmarks?: Array|null }}
 */
export function classifyStaticHand(frameOrLandmarks, options = {}) {
  const aspectRatio =
    options.aspectRatio ??
    (frameOrLandmarks && !Array.isArray(frameOrLandmarks)
      ? resolveAspectRatio(frameOrLandmarks)
      : 1.0);
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const preferredHandId = options.preferredHandId ?? null;

  const candidates = extractHandsFromFrame(frameOrLandmarks);
  if (candidates.length === 0) {
    return {
      label: null,
      confidence: 0,
      states: null,
      reason: 'INVALID_OR_NOISY_LANDMARKS',
      handId: null,
      landmarks: null,
    };
  }

  if (candidates.length === 1) {
    const res = classifySingleHandLandmarks(candidates[0].landmarks, {
      aspectRatio,
      minConfidence,
    });
    return {
      ...res,
      handId: candidates[0].handId,
      landmarks: candidates[0].landmarks,
    };
  }

  // Evaluate both hands symmetrically; select recognized sign over resting/unrecognized hand,
  // preserving sticky continuity when both hands are active.
  const evaluated = candidates.map((cand) => ({
    ...cand,
    res: classifySingleHandLandmarks(cand.landmarks, { aspectRatio, minConfidence }),
  }));

  const recognized = evaluated.filter((item) => item.res.label !== null);
  let chosen = null;

  if (recognized.length === 1) {
    chosen = recognized[0];
  } else if (recognized.length > 1) {
    const sticky = preferredHandId
      ? recognized.find((item) => item.handId === preferredHandId)
      : null;
    if (sticky) {
      chosen = sticky;
    } else {
      // Pick the higher hand in signing space (smaller wrist.y), breaking ties by confidence
      recognized.sort((a, b) => {
        const ay = a.landmarks[HAND_LANDMARKS.WRIST]?.y ?? 1;
        const by = b.landmarks[HAND_LANDMARKS.WRIST]?.y ?? 1;
        if (Math.abs(ay - by) > 0.08) return ay - by;
        return b.res.confidence - a.res.confidence;
      });
      chosen = recognized[0];
    }
  } else {
    // Neither hand formed a recognized sign: prefer sticky hand if valid, else first valid hand
    const validOnes = evaluated.filter((item) => item.res.states !== null);
    const sticky = preferredHandId
      ? validOnes.find((item) => item.handId === preferredHandId)
      : null;
    chosen = sticky || validOnes[0] || evaluated[0];
  }

  return {
    ...chosen.res,
    handId: chosen.handId,
    landmarks: chosen.landmarks,
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
   * @param {number} [options.minConfidence=0.68] Minimum geometric-margin confidence to accept a sign
   */
  constructor(options = {}) {
    super();
    this.bufferSize = options.bufferSize ?? 15;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.frameBuffer = [];
    this.activeHandId = null;
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

    const isSingleHandArray =
      Array.isArray(framesInput) &&
      framesInput.length === 21 &&
      framesInput[0] &&
      typeof framesInput[0].x === 'number';

    if (Array.isArray(framesInput) && !isSingleHandArray) {
      return this._predictBatch(framesInput);
    }

    const staticRes = classifyStaticHand(framesInput, {
      minConfidence: this.minConfidence,
      preferredHandId: this.activeHandId,
    });
    const hand = staticRes.landmarks;

    if (!hand || !staticRes.states) {
      const voted = this.voter.push({ label: null, confidence: 0 });
      return {
        label: voted.label,
        confidence: voted.confidence,
        details: {
          rawLabel: null,
          reason: staticRes.reason || 'INVALID_OR_NOISY_LANDMARKS',
          states: null,
          handId: null,
          votes: voted.votes,
        },
      };
    }

    if (this.activeHandId && staticRes.handId && staticRes.handId !== this.activeHandId) {
      this.frameBuffer = [];
    }
    this.activeHandId = staticRes.handId;

    this.frameBuffer.push(hand);
    if (this.frameBuffer.length > this.bufferSize) {
      this.frameBuffer.shift();
    }

    let rawLabel = staticRes.label;
    let rawConfidence = staticRes.confidence;
    let reason = staticRes.reason;

    // Open hand plus lateral oscillation in the temporal buffer -> "Hola"
    const wave = detectWaveMotion(this.frameBuffer);
    if (rawLabel === SIGN_LABELS.MANO_ABIERTA && wave.isWaving) {
      const ampScore = clamp01((wave.totalAmplitude - 0.25) / 0.9);
      rawLabel = SIGN_LABELS.HOLA;
      rawConfidence = Number(
        Math.min(0.99, Math.max(rawConfidence, 0.84 + 0.14 * ampScore)).toFixed(4)
      );
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
        handId: staticRes.handId,
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
    let batchHandId = null;

    for (const frame of frames) {
      const res = classifyStaticHand(frame, {
        minConfidence: this.minConfidence,
        preferredHandId: batchHandId,
      });
      if (res.landmarks && res.states) {
        if (!batchHandId || res.handId === batchHandId) {
          batchHandId = res.handId;
          hands.push(res.landmarks);
        }
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
      const ampScore = clamp01((wave.totalAmplitude - 0.25) / 0.9);
      finalLabel = SIGN_LABELS.HOLA;
      finalConf = Number(Math.min(0.99, Math.max(finalConf, 0.84 + 0.14 * ampScore)).toFixed(4));
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
    this.activeHandId = null;
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
export function classify(framesOrLandmarks, options = {}) {
  const isSingleHand =
    Array.isArray(framesOrLandmarks) &&
    framesOrLandmarks.length === 21 &&
    framesOrLandmarks[0] &&
    typeof framesOrLandmarks[0].x === 'number';

  if (isSingleHand || (!Array.isArray(framesOrLandmarks) && typeof framesOrLandmarks === 'object')) {
    const res = classifyStaticHand(framesOrLandmarks, options);
    return {
      label: res.label,
      confidence: res.confidence,
      details: { reason: res.reason, states: res.states, handId: res.handId },
    };
  }

  const clf = new GeometricClassifier(options);
  return clf.predict(framesOrLandmarks);
}
