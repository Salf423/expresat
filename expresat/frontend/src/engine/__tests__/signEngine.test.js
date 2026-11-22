import { describe, it, expect, vi } from 'vitest';
import { SignEngine, ENGINE_ERROR_CODES } from '../index.js';
import * as signEngineMod from '../signEngine.js';

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

    // framePayload.raw preserves original unsmoothed detections via lazy getter
    const rawDesc = Object.getOwnPropertyDescriptor(emitted, 'raw');
    expect(typeof rawDesc?.get).toBe('function');
    expect(emitted.raw).toBeDefined();
    expect(emitted.raw.hands[0][0].x).toBe(0.6);
    expect(emitted.raw.pose[0].x).toBe(0.5);
    expect(emitted.raw.pose[0].visibility).toBe(0.95);
    // Direct v1.4.0 laterality: 'Right' -> rightHand
    expect(emitted.rightHand).not.toBeNull();
    expect(emitted.leftHand).toBeNull();
  });

  it('deduplica frames repetidos por video.currentTime y envía { rotationDegrees: 0 } directo como 3er argumento', async () => {
    const engine = new SignEngine({ targetFps: 30, enablePose: true, smoothLandmarks: false });
    const handDetect = vi.fn().mockReturnValue({ landmarks: [], handedness: [] });
    const poseDetect = vi.fn().mockReturnValue({ landmarks: [] });

    engine._running = true;
    engine._runId = 1;
    engine._handLandmarker = { detectForVideo: handDetect };
    engine._poseLandmarker = { detectForVideo: poseDetect };

    const fakeVideo = {
      readyState: 4,
      videoWidth: 640,
      videoHeight: 480,
      currentTime: 0.1,
    };
    engine._videoElement = fakeVideo;

    // Stub _scheduleNextTick to avoid real rAF recursion in Node/Vitest
    engine._scheduleNextTick = () => {};

    // First tick at t=100ms (currentTime=0.10) -> runs inference
    await engine._tick(100, 1);
    expect(handDetect).toHaveBeenCalledTimes(1);
    expect(poseDetect).toHaveBeenCalledTimes(1);
    expect(handDetect.mock.calls[0][2]).toEqual({ rotationDegrees: 0 });
    expect(poseDetect.mock.calls[0][2]).toEqual({ rotationDegrees: 0 });

    // Second tick at t=200ms with SAME currentTime=0.10 -> MUST NOT re-infer duplicate frame
    await engine._tick(200, 1);
    expect(handDetect).toHaveBeenCalledTimes(1);
    expect(poseDetect).toHaveBeenCalledTimes(1);

    // Third tick at t=250ms with NEW currentTime=0.15 -> runs inference once more
    fakeVideo.currentTime = 0.15;
    await engine._tick(250, 1);
    expect(handDetect).toHaveBeenCalledTimes(2);
    expect(poseDetect).toHaveBeenCalledTimes(2);
  });

  it('valida relación de aspecto 4:3 ± 0.05 y emite ERR_INVALID_ASPECT_RATIO en 16:9', () => {
    expect(ENGINE_ERROR_CODES.INVALID_ASPECT_RATIO).toBe('ERR_INVALID_ASPECT_RATIO');
    expect(typeof signEngineMod.validateVideoAspectRatio).toBe('function');

    expect(signEngineMod.validateVideoAspectRatio(640, 480).valid).toBe(true);
    expect(signEngineMod.validateVideoAspectRatio(800, 600).valid).toBe(true);
    expect(signEngineMod.validateVideoAspectRatio(1280, 720).valid).toBe(false);

    const engine = new SignEngine();
    const errors = [];
    engine.onError((e) => errors.push(e));

    expect(engine._checkVideoAspectRatio(1280, 720)).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('ERR_INVALID_ASPECT_RATIO');
    // Only emitted once per run
    expect(engine._checkVideoAspectRatio(1280, 720)).toBe(false);
    expect(errors.length).toBe(1);
  });

  it('mantiene poseCadence=1 por defecto y umbrales de confianza HandLandmarker alineados a 0.50', () => {
    const engine = new SignEngine({ enablePose: true });
    expect(engine.poseCadence).toBe(1);
    expect(engine.enablePose).toBe(true);
    expect(typeof signEngineMod.resolveHandConfidenceThresholds).toBe('function');

    // v1.4.0 estricto (por defecto, con Pose, WS o DevRecorder)
    expect(signEngineMod.resolveHandConfidenceThresholds()).toEqual({
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    expect(
      signEngineMod.resolveHandConfidenceThresholds({
        demoLocalTolerant: true,
        devRecorderActive: true,
      })
    ).toEqual({
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    // Modo Demo Local tolerante para dorso/puño dorsal y contraluz (0.35–0.40 presence/tracking)
    const demoThr = signEngineMod.resolveHandConfidenceThresholds({
      demoLocalTolerant: true,
      enablePose: false,
      enableRemoteTransport: false,
      devRecorderActive: false,
    });
    expect(demoThr.minHandPresenceConfidence).toBeGreaterThanOrEqual(0.35);
    expect(demoThr.minHandPresenceConfidence).toBeLessThanOrEqual(0.4);
    expect(demoThr.minTrackingConfidence).toBeGreaterThanOrEqual(0.35);
    expect(demoThr.minTrackingConfidence).toBeLessThanOrEqual(0.4);
    expect(new SignEngine({ demoLocalTolerant: true, enablePose: false }).handConfidenceThresholds).toEqual(demoThr);
  });

  it('acepta resoluciones móviles verticales (480x640, 720x1280) cuando strictAspectRatio es false sin emitir ERR_INVALID_ASPECT_RATIO', () => {
    const engine = new SignEngine({ strictAspectRatio: false, smoothLandmarks: false });
    const errors = [];
    engine.onError((e) => errors.push(e));

    expect(engine._checkVideoAspectRatio(480, 640)).toBe(true);
    expect(engine._checkVideoAspectRatio(720, 1280)).toBe(true);
    expect(engine._checkVideoAspectRatio(1280, 720)).toBe(true);
    expect(errors).toHaveLength(0);

    // Verifica que framePayload incluye aspectRatio real (0.75 en 480x640)
    engine._videoElement = { videoWidth: 480, videoHeight: 640 };
    let emitted = null;
    engine.onFrame((payload) => {
      emitted = payload;
    });
    engine._dispatchNormalizedResults({
      pose: null,
      hands: [],
      handedness: [],
      timestamp: 1000,
      latencyMs: 3,
    });
    expect(emitted.videoWidth).toBe(480);
    expect(emitted.videoHeight).toBe(640);
    expect(emitted.aspectRatio).toBeCloseTo(0.75, 4);
  });
});
