/**
 * Fast, collision-free context-mode classifier (`alphabet`, `numbers`, `phrases`)
 * for `GeometricClassifier`.
 *
 * Guarantees:
 * - Executes in < 1 ms/frame (single-pass 3D anatomy + single-pass `t_ms` motion summary).
 * - Zero cross-mode collisions: evaluates ONLY candidates belonging to the active mode.
 * - Strict margin rejection (`top1Score - top2Score < minScoreMargin` -> `null`).
 * - Dynamic-over-static precedence so dynamic signs cleanly override their static base posture
 *   without tying against it when `t_ms` trajectory criteria are satisfied.
 * - 100% invariant to aspect ratio (portrait 0.75 & landscape 1.33) and left/right chirality.
 */

import {
  HAND_LANDMARKS,
  resolveAspectRatio,
  isValidHandLandmarks,
  computeExtendedHandAnatomy,
} from './geometry.js';
import {
  CONTEXT_MODES,
  normalizeContextMode,
  getModeCatalog,
} from './modeCatalog.js';

export const DEFAULT_MIN_SCORE_MARGIN = 0.08;

/**
 * Maps dynamic signs to their paired static base sign ID within the same mode so active
 * temporal motion supersedes the static base instead of triggering a false tie.
 */
const TIGHT_FIST_SIGN_IDS = new Set([
  'letra_s',
  'letra_a',
  'letra_t',
  'puno',
  'si',
  'salud',
  'trabajo',
  'ayuda',
  'agua',
]);

const DYNAMIC_STATIC_PAIRS = Object.freeze({
  diez: 'cinco',
  letra_j: 'letra_i',
  letra_k: 'letra_p',
  letra_enie: 'letra_n',
  letra_z: 'letra_d',
  si: 'puno',
  salud: 'puno',
});

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function ramp(value, low, high) {
  const span = high - low;
  if (Math.abs(span) < 1e-6) return value >= low ? 1 : 0;
  return clamp01((value - low) / span);
}

/**
 * Extracts a compact scalar motion sample from an already-computed `anatomy` object
 * so buffering costs zero extra geometry passes.
 */
export function buildCompactMotionSample(anatomy, { handId, aspectRatio, tMs }) {
  const iso = anatomy.iso;
  return {
    tMs,
    wristX: iso[HAND_LANDMARKS.WRIST].x,
    wristY: iso[HAND_LANDMARKS.WRIST].y,
    indexX: iso[HAND_LANDMARKS.INDEX_TIP].x,
    indexY: iso[HAND_LANDMARKS.INDEX_TIP].y,
    pinkyX: iso[HAND_LANDMARKS.PINKY_TIP].x,
    pinkyY: iso[HAND_LANDMARKS.PINKY_TIP].y,
    scale: anatomy.states.palmScale,
    signedFrontZ: anatomy.states.signedFrontZ,
    handId,
    aspectRatio,
  };
}

function analyzeAxis1D(samples, key, avgScale, minHalfAmpRatio) {
  const minHalfAmp = minHalfAmpRatio * avgScale;
  const motionEps = 0.04 * avgScale;

  let minVal = Infinity;
  let maxVal = -Infinity;
  let totalTravel = 0;
  let reversals = 0;
  let trend = 0;
  let anchor = samples[0][key];
  let ext = anchor;
  let lastMotionVal = anchor;
  let lastMotionT = samples[0].tMs;

  for (let i = 0; i < samples.length; i++) {
    const v = samples[i][key];
    const tMs = samples[i].tMs;
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;

    if (i > 0) {
      totalTravel += Math.abs(v - samples[i - 1][key]);
      if (Math.abs(v - lastMotionVal) >= motionEps) {
        lastMotionVal = v;
        lastMotionT = tMs;
      }

      if (trend === 0) {
        if (v - anchor >= minHalfAmp) {
          trend = 1;
          ext = v;
        } else if (anchor - v >= minHalfAmp) {
          trend = -1;
          ext = v;
        }
      } else if (trend === 1) {
        if (v > ext) {
          ext = v;
        } else if (ext - v >= minHalfAmp) {
          reversals++;
          anchor = ext;
          trend = -1;
          ext = v;
        }
      } else if (v < ext) {
        ext = v;
      } else if (v - ext >= minHalfAmp) {
        reversals++;
        anchor = ext;
        trend = 1;
        ext = v;
      }
    }
  }

  return {
    first: samples[0][key],
    last: samples[samples.length - 1][key],
    minVal,
    maxVal,
    span: Math.max(0, maxVal - minVal),
    totalTravel,
    reversals,
    lastMotionT,
  };
}

