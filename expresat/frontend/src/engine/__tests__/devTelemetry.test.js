import { describe, it, expect, vi } from 'vitest';
import {
  SignEngine,
  ENGINE_ERROR_CODES,
  DevTelemetryCollector,
  BoundedRing,
  computePercentiles,
  formatReportMarkdown,
  buildTelemetryFilename,
  getDevGitCommitShort,
} from '../index.js';

describe('engine/devTelemetry — Percentiles, fases Reposo vs Grabando y detección de duplicados', () => {
  it('calcula p50, p95, p99, mean, min y max de forma determinista y filtra no finitos', () => {
    const empty = computePercentiles([]);
    expect(empty).toEqual({ count: 0, mean: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0 });

    // 1..100
    const seq = Array.from({ length: 100 }, (_, i) => i + 1);
    seq.push(NaN, -5, Infinity);
    const stats = computePercentiles(seq);
    expect(stats.count).toBe(100);
    expect(stats.min).toBe(1);
    expect(stats.p50).toBe(51);
    expect(stats.p95).toBe(96);
    expect(stats.p99).toBe(100);
    expect(stats.max).toBe(100);
    expect(stats.mean).toBe(50.5);
  });

  it('BoundedRing conserva solo las últimas N muestras al desbordar capacidad', () => {
    const ring = new BoundedRing(4);
    ring.push(10);
    ring.push(20);
    ring.push(30);
    ring.push(40);
    ring.push(50);
    ring.push(60);
    expect(ring.toArray()).toEqual([30, 40, 50, 60]);
  });

  it('separa métricas de reposo vs grabando, cuenta inferencias duplicadas y frames únicos rVFC', () => {
    const col = new DevTelemetryCollector({ enabled: true });
    col.setRvfcSupported(true);

    // Fase reposo: cámara entrega 3 frames únicos (presentedFrames 1->3), loop infiere 2 veces sobre mismo currentTime
    col.recordRealCameraFrame(100, { presentedFrames: 1, mediaTime: 0.1 });
    col.recordRealCameraFrame(133, { presentedFrames: 2, mediaTime: 0.133 });
    col.recordRealCameraFrame(166, { presentedFrames: 3, mediaTime: 0.166 });

    col.beginInferenceStep(0.166, 170);
    col.recordStageDuration('hand', 25);
    col.recordStageDuration('pose', 12);
    col.recordStageDuration('canvas', 3);
    col.recordStageDuration('ui_dispatch', 1);
    col.endInferenceStep(215);

    // Inferencia duplicada sobre mismo currentTime = 0.166
    col.beginInferenceStep(0.166, 225);
    col.recordStageDuration('hand', 24);
    col.recordStageDuration('canvas', 2);
    col.endInferenceStep(252);
    col.recordUiCommit('translator', 4.5);

    // Cambiar a grabando
    col.setPhase('grabando');
    // rVFC reporta salto de presentedFrames 3 -> 5 (1 frame perdido mientras main thread estaba ocupado)
    col.recordRealCameraFrame(300, { presentedFrames: 5, mediaTime: 0.233 });
    col.beginInferenceStep(0.233, 305);
    col.recordStageDuration('hand', 30);
    col.recordStageDuration('pose', 15);
    col.recordStageDuration('tracker', 2);
    col.recordStageDuration('canvas', 4);
    col.recordStageDuration('recorder_onframe', 3);
    col.endInferenceStep(365);
    col.recordUiCommit('dev_recorder', 8.0);
    col.recordUiCommit('translator', 9.0);

    const live = col.flushSecondMetrics({ totalVideoFrames: 5, droppedVideoFrames: 1 });
    expect(live.live.realCameraFps).toBe(5);
    expect(live.live.rvfcCallbacksPerSec).toBe(4);
    expect(live.live.inferenceFps).toBe(3);
    expect(live.live.uniqueInferredFps).toBe(2);
    expect(live.live.duplicateInferenceFps).toBe(1);
    expect(live.live.skippedCameraFramesPerSec).toBe(1);

    const report = col.buildComparisonReport();
    expect(report.phases.reposo.counts.totalInferences).toBe(2);
    expect(report.phases.reposo.counts.uniqueInferredFrames).toBe(1);
    expect(report.phases.reposo.counts.duplicateInferences).toBe(1);
    expect(report.phases.reposo.counts.duplicateRatioPct).toBe(50);
    expect(report.phases.reposo.stages.handMs.p50).toBe(25);
    expect(report.phases.reposo.stages.poseInvokedMs.count).toBe(1);

    expect(report.phases.grabando.counts.totalInferences).toBe(1);
    expect(report.phases.grabando.counts.uniqueInferredFrames).toBe(1);
    expect(report.phases.grabando.counts.duplicateInferences).toBe(0);
    expect(report.phases.grabando.counts.skippedCameraFramesAtInference).toBe(1);
    expect(report.phases.grabando.stages.dibujoMs.p50).toBe(6);
    expect(report.phases.grabando.stages.uiCommitRecorderMs.p50).toBe(8);
    expect(report.phases.grabando.stages.uiCommitMs.count).toBe(1);
    expect(report.phases.grabando.stages.uiCommitMs.p50).toBe(9);

    const md = formatReportMarkdown(report);
    expect(md).toContain('Informe de Instrumentación Dev — Reposo vs Grabando');
    expect(md).toContain('Inferencias duplicadas');
  });
});

