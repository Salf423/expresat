import { describe, it, expect, vi } from 'vitest';
import { SignEngine, ENGINE_ERROR_CODES } from '../index.js';

describe('engine/SignEngine — Ciclo de vida, cleanup idempotente y FPS reales', () => {
  it('es idempotente ante múltiples llamadas a stop() y doble montaje StrictMode', async () => {
    const engine = new SignEngine({ targetFps: 20 });
    const errors = [];
    engine.onError((err) => errors.push(err));

    // Calling stop() before start() must not throw
    expect(() => engine.stop()).not.toThrow();
    expect(() => engine.stop()).not.toThrow();

    // start(null) emits a typed error without throwing
    const started = await engine.start(null);
    expect(started).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe(ENGINE_ERROR_CODES.ENGINE_RUNTIME_ERROR);
  });

  it('detiene inmediatamente los tracks de cámara si stop() se invoca mientras getUserMedia está en vuelo (StrictMode)', async () => {
    const stopTrackSpy = vi.fn();
    let resolveMedia;
    const fakeMediaPromise = new Promise((resolve) => {
      resolveMedia = resolve;
    });

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: () => fakeMediaPromise,
        },
      },
    });

    try {
      const engine = new SignEngine();
      const fakeVideo = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        srcObject: null,
      };

      const startPromise = engine.start(fakeVideo);
      // Simulate React StrictMode cleanup before getUserMedia resolves
      engine.stop();

      resolveMedia({
        getTracks: () => [{ stop: stopTrackSpy }],
      });

      const result = await startPromise;
      expect(result).toBe(false);
      expect(stopTrackSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('emite CAMERA_DENIED con mensaje claro cuando el usuario rechaza el permiso de cámara', async () => {
    const originalNavigator = globalThis.navigator;
    const deniedErr = new Error('Permission denied');
    deniedErr.name = 'NotAllowedError';

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: () => Promise.reject(deniedErr),
        },
      },
    });

    try {
      const engine = new SignEngine();
      const errors = [];
      engine.onError((e) => errors.push(e));

      const fakeVideo = { play: vi.fn(), pause: vi.fn() };
      const ok = await engine.start(fakeVideo);
      expect(ok).toBe(false);
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe(ENGINE_ERROR_CODES.CAMERA_DENIED);
      expect(errors[0].message).toContain('Permiso de cámara denegado');
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('detiene los tracks del MediaStream si video.play() lanza AbortError o cualquier excepción', async () => {
    const originalNavigator = globalThis.navigator;
    const stopTrackSpy = vi.fn();

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: () =>
            Promise.resolve({
              getTracks: () => [{ stop: stopTrackSpy }],
            }),
        },
      },
    });

    try {
      const engine = new SignEngine();
      const abortErr = new Error('The play() request was interrupted');
      abortErr.name = 'AbortError';

      const fakeVideo = {
        play: vi.fn().mockRejectedValue(abortErr),
        pause: vi.fn(),
        srcObject: null,
      };

      const ok = await engine.start(fakeVideo);
      expect(ok).toBe(false);
      expect(stopTrackSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('soporta smoothLandmarks: false y expone framePayload.raw intacto', () => {
    const engine = new SignEngine({ smoothLandmarks: false });
    let emitted = null;
    engine.onFrame((payload) => {
      emitted = payload;
    });

    const rawPose = [{ x: 0.5, y: 0.5, z: 0.1, visibility: 0.95 }];
    const rawHands = [[{ x: 0.6, y: 0.7, z: 0.05 }]];
    const rawHandedness = [[{ categoryName: 'Right', score: 0.98 }]];

    engine._dispatchNormalizedResults({
      pose: rawPose,
      hands: rawHands,
      handedness: rawHandedness,
      timestamp: 1000,
      latencyMs: 5.2,
    });

    expect(emitted).not.toBeNull();
    // smoothLandmarks: false passes raw coordinates unchanged
    expect(emitted.hands[0][0].x).toBe(0.6);
    expect(emitted.hands[0][0].y).toBe(0.7);

    // framePayload.raw preserves original unsmoothed detections
    expect(emitted.raw).toBeDefined();
    expect(emitted.raw.hands[0][0].x).toBe(0.6);
    expect(emitted.raw.pose[0].x).toBe(0.5);
    expect(emitted.raw.pose[0].visibility).toBe(0.95);
  });
});
