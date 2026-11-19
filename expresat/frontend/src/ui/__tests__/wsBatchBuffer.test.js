import { describe, it, expect } from 'vitest';
import * as useSignEngineMod from '../useSignEngine.js';
import { extractWindow } from '../../engine/featureExtractor.js';

const makePose = () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0.0, visibility: 0.95 }));
  pose[11] = { x: 0.65, y: 0.4, z: 0.0, visibility: 0.95 };
  pose[12] = { x: 0.35, y: 0.4, z: 0.0, visibility: 0.95 };
  pose[15] = { x: 0.7, y: 0.7, z: 0.0, visibility: 0.95 };
  pose[16] = { x: 0.3, y: 0.7, z: 0.0, visibility: 0.95 };
  return pose;
};

describe('ui/useSignEngine — Lote WebSocket crudo + t_ms monotónico y enablePose (v1.4.0)', () => {
  it('resolveEnablePose activa Pose siempre que enableRemoteTransport esté activo', () => {
    expect(typeof useSignEngineMod.resolveEnablePose).toBe('function');
    expect(
      useSignEngineMod.resolveEnablePose({
        enablePose: false,
        enableRemoteTransport: true,
        configEnablePose: false,
      })
    ).toBe(true);
    expect(
      useSignEngineMod.resolveEnablePose({
        enablePose: false,
        enableRemoteTransport: false,
        configEnablePose: false,
      })
    ).toBe(false);
  });

  it('buildWsInferenceFrame extrae frameData.raw (sin doble EMA) con t_ms real y ventana válida para extractWindow v1.4.0', () => {
    expect(typeof useSignEngineMod.buildWsInferenceFrame).toBe('function');
    expect(typeof useSignEngineMod.updateWsRollingBuffer).toBe('function');

    const rawPose = makePose();
    const smoothedPose = makePose();
    smoothedPose[0].x = 0.999; // marker to prove raw is used, NOT smoothed!
    const rawHand = Array.from({ length: 21 }, () => ({ x: 0.7, y: 0.7, z: 0.0 }));

    const buffer = [];
    for (let i = 0; i < 20; i++) {
      const frameData = {
        timestamp: 1000 + i * 55, // ~18 FPS, span = 1045ms >= 933.33ms
        pose: smoothedPose,
        hands: [],
        handedness: [],
        raw: {
          pose: rawPose,
          hands: [rawHand],
          handedness: [[{ categoryName: 'Left', score: 0.96 }]],
          leftHand: rawHand,
          rightHand: null,
        },
      };
      useSignEngineMod.updateWsRollingBuffer(buffer, frameData);
    }

    expect(buffer.length).toBeGreaterThanOrEqual(15);
    expect(buffer[0].t_ms).toBe(1000);
    expect(buffer[buffer.length - 1].t_ms).toBe(1000 + 19 * 55);
    expect(buffer[0].pose[0].x).toBeCloseTo(0.5, 6); // raw, NOT smoothedPose's 0.999
    expect(buffer[0].hands.length).toBe(1);

    const { tensor, valid, error } = extractWindow(buffer, { targetFps: 15, durationMs: 1000 });
    expect(valid, `extractWindow error=${error}`).toBe(true);
    expect(tensor.length).toBe(15 * 178);
  });
});