describe('engine/SignEngine — Negociación getSettings() y experimento exact15', () => {
  it('registra track.getSettings(), getCapabilities() y constraints sin alterar comportamiento default', async () => {
    const originalNavigator = globalThis.navigator;
    const getUserMediaMock = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [
        {
          label: 'Integrated Camera',
          readyState: 'live',
          getSettings: () => ({ width: 640, height: 480, frameRate: 10, aspectRatio: 1.3333 }),
          getCapabilities: () => ({ frameRate: { min: 5, max: 30 }, width: { min: 160, max: 1280 } }),
          getConstraints: () => ({ width: { ideal: 640 }, height: { ideal: 480 } }),
          stop: vi.fn(),
        },
      ],
    });

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: getUserMediaMock }, hardwareConcurrency: 8 },
    });

    try {
      const col = new DevTelemetryCollector({ enabled: true });
      const engine = new SignEngine({ targetFps: 20, devTelemetry: col });
      const fakeVideo = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        srcObject: null,
        videoWidth: 640,
        videoHeight: 480,
      };
      // Mock _initializeMediaPipe to resolve immediately after play
      engine._initializeMediaPipe = vi.fn().mockResolvedValue(undefined);

      const ok = await engine.start(fakeVideo);
      expect(ok).toBe(true);
      expect(getUserMediaMock).toHaveBeenCalledWith({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 20 },
          facingMode: 'user',
        },
        audio: false,
      });

      const snap = engine.getDevSnapshot();
      expect(snap.cameraNegotiation.experimentMode).toBe('default');
      expect(snap.cameraNegotiation.settings.frameRate).toBe(10);
      expect(snap.cameraNegotiation.settings.width).toBe(640);
      expect(snap.cameraNegotiation.trackLabel).toBe('Integrated Camera');
      expect(snap.cameraNegotiation.usedFallback).toBe(false);

      engine.stop();
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('experimento exact15 exige width/height exact y frameRate min 15 sin fallback silencioso', async () => {
    const originalNavigator = globalThis.navigator;
    const overErr = new Error('Constraints could not be satisfied');
    overErr.name = 'OverconstrainedError';
    overErr.constraint = 'frameRate';
    const getUserMediaMock = vi.fn().mockRejectedValue(overErr);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: getUserMediaMock } },
    });

    try {
      const col = new DevTelemetryCollector({ enabled: true });
      const engine = new SignEngine({
        targetFps: 20,
        cameraExperiment: 'exact15',
        devTelemetry: col,
      });
      const errors = [];
      engine.onError((e) => errors.push(e));

      const fakeVideo = { play: vi.fn(), pause: vi.fn(), srcObject: null };
      const ok = await engine.start(fakeVideo);

      expect(ok).toBe(false);
      // Sin fallback a { video: true }: solo 1 llamada con exact + min: 15
      expect(getUserMediaMock).toHaveBeenCalledTimes(1);
      expect(getUserMediaMock).toHaveBeenCalledWith({
        video: {
          width: { exact: 640 },
          height: { exact: 480 },
          frameRate: { min: 15 },
          facingMode: 'user',
        },
        audio: false,
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe(ENGINE_ERROR_CODES.CAMERA_OVERCONSTRAINED);
      const snap = engine.getDevSnapshot();
      expect(snap.cameraNegotiation.experimentMode).toBe('exact15');
      expect(snap.cameraNegotiation.error).toEqual({
        name: 'OverconstrainedError',
        constraint: 'frameRate',
        message: 'Constraints could not be satisfied',
      });
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it('mide performance.mark por etapa y detecta inferencias duplicadas sobre video.currentTime estático', async () => {
    const col = new DevTelemetryCollector({ enabled: true });
    const engine = new SignEngine({ devTelemetry: col, smoothLandmarks: false });
    engine._handLandmarker = {
      detectForVideo: () => ({
        landmarks: [],
        handedness: [],
      }),
    };

    const fakeVideo = { currentTime: 1.25, videoWidth: 640, videoHeight: 480 };
    await engine._runInferenceStep(fakeVideo, 100);
    // Segundo paso con el MISMO currentTime -> inferencia duplicada
    await engine._runInferenceStep(fakeVideo, 150);
    // Tercer paso con nuevo currentTime -> inferencia única
    fakeVideo.currentTime = 1.3;
    await engine._runInferenceStep(fakeVideo, 200);

    const snap = engine.getDevSnapshot();
    expect(snap.phases.reposo.counts.totalInferences).toBe(3);
    expect(snap.phases.reposo.counts.uniqueInferredFrames).toBe(2);
    expect(snap.phases.reposo.counts.duplicateInferences).toBe(1);
    expect(snap.phases.reposo.stages.handMs.count).toBe(3);
    expect(snap.phases.reposo.stages.totalFrameMs.count).toBe(3);
    expect(snap.phases.reposo.stages.frameWaitForNewCameraMs.count).toBe(2);

    // Si detectForVideo lanza error, no se contabiliza como inferencia completada sino como inferenceErrors
    engine._handLandmarker = {
      detectForVideo: () => {
        throw new Error('GLctx is undefined');
      },
    };
    await expect(engine._runInferenceStep(fakeVideo, 250)).rejects.toThrow('GLctx is undefined');
    const snapAfterErr = engine.getDevSnapshot();
    expect(snapAfterErr.phases.reposo.counts.totalInferences).toBe(3);
    expect(snapAfterErr.phases.reposo.counts.inferenceErrors).toBe(1);
  });

  it('cero interferencia durante grabando: flushSecondMetrics no invoca getSnapshot y SignEngine solo refresca al detener', () => {
    vi.useFakeTimers();
    try {
      const col = new DevTelemetryCollector({ enabled: true });
      const getSnapSpy = vi.spyOn(col, 'getSnapshot');
      const engine = new SignEngine({ devTelemetry: col, smoothLandmarks: false });
      const snapshotsRecibidos = [];
      engine.onDevSnapshot((snap) => snapshotsRecibidos.push(snap));

      engine._running = true;
      engine._startFpsTicker();

      // En reposo, el ticker 1 Hz sí refresca UI
      vi.advanceTimersByTime(1000);
      expect(getSnapSpy).toHaveBeenCalledTimes(1);
      expect(snapshotsRecibidos).toHaveLength(1);
      expect(snapshotsRecibidos[0].phase).toBe('reposo');

      // En grabando, solo acumula en O(1) sin calcular snapshot/percentiles ni disparar listeners UI
      engine.setDevPhase('grabando');
      col.beginInferenceStep(100, 10);
      col.recordStageDuration('hand', 12);
      col.endInferenceStep(115);

      vi.advanceTimersByTime(3000);
      expect(getSnapSpy).toHaveBeenCalledTimes(1);
      expect(snapshotsRecibidos).toHaveLength(1);

      const liveDuringRec = col.flushSecondMetrics();
      expect(liveDuringRec.skippedHeavySnapshot).toBe(true);
      expect(liveDuringRec.phases).toBeNull();
      expect(getSnapSpy).toHaveBeenCalledTimes(1);

      // Al volver a reposo (fin de grabación), refresca el snapshot completo con lo acumulado en grabando
      engine.setDevPhase('reposo');
      expect(getSnapSpy).toHaveBeenCalledTimes(2);
      expect(snapshotsRecibidos).toHaveLength(2);
      expect(snapshotsRecibidos[1].phase).toBe('reposo');
      expect(snapshotsRecibidos[1].phases.grabando.counts.totalInferences).toBe(1);

      engine.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exporta metadatos inmutables (git_commit_short, user_agent, timestamp_iso, track_settings, delegate) y nombre telemetry_<YYYYMMDD_HHMMSS>_<githash>.json', () => {
    const col = new DevTelemetryCollector({ enabled: true });
    col.setRuntimeConfig({
      targetFps: 20,
      frameIntervalMs: 50,
      delegate: 'CPU',
      enablePose: true,
      poseCadence: 1,
    });
    col.setCameraNegotiation({
      settings: { width: 640, height: 480, frameRate: 15, facingMode: 'user' },
      videoWidth: 640,
      videoHeight: 480,
    });

    const report = col.buildComparisonReport();
    expect(report.timestamp_iso).toBeTruthy();
    expect(report.generatedAt).toBe(report.timestamp_iso);
    expect(typeof report.git_commit_short).toBe('string');
    expect(report.git_commit_short.length).toBeGreaterThan(0);
    expect(typeof report.user_agent).toBe('string');
    expect(report.user_agent.length).toBeGreaterThan(0);
    expect(report.delegate).toBe('CPU');
    expect(report.track_settings).toEqual({
      width: 640,
      height: 480,
      frameRate: 15,
      facingMode: 'user',
      videoWidth: 640,
      videoHeight: 480,
    });

    const md = formatReportMarkdown(report);
    expect(md).toContain('Git commit:');
    expect(md).toContain('User-Agent:');
    expect(md).toContain('Delegado:');
    expect(md).toContain('track_settings');

    const fixedDate = new Date(2026, 10, 16, 17, 45, 9);
    const filename = buildTelemetryFilename({ git_commit_short: '49f38e1' }, fixedDate);
    expect(filename).toBe('telemetry_20261116_174509_49f38e1.json');

    expect(getDevGitCommitShort(' ab/12#34 ')).toBe('ab1234');
    expect(getDevGitCommitShort('')).toBe('nogit');
    expect(buildTelemetryFilename(report)).toMatch(/^telemetry_\d{8}_\d{6}_[a-zA-Z0-9_-]+\.json$/);
  });
});
