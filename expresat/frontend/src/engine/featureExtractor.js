/**
 * Canonical 178D feature vector extractor (FEATURE_SPEC v1.4.0).
 *
 * Matches `expresat/models/feature_extractor.py` within L_inf <= 1e-6:
 *   - [0..51]   Upper Pose (13 landmarks x 4: x, y, z, visibility)
 *               * P00, P11..P14 z' clipped to [-2.0, 2.0]
 *               * P15..P22 z' fixed to 0.0
 *   - [52..114] Left Hand  (21 landmarks x 3: x, y, z)
 *   - [115..177] Right Hand (21 landmarks x 3: x, y, z)
 *
 * Zero `JSON.parse(JSON.stringify(...))` allocations; flat Float64Array pipeline.
 */

export const FEATURE_SPEC_VERSION = '1.4.0';
export const TOTAL_FEATURES = 178;
export const SEQUENCE_LENGTH = 15;

export const ASPECT_RATIO = 4.0 / 3.0;

export const POSE_UPPER_INDICES = Object.freeze([0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
export const POSE_COORDS = 4;
export const POSE_Z_CLIP_ABS = 2.0;
export const POSE_Z_ZERO_INDICES = Object.freeze([15, 16, 17, 18, 19, 20, 21, 22]);
export const HAND_LANDMARKS = 21;
export const HAND_COORDS = 3;
const HAND_FEATURES_COUNT = HAND_LANDMARKS * HAND_COORDS;

export const SHOULDER_VIS_THRESH = 0.40;
export const SHOULDERS_D_MIN = 0.08;
export const HAND_DISCONNECTED_THRESH = 1.75;
export const HAND_AMBIGUITY_THRESH = 0.15;
export const POSE_WRIST_MIN_VIS = 0.50;
export const MAX_GAP_MS = 100.0;
export const MIN_UNIQUE_REAL_FRAMES = 12;
export const MAX_BRIDGE_COUNT = 3;
export const MAX_BRIDGE_RATIO = 3.0 / 14.0;
export const TAIL_EXTRAPOLATION_TOL_MS = 1e-6;
export const WRIST_MEMORY_TTL_MS = 200.0;
export const EMA_ALPHA = 0.50;

// Hand assignment weights in units of shoulder span D (FEATURE_SPEC v1.4.0)
export const WEIGHT_LABEL_PENALTY = 0.25;
export const WEIGHT_TEMPORAL_CONTINUITY = 0.50;

// Canonical SHA-256 checksums of the MediaPipe Tasks bundles used in production/capture
export const HAND_LANDMARKER_SHA256 =
  'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
export const POSE_LANDMARKER_SHA256 =
  '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';

const POSE_BILATERAL_PAIRS = Object.freeze([
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
]);

const UPPER_BILATERAL_INDEX_PAIRS = Object.freeze([
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
  [11, 12],
]);

export function dist2dIso(x1, y1, x2, y2, aspectRatio = ASPECT_RATIO) {
  return Math.hypot((x1 - x2) * aspectRatio, y1 - y2) / aspectRatio;
}

function isFiniteNum(v) {
  const n = Number(v);
  return Number.isFinite(n);
}

function getCategoryLabel(hItem) {
  if (Array.isArray(hItem) && hItem.length > 0) {
    return getCategoryLabel(hItem[0]);
  }
  if (hItem && typeof hItem === 'object') {
    return hItem.categoryName || hItem.label || hItem.displayName || null;
  }
  if (typeof hItem === 'string') {
    return hItem;
  }
  return null;
}

function getDetectedHandsAndLabels(rawFrame) {
  const hands = [];
  const labels = [];

  if (Array.isArray(rawFrame.hands)) {
    const handednessRaw = Array.isArray(rawFrame.handedness) ? rawFrame.handedness : [];
    for (let i = 0; i < rawFrame.hands.length; i++) {
      const h = rawFrame.hands[i];
      if (h && typeof h === 'object' && Array.isArray(h.landmarks)) {
        if (h.landmarks.length > 0) {
          hands.push(h.landmarks);
          let lbl = h.categoryName || h.label || null;
          if (!lbl && i < handednessRaw.length) {
            lbl = getCategoryLabel(handednessRaw[i]);
          }
          labels.push(lbl);
        }
      } else if (Array.isArray(h) && h.length > 0) {
        hands.push(h);
        const lbl = i < handednessRaw.length ? getCategoryLabel(handednessRaw[i]) : null;
        labels.push(lbl);
      }
    }
    return { hands, labels };
  }

  // Direct v1.4.0 convention: leftHand -> 'Left', rightHand -> 'Right'
  if (Array.isArray(rawFrame.leftHand) && rawFrame.leftHand.length > 0) {
    hands.push(rawFrame.leftHand);
    labels.push('Left');
  }
  if (Array.isArray(rawFrame.rightHand) && rawFrame.rightHand.length > 0) {
    hands.push(rawFrame.rightHand);
    labels.push('Right');
  }

  return { hands, labels };
}

function handToFeatures(rawHand, D, Cx, Cy) {
  const out = new Float64Array(HAND_FEATURES_COUNT);
  if (!rawHand || rawHand.length === 0) return out;

  const zwRaw = rawHand[0]?.z ?? 0.0;
  if (!isFiniteNum(zwRaw)) return null;
  const zWrist = Number(zwRaw);

  const n = Math.min(HAND_LANDMARKS, rawHand.length);
  const invD = 1.0 / D;

  for (let i = 0; i < n; i++) {
    const lm = rawHand[i];
    const rx = lm?.x ?? 0.0;
    const ry = lm?.y ?? 0.0;
    const rz = lm?.z ?? 0.0;
    if (!isFiniteNum(rx) || !isFiniteNum(ry) || !isFiniteNum(rz)) return null;
    out[i * 3 + 0] = (Number(rx) - Cx) * invD;
    out[i * 3 + 1] = (Number(ry) - Cy) * invD;
    out[i * 3 + 2] = (Number(rz) - zWrist) * invD;
  }
  return out;
}

function medianFloat64(arr) {
  const n = arr.length;
  if (n === 0) return 0.0;
  const sorted = Float64Array.from(arr);
  sorted.sort();
  const mid = Math.floor(n / 2);
  if (n % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
}

/**
 * Assign detected hands to anatomical { assignedLeftHand, assignedRightHand, isAmbiguous } slots (v1.4.0).
 */
export function assignHandsToAnatomicalSlots(
  rawFrame,
  pose,
  D,
  prevLeftWrist = null,
  prevRightWrist = null
) {
  const { hands: detectedHands, labels: detectedLabels } = getDetectedHandsAndLabels(rawFrame);

  const pw15X = Number(pose[15]?.x ?? 0.0);
  const pw15Y = Number(pose[15]?.y ?? 0.0);
  const pw15Vis = Number(pose[15]?.visibility ?? 1.0);

  const pw16X = Number(pose[16]?.x ?? 0.0);
  const pw16Y = Number(pose[16]?.y ?? 0.0);
  const pw16Vis = Number(pose[16]?.visibility ?? 1.0);

  const validHands = [];
  for (let i = 0; i < detectedHands.length; i++) {
    const h = detectedHands[i];
    const lbl = detectedLabels[i];
    const rx = h[0]?.x ?? 0.0;
    const ry = h[0]?.y ?? 0.0;
    if (!isFiniteNum(rx) || !isFiniteNum(ry)) continue;
    const hwX = Number(rx);
    const hwY = Number(ry);
    const dLeft = dist2dIso(hwX, hwY, pw15X, pw15Y);
    const dRight = dist2dIso(hwX, hwY, pw16X, pw16Y);

    const closerWristVis = dLeft <= dRight ? pw15Vis : pw16Vis;
    const isDisconnected =
      Math.min(dLeft, dRight) > HAND_DISCONNECTED_THRESH * D &&
      closerWristVis >= POSE_WRIST_MIN_VIS;

    if (!isDisconnected) {
      validHands.push({ hand: h, label: lbl, dLeft, dRight, hwX, hwY });
    }
  }

  let assignedLeftHand = null;
  let assignedRightHand = null;
  let isAmbiguous = false;

  if (validHands.length >= 2) {
    const h0 = validHands[0];
    const h1 = validHands[1];

    const costA = h0.dLeft + h1.dRight;
    const costB = h1.dLeft + h0.dRight;

    // Direct v1.4.0 convention: 'Left' -> leftHand, 'Right' -> rightHand
    let penaltyA = 0.0;
    let penaltyB = 0.0;

    if (h0.label === 'Right') penaltyA += WEIGHT_LABEL_PENALTY * D;
    else if (h0.label === 'Left') penaltyB += WEIGHT_LABEL_PENALTY * D;

    if (h1.label === 'Left') penaltyA += WEIGHT_LABEL_PENALTY * D;
    else if (h1.label === 'Right') penaltyB += WEIGHT_LABEL_PENALTY * D;

    if (prevLeftWrist && prevRightWrist) {
      const cTempA =
        dist2dIso(h0.hwX, h0.hwY, prevLeftWrist[0], prevLeftWrist[1]) +
        dist2dIso(h1.hwX, h1.hwY, prevRightWrist[0], prevRightWrist[1]);
      const cTempB =
        dist2dIso(h1.hwX, h1.hwY, prevLeftWrist[0], prevLeftWrist[1]) +
        dist2dIso(h0.hwX, h0.hwY, prevRightWrist[0], prevRightWrist[1]);
      penaltyA += WEIGHT_TEMPORAL_CONTINUITY * cTempA;
      penaltyB += WEIGHT_TEMPORAL_CONTINUITY * cTempB;
    }

    const totalCostA = costA + penaltyA;
    const totalCostB = costB + penaltyB;

    if (Math.abs(totalCostA - totalCostB) < HAND_AMBIGUITY_THRESH * D) {
      isAmbiguous = true;
    }

    if (totalCostA <= totalCostB) {
      assignedLeftHand = h0.hand;
      assignedRightHand = h1.hand;
    } else {
      assignedLeftHand = h1.hand;
      assignedRightHand = h0.hand;
    }
  } else if (validHands.length === 1) {
    const h0 = validHands[0];
    const poseWristsReliable = pw15Vis >= POSE_WRIST_MIN_VIS && pw16Vis >= POSE_WRIST_MIN_VIS;

    let costLeft = poseWristsReliable ? h0.dLeft : 0.0;
    let costRight = poseWristsReliable ? h0.dRight : 0.0;

    if (h0.label === 'Right') costLeft += WEIGHT_LABEL_PENALTY * D;
    else if (h0.label === 'Left') costRight += WEIGHT_LABEL_PENALTY * D;

    if (prevLeftWrist && prevRightWrist) {
      costLeft +=
        WEIGHT_TEMPORAL_CONTINUITY *
        dist2dIso(h0.hwX, h0.hwY, prevLeftWrist[0], prevLeftWrist[1]);
      costRight +=
        WEIGHT_TEMPORAL_CONTINUITY *
        dist2dIso(h0.hwX, h0.hwY, prevRightWrist[0], prevRightWrist[1]);
    }

    if (Math.abs(costLeft - costRight) < HAND_AMBIGUITY_THRESH * D || !poseWristsReliable) {
      isAmbiguous = true;
    }

    if (costLeft < costRight) {
      assignedLeftHand = h0.hand;
    } else if (costRight < costLeft) {
      assignedRightHand = h0.hand;
    } else if (h0.label === 'Left') {
      assignedLeftHand = h0.hand;
    } else if (h0.label === 'Right') {
      assignedRightHand = h0.hand;
    } else if (h0.dLeft <= h0.dRight) {
      assignedLeftHand = h0.hand;
    } else {
      assignedRightHand = h0.hand;
    }
  }

  return { assignedLeftHand, assignedRightHand, isAmbiguous };
}

/**
 * Validate that all detected hands carry a valid 'Left' or 'Right' label.
 */
export function validateFrameHandLabels(rawFrame) {
  const { hands: detectedHands, labels: detectedLabels } = getDetectedHandsAndLabels(rawFrame);
  if (!detectedHands || detectedHands.length === 0) {
    return { valid: true, error: null };
  }

  for (let i = 0; i < detectedLabels.length; i++) {
    const lbl = detectedLabels[i];
    if (!lbl || String(lbl).trim() === '' || String(lbl).toLowerCase() === 'unknown') {
      return {
        valid: false,
        error: `ERR_HAND_MISSING_LABEL: mano #${i} carece de etiqueta categoryName válida`,
      };
    }
    if (lbl !== 'Left' && lbl !== 'Right') {
      return {
        valid: false,
        error: `ERR_HAND_INVALID_LABEL: mano #${i} tiene etiqueta no canónica ('${lbl}')`,
      };
    }
  }

  return { valid: true, error: null };
}

/**
 * Extract and normalize a single frame into a 178-element Float32Array (FEATURE_SPEC v1.4.0).
 */
export function extractFrameFeatures(rawFrame) {
  const pose = rawFrame?.pose;
  if (!Array.isArray(pose) || pose.length < 23) {
    return { features: null, valid: false, error: 'ERR_POSE_MISSING' };
  }

  const p11 = pose[11];
  const p12 = pose[12];
  if (
    !isFiniteNum(p11?.x ?? 0.0) ||
    !isFiniteNum(p11?.y ?? 0.0) ||
    !isFiniteNum(p11?.z ?? 0.0) ||
    !isFiniteNum(p11?.visibility ?? 1.0) ||
    !isFiniteNum(p12?.x ?? 0.0) ||
    !isFiniteNum(p12?.y ?? 0.0) ||
    !isFiniteNum(p12?.z ?? 0.0) ||
    !isFiniteNum(p12?.visibility ?? 1.0)
  ) {
    return { features: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
  }

  const vis11 = Number(p11?.visibility ?? 1.0);
  const vis12 = Number(p12?.visibility ?? 1.0);
  if (vis11 < SHOULDER_VIS_THRESH || vis12 < SHOULDER_VIS_THRESH) {
    return { features: null, valid: false, error: 'ERR_SHOULDER_VISIBILITY' };
  }

  const x11 = Number(p11?.x ?? 0.0);
  const y11 = Number(p11?.y ?? 0.0);
  const x12 = Number(p12?.x ?? 0.0);
  const y12 = Number(p12?.y ?? 0.0);
  if (
    x11 < 0.0 ||
    x11 > 1.0 ||
    y11 < 0.0 ||
    y11 > 1.0 ||
    x12 < 0.0 ||
    x12 > 1.0 ||
    y12 < 0.0 ||
    y12 > 1.0
  ) {
    return { features: null, valid: false, error: 'ERR_OUT_OF_BOUNDS' };
  }

  const z11 = Number(p11?.z ?? 0.0);
  const z12 = Number(p12?.z ?? 0.0);
  const cx = (x11 + x12) * 0.5;
  const cy = (y11 + y12) * 0.5;
  const cz = (z11 + z12) * 0.5;

  const D = dist2dIso(x11, y11, x12, y12);
  if (D < SHOULDERS_D_MIN) {
    return { features: null, valid: false, error: 'ERR_SHOULDERS_TOO_SMALL' };
  }

  const features = new Float64Array(TOTAL_FEATURES);
  const invD = 1.0 / D;

  // Upper Pose [0..51]
  for (let i = 0; i < POSE_UPPER_INDICES.length; i++) {
    const pIdx = POSE_UPPER_INDICES[i];
    const lm = pose[pIdx];
    const rx = lm?.x ?? 0.0;
    const ry = lm?.y ?? 0.0;
    const rz = lm?.z ?? 0.0;
    const rv = lm?.visibility ?? 1.0;
    if (!isFiniteNum(rx) || !isFiniteNum(ry) || !isFiniteNum(rz) || !isFiniteNum(rv)) {
      return { features: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
    }

    features[i * 4 + 0] = (Number(rx) - cx) * invD;
    features[i * 4 + 1] = (Number(ry) - cy) * invD;
    if (i >= 5) {
      features[i * 4 + 2] = 0.0;
    } else {
      const zNorm = (Number(rz) - cz) * invD;
      features[i * 4 + 2] = Math.max(-POSE_Z_CLIP_ABS, Math.min(POSE_Z_CLIP_ABS, zNorm));
    }
    features[i * 4 + 3] = Math.max(0.0, Math.min(1.0, Number(rv)));
  }

  const { assignedLeftHand, assignedRightHand } = assignHandsToAnatomicalSlots(rawFrame, pose, D);

  if (assignedLeftHand) {
    const leftFeats = handToFeatures(assignedLeftHand, D, cx, cy);
    if (!leftFeats) {
      return { features: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
    }
    features.set(leftFeats, 52);
  } else {
    features.fill(0.0, 52, 115);
  }

  if (assignedRightHand) {
    const rightFeats = handToFeatures(assignedRightHand, D, cx, cy);
    if (!rightFeats) {
      return { features: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
    }
    features.set(rightFeats, 115);
  } else {
    features.fill(0.0, 115, 178);
  }

  return {
    features: new Float32Array(features),
    valid: true,
    error: null,
  };
}

function cloneHandPoints(hand) {
  const len = hand.length;
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const pt = hand[i];
    out[i] = { x: Number(pt.x ?? 0.0), y: Number(pt.y ?? 0.0), z: Number(pt.z ?? 0.0) };
  }
  return out;
}

/**
 * Pure block-wise linear resampling helper (independently verifiable on hand-calculated fixtures).
 */
export function resampleSequenceBlocks(blocks, targetTimestamps) {
  if (!Array.isArray(blocks) || blocks.length === 0 || !Array.isArray(targetTimestamps)) {
    return [];
  }
  const n = blocks.length;
  const out = new Array(targetTimestamps.length);

  for (let ti = 0; ti < targetTimestamps.length; ti++) {
    const tTarget = Number(targetTimestamps[ti]);
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Number(blocks[mid].timestamp_ms) < tTarget) lo = mid + 1;
      else hi = mid;
    }
    let idxHi = lo;
    let idxLo = idxHi;
    if (Number(blocks[idxHi].timestamp_ms) < tTarget) {
      idxLo = n - 1;
      idxHi = n - 1;
    } else if (Number(blocks[idxHi].timestamp_ms) > tTarget && idxHi > 0) {
      idxLo = idxHi - 1;
    }

    const prevF = blocks[idxLo];
    const nextF = blocks[idxHi];
    const tPrev = Number(prevF.timestamp_ms);
    const tNext = Number(nextF.timestamp_ms);
    const tau = tPrev === tNext ? 0.0 : Math.max(0.0, Math.min(1.0, (tTarget - tPrev) / (tNext - tPrev)));
    const omt = 1.0 - tau;

    const nPose = Math.min(prevF.pose.length, nextF.pose.length);
    const interpPose = new Array(nPose);
    for (let i = 0; i < nPose; i++) {
      const lp = prevF.pose[i];
      const ln = nextF.pose[i];
      interpPose[i] = {
        x: omt * Number(lp.x ?? 0.0) + tau * Number(ln.x ?? 0.0),
        y: omt * Number(lp.y ?? 0.0) + tau * Number(ln.y ?? 0.0),
        z: omt * Number(lp.z ?? 0.0) + tau * Number(ln.z ?? 0.0),
        visibility: omt * Number(lp.visibility ?? 1.0) + tau * Number(ln.visibility ?? 1.0),
      };
    }

    const interpHand = (hp, hn) => {
      if (hp && hn) {
        const nh = Math.min(hp.length, hn.length);
        const res = new Array(nh);
        for (let i = 0; i < nh; i++) {
          res[i] = {
            x: omt * Number(hp[i].x ?? 0.0) + tau * Number(hn[i].x ?? 0.0),
            y: omt * Number(hp[i].y ?? 0.0) + tau * Number(hn[i].y ?? 0.0),
            z: omt * Number(hp[i].z ?? 0.0) + tau * Number(hn[i].z ?? 0.0),
          };
        }
        return res;
      }
      if (tau < 0.5 && hp) return cloneHandPoints(hp);
      if (tau >= 0.5 && hn) return cloneHandPoints(hn);
      return null;
    };

    out[ti] = {
      timestamp_ms: tTarget,
      pose: interpPose,
      leftHand: interpHand(prevF.leftHand ?? null, nextF.leftHand ?? null),
      rightHand: interpHand(prevF.rightHand ?? null, nextF.rightHand ?? null),
    };
  }
  return out;
}

/**
 * Pure per-block temporal EMA filter with independent reset on hand reappearance.
 */
export function applyBlockEma(blocks, alpha = EMA_ALPHA) {
  const b = 1.0 - alpha;
  const out = new Array(blocks.length);
  let prevPose = null;
  let prevLH = null;
  let prevRH = null;

  for (let k = 0; k < blocks.length; k++) {
    const fr = blocks[k];
    const currPose = fr.pose;
    const sPose = new Array(currPose.length);
    if (k === 0 || !prevPose || prevPose.length !== currPose.length) {
      for (let i = 0; i < currPose.length; i++) {
        const pt = currPose[i];
        sPose[i] = {
          x: Number(pt.x ?? 0.0),
          y: Number(pt.y ?? 0.0),
          z: Number(pt.z ?? 0.0),
          visibility: Number(pt.visibility ?? 1.0),
        };
      }
    } else {
      for (let i = 0; i < currPose.length; i++) {
        const c = currPose[i];
        const p = prevPose[i];
        sPose[i] = {
          x: alpha * Number(c.x ?? 0.0) + b * p.x,
          y: alpha * Number(c.y ?? 0.0) + b * p.y,
          z: alpha * Number(c.z ?? 0.0) + b * p.z,
          visibility: Number(c.visibility ?? 1.0),
        };
      }
    }
    prevPose = sPose;

    const smoothHand = (currH, prevH) => {
      if (!currH) return null;
      if (!prevH || prevH.length !== currH.length) return cloneHandPoints(currH);
      const res = new Array(currH.length);
      for (let i = 0; i < currH.length; i++) {
        res[i] = {
          x: alpha * Number(currH[i].x ?? 0.0) + b * prevH[i].x,
          y: alpha * Number(currH[i].y ?? 0.0) + b * prevH[i].y,
          z: alpha * Number(currH[i].z ?? 0.0) + b * prevH[i].z,
        };
      }
      return res;
    };

    const sLH = smoothHand(fr.leftHand ?? null, prevLH);
    prevLH = sLH;
    const sRH = smoothHand(fr.rightHand ?? null, prevRH);
    prevRH = sRH;

    out[k] = {
      timestamp_ms: fr.timestamp_ms,
      pose: sPose,
      leftHand: sLH,
      rightHand: sRH,
    };
  }
  return out;
}

/**
 * Run the canonical block-based window extraction pipeline (FEATURE_SPEC v1.4.0).
 * Flat Float64Array pipeline: zero JSON.parse(JSON.stringify(...)) allocations.
 */
export function extractWindow(framesWithTimestamps, options = {}) {
  if (!Array.isArray(framesWithTimestamps) || framesWithTimestamps.length === 0) {
    return { tensor: null, valid: false, error: 'ERR_POSE_MISSING' };
  }

  const durationMs = options.durationMs ?? 1000.0;
  const dtNominal = durationMs / SEQUENCE_LENGTH;

  // 1. Filter frames with valid finite shoulders inside [0, 1]
  const validEntries = [];
  for (let idx = 0; idx < framesWithTimestamps.length; idx++) {
    const fr = framesWithTimestamps[idx];
    if (!fr || !Array.isArray(fr.pose) || fr.pose.length < 23) continue;
    const tsRaw = fr.t_ms ?? fr.timestamp_ms ?? 0.0;
    if (!isFiniteNum(tsRaw)) {
      return { tensor: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
    }
    const p11 = fr.pose[11];
    const p12 = fr.pose[12];
    if (
      !isFiniteNum(p11?.x ?? 0.0) ||
      !isFiniteNum(p11?.y ?? 0.0) ||
      !isFiniteNum(p11?.z ?? 0.0) ||
      !isFiniteNum(p11?.visibility ?? 1.0) ||
      !isFiniteNum(p12?.x ?? 0.0) ||
      !isFiniteNum(p12?.y ?? 0.0) ||
      !isFiniteNum(p12?.z ?? 0.0) ||
      !isFiniteNum(p12?.visibility ?? 1.0)
    ) {
      return { tensor: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
    }
    const v11 = Number(p11?.visibility ?? 1.0);
    const v12 = Number(p12?.visibility ?? 1.0);
    if (v11 < SHOULDER_VIS_THRESH || v12 < SHOULDER_VIS_THRESH) continue;
    const x11 = Number(p11?.x ?? 0.0);
    const y11 = Number(p11?.y ?? 0.0);
    const x12 = Number(p12?.x ?? 0.0);
    const y12 = Number(p12?.y ?? 0.0);
    if (
      x11 < 0.0 ||
      x11 > 1.0 ||
      y11 < 0.0 ||
      y11 > 1.0 ||
      x12 < 0.0 ||
      x12 > 1.0 ||
      y12 < 0.0 ||
      y12 > 1.0
    ) {
      continue;
    }
    validEntries.push({ ts: Number(tsRaw), fr });
  }

  const m = validEntries.length;
  if (m === 0) {
    return { tensor: null, valid: false, error: 'ERR_POSE_MISSING' };
  }

  validEntries.sort((a, b) => a.ts - b.ts);

  // Strict raw temporal gap gate (absolute <= 100.0 ms, never subtracts dtNominal)
  const tsArr = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    tsArr[i] = validEntries[i].ts;
    if (i > 0 && tsArr[i] - tsArr[i - 1] > MAX_GAP_MS) {
      return { tensor: null, valid: false, error: 'ERR_INVALID_FRAME_GAP_TOO_LARGE' };
    }
  }

  const tStart = tsArr[0];
  const taus = new Float64Array(SEQUENCE_LENGTH);
  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    taus[k] = tStart + k * dtNominal;
  }

  // Tail extrapolation gate (zero tail cloning)
  if (tsArr[m - 1] + TAIL_EXTRAPOLATION_TOL_MS < taus[SEQUENCE_LENGTH - 1]) {
    return { tensor: null, valid: false, error: 'ERR_WINDOW_TAIL_EXTRAPOLATION' };
  }

  // Window density gate: unique_real_frames >= 12/15
  const seenNearest = new Uint8Array(m);
  let uniqueCount = 0;
  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const tk = taus[k];
    let bestIdx = 0;
    let bestDist = Math.abs(tsArr[0] - tk);
    for (let i = 1; i < m; i++) {
      const dist = Math.abs(tsArr[i] - tk);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (seenNearest[bestIdx] === 0) {
      seenNearest[bestIdx] = 1;
      uniqueCount++;
    }
  }
  if (uniqueCount < MIN_UNIQUE_REAL_FRAMES) {
    return { tensor: null, valid: false, error: 'ERR_WINDOW_LOW_UNIQUE_FRAMES' };
  }

  // Wide-bridge interpolation gate: <= 3/14 transitions over intervals > 1.25 * dtNominal
  if (m > 1) {
    const bridgeThr = 1.25 * dtNominal;
    let bridgeCount = 0;
    let seg = 0;
    for (let k = 0; k < SEQUENCE_LENGTH - 1; k++) {
      const mid = 0.5 * (taus[k] + taus[k + 1]);
      while (seg + 1 < m - 1 && tsArr[seg + 1] <= mid) {
        seg++;
      }
      if (tsArr[seg + 1] - tsArr[seg] > bridgeThr) {
        bridgeCount++;
      }
    }
    if (bridgeCount > MAX_BRIDGE_COUNT) {
      return { tensor: null, valid: false, error: 'ERR_WINDOW_HIGH_INTERPOLATION' };
    }
  }

  // 2. Pack upper pose + assign anatomical hand slots per raw frame (flat TypedArrays, wrist TTL = 200ms)
  const poseFlat = new Float64Array(m * 52);
  const lhFlat = new Float64Array(m * HAND_FEATURES_COUNT);
  const lhPresent = new Uint8Array(m);
  const rhFlat = new Float64Array(m * HAND_FEATURES_COUNT);
  const rhPresent = new Uint8Array(m);

  let prevLeftW = null;
  let prevLeftT = -1e18;
  let prevRightW = null;
  let prevRightT = -1e18;

  for (let fi = 0; fi < m; fi++) {
    const tCurr = tsArr[fi];
    const fr = validEntries[fi].fr;
    const pose = fr.pose;
    const pBase = fi * 52;

    for (let ui = 0; ui < POSE_UPPER_INDICES.length; ui++) {
      const lm = pose[POSE_UPPER_INDICES[ui]];
      const rx = lm?.x ?? 0.0;
      const ry = lm?.y ?? 0.0;
      const rz = lm?.z ?? 0.0;
      const rv = lm?.visibility ?? 1.0;
      if (!isFiniteNum(rx) || !isFiniteNum(ry) || !isFiniteNum(rz) || !isFiniteNum(rv)) {
        return { tensor: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
      }
      poseFlat[pBase + ui * 4 + 0] = Number(rx);
      poseFlat[pBase + ui * 4 + 1] = Number(ry);
      poseFlat[pBase + ui * 4 + 2] = Number(rz);
      poseFlat[pBase + ui * 4 + 3] = Number(rv);
    }

    if (prevLeftW && tCurr - prevLeftT > WRIST_MEMORY_TTL_MS) {
      prevLeftW = null;
    }
    if (prevRightW && tCurr - prevRightT > WRIST_MEMORY_TTL_MS) {
      prevRightW = null;
    }

    const dFrame = dist2dIso(
      poseFlat[pBase + 4],
      poseFlat[pBase + 5],
      poseFlat[pBase + 8],
      poseFlat[pBase + 9]
    );

    const { assignedLeftHand, assignedRightHand } = assignHandsToAnatomicalSlots(
      fr,
      pose,
      dFrame,
      prevLeftW,
      prevRightW
    );

    if (assignedLeftHand) {
      lhPresent[fi] = 1;
      const hBase = fi * HAND_FEATURES_COUNT;
      const nL = Math.min(HAND_LANDMARKS, assignedLeftHand.length);
      for (let i = 0; i < nL; i++) {
        const lm = assignedLeftHand[i];
        const rx = lm?.x ?? 0.0;
        const ry = lm?.y ?? 0.0;
        const rz = lm?.z ?? 0.0;
        if (!isFiniteNum(rx) || !isFiniteNum(ry) || !isFiniteNum(rz)) {
          return { tensor: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
        }
        lhFlat[hBase + i * 3 + 0] = Number(rx);
        lhFlat[hBase + i * 3 + 1] = Number(ry);
        lhFlat[hBase + i * 3 + 2] = Number(rz);
      }
      prevLeftW = [lhFlat[hBase], lhFlat[hBase + 1]];
      prevLeftT = tCurr;
    }

    if (assignedRightHand) {
      rhPresent[fi] = 1;
      const hBase = fi * HAND_FEATURES_COUNT;
      const nR = Math.min(HAND_LANDMARKS, assignedRightHand.length);
      for (let i = 0; i < nR; i++) {
        const lm = assignedRightHand[i];
        const rx = lm?.x ?? 0.0;
        const ry = lm?.y ?? 0.0;
        const rz = lm?.z ?? 0.0;
        if (!isFiniteNum(rx) || !isFiniteNum(ry) || !isFiniteNum(rz)) {
          return { tensor: null, valid: false, error: 'ERR_NON_FINITE_LANDMARKS' };
        }
        rhFlat[hBase + i * 3 + 0] = Number(rx);
        rhFlat[hBase + i * 3 + 1] = Number(ry);
        rhFlat[hBase + i * 3 + 2] = Number(rz);
      }
      prevRightW = [rhFlat[hBase], rhFlat[hBase + 1]];
      prevRightT = tCurr;
    }
  }

  // 3. Temporal resampling per anatomical block (flat Float64Array)
  const poseRes = new Float64Array(SEQUENCE_LENGTH * 52);
  const lhRes = new Float64Array(SEQUENCE_LENGTH * HAND_FEATURES_COUNT);
  const lhPresRes = new Uint8Array(SEQUENCE_LENGTH);
  const rhRes = new Float64Array(SEQUENCE_LENGTH * HAND_FEATURES_COUNT);
  const rhPresRes = new Uint8Array(SEQUENCE_LENGTH);

  let cursor = 0;
  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const tTarget = taus[k];
    while (cursor < m - 1 && tsArr[cursor] < tTarget) {
      cursor++;
    }
    const idxHi = cursor;
    const idxLo = tsArr[idxHi] <= tTarget || idxHi === 0 ? idxHi : idxHi - 1;
    const tPrev = tsArr[idxLo];
    const tNext = tsArr[idxHi];
    const tau = tPrev === tNext ? 0.0 : Math.max(0.0, Math.min(1.0, (tTarget - tPrev) / (tNext - tPrev)));
    const omt = 1.0 - tau;

    const dstP = k * 52;
    const srcPLo = idxLo * 52;
    const srcPHi = idxHi * 52;
    for (let j = 0; j < 52; j++) {
      poseRes[dstP + j] = omt * poseFlat[srcPLo + j] + tau * poseFlat[srcPHi + j];
    }

    const dstH = k * HAND_FEATURES_COUNT;
    const srcHLo = idxLo * HAND_FEATURES_COUNT;
    const srcHHi = idxHi * HAND_FEATURES_COUNT;

    if (lhPresent[idxLo] && lhPresent[idxHi]) {
      lhPresRes[k] = 1;
      for (let j = 0; j < HAND_FEATURES_COUNT; j++) {
        lhRes[dstH + j] = omt * lhFlat[srcHLo + j] + tau * lhFlat[srcHHi + j];
      }
    } else if (tau < 0.5 && lhPresent[idxLo]) {
      lhPresRes[k] = 1;
      lhRes.set(lhFlat.subarray(srcHLo, srcHLo + HAND_FEATURES_COUNT), dstH);
    } else if (tau >= 0.5 && lhPresent[idxHi]) {
      lhPresRes[k] = 1;
      lhRes.set(lhFlat.subarray(srcHHi, srcHHi + HAND_FEATURES_COUNT), dstH);
    }

    if (rhPresent[idxLo] && rhPresent[idxHi]) {
      rhPresRes[k] = 1;
      for (let j = 0; j < HAND_FEATURES_COUNT; j++) {
        rhRes[dstH + j] = omt * rhFlat[srcHLo + j] + tau * rhFlat[srcHHi + j];
      }
    } else if (tau < 0.5 && rhPresent[idxLo]) {
      rhPresRes[k] = 1;
      rhRes.set(rhFlat.subarray(srcHLo, srcHLo + HAND_FEATURES_COUNT), dstH);
    } else if (tau >= 0.5 && rhPresent[idxHi]) {
      rhPresRes[k] = 1;
      rhRes.set(rhFlat.subarray(srcHHi, srcHHi + HAND_FEATURES_COUNT), dstH);
    }
  }

  // 4. Median window scale D_2D_iso (4:3) and shoulder center C
  const dPerFrame = new Float64Array(SEQUENCE_LENGTH);
  const cxPerFrame = new Float64Array(SEQUENCE_LENGTH);
  const cyPerFrame = new Float64Array(SEQUENCE_LENGTH);
  const czPerFrame = new Float64Array(SEQUENCE_LENGTH);

  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const pBase = k * 52;
    const x11 = poseRes[pBase + 4];
    const y11 = poseRes[pBase + 5];
    const z11 = poseRes[pBase + 6];
    const x12 = poseRes[pBase + 8];
    const y12 = poseRes[pBase + 9];
    const z12 = poseRes[pBase + 10];
    dPerFrame[k] = dist2dIso(x11, y11, x12, y12);
    cxPerFrame[k] = (x11 + x12) * 0.5;
    cyPerFrame[k] = (y11 + y12) * 0.5;
    czPerFrame[k] = (z11 + z12) * 0.5;
  }

  const dVentana = medianFloat64(dPerFrame);
  const cxVentana = medianFloat64(cxPerFrame);
  const cyVentana = medianFloat64(cyPerFrame);
  const czVentana = medianFloat64(czPerFrame);

  if (dVentana < SHOULDERS_D_MIN) {
    return { tensor: null, valid: false, error: 'ERR_SHOULDERS_TOO_SMALL' };
  }

  // 5. Per-block temporal EMA filter in-place (alpha = 0.50; reset when hand reappears)
  const a = EMA_ALPHA;
  const b = 1.0 - a;
  for (let k = 1; k < SEQUENCE_LENGTH; k++) {
    const curP = k * 52;
    const prvP = (k - 1) * 52;
    for (let ui = 0; ui < 13; ui++) {
      const u = ui * 4;
      poseRes[curP + u + 0] = a * poseRes[curP + u + 0] + b * poseRes[prvP + u + 0];
      poseRes[curP + u + 1] = a * poseRes[curP + u + 1] + b * poseRes[prvP + u + 1];
      poseRes[curP + u + 2] = a * poseRes[curP + u + 2] + b * poseRes[prvP + u + 2];
    }
    const curH = k * HAND_FEATURES_COUNT;
    const prvH = (k - 1) * HAND_FEATURES_COUNT;
    if (lhPresRes[k] && lhPresRes[k - 1]) {
      for (let j = 0; j < HAND_FEATURES_COUNT; j++) {
        lhRes[curH + j] = a * lhRes[curH + j] + b * lhRes[prvH + j];
      }
    }
    if (rhPresRes[k] && rhPresRes[k - 1]) {
      for (let j = 0; j < HAND_FEATURES_COUNT; j++) {
        rhRes[curH + j] = a * rhRes[curH + j] + b * rhRes[prvH + j];
      }
    }
  }

  // 6. Normalize and assemble (15 frames x 178 features) Float32Array
  const invD = 1.0 / dVentana;
  const tensor = new Float32Array(SEQUENCE_LENGTH * TOTAL_FEATURES);

  for (let k = 0; k < SEQUENCE_LENGTH; k++) {
    const offset = k * TOTAL_FEATURES;
    const pBase = k * 52;

    for (let ui = 0; ui < 13; ui++) {
      const u = ui * 4;
      tensor[offset + u + 0] = (poseRes[pBase + u + 0] - cxVentana) * invD;
      tensor[offset + u + 1] = (poseRes[pBase + u + 1] - cyVentana) * invD;
      if (ui >= 5) {
        tensor[offset + u + 2] = 0.0;
      } else {
        const zNorm = (poseRes[pBase + u + 2] - czVentana) * invD;
        tensor[offset + u + 2] = Math.max(-POSE_Z_CLIP_ABS, Math.min(POSE_Z_CLIP_ABS, zNorm));
      }
      tensor[offset + u + 3] = Math.max(0.0, Math.min(1.0, poseRes[pBase + u + 3]));
    }

    const hBase = k * HAND_FEATURES_COUNT;
    if (lhPresRes[k]) {
      const zWrist = lhRes[hBase + 2];
      for (let i = 0; i < HAND_LANDMARKS; i++) {
        const i3 = i * 3;
        tensor[offset + 52 + i3 + 0] = (lhRes[hBase + i3 + 0] - cxVentana) * invD;
        tensor[offset + 52 + i3 + 1] = (lhRes[hBase + i3 + 1] - cyVentana) * invD;
        tensor[offset + 52 + i3 + 2] = (lhRes[hBase + i3 + 2] - zWrist) * invD;
      }
    }

    if (rhPresRes[k]) {
      const zWrist = rhRes[hBase + 2];
      for (let i = 0; i < HAND_LANDMARKS; i++) {
        const i3 = i * 3;
        tensor[offset + 115 + i3 + 0] = (rhRes[hBase + i3 + 0] - cxVentana) * invD;
        tensor[offset + 115 + i3 + 1] = (rhRes[hBase + i3 + 1] - cyVentana) * invD;
        tensor[offset + 115 + i3 + 2] = (rhRes[hBase + i3 + 2] - zWrist) * invD;
      }
    }
  }

  return { tensor, valid: true, error: null };
}

function flipCategoryLabel(cat) {
  if (cat === 'Left') return 'Right';
  if (cat === 'Right') return 'Left';
  return cat;
}

function mirrorLandmarkList(list) {
  const out = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const lm = list[i];
    if (lm && typeof lm === 'object') {
      const copy = { ...lm };
      if (typeof copy.x === 'number' && Number.isFinite(copy.x)) {
        copy.x = 1.0 - copy.x;
      }
      out[i] = copy;
    } else {
      out[i] = lm;
    }
  }
  return out;
}

/**
 * Mirror raw landmarks in normalized [0, 1] image space without mutating input.
 * Supports array hands, `{landmarks, categoryName, score}` objects, and `leftHand`/`rightHand` swap.
 */
export function mirrorRawFrame(rawFrame) {
  const mirrored = { ...rawFrame };

  if (Array.isArray(rawFrame.pose)) {
    const mPose = mirrorLandmarkList(rawFrame.pose);
    for (const [idxL, idxR] of POSE_BILATERAL_PAIRS) {
      if (idxL < mPose.length && idxR < mPose.length) {
        const tmp = mPose[idxL];
        mPose[idxL] = mPose[idxR];
        mPose[idxR] = tmp;
      }
    }
    mirrored.pose = mPose;
  }

  if (Array.isArray(rawFrame.hands)) {
    const mHands = new Array(rawFrame.hands.length);
    for (let i = 0; i < rawFrame.hands.length; i++) {
      const h = rawFrame.hands[i];
      if (h && typeof h === 'object' && Array.isArray(h.landmarks)) {
        const hCopy = { ...h, landmarks: mirrorLandmarkList(h.landmarks) };
        if (typeof hCopy.categoryName === 'string') {
          hCopy.categoryName = flipCategoryLabel(hCopy.categoryName);
        }
        if (typeof hCopy.label === 'string') {
          hCopy.label = flipCategoryLabel(hCopy.label);
        }
        mHands[i] = hCopy;
      } else if (Array.isArray(h)) {
        mHands[i] = mirrorLandmarkList(h);
      } else {
        mHands[i] = h;
      }
    }
    mirrored.hands = mHands;
  }

  // Mirror and swap leftHand <-> rightHand keys
  const hasLH = Object.prototype.hasOwnProperty.call(rawFrame, 'leftHand');
  const hasRH = Object.prototype.hasOwnProperty.call(rawFrame, 'rightHand');
  if (hasLH || hasRH) {
    const origLH = rawFrame.leftHand;
    const origRH = rawFrame.rightHand;
    const newRH = Array.isArray(origLH) ? mirrorLandmarkList(origLH) : origLH;
    const newLH = Array.isArray(origRH) ? mirrorLandmarkList(origRH) : origRH;
    if (hasLH || newLH !== undefined) mirrored.leftHand = newLH;
    if (hasRH || newRH !== undefined) mirrored.rightHand = newRH;
  }

  if (Array.isArray(rawFrame.handedness)) {
    const mHandedness = new Array(rawFrame.handedness.length);
    for (let i = 0; i < rawFrame.handedness.length; i++) {
      const item = rawFrame.handedness[i];
      if (Array.isArray(item)) {
        mHandedness[i] = item.map((entry) => {
          if (entry && typeof entry === 'object') {
            const c = { ...entry };
            if (typeof c.categoryName === 'string') c.categoryName = flipCategoryLabel(c.categoryName);
            if (typeof c.label === 'string') c.label = flipCategoryLabel(c.label);
            return c;
          }
          return typeof entry === 'string' ? flipCategoryLabel(entry) : entry;
        });
      } else if (item && typeof item === 'object') {
        const c = { ...item };
        if (typeof c.categoryName === 'string') c.categoryName = flipCategoryLabel(c.categoryName);
        if (typeof c.label === 'string') c.label = flipCategoryLabel(c.label);
        mHandedness[i] = c;
      } else {
        mHandedness[i] = typeof item === 'string' ? flipCategoryLabel(item) : item;
      }
    }
    mirrored.handedness = mHandedness;
  }

  return mirrored;
}

/**
 * Analytically mirror a normalized 178D feature vector.
 */
export function mirrorFeatures178(features) {
  const out = new Float64Array(features);

  out[0] = -out[0];

  for (const [idxL, idxR] of UPPER_BILATERAL_INDEX_PAIRS) {
    const startL = idxL * 4;
    const startR = idxR * 4;

    const bL = out.slice(startL, startL + 4);
    const bR = out.slice(startR, startR + 4);

    bL[0] = -bL[0];
    bR[0] = -bR[0];

    out.set(bR, startL);
    out.set(bL, startR);
  }

  const leftHand = out.slice(52, 115);
  const rightHand = out.slice(115, 178);

  for (let i = 0; i < HAND_LANDMARKS; i++) {
    leftHand[i * 3 + 0] = -leftHand[i * 3 + 0];
    rightHand[i * 3 + 0] = -rightHand[i * 3 + 0];
  }

  out.set(rightHand, 52);
  out.set(leftHand, 115);

  return new Float32Array(out);
}

/**
 * Build the canonical FEATURE_SPEC v1.4.0 config object matching Python `get_canonical_config_dict`.
 * Decoupled from `tests/fixtures/`; seals spec parameters, delegate, pose_cadence, and `.task` SHA-256 hashes.
 */
export function getCanonicalConfigObject({
  delegate = 'GPU',
  poseCadence = 1,
  handLandmarkerSha256 = HAND_LANDMARKER_SHA256,
  poseLandmarkerSha256 = POSE_LANDMARKER_SHA256,
} = {}) {
  return {
    aspect_ratio: '4:3',
    d_metric: '2d_iso_4_3',
    delegate: String(delegate),
    duration_ms: 1000,
    ema_alpha: EMA_ALPHA,
    feature_spec_version: FEATURE_SPEC_VERSION,
    hand_ambiguity_thresh: HAND_AMBIGUITY_THRESH,
    hand_disconnected_thresh: HAND_DISCONNECTED_THRESH,
    hand_landmarker_sha256: String(handLandmarkerSha256),
    handedness_convention: 'direct',
    max_bridge_count: MAX_BRIDGE_COUNT,
    max_gap_ms: Math.trunc(MAX_GAP_MS),
    min_unique_real_frames: MIN_UNIQUE_REAL_FRAMES,
    pose_cadence: Math.trunc(poseCadence),
    pose_landmarker_sha256: String(poseLandmarkerSha256),
    pose_upper_indices: Array.from(POSE_UPPER_INDICES),
    pose_wrist_min_vis: POSE_WRIST_MIN_VIS,
    pose_z_clip_abs: Math.trunc(POSE_Z_CLIP_ABS),
    pose_z_zero_indices: Array.from(POSE_Z_ZERO_INDICES),
    sequence_length: SEQUENCE_LENGTH,
    shoulder_vis_thresh: SHOULDER_VIS_THRESH,
    shoulders_d_min: SHOULDERS_D_MIN,
    target_fps: 15,
    total_features: TOTAL_FEATURES,
    weight_label_penalty: WEIGHT_LABEL_PENALTY,
    weight_temporal_continuity: WEIGHT_TEMPORAL_CONTINUITY,
    wrist_memory_ttl_ms: Math.trunc(WRIST_MEMORY_TTL_MS),
  };
}

/**
 * Serialize canonical v1.4.0 config into compact sorted JSON bit-identical to Python `serialize_canonical_config`.
 */
export function serializeCanonicalConfig(options = {}) {
  const cfg = getCanonicalConfigObject(options);
  const sortedKeys = Object.keys(cfg).sort();
  const ordered = {};
  for (let i = 0; i < sortedKeys.length; i++) {
    const k = sortedKeys[i];
    ordered[k] = cfg[k];
  }
  return JSON.stringify(ordered);
}

/**
 * Compute SHA-256 `config_hash` bit-identical to Python `compute_config_hash`.
 */
export async function computeConfigHash(options = {}) {
  const serialized = serializeCanonicalConfig(options);
  const bytes = new TextEncoder().encode(serialized);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}