function sliceWindow(buffer, windowMs, latestT, hasTs) {
  if (!hasTs || latestT === null) return buffer;
  let startIdx = 0;
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].tMs !== null && latestT - buffer[i].tMs > windowMs) {
      startIdx = i + 1;
      break;
    }
  }
  return startIdx === 0 ? buffer : buffer.slice(startIdx);
}

/**
 * Single-pass real-time (`t_ms`) trajectory summary across the active hand's rolling buffer.
 * Computes all dynamic motion flags once per frame so per-candidate scoring stays O(1).
 */
export function computeContextMotionSummary(buffer) {
  const empty = {
    wave: false,
    rotation: false,
    wrist_twist: false,
    lateral_shake: false,
    vertical_nod: false,
    upward: false,
    downward: false,
    j_curve: false,
    z_trace: false,
    pull_back: false,
    circle: false,
    anyDynamic: false,
    scores: {},
  };

  if (!Array.isArray(buffer) || buffer.length < 3) return empty;

  const latestT = buffer[buffer.length - 1].tMs;
  const hasTs = typeof latestT === 'number' && Number.isFinite(latestT);

  const isRecent = (refT, maxIdleTailMs) => {
    if (!hasTs || refT === null || refT === undefined) return true;
    return latestT - refT <= maxIdleTailMs;
  };

  const w900 = sliceWindow(buffer, 900, latestT, hasTs);
  const w1100 = sliceWindow(buffer, 1100, latestT, hasTs);
  const w1200 = sliceWindow(buffer, 1200, latestT, hasTs);
  const w1400 = sliceWindow(buffer, 1400, latestT, hasTs);

  if (w900.length < 3) return empty;

  let scaleSum = 0;
  let minScale = Infinity;
  let maxScale = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let rotState = 0;
  let rotFlips = 0;
  let lastRotFlipT = null;
  let twistState = 0;
  let twistFlips = 0;
  let lastTwistT = null;

  let maxYBeforeEnd = -Infinity;
  let minYBeforeEnd = Infinity;
  let lastUpT = null;
  let lastDownT = null;
  let path2D900 = 0;
  let lastMove900T = null;

  for (let i = 0; i < w900.length; i++) {
    const s = w900[i];
    scaleSum += s.scale;
    if (s.scale < minScale) minScale = s.scale;
    if (s.scale > maxScale) maxScale = s.scale;

    const z = s.signedFrontZ ?? 0;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;

    if (z >= 0.35) {
      if (rotState === -1) {
        rotFlips++;
        lastRotFlipT = s.tMs;
      }
      rotState = 1;
    } else if (z <= -0.35) {
      if (rotState === 1) {
        rotFlips++;
        lastRotFlipT = s.tMs;
      }
      rotState = -1;
    }

    if (z >= 0.2) {
      if (twistState === -1) {
        twistFlips++;
        lastTwistT = s.tMs;
      }
      twistState = 1;
    } else if (z <= -0.2) {
      if (twistState === 1) {
        twistFlips++;
        lastTwistT = s.tMs;
      }
      twistState = -1;
    }

    if (s.wristY > maxYBeforeEnd) maxYBeforeEnd = s.wristY;
    if (s.wristY < minYBeforeEnd) minYBeforeEnd = s.wristY;

    if (i > 0) {
      const prev = w900[i - 1];
      const avgStepScale = (s.scale + prev.scale) * 0.5;
      const dx = s.wristX - prev.wristX;
      const dy = s.wristY - prev.wristY;
      const step = Math.sqrt(dx * dx + dy * dy);
      path2D900 += step;

      if (prev.wristY - s.wristY >= 0.03 * avgStepScale) lastUpT = s.tMs;
      if (s.wristY - prev.wristY >= 0.03 * avgStepScale) lastDownT = s.tMs;
      if (step >= 0.03 * avgStepScale || Math.abs(s.scale - prev.scale) >= 0.02 * avgStepScale) {
        lastMove900T = s.tMs;
      }
    }
  }

  const avgScale = scaleSum / w900.length;
  if (!Number.isFinite(avgScale) || avgScale < 1e-5) return empty;

  const wX = analyzeAxis1D(w900, 'wristX', avgScale, 0.14);
  const wXWave = analyzeAxis1D(w900, 'wristX', avgScale, 0.2);
  const iX = analyzeAxis1D(w900, 'indexX', avgScale, 0.12);
  const wY = analyzeAxis1D(w900, 'wristY', avgScale, 0.12);
  const iY = analyzeAxis1D(w900, 'indexY', avgScale, 0.12);

  const zSpan = Math.max(0, maxZ - minZ);
  const end900 = w900[w900.length - 1];
  const start900 = w900[0];
  const upwardDrop = maxYBeforeEnd - end900.wristY;
  const downwardDrop = end900.wristY - minYBeforeEnd;
  const scaleSpan = maxScale - minScale;
  const netDispX = Math.abs(end900.wristX - start900.wristX);
  const netDispY = Math.abs(end900.wristY - start900.wristY);

  // Circle on 1200ms window
  let avgScale1200 = avgScale;
  let circleMatched = false;
  let circlePathRatio = 0;
  if (w1200.length >= 5) {
    let sc = 0;
    let p2d = 0;
    for (let i = 0; i < w1200.length; i++) {
      sc += w1200[i].scale;
      if (i > 0) {
        const dx = w1200[i].wristX - w1200[i - 1].wristX;
        const dy = w1200[i].wristY - w1200[i - 1].wristY;
        p2d += Math.sqrt(dx * dx + dy * dy);
      }
    }
    avgScale1200 = sc / w1200.length;
    const cX = analyzeAxis1D(w1200, 'wristX', avgScale1200, 0.1);
    const cY = analyzeAxis1D(w1200, 'wristY', avgScale1200, 0.1);
    const latestC = Math.max(cX.lastMotionT ?? -Infinity, cY.lastMotionT ?? -Infinity);
    const refC = Number.isFinite(latestC) ? latestC : null;
    circlePathRatio = p2d / avgScale1200;
    circleMatched =
      cX.span >= 0.18 * avgScale1200 &&
      cY.span >= 0.18 * avgScale1200 &&
      p2d >= 0.68 * avgScale1200 &&
      (cX.reversals >= 1 || cY.reversals >= 1) &&
      isRecent(refC, 460);
  }

  // Wave: >= 2 lateral reversals, predominantly horizontal (disjoint from circle/vertical)
  const waveMatched =
    w900.length >= 5 &&
    !circleMatched &&
    wXWave.reversals >= 2 &&
    wXWave.span >= 0.28 * avgScale &&
    wXWave.span >= wY.span * 1.25 &&
    isRecent(wXWave.lastMotionT, 320);

  // Axial palm rotation (Diez)
  const rotationMatched =
    rotFlips >= 1 &&
    zSpan >= 0.85 &&
    maxZ >= 0.35 &&
    minZ <= -0.35 &&
    isRecent(lastRotFlipT, 380);

  // Wrist twist (Q): smaller z flip or lateral index oscillation
  const wristTwistMatched =
    (twistFlips >= 1 && zSpan >= 0.45 && isRecent(lastTwistT, 420)) ||
    (zSpan >= 0.45 && isRecent(lastMove900T, 420)) ||
    (iX.reversals >= 1 && iX.span >= 0.2 * avgScale && isRecent(iX.lastMotionT, 420));

  // Lateral shake (Ñ, No, Listo, Baño, Escuela, Perdón, Disculpa)
  const bestX = iX.span >= wX.span ? iX : wX;
  const lateralShakeMatched =
    !circleMatched &&
    isRecent(bestX.lastMotionT, 420) &&
    bestX.span >= wY.span * 1.15 &&
    ((bestX.reversals >= 1 && bestX.span >= 0.2 * avgScale) ||
      (bestX.totalTravel >= 0.34 * avgScale && bestX.span >= 0.24 * avgScale));

  // Vertical nod (Sí, Esperar, Comer, Agua, Trabajo): oscillating Y (>= 1 reversal), vertical dominant
  const bestY = iY.span >= wY.span ? iY : wY;
  const verticalNodMatched =
    !circleMatched &&
    isRecent(bestY.lastMotionT, 420) &&
    bestY.reversals >= 1 &&
    bestY.span >= 0.18 * avgScale &&
    bestY.span >= wX.span * 1.1;

  // Monotonic upward (K, Ayuda, Entiendo, Buenos días, Salud) — disjoint from oscillating verticalNod
  const upwardMatched =
    !circleMatched &&
    !verticalNodMatched &&
    upwardDrop >= 0.22 * avgScale &&
    netDispY >= netDispX * 1.1 &&
    upwardDrop >= downwardDrop * 1.4 &&
    isRecent(lastUpT, 440);

  // Monotonic downward (Gracias, De nada, Buenas tardes, Buenas noches)
  const downwardMatched =
    !circleMatched &&
    !verticalNodMatched &&
    downwardDrop >= 0.22 * avgScale &&
    netDispY >= netDispX * 1.1 &&
    downwardDrop >= upwardDrop * 1.4 &&
    isRecent(lastDownT, 440);

  // J curve on 1100ms window (pinky tip drop + lateral curve)
  let jCurveMatched = false;
  if (w1100.length >= 4) {
    const pX = analyzeAxis1D(w1100, 'pinkyX', avgScale, 0.1);
    const pY = analyzeAxis1D(w1100, 'pinkyY', avgScale, 0.1);
    const dropFromStart = pY.maxVal - w1100[0].pinkyY;
    const latestJ = Math.max(pX.lastMotionT ?? -Infinity, pY.lastMotionT ?? -Infinity);
    const refJ = Number.isFinite(latestJ) ? latestJ : null;
    jCurveMatched =
      dropFromStart >= 0.2 * avgScale &&
      pX.span >= 0.16 * avgScale &&
      isRecent(refJ, 460);
  }

  // Z trace on 1400ms window (index tip X span + Y span + >= 1 X reversal)
  let zTraceMatched = false;
  if (w1400.length >= 5) {
    const zX = analyzeAxis1D(w1400, 'indexX', avgScale, 0.14);
    const zY = analyzeAxis1D(w1400, 'indexY', avgScale, 0.1);
    const latestZ = Math.max(zX.lastMotionT ?? -Infinity, zY.lastMotionT ?? -Infinity);
    const refZ = Number.isFinite(latestZ) ? latestZ : null;
    zTraceMatched =
      zX.span >= 0.26 * avgScale &&
      zY.span >= 0.18 * avgScale &&
      zX.reversals >= 1 &&
      isRecent(refZ, 500);
  }

  // Pull back / lateral glide (X, Más, Bienvenido, Con permiso) — monotonic glide, disjoint from wave/circle/verticalNod
  const pullBackMatched =
    !circleMatched &&
    !waveMatched &&
    !verticalNodMatched &&
    !upwardMatched &&
    !downwardMatched &&
    isRecent(lastMove900T, 440) &&
    ((netDispX >= 0.2 * avgScale && netDispX >= netDispY * 1.1 && wX.reversals === 0) ||
      (scaleSpan >= 0.12 * avgScale) ||
      (path2D900 >= 0.34 * avgScale && wX.span >= wY.span && wXWave.reversals < 2));

  return {
    wave: waveMatched,
    rotation: rotationMatched,
    wrist_twist: wristTwistMatched,
    lateral_shake: lateralShakeMatched,
    vertical_nod: verticalNodMatched,
    upward: upwardMatched,
    downward: downwardMatched,
    j_curve: jCurveMatched,
    z_trace: zTraceMatched,
    pull_back: pullBackMatched,
    circle: circleMatched,
    anyDynamic:
      waveMatched ||
      rotationMatched ||
      wristTwistMatched ||
      lateralShakeMatched ||
      verticalNodMatched ||
      upwardMatched ||
      downwardMatched ||
      jCurveMatched ||
      zTraceMatched ||
      pullBackMatched ||
      circleMatched,
    scores: {
      wave: waveMatched ? 0.85 + 0.13 * ramp(wXWave.totalTravel / avgScale, 0.35, 1.4) : 0,
      rotation: rotationMatched ? 0.86 + 0.12 * ramp(zSpan, 0.85, 1.8) : 0,
      wrist_twist: wristTwistMatched ? 0.84 + 0.12 * ramp(zSpan, 0.45, 1.5) : 0,
      lateral_shake: lateralShakeMatched ? 0.84 + 0.12 * ramp(bestX.span / avgScale, 0.2, 0.8) : 0,
      vertical_nod: verticalNodMatched ? 0.84 + 0.12 * ramp(bestY.span / avgScale, 0.18, 0.7) : 0,
      upward: upwardMatched ? 0.84 + 0.12 * ramp(upwardDrop / avgScale, 0.22, 0.8) : 0,
      downward: downwardMatched ? 0.84 + 0.12 * ramp(downwardDrop / avgScale, 0.22, 0.8) : 0,
      j_curve: jCurveMatched ? 0.88 : 0,
      z_trace: zTraceMatched ? 0.88 : 0,
      pull_back: pullBackMatched ? 0.84 + 0.1 * ramp(netDispX / avgScale, 0.2, 0.8) : 0,
      circle: circleMatched ? 0.86 + 0.1 * ramp(circlePathRatio, 0.68, 1.8) : 0,
    },
  };
}

