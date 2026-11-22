/**
 * Deterministic 21-point 3D synthetic hand landmark generator.
 *
 * Used by both `recognition/` unit tests and synthetic demo mode in E2E browser tests
 * running with `--use-fake-device-for-media-stream`.
 */

/**
 * Builds an anatomically coherent synthetic 21-point hand.
 * By default `WRIST (0)` is at `(0.5, 0.7, 0)` and `MIDDLE_MCP (9)` is at `(0.5, 0.55, 0)`,
 * giving `palmScale = 0.15`.
 *
 * @param {Object} config
 * @param {boolean} [config.thumb=false]
 * @param {boolean} [config.index=false]
 * @param {boolean} [config.middle=false]
 * @param {boolean} [config.ring=false]
 * @param {boolean} [config.pinky=false]
 * @param {boolean} [config.pinch=false] If true, joins thumb (4) and index (8) tips for "OK / Pinza"
 * @param {number} [config.scale=1.0] Multiplicative scale factor
 * @param {number} [config.rotateDeg=0] XY-plane rotation in degrees
 * @param {number} [config.offsetX=0.5] Wrist X coordinate
 * @param {number} [config.offsetY=0.7] Wrist Y coordinate
 */
export function buildSyntheticHand({
  thumb = false,
  index = false,
  middle = false,
  ring = false,
  pinky = false,
  pinch = false,
  scale = 1.0,
  rotateDeg = 0,
  offsetX = 0.5,
  offsetY = 0.7,
} = {}) {
  const basePalm = 0.15 * scale;
  const pts = new Array(21);

  // 0: WRIST at the local origin (0, 0, 0)
  pts[0] = { x: 0, y: 0, z: 0 };

  // Helper for a long finger in local coordinates (where -Y points upward)
  function buildFinger(mcpX, mcpY, isExtended, spreadX = 0) {
    const mcp = { x: mcpX, y: mcpY, z: 0 };
    if (isExtended) {
      return [
        mcp,
        { x: mcpX + spreadX * 0.35, y: mcpY - 0.45 * basePalm, z: 0 },
        { x: mcpX + spreadX * 0.7, y: mcpY - 0.8 * basePalm, z: 0 },
        { x: mcpX + spreadX * 1.0, y: mcpY - 1.12 * basePalm, z: 0 },
      ];
    }
    // Curled finger toward the palm (PIP rises slightly while DIP and TIP fold back toward the palm)
    return [
      mcp,
      { x: mcpX, y: mcpY - 0.25 * basePalm, z: -0.02 * basePalm },
      { x: mcpX, y: mcpY - 0.05 * basePalm, z: -0.04 * basePalm },
      { x: mcpX, y: mcpY + 0.12 * basePalm, z: -0.03 * basePalm },
    ];
  }

  // Thumb (1..4)
  if (pinch) {
    // Thumb and index converge at the pinch point (-0.32 * basePalm, -1.25 * basePalm)
    pts[1] = { x: -0.25 * basePalm, y: -0.25 * basePalm, z: 0 };
    pts[2] = { x: -0.38 * basePalm, y: -0.58 * basePalm, z: 0 };
    pts[3] = { x: -0.42 * basePalm, y: -0.92 * basePalm, z: 0 };
    pts[4] = { x: -0.32 * basePalm, y: -1.22 * basePalm, z: 0 };
  } else if (thumb) {
    // Extended thumb abducted left (-X) along a straight line from CMC
    pts[1] = { x: -0.28 * basePalm, y: -0.25 * basePalm, z: 0 };
    pts[2] = { x: -0.55 * basePalm, y: -0.5 * basePalm, z: 0 };
    pts[3] = { x: -0.82 * basePalm, y: -0.75 * basePalm, z: 0 };
    pts[4] = { x: -1.1 * basePalm, y: -1.0 * basePalm, z: 0 };
  } else {
    // Thumb folded across the palm toward the middle/ring MCPs
    pts[1] = { x: -0.22 * basePalm, y: -0.22 * basePalm, z: 0 };
    pts[2] = { x: -0.28 * basePalm, y: -0.45 * basePalm, z: -0.02 * basePalm };
    pts[3] = { x: -0.12 * basePalm, y: -0.58 * basePalm, z: -0.03 * basePalm };
    pts[4] = { x: 0.05 * basePalm, y: -0.55 * basePalm, z: -0.03 * basePalm };
  }

  // Index (5..8)
  if (pinch) {
    pts[5] = { x: -0.32 * basePalm, y: -0.95 * basePalm, z: 0 };
    pts[6] = { x: -0.42 * basePalm, y: -1.28 * basePalm, z: 0 };
    pts[7] = { x: -0.38 * basePalm, y: -1.32 * basePalm, z: 0 };
    // Index tip close to thumb tip (~0.08 * palmScale apart)
    pts[8] = { x: -0.31 * basePalm, y: -1.24 * basePalm, z: 0 };
  } else {
    const idxPts = buildFinger(-0.32 * basePalm, -0.95 * basePalm, index, -0.12 * basePalm);
    pts[5] = idxPts[0];
    pts[6] = idxPts[1];
    pts[7] = idxPts[2];
    pts[8] = idxPts[3];
  }

  // Middle (9..12) — point 9 sits at (0, -basePalm) so palmScale equals basePalm
  const midPts = buildFinger(0, -1.0 * basePalm, middle, 0.04 * basePalm);
  pts[9] = midPts[0];
  pts[10] = midPts[1];
  pts[11] = midPts[2];
  pts[12] = midPts[3];

  // Ring (13..16)
  const ringPts = buildFinger(0.3 * basePalm, -0.92 * basePalm, ring, 0.1 * basePalm);
  pts[13] = ringPts[0];
  pts[14] = ringPts[1];
  pts[15] = ringPts[2];
  pts[16] = ringPts[3];

  // Pinky (17..20)
  const pinkyPts = buildFinger(0.56 * basePalm, -0.82 * basePalm, pinky, 0.18 * basePalm);
  pts[17] = pinkyPts[0];
  pts[18] = pinkyPts[1];
  pts[19] = pinkyPts[2];
  pts[20] = pinkyPts[3];

  // Rotate in the XY plane and translate to (offsetX, offsetY)
  const rad = (rotateDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return pts.map((p) => ({
    x: Number((offsetX + p.x * cosA - p.y * sinA).toFixed(6)),
    y: Number((offsetY + p.x * sinA + p.y * cosA).toFixed(6)),
    z: Number(p.z.toFixed(6)),
  }));
}

export const SYNTHETIC_PRESETS = Object.freeze({
  MANO_ABIERTA: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
      ...opts,
    }),
  PUNO: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: false,
      middle: false,
      ring: false,
      pinky: false,
      ...opts,
    }),
  UNO: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
      ...opts,
    }),
  DOS: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      ...opts,
    }),
  OK: (opts = {}) =>
    buildSyntheticHand({
      pinch: true,
      middle: true,
      ring: true,
      pinky: true,
      ...opts,
    }),
  BIEN: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: false,
      middle: false,
      ring: false,
      pinky: false,
      ...opts,
    }),
  TE_QUIERO: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: false,
      ring: false,
      pinky: true,
      ...opts,
    }),
  LUNES: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
      ...opts,
    }),
});
