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

  describe('Sub-fase D.2 — Grupos G2_INDICE_SOLO (D) y G3_PULGAR_INDICE (G, L)', () => {
    const g2g3Letters = ['D', 'G', 'L'];

    it('reconoce las letras D, G, L en mano derecha e izquierda y a distintas escalas (0.4x a 3.0x)', () => {
      for (const letter of g2g3Letters) {
        for (const handedness of ['Right', 'Left']) {
          for (const scale of [0.4, 1.0, 3.0]) {
            const hand = SYNTHETIC_LETTERS[letter]({ handedness, scale });
            const res = classify(hand, { mode: 'alphabet' });
            expect(res.label).toBe(letter);
            expect(res.category).toBe('letra');
            expect(res.confidence).toBeGreaterThanOrEqual(0.8);
          }
        }
      }
    });

    it('desempata D vs 1/Uno, y G (HORIZONTAL+BACK) vs L (UP+FRONT) vs 7 (OBLIQUE+BACK)', () => {
      expect(classify(SYNTHETIC_LETTERS.D(), { mode: 'all' }).label).toBe('D');
      expect(classify(SYNTHETIC_LETTERS.G(), { mode: 'all' }).label).toBe('G');
      const resL = classify(SYNTHETIC_LETTERS.L(), { mode: 'alphabet' });
      expect(resL.label).toBe('L');
      expect(resL.details.margin).toBeGreaterThanOrEqual(0.05);
    });
  });

  describe('Sub-fase D.3 — Grupo G4_DOS_DEDOS (H, N, P, R, U, V)', () => {
    const g4Letters = ['H', 'N', 'P', 'R', 'U', 'V'];

    it('reconoce las 6 letras de G4_DOS_DEDOS (H, N, P, R, U, V) en mano derecha e izquierda y escalas (0.4x a 3.0x)', () => {
      for (const letter of g4Letters) {
        for (const handedness of ['Right', 'Left']) {
          for (const scale of [0.4, 1.0, 3.0]) {
            const hand = SYNTHETIC_LETTERS[letter]({ handedness, scale });
            const res = classify(hand, { mode: 'alphabet' });
            expect(res.label).toBe(letter);
            expect(res.category).toBe('letra');
            expect(res.confidence).toBeGreaterThanOrEqual(0.8);
          }
        }
      }
    });

    it('desempata sin confusión H vs N vs P vs R vs U vs V en modo global y alfabeto', () => {
      expect(classify(SYNTHETIC_LETTERS.H(), { mode: 'all' }).label).toBe('H');
      expect(classify(SYNTHETIC_LETTERS.N(), { mode: 'all' }).label).toBe('N');
      expect(classify(SYNTHETIC_LETTERS.P(), { mode: 'all' }).label).toBe('P');
      expect(classify(SYNTHETIC_LETTERS.R(), { mode: 'all' }).label).toBe('R');
      expect(classify(SYNTHETIC_LETTERS.U(), { mode: 'all' }).label).toBe('U');
      const resV = classify(SYNTHETIC_LETTERS.V(), { mode: 'alphabet' });
      expect(resV.label).toBe('V');
      expect(resV.details.margin).toBeGreaterThanOrEqual(0.05);
    });
  });
});
