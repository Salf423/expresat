import { describe, it, expect } from 'vitest';
import { buildSyntheticHand, SYNTHETIC_PRESETS } from '../../recognition/index.js';
import { ALL_LEARNING_SIGNS, getLearningSignById } from '../catalog.js';
import { evaluateTargetSign, TargetedPracticeEvaluator } from '../targetEvaluator.js';
import { PracticeSessionMachine } from '../practiceSession.js';

/**
 * Helper: transforms local canonical 21-point hand coordinates into screen coordinates
 * with chirality (`handedness` + `palmFacing`), XY rotation (`rotateDeg`), and offset.
 */
function transformHand(
  localPts,
  { handedness = 'Right', palmFacing = 'FRONT', rotateDeg = 0, offsetX = 0.5, offsetY = 0.7 } = {}
) {
  const xFlip = (handedness === 'Right') !== (palmFacing === 'BACK') ? -1 : 1;
  const rad = (rotateDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  return localPts.map((p) => {
    const lx = p.x * xFlip;
    const ly = p.y;
    return {
      x: Number((offsetX + lx * cosA - ly * sinA).toFixed(6)),
      y: Number((offsetY + lx * sinA + ly * cosA).toFixed(6)),
      z: Number((p.z ?? 0).toFixed(6)),
    };
  });
}

function buildCustomLocalHand({
  thumbMode = 'curled', // 'extended' | 'curled' | 'adducted' | 'tucked' | 'between' | 'pinch' | 'oval' | 'arch' | 'hook'
  indexMode = 'curled', // 'extended' | 'curled' | 'pinch' | 'oval' | 'arch' | 'claw' | 'hook'
  middleMode = 'curled',
  ringMode = 'curled',
  pinkyMode = 'curled',
  spreadMode = 'normal', // 'normal' | 'together' | 'apart' | 'crossed'
  scale = 1.0,
} = {}) {
  const s = 0.15 * scale;
  const pts = new Array(21);
  pts[0] = { x: 0, y: 0, z: 0 };

  const longFinger = (mcpX, mcpY, mode, spreadX) => {
    const mcp = { x: mcpX, y: mcpY, z: 0 };
    if (mode === 'extended') {
      return [
        mcp,
        { x: mcpX + spreadX * 0.35, y: mcpY - 0.45 * s, z: 0 },
        { x: mcpX + spreadX * 0.7, y: mcpY - 0.8 * s, z: 0 },
        { x: mcpX + spreadX * 1.0, y: mcpY - 1.12 * s, z: 0 },
      ];
    }
    if (mode === 'arch') {
      // Smooth C-curve (~132° at PIP, ~125° at DIP) arching forward toward -Z
      return [
        mcp,
        { x: mcpX - 0.04 * s, y: mcpY - 0.42 * s, z: -0.06 * s },
        { x: mcpX - 0.06 * s, y: mcpY - 0.56 * s, z: -0.3 * s },
        { x: mcpX - 0.02 * s, y: mcpY - 0.4 * s, z: -0.5 * s },
      ];
    }
    if (mode === 'hook') {
      return [
        mcp,
        { x: mcpX, y: mcpY - 0.46 * s, z: -0.04 * s },
        { x: mcpX - 0.04 * s, y: mcpY - 0.56 * s, z: -0.16 * s },
        { x: mcpX - 0.04 * s, y: mcpY - 0.32 * s, z: -0.24 * s },
      ];
    }
    if (mode === 'claw') {
      return [
        mcp,
        { x: mcpX, y: mcpY - 0.36 * s, z: -0.05 * s },
        { x: mcpX, y: mcpY - 0.28 * s, z: -0.16 * s },
        { x: mcpX, y: mcpY - 0.08 * s, z: -0.18 * s },
      ];
    }
    if (mode === 'pinch') {
      return [
        mcp,
        { x: -0.42 * s, y: -1.28 * s, z: 0 },
        { x: -0.38 * s, y: -1.32 * s, z: 0 },
        { x: -0.31 * s, y: -1.24 * s, z: 0 },
      ];
    }
    // curled
    return [
      mcp,
      { x: mcpX, y: mcpY - 0.25 * s, z: -0.02 * s },
      { x: mcpX, y: mcpY - 0.05 * s, z: -0.04 * s },
      { x: mcpX, y: mcpY + 0.12 * s, z: -0.03 * s },
    ];
  };

  // Thumb
  if (thumbMode === 'extended') {
    pts[1] = { x: -0.28 * s, y: -0.25 * s, z: 0 };
    pts[2] = { x: -0.55 * s, y: -0.5 * s, z: 0 };
    pts[3] = { x: -0.82 * s, y: -0.75 * s, z: 0 };
    pts[4] = { x: -1.1 * s, y: -1.0 * s, z: 0 };
  } else if (thumbMode === 'adducted') {
    // Straight upright alongside index side (Letra A / Ayuda / Agua)
    pts[1] = { x: -0.28 * s, y: -0.25 * s, z: 0 };
    pts[2] = { x: -0.44 * s, y: -0.58 * s, z: 0 };
    pts[3] = { x: -0.48 * s, y: -0.92 * s, z: 0 };
    pts[4] = { x: -0.46 * s, y: -1.26 * s, z: 0 };
  } else if (thumbMode === 'tucked') {
    // Tucked between index and middle (Letra T / Trabajo)
    pts[1] = { x: -0.24 * s, y: -0.24 * s, z: 0 };
    pts[2] = { x: -0.3 * s, y: -0.52 * s, z: -0.02 * s };
    pts[3] = { x: -0.22 * s, y: -0.78 * s, z: -0.04 * s };
    pts[4] = { x: -0.14 * s, y: -0.92 * s, z: -0.05 * s };
  } else if (thumbMode === 'between') {
    // Supported between index & middle PIPs (Letra K / Letra P / Con permiso)
    pts[1] = { x: -0.26 * s, y: -0.26 * s, z: 0 };
    pts[2] = { x: -0.34 * s, y: -0.58 * s, z: -0.02 * s };
    pts[3] = { x: -0.24 * s, y: -0.92 * s, z: -0.04 * s };
    pts[4] = { x: -0.1 * s, y: -1.24 * s, z: -0.04 * s };
  } else if (thumbMode === 'pinch') {
    pts[1] = { x: -0.25 * s, y: -0.25 * s, z: 0 };
    pts[2] = { x: -0.38 * s, y: -0.58 * s, z: 0 };
    pts[3] = { x: -0.42 * s, y: -0.92 * s, z: 0 };
    pts[4] = { x: -0.32 * s, y: -1.22 * s, z: 0 };
  } else if (thumbMode === 'arch') {
    // Open C-arc thumb (clear gap from index tip at ~(-0.36, -1.47))
    pts[1] = { x: -0.28 * s, y: -0.26 * s, z: 0 };
    pts[2] = { x: -0.54 * s, y: -0.52 * s, z: -0.06 * s };
    pts[3] = { x: -0.68 * s, y: -0.78 * s, z: -0.12 * s };
    pts[4] = { x: -0.62 * s, y: -0.98 * s, z: -0.16 * s };
  } else if (thumbMode === 'hook') {
    pts[1] = { x: -0.28 * s, y: -0.25 * s, z: 0 };
    pts[2] = { x: -0.5 * s, y: -0.55 * s, z: -0.04 * s };
    pts[3] = { x: -0.58 * s, y: -0.86 * s, z: -0.1 * s };
    pts[4] = { x: -0.48 * s, y: -1.06 * s, z: -0.16 * s };
  } else {
    // curled across palm
    pts[1] = { x: -0.22 * s, y: -0.22 * s, z: 0 };
    pts[2] = { x: -0.28 * s, y: -0.45 * s, z: -0.02 * s };
    pts[3] = { x: -0.12 * s, y: -0.58 * s, z: -0.03 * s };
    pts[4] = { x: 0.05 * s, y: -0.55 * s, z: -0.03 * s };
  }

  let idxSpread = -0.12 * s;
  let midSpread = 0.04 * s;
  let ringSpread = 0.1 * s;
  let pinkySpread = 0.18 * s;

  if (spreadMode === 'together') {
    idxSpread = 0.08 * s;
    midSpread = -0.04 * s;
    ringSpread = -0.06 * s;
    pinkySpread = -0.08 * s;
  } else if (spreadMode === 'apart') {
    idxSpread = -0.24 * s;
    midSpread = 0.12 * s;
    ringSpread = 0.24 * s;
  } else if (spreadMode === 'crossed') {
    // Middle crosses past index toward -X
    idxSpread = 0.2 * s;
    midSpread = -0.26 * s;
  }

  const iPts = longFinger(-0.32 * s, -0.95 * s, indexMode, idxSpread);
  const mPts = longFinger(0, -1.0 * s, middleMode, midSpread);
  const rPts = longFinger(0.3 * s, -0.92 * s, ringMode, ringSpread);
  const pPts = longFinger(0.56 * s, -0.82 * s, pinkyMode, pinkySpread);

  [5, 6, 7, 8].forEach((idx, k) => (pts[idx] = iPts[k]));
  [9, 10, 11, 12].forEach((idx, k) => (pts[idx] = mPts[k]));
  [13, 14, 15, 16].forEach((idx, k) => (pts[idx] = rPts[k]));
  [17, 18, 19, 20].forEach((idx, k) => (pts[idx] = pPts[k]));

  return pts;
}

/**
 * Generates a canonical 21-point static hand pose for ANY of the 70 signs in `ALL_LEARNING_SIGNS`.
 */
function buildCanonicalHandForSign(
  sign,
  { handedness = 'Right', offsetX = 0.5, offsetY = 0.7, scale = 1.0, palmFacingOverride = null } = {}
) {
  const p = sign.profile;
  const palmFacing =
    palmFacingOverride || (p.orientation === 'BACK' ? 'BACK' : 'FRONT');

  let rotateDeg = 0;
  if (p.handDirection === 'DOWN') rotateDeg = 180;
  else if (p.handDirection === 'HORIZONTAL') rotateDeg = 90;
  else if (p.handDirection === 'TILTED') rotateDeg = 40;

  if (p.zeroOval) {
    return buildSyntheticHand({
      zeroOval: true,
      handedness,
      palmFacing,
      rotateDeg,
      offsetX,
      offsetY,
      scale,
    });
  }

  const mapFinger = (val) => {
    if (val === true) return 'extended';
    if (val === false || val === 'any') return 'curled';
    return val; // 'adducted' | 'tucked' | 'between' | 'pinch' | 'arch' | 'claw' | 'hook'
  };

  // For Letra D / Disculpa, thumb curves toward curled middle finger tip
  let thumbMode = mapFinger(p.fingers.thumb);
  if (p.dCircle) thumbMode = 'curled';

  const local = buildCustomLocalHand({
    thumbMode,
    indexMode: mapFinger(p.fingers.index),
    middleMode: mapFinger(p.fingers.middle),
    ringMode: mapFinger(p.fingers.ring),
    pinkyMode: mapFinger(p.fingers.pinky),
    spreadMode: p.fingerSpread || 'normal',
    scale,
  });

  return transformHand(local, { handedness, palmFacing, rotateDeg, offsetX, offsetY });
}

/**
 * Generates a realistic timestamped `t_ms` trajectory for any dynamic sign in `ALL_LEARNING_SIGNS`.
 */
function buildTrajectoryForSign(sign, { handedness = 'Right', startMs = 1000 } = {}) {
  const motion = sign.profile.dynamicMotion;
  const handId = handedness === 'Right' ? 'rightHand' : 'leftHand';

  if (!motion) {
    const lm = buildCanonicalHandForSign(sign, { handedness });
    return {
      frame: { [handId]: lm, timestamp: startMs },
      history: [{ t_ms: startMs, handId, landmarks: lm }],
    };
  }

  const history = [];
  const stepMs = 66; // ~15 FPS
  let lastLm = null;
  let lastT = startMs;

  if (motion === 'wave') {
    const xs = [0.5, 0.56, 0.62, 0.55, 0.44, 0.38, 0.46, 0.58, 0.63, 0.52, 0.44];
    xs.forEach((x, i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: x, offsetY: 0.7 });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'rotation' || motion === 'wrist_twist') {
    const facings = ['FRONT', 'FRONT', 'FRONT', 'BACK', 'BACK', 'BACK', 'FRONT', 'FRONT'];
    facings.forEach((facing, i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, {
        handedness,
        palmFacingOverride: facing,
        offsetX: 0.5 + (i % 2 === 0 ? 0.02 : -0.02),
      });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'lateral_shake') {
    const xs = [0.5, 0.55, 0.6, 0.54, 0.45, 0.42, 0.5, 0.56];
    xs.forEach((x, i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: x, offsetY: 0.68 });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'vertical_nod') {
    const ys = [0.68, 0.72, 0.76, 0.71, 0.64, 0.62, 0.69, 0.74];
    ys.forEach((y, i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: 0.5, offsetY: y });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'upward') {
    const ys = [0.78, 0.76, 0.73, 0.7, 0.66, 0.62, 0.58];
    ys.forEach((y, i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: 0.5, offsetY: y });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'downward') {
    const ys = [0.55, 0.58, 0.62, 0.66, 0.7, 0.74, 0.78];
    ys.forEach((y, i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: 0.5, offsetY: y });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'j_curve') {
    const path = [
      [0.54, 0.54],
      [0.54, 0.59],
      [0.54, 0.65],
      [0.52, 0.7],
      [0.48, 0.72],
      [0.44, 0.7],
      [0.42, 0.66],
    ];
    path.forEach(([x, y], i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: x, offsetY: y });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'z_trace') {
    const path = [
      [0.42, 0.55],
      [0.5, 0.55],
      [0.58, 0.55],
      [0.52, 0.62],
      [0.44, 0.7],
      [0.52, 0.7],
      [0.6, 0.7],
    ];
    path.forEach(([x, y], i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: x, offsetY: y });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'pull_back') {
    const xs = [0.46, 0.49, 0.52, 0.56, 0.6, 0.63];
    xs.forEach((x, i) => {
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: x, offsetY: 0.7 });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    });
  } else if (motion === 'circle') {
    const count = 10;
    for (let i = 0; i < count; i++) {
      const theta = (i / (count - 1)) * Math.PI * 2;
      const x = 0.5 + 0.06 * Math.cos(theta);
      const y = 0.66 + 0.06 * Math.sin(theta);
      const t = startMs + i * stepMs;
      const lm = buildCanonicalHandForSign(sign, { handedness, offsetX: x, offsetY: y });
      history.push({ t_ms: t, handId, landmarks: lm });
      lastLm = lm;
      lastT = t;
    }
  } else {
    throw new Error(`Movimiento dinámico desconocido en test: ${motion}`);
  }

  return {
    frame: { [handId]: lastLm, timestamp: lastT },
    history,
  };
}

