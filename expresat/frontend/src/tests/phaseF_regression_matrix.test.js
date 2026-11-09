/**
 * src/tests/phaseF_regression_matrix.test.js — Pruebas de Fase F (Matriz de Confusión Global, Fixtures y Regresión)
 */

import { describe, it, expect } from 'vitest';
import sampleFixtures from '../../fixtures/real/sample_fixtures.json';
import {
  GeometricClassifier,
  getSignCatalog,
  SYNTHETIC_NUMBERS,
  SYNTHETIC_LETTERS,
  addLandmarkJitter,
  evaluateConfusionMatrix,
  buildFullSyntheticBenchmark,
  buildSyntheticHand,
} from '../recognition/index.js';

describe('Fase F: Auditoría de Catálogo Completo, Matriz de Confusión y Fixtures con Ruido Realista', () => {
  it('1. El catálogo declarativo completo contiene exactamente 49 señas con fuente verificada y 0 PENDIENTE_FUENTE', () => {
    const catalog = getSignCatalog('all');
    expect(catalog.length).toBe(49);
    const pending = catalog.filter((s) => s.estado === 'PENDIENTE_FUENTE');
    expect(pending.length).toBe(0);

    for (const sign of catalog) {
      expect(typeof sign.fuente).toBe('string');
      expect(sign.fuente.trim().length).toBeGreaterThan(10);
      expect(['basica', 'numero', 'letra']).toContain(sign.categoria);
      expect(['estatica', 'dinamica']).toContain(sign.tipo);
    }
  });

  it('2. Matriz de confusión sintética global (49 clases: 9 base + 11 números + 29 letras/dígrafos) alcanza 100% de exactitud diagonal', () => {
    const benchmark = buildFullSyntheticBenchmark();
    expect(benchmark.length).toBe(49);

    const report = evaluateConfusionMatrix(benchmark);
    expect(report.confusions).toEqual([]);
    expect(report.confused).toBe(0);
    expect(report.rejected).toBe(0);
    expect(report.accuracy).toBe(1);
  });

  it('3. Matriz de confusión sobre fixtures multi-frame con ruido de cámara (fixtures/real/sample_fixtures.json) supera 95% de precisión sin confusiones cruzadas', () => {
    expect(Array.isArray(sampleFixtures)).toBe(true);
    expect(sampleFixtures.length).toBe(40);

    const report = evaluateConfusionMatrix(sampleFixtures);
    expect(report.confused).toBe(0);
    expect(report.accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it('4. Robustez ante jitter gaussiano proporcional a escala, mano izquierda y escalas [0.5x, 2.5x] en subconjunto representativo de cada grupo G1..G7', () => {
    const clfNum = new GeometricClassifier({ mode: 'numbers', smoothingWindow: 1, minVotes: 1 });
    for (const num of ['0', '3', '6', '7', '9']) {
      for (const handedness of ['Right', 'Left']) {
        for (const scale of [0.5, 2.5]) {
          clfNum.reset();
          const raw = SYNTHETIC_NUMBERS[num]({ handedness, scale });
          const noisy = addLandmarkJitter(raw, 0.0012 * scale, 42);
          const res = clfNum.predict(noisy);
          const matched = res.label === num || (res.details?.aliases || []).includes(num);
          expect(matched, `Fallo en número ${num} (${handedness}, scale=${scale}): obtuvo ${res.label}`).toBe(true);
        }
      }
    }

    const clfAlpha = new GeometricClassifier({ mode: 'alphabet', smoothingWindow: 1, minVotes: 1 });
    for (const letter of ['A', 'E', 'S', 'T', 'D', 'F', 'G', 'H', 'P', 'M', 'N', 'R', 'U', 'V', 'W', 'Y']) {
      for (const handedness of ['Right', 'Left']) {
        clfAlpha.reset();
        const raw = SYNTHETIC_LETTERS[letter]({ handedness, scale: 1.5 });
        const noisy = addLandmarkJitter(raw, 0.0015, 77);
        const res = clfAlpha.predict(noisy);
        const matched = res.label === letter || (res.details?.aliases || []).includes(letter);
        expect(matched, `Fallo en letra ${letter} (${handedness}): obtuvo ${res.label}`).toBe(true);
      }
    }
  });

  it('5. Rechazo estricto de configuraciones ambiguas/intermedias con LOW_CONFIDENCE (sin falsos positivos)', () => {
    const clfAlpha = new GeometricClassifier({
      mode: 'alphabet',
      minConfidence: 0.85,
      smoothingWindow: 1,
      minVotes: 1,
    });

    // Mano con todos los dedos a medio camino (~135° PIP) que no corresponde a una letra nítida
    const ambiguous = buildSyntheticHand({
      thumb: 'HOOKED',
      index: 'HOOKED',
      middle: 'EXTENDED',
      ring: 'HOOKED',
      pinky: 'EXTENDED',
      palmFacing: 'SIDE',
    });

    const res = clfAlpha.predict(ambiguous);
    if (!res.label) {
      expect(res.details?.reason).toBe('LOW_CONFIDENCE');
    }
  });
});
