import { performance } from 'node:perf_hooks';
import { describe, it, expect } from 'vitest';
import {
  SIGN_LABELS,
  CONTEXT_MODES,
  getModeCatalog,
  GeometricClassifier,
  classifySingleHandInMode,
  buildSyntheticHand,
  SYNTHETIC_PRESETS,
} from '../index.js';

/**
 * Projects isotropic 21-point hand coordinates into camera normalized image space
 * for a given aspect ratio (`W / H`, e.g. `0.75` portrait mobile 480x640 or `4/3` desktop 640x480).
 */
function projectToCameraAspect(hand, aspect) {
  if (Math.abs(aspect - 1.0) < 1e-6) return hand;
  const anchorY = 0.5;
  return hand.map((p) => ({
    x: p.x,
    y: Number((anchorY + (p.y - anchorY) * aspect).toFixed(6)),
    z: p.z ?? 0,
  }));
}

function transformHand(
  localPts,
  { handedness = 'Right', palmFacing = 'FRONT', rotateDeg = 0, offsetX = 0.5, offsetY = 0.65 } = {}
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
  thumbMode = 'curled',
  indexMode = 'curled',
  middleMode = 'curled',
  ringMode = 'curled',
  pinkyMode = 'curled',
  spreadMode = 'normal',
  customIndexSpread = null,
  customMiddleSpread = null,
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
    return [
      mcp,
      { x: mcpX, y: mcpY - 0.25 * s, z: -0.02 * s },
      { x: mcpX, y: mcpY - 0.05 * s, z: -0.04 * s },
      { x: mcpX, y: mcpY + 0.12 * s, z: -0.03 * s },
    ];
  };

  if (thumbMode === 'extended') {
    pts[1] = { x: -0.28 * s, y: -0.25 * s, z: 0 };
    pts[2] = { x: -0.55 * s, y: -0.5 * s, z: 0 };
    pts[3] = { x: -0.82 * s, y: -0.75 * s, z: 0 };
    pts[4] = { x: -1.1 * s, y: -1.0 * s, z: 0 };
  } else if (thumbMode === 'adducted') {
    pts[1] = { x: -0.28 * s, y: -0.25 * s, z: 0 };
    pts[2] = { x: -0.44 * s, y: -0.58 * s, z: 0 };
    pts[3] = { x: -0.48 * s, y: -0.92 * s, z: 0 };
    pts[4] = { x: -0.46 * s, y: -1.26 * s, z: 0 };
  } else if (thumbMode === 'tucked') {
    pts[1] = { x: -0.24 * s, y: -0.24 * s, z: 0 };
    pts[2] = { x: -0.3 * s, y: -0.52 * s, z: -0.02 * s };
    pts[3] = { x: -0.22 * s, y: -0.78 * s, z: -0.04 * s };
    pts[4] = { x: -0.14 * s, y: -0.92 * s, z: -0.05 * s };
  } else if (thumbMode === 'between') {
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
    idxSpread = 0.2 * s;
    midSpread = -0.26 * s;
  }

  if (customIndexSpread !== null) idxSpread = customIndexSpread * s;
  if (customMiddleSpread !== null) midSpread = customMiddleSpread * s;

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

function buildPoseForSign(
  sign,
  {
    handedness = 'Right',
    offsetX = 0.5,
    offsetY = 0.65,
    palmFacingOverride = null,
    aspectRatio = 1.0,
  } = {}
) {
  const p = sign.profile;
  const palmFacing = palmFacingOverride || (p.orientation === 'BACK' ? 'BACK' : 'FRONT');

  let rotateDeg = 0;
  if (p.handDirection === 'DOWN') rotateDeg = 180;
  else if (p.handDirection === 'HORIZONTAL') rotateDeg = 90;
  else if (p.handDirection === 'TILTED') rotateDeg = 40;

  let isoHand;
  if (p.zeroOval) {
    isoHand = buildSyntheticHand({
      zeroOval: true,
      handedness,
      palmFacing,
      rotateDeg,
      offsetX,
      offsetY,
    });
  } else {
    const mapFinger = (val) => {
      if (val === true) return 'extended';
      if (val === false || val === 'any') return 'curled';
      return val;
    };
    const thumbMode = p.dCircle ? 'curled' : mapFinger(p.fingers.thumb);
    const local = buildCustomLocalHand({
      thumbMode,
      indexMode: mapFinger(p.fingers.index),
      middleMode: mapFinger(p.fingers.middle),
      ringMode: mapFinger(p.fingers.ring),
      pinkyMode: mapFinger(p.fingers.pinky),
      spreadMode: p.fingerSpread || 'normal',
    });
    isoHand = transformHand(local, { handedness, palmFacing, rotateDeg, offsetX, offsetY });
  }

  return projectToCameraAspect(isoHand, aspectRatio);
}

