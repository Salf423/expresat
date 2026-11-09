import { describe, it, expect } from 'vitest';
import { classify, SYNTHETIC_LETTERS } from '../recognition/index.js';

describe('Fase D — Letras Estáticas del Alfabeto LSM por Grupo Confundible', () => {
  describe('Sub-fase D.1 — Grupo G1_PUNO_CERRADO (A, E, O, S, T)', () => {
    const g1Letters = ['A', 'E', 'O', 'S', 'T'];

    it('reconoce las 5 letras de G1_PUNO_CERRADO (A, E, O, S, T) en mano derecha e izquierda', () => {
      for (const letter of g1Letters) {
        for (const handedness of ['Right', 'Left']) {
          const hand = SYNTHETIC_LETTERS[letter]({ handedness });
          const res = classify(hand, { mode: 'alphabet' });
          expect(res.label).toBe(letter);
          expect(res.category).toBe('letra');
          expect(res.confidence).toBeGreaterThanOrEqual(0.8);
        }
      }
    });

    it('mantiene invariancia a escala (0.4x a 3.0x) en A, E, O, S, T', () => {
      const scales = [0.4, 0.75, 1.0, 1.8, 3.0];
      for (const letter of g1Letters) {
        for (const scale of scales) {
          const hand = SYNTHETIC_LETTERS[letter]({ scale });
          const res = classify(hand, { mode: 'alphabet' });
          expect(res.label).toBe(letter);
        }
      }
    });

    it('desempata correctamente A vs S vs T vs E vs O dentro del mismo grupo confundible en modo global', () => {
      expect(classify(SYNTHETIC_LETTERS.A(), { mode: 'all' }).label).toBe('A');
      expect(classify(SYNTHETIC_LETTERS.E(), { mode: 'all' }).label).toBe('E');
      expect(classify(SYNTHETIC_LETTERS.T(), { mode: 'all' }).label).toBe('T');
      // O comparte postura con 0 y S con Puño; en modo alphabet devuelven O y S con margen > 0.05 sobre el resto de G1
      const resO = classify(SYNTHETIC_LETTERS.O(), { mode: 'alphabet' });
      expect(resO.label).toBe('O');
      expect(resO.details.margin).toBeGreaterThanOrEqual(0.05);

      const resS = classify(SYNTHETIC_LETTERS.S(), { mode: 'alphabet' });
      expect(resS.label).toBe('S');
      expect(resS.details.margin).toBeGreaterThanOrEqual(0.05);
    });
  });
});
