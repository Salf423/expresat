/**
 * src/engine/__tests__/featureExtractor.test.js
 *
 * Suite de conformidad de featureExtractor.js (JavaScript) con FEATURE_SPEC.md v1.2.2.
 * Consume OBLIGATORIAMENTE tests/fixtures/feature_spec_cases.json y compara
 * ELEMENTO A ELEMENTO bajo la norma del supremo L_inf <= 1e-6.
 */

import { describe, it, expect } from 'vitest';
import fixtures from '../../../../../tests/fixtures/feature_spec_cases.json';
import {
  FEATURE_SPEC_VERSION,
  TOTAL_FEATURES,
  SEQUENCE_LENGTH,
  extractFrameFeatures,
  extractWindow,
  mirrorRawFrame,
  mirrorFeatures178,
} from '../featureExtractor.js';

function assertLinfClose(actual, expected, atol = 1e-6, msg = '') {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expect(actual.length).toBe(expected.length);

  let maxDiff = 0.0;
  let maxIdx = -1;

  for (let i = 0; i < actual.length; i++) {
    const diff = Math.abs(actual[i] - expected[i]);
    if (diff > maxDiff) {
      maxDiff = diff;
      maxIdx = i;
    }
  }

  if (maxDiff > atol) {
    throw new Error(
      `Error L_inf=${maxDiff.toExponential(4)} excede tolerancia ${atol.toExponential(1)} en ${msg}. Índice de máximo error: ${maxIdx} (actual=${actual[maxIdx]}, expected=${expected[maxIdx]})`
    );
  }
}

describe('featureExtractor.js — Conformidad FEATURE_SPEC v1.3.0', () => {
  it('constantes de versión coinciden con el fixture compartido', () => {
    expect(FEATURE_SPEC_VERSION).toBe(fixtures.feature_spec_version);
    expect(FEATURE_SPEC_VERSION).toBe('1.3.0');
    expect(TOTAL_FEATURES).toBe(178);
    expect(SEQUENCE_LENGTH).toBe(15);
  });

  describe('Casos de Frame (feature_spec_cases.json)', () => {
    for (const [caseId, caseData] of Object.entries(fixtures.frame_cases)) {
      it(`Frame Case: ${caseId}`, () => {
        const rawInput = JSON.parse(JSON.stringify(caseData.input));
        const expected = caseData.expected;

        const { features, valid, error } = extractFrameFeatures(rawInput);
        expect(valid).toBe(expected.valid);
        expect(error).toBe(expected.error);

        if (expected.features !== null) {
          assertLinfClose(features, expected.features, 1e-6, caseId);
        } else {
          expect(features).toBeNull();
        }
      });
    }
  });

  describe('Casos de Ventana (feature_spec_cases.json)', () => {
    for (const [caseId, caseData] of Object.entries(fixtures.window_cases)) {
      it(`Window Case: ${caseId}`, () => {
        const rawInput = JSON.parse(JSON.stringify(caseData.input));
        const options = caseData.options || {};
        const expected = caseData.expected;

        const { tensor, valid, error } = extractWindow(rawInput, {
          targetFps: options.targetFps ?? 15,
          durationMs: options.durationMs ?? 1000.0,
        });

        expect(valid).toBe(expected.valid);
        expect(error).toBe(expected.error);

        if (expected.tensor !== null) {
          assertLinfClose(tensor, expected.tensor, 1e-6, caseId);
        } else {
          expect(tensor).toBeNull();
        }
      });
    }
  });

  describe('Pruebas de Propiedades Analíticas (L_inf <= 1e-6)', () => {
    it('Invarianza a traslación 3D', () => {
      const rawInput = fixtures.frame_cases.TC_01_canonical_frame.input;
      const { features: baseFeatures } = extractFrameFeatures(rawInput);

      const deltas = [
        [0.05, 0.03, 0.04],
        [-0.06, -0.04, -0.05],
        [0.07, -0.05, 0.02],
        [-0.04, 0.06, -0.03],
        [0.00, 0.00, 0.08],
      ];

      for (const [dx, dy, dz] of deltas) {
        const transFrame = JSON.parse(JSON.stringify(rawInput));
        for (const lm of transFrame.pose) {
          lm.x += dx;
          lm.y += dy;
          lm.z += dz;
        }
        for (const h of transFrame.hands) {
          for (const lm of h) {
            lm.x += dx;
            lm.y += dy;
            lm.z += dz;
          }
        }

        const { features: transFeats, valid } = extractFrameFeatures(transFrame);
        expect(valid).toBe(true);
        assertLinfClose(transFeats, baseFeatures, 1e-6, `Traslación delta=(${dx},${dy},${dz})`);
      }
    });

    it('Invarianza a escala', () => {
      const rawInput = fixtures.frame_cases.TC_01_canonical_frame.input;
      const { features: baseFeatures } = extractFrameFeatures(rawInput);

      const cx = 0.50;
      const cy = 0.40;
      const cz = 0.00;
      const scales = [0.85, 0.95, 1.05, 1.15, 1.20];

      for (const s of scales) {
        const scaledFrame = JSON.parse(JSON.stringify(rawInput));
        for (const lm of scaledFrame.pose) {
          lm.x = cx + s * (lm.x - cx);
          lm.y = cy + s * (lm.y - cy);
          lm.z = cz + s * (lm.z - cz);
        }
        for (const h of scaledFrame.hands) {
          for (const lm of h) {
            lm.x = cx + s * (lm.x - cx);
            lm.y = cy + s * (lm.y - cy);
            lm.z = cz + s * (lm.z - cz);
          }
        }

        const { features: scaledFeats, valid } = extractFrameFeatures(scaledFrame);
        expect(valid).toBe(true);
        assertLinfClose(scaledFeats, baseFeatures, 1e-6, `Escala s=${s}`);
      }
    });

    it('Conmutatividad de espejo', () => {
      const rawInput = fixtures.frame_cases.TC_01_canonical_frame.input;

      const mirroredRaw = mirrorRawFrame(rawInput);
      const { features: featMirroredRaw, valid: vm } = extractFrameFeatures(mirroredRaw);
      expect(vm).toBe(true);

      const { features: baseFeatures, valid: vb } = extractFrameFeatures(rawInput);
      expect(vb).toBe(true);
      const featMirrorFunc = mirrorFeatures178(baseFeatures);

      assertLinfClose(featMirroredRaw, featMirrorFunc, 1e-6, 'Conmutatividad de espejo');
    });

    it('Inmutabilidad de datos crudos (sin mutación por extractWindow o extractFrameFeatures)', () => {
      const rawInput = fixtures.frame_cases.TC_01_canonical_frame.input;
      const rawCopy = JSON.parse(JSON.stringify(rawInput));
      extractFrameFeatures(rawInput);
      expect(rawInput).toEqual(rawCopy);

      const winInput = fixtures.window_cases.TC_WINDOW_nominal_15_frames.input;
      const winCopy = JSON.parse(JSON.stringify(winInput));
      extractWindow(winInput, { durationMs: 1000.0 });
      expect(winInput).toEqual(winCopy);
    });
  });
});
