/**
 * Pure geometric and mathematical helpers for 21-point MediaPipe hand landmarks.
 *
 * Zero DOM, camera, or React dependencies.
 * All functions operate on 3D `{ x, y, z }` coordinates with palm-scale
 * normalization and XY-plane rotational alignment.
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
 * @returns {boolean}
 */
export function isValidHandLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return false;
  for (let i = 0; i < 21; i++) {
    if (!isValidPoint(landmarks[i])) return false;
  }
  const scale = palmScale(landmarks);
  if (!Number.isFinite(scale) || scale < 0.015 || scale > 5.0) return false;

  // Verify anatomical coherence relative to wrist (rejects uniform noise or spikes)
  const wrist = landmarks[HAND_LANDMARKS.WRIST];
  for (let i = 1; i < 21; i++) {
    const d = distance3D(wrist, landmarks[i]) / scale;
    if (d > 4.2 || d < 0.05) {
      return false;
    }
  }

  // Ensure MCP knuckles (5, 9, 13, 17) stay within plausible anatomical spacing
  const dIndexMiddleMcp =
    distance3D(landmarks[HAND_LANDMARKS.INDEX_MCP], landmarks[HAND_LANDMARKS.MIDDLE_MCP]) / scale;
  const dMiddleRingMcp =
    distance3D(landmarks[HAND_LANDMARKS.MIDDLE_MCP], landmarks[HAND_LANDMARKS.RING_MCP]) / scale;
  const dRingPinkyMcp =
    distance3D(landmarks[HAND_LANDMARKS.RING_MCP], landmarks[HAND_LANDMARKS.PINKY_MCP]) / scale;

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
 * Reference palm scale: 3D distance between WRIST (0) and MIDDLE_MCP (9).
 */
export function palmScale(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length <= HAND_LANDMARKS.MIDDLE_MCP) return 0;
  const w = landmarks[HAND_LANDMARKS.WRIST];
  const m = landmarks[HAND_LANDMARKS.MIDDLE_MCP];
  if (!isValidPoint(w) || !isValidPoint(m)) return 0;
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
 * A straight finger approaches 180 degrees; a curled finger is below 130 degrees.
 */
export function jointAngleDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  return angleBetweenVectorsDeg(v1, v2);
}

/**
 * Normalizes 21 hand landmarks:
 * 1. Translates the origin to WRIST (0).
 * 2. Scales coordinates by `palmScale` (WRIST -> MIDDLE_MCP = 1.0).
 * 3. Rotates in the XY plane so WRIST (0) -> MIDDLE_MCP (9) points toward (0, -1).
 *
 * Ensures invariance to translation, scale (camera distance), and XY-plane rotation.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @returns {Array<{x:number, y:number, z:number}>|null}
 */
export function normalizeHand(landmarks) {
  if (!isValidHandLandmarks(landmarks)) return null;

  const wrist = landmarks[HAND_LANDMARKS.WRIST];
  const scale = palmScale(landmarks);

  // Translate and scale
  const scaled = landmarks.slice(0, 21).map((lm) => ({
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
 * Evaluates whether a non-thumb finger is extended using radial distance ratios
 * from the wrist (`tipDist / pipDist` and `tipDist / mcpDist`) and joint angles
 * at PIP and DIP. Scale and 3D-rotation invariant.
 */
function evaluateFinger(normLandmarks, mcpIdx, pipIdx, dipIdx, tipIdx) {
  const wrist = normLandmarks[HAND_LANDMARKS.WRIST];
  const mcp = normLandmarks[mcpIdx];
  const pip = normLandmarks[pipIdx];
  const dip = normLandmarks[dipIdx];
  const tip = normLandmarks[tipIdx];

  const distMcp = distance3D(wrist, mcp);
  const distPip = distance3D(wrist, pip);
  const distTip = distance3D(wrist, tip);

  const pipAngle = jointAngleDeg(mcp, pip, dip);
  const dipAngle = jointAngleDeg(pip, dip, tip);

  // An extended finger has an open PIP joint (>= 135 deg) and its tip farther from wrist than PIP and MCP
  const extended =
    pipAngle >= 135 &&
    dipAngle >= 130 &&
    distTip > distPip * 1.08 &&
    distTip > distMcp * 1.25;

  const curled = pipAngle < 120 || distTip < distPip * 1.02;

  return {
    extended,
    curled,
    pipAngle,
    dipAngle,
    tipToWrist: distTip,
  };
}

/**
 * Computes detailed geometric states for all 5 fingers and inter-finger relations.
 * Invariant to scale, translation, and XY-plane rotation.
 *
 * @param {Array<{x:number, y:number, z?:number}>} landmarks
 * @returns {Object|null}
 */
export function fingerStates(landmarks) {
  const norm = normalizeHand(landmarks);
  if (!norm) return null;

  const scale = palmScale(landmarks);
  const wrist = norm[HAND_LANDMARKS.WRIST];

  // Evaluate the four long fingers in normalized coordinates
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
    HAND_LANDMARKS.PINKY_TIP
  );

  // Evaluate thumb extension: straight MCP/IP joints and thumb tip separated from pinky and middle MCPs
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

  // Distance between thumb tip (4) and index tip (8) for OK / Pinch detection
  const thumbIndexTipDist = distance3D(thumbTip, norm[HAND_LANDMARKS.INDEX_TIP]);

  // Pinching pulls the thumb toward the index finger rather than leaving it freely abducted
  const isPinching = thumbIndexTipDist < 0.36;

  const thumbExtended =
    !isPinching &&
    thumbIpAngle >= 130 &&
    thumbMcpAngle >= 125 &&
    thumbToPinkyMcp > 0.88 &&
    thumbToMiddleMcp > 0.62 &&
    thumbToIndexMcp > 0.45 &&
    thumbToWrist > 0.75;

  const thumbCurled = !thumbExtended && !isPinching;

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
    thumbIndexAngleDeg,
    indexMiddleSpread,
    palmScale: scale,
    wristRaw: {
      x: landmarks[HAND_LANDMARKS.WRIST].x,
      y: landmarks[HAND_LANDMARKS.WRIST].y,
      z: landmarks[HAND_LANDMARKS.WRIST].z ?? 0,
    },
    details: {
      thumb: {
        extended: thumbExtended,
        curled: thumbCurled,
        mcpAngle: thumbMcpAngle,
        ipAngle: thumbIpAngle,
        toPinkyMcp: thumbToPinkyMcp,
        toMiddleMcp: thumbToMiddleMcp,
      },
      index: indexInfo,
      middle: middleInfo,
      ring: ringInfo,
      pinky: pinkyInfo,
    },
  };
}
