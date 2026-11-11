/**
 * src/engine/__tests__/featureExtractor.test.js
 *
 * Suite de conformidad de featureExtractor.js (JavaScript) con FEATURE_SPEC.md v1.2.1.
 * Demuestra paridad con la suite Python de tests/test_feature_spec.py (tolerancia <= 1e-6).
 */

import { describe, it, expect } from 'vitest';
import {
  FEATURE_SPEC_VERSION,
  TOTAL_FEATURES,
  SEQUENCE_LENGTH,
  extractFrameFeatures,
  extractWindow,
  mirrorRawFrame,
  mirrorFeatures178,
} from '../featureExtractor.js';

function makeCanonicalPose() {
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.50,
    y: 0.50,
    z: 0.00,
    visibility: 0.90,
  }));

  pose[0] = { x: 0.50, y: 0.20, z: -0.04, visibility: 0.99 };
  pose[11] = { x: 0.60, y: 0.40, z: 0.00, visibility: 0.90 };
  pose[12] = { x: 0.40, y: 0.40, z: 0.00, visibility: 0.90 };
  pose[13] = { x: 0.65, y: 0.55, z: 0.02, visibility: 0.88 };
  pose[14] = { x: 0.35, y: 0.55, z: -0.02, visibility: 0.88 };
  pose[15] = { x: 0.70, y: 0.70, z: 0.05, visibility: 0.85 };
  pose[16] = { x: 0.30, y: 0.70, z: -0.05, visibility: 0.85 };
  pose[17] = { x: 0.72, y: 0.73, z: 0.05, visibility: 0.80 };
  pose[18] = { x: 0.28, y: 0.73, z: -0.05, visibility: 0.80 };
  pose[19] = { x: 0.71, y: 0.74, z: 0.05, visibility: 0.80 };
  pose[20] = { x: 0.29, y: 0.74, z: -0.05, visibility: 0.80 };
  pose[21] = { x: 0.68, y: 0.71, z: 0.05, visibility: 0.80 };
  pose[22] = { x: 0.32, y: 0.71, z: -0.05, visibility: 0.80 };

  return pose;
}

function makeHandA() {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.70, y: 0.70, z: 0.05 }));
  hand[0] = { x: 0.70, y: 0.70, z: 0.05 };
  hand[1] = { x: 0.71, y: 0.71, z: 0.07 };
  return hand;
}

function makeHandB() {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.30, y: 0.70, z: -0.05 }));
  hand[0] = { x: 0.30, y: 0.70, z: -0.05 };
  hand[1] = { x: 0.29, y: 0.71, z: -0.03 };
  return hand;
}

function assertCloseArray(actual, expected, atol = 1e-6) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++) {
    const diff = Math.abs(actual[i] - expected[i]);
    if (diff > atol) {
      throw new Error(`Element ${i} mismatch: actual=${actual[i]}, expected=${expected[i]}, diff=${diff} > ${atol}`);
    }
  }
}

