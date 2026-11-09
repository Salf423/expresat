/**
 * src/recognition/syntheticHand.js — Generador determinista de landmarks 3D de mano (21 puntos)
 *
 * Útil tanto para las pruebas unitarias de `recognition/` como para el modo demo sintético
 * en pruebas E2E de navegador cuando se usa `--use-fake-device-for-media-stream`.
 */

/**
 * Construye una mano sintética anatómicamente coherente de 21 landmarks.
 * Por defecto `WRIST (0)` está en `(0.5, 0.7, 0)` y `MIDDLE_MCP (9)` en `(0.5, 0.55, 0)`,
 * por lo que `palmScale = 0.15`.
 *
 * @param {Object} config
 * @param {boolean} [config.thumb=false]
 * @param {boolean} [config.index=false]
 * @param {boolean} [config.middle=false]
 * @param {boolean} [config.ring=false]
 * @param {boolean} [config.pinky=false]
 * @param {boolean} [config.pinch=false] Si es true, une la punta del pulgar (4) e índice (8) formando "OK / Pinza"
 * @param {number} [config.scale=1.0] Factor de escala multiplicativo
 * @param {number} [config.rotateDeg=0] Rotación en el plano XY (grados)
 * @param {number} [config.offsetX=0.5] Coordenada X de la muñeca
 * @param {number} [config.offsetY=0.7] Coordenada Y de la muñeca
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

  // 0: WRIST en el origen local (0, 0, 0)
  pts[0] = { x: 0, y: 0, z: 0 };

  // Helper para dedo largo en coordenadas locales (donde -Y es hacia arriba)
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
    // Dedo doblado hacia la palma (curled: PIP sube un poco pero DIP y TIP se doblan de regreso hacia la palma)
    return [
      mcp,
      { x: mcpX, y: mcpY - 0.25 * basePalm, z: -0.02 * basePalm },
      { x: mcpX, y: mcpY - 0.05 * basePalm, z: -0.04 * basePalm },
      { x: mcpX, y: mcpY + 0.12 * basePalm, z: -0.03 * basePalm },
    ];
  }

  // Pulgar (1..4)
  if (pinch) {
    // Pulgar e índice convergen al punto de pinza (-0.32 * basePalm, -1.25 * basePalm)
    pts[1] = { x: -0.25 * basePalm, y: -0.25 * basePalm, z: 0 };
    pts[2] = { x: -0.38 * basePalm, y: -0.58 * basePalm, z: 0 };
    pts[3] = { x: -0.42 * basePalm, y: -0.92 * basePalm, z: 0 };
    pts[4] = { x: -0.32 * basePalm, y: -1.22 * basePalm, z: 0 };
  } else if (thumb) {
    // Pulgar extendido abducido hacia la izquierda (-X) en línea recta desde CMC
    pts[1] = { x: -0.28 * basePalm, y: -0.25 * basePalm, z: 0 };
    pts[2] = { x: -0.55 * basePalm, y: -0.5 * basePalm, z: 0 };
    pts[3] = { x: -0.82 * basePalm, y: -0.75 * basePalm, z: 0 };
    pts[4] = { x: -1.1 * basePalm, y: -1.0 * basePalm, z: 0 };
  } else {
    // Pulgar doblado sobre la palma hacia el nudillo medio/anular
    pts[1] = { x: -0.22 * basePalm, y: -0.22 * basePalm, z: 0 };
    pts[2] = { x: -0.28 * basePalm, y: -0.45 * basePalm, z: -0.02 * basePalm };
    pts[3] = { x: -0.12 * basePalm, y: -0.58 * basePalm, z: -0.03 * basePalm };
    pts[4] = { x: 0.05 * basePalm, y: -0.55 * basePalm, z: -0.03 * basePalm };
  }

  // Índice (5..8)
  if (pinch) {
    pts[5] = { x: -0.32 * basePalm, y: -0.95 * basePalm, z: 0 };
    pts[6] = { x: -0.42 * basePalm, y: -1.28 * basePalm, z: 0 };
    pts[7] = { x: -0.38 * basePalm, y: -1.32 * basePalm, z: 0 };
    // Punta del índice muy cerca de la punta del pulgar (distancia ~0.08 * palmScale)
    pts[8] = { x: -0.31 * basePalm, y: -1.24 * basePalm, z: 0 };
  } else {
    const idxPts = buildFinger(-0.32 * basePalm, -0.95 * basePalm, index, -0.12 * basePalm);
    pts[5] = idxPts[0];
    pts[6] = idxPts[1];
    pts[7] = idxPts[2];
    pts[8] = idxPts[3];
  }

  // Medio (9..12) — NOTA: punto 9 está en (0, -basePalm) para que palmScale sea exactamente basePalm
  const midPts = buildFinger(0, -1.0 * basePalm, middle, 0.04 * basePalm);
  pts[9] = midPts[0];
  pts[10] = midPts[1];
  pts[11] = midPts[2];
  pts[12] = midPts[3];

  // Anular (13..16)
  const ringPts = buildFinger(0.3 * basePalm, -0.92 * basePalm, ring, 0.1 * basePalm);
  pts[13] = ringPts[0];
  pts[14] = ringPts[1];
  pts[15] = ringPts[2];
  pts[16] = ringPts[3];

  // Meñique (17..20)
  const pinkyPts = buildFinger(0.56 * basePalm, -0.82 * basePalm, pinky, 0.18 * basePalm);
  pts[17] = pinkyPts[0];
  pts[18] = pinkyPts[1];
  pts[19] = pinkyPts[2];
  pts[20] = pinkyPts[3];

  // Rotar en el plano XY y trasladar a (offsetX, offsetY)
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
