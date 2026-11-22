/**
 * Pure geometric and mathematical helpers for 21-point MediaPipe hand landmarks.
 *
 * Zero DOM, camera, or React dependencies.
 * All functions operate on 3D `{ x, y, z }` coordinates with optional aspect-ratio
 * isotropy correction (4:3 / 16:9), palm-scale normalization, 3D MCP/PIP/DIP
 * articulation angles, and continuous geometric margins.
 */

export const HAND_LANDMARKS = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
});

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function rampMargin(value, threshold, ideal) {
  const span = ideal - threshold;
  if (Math.abs(span) < 1e-6) return value >= threshold ? 1 : 0;
  return clamp01((value - threshold) / span);
}

/**
 * Resolves a positive image aspect ratio (width / height) from options or frame metadata.
 * Defaults to `1.0` (isotropic) when dimensions are omitted.
 */
export function resolveAspectRatio(source = null) {
  if (!source || typeof source !== 'object') return 1.0;
  if (Number.isFinite(source.aspectRatio) && source.aspectRatio > 0) {
    return source.aspectRatio;
  }
  if (
    Number.isFinite(source.videoWidth) &&
    Number.isFinite(source.videoHeight) &&
    source.videoWidth > 0 &&
    source.videoHeight > 0
  ) {
    return source.videoWidth / source.videoHeight;
  }
  return 1.0;
}

/**
 * Projects normalized MediaPipe image landmarks into pixel-isotropic 3D space
 * (all axes expressed in units of image width `W`: `x' = x`, `y' = y / aspectRatio`, `z' = z`).
 *
 * Eliminates the `(W/H)^2` directional distortion on 4:3 (640x480) and 16:9 cameras
 * whenever a hand rotates in the XY plane.
 */
export function projectIsotropic(landmarks, aspectRatio = 1.0) {
  if (!Array.isArray(landmarks)) return null;
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1.0;
  const invAspect = 1.0 / aspect;
  const needsScale = Math.abs(aspect - 1.0) > 1e-6;
  const len = Math.min(21, landmarks.length);
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const pt = landmarks[i];
    if (!pt) {
      out[i] = pt;
    } else {
      out[i] = {
        x: pt.x,
        y: needsScale ? pt.y * invAspect : pt.y,
        z: pt.z ?? 0,
      };
    }
  }
  return out;
}

/**
 * Checks whether a point has finite numeric coordinates.
 * @param {any} pt
 * @returns {boolean}
 */
export function isValidPoint(pt) {
  if (!pt || typeof pt !== 'object') return false;
  return Number.isFinite(pt.x) && Number.isFinite(pt.y) && Number.isFinite(pt.z ?? 0);
}

/**
 * Checks that the hand landmark array has 21 valid points and is not
 * degenerate noise (collapsed points or implausible spatial spread).
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @param {Object} [options]
 * @param {number} [options.aspectRatio=1.0]
 * @returns {boolean}
 */
export function isValidHandLandmarks(landmarks, options = {}) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return false;
  for (let i = 0; i < 21; i++) {
    if (!isValidPoint(landmarks[i])) return false;
  }

  const aspect = resolveAspectRatio(options);
  const pts = Math.abs(aspect - 1.0) > 1e-6 ? projectIsotropic(landmarks, aspect) : landmarks;
  const scale = palmScale(pts);
  // Keep 0.015 threshold in isotropic 1:1 space; allow proportional lower bound under 4:3 projection
  const minScale = Math.abs(aspect - 1.0) > 1e-6 ? 0.015 / Math.max(1.0, aspect) : 0.015;
  if (!Number.isFinite(scale) || scale < minScale || scale > 5.0) return false;

  // Verify anatomical coherence relative to wrist (rejects uniform noise or spikes)
  const wrist = pts[HAND_LANDMARKS.WRIST];
  for (let i = 1; i < 21; i++) {
    const d = distance3D(wrist, pts[i]) / scale;
    if (d > 4.2 || d < 0.05) {
      return false;
    }
  }

  // Ensure MCP knuckles (5, 9, 13, 17) stay within plausible anatomical spacing
  const dIndexMiddleMcp =
    distance3D(pts[HAND_LANDMARKS.INDEX_MCP], pts[HAND_LANDMARKS.MIDDLE_MCP]) / scale;
  const dMiddleRingMcp =
    distance3D(pts[HAND_LANDMARKS.MIDDLE_MCP], pts[HAND_LANDMARKS.RING_MCP]) / scale;
  const dRingPinkyMcp =
    distance3D(pts[HAND_LANDMARKS.RING_MCP], pts[HAND_LANDMARKS.PINKY_MCP]) / scale;

  if (dIndexMiddleMcp > 1.2 || dMiddleRingMcp > 1.2 || dRingPinkyMcp > 1.2) {
    return false;
  }

  return true;
}

