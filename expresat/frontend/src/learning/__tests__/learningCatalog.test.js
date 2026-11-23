import { describe, it, expect } from 'vitest';
import { SIGN_CATALOG, SIGN_LABELS } from '../../recognition/index.js';
import {
  LEARNING_CATEGORIES,
  ALL_LEARNING_SIGNS,
  ALL_LEARNING_SIGN_IDS,
  getLearningSignByLabel,
  getLearningSignById,
  getSignProfile,
} from '../catalog.js';

describe('learning/catalog — 4 apartados oficiales mapeados 1:1 con SIGN_CATALOG', () => {
  it('define exactamente las 4 categorías oficiales en orden', () => {
    const titles = LEARNING_CATEGORIES.map((c) => c.title);
    expect(titles).toEqual([
      'Números',
      'Letras',
      'Frases cortas',
      'Agradecimientos/Modales',
    ]);
    for (const cat of LEARNING_CATEGORIES) {
      expect(cat.signs.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('mapea el 100% de SIGN_CATALOG sin señas muertas ni duplicados', () => {
    const catalogIds = new Set(SIGN_CATALOG.map((s) => s.id));
    const catalogLabels = new Set(SIGN_CATALOG.map((s) => s.label));

    expect(ALL_LEARNING_SIGN_IDS.length).toBe(SIGN_CATALOG.length);
    expect(new Set(ALL_LEARNING_SIGN_IDS).size).toBe(SIGN_CATALOG.length);

    for (const sign of ALL_LEARNING_SIGNS) {
      expect(catalogIds.has(sign.id), `ID ${sign.id} debe existir en SIGN_CATALOG`).toBe(true);
      expect(catalogLabels.has(sign.label), `Label ${sign.label} debe existir en SIGN_CATALOG`).toBe(
        true
      );
      expect(sign.instructions.length).toBeGreaterThan(10);
      expect(sign.meaning.length).toBeGreaterThan(5);
      expect(getSignProfile(sign.label)).toBeTruthy();
      expect(getLearningSignByLabel(sign.label)?.id).toBe(sign.id);
      expect(getLearningSignById(sign.id)?.label).toBe(sign.label);
    }

    // Todos los números 0..10 deben estar en la categoría Números
    const numbersCat = LEARNING_CATEGORIES.find((c) => c.title === 'Números');
    const numberLabels = numbersCat.signs.map((s) => s.label);
    for (const expectedNum of [
      SIGN_LABELS.CERO,
      SIGN_LABELS.UNO,
      SIGN_LABELS.DOS,
      SIGN_LABELS.TRES,
      SIGN_LABELS.CUATRO,
      SIGN_LABELS.CINCO,
      SIGN_LABELS.SEIS,
      SIGN_LABELS.SIETE,
      SIGN_LABELS.OCHO,
      SIGN_LABELS.NUEVE,
      SIGN_LABELS.DIEZ,
    ]) {
      expect(numberLabels).toContain(expectedNum);
    }
  });
});