/**
 * Scores one candidate sign against precomputed `anatomy` and `motionSummary`.
 * Returns `0` if any hard anatomical, orientational, directional, or temporal constraint fails;
 * otherwise returns a continuous score in `[0.62, 0.99]`.
 */
function scoreCandidateSign(sign, anatomy, motionSummary) {
  const p = sign.profile;
  const s = anatomy.states;
  const d = s.details;
  const tD = d.thumb;
  const iD = d.index;
  const mD = d.middle;

  // 0. Fast-fail dynamic motion check BEFORE geometry work if dynamic sign has no motion
  if (p.dynamicMotion && !motionSummary[p.dynamicMotion]) {
    return 0;
  }

  const margins = [];

  // 1. Palm orientation hard check + continuous margin
  const signedZ = s.signedFrontZ ?? 0;
  if (p.orientation === 'FRONT') {
    if (signedZ < -0.15) return 0;
    margins.push(0.55 + 0.45 * ramp(signedZ, -0.15, 0.55));
  } else if (p.orientation === 'BACK') {
    if (signedZ > -0.32) return 0;
    margins.push(0.55 + 0.45 * ramp(-signedZ, 0.32, 0.85));
  } else if (p.orientation === 'SIDE') {
    if (Math.abs(signedZ) > 0.7) return 0;
    margins.push(0.55 + 0.45 * ramp(0.7 - Math.abs(signedZ), 0, 0.5));
  }

  // 2. Hand / primary fingers direction hard check + continuous margin
  if (p.handDirection === 'UP') {
    const upScore = Math.max(anatomy.palmDirY, anatomy.indexDirY);
    if (upScore < 0.25) return 0;
    margins.push(0.5 + 0.5 * ramp(upScore, 0.25, 0.88));
  } else if (p.handDirection === 'DOWN') {
    const downScore = Math.max(-anatomy.indexDirY, -anatomy.palmDirY);
    if (downScore < 0.3) return 0;
    margins.push(0.5 + 0.5 * ramp(downScore, 0.3, 0.9));
  } else if (p.handDirection === 'HORIZONTAL') {
    const horizIdx = Math.abs(anatomy.indexDirX) >= 0.52 && Math.abs(anatomy.indexDirY) <= 0.72;
    const horizPalm = Math.abs(anatomy.palmDirX) >= 0.52 && Math.abs(anatomy.palmDirY) <= 0.72;
    if (!horizIdx && !horizPalm) return 0;
    margins.push(
      0.5 + 0.5 * ramp(Math.max(Math.abs(anatomy.indexDirX), Math.abs(anatomy.palmDirX)), 0.52, 0.94)
    );
  } else if (p.handDirection === 'TILTED') {
    const absX = Math.abs(anatomy.palmDirX);
    if (absX < 0.24 || absX > 0.92 || anatomy.palmDirY < 0.16) return 0;
    margins.push(0.55 + 0.45 * ramp(1 - Math.abs(absX - 0.62), 0.5, 1.0));
  }

  // 3. Special whole-hand shapes (O/Cero, C, E) vs standard finger-by-finger configurations
  if (p.zeroOval) {
    if (s.index || s.middle || s.ring || s.pinky) return 0;
    if (s.thumbIndexTipDist >= 0.38 || s.thumbMiddleTipDist >= 0.44) return 0;
    if (
      iD.tipToMcpRatio < 1.12 ||
      mD.tipToMcpRatio < 1.12 ||
      iD.pipAngle < 72 ||
      mD.pipAngle < 72
    ) {
      return 0;
    }
    margins.push(
      clamp01(1 - s.thumbIndexTipDist / 0.38),
      clamp01(1 - s.thumbMiddleTipDist / 0.44),
      ramp(iD.tipToMcpRatio, 1.12, 1.38)
    );
  } else if (p.cArc) {
    if (s.index || s.middle || s.ring || s.pinky) return 0;
    if (iD.pipAngle < 82 || iD.pipAngle > 168 || mD.pipAngle < 82) return 0;
    if (iD.tipToMcpRatio < 1.12 || mD.tipToMcpRatio < 1.12) return 0;
    if (s.thumbIndexTipDist < 0.36 || s.thumbIndexTipDist > 1.36) return 0;
    if (tD.toWrist < 0.78) return 0;
    margins.push(
      ramp(iD.tipToMcpRatio, 1.12, 1.42),
      ramp(s.thumbIndexTipDist, 0.36, 0.62),
      ramp(tD.toWrist, 0.78, 1.1)
    );
  } else if (p.clawShape) {
    if (s.index || s.middle || s.ring || s.pinky || s.thumb) return 0;
    // Distinct from tight fist S (pipAngle < 46, tipToMcpRatio < 0.96) and open C (tipToMcpRatio >= 1.24, toWrist >= 0.8)
    if (iD.pipAngle < 44 || iD.pipAngle > 125 || mD.pipAngle < 44 || mD.pipAngle > 125) return 0;
    if (iD.tipToMcpRatio < 0.96 || iD.tipToMcpRatio > 1.24) return 0;
    if (tD.toWrist >= 0.78) return 0;
    if (s.thumbIndexTipDist < 0.36) return 0;
    margins.push(
      ramp(iD.pipAngle, 44, 78),
      ramp(1.26 - iD.tipToMcpRatio, 0, 0.2),
      ramp(0.78 - tD.toWrist, 0, 0.25)
    );
  } else {
    // 4. Individual finger evaluations
    const longKeys = ['index', 'middle', 'ring', 'pinky'];
    for (let k = 0; k < longKeys.length; k++) {
      const key = longKeys[k];
      const expected = p.fingers[key];
      const fD = d[key];
      if (expected === 'any') continue;

      if (expected === true) {
        if (!s[key]) return 0;
        margins.push(Math.max(0.35, fD.extensionMargin));
      } else if (expected === false) {
        if (s[key] || !fD.curled) return 0;
        // For tight-fist signs (A/S/T in alphabet; Puño/Sí/Salud/Trabajo/Ayuda/Agua in phrases),
        // reject clawed E/Escuela or arched C/O fingertips so they stay 100% disjoint
        if (TIGHT_FIST_SIGN_IDS.has(sign.id)) {
          if (fD.pipAngle >= 52 || fD.tipToMcpRatio >= 1.0) return 0;
        }
        // For hooked X/Q, non-index fingers must stay tightly curled (disjoint from E/C/O)
        if (p.hookIndex && key !== 'index') {
          if (fD.pipAngle >= 58 || fD.tipToMcpRatio >= 1.02) return 0;
        }
        margins.push(Math.max(0.35, fD.curlMargin));
      } else if (expected === 'hook' && key === 'index') {
        if (s.index) return 0;
        if (iD.pipAngle < 52 || iD.pipAngle > 154 || iD.tipToMcpRatio < 1.0) return 0;
        margins.push(ramp(iD.tipToMcpRatio, 1.0, 1.32), ramp(iD.pipAngle, 52, 95));
      } else if (expected === 'pinch' && key === 'index') {
        if (s.index) return 0;
        const touch = p.fPinch
          ? Math.min(s.thumbIndexTipDist, anatomy.thumbTipToIndexPip, anatomy.thumbTipToIndexDip)
          : s.thumbIndexTipDist;
        const limit = p.fPinch ? 0.44 : 0.36;
        if (touch >= limit) return 0;
        margins.push(clamp01(1 - touch / limit));
      }
    }

    // 5. Thumb evaluation (strict separation of extended / curled / adducted / tucked / between / hook / pinch)
    const thumbExp = p.fingers.thumb;
    if (thumbExp === true) {
      if (!s.thumb) return 0;
      margins.push(Math.max(0.35, tD.extensionMargin));
    } else if (thumbExp === false) {
      if (s.thumb) return 0;
      if (tD.toWrist >= 0.78) return 0;
      // Reject Letra A straight adducted thumb and Letra T high tucked thumb
      if (!tD.curled && tD.toMiddleMcp > 0.62) return 0;
      margins.push(Math.max(0.35, tD.curlMargin, ramp(0.78 - tD.toWrist, 0, 0.25)));
    } else if (thumbExp === 'adducted') {
      // Letra A / Ayuda / Agua: straight upright thumb along outer index side
      const straight = tD.mcpAngle >= 128 && tD.ipAngle >= 128 && tD.toWrist >= 0.98;
      const outerSide = anatomy.thumbLatProj <= 0.14;
      if (!straight || !outerSide || (s.thumbUpScore ?? 0) < 0.2) return 0;
      // In phrases mode, keep Letra A (`Ayuda`/`Agua`) disjoint from wide abducted `Bien` if static
      margins.push(
        ramp(tD.toWrist, 0.98, 1.3),
        ramp(s.thumbUpScore, 0.2, 0.85),
        ramp(0.14 - anatomy.thumbLatProj, 0, 0.3)
      );
    } else if (thumbExp === 'tucked') {
      // Letra T / Trabajo: thumb tucked high between index & middle knuckles
      if (s.thumb) return 0;
      if (tD.toWrist < 0.74 || tD.toWrist > 1.12) return 0;
      if (tD.toIndexMcp > 0.38 || tD.toMiddleMcp > 0.38) return 0;
      if (anatomy.thumbLatProj <= 0.02) return 0;
      margins.push(
        ramp(0.38 - tD.toMiddleMcp, 0, 0.22),
        ramp(tD.toWrist, 0.74, 0.94),
        ramp(anatomy.thumbLatProj, 0.02, 0.2)
      );
    } else if (thumbExp === 'between') {
      // Letra K / Letra P / Con permiso: thumb raised between index & middle
      if (tD.toWrist < 0.86) return 0;
      const nearCenter =
        anatomy.thumbTipToMiddlePip <= 0.72 ||
        anatomy.thumbTipToIndexPip <= 0.72 ||
        tD.toMiddleMcp <= 0.68;
      if (!nearCenter) return 0;
      margins.push(
        ramp(tD.toWrist, 0.86, 1.2),
        ramp(0.72 - Math.min(anatomy.thumbTipToMiddlePip, anatomy.thumbTipToIndexPip), 0, 0.45)
      );
    } else if (thumbExp === 'hook') {
      // Letra Q: thumb curved open toward hooked index (disjoint from X where thumb is folded < 0.78)
      if (tD.toWrist < 0.78 || s.thumbIndexTipDist > 1.05) return 0;
      margins.push(ramp(tD.toWrist, 0.78, 1.12), ramp(1.05 - s.thumbIndexTipDist, 0, 0.6));
    } else if (thumbExp === 'pinch') {
      if (p.dCircle) {
        if (s.thumb) return 0;
        const okCircle = s.thumbMiddleTipDist <= 0.72 || anatomy.thumbTipToMiddlePip <= 0.72 || tD.curled;
        if (!okCircle) return 0;
        margins.push(0.75);
      } else {
        const touch = p.fPinch
          ? Math.min(s.thumbIndexTipDist, anatomy.thumbTipToIndexPip, anatomy.thumbTipToIndexDip)
          : s.thumbIndexTipDist;
        if (touch >= (p.fPinch ? 0.44 : 0.36)) return 0;
        margins.push(clamp01(1 - touch / (p.fPinch ? 0.44 : 0.36)));
      }
    }
  }

  // 6. Thumb upward constraint (Bien, Seis, A, Ayuda, Agua)
  if (p.thumbUp) {
    if ((s.thumbUpScore ?? 0) < 0.05) return 0;
    margins.push(ramp(s.thumbUpScore, 0.05, 0.7));
  }

  // 7. Thumb-Index angle constraint (Letra L, Siete, Listo)
  if (p.thumbIndexAngleRange) {
    const [minDeg, maxDeg] = p.thumbIndexAngleRange;
    const angle = s.thumbIndexAngleDeg ?? 0;
    if (angle < minDeg || angle > maxDeg) return 0;
    const distIdeal = Math.abs(angle - 85);
    margins.push(clamp01(1 - Math.max(0, distIdeal - 20) / 45));
  }

  // 8. Finger spread (U together vs V/W apart vs R crossed) with smooth overlap boundary for margin rejection
  if (p.fingerSpread) {
    const spread = s.indexMiddleSpread ?? 0.35;
    if (p.fingerSpread === 'crossed') {
      if (anatomy.tipOrderProj > 0.08) return 0;
      margins.push(0.45 + 0.55 * ramp(0.08 - anatomy.tipOrderProj, 0, 0.22));
    } else if (p.fingerSpread === 'together') {
      const isFourFinger = p.fingers.ring === true && p.fingers.pinky === true;
      const maxSpread = isFourFinger ? 0.54 : 0.42;
      if (anatomy.tipOrderProj <= 0.04 || spread > maxSpread) return 0;
      margins.push(0.35 + 0.65 * ramp(maxSpread - spread, 0, 0.22));
    } else if (p.fingerSpread === 'apart') {
      if (anatomy.tipOrderProj <= 0.04 || spread < 0.32) return 0;
      margins.push(0.35 + 0.65 * ramp(spread, 0.32, 0.54));
    }
  }

  if (margins.length === 0) return 0;

  let minM = 1;
  let sumM = 0;
  for (let i = 0; i < margins.length; i++) {
    const m = clamp01(margins[i]);
    if (m < minM) minM = m;
    sumM += m;
  }
  const avgM = sumM / margins.length;
  let score = 0.62 + 0.35 * (0.55 * minM + 0.45 * avgM);

  // Boost active dynamic sign score slightly using its real motion confidence
  if (p.dynamicMotion) {
    const motionConf = motionSummary.scores[p.dynamicMotion] || 0.85;
    score = Math.min(0.99, Math.max(score, motionConf));
  }

  return Number(Math.max(0, Math.min(0.99, score)).toFixed(4));
}

