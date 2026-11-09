import { describe, it, expect } from 'vitest';
import {
  classify,
  GeometricClassifier,
  SYNTHETIC_NUMBERS,
  SYNTHETIC_PRESETS,
} from '../recognition/index.js';

describe('Fase C — Reconocimiento de Números Básicos de LSM (0 a 10)', () => {
  const staticNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

  it('reconoce los 10 números estáticos (0 a 9) con alta confianza tanto en mano derecha como izquierda', () => {
    for (const num of staticNumbers) {
      for (const handedness of ['Right', 'Left']) {
        const hand = SYNTHETIC_NUMBERS[num]({ handedness });
        const res = classify(hand, { mode: 'numbers' });
        expect(res.label).toBe(num);
        expect(res.category).toBe('numero');
        expect(res.confidence).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('mantiene invariancia a escala (0.4x a 3.0x) en todos los números estáticos (0 a 9)', () => {
    const scales = [0.4, 0.75, 1.0, 1.8, 3.0];
    for (const num of staticNumbers) {
      for (const scale of scales) {
        const hand = SYNTHETIC_NUMBERS[num]({ scale });
        const res = classify(hand, { mode: 'numbers' });
        expect(res.label).toBe(num);
        expect(res.confidence).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('mantiene invariancia a rotación (-90° a 180°) en los números que no dependen de orientación (0, 1, 2, 5)', () => {
    const angles = [-90, -45, 0, 45, 90, 135, 180];
    for (const num of ['0', '1', '2', '5']) {
      for (const rotateDeg of angles) {
        const hand = SYNTHETIC_NUMBERS[num]({ rotateDeg });
        const res = classify(hand, { mode: 'numbers' });
        expect(res.label).toBe(num);
      }
    }
  });

  it('desempata correctamente pares confundibles: 4 (FRONT) vs 9 (BACK), 6 (BACK+UP) vs Bien (FRONT), 7 (OBLIQUE+BACK) vs Lunes (UP+FRONT), 3 vs 8', () => {
    // 4 vs 9
    expect(classify(SYNTHETIC_NUMBERS[4](), { mode: 'all' }).label).toBe('4');
    expect(classify(SYNTHETIC_NUMBERS[9](), { mode: 'all' }).label).toBe('9');

    // 6 vs Bien
    expect(classify(SYNTHETIC_NUMBERS[6](), { mode: 'all' }).label).toBe('6');
    expect(classify(SYNTHETIC_PRESETS.BIEN({ palmFacing: 'FRONT' }), { mode: 'all' }).label).toBe('Bien');

    // 7 vs Lunes
    expect(classify(SYNTHETIC_NUMBERS[7](), { mode: 'all' }).label).toBe('7');
    expect(classify(SYNTHETIC_PRESETS.LUNES({ palmFacing: 'FRONT' }), { mode: 'all' }).label).toBe('Lunes');

    // 3 vs 8
    expect(classify(SYNTHETIC_NUMBERS[3](), { mode: 'all' }).label).toBe('3');
    expect(classify(SYNTHETIC_NUMBERS[8](), { mode: 'all' }).label).toBe('8');

    // 0 vs Puño
    expect(classify(SYNTHETIC_NUMBERS[0](), { mode: 'all' }).label).toBe('0');
    expect(classify(SYNTHETIC_PRESETS.PUNO(), { mode: 'all' }).label).toBe('Puño');
  });

  it('reconoce el número dinámico 10 (giro de muñeca en mano abierta) a 15 FPS y 30 FPS sin confundirlo con Hola', () => {
    for (const fps of [15, 30]) {
      const frames10 = SYNTHETIC_NUMBERS[10]({ fps });
      const clf = new GeometricClassifier({ mode: 'all', windowMs: 750 });
      const res10 = clf.predict(frames10);
      expect(res10.label).toBe('10');
      expect(res10.category).toBe('numero');
      expect(res10.confidence).toBeGreaterThanOrEqual(0.85);
    }
  });
});
