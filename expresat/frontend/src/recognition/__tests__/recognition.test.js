import { describe, it, expect } from 'vitest';
import {
  SIGN_LABELS,
  fingerStates,
  classify,
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

    // Puntos colapsados en el mismo lugar (palmScale = 0)
    const collapsed = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    expect(classify(collapsed).label).toBeNull();

    // Puntos con NaN
    const withNaN = SYNTHETIC_PRESETS.MANO_ABIERTA();
    withNaN[8] = { x: Number.NaN, y: 0.5, z: 0 };
    expect(classify(withNaN).label).toBeNull();

    // Ruido aleatorio incoherente (nudillos dispersos de extremo a extremo)
    const randomNoise = Array.from({ length: 21 }, (_, idx) => ({
      x: (idx * 0.73) % 1.0,
      y: (idx * 0.41) % 1.0,
      z: (idx * 0.19) % 1.0,
    }));
    // Asegurar un palmScale pequeño pero nudillos con saltos > 1.2 * palmScale
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

    // Un frame aislado de ruido o clasificación distinta no tumba el consenso
    const noisy = voter.push({ label: SIGN_LABELS.PUNO, confidence: 0.8 });
    expect(noisy.label).toBe(SIGN_LABELS.UNO);

    // En GeometricClassifier (modo streaming frame a frame), 1 frame aislado desde reposo
    // NO emite etiqueta hasta alcanzar minVotes (evita parpadeos)
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
});
