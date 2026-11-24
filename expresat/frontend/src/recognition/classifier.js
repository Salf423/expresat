/**
 * Pure geometric classifier, canonical demo catalog, time-based smoothing/hysteresis,
 * dynamic wave detection, anti-repetition cooldown, and Classifier interface.
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
  computePalmNormal,
  computeSignedFrontZ,
  computeExtendedHandAnatomy,
} from './geometry.js';
import { SIGN_LABELS, SIGN_CATALOG } from './signCatalog.js';
import {
  CONTEXT_MODES,
  normalizeContextMode,
  getModeCatalog,
  getSignCatalogEntry,
} from './modeCatalog.js';
import {
  DEFAULT_MIN_SCORE_MARGIN,
  buildCompactMotionSample,
  computeContextMotionSummary,
  classifyModeCandidates,
} from './contextClassifier.js';

export { SIGN_LABELS, SIGN_CATALOG, CONTEXT_MODES, getModeCatalog, getSignCatalogEntry };

export const DEFAULT_MIN_CONFIDENCE = 0.68;

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function extractFrameTimestampMs(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const raw = frame.t_ms ?? frame.timestamp_ms ?? frame.timestamp;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
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
function classifySingleHandLandmarks(
  landmarks,
  { aspectRatio = 1.0, minConfidence = DEFAULT_MIN_CONFIDENCE, handId = null } = {}
) {
  if (!landmarks || !isValidHandLandmarks(landmarks, { aspectRatio })) {
    return {
      label: null,
      confidence: 0,
      states: null,
      reason: 'INVALID_OR_NOISY_LANDMARKS',
    };
  }

  const states = fingerStates(landmarks, { aspectRatio, handId, _skipValidation: true });
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
    thumbMiddleTipDist,
    thumbIndexAngleDeg,
    thumbUpScore,
    indexMiddleSpread,
    signedFrontZ,
    details,
  } = states;

  const tD = details.thumb;
  const iD = details.index;
  const mD = details.middle;
  const rD = details.ring;
  const pD = details.pinky;

  // Strict 0.20 orientation deadband separates palmar/side signs from dorsal LSM signs (6, 7, 9)
  const isFrontOrSide = signedFrontZ >= -0.15;
  const isBack = signedFrontZ <= -0.35;

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
  // Disjoint from natural closed fists and Cero where middle/ring/pinky are not extended.
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

  // 2. Zero (Cero / LSM 0-O): fingertips of index and middle arch high above MCPs to meet
  // the thumb tip in an open oval while none of the 4 long fingers are straight extended.
  // Disjoint from Puño (folded fingertips have tipToMcpRatio < 1.15 or pipAngle < 75° or no thumb contact).
  if (
    !index &&
    !middle &&
    !ring &&
    !pinky &&
    thumbIndexTipDist < 0.36 &&
    thumbMiddleTipDist < 0.42 &&
    iD.tipToMcpRatio >= 1.18 &&
    mD.tipToMcpRatio >= 1.18 &&
    iD.pipAngle >= 75 &&
    mD.pipAngle >= 75
  ) {
    const idxContact = clamp01(1 - thumbIndexTipDist / 0.38);
    const midContact = clamp01(1 - thumbMiddleTipDist / 0.44);
    const archMargin = Math.min(
      clamp01((iD.tipToMcpRatio - 1.16) / 0.16),
      clamp01((mD.tipToMcpRatio - 1.16) / 0.16)
    );
    const confidence = scoreGeometricMargins(
      [idxContact, midContact, archMargin, Math.max(rD.curlMargin, 0.55), Math.max(pD.curlMargin, 0.55)],
      0.5 + 0.5 * Math.min(idxContact, midContact)
    );
    return finalize(
      SIGN_LABELS.CERO,
      confidence,
      'Dedos arqueados en óvalo tocando el pulgar (Cero LSM)'
    );
  }

  // 3. Five / Open hand (Cinco): all 5 fingers clearly extended (static base for Hola and Diez)
  if (thumb && index && middle && ring && pinky) {
    const confidence = scoreGeometricMargins([
      tD.extensionMargin,
      iD.extensionMargin,
      mD.extensionMargin,
      rD.extensionMargin,
      pD.extensionMargin,
    ]);
    return finalize(SIGN_LABELS.CINCO, confidence, 'Cinco dedos extendidos (mano abierta)');
  }

  // 4. Fist (Puño): all 5 fingers explicitly curled (invariant to palmar/dorsal orientation;
  // rejects relaxed / Letra A postures)
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

  // 5. One (Uno): index extended only, thumb and remaining fingers explicitly curled
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

  // 6. Two (Dos): index and middle extended, thumb/ring/pinky explicitly curled
  if (tD.curled && index && middle && rD.curled && pD.curled) {
    const spreadScore = clamp01((indexMiddleSpread - 0.1) / 0.25);
    const confidence = scoreGeometricMargins(
      [tD.curlMargin, iD.extensionMargin, mD.extensionMargin, rD.curlMargin, pD.curlMargin],
      0.55 + 0.45 * spreadScore
    );
    return finalize(SIGN_LABELS.DOS, confidence, 'Dedos índice y medio extendidos');
  }

  // 7. Three (Tres LSM): index, middle, and ring extended; thumb and pinky explicitly curled
  if (tD.curled && index && middle && ring && pD.curled) {
    const confidence = scoreGeometricMargins([
      tD.curlMargin,
      iD.extensionMargin,
      mD.extensionMargin,
      rD.extensionMargin,
      pD.curlMargin,
    ]);
    return finalize(SIGN_LABELS.TRES, confidence, 'Dedos índice, medio y anular extendidos');
  }

  // 8. Four (Cuatro) vs Nine (Nueve LSM): 4 long fingers extended, thumb curled;
  // separated cleanly by palm orientation (FRONT/SIDE -> Cuatro, BACK -> Nueve)
  if (tD.curled && index && middle && ring && pinky) {
    if (!isFrontOrSide && !isBack) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'AMBIGUOUS_PALM_ORIENTATION',
      };
    }
    const orientFactor = isBack
      ? clamp01((-signedFrontZ - 0.35) / 0.45)
      : clamp01((signedFrontZ + 0.15) / 0.65);
    const confidence = scoreGeometricMargins(
      [
        tD.curlMargin,
        iD.extensionMargin,
        mD.extensionMargin,
        rD.extensionMargin,
        pD.extensionMargin,
      ],
      0.55 + 0.45 * orientFactor
    );
    return isBack
      ? finalize(
          SIGN_LABELS.NUEVE,
          confidence,
          'Cuatro dedos extendidos con dorso a la cámara (Nueve LSM)'
        )
      : finalize(
          SIGN_LABELS.CUATRO,
          confidence,
          'Cuatro dedos extendidos con palma al frente'
        );
  }

  // 9. Eight (Ocho LSM): thumb, index, and middle extended; ring and pinky explicitly curled
  if (thumb && index && middle && rD.curled && pD.curled) {
    const confidence = scoreGeometricMargins([
      tD.extensionMargin,
      iD.extensionMargin,
      mD.extensionMargin,
      rD.curlMargin,
      pD.curlMargin,
    ]);
    return finalize(
      SIGN_LABELS.OCHO,
      confidence,
      'Pulgar, índice y medio extendidos (Ocho LSM)'
    );
  }

  // 10. ILY (Te Quiero): thumb, index, and pinky extended; middle and ring explicitly curled
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

  // 11. Lunes (letter L, FRONT/SIDE) vs Seven (Siete LSM, BACK): thumb and index extended in L
  if (thumb && index && mD.curled && rD.curled && pD.curled) {
    if (!isFrontOrSide && !isBack) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'AMBIGUOUS_PALM_ORIENTATION',
      };
    }
    const minAngle = isBack ? 28 : 35;
    if (thumbIndexAngleDeg < minAngle || thumbIndexAngleDeg > 140) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'AMBIGUOUS_THUMB_INDEX_ANGLE',
      };
    }
    const distFromIdeal = Math.abs(thumbIndexAngleDeg - 85);
    const angleFactor = clamp01(1 - Math.max(0, distFromIdeal - 20) / 45);
    const orientFactor = isBack
      ? clamp01((-signedFrontZ - 0.35) / 0.45)
      : clamp01((signedFrontZ + 0.15) / 0.65);
    const confidence = scoreGeometricMargins(
      [tD.extensionMargin, iD.extensionMargin, mD.curlMargin, rD.curlMargin, pD.curlMargin],
      0.5 + 0.5 * Math.min(angleFactor, orientFactor)
    );
    return isBack
      ? finalize(
          SIGN_LABELS.SIETE,
          confidence,
          'Pulgar e índice en L con dorso a la cámara (Siete LSM)'
        )
      : finalize(SIGN_LABELS.LUNES, confidence, 'Pulgar e índice extendidos en L');
  }

  // 12. Good (Bien, FRONT/SIDE) vs Six (Seis LSM, BACK): thumb extended upward, 4 long fingers curled
  if (thumb && iD.curled && mD.curled && rD.curled && pD.curled) {
    if (thumbUpScore < 0.05) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'THUMB_NOT_UPWARD',
      };
    }
    if (!isFrontOrSide && !isBack) {
      return {
        label: null,
        confidence: 0,
        states,
        reason: 'AMBIGUOUS_PALM_ORIENTATION',
      };
    }
    const upFactor = clamp01((thumbUpScore - 0.05) / 0.55);
    const orientFactor = isBack
      ? clamp01((-signedFrontZ - 0.35) / 0.45)
      : clamp01((signedFrontZ + 0.15) / 0.65);
    const confidence = scoreGeometricMargins(
      [tD.extensionMargin, iD.curlMargin, mD.curlMargin, rD.curlMargin, pD.curlMargin],
      0.5 + 0.5 * Math.min(upFactor, orientFactor)
    );
    return isBack
      ? finalize(
          SIGN_LABELS.SEIS,
          confidence,
          'Pulgar extendido hacia arriba con dorso a la cámara (Seis LSM)'
        )
      : finalize(SIGN_LABELS.BIEN, confidence, 'Pulgar extendido hacia arriba');
  }

  // 13. Letter I (Letra I): pinky extended only; thumb, index, middle, and ring explicitly curled
  if (tD.curled && iD.curled && mD.curled && rD.curled && pinky) {
    const confidence = scoreGeometricMargins([
      tD.curlMargin,
      iD.curlMargin,
      mD.curlMargin,
      rD.curlMargin,
      pD.extensionMargin,
    ]);
    return finalize(SIGN_LABELS.LETRA_I, confidence, 'Solo dedo meñique extendido (Letra I)');
  }

  // 14. Letter Y (Letra Y): thumb and pinky extended; index, middle, and ring explicitly curled
  if (thumb && iD.curled && mD.curled && rD.curled && pinky) {
    const confidence = scoreGeometricMargins([
      tD.extensionMargin,
      iD.curlMargin,
      mD.curlMargin,
      rD.curlMargin,
      pD.extensionMargin,
    ]);
    return finalize(
      SIGN_LABELS.LETRA_Y,
      confidence,
      'Pulgar y meñique extendidos (Letra Y)'
    );
  }

  // 15. Horns (Cuernos): index and pinky extended; thumb, middle, and ring explicitly curled
  if (tD.curled && index && mD.curled && rD.curled && pinky) {
    const confidence = scoreGeometricMargins([
      tD.curlMargin,
      iD.extensionMargin,
      mD.curlMargin,
      rD.curlMargin,
      pD.extensionMargin,
    ]);
    return finalize(SIGN_LABELS.CUERNOS, confidence, 'Dedos índice y meñique extendidos');
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
      handId: candidates[0].handId,
    });
    return {
      ...res,
      handId: candidates[0].handId,
      landmarks: candidates[0].landmarks,
    };
  }

  const evaluated = candidates.map((cand) => ({
    ...cand,
    res: classifySingleHandLandmarks(cand.landmarks, {
      aspectRatio,
      minConfidence,
      handId: cand.handId,
    }),
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
      recognized.sort((a, b) => {
        const ay = a.landmarks[HAND_LANDMARKS.WRIST]?.y ?? 1;
        const by = b.landmarks[HAND_LANDMARKS.WRIST]?.y ?? 1;
        if (Math.abs(ay - by) > 0.08) return ay - by;
        return b.res.confidence - a.res.confidence;
      });
      chosen = recognized[0];
    }
  } else {
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
 * Detects genuine lateral oscillation ("Hola" greeting wave) across a time-bounded window.
 *
 * Uses a ZigZag hysteresis turning-point detector so behavior is strictly FPS-independent
 * (identical at 10, 15, and 30 FPS):
 * - Counts ONLY confirmed interior direction reversals of amplitude >= `minHalfAmpRatio * avgScale`
 *   (eliminating 1-reversal entry-overshoot false positives).
 * - Filters by `waveWindowMs` when timestamps (`tMs`) are present.
 * - Enforces recency (`maxIdleTailMs`) so holding the hand still clears "Hola" rapidly
 *   without a 1+ second "Zombie Hola" tail at low FPS.
 *
 * @param {Array<Array<{x:number,y:number,z?:number}>|{landmarks?:Array, wristX?:number, scale?:number, tMs?:number}>} handFrames
 * @param {Object} [options]
 * @param {number} [options.waveWindowMs=900]
 * @param {number} [options.minHalfAmpRatio=0.22]
 * @param {number} [options.minReversals=2]
 * @param {number} [options.maxIdleTailMs=280]
 * @param {number} [options.aspectRatio=1.0]
 * @returns {{ isWaving: boolean, directionChanges: number, totalAmplitude: number }}
 */
