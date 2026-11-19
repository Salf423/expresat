/**
 * Mathematical conformance suite for featureExtractor.js against FEATURE_SPEC.md.
 * Compares element-by-element against tests/fixtures/feature_spec_cases.json under L_inf <= 1e-6.
 */

import { describe, it, expect } from 'vitest';
import fixtures from '../../../../../tests/fixtures/feature_spec_cases.json';
import realLaterality15f from '../../../../../tests/fixtures/real_recording_laterality_15f.json';
import * as feMod from '../featureExtractor.js';
import {
  FEATURE_SPEC_VERSION,
  TOTAL_FEATURES,
  SEQUENCE_LENGTH,
  assignHandsToAnatomicalSlots,
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

describe('featureExtractor.js — Conformidad FEATURE_SPEC v1.4.0', () => {
  it('constantes de versión coinciden con el fixture compartido', () => {
    expect(FEATURE_SPEC_VERSION).toBe(fixtures.feature_spec_version);
    expect(FEATURE_SPEC_VERSION).toBe('1.4.0');
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

    it('Espejo con objetos {landmarks, categoryName, score}: invierte x, categoryName e involución exacta', () => {
      const raw = JSON.parse(JSON.stringify(fixtures.frame_cases.TC_06_recorder_object_hands.input));
      const expCat0 = raw.hands[0].categoryName === 'Right' ? 'Left' : 'Right';
      const expCat1 = raw.hands[1].categoryName === 'Right' ? 'Left' : 'Right';
      const mirrored = mirrorRawFrame(raw);

      expect(mirrored.hands[0].categoryName).toBe(expCat0);
      expect(mirrored.hands[1].categoryName).toBe(expCat1);
      expect(mirrored.hands[0].landmarks[0].x).toBeCloseTo(1.0 - 0.70, 5);
      expect(mirrored.hands[1].landmarks[0].x).toBeCloseTo(1.0 - 0.30, 5);
      const doubleMirrored = mirrorRawFrame(mirrored);
      expect(doubleMirrored.hands[0].categoryName).toBe(raw.hands[0].categoryName);
      expect(doubleMirrored.hands[1].categoryName).toBe(raw.hands[1].categoryName);
      expect(doubleMirrored.hands[0].score).toBe(raw.hands[0].score);
      expect(doubleMirrored.hands[1].score).toBe(raw.hands[1].score);
      for (let i = 0; i < raw.pose.length; i++) {
        expect(doubleMirrored.pose[i].x).toBeCloseTo(raw.pose[i].x, 12);
        expect(doubleMirrored.pose[i].y).toBeCloseTo(raw.pose[i].y, 12);
        expect(doubleMirrored.pose[i].z).toBeCloseTo(raw.pose[i].z, 12);
        expect(doubleMirrored.pose[i].visibility).toBeCloseTo(raw.pose[i].visibility, 12);
      }
      for (let hi = 0; hi < raw.hands.length; hi++) {
        for (let i = 0; i < raw.hands[hi].landmarks.length; i++) {
          expect(doubleMirrored.hands[hi].landmarks[i].x).toBeCloseTo(raw.hands[hi].landmarks[i].x, 12);
          expect(doubleMirrored.hands[hi].landmarks[i].y).toBeCloseTo(raw.hands[hi].landmarks[i].y, 12);
          expect(doubleMirrored.hands[hi].landmarks[i].z).toBeCloseTo(raw.hands[hi].landmarks[i].z, 12);
        }
      }
    });

    it('Conmutatividad asimétrica de espejo con objeto de 1 mano', () => {
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

  describe('Lateralidad real 15 frames (FEATURE_SPEC v1.4.0)', () => {
    it('v1.4.0: 15 frames reales asignan Left->leftHand[52..114] y Right->rightHand[115..177] igual que Pose', () => {
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

    it('v1.4.0: extractWindow mantiene convención directa en los 15 frames reales (incluidos AMBIG 20 y 78)', () => {
      const dtStep = 1000.0 / 15.0;
      const windowFrames = realLaterality15f.frames.map((fr, idx) => ({
        t_ms: idx * dtStep,
        pose: JSON.parse(JSON.stringify(fr.pose)),
        hands: JSON.parse(JSON.stringify(fr.hands)),
      }));

      const { tensor, valid, error } = extractWindow(windowFrames, {
        targetFps: 15,
        durationMs: 1000.0,
      });
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

  describe('FEATURE_SPEC v1.4.0 — Mini-fixtures analíticos a mano y compuertas estrictas', () => {
    const makeBasePose = () => {
      const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0.0, visibility: 0.95 }));
      pose[0] = { x: 0.5, y: 0.2, z: -0.05, visibility: 0.99 };
      pose[11] = { x: 0.65, y: 0.4, z: 0.0, visibility: 0.95 };
      pose[12] = { x: 0.35, y: 0.4, z: 0.0, visibility: 0.95 };
      pose[13] = { x: 0.7, y: 0.55, z: -0.05, visibility: 0.9 };
      pose[14] = { x: 0.3, y: 0.55, z: -0.05, visibility: 0.9 };
      pose[15] = { x: 0.7, y: 0.7, z: -0.8, visibility: 0.95 };
      pose[16] = { x: 0.3, y: 0.7, z: -0.8, visibility: 0.95 };
      for (let i = 17; i < 23; i++) {
        pose[i] = { x: i % 2 === 1 ? 0.7 : 0.3, y: 0.72, z: -1.4, visibility: 0.9 };
      }
      return pose;
    };

    const makeWindowFromTs = (tsList) => {
      const pose = makeBasePose();
      const handL = Array.from({ length: 21 }, () => ({ x: 0.7, y: 0.7, z: -0.02 }));
      return tsList.map((t) => ({
        t_ms: t,
        pose: pose.map((pt) => ({ ...pt })),
        hands: [{ landmarks: handL.map((pt) => ({ ...pt })), categoryName: 'Left', score: 0.96 }],
      }));
    };

    it('Mini-fixture exacto a mano: D_2D_iso=0.375 (4:3), P0 z clip -2.0 y P15..P22 z=0.0', () => {
      const pose = Array.from({ length: 33 }, () => ({ x: 0.55, y: 0.4, z: 0.0, visibility: 0.9 }));
      pose[0] = { x: 0.55, y: 0.25, z: -1.2, visibility: 1.25 };
      pose[11] = { x: 0.7, y: 0.55, z: 0.4, visibility: 0.95 };
      pose[12] = { x: 0.4, y: 0.25, z: -0.4, visibility: 0.95 };
      pose[13] = { x: 0.7, y: 0.65, z: 1.125, visibility: 0.9 };
      pose[14] = { x: 0.4, y: 0.65, z: -0.375, visibility: 0.9 };
      pose[15] = { x: 0.7, y: 0.7, z: -1.5, visibility: 0.9 };
      pose[16] = { x: 0.4, y: 0.7, z: -1.5, visibility: 0.9 };
      for (let i = 17; i < 23; i++) {
        pose[i] = { x: 0.7, y: 0.7, z: -1.8, visibility: 0.9 };
      }
      const handL = Array.from({ length: 21 }, () => ({ x: 0.7, y: 0.7, z: -0.05 }));
      handL[8] = { x: 0.7, y: 0.55, z: -0.2 };

      const { features, valid, error } = extractFrameFeatures({
        pose,
        hands: [{ landmarks: handL, categoryName: 'Left', score: 0.98 }],
      });
      expect(valid, `error=${error}`).toBe(true);
      expect(features[0]).toBeCloseTo(0.0, 5);
      expect(features[1]).toBeCloseTo(-0.4, 5);
      expect(features[2]).toBeCloseTo(-2.0, 5);
      expect(features[3]).toBeCloseTo(1.0, 5);
      expect(features[4]).toBeCloseTo(0.4, 5);
      expect(features[5]).toBeCloseTo(0.4, 5);
      expect(features[6]).toBeCloseTo(0.4 / 0.375, 5);
      expect(features[14]).toBeCloseTo(2.0, 5);
      for (let u = 5; u < 13; u++) {
        expect(features[u * 4 + 2]).toBe(0.0);
      }
      expect(features[52]).toBeCloseTo(0.4, 5);
      expect(features[53]).toBeCloseTo(0.8, 5);
      expect(features[54]).toBeCloseTo(0.0, 5);
      expect(features[52 + 8 * 3]).toBeCloseTo(0.4, 5);
      expect(features[52 + 8 * 3 + 1]).toBeCloseTo(0.4, 5);
      expect(features[52 + 8 * 3 + 2]).toBeCloseTo(-0.4, 5);
      expect(features.slice(115, 178).every((v) => v === 0.0)).toBe(true);
    });

    it('Mini-fixture exacto a mano: remuestreo LERP 3 frames (resampleSequenceBlocks)', () => {
      expect(typeof feMod.resampleSequenceBlocks).toBe('function');
      const mkPose = (x, y, z, v) => Array.from({ length: 33 }, () => ({ x, y, z, visibility: v }));
      const mkHand = (x, y, z) => Array.from({ length: 21 }, () => ({ x, y, z }));
      const blocks = [
        { timestamp_ms: 0.0, pose: mkPose(0.2, 0.1, 0.0, 0.8), leftHand: mkHand(0.6, 0.5, 0.0), rightHand: null },
        { timestamp_ms: 50.0, pose: mkPose(0.4, 0.3, -0.2, 0.9), leftHand: mkHand(0.8, 0.7, -0.1), rightHand: null },
        { timestamp_ms: 100.0, pose: mkPose(1.0, 0.5, 0.2, 1.0), leftHand: null, rightHand: null },
      ];
      const out = feMod.resampleSequenceBlocks(blocks, [0, 25, 50, 60, 75, 100]);
      const expX = [0.2, 0.3, 0.4, 0.52, 0.7, 1.0];
      const expV = [0.8, 0.85, 0.9, 0.92, 0.95, 1.0];
      const expLhX = [0.6, 0.7, 0.8, 0.8, null, null];
      for (let i = 0; i < 6; i++) {
        expect(out[i].pose[0].x).toBeCloseTo(expX[i], 6);
        expect(out[i].pose[0].visibility).toBeCloseTo(expV[i], 6);
        if (expLhX[i] === null) {
          expect(out[i].leftHand).toBeNull();
        } else {
          expect(out[i].leftHand[0].x).toBeCloseTo(expLhX[i], 6);
        }
      }
    });

    it('Mini-fixture exacto a mano: EMA 4 valores con reinicio tras ausencia (applyBlockEma)', () => {
      expect(typeof feMod.applyBlockEma).toBe('function');
      const poseXs = [1.0, 3.0, 5.0, 9.0];
      const poseVs = [0.9, 0.8, 0.7, 0.6];
      const lhXs = [0.2, 0.6, null, 0.9];
      const blocks = poseXs.map((px, k) => ({
        timestamp_ms: k * 66.67,
        pose: Array.from({ length: 33 }, () => ({ x: px, y: 0, z: 0, visibility: poseVs[k] })),
        leftHand: lhXs[k] === null ? null : Array.from({ length: 21 }, () => ({ x: lhXs[k], y: 0, z: 0 })),
        rightHand: null,
      }));
      const out = feMod.applyBlockEma(blocks, 0.5);
      const expPoseX = [1.0, 2.0, 3.5, 6.25];
      const expLhX = [0.2, 0.4, null, 0.9];
      for (let k = 0; k < 4; k++) {
        expect(out[k].pose[0].x).toBeCloseTo(expPoseX[k], 6);
        expect(out[k].pose[0].visibility).toBeCloseTo(poseVs[k], 6);
        if (expLhX[k] === null) expect(out[k].leftHand).toBeNull();
        else expect(out[k].leftHand[0].x).toBeCloseTo(expLhX[k], 6);
      }
    });

    it('Compuerta estricta <=100ms (sin restar dt_nominal) y casos PASA/BORDE/FALLA/HIGH_INTERP/TAIL', () => {
      const ts1001 = [0, 100.1, ...Array.from({ length: 17 }, (_, i) => 100.1 + 60 * (i + 1))];
      expect(extractWindow(makeWindowFromTs(ts1001), { durationMs: 1000 }).error).toBe(
        'ERR_INVALID_FRAME_GAP_TOO_LARGE'
      );

      const ts2500 = [0, 150.0, ...Array.from({ length: 44 }, (_, i) => 150.0 + 60 * (i + 1))];
      expect(extractWindow(makeWindowFromTs(ts2500), { durationMs: 2500 }).error).toBe(
        'ERR_INVALID_FRAME_GAP_TOO_LARGE'
      );

      const tsPasa = [0];
      for (let i = 0; i < 20; i++) tsPasa.push(tsPasa[tsPasa.length - 1] + (i % 2 === 0 ? 60 : 65));
      expect(extractWindow(makeWindowFromTs(tsPasa), { durationMs: 1000 }).valid).toBe(true);

      const tsBorde = [0, 90, 180, 262, 344, 426, 508, 590, 672, 754, 836, 918, 1000];
      expect(extractWindow(makeWindowFromTs(tsBorde), { durationMs: 1000 }).valid).toBe(true);

      const tsFalla = [0, 89, 178, 267, 356, 445, 534, 623, 712, 801, 890, 979];
      expect(extractWindow(makeWindowFromTs(tsFalla), { durationMs: 1000 }).error).toBe(
        'ERR_WINDOW_LOW_UNIQUE_FRAMES'
      );

      const tsBridge = [0, 85, 170, 255, 340, ...Array.from({ length: 13 }, (_, i) => 340 + 50 * (i + 1))];
      expect(extractWindow(makeWindowFromTs(tsBridge), { durationMs: 1000 }).error).toBe(
        'ERR_WINDOW_HIGH_INTERPOLATION'
      );

      const tsShort = Array.from({ length: 15 }, (_, i) => i * (1000 / 30));
      expect(extractWindow(makeWindowFromTs(tsShort), { durationMs: 1000 }).error).toBe(
        'ERR_WINDOW_TAIL_EXTRAPOLATION'
      );
    });

    it('1 mano unificada resiste etiqueta errónea, TTL >200ms expira muñeca, swap leftHand/rightHand y rechazo NaN', () => {
      const pose = makeBasePose();
      const handAtP15 = Array.from({ length: 21 }, () => ({ x: 0.7, y: 0.7, z: 0.0 }));
      const handAtP16 = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.7, z: 0.0 }));
      for (const lbl of ['Left', 'Right']) {
        const resL = assignHandsToAnatomicalSlots(
          { pose, hands: [{ landmarks: handAtP15, categoryName: lbl, score: 0.8 }] },
          pose,
          0.3
        );
        expect(resL.assignedLeftHand).not.toBeNull();
        expect(resL.assignedRightHand).toBeNull();

        const resR = assignHandsToAnatomicalSlots(
          { pose, hands: [{ landmarks: handAtP16, categoryName: lbl, score: 0.8 }] },
          pose,
          0.3
        );
        expect(resR.assignedLeftHand).toBeNull();
        expect(resR.assignedRightHand).not.toBeNull();
      }

      // TTL expiry >200ms: frame 0 unlabeled near P15 sets prevLeftWrist, then 5 empty frames, then P16
      const dt = 1000 / 15;
      const frames = [
        {
          t_ms: 0,
          pose: pose.map((p) => ({ ...p })),
          hands: [Array.from({ length: 21 }, () => ({ x: 0.55, y: 0.7, z: 0 }))],
          handedness: [],
        },
        ...Array.from({ length: 5 }, (_, i) => ({
          t_ms: (i + 1) * dt,
          pose: pose.map((p) => ({ ...p })),
          hands: [],
        })),
        ...Array.from({ length: 9 }, (_, i) => ({
          t_ms: (i + 6) * dt,
          pose: pose.map((p) => ({ ...p })),
          hands: [Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.7, z: 0 }))],
          handedness: [],
        })),
      ];
      const winRes = extractWindow(frames, { durationMs: 1000 });
      expect(winRes.valid, `error=${winRes.error}`).toBe(true);
      const base6 = 6 * TOTAL_FEATURES;
      expect(winRes.tensor.slice(base6 + 52, base6 + 115).every((v) => v === 0)).toBe(true);
      expect(winRes.tensor.slice(base6 + 115, base6 + 178).some((v) => Math.abs(v) > 0.1)).toBe(true);

      // mirrorRawFrame swaps leftHand <-> rightHand keys
      const mir = mirrorRawFrame({ pose, leftHand: handAtP15, rightHand: null });
      expect(mir.leftHand).toBeNull();
      expect(mir.rightHand[0].x).toBeCloseTo(0.3, 6);

      // NaN rejected cleanly
      const badPose = makeBasePose();
      badPose[11].x = Number.NaN;
      const nanRes = extractFrameFeatures({ pose: badPose, hands: [] });
      expect(nanRes.valid).toBe(false);
      expect(nanRes.features).toBeNull();
    });
  });
});
