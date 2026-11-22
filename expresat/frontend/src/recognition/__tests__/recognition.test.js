import { describe, it, expect } from 'vitest';
import {
  SIGN_LABELS,
  SIGN_CATALOG,
  fingerStates,
  classify,
  classifyStaticHand,
  GeometricClassifier,
  ModelClassifier,
  SmoothingVoter,
  buildSyntheticHand,
  SYNTHETIC_PRESETS,
} from '../index.js';

describe('recognition/ — Clasificación geométrica pura con landmarks sintéticos', () => {
  it('reconoce Mano Abierta (5 dedos extendidos)', () => {
    const hand = SYNTHETIC_PRESETS.MANO_ABIERTA();
    const states = fingerStates(hand);
    expect(states).not.toBeNull();
    expect(states.thumb).toBe(true);
    expect(states.index).toBe(true);
    expect(states.middle).toBe(true);
    expect(states.ring).toBe(true);
    expect(states.pinky).toBe(true);

    const res = classify(hand);
    expect(res.label).toBe(SIGN_LABELS.MANO_ABIERTA);
    expect(res.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reconoce Puño (5 dedos cerrados)', () => {
    const hand = SYNTHETIC_PRESETS.PUNO();
    const states = fingerStates(hand);
    expect(states.extendedCount).toBe(0);

    const res = classify(hand);
    expect(res.label).toBe(SIGN_LABELS.PUNO);
    expect(res.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reconoce Uno (solo dedo índice extendido)', () => {
    const hand = SYNTHETIC_PRESETS.UNO();
    const states = fingerStates(hand);
    expect(states.index).toBe(true);
    expect(states.middle).toBe(false);
    expect(states.ring).toBe(false);
    expect(states.pinky).toBe(false);
    expect(states.thumb).toBe(false);

    const res = classify(hand);
    expect(res.label).toBe(SIGN_LABELS.UNO);
    expect(res.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reconoce Dos (dedos índice y medio extendidos)', () => {
    const hand = SYNTHETIC_PRESETS.DOS();
    const states = fingerStates(hand);
    expect(states.index).toBe(true);
    expect(states.middle).toBe(true);
    expect(states.ring).toBe(false);
    expect(states.pinky).toBe(false);
    expect(states.thumb).toBe(false);

    const res = classify(hand);
    expect(res.label).toBe(SIGN_LABELS.DOS);
    expect(res.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('reconoce OK / Pinza (pulgar e índice unidos en pinza con medio, anular y meñique extendidos)', () => {
    const hand = SYNTHETIC_PRESETS.OK();
    const states = fingerStates(hand);
    expect(states.isPinching).toBe(true);
    expect(states.thumbIndexTipDist).toBeLessThan(0.35);

    const res = classify(hand);
    expect(res.label).toBe(SIGN_LABELS.OK);
    expect(res.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('reconoce Bien, Te Quiero (ILY) y Lunes (L)', () => {
    expect(classify(SYNTHETIC_PRESETS.BIEN()).label).toBe(SIGN_LABELS.BIEN);
    expect(classify(SYNTHETIC_PRESETS.TE_QUIERO()).label).toBe(SIGN_LABELS.TE_QUIERO);
    expect(classify(SYNTHETIC_PRESETS.LUNES()).label).toBe(SIGN_LABELS.LUNES);
  });

  it('es invariante a escala (0.4x a 3.0x) y traslación en el encuadre', () => {
    const scales = [0.4, 0.75, 1.0, 1.8, 3.0];
    const offsets = [
      { offsetX: 0.15, offsetY: 0.25 },
      { offsetX: 0.85, offsetY: 0.8 },
    ];

    for (const scale of scales) {
      for (const offset of offsets) {
        expect(classify(SYNTHETIC_PRESETS.MANO_ABIERTA({ scale, ...offset })).label).toBe(
          SIGN_LABELS.MANO_ABIERTA
        );
        expect(classify(SYNTHETIC_PRESETS.PUNO({ scale, ...offset })).label).toBe(SIGN_LABELS.PUNO);
        expect(classify(SYNTHETIC_PRESETS.UNO({ scale, ...offset })).label).toBe(SIGN_LABELS.UNO);
        expect(classify(SYNTHETIC_PRESETS.DOS({ scale, ...offset })).label).toBe(SIGN_LABELS.DOS);
        expect(classify(SYNTHETIC_PRESETS.OK({ scale, ...offset })).label).toBe(SIGN_LABELS.OK);
      }
    }
  });

  it('es invariante a rotación en el plano XY (-90°, -45°, +30°, +90°, 180°)', () => {
    const angles = [-90, -45, -20, 0, 30, 60, 90, 180];

    for (const rotateDeg of angles) {
      expect(classify(SYNTHETIC_PRESETS.MANO_ABIERTA({ rotateDeg })).label).toBe(
        SIGN_LABELS.MANO_ABIERTA
      );
      expect(classify(SYNTHETIC_PRESETS.PUNO({ rotateDeg })).label).toBe(SIGN_LABELS.PUNO);
      expect(classify(SYNTHETIC_PRESETS.UNO({ rotateDeg })).label).toBe(SIGN_LABELS.UNO);
      expect(classify(SYNTHETIC_PRESETS.DOS({ rotateDeg })).label).toBe(SIGN_LABELS.DOS);
      expect(classify(SYNTHETIC_PRESETS.OK({ rotateDeg })).label).toBe(SIGN_LABELS.OK);
    }
  });

  it('rechaza ruido, arreglos incompletos, coordenadas NaN y manos colapsadas', () => {
    expect(classify(null).label).toBeNull();
    expect(classify([]).label).toBeNull();
    expect(classify([{ x: 0.5, y: 0.5, z: 0 }]).label).toBeNull();

    // Collapsed points at the same location (palmScale = 0)
    const collapsed = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(classify(collapsed).label).toBeNull();

    // Points containing NaN
    const withNaN = SYNTHETIC_PRESETS.MANO_ABIERTA();
    withNaN[8] = { x: Number.NaN, y: 0.5, z: 0 };
    expect(classify(withNaN).label).toBeNull();

    // Incoherent random noise (knuckles scattered across the entire space)
    const randomNoise = Array.from({ length: 21 }, (_, idx) => ({
      x: (idx * 0.73) % 1.0,
      y: (idx * 0.41) % 1.0,
      z: (idx * 0.19) % 1.0,
    }));
    // Keep palmScale small while spacing knuckles by > 1.2 * palmScale
    randomNoise[0] = { x: 0.5, y: 0.5, z: 0 };
    randomNoise[9] = { x: 0.5, y: 0.45, z: 0 };
    randomNoise[5] = { x: 0.95, y: 0.95, z: 0 };
    expect(classify(randomNoise).label).toBeNull();
  });

  it('detecta gesto dinámico Hola cuando una Mano Abierta oscila lateralmente en el buffer temporal', () => {
    const clf = new GeometricClassifier({ bufferSize: 15, smoothingWindow: 5, minVotes: 3 });
    const xs = [0.4, 0.46, 0.52, 0.46, 0.38, 0.45, 0.53, 0.45, 0.39, 0.47];
    const batch = xs.map((offsetX) => ({
      rightHand: buildSyntheticHand({
        thumb: true,
        index: true,
        middle: true,
        ring: true,
        pinky: true,
        offsetX,
      }),
    }));

    const result = clf.predict(batch);
    expect(result.label).toBe(SIGN_LABELS.HOLA);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.details.wave.isWaving).toBe(true);
    expect(result.details.wave.directionChanges).toBeGreaterThanOrEqual(2);
  });

  it('suaviza predicciones por votación de N frames e ignora un frame espurio aislado', () => {
    const voter = new SmoothingVoter(5, 3);
    voter.push({ label: SIGN_LABELS.UNO, confidence: 0.95 });
    voter.push({ label: SIGN_LABELS.UNO, confidence: 0.95 });
    const third = voter.push({ label: SIGN_LABELS.UNO, confidence: 0.95 });
    expect(third.label).toBe(SIGN_LABELS.UNO);

    // A single noisy or mismatched frame does not break consensus
    const noisy = voter.push({ label: SIGN_LABELS.PUNO, confidence: 0.8 });
    expect(noisy.label).toBe(SIGN_LABELS.UNO);

    // In GeometricClassifier frame-by-frame mode, a single frame from rest
    // must not emit a label until reaching minVotes (prevents flicker)
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

  it('expone SIGN_CATALOG como fuente única de verdad alineada 1:1 con SIGN_LABELS', () => {
    expect(Array.isArray(SIGN_CATALOG)).toBe(true);
    const catalogLabels = SIGN_CATALOG.map((item) => item.label);
    expect(catalogLabels).toEqual(Object.values(SIGN_LABELS));
    for (const item of SIGN_CATALOG) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(['static', 'dynamic']).toContain(item.type);
      expect(typeof item.hint).toBe('string');
      expect(typeof item.speakText).toBe('string');
    }
  });

  it('corrige anisotropía 4:3 (640x480) al proyectar mano anatómica vertical y rotada', () => {
    const bp = 0.15;
    const base = SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX: 0.5, offsetY: 0.5 });
    // Pulgar con abducción anatómica natural que pasa en 1:1 pero fallaba en 4:3 sin corrección
    base[1] = { x: 0.5 - 0.25 * bp, y: 0.5 - 0.24 * bp, z: 0 };
    base[2] = { x: 0.5 - 0.46 * bp, y: 0.5 - 0.48 * bp, z: 0 };
    base[3] = { x: 0.5 - 0.64 * bp, y: 0.5 - 0.72 * bp, z: 0 };
    base[4] = { x: 0.5 - 0.80 * bp, y: 0.5 - 0.92 * bp, z: 0 };

    const project43 = (hand, deg) => {
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const w = hand[0];
      return hand.map((p) => {
        const dx = p.x - w.x;
        const dy = p.y - w.y;
        return {
          x: 0.5 + (dx * c - dy * s),
          y: 0.5 + (dx * s + dy * c) * (4 / 3),
          z: p.z,
        };
      });
    };

    for (const deg of [-25, 0, 25, 45, 90]) {
      const res = classifyStaticHand({
        rightHand: project43(base, deg),
        videoWidth: 640,
        videoHeight: 480,
      });
      expect(res.label).toBe(SIGN_LABELS.MANO_ABIERTA);
    }

    // También en móvil vertical portrait (480x640, ratio 0.75 y 720x1280, ratio 0.5625)
    const projectPortrait = (hand, deg, aspect) => {
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
      [480, 640],
      [720, 1280],
    ]) {
      const ratio = vw / vh;
      for (const deg of [-25, 0, 25, 90]) {
        const res = classifyStaticHand({
          leftHand: projectPortrait(base, deg, ratio),
          videoWidth: vw,
          videoHeight: vh,
          aspectRatio: ratio,
        });
        expect(res.label).toBe(SIGN_LABELS.MANO_ABIERTA);
      }
    }
  });

  it('usa ángulos articulares MCP/PIP/DIP y rechaza mano doblada 90° en MCP y reposo relajado / Letra C', () => {
    const bp = 0.15;
    // Mano doblada 90° hacia cámara solo en MCP (falanges rectas) -> NO debe ser Mano Abierta
    const shelfHand = SYNTHETIC_PRESETS.MANO_ABIERTA();
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

    // Mano en reposo relajado / Letra C (PIP ~130°, DIP ~145°: ni extendida ni cerrada) -> rechazo explícito (NO Puño)
    const relaxed = SYNTHETIC_PRESETS.MANO_ABIERTA();
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
    // Pulgar recogido
    const fistThumb = SYNTHETIC_PRESETS.PUNO();
    for (let i = 1; i <= 4; i++) relaxed[i] = fistThumb[i];
    expect(classifyStaticHand(relaxed).label).toBeNull();
  });

  it('elimina colisiones críticas: Puño natural vs OK/Pinza, Letra A vs Puño/Bien, Pulgar abajo vs Bien y Uno vs Lunes estrecho', () => {
    const bp = 0.15;

    // 1. Puño humano natural con pulgar tocando el índice flexionado -> debe ser Puño, NO OK/Pinza
    const naturalFist = SYNTHETIC_PRESETS.PUNO();
    naturalFist[3] = { x: 0.5 - 0.3 * bp, y: 0.7 - 0.65 * bp, z: -0.04 * bp };
    naturalFist[4] = { x: 0.5 - 0.18 * bp, y: 0.7 - 0.78 * bp, z: -0.05 * bp };
    expect(classifyStaticHand(naturalFist).label).toBe(SIGN_LABELS.PUNO);

    // 2. Pulgar hacia abajo (180°) -> NO debe ser Bien
    const thumbsDown = SYNTHETIC_PRESETS.BIEN({ rotateDeg: 180 });
    expect(classifyStaticHand(thumbsDown).label).not.toBe(SIGN_LABELS.BIEN);

    // 3. Uno con pulgar casi paralelo (~20°) -> NO debe ser Lunes
    const narrowL = SYNTHETIC_PRESETS.UNO();
    narrowL[1] = { x: 0.5 - 0.28 * bp, y: 0.7 - 0.25 * bp, z: 0 };
    narrowL[2] = { x: 0.5 - 0.48 * bp, y: 0.7 - 0.58 * bp, z: 0 };
    narrowL[3] = { x: 0.5 - 0.64 * bp, y: 0.7 - 0.92 * bp, z: 0 };
    narrowL[4] = { x: 0.5 - 0.78 * bp, y: 0.7 - 1.25 * bp, z: 0 };
    expect(classifyStaticHand(narrowL).label).not.toBe(SIGN_LABELS.LUNES);

    // 4. Letra A (puño con pulgar recto pegado al lateral del índice) -> rechazada como ambigua, no Bien ni OK
    const letraA = SYNTHETIC_PRESETS.PUNO();
    letraA[1] = { x: 0.5 - 0.25 * bp, y: 0.7 - 0.3 * bp, z: 0 };
    letraA[2] = { x: 0.5 - 0.38 * bp, y: 0.7 - 0.6 * bp, z: 0 };
    letraA[3] = { x: 0.5 - 0.44 * bp, y: 0.7 - 0.9 * bp, z: 0 };
    letraA[4] = { x: 0.5 - 0.46 * bp, y: 0.7 - 1.2 * bp, z: 0 };
    expect(classifyStaticHand(letraA).label).toBeNull();
  });

  it('mantiene simetría exacta entre mano izquierda y derecha bajo v1.4.0 y prioriza la mano que ejecuta una seña', () => {
    const mirrorX = (hand) => hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 }));
    for (const key of ['MANO_ABIERTA', 'PUNO', 'UNO', 'DOS', 'OK', 'BIEN', 'TE_QUIERO', 'LUNES']) {
      const right = SYNTHETIC_PRESETS[key]();
      const left = mirrorX(right);
      const rRight = classifyStaticHand({ rightHand: right, leftHand: null });
      const rLeft = classifyStaticHand({ rightHand: null, leftHand: left });
      expect(rLeft.label).toBe(rRight.label);
      expect(Math.abs(rLeft.confidence - rRight.confidence)).toBeLessThan(0.01);
    }

    // Usuario zurdo señando "Uno" en leftHand mientras rightHand está en postura ambigua/reposo
    const bp = 0.15;
    const restingHand = SYNTHETIC_PRESETS.MANO_ABIERTA({ offsetX: 0.25 });
    for (const mcpIdx of [5, 9, 13, 17]) {
      const m = restingHand[mcpIdx];
      const a1 = (20 * Math.PI) / 180;
      const a2 = (70 * Math.PI) / 180;
      const a3 = (105 * Math.PI) / 180;
      const p1 = { x: m.x, y: m.y - 0.45 * bp * Math.cos(a1), z: m.z - 0.45 * bp * Math.sin(a1) };
      const p2 = { x: p1.x, y: p1.y - 0.35 * bp * Math.cos(a2), z: p1.z - 0.35 * bp * Math.sin(a2) };
      const p3 = { x: p2.x, y: p2.y - 0.32 * bp * Math.cos(a3), z: p2.z - 0.32 * bp * Math.sin(a3) };
      restingHand[mcpIdx + 1] = p1;
      restingHand[mcpIdx + 2] = p2;
      restingHand[mcpIdx + 3] = p3;
    }
    const leftSigning = classifyStaticHand({
      leftHand: mirrorX(SYNTHETIC_PRESETS.UNO({ offsetX: 0.75 })),
      rightHand: restingHand,
    });
    expect(leftSigning.label).toBe(SIGN_LABELS.UNO);
  });

  it('calcula confianza continua real basada en margen geométrico (limpia > borde > rechazo)', () => {
    const clean = classifyStaticHand(SYNTHETIC_PRESETS.UNO());
    // Índice ligeramente flexionado (~145° PIP, cerca del umbral 135°)
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
  });
});