export function detectWaveMotion(handFrames, options = {}) {
  if (!Array.isArray(handFrames) || handFrames.length < 5) {
    return { isWaving: false, directionChanges: 0, totalAmplitude: 0 };
  }

  const waveWindowMs = options.waveWindowMs ?? 900;
  const minHalfAmpRatio = options.minHalfAmpRatio ?? 0.22;
  const minReversals = options.minReversals ?? 2;
  const maxIdleTailMs = options.maxIdleTailMs ?? 280;
  const aspectRatio = options.aspectRatio ?? 1.0;

  const samples = [];
  let hasTimestamps = false;

  for (let i = 0; i < handFrames.length; i++) {
    const entry = handFrames[i];
    if (!entry) continue;
    if (Array.isArray(entry)) {
      if (isValidHandLandmarks(entry, { aspectRatio })) {
        samples.push({
          x: entry[HAND_LANDMARKS.WRIST].x,
          scale: palmScale(entry, { aspectRatio }),
          tMs: null,
        });
      }
    } else if (typeof entry === 'object') {
      const tMs =
        typeof entry.tMs === 'number' && Number.isFinite(entry.tMs)
          ? entry.tMs
          : extractFrameTimestampMs(entry);
      if (tMs !== null) hasTimestamps = true;

      if (typeof entry.wristX === 'number' && typeof entry.scale === 'number' && entry.scale > 0) {
        samples.push({ x: entry.wristX, scale: entry.scale, tMs });
      } else if (Array.isArray(entry.landmarks)) {
        const entryAspect = entry.aspectRatio ?? aspectRatio;
        if (isValidHandLandmarks(entry.landmarks, { aspectRatio: entryAspect })) {
          samples.push({
            x: entry.landmarks[HAND_LANDMARKS.WRIST].x,
            scale: palmScale(entry.landmarks, { aspectRatio: entryAspect }),
            tMs,
          });
        }
      }
    }
  }

  if (samples.length < 5) {
    return { isWaving: false, directionChanges: 0, totalAmplitude: 0 };
  }

  let activeSamples = samples;
  if (hasTimestamps) {
    const latestT = samples[samples.length - 1].tMs;
    if (latestT !== null) {
      activeSamples = samples.filter((s) => s.tMs === null || latestT - s.tMs <= waveWindowMs);
    }
  }

  if (activeSamples.length < 5) {
    return { isWaving: false, directionChanges: 0, totalAmplitude: 0 };
  }

  let scaleSum = 0;
  for (let i = 0; i < activeSamples.length; i++) {
    scaleSum += activeSamples[i].scale;
  }
  const avgScale = scaleSum / activeSamples.length;
  if (!Number.isFinite(avgScale) || avgScale < 1e-6) {
    return { isWaving: false, directionChanges: 0, totalAmplitude: 0 };
  }

  const minHalfAmp = minHalfAmpRatio * avgScale;
  const motionEps = 0.06 * avgScale;

  // ZigZag interior turning-point extraction (strictly counts interior reversals >= minHalfAmp)
  let trend = 0;
  let anchorX = activeSamples[0].x;
  let extX = activeSamples[0].x;
  let extT = activeSamples[0].tMs;
  let lastMotionX = activeSamples[0].x;
  let lastMotionT = activeSamples[0].tMs;

  let reversals = 0;
  let totalAmplitude = 0;

  for (let i = 1; i < activeSamples.length; i++) {
    const { x, tMs } = activeSamples[i];

    if (Math.abs(x - lastMotionX) >= motionEps) {
      lastMotionX = x;
      lastMotionT = tMs;
    }

    if (trend === 0) {
      if (x - anchorX >= minHalfAmp) {
        trend = 1;
        extX = x;
        extT = tMs;
      } else if (anchorX - x >= minHalfAmp) {
        trend = -1;
        extX = x;
        extT = tMs;
      }
    } else if (trend === 1) {
      if (x > extX) {
        extX = x;
        extT = tMs;
      } else if (extX - x >= minHalfAmp) {
        // Confirmed interior peak at extX
        reversals++;
        totalAmplitude += Math.abs(extX - anchorX) / avgScale;
        anchorX = extX;
        trend = -1;
        extX = x;
        extT = tMs;
      }
    } else if (x < extX) {
      extX = x;
      extT = tMs;
    } else if (x - extX >= minHalfAmp) {
      // Confirmed interior trough at extX
      reversals++;
      totalAmplitude += Math.abs(anchorX - extX) / avgScale;
      anchorX = extX;
      trend = 1;
      extX = x;
      extT = tMs;
    }
  }

  // Include the active trailing leg amplitude once at least one reversal occurred
  if (reversals > 0 && Math.abs(extX - anchorX) >= minHalfAmp) {
    totalAmplitude += Math.abs(extX - anchorX) / avgScale;
  }

  let isRecent = true;
  if (hasTimestamps) {
    const latestT = activeSamples[activeSamples.length - 1].tMs;
    const refT = lastMotionT ?? extT;
    if (latestT !== null && refT !== null && latestT - refT > maxIdleTailMs) {
      isRecent = false;
    }
  }

  return {
    isWaving: isRecent && reversals >= minReversals,
    directionChanges: reversals,
    totalAmplitude: Number(totalAmplitude.toFixed(4)),
  };
}