/**
 * Streams a canonical static or dynamic trajectory for `sign` through `GeometricClassifier`
 * under a specified `handedness` (`'Left' | 'Right'`) and camera `aspectRatio` (`0.75` or `4/3`).
 */
function streamSignInMode(mode, sign, { handedness = 'Right', aspectRatio = 4 / 3 } = {}) {
  const clf = new GeometricClassifier({ mode });
  const slot = handedness === 'Right' ? 'rightHand' : 'leftHand';
  const vw = aspectRatio < 1 ? 480 : 640;
  const vh = aspectRatio < 1 ? 640 : 480;
  const motion = sign.profile.dynamicMotion;

  let confirmed = null;
  let lastRes = null;

  const pushFrame = (lm, tMs) => {
    lastRes = clf.predict({
      [slot]: lm,
      videoWidth: vw,
      videoHeight: vh,
      aspectRatio,
      timestamp: tMs,
    });
    if (lastRes.label) confirmed = lastRes.label;
  };

  if (!motion) {
    for (let i = 0; i < 8; i++) {
      pushFrame(buildPoseForSign(sign, { handedness, aspectRatio }), i * 66);
    }
  } else if (motion === 'wave') {
    const xs = [0.5, 0.56, 0.62, 0.55, 0.44, 0.38, 0.46, 0.58, 0.63, 0.52, 0.44, 0.52, 0.6, 0.52, 0.44];
    xs.forEach((offsetX, i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetX, aspectRatio }), i * 66)
    );
  } else if (motion === 'rotation' || motion === 'wrist_twist') {
    const facings = [
      'FRONT',
      'FRONT',
      'FRONT',
      'BACK',
      'BACK',
      'BACK',
      'FRONT',
      'FRONT',
      'FRONT',
      'BACK',
      'BACK',
      'FRONT',
    ];
    facings.forEach((palmFacingOverride, i) =>
      pushFrame(buildPoseForSign(sign, { handedness, palmFacingOverride, aspectRatio }), i * 66)
    );
  } else if (motion === 'lateral_shake') {
    const xs = [0.5, 0.55, 0.6, 0.54, 0.45, 0.42, 0.5, 0.56, 0.5, 0.44, 0.5, 0.56];
    xs.forEach((offsetX, i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetX, aspectRatio }), i * 66)
    );
  } else if (motion === 'vertical_nod') {
    const ys = [0.64, 0.68, 0.72, 0.67, 0.6, 0.58, 0.65, 0.7, 0.65, 0.6, 0.66, 0.7];
    ys.forEach((offsetY, i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetY, aspectRatio }), i * 66)
    );
  } else if (motion === 'upward') {
    const ys = [0.76, 0.73, 0.69, 0.65, 0.61, 0.57, 0.54, 0.54, 0.54, 0.54, 0.54];
    ys.forEach((offsetY, i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetY, aspectRatio }), i * 66)
    );
  } else if (motion === 'downward') {
    const ys = [0.48, 0.52, 0.56, 0.6, 0.64, 0.68, 0.72, 0.72, 0.72, 0.72, 0.72];
    ys.forEach((offsetY, i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetY, aspectRatio }), i * 66)
    );
  } else if (motion === 'j_curve') {
    const path = [
      [0.54, 0.5],
      [0.54, 0.55],
      [0.54, 0.61],
      [0.52, 0.66],
      [0.48, 0.68],
      [0.44, 0.66],
      [0.42, 0.62],
      [0.42, 0.62],
      [0.42, 0.62],
      [0.42, 0.62],
      [0.42, 0.62],
    ];
    path.forEach(([offsetX, offsetY], i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetX, offsetY, aspectRatio }), i * 66)
    );
  } else if (motion === 'z_trace') {
    const path = [
      [0.42, 0.51],
      [0.5, 0.51],
      [0.58, 0.51],
      [0.52, 0.58],
      [0.44, 0.66],
      [0.52, 0.66],
      [0.6, 0.66],
      [0.6, 0.66],
      [0.6, 0.66],
      [0.6, 0.66],
      [0.6, 0.66],
    ];
    path.forEach(([offsetX, offsetY], i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetX, offsetY, aspectRatio }), i * 66)
    );
  } else if (motion === 'pull_back') {
    const xs = [0.44, 0.48, 0.52, 0.56, 0.6, 0.64, 0.64, 0.64, 0.64, 0.64];
    xs.forEach((offsetX, i) =>
      pushFrame(buildPoseForSign(sign, { handedness, offsetX, aspectRatio }), i * 66)
    );
  } else if (motion === 'circle') {
    for (let i = 0; i < 15; i++) {
      const th = (Math.min(i, 9) / 9) * Math.PI * 2;
      const offsetX = 0.5 + 0.06 * Math.cos(th);
      const offsetY = 0.62 + 0.06 * Math.sin(th);
      pushFrame(buildPoseForSign(sign, { handedness, offsetX, offsetY, aspectRatio }), i * 66);
    }
  }

  return { confirmed, lastRes };
}