describe('featureExtractor.js — Conformidad FEATURE_SPEC v1.2.1', () => {
  it('constantes de versión', () => {
    expect(FEATURE_SPEC_VERSION).toBe('1.2.1');
    expect(TOTAL_FEATURES).toBe(178);
    expect(SEQUENCE_LENGTH).toBe(15);
  });

  it('TC-01: Canonical Frame (Pose completa + Ambas manos)', () => {
    const rawFrame = {
      pose: makeCanonicalPose(),
      hands: [makeHandA(), makeHandB()],
      handedness: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]],
    };

    const { features, valid, error } = extractFrameFeatures(rawFrame);
    expect(valid).toBe(true);
    expect(error).toBeNull();
    expect(features).not.toBeNull();
    expect(features.length).toBe(178);

    // 1. Nariz [0..3]: [0.0, -1.0, -0.2, 0.99]
    assertCloseArray(features.subarray(0, 4), [0.0, -1.0, -0.2, 0.99]);

    // 2. Hombro Izq [4..7]: [0.5, 0.0, 0.0, 0.90]
    assertCloseArray(features.subarray(4, 8), [0.5, 0.0, 0.0, 0.90]);

    // 3. Hombro Der [8..11]: [-0.5, 0.0, 0.0, 0.90]
    assertCloseArray(features.subarray(8, 12), [-0.5, 0.0, 0.0, 0.90]);

    // 4. Mano Izquierda (A) muñeca [52..54]: [1.0, 1.5, 0.0], P1 [55..57]: [1.05, 1.55, 0.10]
    assertCloseArray(features.subarray(52, 55), [1.0, 1.5, 0.0]);
    assertCloseArray(features.subarray(55, 58), [1.05, 1.55, 0.10]);

    // 5. Mano Derecha (B) muñeca [115..117]: [-1.0, 1.5, 0.0], P1 [118..120]: [-1.05, 1.55, 0.10]
    assertCloseArray(features.subarray(115, 118), [-1.0, 1.5, 0.0]);
    assertCloseArray(features.subarray(118, 121), [-1.05, 1.55, 0.10]);
  });

  it('TC-02: Mano izquierda ausente -> [52..114] estrictamente 63 ceros', () => {
    const rawFrame = {
      pose: makeCanonicalPose(),
      hands: [makeHandB()],
      handedness: [[{ categoryName: 'Left' }]],
    };

    const { features, valid, error } = extractFrameFeatures(rawFrame);
    expect(valid).toBe(true);
    expect(error).toBeNull();

    // 63 ceros exactos en left hand
    const leftSlice = features.subarray(52, 115);
    expect(leftSlice.every((v) => v === 0.0)).toBe(true);

    // Mano derecha presente
    assertCloseArray(features.subarray(115, 118), [-1.0, 1.5, 0.0]);
  });

  it('TC-03: Pose incompleta (< 23 landmarks)', () => {
    const rawFrame = {
      pose: makeCanonicalPose().slice(0, 20),
      hands: [makeHandA()],
    };

    const { features, valid, error } = extractFrameFeatures(rawFrame);
    expect(valid).toBe(false);
    expect(features).toBeNull();
    expect(error).toBe('ERR_POSE_MISSING');
  });

  it('TC-04: Hombros demasiado pequeños (D < 0.08)', () => {
    const pose = makeCanonicalPose();
    pose[11].x = 0.525;
    pose[12].x = 0.475;
    pose[11].y = 0.40;
    pose[12].y = 0.40;
    pose[11].z = 0.00;
    pose[12].z = 0.00;

    const rawFrame = {
      pose,
      hands: [makeHandA()],
    };

    const { features, valid, error } = extractFrameFeatures(rawFrame);
    expect(valid).toBe(false);
    expect(features).toBeNull();
    expect(error).toBe('ERR_SHOULDERS_TOO_SMALL');
  });

  it('TC-05A: Asignación conjunta de 2 manos independiente del orden de entrada', () => {
    const frameAB = {
      pose: makeCanonicalPose(),
      hands: [makeHandA(), makeHandB()],
    };
    const { features: featAB } = extractFrameFeatures(frameAB);

    const frameBA = {
      pose: makeCanonicalPose(),
      hands: [makeHandB(), makeHandA()],
    };
    const { features: featBA } = extractFrameFeatures(frameBA);

    assertCloseArray(featAB, featBA, 1e-6);
  });

  it('TC-05B: 1 mano centrada desempata con categoryName', () => {
    const pose = makeCanonicalPose();
    const centeredHand = Array.from({ length: 21 }, () => ({ x: 0.50, y: 0.70, z: 0.00 }));

    // Left -> Mano Derecha [115..177]
    const frameLeft = {
      pose,
      hands: [centeredHand],
      handedness: [[{ categoryName: 'Left' }]],
    };
    const { features: featL } = extractFrameFeatures(frameLeft);
    expect(featL.subarray(52, 115).every((v) => v === 0.0)).toBe(true);
    expect(featL.subarray(115, 178).some((v) => v !== 0.0)).toBe(true);

    // Right -> Mano Izquierda [52..114]
    const frameRight = {
      pose,
      hands: [centeredHand],
      handedness: [[{ categoryName: 'Right' }]],
    };
    const { features: featR } = extractFrameFeatures(frameRight);
    expect(featR.subarray(52, 115).some((v) => v !== 0.0)).toBe(true);
    expect(featR.subarray(115, 178).every((v) => v === 0.0)).toBe(true);
  });

  it('TC-05C: Mano desconectada (> 1.75 * D) se descarta', () => {
    const pose = makeCanonicalPose();
    const floatingHand = Array.from({ length: 21 }, () => ({ x: 0.05, y: 0.05, z: 0.00 }));

    const rawFrame = {
      pose,
      hands: [floatingHand],
    };

    const { features, valid } = extractFrameFeatures(rawFrame);
    expect(valid).toBe(true);
    expect(features.subarray(52, 178).every((v) => v === 0.0)).toBe(true);
  });

  it('Propiedad: Invarianza a traslación 3D', () => {
    const rawFrame = {
      pose: makeCanonicalPose(),
      hands: [makeHandA(), makeHandB()],
    };
    const { features: baseFeatures } = extractFrameFeatures(rawFrame);

    const deltas = [
      [0.05, 0.03, 0.04],
      [-0.06, -0.04, -0.05],
      [0.07, -0.05, 0.02],
    ];

    for (const [dx, dy, dz] of deltas) {
      const transFrame = JSON.parse(JSON.stringify(rawFrame));
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
      assertCloseArray(transFeats, baseFeatures, 1e-6);
    }
  });

  it('Propiedad: Conmutatividad de espejo', () => {
    const rawFrame = {
      pose: makeCanonicalPose(),
      hands: [makeHandA(), makeHandB()],
      handedness: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]],
    };

    const mirroredRaw = mirrorRawFrame(rawFrame);
    const { features: featMirroredRaw } = extractFrameFeatures(mirroredRaw);

    const { features: baseFeatures } = extractFrameFeatures(rawFrame);
    const featMirrorFunc = mirrorFeatures178(baseFeatures);

    assertCloseArray(featMirroredRaw, featMirrorFunc, 1e-6);
  });

  it('ExtractWindow: Tensor (15, 178) y validación de brechas', () => {
    const basePose = makeCanonicalPose();
    const handA = makeHandA();
    const handB = makeHandB();

    const frames = [];
    for (let i = 0; i < 35; i++) {
      frames.push({
        pose: JSON.parse(JSON.stringify(basePose)),
        hands: [JSON.parse(JSON.stringify(handA)), JSON.parse(JSON.stringify(handB))],
        handedness: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]],
        timestamp_ms: i * 33.333,
      });
    }

    const { tensor, valid, error } = extractWindow(frames, { durationMs: 1000.0 });
    expect(valid).toBe(true);
    expect(error).toBeNull();
    expect(tensor.length).toBe(15 * 178);

    // Brecha excesiva rechazada
    const badFrames = [
      { pose: basePose, hands: [handA], timestamp_ms: 0.0 },
      { pose: basePose, hands: [handA], timestamp_ms: 250.0 },
      { pose: basePose, hands: [handA], timestamp_ms: 300.0 },
    ];
    const { valid: badValid, error: badErr } = extractWindow(badFrames, { durationMs: 300.0 });
    expect(badValid).toBe(false);
    expect(badErr).toBe('ERR_INVALID_FRAME_GAP_TOO_LARGE');
  });
});