/**
 * Detects axial wrist rotation (palmar FRONT <-> dorsal BACK) across a real-time `t_ms` window
 * for dynamic LSM "Diez" (10).
 *
 * Strictly FPS-independent across 10, 15, and 30 FPS:
 * - Requires the same open hand (`Cinco`) to visit both `signedFrontZ >= frontThreshold` (+0.35)
 *   and `signedFrontZ <= backThreshold` (-0.35) with total span >= `minSpan` (0.90) within `rotationWindowMs`.
 * - Enforces recency (`maxIdleTailMs`) so holding the palm still clears "Diez" rapidly back to "Cinco".
 *
 * @param {Array<Array<{x:number,y:number,z?:number}>|{signedFrontZ?:number, landmarks?:Array, handId?:string, aspectRatio?:number, tMs?:number}>} handFrames
 * @param {Object} [options]
 * @param {number} [options.rotationWindowMs=850]
 * @param {number} [options.frontThreshold=0.35]
 * @param {number} [options.backThreshold=-0.35]
 * @param {number} [options.minSpan=0.9]
 * @param {number} [options.minFlips=1]
 * @param {number} [options.maxIdleTailMs=360]
 * @param {number} [options.aspectRatio=1.0]
 * @returns {{ isRotating: boolean, flipCount: number, zSpan: number }}
 */