/**
 * 3D Euclidean distance between two points.
 */
export function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 2D Euclidean distance in the XY plane.
 */
export function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Reference palm scale: 3D distance between WRIST (0) and MIDDLE_MCP (9)
 * in isotropic coordinates.
 */
export function palmScale(landmarks, options = {}) {
  if (!Array.isArray(landmarks) || landmarks.length <= HAND_LANDMARKS.MIDDLE_MCP) return 0;
  const w = landmarks[HAND_LANDMARKS.WRIST];
  const m = landmarks[HAND_LANDMARKS.MIDDLE_MCP];
  if (!isValidPoint(w) || !isValidPoint(m)) return 0;
  const aspect = resolveAspectRatio(options);
  if (Math.abs(aspect - 1.0) > 1e-6) {
    const invAspect = 1.0 / aspect;
    const dx = w.x - m.x;
    const dy = (w.y - m.y) * invAspect;
    const dz = (w.z ?? 0) - (m.z ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return distance3D(w, m);
}

/**
 * Angle in degrees [0, 180] between two 3D vectors.
 */
export function angleBetweenVectorsDeg(v1, v2) {
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const n1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
  const n2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
  if (n1 < 1e-6 || n2 < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Joint angle in degrees at vertex B formed by segments BA and BC.
 * A straight finger approaches 180 degrees; a curled finger is below 120 degrees.
 */
export function jointAngleDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  return angleBetweenVectorsDeg(v1, v2);
}

/**
 * Computes the unit 3D palm normal vector `normalize((INDEX_MCP - WRIST) x (PINKY_MCP - WRIST))`
 * in pixel-isotropic coordinates.
 *
 * In MediaPipe normalized image coordinates (unmirrored raw frame, FEATURE_SPEC v1.4.0):
 * - For a physical left hand (`handId === 'leftHand'`): palmar view yields `z > 0`, dorsal yields `z < 0`.
 * - For a physical right hand (`handId === 'rightHand'`): palmar view yields `z < 0`, dorsal yields `z > 0`.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @param {Object} [options]
 * @param {number} [options.aspectRatio=1.0]
 * @returns {{ x: number, y: number, z: number }}
 */
export function computePalmNormal(landmarks, options = {}) {
  if (!Array.isArray(landmarks) || landmarks.length <= HAND_LANDMARKS.PINKY_MCP) {
    return { x: 0, y: 0, z: 0 };
  }
  const aspect = resolveAspectRatio(options);
  const pts = Math.abs(aspect - 1.0) > 1e-6 ? projectIsotropic(landmarks, aspect) : landmarks;
  const w = pts[HAND_LANDMARKS.WRIST];
  const idx = pts[HAND_LANDMARKS.INDEX_MCP];
  const pky = pts[HAND_LANDMARKS.PINKY_MCP];
  if (!isValidPoint(w) || !isValidPoint(idx) || !isValidPoint(pky)) {
    return { x: 0, y: 0, z: 0 };
  }

  const ux = idx.x - w.x;
  const uy = idx.y - w.y;
  const uz = (idx.z ?? 0) - (w.z ?? 0);

  const vx = pky.x - w.x;
  const vy = pky.y - w.y;
  const vz = (pky.z ?? 0) - (w.z ?? 0);

  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!Number.isFinite(len) || len < 1e-6) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: nx / len,
    y: ny / len,
    z: nz / len,
  };
}

/**
 * Converts a 3D palm normal into a chirality-invariant signed palmar orientation score `[-1, +1]`:
 * - `+1`: palm facing directly toward camera (`FRONT`)
 * - `0`: hand seen edge-on (`SIDE`)
 * - `-1`: dorsum (back of hand) facing directly toward camera (`BACK`)
 *
 * Respects FEATURE_SPEC v1.4.0 direct laterality (`leftHand` vs `rightHand`).
 *
 * @param {{ x: number, y: number, z: number }} palmNormal
 * @param {string|null} [handId=null]
 * @returns {number}
 */
export function computeSignedFrontZ(palmNormal, handId = null) {
  if (!palmNormal || !Number.isFinite(palmNormal.z)) return 0;
  const sign = handId === 'rightHand' || handId === 'Right' ? -1 : 1;
  return Number(Math.max(-1, Math.min(1, sign * palmNormal.z)).toFixed(4));
}

/**
 * Normalizes 21 hand landmarks:
 * 1. Projects into pixel-isotropic 3D space (when `aspectRatio` is provided).
 * 2. Translates the origin to WRIST (0).
 * 3. Scales coordinates by `palmScale` (WRIST -> MIDDLE_MCP = 1.0).
 * 4. Rotates in the XY plane so WRIST (0) -> MIDDLE_MCP (9) points toward (0, -1).
 *
 * Ensures invariance to translation, scale (camera distance), aspect ratio, and XY-plane rotation.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @param {Object} [options]
 * @param {number} [options.aspectRatio=1.0]
 * @param {boolean} [options._skipValidation=false]
 * @returns {Array<{x:number, y:number, z:number}>|null}
 */
export function normalizeHand(landmarks, options = {}) {
  const aspect = resolveAspectRatio(options);
  if (!options._skipValidation && !isValidHandLandmarks(landmarks, { aspectRatio: aspect })) {
    return null;
  }

  const pts = Math.abs(aspect - 1.0) > 1e-6 ? projectIsotropic(landmarks, aspect) : landmarks;
  const wrist = pts[HAND_LANDMARKS.WRIST];
  const scale = palmScale(pts);
  if (!Number.isFinite(scale) || scale < 1e-6) return null;

  // Translate and scale
  const scaled = pts.slice(0, 21).map((lm) => ({
    x: (lm.x - wrist.x) / scale,
    y: (lm.y - wrist.y) / scale,
    z: ((lm.z ?? 0) - (wrist.z ?? 0)) / scale,
  }));

  // Current XY palm axis angle (WRIST -> MIDDLE_MCP); rotate to align with -Y (-PI/2)
  const midMcp = scaled[HAND_LANDMARKS.MIDDLE_MCP];
  const currentAngle = Math.atan2(midMcp.y, midMcp.x);
  const targetAngle = -Math.PI / 2;
  const deltaAngle = targetAngle - currentAngle;
  const cosA = Math.cos(deltaAngle);
  const sinA = Math.sin(deltaAngle);

  return scaled.map((p) => ({
    x: p.x * cosA - p.y * sinA,
    y: p.x * sinA + p.y * cosA,
    z: p.z,
  }));
}

/**
 * Evaluates a non-thumb finger into three mutually exclusive states:
 * `extended`, `curled`, or ambiguous/neutral (`!extended && !curled`).
 *
 * Uses 3D MCP, PIP, and DIP joint angles plus wrist-radial distance ratios.
 * Fully invariant to scale, translation, aspect ratio (after isotropic projection), and 3D rotation.
 */
function evaluateFinger(normLandmarks, mcpIdx, pipIdx, dipIdx, tipIdx, { isPinky = false } = {}) {
  const wrist = normLandmarks[HAND_LANDMARKS.WRIST];
  const mcp = normLandmarks[mcpIdx];
  const pip = normLandmarks[pipIdx];
  const dip = normLandmarks[dipIdx];
  const tip = normLandmarks[tipIdx];

  const distMcp = distance3D(wrist, mcp);
  const distPip = distance3D(wrist, pip);
  const distTip = distance3D(wrist, tip);

  const tipToPipRatio = distTip / Math.max(distPip, 1e-6);
  const tipToMcpRatio = distTip / Math.max(distMcp, 1e-6);

  const mcpAngle = jointAngleDeg(wrist, mcp, pip);
  const pipAngle = jointAngleDeg(mcp, pip, dip);
  const dipAngle = jointAngleDeg(pip, dip, tip);

  const mcpExtMin = isPinky ? 115 : 120;
  const pipExtMin = isPinky ? 132 : 135;
  const dipExtMin = isPinky ? 122 : 130;
  const tipPipExtMin = isPinky ? 1.05 : 1.08;
  const tipMcpExtMin = isPinky ? 1.2 : 1.25;

  const extended =
    mcpAngle >= mcpExtMin &&
    pipAngle >= pipExtMin &&
    dipAngle >= dipExtMin &&
    tipToPipRatio > tipPipExtMin &&
    tipToMcpRatio > tipMcpExtMin;

  const dorsalFolded = mcpAngle <= 125 && tipToMcpRatio <= 1.28;

  const curled =
    !extended &&
    (pipAngle <= 118 ||
      tipToPipRatio < 1.02 ||
      tipToMcpRatio < 1.15 ||
      (pipAngle <= 128 && dipAngle <= 120) ||
      dorsalFolded);

  const extensionMargin = extended
    ? Math.min(
        rampMargin(mcpAngle, mcpExtMin, isPinky ? 148 : 158),
        rampMargin(pipAngle, pipExtMin, 168),
        rampMargin(dipAngle, dipExtMin, 168),
        rampMargin(tipToPipRatio, tipPipExtMin, 1.3),
        rampMargin(tipToMcpRatio, tipMcpExtMin, 1.8)
      )
    : 0;

  const dorsalFoldMargin = dorsalFolded
    ? Math.max(
        0.35,
        Math.min(rampMargin(130 - mcpAngle, 0, 35), rampMargin(1.3 - tipToMcpRatio, 0, 0.2))
      )
    : 0;

  const curlMargin = curled
    ? Math.max(
        rampMargin(132 - pipAngle, 0, 52),
        rampMargin(1.08 - tipToPipRatio, 0, 0.24),
        rampMargin(1.24 - tipToMcpRatio, 0, 0.28),
        dorsalFoldMargin
      )
    : 0;

  return {
    extended,
    curled,
    ambiguous: !extended && !curled,
    mcpAngle,
    pipAngle,
    dipAngle,
    tipToPipRatio,
    tipToMcpRatio,
    tipToWrist: distTip,
    extensionMargin: Number(extensionMargin.toFixed(4)),
    curlMargin: Number(curlMargin.toFixed(4)),
  };
}

/**
 * Computes detailed geometric states for all 5 fingers and inter-finger relations.
 * Invariant to scale, translation, aspect ratio, XY-plane rotation, and left/right mirroring.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @param {Object} [options]
 * @param {number} [options.aspectRatio=1.0]
 * @param {boolean} [options._skipValidation=false]
 * @returns {Object|null}
 */
export function fingerStates(landmarks, options = {}) {
  const aspect = resolveAspectRatio(options);
  const norm = normalizeHand(landmarks, {
    aspectRatio: aspect,
    _skipValidation: options._skipValidation,
  });
  if (!norm) return null;

  const iso = Math.abs(aspect - 1.0) > 1e-6 ? projectIsotropic(landmarks, aspect) : landmarks;
  const scale = palmScale(iso);
  const wrist = norm[HAND_LANDMARKS.WRIST];

  // Evaluate the four long fingers in normalized 3D coordinates
  const indexInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.INDEX_MCP,
    HAND_LANDMARKS.INDEX_PIP,
    HAND_LANDMARKS.INDEX_DIP,
    HAND_LANDMARKS.INDEX_TIP
  );
  const middleInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.MIDDLE_MCP,
    HAND_LANDMARKS.MIDDLE_PIP,
    HAND_LANDMARKS.MIDDLE_DIP,
    HAND_LANDMARKS.MIDDLE_TIP
  );
  const ringInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.RING_MCP,
    HAND_LANDMARKS.RING_PIP,
    HAND_LANDMARKS.RING_DIP,
    HAND_LANDMARKS.RING_TIP
  );
  const pinkyInfo = evaluateFinger(
    norm,
    HAND_LANDMARKS.PINKY_MCP,
    HAND_LANDMARKS.PINKY_PIP,
    HAND_LANDMARKS.PINKY_DIP,
    HAND_LANDMARKS.PINKY_TIP,
    { isPinky: true }
  );

  // Evaluate thumb 3D articulation and abduction distances
  const thumbCmc = norm[HAND_LANDMARKS.THUMB_CMC];
  const thumbMcp = norm[HAND_LANDMARKS.THUMB_MCP];
  const thumbIp = norm[HAND_LANDMARKS.THUMB_IP];
  const thumbTip = norm[HAND_LANDMARKS.THUMB_TIP];
  const indexMcp = norm[HAND_LANDMARKS.INDEX_MCP];
  const middleMcp = norm[HAND_LANDMARKS.MIDDLE_MCP];
  const pinkyMcp = norm[HAND_LANDMARKS.PINKY_MCP];

  const thumbMcpAngle = jointAngleDeg(thumbCmc, thumbMcp, thumbIp);
  const thumbIpAngle = jointAngleDeg(thumbMcp, thumbIp, thumbTip);
  const thumbToPinkyMcp = distance3D(thumbTip, pinkyMcp);
  const thumbToMiddleMcp = distance3D(thumbTip, middleMcp);
  const thumbToIndexMcp = distance3D(thumbTip, indexMcp);
  const thumbToWrist = distance3D(thumbTip, wrist);

  // Distance between thumb tip (4) and index/middle tips (8, 12) for OK / Pinch and LSM Zero (0)
  const thumbIndexTipDist = distance3D(thumbTip, norm[HAND_LANDMARKS.INDEX_TIP]);
  const thumbMiddleTipDist = distance3D(thumbTip, norm[HAND_LANDMARKS.MIDDLE_TIP]);
  const isPinching = thumbIndexTipDist < 0.36;

  // Chirality-invariant 3D palm orientation (FRONT >= +0.20, SIDE, BACK <= -0.35)
  const palmNormal = computePalmNormal(iso);
  const signedFrontZ = computeSignedFrontZ(palmNormal, options.handId ?? null);
  const palmFacing = signedFrontZ >= 0.2 ? 'FRONT' : signedFrontZ <= -0.35 ? 'BACK' : 'SIDE';

  // Extended thumb: straight MCP/IP joints and abducted clear of the palm/index
  const thumbExtended =
    !isPinching &&
    thumbIpAngle >= 130 &&
    thumbMcpAngle >= 125 &&
    thumbToPinkyMcp > 0.88 &&
    thumbToMiddleMcp > 0.62 &&
    thumbToIndexMcp > 0.45 &&
    thumbToWrist > 0.78;

  // Straight upright thumb pressed against the side of the index finger ("Letra A"):
  // neither abducted-extended ("Bien") nor folded across the palm ("Puño").
  const isStraightAdductedThumb =
    thumbToWrist > 1.02 &&
    thumbToPinkyMcp > 0.92 &&
    thumbMcpAngle >= 145 &&
    thumbIpAngle >= 145;

  // Occluded thumb in a dorsal fist tucked behind/beside the index knuckle (short wrist reach, close to index MCP)
  const isDorsalTuckedThumb = thumbToWrist <= 1.0 && thumbToIndexMcp <= 0.44;

  // Curled thumb: tucked inward toward palm/middle/pinky or visibly bent.
  // Allows both palmar natural fists and dorsal occluded fists while keeping
  // straight tall "Letra A" thumb (toWrist > 1.02) in the ambiguous zone.
  const thumbCurled =
    !thumbExtended &&
    !isStraightAdductedThumb &&
    (thumbToPinkyMcp < 0.82 ||
      thumbToMiddleMcp < 0.56 ||
      thumbToWrist < 0.7 ||
      thumbMcpAngle < 118 ||
      thumbIpAngle < 118 ||
      isDorsalTuckedThumb);

  const thumbExtensionMargin = thumbExtended
    ? Math.min(
        rampMargin(thumbIpAngle, 130, 168),
        rampMargin(thumbMcpAngle, 125, 162),
        rampMargin(thumbToPinkyMcp, 0.88, 1.32),
        rampMargin(thumbToMiddleMcp, 0.62, 0.92),
        rampMargin(thumbToIndexMcp, 0.45, 0.68),
        rampMargin(thumbToWrist, 0.78, 1.2)
      )
    : 0;

  const dorsalThumbMargin = isDorsalTuckedThumb
    ? Math.max(
        0.35,
        Math.min(rampMargin(0.45 - thumbToIndexMcp, 0, 0.22), rampMargin(1.02 - thumbToWrist, 0, 0.18))
      )
    : 0;

  const thumbCurlMargin = thumbCurled
    ? Math.max(
        rampMargin(0.82 - thumbToPinkyMcp, 0, 0.25),
        rampMargin(0.56 - thumbToMiddleMcp, 0, 0.2),
        rampMargin(0.7 - thumbToWrist, 0, 0.2),
        rampMargin(118 - thumbMcpAngle, 0, 30),
        rampMargin(118 - thumbIpAngle, 0, 30),
        dorsalThumbMargin
      )
    : 0;

  // Vertical direction of the thumb in raw isotropic camera frame: +1 = straight up (-Y), -1 = straight down (+Y)
  const rawThumbDx = iso[HAND_LANDMARKS.THUMB_TIP].x - iso[HAND_LANDMARKS.THUMB_CMC].x;
  const rawThumbDy = iso[HAND_LANDMARKS.THUMB_TIP].y - iso[HAND_LANDMARKS.THUMB_CMC].y;
  const rawThumbDz = (iso[HAND_LANDMARKS.THUMB_TIP].z ?? 0) - (iso[HAND_LANDMARKS.THUMB_CMC].z ?? 0);
  const rawThumbLen = Math.sqrt(
    rawThumbDx * rawThumbDx + rawThumbDy * rawThumbDy + rawThumbDz * rawThumbDz
  );
  const thumbUpScore = rawThumbLen > 1e-6 ? -rawThumbDy / rawThumbLen : 0;

  // Angle between thumb vector (CMC -> TIP) and index vector (MCP -> TIP)
  const vThumb = {
    x: thumbTip.x - thumbCmc.x,
    y: thumbTip.y - thumbCmc.y,
    z: thumbTip.z - thumbCmc.z,
  };
  const indexTip = norm[HAND_LANDMARKS.INDEX_TIP];
  const vIndex = {
    x: indexTip.x - indexMcp.x,
    y: indexTip.y - indexMcp.y,
    z: indexTip.z - indexMcp.z,
  };
  const thumbIndexAngleDeg = angleBetweenVectorsDeg(vThumb, vIndex);

  // Separation between index and middle fingertips (normalized by palmScale)
  const indexMiddleSpread = distance3D(
    norm[HAND_LANDMARKS.INDEX_TIP],
    norm[HAND_LANDMARKS.MIDDLE_TIP]
  );

  const extendedCount =
    (thumbExtended ? 1 : 0) +
    (indexInfo.extended ? 1 : 0) +
    (middleInfo.extended ? 1 : 0) +
    (ringInfo.extended ? 1 : 0) +
    (pinkyInfo.extended ? 1 : 0);

  return {
    thumb: thumbExtended,
    index: indexInfo.extended,
    middle: middleInfo.extended,
    ring: ringInfo.extended,
    pinky: pinkyInfo.extended,
    extendedCount,
    isPinching,
    thumbIndexTipDist,
    thumbMiddleTipDist,
    thumbIndexAngleDeg,
    thumbUpScore: Number(thumbUpScore.toFixed(4)),
    indexMiddleSpread,
    palmNormal,
    signedFrontZ,
    palmFacing,
    palmScale: scale,
    aspectRatio: aspect,
    wristRaw: {
      x: landmarks[HAND_LANDMARKS.WRIST].x,
      y: landmarks[HAND_LANDMARKS.WRIST].y,
      z: landmarks[HAND_LANDMARKS.WRIST].z ?? 0,
    },
    details: {
      thumb: {
        extended: thumbExtended,
        curled: thumbCurled,
        ambiguous: !thumbExtended && !thumbCurled && !isPinching,
        mcpAngle: thumbMcpAngle,
        ipAngle: thumbIpAngle,
        toPinkyMcp: thumbToPinkyMcp,
        toMiddleMcp: thumbToMiddleMcp,
        toIndexMcp: thumbToIndexMcp,
        toWrist: thumbToWrist,
        upScore: Number(thumbUpScore.toFixed(4)),
        extensionMargin: Number(thumbExtensionMargin.toFixed(4)),
        curlMargin: Number(thumbCurlMargin.toFixed(4)),
      },
      index: indexInfo,
      middle: middleInfo,
      ring: ringInfo,
      pinky: pinkyInfo,
    },
  };
}