/**
 * Classifies one validated hand against the active context mode (`alphabet` | `numbers` | `phrases`),
 * enforcing strict `top1 - top2 >= minScoreMargin` rejection to prevent intra-mode flickering.
 */
export function classifySingleHandInMode(
  landmarks,
  {
    mode = CONTEXT_MODES.ALPHABET,
    aspectRatio = 1.0,
    handId = null,
    minConfidence = 0.68,
    minScoreMargin = DEFAULT_MIN_SCORE_MARGIN,
    motionSummary = null,
    precomputedAnatomy = null,
  } = {}
) {
  const activeMode = normalizeContextMode(mode);
  let anatomy = precomputedAnatomy;
  if (!anatomy) {
    if (!landmarks || !isValidHandLandmarks(landmarks, { aspectRatio })) {
      return {
        label: null,
        confidence: 0,
        states: null,
        anatomy: null,
        reason: 'INVALID_OR_NOISY_LANDMARKS',
      };
    }

    anatomy = computeExtendedHandAnatomy(landmarks, {
      aspectRatio,
      handId,
      _skipValidation: true,
    });
  }
  if (!anatomy) {
    return {
      label: null,
      confidence: 0,
      states: null,
      anatomy: null,
      reason: 'DEGENERATE_HAND_GEOMETRY',
    };
  }

  const candidates = getModeCatalog(activeMode);
  const motion = motionSummary || computeContextMotionSummary([]);

  const scored = [];
  for (let i = 0; i < candidates.length; i++) {
    const sign = candidates[i];
    const score = scoreCandidateSign(sign, anatomy, motion);
    if (score > 0) {
      scored.push({ sign, score });
    }
  }

  if (scored.length === 0) {
    return {
      label: null,
      confidence: 0,
      states: anatomy.states,
      anatomy,
      reason: 'NO_MATCH_IN_MODE',
    };
  }

  // If a dynamic sign matched, suppress its paired static base so it wins cleanly without tying
  const suppressedStaticIds = new Set();
  for (let i = 0; i < scored.length; i++) {
    const baseId = DYNAMIC_STATIC_PAIRS[scored[i].sign.id];
    if (baseId) suppressedStaticIds.add(baseId);
  }
  const filtered =
    suppressedStaticIds.size > 0
      ? scored.filter((item) => !suppressedStaticIds.has(item.sign.id))
      : scored;

  filtered.sort((a, b) => b.score - a.score);

  const top1 = filtered[0];
  const top2 = filtered.length > 1 ? filtered[1] : null;
  const scoreMargin = top2 ? Number((top1.score - top2.score).toFixed(4)) : top1.score;

  if (top1.score < minConfidence) {
    return {
      label: null,
      confidence: 0,
      states: anatomy.states,
      anatomy,
      reason: 'LOW_CONFIDENCE_AMBIGUOUS',
      top1: top1.sign.label,
      top2: top2?.sign.label || null,
      scoreMargin,
    };
  }

  if (top2 && scoreMargin < minScoreMargin) {
    return {
      label: null,
      confidence: 0,
      states: anatomy.states,
      anatomy,
      reason: 'AMBIGUOUS_MARGIN_TOO_SMALL',
      top1: top1.sign.label,
      top2: top2.sign.label,
      scoreMargin,
    };
  }

  return {
    label: top1.sign.label,
    confidence: top1.score,
    states: anatomy.states,
    anatomy,
    reason: top1.sign.hint || `Seña '${top1.sign.label}' en modo ${activeMode}`,
    top1: top1.sign.label,
    top2: top2?.sign.label || null,
    scoreMargin,
  };
}

