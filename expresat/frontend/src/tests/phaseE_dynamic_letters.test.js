import { describe, it, expect } from 'vitest';
import {
  classify,
  GeometricClassifier,
  SYNTHETIC_LETTERS,
  SYNTHETIC_NUMBERS,
} from '../recognition/index.js';

describe('Fase E — Letras Dinámicas del Alfabeto LSM (J, K, LL, Ñ, Q, RR, X, Z)', () => {
  const dynamicLetters = ['J', 'K', 'LL', 'Ñ', 'Q', 'RR', 'X', 'Z'];

  it('reconoce las 8 letras dinámicas en mano derecha e izquierda tanto a 15 FPS como a 30 FPS', () => {
    for (const letter of dynamicLetters) {
      for (const handedness of ['Right', 'Left']) {
        for (const fps of [15, 30]) {
          const seq = SYNTHETIC_LETTERS[letter]({ handedness, fps });
          const clf = new GeometricClassifier({ mode: 'all', windowMs: 750 });
          const res = clf.predict(seq);
          expect(res.label).toBe(letter);
          expect(res.category).toBe('letra');
          expect(res.confidence).toBeGreaterThanOrEqual(0.85);
        }
      }
    }
  });

  it('mantiene invariancia a escala (0.4x a 3.0x) en las 8 letras dinámicas', () => {
    for (const letter of dynamicLetters) {
      for (const scale of [0.4, 1.0, 3.0]) {
        const seq = SYNTHETIC_LETTERS[letter]({ scale, fps: 25 });
        const clf = new GeometricClassifier({ mode: 'all', windowMs: 750 });
        const res = clf.predict(seq);
        expect(res.label).toBe(letter);
        expect(res.confidence).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  it('desempata correctamente cada letra dinámica frente a su contraparte estática (J vs I, K vs P, LL vs L, Ñ vs N, RR vs R, Z vs 1, Q vs X)', () => {
    const clf = new GeometricClassifier({ mode: 'all', windowMs: 750 });

    // Estáticas vs Dinámicas
    expect(classify(SYNTHETIC_LETTERS.I(), { mode: 'all' }).label).toBe('I');
    expect(clf.predict(SYNTHETIC_LETTERS.J()).label).toBe('J');

    expect(classify(SYNTHETIC_LETTERS.P(), { mode: 'all' }).label).toBe('P');
    expect(clf.predict(SYNTHETIC_LETTERS.K()).label).toBe('K');

    expect(classify(SYNTHETIC_LETTERS.L(), { mode: 'alphabet' }).label).toBe('L');
    expect(clf.predict(SYNTHETIC_LETTERS.LL()).label).toBe('LL');

    expect(classify(SYNTHETIC_LETTERS.N(), { mode: 'all' }).label).toBe('N');
    expect(clf.predict(SYNTHETIC_LETTERS.Ñ()).label).toBe('Ñ');

    expect(classify(SYNTHETIC_LETTERS.R(), { mode: 'all' }).label).toBe('R');
    expect(clf.predict(SYNTHETIC_LETTERS.RR()).label).toBe('RR');

    expect(classify(SYNTHETIC_NUMBERS[1](), { mode: 'numbers' }).label).toBe('1');
    expect(clf.predict(SYNTHETIC_LETTERS.Z()).label).toBe('Z');

    // Q (DOWN + BACK) vs X (UP + FRONT)
    expect(clf.predict(SYNTHETIC_LETTERS.Q()).label).toBe('Q');
    expect(clf.predict(SYNTHETIC_LETTERS.X()).label).toBe('X');
  });
});
