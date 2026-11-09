/**
 * src/recognition/syntheticHand.js — Generador determinista de landmarks 3D de mano (21 puntos) para LSM
 *
 * Soporta:
 * - Posturas base, números (0–10) y alfabeto completo de LSM (A–Z, Ñ, LL, RR).
 * - Mano derecha e izquierda (`mirrorX` / `handedness`), palma al frente (`FRONT`), dorso (`BACK`) y perfil (`SIDE`).
 * - Estados de flexión finos (`EXTENDED`, `HOOKED`, `CURLED`, `SEMI`), adución (`adducted`) y cruce (`crossIndexMiddle`).
 * - Generación de secuencias dinámicas con timestamps en milisegundos para FPS variable (15–30 FPS).
 */

/**
 * Construye una mano sintética anatómicamente coherente de 21 landmarks.
 * Por defecto `WRIST (0)` está en `(0.5, 0.7, 0)` y `MIDDLE_MCP (9)` en `(0.5, 0.55, 0)`,
 * por lo que `palmScale = 0.15`.
 */
export function buildSyntheticHand({
  thumb = false,
  index = false,
  middle = false,
  ring = false,
  pinky = false,
  pinch = false,
  thumbMode = null, // 'EXTENDED' | 'CURLED' | 'SIDE_A' | 'ACROSS_S' | 'BETWEEN_T' | 'UNDER_E' | 'CIRCLE_O' | 'TOUCH_MIDDLE_D' | 'PINCH_F' | 'BETWEEN_PK' | 'HOOKED_Q'
  adducted = false, // Si es true, los dedos extendidos se mantienen juntos (B, U, H, M, N, F)
  crossIndexMiddle = false, // Si es true, cruza las puntas de índice y medio (R, RR)
  palmFacing = 'FRONT', // 'FRONT' | 'BACK' | 'SIDE'
  handedness = 'Right', // 'Right' | 'Left'
  mirrorX = false,
  scale = 1.0,
  rotateDeg = 0,
  offsetX = 0.5,
  offsetY = 0.7,
  timestampMs = null,
} = {}) {
  const basePalm = 0.15 * scale;
  const pts = new Array(21);

  // 0: WRIST en el origen local (0, 0, 0)
  pts[0] = { x: 0, y: 0, z: 0 };

  /**
   * Helper para dedo largo en coordenadas locales (donde -Y es hacia arriba).
   * `mode` puede ser boolean (`true` = EXTENDED, `false` = CURLED) o string:
   * `'EXTENDED' | 'HOOKED' | 'ARCHED_C' | 'CIRCLE_O' | 'TOUCH_THUMB_D' | 'SEMI_PK' | 'CURLED'`
   */
  function buildFinger(mcpX, mcpY, mode, spreadX = 0) {
    const mcp = { x: mcpX, y: mcpY, z: 0 };
    const effectiveSpread = adducted ? spreadX * 0.15 : spreadX;

    if (mode === true || mode === 'EXTENDED') {
      return [
        mcp,
        { x: mcpX + effectiveSpread * 0.35, y: mcpY - 0.45 * basePalm, z: 0 },
        { x: mcpX + effectiveSpread * 0.7, y: mcpY - 0.8 * basePalm, z: 0 },
        { x: mcpX + effectiveSpread * 1.0, y: mcpY - 1.12 * basePalm, z: 0 },
      ];
    }

    if (mode === 'SEMI_PK') {
      // Dedo medio en P / K: semi-extendido/inclinado hacia adelante y ligeramente más bajo que el índice
      return [
        mcp,
        { x: mcpX - 0.05 * basePalm, y: mcpY - 0.42 * basePalm, z: -0.08 * basePalm },
        { x: mcpX - 0.12 * basePalm, y: mcpY - 0.66 * basePalm, z: -0.15 * basePalm },
        { x: mcpX - 0.16 * basePalm, y: mcpY - 0.82 * basePalm, z: -0.2 * basePalm },
      ];
    }

    if (mode === 'ARCHED_C') {
      // Semicírculo abierto para la letra C (PIP ~ 115°–125°, puntas altas y separadas del pulgar)
      return [
        mcp,
        { x: mcpX - 0.08 * basePalm, y: mcpY - 0.42 * basePalm, z: -0.04 * basePalm },
        { x: mcpX - 0.28 * basePalm, y: mcpY - 0.62 * basePalm, z: -0.08 * basePalm },
        { x: mcpX - 0.48 * basePalm, y: mcpY - 0.56 * basePalm, z: -0.1 * basePalm },
      ];
    }

    if (mode === 'HOOKED') {
      // Garra alta para E, X, Q (PIP ~ 105°, punta alta por encima de MCP: tip.y < mcp.y - 0.35)
      return [
        mcp,
        { x: mcpX, y: mcpY - 0.45 * basePalm, z: -0.03 * basePalm },
        { x: mcpX - 0.06 * basePalm, y: mcpY - 0.56 * basePalm, z: -0.12 * basePalm },
        { x: mcpX - 0.08 * basePalm, y: mcpY - 0.4 * basePalm, z: -0.1 * basePalm },
      ];
    }

    if (mode === 'CIRCLE_O') {
      // Dedos curvados cuyas puntas convergen al punto de contacto con el pulgar (-0.34, -1.18)
      return [
        mcp,
        { x: mcpX - 0.06 * basePalm, y: mcpY - 0.38 * basePalm, z: -0.03 * basePalm },
        { x: (mcpX - 0.34 * basePalm) * 0.5, y: -1.32 * basePalm, z: -0.05 * basePalm },
        { x: -0.31 * basePalm + mcpX * 0.08, y: -1.2 * basePalm, z: -0.03 * basePalm },
      ];
    }

    if (mode === 'TOUCH_THUMB_D') {
      // Dedo medio bajando para tocar la punta del pulgar en la letra D
      return [
        mcp,
        { x: mcpX - 0.05 * basePalm, y: mcpY - 0.32 * basePalm, z: -0.04 * basePalm },
        { x: -0.16 * basePalm, y: -1.18 * basePalm, z: -0.06 * basePalm },
        { x: -0.26 * basePalm, y: -1.04 * basePalm, z: -0.04 * basePalm },
      ];
    }

    // Dedo doblado hacia la palma (CURLED: PIP sube un poco pero DIP y TIP se pliegan en la palma)
    return [
      mcp,
      { x: mcpX, y: mcpY - 0.25 * basePalm, z: -0.02 * basePalm },
      { x: mcpX, y: mcpY - 0.05 * basePalm, z: -0.04 * basePalm },
      { x: mcpX, y: mcpY + 0.12 * basePalm, z: -0.03 * basePalm },
    ];
  }

  // Pulgar (1..4)
  const effectiveThumbMode =
    thumbMode || (pinch ? 'PINCH' : thumb === true ? 'EXTENDED' : typeof thumb === 'string' ? thumb : 'CURLED');

  switch (effectiveThumbMode) {
    case 'PINCH':
    case 'PINCH_F':
    case 'CIRCLE_O':
      pts[1] = { x: -0.25 * basePalm, y: -0.25 * basePalm, z: 0 };
      pts[2] = { x: -0.38 * basePalm, y: -0.58 * basePalm, z: 0 };
      pts[3] = { x: -0.42 * basePalm, y: -0.92 * basePalm, z: 0 };
      pts[4] = { x: -0.32 * basePalm, y: -1.22 * basePalm, z: 0 };
      break;
    case 'SIDE_A':
      // Letra A: pulgar recto pegado verticalmente al costado radial del índice (x4 < x5 = -0.32)
      pts[1] = { x: -0.26 * basePalm, y: -0.25 * basePalm, z: 0 };
      pts[2] = { x: -0.36 * basePalm, y: -0.52 * basePalm, z: 0 };
      pts[3] = { x: -0.42 * basePalm, y: -0.82 * basePalm, z: 0 };
      pts[4] = { x: -0.45 * basePalm, y: -1.1 * basePalm, z: 0 };
      break;
    case 'BETWEEN_T':
      // Letra T: punta del pulgar asomando entre las falanges proximales de índice (-0.32) y medio (0.0)
      pts[1] = { x: -0.24 * basePalm, y: -0.24 * basePalm, z: 0 };
      pts[2] = { x: -0.28 * basePalm, y: -0.55 * basePalm, z: -0.01 * basePalm };
      pts[3] = { x: -0.22 * basePalm, y: -0.88 * basePalm, z: -0.02 * basePalm };
      pts[4] = { x: -0.16 * basePalm, y: -1.14 * basePalm, z: -0.02 * basePalm };
      break;
    case 'BETWEEN_PK':
      // Letras P y K: punta del pulgar apoyada sobre el dedo medio entre índice y medio
      pts[1] = { x: -0.24 * basePalm, y: -0.25 * basePalm, z: 0 };
      pts[2] = { x: -0.26 * basePalm, y: -0.56 * basePalm, z: -0.02 * basePalm };
      pts[3] = { x: -0.2 * basePalm, y: -0.88 * basePalm, z: -0.04 * basePalm };
      pts[4] = { x: -0.14 * basePalm, y: -1.18 * basePalm, z: -0.05 * basePalm };
      break;
    case 'UNDER_E':
      // Letra E: pulgar doblado horizontalmente en la parte baja de la palma, lejos de las puntas en garra
      pts[1] = { x: -0.22 * basePalm, y: -0.22 * basePalm, z: 0 };
      pts[2] = { x: -0.26 * basePalm, y: -0.44 * basePalm, z: -0.02 * basePalm };
      pts[3] = { x: -0.05 * basePalm, y: -0.54 * basePalm, z: -0.03 * basePalm };
      pts[4] = { x: 0.16 * basePalm, y: -0.54 * basePalm, z: -0.03 * basePalm };
      break;
    case 'ARCHED_C':
      // Letra C: pulgar arqueado hacia adelante dejando una abertura semicircular con el índice (~0.58 * palmScale)
      pts[1] = { x: -0.25 * basePalm, y: -0.25 * basePalm, z: 0 };
      pts[2] = { x: -0.46 * basePalm, y: -0.48 * basePalm, z: -0.02 * basePalm };
      pts[3] = { x: -0.62 * basePalm, y: -0.72 * basePalm, z: -0.04 * basePalm };
      pts[4] = { x: -0.68 * basePalm, y: -0.94 * basePalm, z: -0.06 * basePalm };
      break;
    case 'HOOKED_Q':
      // Letra Q: pulgar semi-arqueado oponiéndose al índice en garra
      pts[1] = { x: -0.26 * basePalm, y: -0.25 * basePalm, z: 0 };
      pts[2] = { x: -0.42 * basePalm, y: -0.52 * basePalm, z: -0.02 * basePalm };
      pts[3] = { x: -0.48 * basePalm, y: -0.8 * basePalm, z: -0.03 * basePalm };
      pts[4] = { x: -0.42 * basePalm, y: -0.98 * basePalm, z: -0.04 * basePalm };
      break;
    case 'TOUCH_MIDDLE_D':
      // Letra D: pulgar sube para tocar la punta del dedo medio (-0.26, -1.04)
      pts[1] = { x: -0.24 * basePalm, y: -0.25 * basePalm, z: 0 };
      pts[2] = { x: -0.34 * basePalm, y: -0.54 * basePalm, z: -0.02 * basePalm };
      pts[3] = { x: -0.32 * basePalm, y: -0.82 * basePalm, z: -0.03 * basePalm };
      pts[4] = { x: -0.26 * basePalm, y: -1.02 * basePalm, z: -0.04 * basePalm };
      break;
    case 'EXTENDED':
      pts[1] = { x: -0.28 * basePalm, y: -0.25 * basePalm, z: 0 };
      pts[2] = { x: -0.55 * basePalm, y: -0.5 * basePalm, z: 0 };
      pts[3] = { x: -0.82 * basePalm, y: -0.75 * basePalm, z: 0 };
      pts[4] = { x: -1.1 * basePalm, y: -1.0 * basePalm, z: 0 };
      break;
    case 'ACROSS_S':
    case 'CURLED':
    default:
      // Pulgar doblado cruzando sobre la palma hacia el nudillo medio/anular (Puño / S)
      pts[1] = { x: -0.22 * basePalm, y: -0.22 * basePalm, z: 0 };
      pts[2] = { x: -0.28 * basePalm, y: -0.45 * basePalm, z: -0.02 * basePalm };
      pts[3] = { x: -0.12 * basePalm, y: -0.58 * basePalm, z: -0.03 * basePalm };
      pts[4] = { x: 0.05 * basePalm, y: -0.55 * basePalm, z: -0.03 * basePalm };
      break;
  }

  // Índice (5..8)
  if (pinch || effectiveThumbMode === 'PINCH_F') {
    pts[5] = { x: -0.32 * basePalm, y: -0.95 * basePalm, z: 0 };
    pts[6] = { x: -0.42 * basePalm, y: -1.28 * basePalm, z: 0 };
    pts[7] = { x: -0.38 * basePalm, y: -1.32 * basePalm, z: 0 };
    pts[8] = { x: -0.31 * basePalm, y: -1.24 * basePalm, z: 0 };
  } else {
    const idxPts = buildFinger(-0.32 * basePalm, -0.95 * basePalm, index, -0.12 * basePalm);
    pts[5] = idxPts[0];
    pts[6] = idxPts[1];
    pts[7] = idxPts[2];
    pts[8] = idxPts[3];
  }

  // Medio (9..12) — punto 9 está en (0, -basePalm) para que palmScale sea exactamente basePalm
  const midPts = buildFinger(0, -1.0 * basePalm, middle, 0.04 * basePalm);
  pts[9] = midPts[0];
  pts[10] = midPts[1];
  pts[11] = midPts[2];
  pts[12] = midPts[3];

  if (crossIndexMiddle) {
    // En la letra R (y RR), las falanges distales de índice y medio convergen y se cruzan
    pts[6] = { x: -0.18 * basePalm, y: -1.4 * basePalm, z: 0 };
    pts[7] = { x: -0.08 * basePalm, y: -1.75 * basePalm, z: 0 };
    pts[8] = { x: 0.02 * basePalm, y: -2.07 * basePalm, z: 0 };

    pts[10] = { x: -0.08 * basePalm, y: -1.45 * basePalm, z: -0.02 * basePalm };
    pts[11] = { x: -0.12 * basePalm, y: -1.8 * basePalm, z: -0.03 * basePalm };
    pts[12] = { x: -0.14 * basePalm, y: -2.12 * basePalm, z: -0.04 * basePalm };
  }

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

  // Ajustar orientación de palma (FRONT, BACK, SIDE) y mano izquierda/derecha:
  // - Para mano derecha FRONT: flipX = +1
  // - Para mano derecha BACK (dorso a cámara): la mano gira 180° sobre su eje longitudinal, invirtiendo X (flipX = -1)
  // - Para mano izquierda FRONT: es el espejo horizontal de la derecha FRONT (flipX = -1)
  // - Para mano izquierda BACK: flipX = +1
  const isLeft = typeof handedness === 'string' && handedness.toLowerCase().startsWith('l');
  let flipX = 1;
  if (palmFacing === 'BACK') flipX *= -1;
  if (isLeft) flipX *= -1;
  if (mirrorX) flipX *= -1;

  const scaleX = palmFacing === 'SIDE' ? 0.25 : 1.0;

  // Rotar en el plano XY y trasladar a (offsetX, offsetY)
  const rad = (rotateDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const out = pts.map((p) => {
    const px = p.x * flipX * scaleX;
    const py = p.y;
    return {
      x: Number((offsetX + px * cosA - py * sinA).toFixed(6)),
      y: Number((offsetY + px * sinA + py * cosA).toFixed(6)),
      z: Number(p.z.toFixed(6)),
    };
  });

  if (handedness) {
    Object.defineProperty(out, 'handedness', {
      value: isLeft ? 'Left' : 'Right',
      enumerable: false,
      configurable: true,
    });
  }
  if (typeof timestampMs === 'number') {
    Object.defineProperty(out, 'timestampMs', {
      value: timestampMs,
      enumerable: false,
      configurable: true,
    });
  }

  return out;
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

export const SYNTHETIC_NUMBERS = Object.freeze({
  0: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'CIRCLE_O',
      index: 'CIRCLE_O',
      middle: 'CIRCLE_O',
      ring: 'CIRCLE_O',
      pinky: 'CIRCLE_O',
      ...opts,
    }),
  1: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
      ...opts,
    }),
  2: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      ...opts,
    }),
  3: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: true,
      pinky: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  4: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
      adducted: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  5: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
      ...opts,
    }),
  6: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: false,
      middle: false,
      ring: false,
      pinky: false,
      palmFacing: 'BACK',
      ...opts,
    }),
  7: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
      rotateDeg: 45,
      palmFacing: 'BACK',
      ...opts,
    }),
  8: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      palmFacing: 'BACK',
      ...opts,
    }),
  9: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
      palmFacing: 'BACK',
      ...opts,
    }),
  10: (opts = {}) => {
    const fps = opts.fps ?? 25;
    const stepMs = 1000 / fps;
    const frames = [];
    for (let i = 0; i < 12; i++) {
      const palmFacing = i < 6 ? 'FRONT' : 'BACK';
      frames.push(
        buildSyntheticHand({
          thumb: true,
          index: true,
          middle: true,
          ring: true,
          pinky: true,
          palmFacing,
          timestampMs: i * stepMs,
          ...opts,
        })
      );
    }
    return frames;
  },
});