export function detectPalmRotation(handFrames, options = {}) {
  if (!Array.isArray(handFrames) || handFrames.length < 3) {
    return { isRotating: false, flipCount: 0, zSpan: 0 };
  }

  const rotationWindowMs = options.rotationWindowMs ?? 850;
  const frontThreshold = options.frontThreshold ?? 0.35;
  const backThreshold = options.backThreshold ?? -0.35;
  const minSpan = options.minSpan ?? 0.9;
  const minFlips = options.minFlips ?? 1;
  const maxIdleTailMs = options.maxIdleTailMs ?? 360;
  const aspectRatio = options.aspectRatio ?? 1.0;

  const samples = [];
  let hasTimestamps = false;

  for (let i = 0; i < handFrames.length; i++) {
    const entry = handFrames[i];
    if (!entry) continue;
    if (Array.isArray(entry)) {
      if (isValidHandLandmarks(entry, { aspectRatio })) {
        const normal = computePalmNormal(entry, { aspectRatio });
        samples.push({
          z: computeSignedFrontZ(normal, options.handId ?? null),
          tMs: null,
        });
      }
    } else if (typeof entry === 'object') {
      const tMs =
        typeof entry.tMs === 'number' && Number.isFinite(entry.tMs)
          ? entry.tMs
          : extractFrameTimestampMs(entry);
      if (tMs !== null) hasTimestamps = true;

      if (typeof entry.signedFrontZ === 'number' && Number.isFinite(entry.signedFrontZ)) {
        samples.push({ z: entry.signedFrontZ, tMs });
      } else if (Array.isArray(entry.landmarks)) {
        const entryAspect = entry.aspectRatio ?? aspectRatio;
        if (isValidHandLandmarks(entry.landmarks, { aspectRatio: entryAspect })) {
          const normal = computePalmNormal(entry.landmarks, { aspectRatio: entryAspect });
          samples.push({
            z: computeSignedFrontZ(normal, entry.handId ?? options.handId ?? null),
            tMs,
          });
        }
      }
    }
  }

  if (samples.length < 3) {
    return { isRotating: false, flipCount: 0, zSpan: 0 };
  }

  let activeSamples = samples;
  if (hasTimestamps) {
    const latestT = samples[samples.length - 1].tMs;
    if (latestT !== null) {
      activeSamples = samples.filter((s) => s.tMs === null || latestT - s.tMs <= rotationWindowMs);
    }
  }

  if (activeSamples.length < 3) {
    return { isRotating: false, flipCount: 0, zSpan: 0 };
  }

  let minZ = Infinity;
  let maxZ = -Infinity;
  let state = 0; // +1 = FRONT, -1 = BACK
  let flipCount = 0;
  let lastFlipT = null;

  for (let i = 0; i < activeSamples.length; i++) {
    const { z, tMs } = activeSamples[i];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;

    if (z >= frontThreshold) {
      if (state === -1) {
        flipCount++;
        lastFlipT = tMs;
      }
      state = 1;
    } else if (z <= backThreshold) {
      if (state === 1) {
        flipCount++;
        lastFlipT = tMs;
      }
      state = -1;
    }
  }

  const zSpan = Number(Math.max(0, maxZ - minZ).toFixed(4));
  let isRecent = true;
  if (hasTimestamps) {
    const latestT = activeSamples[activeSamples.length - 1].tMs;
    if (latestT !== null && lastFlipT !== null && latestT - lastFlipT > maxIdleTailMs) {
      isRecent = false;
    }
  }

  const isRotating =
    isRecent &&
    flipCount >= minFlips &&
    zSpan >= minSpan &&
    maxZ >= frontThreshold &&
    minZ <= backThreshold;

  return {
    isRotating,
    flipCount,
    zSpan,
  };
}

/**
 * Temporal majority-voting smoother with real-time `t_ms` windowing, minimum stability
 * duration (~250-350 ms), and entry/exit hysteresis.
 *
 * Supports both:
 * - Time-based mode (default whenever `timestampMs` is supplied): FPS-independent across 10/15/30 FPS.
 * - Legacy frame-count mode (`new SmoothingVoter(windowSize, minVotes)` without timestamps) for
 *   backward compatibility with stateless frame tests.
 */
export class SmoothingVoter {
  /**
   * @param {number|Object} [windowSizeOrOptions]
   * @param {number} [legacyMinVotes]
   */
  constructor(windowSizeOrOptions = {}, legacyMinVotes = undefined) {
    if (typeof windowSizeOrOptions === 'number') {
      this.windowSize = Math.max(1, windowSizeOrOptions);
      this.minVotes = Math.max(
        1,
        Math.min(this.windowSize, legacyMinVotes ?? Math.ceil(this.windowSize / 2))
      );
      this.windowMs = 450;
      this.minStableMs = 260;
      this.enterRatio = 0.55;
      this.exitRatio = 0.3;
      this.releaseMs = 360;
      this._legacyFrameDefaults = true;
    } else {
      const opts = windowSizeOrOptions || {};
      this.windowSize = Math.max(1, opts.windowSize ?? 5);
      this.minVotes = Math.max(1, opts.minVotes ?? 2);
      this.windowMs = Math.max(100, opts.windowMs ?? 450);
      this.minStableMs = Math.max(0, opts.minStableMs ?? 260);
      this.enterRatio = clamp01(opts.enterRatio ?? 0.55);
      this.exitRatio = clamp01(opts.exitRatio ?? 0.3);
      this.releaseMs = Math.max(100, opts.releaseMs ?? 360);
      this._legacyFrameDefaults = Boolean(opts.windowSize !== undefined && opts.windowMs === undefined);
    }

    this.history = [];
    this.confirmedLabel = null;
    this._candidateLabel = null;
    this._candidateSinceMs = null;
    this._lastConfirmedSeenMs = -Infinity;
    this._lastTimestampMs = null;
  }

  /**
   * Records a new `{ label, confidence }` prediction and returns the smoothed consensus.
   * When `timestampMs` (or `prediction.t_ms` / `prediction.timestamp`) is finite, operates
   * strictly in real milliseconds (`t_ms`) with entry/exit hysteresis.
   *
   * @param {{ label: string|null, confidence: number, t_ms?: number, timestamp?: number }} prediction
   * @param {number|null} [timestampMs]
   */
  push(prediction, timestampMs = null) {
    const resolvedTs =
      typeof timestampMs === 'number' && Number.isFinite(timestampMs)
        ? timestampMs
        : extractFrameTimestampMs(prediction);

    if (resolvedTs === null) {
      return this._pushFrameMode(prediction);
    }

    return this._pushTimeMode(prediction, resolvedTs);
  }

