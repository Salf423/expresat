/**
 * Mathematical conformance suite for featureExtractor.js against FEATURE_SPEC.md.
 * Compares element-by-element against tests/fixtures/feature_spec_cases.json under L_inf <= 1e-6.
 */

import { describe, it, expect } from 'vitest';
import fixtures from '../../../../../tests/fixtures/feature_spec_cases.json';
import realLaterality15f from '../../../../../tests/fixtures/real_recording_laterality_15f.json';
import {
  FEATURE_SPEC_VERSION,
  TOTAL_FEATURES,
  SEQUENCE_LENGTH,
  extractFrameFeatures,
  extractWindow,
  mirrorRawFrame,
  mirrorFeatures178,
  validateFrameHandLabels,
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

    it('Rechazo de manos sin etiqueta categoryName o con Unknown (Punto 3)', () => {
      const baseRaw = JSON.parse(JSON.stringify(fixtures.frame_cases.TC_01_canonical_frame.input));

      // Case 1: Hand detected with empty handedness
      const rawNoLabel = JSON.parse(JSON.stringify(baseRaw));
      rawNoLabel.handedness = [];
      rawNoLabel.hands = [Array(21).fill({ x: 0.63, y: 0.5, z: 0.0 })];
      const res1 = validateFrameHandLabels(rawNoLabel);
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain('ERR_HAND_MISSING_LABEL');

      // Case 2: categoryName Unknown
      const rawUnknown = JSON.parse(JSON.stringify(baseRaw));
      rawUnknown.handedness = [[{ categoryName: 'Unknown', score: 0.5 }]];
      rawUnknown.hands = [Array(21).fill({ x: 0.63, y: 0.5, z: 0.0 })];
      const res2 = validateFrameHandLabels(rawUnknown);
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('ERR_HAND_MISSING_LABEL');

      // Case 3: Recorder object format with categoryName 'Unknown'
      const rawDevUnknown = JSON.parse(JSON.stringify(baseRaw));
      rawDevUnknown.hands = [
        { landmarks: Array(21).fill({ x: 0.63, y: 0.5, z: 0.0 }), categoryName: 'Unknown', score: 0.5 },
      ];
      const res3 = validateFrameHandLabels(rawDevUnknown);
      expect(res3.valid).toBe(false);
      expect(res3.error).toContain('ERR_HAND_MISSING_LABEL');

      // Case 4: Valid label accepted
      const rawValid = JSON.parse(JSON.stringify(baseRaw));
      rawValid.hands = [
        { landmarks: Array(21).fill({ x: 0.63, y: 0.5, z: 0.0 }), categoryName: 'Right', score: 0.95 },
      ];
      const res4 = validateFrameHandLabels(rawValid);
      expect(res4.valid).toBe(true);
      expect(res4.error).toBeNull();
    });

    it('TC_06_recorder_object_hands produce el mismo vector que TC_01_canonical_frame', () => {
      const f01 = extractFrameFeatures(fixtures.frame_cases.TC_01_canonical_frame.input);
      const f06 = extractFrameFeatures(fixtures.frame_cases.TC_06_recorder_object_hands.input);
      expect(f01.valid).toBe(true);
      expect(f06.valid).toBe(true);
      assertLinfClose(f06.features, Array.from(f01.features), 1e-6, 'TC_06 vs TC_01');
    });

    it.fails('Espejo con objetos {landmarks, categoryName, score}: invierte x y categoryName (fallo conocido hasta Fase 2)', () => {
      const raw = JSON.parse(JSON.stringify(fixtures.frame_cases.TC_06_recorder_object_hands.input));
      const mirrored = mirrorRawFrame(raw);

      expect(mirrored.hands[0].categoryName).toBe('Left');
      expect(mirrored.hands[1].categoryName).toBe('Right');
      expect(mirrored.hands[0].landmarks[0].x).toBeCloseTo(1.0 - 0.70, 5);
      expect(mirrored.hands[1].landmarks[0].x).toBeCloseTo(1.0 - 0.30, 5);
      expect(mirrorRawFrame(mirrored)).toEqual(raw);
    });

    it.fails('Conmutatividad asimétrica de espejo con objeto de 1 mano (fallo conocido hasta Fase 2)', () => {
      const base = JSON.parse(JSON.stringify(fixtures.frame_cases.TC_06_recorder_object_hands.input));
      const oneHand = { pose: base.pose, hands: [base.hands[0]] };

      const mirrored = mirrorRawFrame(oneHand);
      const { features: featMirroredRaw, valid: vm } = extractFrameFeatures(mirrored);
      const { features: featBase, valid: vb } = extractFrameFeatures(oneHand);
      expect(vm).toBe(true);
      expect(vb).toBe(true);

      const featMirrorFunc = mirrorFeatures178(featBase);
      assertLinfClose(featMirroredRaw, featMirrorFunc, 1e-6, 'Conmutatividad objeto 1 mano');
    });
  });

  describe('Lateralidad real 15 frames (TDD xfail para FEATURE_SPEC v1.4.0)', () => {
    it.fails('v1.4.0: 15 frames reales asignan Left->leftHand[52..114] y Right->rightHand[115..177] igual que Pose', () => {
      for (const fr of realLaterality15f.frames) {
        const raw = {
          pose: JSON.parse(JSON.stringify(fr.pose)),
          hands: JSON.parse(JSON.stringify(fr.hands)),
        };
        const { features, valid, error } = extractFrameFeatures(raw);
        expect(valid, `Frame ${fr.source_frame_idx} error=${error}`).toBe(true);

        const hasLeft = features.slice(52, 115).some((v) => Math.abs(v) > 1e-9);
        const hasRight = features.slice(115, 178).some((v) => Math.abs(v) > 1e-9);

        expect(hasLeft, `Frame ${fr.source_frame_idx} leftHand`).toBe(
          fr.expected_pose_slots.includes('leftHand')
        );
        expect(hasRight, `Frame ${fr.source_frame_idx} rightHand`).toBe(
          fr.expected_pose_slots.includes('rightHand')
        );
      }
    });

    it.fails('v1.4.0: extractWindow mantiene convención directa en los 15 frames reales (incluidos AMBIG 20 y 78)', () => {
      const dtStep = 1000.0 / 15.0;
      const windowFrames = realLaterality15f.frames.map((fr, idx) => ({
        t_ms: idx * dtStep,
        pose: JSON.parse(JSON.stringify(fr.pose)),
        hands: JSON.parse(JSON.stringify(fr.hands)),
      }));

      const { tensor, valid, error } = extractWindow(windowFrames, 15, 1000.0);
      expect(valid, `extractWindow error=${error}`).toBe(true);
      expect(tensor.length).toBe(SEQUENCE_LENGTH * TOTAL_FEATURES);

      for (let k = 0; k < realLaterality15f.frames.length; k++) {
        const fr = realLaterality15f.frames[k];
        const base = k * TOTAL_FEATURES;
        const leftSlice = tensor.slice(base + 52, base + 115);
        const rightSlice = tensor.slice(base + 115, base + 178);
        const hasLeft = leftSlice.some((v) => Math.abs(v) > 1e-9);
        const hasRight = rightSlice.some((v) => Math.abs(v) > 1e-9);

        expect(hasLeft, `Slot ${k} (frame ${fr.source_frame_idx}) leftHand`).toBe(
          fr.expected_pose_slots.includes('leftHand')
        );
        expect(hasRight, `Slot ${k} (frame ${fr.source_frame_idx}) rightHand`).toBe(
          fr.expected_pose_slots.includes('rightHand')
        );
      }
    });
  });
});