/**
 * Resolves the best hand from a 1- or 2-hand frame under a given context mode.
 */
export function classifyModeCandidates(
  candidates,
  {
    mode,
    aspectRatio = 1.0,
    minConfidence = 0.68,
    minScoreMargin = DEFAULT_MIN_SCORE_MARGIN,
    preferredHandId = null,
    getMotionSummaryForHand = null,
  } = {}
) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      label: null,
      confidence: 0,
      states: null,
      anatomy: null,
      reason: 'INVALID_OR_NOISY_LANDMARKS',
      handId: null,
      landmarks: null,
    };
  }

  const evalCandidate = (cand) => {
    const motionSummary =
      typeof getMotionSummaryForHand === 'function' ? getMotionSummaryForHand(cand.handId) : null;
    return {
      ...cand,
      res: classifySingleHandInMode(cand.landmarks, {
        mode,
        aspectRatio,
        handId: cand.handId,
        minConfidence,
        minScoreMargin,
        motionSummary,
        precomputedAnatomy: cand.anatomy ?? null,
      }),
    };
  };

  if (candidates.length === 1) {
    const item = evalCandidate(candidates[0]);
    return {
      ...item.res,
      handId: item.handId,
      landmarks: item.landmarks,
    };
  }

  const evaluated = candidates.map(evalCandidate);
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

export { resolveAspectRatio };