  _pushFrameMode(prediction) {
    this.history.push({
      label: prediction?.label ?? null,
      confidence: prediction?.confidence ?? 0,
      tMs: null,
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

    const requiredVotes = this._legacyFrameDefaults
      ? this.minVotes
      : Math.max(this.minVotes, Math.ceil(this.windowSize / 2));

    if (bestLabel && bestCount >= requiredVotes) {
      const avgConf = confSums.get(bestLabel) / bestCount;
      this.confirmedLabel = bestLabel;
      return {
        label: bestLabel,
        confidence: Number(avgConf.toFixed(4)),
        votes: bestCount,
        windowSize: this.history.length,
        stableMs: 0,
        stabilityProgress: 1,
        candidateLabel: bestLabel,
      };
    }

    this.confirmedLabel = null;
    return {
      label: null,
      confidence: 0,
      votes: bestCount,
      windowSize: this.history.length,
      stableMs: 0,
      stabilityProgress: bestLabel ? clamp01(bestCount / requiredVotes) : 0,
      candidateLabel: bestLabel,
    };
  }

  _pushTimeMode(prediction, tMs) {
    // Handle backward clock jump safely (e.g. test restart)
    if (this._lastTimestampMs !== null && tMs < this._lastTimestampMs) {
      this.reset();
    }
    this._lastTimestampMs = tMs;

    const label = prediction?.label ?? null;
    const confidence = prediction?.confidence ?? 0;

    this.history.push({ label, confidence, tMs });

    // Prune entries strictly older than `windowMs` (keep at least the newest sample)
    while (this.history.length > 1 && tMs - this.history[0].tMs > this.windowMs) {
      this.history.shift();
    }

    const counts = new Map();
    const confSums = new Map();
    const lastSeenByLabel = new Map();

    for (let i = 0; i < this.history.length; i++) {
      const item = this.history[i];
      if (!item.label) continue;
      counts.set(item.label, (counts.get(item.label) || 0) + 1);
      confSums.set(item.label, (confSums.get(item.label) || 0) + item.confidence);
      lastSeenByLabel.set(item.label, item.tMs);
    }

    const totalSamples = this.history.length;
    let bestLabel = null;
    let bestCount = 0;
    let bestAvgConf = 0;

    for (const [lbl, cnt] of counts.entries()) {
      const avg = confSums.get(lbl) / cnt;
      if (cnt > bestCount || (cnt === bestCount && avg > bestAvgConf)) {
        bestCount = cnt;
        bestLabel = lbl;
        bestAvgConf = avg;
      }
    }

    const bestRatio = totalSamples > 0 ? bestCount / totalSamples : 0;

    // Track continuous candidate stability duration in ms
    if (bestLabel && bestRatio >= this.enterRatio) {
      if (this._candidateLabel !== bestLabel) {
        this._candidateLabel = bestLabel;
        // Anchor candidate start to the earliest consecutive/recent sample of this label in the window
        let firstInWindow = tMs;
        for (let i = this.history.length - 1; i >= 0; i--) {
          if (this.history[i].label === bestLabel) {
            firstInWindow = this.history[i].tMs;
          } else if (this.history[i].label !== null) {
            break;
          }
        }
        this._candidateSinceMs = firstInWindow;
      }
    } else if (!bestLabel || bestRatio < this.exitRatio) {
      this._candidateLabel = null;
      this._candidateSinceMs = null;
    }

    const candidateStableMs =
      this._candidateLabel && this._candidateSinceMs !== null
        ? Math.max(0, tMs - this._candidateSinceMs)
        : 0;

    const bestMeetsEntry =
      Boolean(bestLabel) &&
      bestCount >= this.minVotes &&
      bestRatio >= this.enterRatio &&
      candidateStableMs >= this.minStableMs;

    if (this.confirmedLabel === null) {
      if (bestMeetsEntry) {
        this.confirmedLabel = bestLabel;
        this._lastConfirmedSeenMs = lastSeenByLabel.get(bestLabel) ?? tMs;
      }
    } else if (bestLabel && bestLabel !== this.confirmedLabel && bestMeetsEntry) {
      // Competing sign met full entry + stability threshold -> clean transition
      this.confirmedLabel = bestLabel;
      this._lastConfirmedSeenMs = lastSeenByLabel.get(bestLabel) ?? tMs;
    } else {
      // Hysteresis: maintain confirmed label while share stays >= exitRatio and recent
      const currCount = counts.get(this.confirmedLabel) || 0;
      const currRatio = totalSamples > 0 ? currCount / totalSamples : 0;
      if (currCount > 0) {
        const seenAt = lastSeenByLabel.get(this.confirmedLabel);
        if (seenAt !== undefined) {
          this._lastConfirmedSeenMs = seenAt;
        }
      }
      const sinceLastSeenMs = tMs - this._lastConfirmedSeenMs;
      if (currRatio < this.exitRatio || sinceLastSeenMs > this.releaseMs) {
        this.confirmedLabel = null;
      }
    }

    if (this.confirmedLabel) {
      const confCount = counts.get(this.confirmedLabel) || 0;
      const avgConf = confCount > 0 ? confSums.get(this.confirmedLabel) / confCount : bestAvgConf;
      return {
        label: this.confirmedLabel,
        confidence: Number(avgConf.toFixed(4)),
        votes: confCount,
        windowSize: totalSamples,
        stableMs: Math.round(candidateStableMs),
        stabilityProgress: 1,
        candidateLabel: this.confirmedLabel,
      };
    }

    return {
      label: null,
      confidence: 0,
      votes: bestCount,
      windowSize: totalSamples,
      stableMs: Math.round(candidateStableMs),
      stabilityProgress:
        this._candidateLabel && this.minStableMs > 0
          ? Number(clamp01(candidateStableMs / this.minStableMs).toFixed(2))
          : 0,
      candidateLabel: this._candidateLabel || bestLabel,
    };
  }

  reset() {
    this.history = [];
    this.confirmedLabel = null;
    this._candidateLabel = null;
    this._candidateSinceMs = null;
    this._lastConfirmedSeenMs = -Infinity;
    this._lastTimestampMs = null;
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
 * frame-by-frame streaming with real-time `t_ms` buffering, hysteresis smoothing,
 * and smart anti-repetition commitment cooldown.
 */
export class GeometricClassifier extends Classifier {
  /**
   * @param {Object} [options]
   * @param {number} [options.bufferSize=45] Maximum safety cap for temporal wave buffer
   * @param {number} [options.waveWindowMs=900] Temporal window in ms for wave motion detection
   * @param {number} [options.waveGapResetMs=250] Hand absence gap in ms that clears wave history
   * @param {number} [options.waveIdleTailMs=280] Stationary tail in ms that ends active wave state
   * @param {number} [options.windowMs=450] Voting window duration in ms
   * @param {number} [options.minStableMs=260] Minimum stability duration in ms to confirm a sign
   * @param {number} [options.enterRatio=0.55] Vote ratio required to enter a sign
   * @param {number} [options.exitRatio=0.30] Vote ratio below which a confirmed sign releases
   * @param {number} [options.releaseMs=360] Max silence duration in ms before releasing a sign
   * @param {number} [options.sameSignCooldownMs=1200] Minimum cooldown in ms to re-commit the same sign
   * @param {number} [options.switchCooldownMs=300] Minimum cooldown in ms between different signs
   * @param {number} [options.restResetMs=400] Minimum rest duration in ms required before repeating a sign
   * @param {number} [options.minConfidence=0.68] Minimum geometric-margin confidence to accept a sign
   * @param {number} [options.smoothingWindow] Legacy frame window size (used only when frames omit timestamps)
   * @param {number} [options.minVotes] Minimum vote count
   */
  constructor(options = {}) {
    super();
    this.mode = normalizeContextMode(options.mode ?? CONTEXT_MODES.GENERAL);
    this.bufferSize = Math.max(15, options.bufferSize ?? 45);
    this.modeMotionWindowMs = Math.max(1400, options.modeMotionWindowMs ?? 1500);
    this.modeBufferSize = Math.max(45, options.modeBufferSize ?? 64);
    this.waveWindowMs = options.waveWindowMs ?? 900;
    this.waveGapResetMs = options.waveGapResetMs ?? 250;
    this.waveIdleTailMs = options.waveIdleTailMs ?? 280;
    this.rotationWindowMs = options.rotationWindowMs ?? 850;
    this.rotationIdleTailMs = options.rotationIdleTailMs ?? 360;
    this.minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    this.minScoreMargin = options.minScoreMargin ?? DEFAULT_MIN_SCORE_MARGIN;

    this.sameSignCooldownMs = options.sameSignCooldownMs ?? 1200;
    this.switchCooldownMs = options.switchCooldownMs ?? 300;
    this.restResetMs = options.restResetMs ?? 400;

    this.frameBuffer = [];
    this._modeMotionByHand = new Map();
    this._modeLastHandMs = new Map();
    this.activeHandId = null;
    this._lastValidHandMs = null;

    // Smart commitment / anti-repetition cooldown state
    this._lastCommittedLabel = null;
    this._lastCommittedMs = -Infinity;
    this._activeHeldLabel = null;
    this._restStartMs = null;
    this._sawRestEnough = false;
    this._fallbackSeq = 0;

    this.voter = new SmoothingVoter({
      windowSize: options.smoothingWindow ?? 5,
      minVotes:
        options.minVotes ??
        (options.smoothingWindow !== undefined ? Math.ceil(options.smoothingWindow / 2) : 2),
      windowMs: options.windowMs ?? 450,
      minStableMs: options.minStableMs ?? 260,
      enterRatio: options.enterRatio ?? 0.55,
      exitRatio: options.exitRatio ?? 0.3,
      releaseMs: options.releaseMs ?? 360,
    });
  }

  /**
   * Returns the active recognition context mode (`'general' | 'alphabet' | 'numbers' | 'phrases'`).
   */
  getMode() {
    return this.mode;
  }

  /**
   * Switches recognition context mode in hot path without restarting the camera.
   * Cleanly resets `SmoothingVoter`, temporal motion buffers, and commitment state
   * whenever the mode changes so zero residual signs leak across modes.
   *
   * @param {'general'|'alphabet'|'numbers'|'phrases'} nextMode
   * @returns {string} Active normalized mode
   */
  setMode(nextMode) {
    const normalized = normalizeContextMode(nextMode);
    if (normalized !== this.mode) {
      this.mode = normalized;
      this.reset();
    }
    return this.mode;
  }

  /**
   * Classifies a single frame or a batch of frames.
   *
   * @param {Array<any>|Object} framesInput
   * @returns {{ label: string|null, confidence: number, committed: boolean, committedLabel: string|null, state: string, details: Object }}
   */
  predict(framesInput) {
    if (!framesInput) {
      return {
        label: null,
        confidence: 0,
        committed: false,
        committedLabel: null,
        state: 'idle',
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

    if (this.mode !== CONTEXT_MODES.GENERAL) {
      return this._predictInContextMode(framesInput);
    }

    const tMs = extractFrameTimestampMs(framesInput);
    const aspectRatio = !Array.isArray(framesInput) ? resolveAspectRatio(framesInput) : 1.0;

    const staticRes = classifyStaticHand(framesInput, {
      aspectRatio,
      minConfidence: this.minConfidence,
      preferredHandId: this.activeHandId,
    });
    const hand = staticRes.landmarks;

    if (!hand || !staticRes.states) {
      // Clear stale wave history once hand absence exceeds waveGapResetMs (eliminates Phantom Hola)
      if (
        tMs !== null &&
        this._lastValidHandMs !== null &&
        tMs - this._lastValidHandMs >= this.waveGapResetMs
      ) {
        this.frameBuffer = [];
        this.activeHandId = null;
      } else if (tMs === null) {
        this.frameBuffer = [];
        this.activeHandId = null;
      }

      const voted = this.voter.push({ label: null, confidence: 0 }, tMs);
      const commitInfo = this._updateCommitment(voted.label, tMs);

      return {
        label: voted.label,
        confidence: voted.confidence,
        committed: commitInfo.committed,
        committedLabel: commitInfo.committedLabel,
        state: voted.label ? 'confirmed' : 'idle',
        details: {
          rawLabel: null,
          reason: staticRes.reason || 'INVALID_OR_NOISY_LANDMARKS',
          states: null,
          handId: null,
          votes: voted.votes,
          stableMs: voted.stableMs,
          stabilityProgress: voted.stabilityProgress,
        },
      };
    }

    // Clear wave buffer when hand returns after absence gap or when switching left<->right hand
    const hadAbsenceGap =
      tMs !== null &&
      this._lastValidHandMs !== null &&
      tMs - this._lastValidHandMs >= this.waveGapResetMs;
    const switchedHand =
      this.activeHandId !== null &&
      staticRes.handId !== null &&
      staticRes.handId !== this.activeHandId;

    if (hadAbsenceGap || switchedHand) {
      this.frameBuffer = [];
    }

    this.activeHandId = staticRes.handId;
    if (tMs !== null) {
      this._lastValidHandMs = tMs;
    }

    // Record open-hand trajectory (for dynamic Hola lateral wave and Diez wrist flip)
    if (staticRes.label === SIGN_LABELS.CINCO) {
      this.frameBuffer.push({
        landmarks: hand,
        wristX: hand[HAND_LANDMARKS.WRIST].x,
        scale: staticRes.states.palmScale,
        signedFrontZ: staticRes.states.signedFrontZ,
        handId: staticRes.handId,
        aspectRatio,
        tMs,
      });
      const maxMotionWindowMs = Math.max(this.waveWindowMs, this.rotationWindowMs);
      if (tMs !== null) {
        while (
          this.frameBuffer.length > 1 &&
          this.frameBuffer[0].tMs !== null &&
          tMs - this.frameBuffer[0].tMs > maxMotionWindowMs
        ) {
          this.frameBuffer.shift();
        }
      }
      if (this.frameBuffer.length > this.bufferSize) {
        this.frameBuffer.shift();
      }
    } else if (staticRes.states.extendedCount <= 3) {
      // Hand is no longer open; discard prior dynamic trajectory
      this.frameBuffer = [];
    }

    let rawLabel = staticRes.label;
    let rawConfidence = staticRes.confidence;
    let reason = staticRes.reason;

    const wave = detectWaveMotion(this.frameBuffer, {
      waveWindowMs: this.waveWindowMs,
      maxIdleTailMs: this.waveIdleTailMs,
      aspectRatio,
    });

    const palmRotation = detectPalmRotation(this.frameBuffer, {
      rotationWindowMs: this.rotationWindowMs,
      maxIdleTailMs: this.rotationIdleTailMs,
      aspectRatio,
      handId: staticRes.handId,
    });

    if (rawLabel === SIGN_LABELS.CINCO && palmRotation.isRotating && !wave.isWaving) {
      const spanScore = clamp01((palmRotation.zSpan - 0.9) / 0.9);
      rawLabel = SIGN_LABELS.DIEZ;
      rawConfidence = Number(
        Math.min(0.99, Math.max(rawConfidence, 0.85 + 0.13 * spanScore)).toFixed(4)
      );
      reason = `Mano abierta (5) con giro de muñeca palma ↔ dorso (${palmRotation.flipCount} giro(s), Diez LSM)`;
    } else if (rawLabel === SIGN_LABELS.CINCO && wave.isWaving && !palmRotation.isRotating) {
      const ampScore = clamp01((wave.totalAmplitude - 0.35) / 1.0);
      rawLabel = SIGN_LABELS.HOLA;
      rawConfidence = Number(
        Math.min(0.99, Math.max(rawConfidence, 0.84 + 0.14 * ampScore)).toFixed(4)
      );
      reason = `Mano abierta con saludo dinámico (${wave.directionChanges} cambios de dirección)`;
    }

    const voted = this.voter.push({ label: rawLabel, confidence: rawConfidence }, tMs);
    const commitInfo = this._updateCommitment(voted.label, tMs);

    let state = 'rejected';
    if (voted.label) {
      state = 'confirmed';
    } else if (rawLabel || voted.candidateLabel) {
      state = 'detecting';
    }

    return {
      label: voted.label,
      confidence: voted.confidence,
      committed: commitInfo.committed,
      committedLabel: commitInfo.committedLabel,
      state,
      details: {
        mode: this.mode,
        rawLabel,
        rawConfidence,
        smoothedLabel: voted.label,
        handId: staticRes.handId,
        votes: voted.votes,
        stableMs: voted.stableMs,
        stabilityProgress: voted.stabilityProgress,
        reason,
        states: staticRes.states,
        wave,
        palmRotation,
      },
    };
  }

  /**
   * Single-pass (< 1 ms/frame) streaming classifier for `'alphabet'`, `'numbers'`, and `'phrases'`
   * modes with per-hand `t_ms` motion buffers and strict `top1 - top2` margin rejection.
   */
  _predictInContextMode(framesInput) {
    const tMs = extractFrameTimestampMs(framesInput);
    const aspectRatio = !Array.isArray(framesInput) ? resolveAspectRatio(framesInput) : 1.0;
    const rawCandidates = extractHandsFromFrame(framesInput);

    if (rawCandidates.length === 0) {
      if (
        tMs === null ||
        (this._lastValidHandMs !== null && tMs - this._lastValidHandMs >= this.waveGapResetMs)
      ) {
        this._modeMotionByHand.clear();
        this._modeLastHandMs.clear();
        this.activeHandId = null;
      }
      const voted = this.voter.push({ label: null, confidence: 0 }, tMs);
      const commitInfo = this._updateCommitment(voted.label, tMs);
      return {
        label: voted.label,
        confidence: voted.confidence,
        committed: commitInfo.committed,
        committedLabel: commitInfo.committedLabel,
        state: voted.label ? 'confirmed' : 'idle',
        details: {
          mode: this.mode,
          rawLabel: null,
          reason: 'INVALID_OR_NOISY_LANDMARKS',
          states: null,
          handId: null,
          votes: voted.votes,
          stableMs: voted.stableMs,
          stabilityProgress: voted.stabilityProgress,
        },
      };
    }

    // Compute 3D anatomy ONCE per visible hand and append compact scalar sample to its `t_ms` buffer
    const enrichedCandidates = [];
    const motionSummaries = new Map();

    for (let i = 0; i < rawCandidates.length; i++) {
      const cand = rawCandidates[i];
      const anatomy = computeExtendedHandAnatomy(cand.landmarks, {
        aspectRatio,
        handId: cand.handId,
      });

      if (anatomy) {
        const lastSeen = this._modeLastHandMs.get(cand.handId) ?? null;
        if (tMs !== null && lastSeen !== null && (tMs < lastSeen || tMs - lastSeen >= this.waveGapResetMs)) {
          this._modeMotionByHand.delete(cand.handId);
        }
        let buf = this._modeMotionByHand.get(cand.handId);
        if (!buf) {
          buf = [];
          this._modeMotionByHand.set(cand.handId, buf);
        }
        buf.push(
          buildCompactMotionSample(anatomy, {
            handId: cand.handId,
            aspectRatio,
            tMs,
          })
        );
        if (tMs !== null) {
          while (
            buf.length > 1 &&
            buf[0].tMs !== null &&
            tMs - buf[0].tMs > this.modeMotionWindowMs
          ) {
            buf.shift();
          }
          this._modeLastHandMs.set(cand.handId, tMs);
        }
        if (buf.length > this.modeBufferSize) {
          buf.shift();
        }
        motionSummaries.set(cand.handId, computeContextMotionSummary(buf));
      }

      enrichedCandidates.push({
        handId: cand.handId,
        landmarks: cand.landmarks,
        anatomy,
      });
    }

    const modeRes = classifyModeCandidates(enrichedCandidates, {
      mode: this.mode,
      aspectRatio,
      minConfidence: this.minConfidence,
      minScoreMargin: this.minScoreMargin,
      preferredHandId: this.activeHandId,
      getMotionSummaryForHand: (hid) => motionSummaries.get(hid) || null,
    });

    if (!modeRes.states) {
      if (
        tMs === null ||
        (this._lastValidHandMs !== null && tMs - this._lastValidHandMs >= this.waveGapResetMs)
      ) {
        this._modeMotionByHand.clear();
        this._modeLastHandMs.clear();
        this.activeHandId = null;
      }
      const voted = this.voter.push({ label: null, confidence: 0 }, tMs);
      const commitInfo = this._updateCommitment(voted.label, tMs);
      return {
        label: voted.label,
        confidence: voted.confidence,
        committed: commitInfo.committed,
        committedLabel: commitInfo.committedLabel,
        state: voted.label ? 'confirmed' : 'idle',
        details: {
          mode: this.mode,
          rawLabel: null,
          reason: modeRes.reason || 'INVALID_OR_NOISY_LANDMARKS',
          states: null,
          handId: null,
          votes: voted.votes,
          stableMs: voted.stableMs,
          stabilityProgress: voted.stabilityProgress,
        },
      };
    }

    this.activeHandId = modeRes.handId;
    if (tMs !== null) {
      this._lastValidHandMs = tMs;
    }

    const rawLabel = modeRes.label;
    const rawConfidence = modeRes.confidence;
    const voted = this.voter.push({ label: rawLabel, confidence: rawConfidence }, tMs);
    const commitInfo = this._updateCommitment(voted.label, tMs);

    let state = 'rejected';
    if (voted.label) {
      state = 'confirmed';
    } else if (rawLabel || voted.candidateLabel) {
      state = 'detecting';
    }

    return {
      label: voted.label,
      confidence: voted.confidence,
      committed: commitInfo.committed,
      committedLabel: commitInfo.committedLabel,
      state,
      details: {
        mode: this.mode,
        rawLabel,
        rawConfidence,
        smoothedLabel: voted.label,
        handId: modeRes.handId,
        votes: voted.votes,
        stableMs: voted.stableMs,
        stabilityProgress: voted.stabilityProgress,
        reason: modeRes.reason,
        scoreMargin: modeRes.scoreMargin ?? null,
        top1: modeRes.top1 ?? null,
        top2: modeRes.top2 ?? null,
        states: modeRes.states,
      },
    };
  }

  _updateCommitment(confirmedLabel, timestampMs) {
    const tMs =
      timestampMs !== null && Number.isFinite(timestampMs)
        ? timestampMs
        : ++this._fallbackSeq * 67;

    if (!confirmedLabel) {
      if (this._restStartMs === null) {
        this._restStartMs = tMs;
      }
      if (tMs - this._restStartMs >= this.restResetMs) {
        this._sawRestEnough = true;
        this._activeHeldLabel = null;
      }
      return { committed: false, committedLabel: null };
    }

    this._restStartMs = null;

    // Still holding the exact same sign continuously -> never re-commit
    if (confirmedLabel === this._activeHeldLabel) {
      return { committed: false, committedLabel: null };
    }

    const isSameAsLast = confirmedLabel === this._lastCommittedLabel;
    const elapsedSinceLast = tMs - this._lastCommittedMs;

    const canCommit = isSameAsLast
      ? this._sawRestEnough && elapsedSinceLast >= this.sameSignCooldownMs
      : elapsedSinceLast >= this.switchCooldownMs;

    if (!canCommit) {
      return { committed: false, committedLabel: null };
    }

    this._lastCommittedLabel = confirmedLabel;
    this._lastCommittedMs = tMs;
    this._activeHeldLabel = confirmedLabel;
    this._sawRestEnough = false;

    return { committed: true, committedLabel: confirmedLabel };
  }

  /**
   * Evaluates a complete batch of frames (e.g., 5 to 15 frames) deterministically without residual state.
   */
  _predictBatch(frames) {
    if (frames.length === 0) {
      return {
        label: null,
        confidence: 0,
        committed: false,
        committedLabel: null,
        state: 'idle',
        details: { mode: this.mode, reason: 'EMPTY_BATCH', states: null },
      };
    }

    if (this.mode !== CONTEXT_MODES.GENERAL) {
      const tempClf = new GeometricClassifier({
        mode: this.mode,
        minConfidence: this.minConfidence,
        minScoreMargin: this.minScoreMargin,
        smoothingWindow: frames.length,
        minVotes: Math.max(1, Math.ceil(frames.length * 0.45)),
        minStableMs: 0,
      });
      let lastRes = null;
      const counts = new Map();
      const confSums = new Map();
      for (let i = 0; i < frames.length; i++) {
        const res = tempClf._predictInContextMode(frames[i]);
        lastRes = res;
        const lbl = res.details?.rawLabel;
        if (lbl) {
          counts.set(lbl, (counts.get(lbl) || 0) + 1);
          confSums.set(lbl, (confSums.get(lbl) || 0) + (res.details?.rawConfidence ?? 0));
        }
      }
      // Prefer the final dynamic sign if the last frame confirmed a dynamic trajectory
      const lastRaw = lastRes?.details?.rawLabel || null;
      let bestLabel = lastRaw;
      let bestCount = lastRaw ? counts.get(lastRaw) || 1 : 0;
      if (!bestLabel) {
        for (const [lbl, cnt] of counts.entries()) {
          if (cnt > bestCount) {
            bestCount = cnt;
            bestLabel = lbl;
          }
        }
      }
      if (!bestLabel) {
        return {
          label: null,
          confidence: 0,
          committed: false,
          committedLabel: null,
          state: 'rejected',
          details: {
            mode: this.mode,
            reason: lastRes?.details?.reason || 'NO_MATCH_IN_MODE',
            states: lastRes?.details?.states || null,
          },
        };
      }
      const avgConf = Number(((confSums.get(bestLabel) || 0.8) / Math.max(1, bestCount)).toFixed(4));
      return {
        label: bestLabel,
        confidence: avgConf,
        committed: true,
        committedLabel: bestLabel,
        state: 'confirmed',
        details: {
          mode: this.mode,
          reason: lastRes?.details?.reason || `Modo ${this.mode}`,
          states: lastRes?.details?.states || null,
          votes: bestCount,
          totalFrames: frames.length,
        },
      };
    }

    const waveSamples = [];
    const batchVoter = new SmoothingVoter(
      frames.length,
      Math.max(1, Math.ceil(frames.length * 0.5))
    );
    let lastValidStatic = null;
    let batchHandId = null;

    for (const frame of frames) {
      const aspectRatio = !Array.isArray(frame) ? resolveAspectRatio(frame) : 1.0;
      const tMs = extractFrameTimestampMs(frame);
      const res = classifyStaticHand(frame, {
        aspectRatio,
        minConfidence: this.minConfidence,
        preferredHandId: batchHandId,
      });
      if (res.landmarks && res.states) {
        if (!batchHandId || res.handId === batchHandId) {
          batchHandId = res.handId;
          waveSamples.push({
            landmarks: res.landmarks,
            wristX: res.landmarks[HAND_LANDMARKS.WRIST].x,
            scale: res.states.palmScale,
            signedFrontZ: res.states.signedFrontZ,
            handId: res.handId,
            aspectRatio,
            tMs,
          });
        }
        lastValidStatic = res;
        batchVoter.push({ label: res.label, confidence: res.confidence });
      } else {
        batchVoter.push({ label: null, confidence: 0 });
      }
    }

    if (waveSamples.length === 0 || !lastValidStatic) {
      return {
        label: null,
        confidence: 0,
        committed: false,
        committedLabel: null,
        state: 'idle',
        details: { reason: 'INVALID_OR_NOISY_LANDMARKS', states: null },
      };
    }

    const wave = detectWaveMotion(waveSamples, {
      waveWindowMs: this.waveWindowMs,
      maxIdleTailMs: this.waveIdleTailMs,
    });
    const palmRotation = detectPalmRotation(waveSamples, {
      rotationWindowMs: this.rotationWindowMs,
      maxIdleTailMs: this.rotationIdleTailMs,
      handId: batchHandId,
    });
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
        committed: false,
        committedLabel: null,
        state: 'rejected',
        details: {
          reason: 'NO_CONSENSUS_OR_NOISY_BATCH',
          states: lastValidStatic.states,
          wave,
          palmRotation,
        },
      };
    }

    let finalLabel = bestLabel;
    let finalConf = Number((consensus.conf[bestLabel] / bestCount).toFixed(4));

    if (finalLabel === SIGN_LABELS.CINCO && palmRotation.isRotating && !wave.isWaving) {
      const spanScore = clamp01((palmRotation.zSpan - 0.9) / 0.9);
      finalLabel = SIGN_LABELS.DIEZ;
      finalConf = Number(Math.min(0.99, Math.max(finalConf, 0.85 + 0.13 * spanScore)).toFixed(4));
    } else if (finalLabel === SIGN_LABELS.CINCO && wave.isWaving && !palmRotation.isRotating) {
      const ampScore = clamp01((wave.totalAmplitude - 0.35) / 1.0);
      finalLabel = SIGN_LABELS.HOLA;
      finalConf = Number(Math.min(0.99, Math.max(finalConf, 0.84 + 0.14 * ampScore)).toFixed(4));
    }

    return {
      label: finalLabel,
      confidence: finalConf,
      committed: true,
      committedLabel: finalLabel,
      state: 'confirmed',
      details: {
        reason: lastValidStatic.reason,
        states: lastValidStatic.states,
        votes: bestCount,
        totalFrames: frames.length,
        wave,
        palmRotation,
      },
    };
  }

  reset() {
    this.frameBuffer = [];
    this._modeMotionByHand.clear();
    this._modeLastHandMs.clear();
    this.activeHandId = null;
    this._lastValidHandMs = null;
    this._lastCommittedLabel = null;
    this._lastCommittedMs = -Infinity;
    this._activeHeldLabel = null;
    this._restStartMs = null;
    this._sawRestEnough = false;
    this._fallbackSeq = 0;
    this.voter.reset();
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
