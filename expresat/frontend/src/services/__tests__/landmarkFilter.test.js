import { describe, it, expect } from 'vitest';
import { LandmarkEMAFilter } from '../landmarkFilter.js';

const mkHand = (x, y = 0.5, z = 0.0) =>
  Array.from({ length: 21 }, () => ({ x, y, z }));

describe('services/LandmarkEMAFilter — EMA por slot anatómico (v1.4.0)', () => {
  it('mantiene estados independientes por slot leftHand/rightHand incluso cuando MediaPipe permuta el orden del arreglo', () => {
    const filter = new LandmarkEMAFilter(0.5);

    // Frame 1: Left at 0.80, Right at 0.20
    const res1 = filter.smoothResults({
      pose: null,
      hands: [mkHand(0.8), mkHand(0.2)],
      handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]],
    });
    expect(res1.hands[0][0].x).toBeCloseTo(0.8, 6);
    expect(res1.hands[1][0].x).toBeCloseTo(0.2, 6);

    // Frame 2: Array order SWAPS -> index 0 is now Right (0.22), index 1 is Left (0.78)
    // Index-based hand_0/hand_1 would corrupt x to (0.22+0.80)/2 = 0.51 and (0.78+0.20)/2 = 0.49!
    // Anatomical slot EMA MUST smooth Right with Right (0.21) and Left with Left (0.79).
    const res2 = filter.smoothResults({
      pose: null,
      hands: [mkHand(0.22), mkHand(0.78)],
      handedness: [[{ categoryName: 'Right' }], [{ categoryName: 'Left' }]],
    });
    expect(res2.hands[0][0].x).toBeCloseTo(0.21, 6);
    expect(res2.hands[1][0].x).toBeCloseTo(0.79, 6);
  });

  it('limpia explícitamente el slot ausente para evitar arrastre fantasma al reaparecer una mano', () => {
    const filter = new LandmarkEMAFilter(0.5);

    // Frame 1: both hands present
    filter.smoothResults({
      pose: null,
      hands: [mkHand(0.8), mkHand(0.2)],
      handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]],
    });

    // Frame 2: Left disappears; only Right present at index 0
    const res2 = filter.smoothResults({
      pose: null,
      hands: [mkHand(0.24)],
      handedness: [[{ categoryName: 'Right' }]],
    });
    expect(res2.hands[0][0].x).toBeCloseTo(0.22, 6);

    // Frame 3: Left reappears at 0.40 -> MUST start fresh at 0.40 (NOT averaged with stale 0.80 -> 0.60!)
    const res3 = filter.smoothResults({
      pose: null,
      hands: [mkHand(0.4), mkHand(0.26)],
      handedness: [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]],
    });
    expect(res3.hands[0][0].x).toBeCloseTo(0.4, 6);
    expect(res3.hands[1][0].x).toBeCloseTo(0.24, 6);
  });
});