describe('learning/targetEvaluator — Motor de evaluación dirigida para todo el catálogo LSM', () => {
  it('evalúa con éxito el 100% de las señas del catálogo (~70 señas) con mano derecha e izquierda', () => {
    expect(ALL_LEARNING_SIGNS.length).toBeGreaterThanOrEqual(64);

    for (const sign of ALL_LEARNING_SIGNS) {
      for (const handedness of ['Right', 'Left']) {
        const { frame, history } = buildTrajectoryForSign(sign, { handedness });
        const result = evaluateTargetSign(frame, sign, history);

        expect(
          result.matched,
          `Seña "${sign.id}" (${sign.displayName}) con mano ${handedness} falló: ${result.message}`
        ).toBe(true);
        expect(result.status).toBe('match');
        expect(result.confidence).toBeGreaterThanOrEqual(0.75);
        expect(result.handId).toBe(handedness === 'Right' ? 'rightHand' : 'leftHand');
      }
    }
  });

  it('rechaza todas las señas y letras dinámicas cuando la mano permanece quieta y pide el movimiento concreto', () => {
    const dynamicSigns = ALL_LEARNING_SIGNS.filter((s) => s.type === 'dynamic');
    expect(dynamicSigns.length).toBeGreaterThanOrEqual(20);

    for (const sign of dynamicSigns) {
      const staticHand = buildCanonicalHandForSign(sign, { handedness: 'Right' });
      const stillHistory = Array.from({ length: 8 }, (_, i) => ({
        t_ms: 1000 + i * 66,
        handId: 'rightHand',
        landmarks: staticHand,
      }));
      const res = evaluateTargetSign(
        { rightHand: staticHand, timestamp: 1000 + 7 * 66 },
        sign,
        stillHistory
      );

      expect(res.matched, `Seña dinámica "${sign.id}" NO debe pasar estando quieta`).toBe(false);
      expect(res.postureMatched, `Postura base de "${sign.id}" debe reconocerse válida`).toBe(true);
      expect(res.motionMatched).toBe(false);
      expect(res.motionIssue).toBe(`need_${sign.profile.dynamicMotion}`);
      expect(res.message.length).toBeGreaterThan(15);
    }
  });

  it('distingue pares anatómicos finos del abecedario LSM y emite correcciones concretas en vivo', () => {
    // 1. Letra B (pulgar doblado) vs Cinco (pulgar extendido) -> "Dobla el pulgar hacia la palma"
    const cinco = SYNTHETIC_PRESETS.CINCO({ handedness: 'Right' });
    const fbB = evaluateTargetSign({ rightHand: cinco }, 'letra_b', []);
    expect(fbB.matched).toBe(false);
    expect(fbB.message.toLowerCase()).toContain('dobla el pulgar hacia la palma');
    expect(fbB.fingerStatus.thumb).toBe('curl');

    // 2. Letra I (meñique extendido) vs Puño -> "Extiende el dedo meñique"
    const puno = SYNTHETIC_PRESETS.PUNO({ handedness: 'Left' });
    const fbI = evaluateTargetSign({ leftHand: puno }, 'letra_i', []);
    expect(fbI.matched).toBe(false);
    expect(fbI.message.toLowerCase()).toContain('meñique');
    expect(fbI.fingerStatus.pinky).toBe('extend');

    // 3. Letra U (dedos juntos) vs Letra V (dedos separados) vs Letra R (cruzados)
    const handV = buildCanonicalHandForSign(getLearningSignById('letra_v'), { handedness: 'Right' });
    const handU = buildCanonicalHandForSign(getLearningSignById('letra_u'), { handedness: 'Right' });
    const handR = buildCanonicalHandForSign(getLearningSignById('letra_r'), { handedness: 'Right' });

    const fbUwithV = evaluateTargetSign({ rightHand: handV }, 'letra_u', []);
    expect(fbUwithV.matched).toBe(false);
    expect(fbUwithV.message.toLowerCase()).toContain('junta');

    const fbVwithU = evaluateTargetSign({ rightHand: handU }, 'letra_v', []);
    expect(fbVwithU.matched).toBe(false);
    expect(fbVwithU.message.toLowerCase()).toContain('separa');

    const fbRwithU = evaluateTargetSign({ rightHand: handU }, 'letra_r', []);
    expect(fbRwithU.matched).toBe(false);
    expect(fbRwithU.message.toLowerCase()).toContain('cruza');

    expect(evaluateTargetSign({ rightHand: handR }, 'letra_r', []).matched).toBe(true);

    // 4. Letra A (pulgar recto al costado) vs Puño/S (pulgar doblado)
    const handA = buildCanonicalHandForSign(getLearningSignById('letra_a'), { handedness: 'Right' });
    const fbAwithPuno = evaluateTargetSign({ rightHand: puno }, 'letra_a', []);
    expect(fbAwithPuno.matched).toBe(false);
    expect(fbAwithPuno.message.toLowerCase()).toContain('pulgar');
    expect(evaluateTargetSign({ rightHand: handA }, 'letra_a', []).matched).toBe(true);

    const fbSwithA = evaluateTargetSign({ rightHand: handA }, 'letra_s', []);
    expect(fbSwithA.matched).toBe(false);
    expect(fbSwithA.message.toLowerCase()).toContain('dobla el pulgar');

    // 5. Letra N (dedos hacia abajo) vs Letra U (dedos hacia arriba)
    const fbNwithUp = evaluateTargetSign({ rightHand: handU }, 'letra_n', []);
    expect(fbNwithUp.matched).toBe(false);
    expect(fbNwithUp.directionIssue).toBe('need_down');
    expect(fbNwithUp.message.toLowerCase()).toContain('hacia abajo');

    // 6. Letra C (arco abierto) vs Letra O (óvalo cerrado) vs Puño vs Cinco
    const handO = buildCanonicalHandForSign(getLearningSignById('letra_o'), { handedness: 'Right' });
    const fbCwithO = evaluateTargetSign({ rightHand: handO }, 'letra_c', []);
    expect(fbCwithO.matched).toBe(false);
    expect(fbCwithO.message.toLowerCase()).toContain('espacio');

    const fbCwithPuno = evaluateTargetSign({ rightHand: puno }, 'letra_c', []);
    expect(fbCwithPuno.matched).toBe(false);
    expect(fbCwithPuno.message.toLowerCase()).toContain('puño');

    const fbCwithCinco = evaluateTargetSign({ rightHand: cinco }, 'letra_c', []);
    expect(fbCwithCinco.matched).toBe(false);
    expect(fbCwithCinco.message.toLowerCase()).toContain('arco');

    // 7. Letra G (horizontal) rechaza mano vertical y Casa (inclinada) rechaza mano recta vertical
    const handL = buildCanonicalHandForSign(getLearningSignById('letra_l'), { handedness: 'Right' });
    const fbGwithUp = evaluateTargetSign({ rightHand: handL }, 'letra_g', []);
    expect(fbGwithUp.matched).toBe(false);
    expect(fbGwithUp.directionIssue).toBe('need_horizontal');

    const handB = buildCanonicalHandForSign(getLearningSignById('letra_b'), { handedness: 'Right' });
    const fbCasaVertical = evaluateTargetSign({ rightHand: handB }, 'casa', []);
    expect(fbCasaVertical.matched).toBe(false);
    expect(fbCasaVertical.directionIssue).toBe('need_tilted');

    // 8. Letra Ñ quieta pide movimiento lateral
    const handEnie = buildCanonicalHandForSign(getLearningSignById('letra_enie'), {
      handedness: 'Right',
    });
    const fbEnieStill = evaluateTargetSign(
      { rightHand: handEnie, timestamp: 1200 },
      'letra_enie',
      [{ t_ms: 1000, handId: 'rightHand', landmarks: handEnie }]
    );
    expect(fbEnieStill.matched).toBe(false);
    expect(fbEnieStill.message.toLowerCase()).toContain('movimiento lateral');

    // 9. Frame con ambas manos respeta preferredHandId al practicar la segunda mano
    const handRightUno = SYNTHETIC_PRESETS.UNO({ handedness: 'Right' });
    const handLeftUno = SYNTHETIC_PRESETS.UNO({ handedness: 'Left' });
    const dualRes = evaluateTargetSign(
      { rightHand: handRightUno, leftHand: handLeftUno },
      'uno',
      [],
      { preferredHandId: 'leftHand' }
    );
    expect(dualRes.matched).toBe(true);
    expect(dualRes.handId).toBe('leftHand');
  });

  it('detecta distancia de encuadre (mano muy lejos o muy cerca) y ausencia de mano', () => {
    const noHand = evaluateTargetSign(null, 'letra_a', []);
    expect(noHand.status).toBe('no_hand');
    expect(noHand.message.toLowerCase()).toContain('coloca tu mano');

    const farHand = SYNTHETIC_PRESETS.UNO({ handedness: 'Right', scale: 0.25 });
    const fbFar = evaluateTargetSign({ rightHand: farHand }, 'uno', []);
    expect(fbFar.matched).toBe(false);
    expect(fbFar.status).toBe('distance_adjust');
    expect(fbFar.distanceIssue).toBe('too_far');
    expect(fbFar.message.toLowerCase()).toContain('acerca un poco más tu mano');

    const closeHand = SYNTHETIC_PRESETS.UNO({ handedness: 'Right', scale: 4.5 });
    const fbClose = evaluateTargetSign({ rightHand: closeHand }, 'uno', []);
    expect(fbClose.matched).toBe(false);
    expect(fbClose.status).toBe('distance_adjust');
    expect(fbClose.distanceIssue).toBe('too_close');
    expect(fbClose.message.toLowerCase()).toContain('aleja un poco');
  });

  it('integra TargetedPracticeEvaluator + PracticeSessionMachine completando 5 derecha + 5 izquierda (10/10) en seña estática y dinámica', () => {
    // 1. Seña estática nueva: Letra R (5 derecha + 5 izquierda)
    const signR = getLearningSignById('letra_r');
    const evalR = new TargetedPracticeEvaluator(signR, { staticMinStableMs: 200 });
    const sessionR = new PracticeSessionMachine({
      targetLabel: signR.label,
      repsPerHand: 5,
      releaseMs: 300,
      cooldownMs: 600,
    });

    let t = 0;
    const doStaticRep = (handedness) => {
      const handId = handedness === 'Right' ? 'rightHand' : 'leftHand';
      const lm = buildCanonicalHandForSign(signR, { handedness });
      let snap = null;
      // Hold for 300ms (stabilizes at 200ms)
      for (let i = 0; i < 4; i++) {
        t += 100;
        const { confirmed, evaluation } = evalR.evaluate({ [handId]: lm, timestamp: t });
        snap = sessionR.update({
          detectedLabel: confirmed ? signR.label : null,
          handId: evaluation.handId,
          timestampMs: t,
        });
      }
      // Lower hand for 400ms (> releaseMs)
      for (let i = 0; i < 4; i++) {
        t += 100;
        evalR.evaluate({ timestamp: t });
        snap = sessionR.update({ detectedLabel: null, handId: null, timestampMs: t });
      }
      return snap;
    };

    for (let i = 1; i <= 5; i++) {
      doStaticRep('Right');
      expect(sessionR.getSnapshot().rightCount).toBe(i);
    }
    expect(sessionR.getSnapshot().phase).toBe('switch_hand');

    for (let i = 1; i <= 5; i++) {
      doStaticRep('Left');
      expect(sessionR.getSnapshot().leftCount).toBe(i);
    }
    expect(sessionR.getSnapshot().completed).toBe(true);
    expect(sessionR.getSnapshot().totalCount).toBe(10);

    // 2. Seña dinámica nueva: Letra Ñ (5 derecha + 5 izquierda)
    const signEnie = getLearningSignById('letra_enie');
    const evalEnie = new TargetedPracticeEvaluator(signEnie);
    const sessionEnie = new PracticeSessionMachine({
      targetLabel: signEnie.label,
      repsPerHand: 5,
      releaseMs: 300,
      cooldownMs: 600,
    });

    let td = 1000;
    const doDynamicRep = (handedness) => {
      const handId = handedness === 'Right' ? 'rightHand' : 'leftHand';
      const { history } = buildTrajectoryForSign(signEnie, { handedness, startMs: td });
      for (const sample of history) {
        td = sample.t_ms;
        const { confirmed, evaluation } = evalEnie.evaluate({
          [handId]: sample.landmarks,
          timestamp: td,
        });
        sessionEnie.update({
          detectedLabel: confirmed ? signEnie.label : null,
          handId: evaluation.handId,
          timestampMs: td,
        });
      }
      // Release for 600ms so both dynamic recency and release gate clear cleanly
      for (let i = 0; i < 6; i++) {
        td += 100;
        evalEnie.evaluate({ timestamp: td });
        sessionEnie.update({ detectedLabel: null, handId: null, timestampMs: td });
      }
      td += 100;
    };

    for (let i = 1; i <= 5; i++) {
      doDynamicRep('Right');
      expect(sessionEnie.getSnapshot().rightCount).toBe(i);
    }
    expect(sessionEnie.getSnapshot().phase).toBe('switch_hand');

    for (let i = 1; i <= 5; i++) {
      doDynamicRep('Left');
      expect(sessionEnie.getSnapshot().leftCount).toBe(i);
    }
    expect(sessionEnie.getSnapshot().completed).toBe(true);
    expect(sessionEnie.getSnapshot().totalCount).toBe(10);
  });
});