describe('recognition/contextModes — Modos de contexto, matriz de confusión, cambio en caliente y < 1 ms/frame', () => {
  it('mantiene 100% de paridad y 0 regresiones en el modo por defecto (general)', () => {
    const clf = new GeometricClassifier();
    expect(clf.getMode()).toBe(CONTEXT_MODES.GENERAL);

    const staticChecks = [
      ['CERO', SIGN_LABELS.CERO],
      ['UNO', SIGN_LABELS.UNO],
      ['DOS', SIGN_LABELS.DOS],
      ['TRES', SIGN_LABELS.TRES],
      ['CUATRO', SIGN_LABELS.CUATRO],
      ['CINCO', SIGN_LABELS.CINCO],
      ['SEIS', SIGN_LABELS.SEIS],
      ['SIETE', SIGN_LABELS.SIETE],
      ['OCHO', SIGN_LABELS.OCHO],
      ['NUEVE', SIGN_LABELS.NUEVE],
      ['PUNO', SIGN_LABELS.PUNO],
      ['OK', SIGN_LABELS.OK],
      ['BIEN', SIGN_LABELS.BIEN],
      ['TE_QUIERO', SIGN_LABELS.TE_QUIERO],
      ['LUNES', SIGN_LABELS.LUNES],
      ['LETRA_I', SIGN_LABELS.LETRA_I],
      ['LETRA_Y', SIGN_LABELS.LETRA_Y],
      ['CUERNOS', SIGN_LABELS.CUERNOS],
    ];

    for (const [presetKey, expected] of staticChecks) {
      const localClf = new GeometricClassifier();
      let confirmed = null;
      for (let i = 0; i < 8; i++) {
        const res = localClf.predict({
          rightHand: SYNTHETIC_PRESETS[presetKey]({ handedness: 'Right' }),
          timestamp: i * 66,
        });
        if (res.label) confirmed = res.label;
      }
      expect(confirmed, `general/${presetKey}`).toBe(expected);
    }

    // Modo inválido revierte de forma segura a 'general'
    const fallbackClf = new GeometricClassifier({ mode: 'modo_inexistente' });
    expect(fallbackClf.getMode()).toBe(CONTEXT_MODES.GENERAL);
  });

  it('cambia de modo en caliente reiniciando SmoothingVoter y el historial de movimiento sin falsos positivos residuales', () => {
    const clf = new GeometricClassifier({ mode: CONTEXT_MODES.GENERAL });

    // 1. Confirmar "Uno" en modo General
    let res = null;
    for (let i = 0; i < 8; i++) {
      res = clf.predict({
        rightHand: SYNTHETIC_PRESETS.UNO({ handedness: 'Right' }),
        timestamp: i * 66,
      });
    }
    expect(res.label).toBe(SIGN_LABELS.UNO);
    expect(clf.voter.confirmedLabel).toBe(SIGN_LABELS.UNO);

    // 2. Cambiar en caliente a Abecedario -> debe limpiar voter y buffers sin arrastrar "Uno"
    clf.setMode(CONTEXT_MODES.ALPHABET);
    expect(clf.getMode()).toBe(CONTEXT_MODES.ALPHABET);
    expect(clf.voter.history).toHaveLength(0);
    expect(clf.voter.confirmedLabel).toBeNull();
    expect(clf.frameBuffer).toHaveLength(0);

    // Un solo frame vacío o de transición NO debe emitir "Uno" residual
    const afterSwitchEmpty = clf.predict({ rightHand: null, leftHand: null, timestamp: 1000 });
    expect(afterSwitchEmpty.label).toBeNull();

    // Un solo frame de Letra D no confirma instantáneamente (respeta minStableMs tras reset)
    const letraD = getModeCatalog(CONTEXT_MODES.ALPHABET).find((s) => s.id === 'letra_d');
    const firstFrameD = clf.predict({
      rightHand: buildPoseForSign(letraD, { handedness: 'Right' }),
      timestamp: 1066,
    });
    expect(firstFrameD.label).toBeNull();
    expect(firstFrameD.details.rawLabel).toBe('Letra D');

    // Mantener Letra D durante >= 260ms sí confirma limpiamente "Letra D"
    let confirmedD = null;
    for (let i = 1; i <= 7; i++) {
      const r = clf.predict({
        rightHand: buildPoseForSign(letraD, { handedness: 'Right' }),
        timestamp: 1066 + i * 66,
      });
      if (r.label) confirmedD = r.label;
    }
    expect(confirmedD).toBe('Letra D');

    // 3. Onda de saludo "Hola" en General -> cambiar a Números con mano quieta NO dispara "Hola" ni "Diez"
    clf.setMode(CONTEXT_MODES.GENERAL);
    const waveXs = [0.5, 0.56, 0.62, 0.55, 0.44, 0.38, 0.46, 0.58, 0.63, 0.52, 0.44];
    waveXs.forEach((offsetX, i) => {
      clf.predict({
        rightHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', offsetX }),
        timestamp: 3000 + i * 66,
      });
    });

    clf.setMode(CONTEXT_MODES.NUMBERS);
    let confirmedAfterNumbers = null;
    for (let i = 0; i < 8; i++) {
      const r = clf.predict({
        rightHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Right' }),
        timestamp: 4000 + i * 66,
      });
      expect(r.label).not.toBe(SIGN_LABELS.HOLA);
      expect(r.label).not.toBe(SIGN_LABELS.DIEZ);
      if (r.label) confirmedAfterNumbers = r.label;
    }
    expect(confirmedAfterNumbers).toBe(SIGN_LABELS.CINCO);
  });

  it('matriz de separación 0 colisiones en modo numbers (0–10), izq/der y portrait (0.75) vs landscape (1.33)', () => {
    const numbers = getModeCatalog(CONTEXT_MODES.NUMBERS);
    expect(numbers).toHaveLength(11);

    for (const handedness of ['Left', 'Right']) {
      for (const aspectRatio of [0.75, 4 / 3]) {
        let collisions = 0;
        for (const sign of numbers) {
          const { confirmed } = streamSignInMode(CONTEXT_MODES.NUMBERS, sign, {
            handedness,
            aspectRatio,
          });
          expect(
            confirmed,
            `numbers/${sign.id} (${handedness}, aspect=${aspectRatio.toFixed(2)})`
          ).toBe(sign.label);
          if (confirmed !== sign.label) collisions++;
        }
        expect(collisions).toBe(0);
      }
    }

    // Señas fuera de Números (Puño, OK, Bien, Te Quiero, Cuernos, Letra I, Letra Y) son rechazadas en modo Números
    for (const nonNumberKey of ['PUNO', 'OK', 'BIEN', 'TE_QUIERO', 'CUERNOS', 'LETRA_I', 'LETRA_Y']) {
      const clf = new GeometricClassifier({ mode: CONTEXT_MODES.NUMBERS });
      for (let i = 0; i < 8; i++) {
        const res = clf.predict({
          rightHand: SYNTHETIC_PRESETS[nonNumberKey]({ handedness: 'Right' }),
          timestamp: i * 66,
        });
        expect(res.label, `No-número ${nonNumberKey} debe ser null en modo numbers`).toBeNull();
      }
    }
  });

  it('matriz de separación 27x27 sin colisiones en modo alphabet (A–Z + Ñ), izq/der, portrait (0.75) vs landscape (1.33) y rechazo por margen', () => {
    const letters = getModeCatalog(CONTEXT_MODES.ALPHABET);
    expect(letters).toHaveLength(27);

    for (const handedness of ['Left', 'Right']) {
      for (const aspectRatio of [0.75, 4 / 3]) {
        let collisions = 0;
        for (const sign of letters) {
          const { confirmed } = streamSignInMode(CONTEXT_MODES.ALPHABET, sign, {
            handedness,
            aspectRatio,
          });
          expect(
            confirmed,
            `alphabet/${sign.id} (${handedness}, aspect=${aspectRatio.toFixed(2)})`
          ).toBe(sign.label);
          if (confirmed !== sign.label) collisions++;
        }
        expect(collisions).toBe(0);
      }
    }

    // Rechazo estricto por margen insuficiente (top1 - top2 < minScoreMargin) en frontera ambigua U ↔ V
    const borderlineUV = transformHand(
      buildCustomLocalHand({
        thumbMode: 'curled',
        indexMode: 'extended',
        middleMode: 'extended',
        ringMode: 'curled',
        pinkyMode: 'curled',
        customIndexSpread: -0.04,
        customMiddleSpread: 0.02,
      }),
      { handedness: 'Right', palmFacing: 'FRONT' }
    );
    const marginRes = classifySingleHandInMode(borderlineUV, {
      mode: CONTEXT_MODES.ALPHABET,
      handId: 'rightHand',
      aspectRatio: 1.0,
    });
    expect(marginRes.label).toBeNull();
    expect(marginRes.reason).toBe('AMBIGUOUS_MARGIN_TOO_SMALL');
    expect([marginRes.top1, marginRes.top2].sort()).toEqual(['Letra U', 'Letra V']);
  });

  it('matriz de separación 32x32 sin colisiones en modo phrases (Frases cortas + Agradecimientos/Modales), izq/der y portrait vs landscape', () => {
    const phrases = getModeCatalog(CONTEXT_MODES.PHRASES);
    expect(phrases).toHaveLength(32);

    for (const handedness of ['Left', 'Right']) {
      for (const aspectRatio of [0.75, 4 / 3]) {
        let collisions = 0;
        for (const sign of phrases) {
          const { confirmed } = streamSignInMode(CONTEXT_MODES.PHRASES, sign, {
            handedness,
            aspectRatio,
          });
          expect(
            confirmed,
            `phrases/${sign.id} (${handedness}, aspect=${aspectRatio.toFixed(2)})`
          ).toBe(sign.label);
          if (confirmed !== sign.label) collisions++;
        }
        expect(collisions).toBe(0);
      }
    }
  });

  it('ejecuta todos los modos en < 1 ms por frame bajo carga sostenida (0 impacto en FPS)', () => {
    const modes = [
      CONTEXT_MODES.GENERAL,
      CONTEXT_MODES.ALPHABET,
      CONTEXT_MODES.NUMBERS,
      CONTEXT_MODES.PHRASES,
    ];

    for (const mode of modes) {
      const signs = getModeCatalog(mode);
      const clf = new GeometricClassifier({ mode });
      const sampleFrameA =
        mode === CONTEXT_MODES.GENERAL
          ? SYNTHETIC_PRESETS.DOS({ handedness: 'Right' })
          : buildPoseForSign(signs[0], { handedness: 'Right', aspectRatio: 0.75 });
      const sampleFrameB =
        mode === CONTEXT_MODES.GENERAL
          ? SYNTHETIC_PRESETS.CINCO({ handedness: 'Right' })
          : buildPoseForSign(signs[Math.min(5, signs.length - 1)], {
              handedness: 'Right',
              aspectRatio: 4 / 3,
            });

      // Warmup JIT
      for (let i = 0; i < 60; i++) {
        clf.predict({
          rightHand: i % 2 === 0 ? sampleFrameA : sampleFrameB,
          aspectRatio: i % 2 === 0 ? 0.75 : 4 / 3,
          timestamp: i * 33,
        });
      }

      const iterations = 600;
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        clf.predict({
          rightHand: i % 2 === 0 ? sampleFrameA : sampleFrameB,
          aspectRatio: i % 2 === 0 ? 0.75 : 4 / 3,
          timestamp: (i + 100) * 33,
        });
      }
      const avgMs = (performance.now() - t0) / iterations;
      expect(avgMs, `Modo "${mode}" excedió presupuesto de 1 ms/frame: ${avgMs.toFixed(4)} ms`).toBeLessThan(
        1.0
      );
    }
  });
});