export const SYNTHETIC_LETTERS = Object.freeze({
  A: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'SIDE_A',
      index: false,
      middle: false,
      ring: false,
      pinky: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  B: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: true,
      pinky: true,
      adducted: true,
      palmFacing: 'FRONT',
      ...opts,
    }),
  C: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'ARCHED_C',
      index: 'ARCHED_C',
      middle: 'ARCHED_C',
      ring: 'ARCHED_C',
      pinky: 'ARCHED_C',
      palmFacing: 'FRONT',
      ...opts,
    }),
  D: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'TOUCH_MIDDLE_D',
      index: true,
      middle: 'TOUCH_THUMB_D',
      ring: false,
      pinky: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  E: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'UNDER_E',
      index: 'HOOKED',
      middle: 'HOOKED',
      ring: 'HOOKED',
      pinky: 'HOOKED',
      palmFacing: 'FRONT',
      ...opts,
    }),
  F: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'PINCH_F',
      pinch: true,
      middle: true,
      ring: true,
      pinky: true,
      adducted: true,
      palmFacing: 'FRONT',
      ...opts,
    }),
  G: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
      rotateDeg: 90,
      palmFacing: 'BACK',
      ...opts,
    }),
  H: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      adducted: true,
      rotateDeg: 90,
      palmFacing: 'BACK',
      ...opts,
    }),
  I: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: false,
      middle: false,
      ring: false,
      pinky: true,
      palmFacing: 'FRONT',
      ...opts,
    }),
  L: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: true,
      middle: false,
      ring: false,
      pinky: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  M: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: true,
      pinky: false,
      adducted: true,
      rotateDeg: 180,
      palmFacing: 'BACK',
      ...opts,
    }),
  N: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      adducted: true,
      rotateDeg: 180,
      palmFacing: 'BACK',
      ...opts,
    }),
  O: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'CIRCLE_O',
      index: 'CIRCLE_O',
      middle: 'CIRCLE_O',
      ring: 'CIRCLE_O',
      pinky: 'CIRCLE_O',
      ...opts,
    }),
  P: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'BETWEEN_PK',
      index: true,
      middle: 'SEMI_PK',
      ring: false,
      pinky: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  R: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      crossIndexMiddle: true,
      palmFacing: 'FRONT',
      ...opts,
    }),
  S: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'ACROSS_S',
      index: false,
      middle: false,
      ring: false,
      pinky: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  T: (opts = {}) =>
    buildSyntheticHand({
      thumbMode: 'BETWEEN_T',
      index: false,
      middle: false,
      ring: false,
      pinky: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  U: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      adducted: true,
      palmFacing: 'FRONT',
      ...opts,
    }),
  V: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: false,
      pinky: false,
      adducted: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  W: (opts = {}) =>
    buildSyntheticHand({
      thumb: false,
      index: true,
      middle: true,
      ring: true,
      pinky: false,
      adducted: false,
      palmFacing: 'FRONT',
      ...opts,
    }),
  Y: (opts = {}) =>
    buildSyntheticHand({
      thumb: true,
      index: false,
      middle: false,
      ring: false,
      pinky: true,
      rotateDeg: 90,
      palmFacing: 'BACK',
      ...opts,
    }),
});
