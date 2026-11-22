import { describe, it, expect } from 'vitest';
import {
  SIGN_LABELS,
  SIGN_CATALOG,
  fingerStates,
  classify,
  classifyStaticHand,
  detectPalmRotation,
  GeometricClassifier,
  ModelClassifier,
  SmoothingVoter,
  buildSyntheticHand,
  SYNTHETIC_PRESETS,
} from '../index.js';

describe('recognition/ — Clasificación geométrica pura y catálogo LSM expandido', () => {
  it('reconoce los números 1–9 estáticos de LSM en mano derecha e izquierda', () => {
    const pairs = [
      ['UNO', SIGN_LABELS.UNO],
      ['DOS', SIGN_LABELS.DOS],
      ['TRES', SIGN_LABELS.TRES],
      ['CUATRO', SIGN_LABELS.CUATRO],
      ['CINCO', SIGN_LABELS.CINCO],
      ['SEIS', SIGN_LABELS.SEIS],
      ['SIETE', SIGN_LABELS.SIETE],
      ['OCHO', SIGN_LABELS.OCHO],
      ['NUEVE', SIGN_LABELS.NUEVE],
    ];

    for (const [presetKey, expected] of pairs) {
      const left = SYNTHETIC_PRESETS[presetKey]({ handedness: 'Left' });
      const right = SYNTHETIC_PRESETS[presetKey]({ handedness: 'Right' });

      const rLeft = classifyStaticHand({ leftHand: left });
      const rRight = classifyStaticHand({ rightHand: right });

      expect(rLeft.label, `${presetKey} (Left)`).toBe(expected);
      expect(rRight.label, `${presetKey} (Right)`).toBe(expected);
      expect(rLeft.confidence).toBeGreaterThanOrEqual(0.8);
      expect(rRight.confidence).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('reconoce las señas base y adicionales sin colisiones (Puño, OK/Pinza, Bien, Te Quiero, Lunes, Cero, Letra I, Letra Y, Cuernos)', () => {
    const pairs = [
      ['PUNO', SIGN_LABELS.PUNO],
      ['OK', SIGN_LABELS.OK],
      ['BIEN', SIGN_LABELS.BIEN],
      ['TE_QUIERO', SIGN_LABELS.TE_QUIERO],
      ['LUNES', SIGN_LABELS.LUNES],
      ['CERO', SIGN_LABELS.CERO],
      ['LETRA_I', SIGN_LABELS.LETRA_I],
      ['LETRA_Y', SIGN_LABELS.LETRA_Y],
      ['CUERNOS', SIGN_LABELS.CUERNOS],
    ];

    for (const [presetKey, expected] of pairs) {
      const left = SYNTHETIC_PRESETS[presetKey]({ handedness: 'Left' });
      const right = SYNTHETIC_PRESETS[presetKey]({ handedness: 'Right' });
      expect(classifyStaticHand({ leftHand: left }).label, `${presetKey} (Left)`).toBe(expected);
      expect(classifyStaticHand({ rightHand: right }).label, `${presetKey} (Right)`).toBe(expected);
    }
  });

  it('mantiene invariancia a escala (0.4x a 3.0x) y traslación en el encuadre', () => {
    const scales = [0.4, 0.75, 1.0, 1.8, 3.0];
    const offsets = [
      { offsetX: 0.15, offsetY: 0.25 },
      { offsetX: 0.85, offsetY: 0.8 },
    ];

    for (const scale of scales) {
      for (const offset of offsets) {
        expect(classify(SYNTHETIC_PRESETS.CINCO({ scale, ...offset })).label).toBe(
          SIGN_LABELS.CINCO
        );
        expect(classify(SYNTHETIC_PRESETS.PUNO({ scale, ...offset })).label).toBe(SIGN_LABELS.PUNO);
        expect(classify(SYNTHETIC_PRESETS.UNO({ scale, ...offset })).label).toBe(SIGN_LABELS.UNO);
        expect(classify(SYNTHETIC_PRESETS.DOS({ scale, ...offset })).label).toBe(SIGN_LABELS.DOS);
        expect(classify(SYNTHETIC_PRESETS.TRES({ scale, ...offset })).label).toBe(SIGN_LABELS.TRES);
        expect(classify(SYNTHETIC_PRESETS.CUATRO({ scale, ...offset })).label).toBe(
          SIGN_LABELS.CUATRO
        );
        expect(classify(SYNTHETIC_PRESETS.OK({ scale, ...offset })).label).toBe(SIGN_LABELS.OK);
        expect(classify(SYNTHETIC_PRESETS.OCHO({ scale, ...offset })).label).toBe(SIGN_LABELS.OCHO);
        expect(classify(SYNTHETIC_PRESETS.LETRA_I({ scale, ...offset })).label).toBe(
          SIGN_LABELS.LETRA_I
        );
        expect(classify(SYNTHETIC_PRESETS.LETRA_Y({ scale, ...offset })).label).toBe(
          SIGN_LABELS.LETRA_Y
        );
      }
    }
  });

  it('es invariante a rotación en el plano XY (-90°, -45°, +30°, +90°, 180°)', () => {
    const angles = [-90, -45, -20, 0, 30, 60, 90, 180];

    for (const rotateDeg of angles) {
      expect(classify(SYNTHETIC_PRESETS.CINCO({ rotateDeg })).label).toBe(SIGN_LABELS.CINCO);
      expect(classify(SYNTHETIC_PRESETS.PUNO({ rotateDeg })).label).toBe(SIGN_LABELS.PUNO);
      expect(classify(SYNTHETIC_PRESETS.UNO({ rotateDeg })).label).toBe(SIGN_LABELS.UNO);
      expect(classify(SYNTHETIC_PRESETS.DOS({ rotateDeg })).label).toBe(SIGN_LABELS.DOS);
      expect(classify(SYNTHETIC_PRESETS.TRES({ rotateDeg })).label).toBe(SIGN_LABELS.TRES);
      expect(classify(SYNTHETIC_PRESETS.OK({ rotateDeg })).label).toBe(SIGN_LABELS.OK);
    }
  });

  it('rechaza ruido, arreglos incompletos, coordenadas NaN y manos colapsadas', () => {
    expect(classify(null).label).toBeNull();
    expect(classify([]).label).toBeNull();
    expect(classify([{ x: 0.5, y: 0.5, z: 0 }]).label).toBeNull();

    const collapsed = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(classify(collapsed).label).toBeNull();

    const withNaN = SYNTHETIC_PRESETS.CINCO();
    withNaN[8] = { x: Number.NaN, y: 0.5, z: 0 };
    expect(classify(withNaN).label).toBeNull();

    const randomNoise = Array.from({ length: 21 }, (_, idx) => ({
      x: (idx * 0.73) % 1.0,
      y: (idx * 0.41) % 1.0,
      z: (idx * 0.19) % 1.0,
    }));
    randomNoise[0] = { x: 0.5, y: 0.5, z: 0 };
    randomNoise[9] = { x: 0.5, y: 0.45, z: 0 };
    randomNoise[5] = { x: 0.95, y: 0.95, z: 0 };
    expect(classify(randomNoise).label).toBeNull();
  });

  it('detecta gestos dinámicos Hola (saludo lateral X) y Diez (giro de muñeca FRONT<->BACK) sin colisión entre sí', () => {
    // 1. Hola: mano abierta oscilando lateralmente (sin giro de muñeca)
    const clfHola = new GeometricClassifier({ bufferSize: 15, smoothingWindow: 5, minVotes: 3 });
    const xs = [0.4, 0.46, 0.52, 0.46, 0.38, 0.45, 0.53, 0.45, 0.39, 0.47];
    const batchHola = xs.map((offsetX) => ({
      leftHand: SYNTHETIC_PRESETS.CINCO({ handedness: 'Left', offsetX }),
    }));
    const resHola = clfHola.predict(batchHola);
    expect(resHola.label).toBe(SIGN_LABELS.HOLA);
    expect(resHola.confidence).toBeGreaterThanOrEqual(0.85);
    expect(resHola.details.wave.isWaving).toBe(true);

    // 2. Diez (LSM): mano abierta (5) girando muñeca palma <-> dorso en t_ms (sin desplazamiento lateral)
    expect(typeof detectPalmRotation).toBe('function');
    const clfDiez = new GeometricClassifier();
    let sawDiez = false;
    let sawHola = false;
    for (let i = 0; i < 18; i++) {
      const tMs = i * 67;
      // Gira progresivamente de FRONT (yaw 0°) a BACK (yaw 180°) y regresa
      const facing = i < 4 ? 'FRONT' : i < 10 ? 'BACK' : i < 14 ? 'FRONT' : 'BACK';
      const hand = SYNTHETIC_PRESETS.CINCO({ handedness: 'Right', palmFacing: facing });
      const r = clfDiez.predict({ rightHand: hand, timestamp: tMs });
      if (r.label === SIGN_LABELS.DIEZ) sawDiez = true;
      if (r.label === SIGN_LABELS.HOLA) sawHola = true;
    }
    expect(sawDiez).toBe(true);
    expect(sawHola).toBe(false);
  });

  it('suaviza predicciones por votación de N frames e ignora un frame espurio aislado', () => {
    const voter = new SmoothingVoter(5, 3);
    voter.push({ label: SIGN_LABELS.UNO, confidence: 0.95 });
    voter.push({ label: SIGN_LABELS.UNO, confidence: 0.95 });
    const third = voter.push({ label: SIGN_LABELS.UNO, confidence: 0.95 });
    expect(third.label).toBe(SIGN_LABELS.UNO);

    const noisy = voter.push({ label: SIGN_LABELS.PUNO, confidence: 0.8 });
    expect(noisy.label).toBe(SIGN_LABELS.UNO);

    const streamClf = new GeometricClassifier({ smoothingWindow: 5, minVotes: 3 });
    const f1 = streamClf.predict(SYNTHETIC_PRESETS.DOS());
    expect(f1.label).toBeNull();
    expect(f1.details.rawLabel).toBe(SIGN_LABELS.DOS);
    const f2 = streamClf.predict(SYNTHETIC_PRESETS.DOS());
    expect(f2.label).toBeNull();
    const f3 = streamClf.predict(SYNTHETIC_PRESETS.DOS());
    expect(f3.label).toBe(SIGN_LABELS.DOS);
  });

  it('cumple el contrato Classifier para enchufar ModelClassifier en el futuro', () => {
    const mockModel = new ModelClassifier((frames) => ({
      label: 'Gracias',
      confidence: 0.99,
      details: { frameCount: frames.length },
    }));
    const res = mockModel.predict([1, 2, 3]);
    expect(res.label).toBe('Gracias');
    expect(res.confidence).toBe(0.99);
  });

  it('expone SIGN_CATALOG como fuente única de verdad alineada 1:1 con SIGN_LABELS (números 1-10 + base + extras)', () => {
    expect(Array.isArray(SIGN_CATALOG)).toBe(true);
    const catalogLabels = SIGN_CATALOG.map((item) => item.label);
    expect(catalogLabels).toEqual(Object.values(SIGN_LABELS));
    expect(SIGN_CATALOG.length).toBeGreaterThanOrEqual(19);
    for (const numLabel of [
      'Uno',
      'Dos',
      'Tres',
      'Cuatro',
      'Cinco',
      'Seis',
      'Siete',
      'Ocho',
      'Nueve',
      'Diez',
    ]) {
      expect(catalogLabels).toContain(numLabel);
    }
    for (const item of SIGN_CATALOG) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(['static', 'dynamic']).toContain(item.type);
      expect(typeof item.hint).toBe('string');
      expect(typeof item.speakText).toBe('string');
    }
  });

  it('corrige anisotropía 4:3 (640x480) y móvil vertical portrait (480x640, 720x1280) bajo rotación', () => {
    const bp = 0.15;
    const base = SYNTHETIC_PRESETS.CINCO({ handedness: 'Left', offsetX: 0.5, offsetY: 0.5 });
    base[1] = { x: 0.5 - 0.25 * bp, y: 0.5 - 0.24 * bp, z: 0 };
    base[2] = { x: 0.5 - 0.46 * bp, y: 0.5 - 0.48 * bp, z: 0 };
    base[3] = { x: 0.5 - 0.64 * bp, y: 0.5 - 0.72 * bp, z: 0 };
    base[4] = { x: 0.5 - 0.8 * bp, y: 0.5 - 0.92 * bp, z: 0 };

    const project = (hand, deg, aspect) => {
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const w = hand[0];
      return hand.map((p) => {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        return {
          x: 0.5 + (dx * c - dy * s),
          y: 0.5 + (dx * s + dy * c) * aspect,
          z: p.z,
        };
      });
    };

    for (const [vw, vh] of [
      [640, 480],
      [480, 640],
      [720, 1280],
    ]) {
      const ratio = vw / vh;
      for (const deg of [-25, 0, 25, 45, 90]) {
        const res = classifyStaticHand({
          leftHand: project(base, deg, ratio),
          videoWidth: vw,
          videoHeight: vh,
          aspectRatio: ratio,
        });
        expect(res.label).toBe(SIGN_LABELS.CINCO);
      }
    }
  });

  it('usa ángulos articulares MCP/PIP/DIP y rechaza mano doblada 90° en MCP y reposo relajado', () => {
    const bp = 0.15;
    const shelfHand = SYNTHETIC_PRESETS.CINCO();
    for (const [mcp, pip, dip, tip] of [
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
      [17, 18, 19, 20],
    ]) {
      const m = shelfHand[mcp];
      shelfHand[pip] = { x: m.x, y: m.y, z: m.z - 0.45 * bp };
      shelfHand[dip] = { x: m.x, y: m.y, z: m.z - 0.8 * bp };
      shelfHand[tip] = { x: m.x, y: m.y, z: m.z - 1.12 * bp };
    }
    expect(classifyStaticHand(shelfHand).label).toBeNull();

    const relaxed = SYNTHETIC_PRESETS.CINCO();
    for (const mcpIdx of [5, 9, 13, 17]) {
      const m = relaxed[mcpIdx];
      const a1 = (20 * Math.PI) / 180;
      const a2 = (70 * Math.PI) / 180;
      const a3 = (105 * Math.PI) / 180;
      const p1 = { x: m.x, y: m.y - 0.45 * bp * Math.cos(a1), z: m.z - 0.45 * bp * Math.sin(a1) };
      const p2 = { x: p1.x, y: p1.y - 0.35 * bp * Math.cos(a2), z: p1.z - 0.35 * bp * Math.sin(a2) };
      const p3 = { x: p2.x, y: p2.y - 0.32 * bp * Math.cos(a3), z: p2.z - 0.32 * bp * Math.sin(a3) };
      relaxed[mcpIdx + 1] = p1;
      relaxed[mcpIdx + 2] = p2;
      relaxed[mcpIdx + 3] = p3;
    }
    const fistThumb = SYNTHETIC_PRESETS.PUNO();
    for (let i = 1; i <= 4; i++) relaxed[i] = fistThumb[i];
    expect(classifyStaticHand(relaxed).label).toBeNull();
  });

  it('elimina colisiones críticas: Puño natural vs OK/Cero, Letra A vs Puño/Bien/Seis, Pulgar abajo vs Bien/Seis, Uno vs Lunes/Siete y Cuatro vs Nueve', () => {
    const bp = 0.15;

    // 1. Puño natural -> Puño (NO OK/Pinza ni Cero)
    const naturalFist = SYNTHETIC_PRESETS.PUNO();
    naturalFist[3] = { x: 0.5 - 0.3 * bp, y: 0.7 - 0.65 * bp, z: -0.04 * bp };
    naturalFist[4] = { x: 0.5 - 0.18 * bp, y: 0.7 - 0.78 * bp, z: -0.05 * bp };
    expect(classifyStaticHand(naturalFist).label).toBe(SIGN_LABELS.PUNO);

    // 2. Pulgar hacia abajo (180°) -> NO Bien ni Seis
    const thumbsDownFront = SYNTHETIC_PRESETS.BIEN({ handedness: 'Left', rotateDeg: 180 });
    const thumbsDownBack = SYNTHETIC_PRESETS.SEIS({ handedness: 'Left', rotateDeg: 180 });
    expect(classifyStaticHand({ leftHand: thumbsDownFront }).label).toBeNull();
    expect(classifyStaticHand({ leftHand: thumbsDownBack }).label).toBeNull();

    // 3. Uno con pulgar paralelo (~20°) -> NO Lunes ni Siete
    const narrowL = SYNTHETIC_PRESETS.UNO();
    narrowL[1] = { x: 0.5 - 0.28 * bp, y: 0.7 - 0.25 * bp, z: 0 };
    narrowL[2] = { x: 0.5 - 0.48 * bp, y: 0.7 - 0.58 * bp, z: 0 };
    narrowL[3] = { x: 0.5 - 0.64 * bp, y: 0.7 - 0.92 * bp, z: 0 };
    narrowL[4] = { x: 0.5 - 0.78 * bp, y: 0.7 - 1.25 * bp, z: 0 };
    expect(classifyStaticHand(narrowL).label).not.toBe(SIGN_LABELS.LUNES);
    expect(classifyStaticHand(narrowL).label).not.toBe(SIGN_LABELS.SIETE);

    // 4. Letra A -> rechazada como ambigua
    const letraA = SYNTHETIC_PRESETS.PUNO();
    letraA[1] = { x: 0.5 - 0.25 * bp, y: 0.7 - 0.3 * bp, z: 0 };
    letraA[2] = { x: 0.5 - 0.38 * bp, y: 0.7 - 0.6 * bp, z: 0 };
    letraA[3] = { x: 0.5 - 0.44 * bp, y: 0.7 - 0.9 * bp, z: 0 };
    letraA[4] = { x: 0.5 - 0.46 * bp, y: 0.7 - 1.2 * bp, z: 0 };
    expect(classifyStaticHand(letraA).label).toBeNull();

    // 5. Separación estricta FRONT vs BACK: Bien != Seis, Lunes != Siete, Cuatro != Nueve
    expect(
      classifyStaticHand({ rightHand: SYNTHETIC_PRESETS.BIEN({ handedness: 'Right' }) }).label
    ).toBe(SIGN_LABELS.BIEN);
    expect(
      classifyStaticHand({ rightHand: SYNTHETIC_PRESETS.SEIS({ handedness: 'Right' }) }).label
    ).toBe(SIGN_LABELS.SEIS);
    expect(
      classifyStaticHand({ rightHand: SYNTHETIC_PRESETS.LUNES({ handedness: 'Right' }) }).label
    ).toBe(SIGN_LABELS.LUNES);
    expect(
      classifyStaticHand({ rightHand: SYNTHETIC_PRESETS.SIETE({ handedness: 'Right' }) }).label
    ).toBe(SIGN_LABELS.SIETE);
    expect(
      classifyStaticHand({ rightHand: SYNTHETIC_PRESETS.CUATRO({ handedness: 'Right' }) }).label
    ).toBe(SIGN_LABELS.CUATRO);
    expect(
      classifyStaticHand({ rightHand: SYNTHETIC_PRESETS.NUEVE({ handedness: 'Right' }) }).label
    ).toBe(SIGN_LABELS.NUEVE);
  });

  it('reconoce Puño dorsal (dorso a cámara con oclusión y compresión Z) en ambas manos', () => {
    const bp = 0.15;
    const dorsalRight = SYNTHETIC_PRESETS.PUNO({ handedness: 'Right', palmFacing: 'BACK' });
    const dorsalLeft = SYNTHETIC_PRESETS.PUNO({ handedness: 'Left', palmFacing: 'BACK' });
    expect(classifyStaticHand({ rightHand: dorsalRight }).label).toBe(SIGN_LABELS.PUNO);
    expect(classifyStaticHand({ leftHand: dorsalLeft }).label).toBe(SIGN_LABELS.PUNO);

    const mcpSpecs = [
      [5, -0.32, -0.95],
      [9, 0.0, -1.0],
      [13, 0.3, -0.92],
      [17, 0.56, -0.82],
    ];
    const dorsalHard = SYNTHETIC_PRESETS.PUNO();
    for (const [mcpIdx, mx, my] of mcpSpecs) {
      dorsalHard[mcpIdx] = { x: 0.5 + mx * bp, y: 0.7 + my * bp, z: 0 };
      dorsalHard[mcpIdx + 1] = { x: 0.5 + mx * bp, y: 0.7 + (my - 0.3) * bp, z: 0.18 * bp };
      dorsalHard[mcpIdx + 2] = { x: 0.5 + mx * bp, y: 0.7 + (my - 0.25) * bp, z: 0.44 * bp };
      dorsalHard[mcpIdx + 3] = { x: 0.5 + mx * bp, y: 0.7 + (my - 0.16) * bp, z: 0.62 * bp };
    }
    dorsalHard[1] = { x: 0.5 - 0.22 * bp, y: 0.7 - 0.22 * bp, z: 0.08 * bp };
    dorsalHard[2] = { x: 0.5 - 0.33 * bp, y: 0.7 - 0.45 * bp, z: 0.18 * bp };
    dorsalHard[3] = { x: 0.5 - 0.39 * bp, y: 0.7 - 0.66 * bp, z: 0.28 * bp };
    dorsalHard[4] = { x: 0.5 - 0.42 * bp, y: 0.7 - 0.82 * bp, z: 0.35 * bp };
    const dorsalHardRes = classifyStaticHand({ rightHand: dorsalHard });
    expect(dorsalHardRes.label).toBe(SIGN_LABELS.PUNO);
    expect(dorsalHardRes.confidence).toBeGreaterThanOrEqual(0.68);
  });

  it('calcula confianza continua real basada en margen geométrico (limpia > borde > rechazo)', () => {
    const clean = classifyStaticHand(SYNTHETIC_PRESETS.UNO());
    const bp = 0.15;
    const borderline = SYNTHETIC_PRESETS.UNO();
    const m = borderline[5];
    borderline[6] = { x: m.x, y: m.y - 0.45 * bp, z: 0 };
    borderline[7] = { x: m.x, y: m.y - 0.74 * bp, z: -0.2 * bp };
    borderline[8] = { x: m.x, y: m.y - 0.96 * bp, z: -0.44 * bp };
    const borderRes = classifyStaticHand(borderline);

    expect(clean.label).toBe(SIGN_LABELS.UNO);
    expect(clean.confidence).toBeGreaterThanOrEqual(0.9);
    expect(clean.confidence).toBeLessThanOrEqual(1.0);
    if (borderRes.label === SIGN_LABELS.UNO) {
      expect(borderRes.confidence).toBeLessThan(clean.confidence);
    } else {
      expect(borderRes.confidence).toBe(0);
    }

    // fingerStates sigue exponiendo estados booleanos limpios
    const st = fingerStates(SYNTHETIC_PRESETS.CINCO());
    expect(st.extendedCount).toBe(5);
  });
});
