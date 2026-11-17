import { describe, it, expect } from 'vitest';
import {
  PROMPT_TIMELINE,
  computeIntervalMetrics,
  extractTrackSettings,
  resolveActiveDelegate,
  createPromptTransitionEntry,
  buildDevRecordingPayload,
} from '../devRecorderUtils.js';

describe('components/devRecorderUtils — Contrato de metadatos obligatorios en .raw.json', () => {
  it('incluye delegate, track_settings, prompt_timeline e interval_metrics completos sin alterar landmarks', () => {
    const sampleFrames = [
      { t_ms: 0, videoWidth: 640, videoHeight: 480, hands: [[0.1, 0.2, 0.3]], handedness: ['Left'], pose: [[0.5, 0.5, 0, 0.9]] },
      { t_ms: 50, videoWidth: 640, videoHeight: 480, hands: [[0.12, 0.22, 0.3]], handedness: ['Left'], pose: [[0.5, 0.5, 0, 0.9]] },
      { t_ms: 100, videoWidth: 640, videoHeight: 480, hands: [[0.14, 0.24, 0.3]], handedness: ['Left'], pose: [[0.5, 0.5, 0, 0.9]] },
      { t_ms: 230, videoWidth: 640, videoHeight: 480, hands: [], handedness: [], pose: [[0.5, 0.5, 0, 0.9]] },
    ];

    const mockTrack = {
      getSettings: () => ({
        width: 640,
        height: 480,
        frameRate: 30,
        facingMode: 'user',
        deviceId: 'cam-mock-1',
      }),
    };
    const mockVideoEl = {
      videoWidth: 640,
      videoHeight: 480,
      srcObject: {
        getVideoTracks: () => [mockTrack],
      },
    };
    const mockEngine = {
      _activeBackendInfo: { delegate: 'GPU', type: 'tasks-vision' },
      preferredDelegate: 'CPU',
    };

    const transitions = [
      { ...createPromptTransitionEntry(PROMPT_TIMELINE[0], 0, 0, '2026-11-16T10:00:00.000Z'), actual_end_ms: 3012.4 },
      { ...createPromptTransitionEntry(PROMPT_TIMELINE[1], 1, 3012.4, '2026-11-16T10:00:03.012Z'), actual_end_ms: 7004.1 },
      { ...createPromptTransitionEntry(PROMPT_TIMELINE[2], 2, 7004.1, '2026-11-16T10:00:07.004Z'), actual_end_ms: 11020.0 },
      { ...createPromptTransitionEntry(PROMPT_TIMELINE[3], 3, 11020.0, '2026-11-16T10:00:11.020Z'), actual_end_ms: 15005.2 },
      createPromptTransitionEntry(PROMPT_TIMELINE[4], 4, 15005.2, '2026-11-16T10:00:15.005Z'),
    ];

    const payload = buildDevRecordingPayload({
      recordedFrames: sampleFrames,
      finalDurationMs: 18000,
      minFpsThreshold: 15.0,
      videoEl: mockVideoEl,
      engine: mockEngine,
      executedTransitions: transitions,
      recordedAt: '2026-11-16T10:00:18.000Z',
    });

    // delegate activo real en SignEngine
    expect(payload.delegate).toBe('GPU');

    // track_settings real con getSettings() y dimensiones efectivas
    expect(payload.track_settings).toEqual({
      width: 640,
      height: 480,
      frameRate: 30,
      facingMode: 'user',
      deviceId: 'cam-mock-1',
      videoWidth: 640,
      videoHeight: 480,
      effective_resolution: '640x480',
    });

    // interval_metrics completo (count, p50_ms, p95_ms, p99_ms, max_ms, gaps_over_100ms)
    expect(payload.interval_metrics).toEqual({
      count: 3,
      p50_ms: 50,
      p95_ms: 130,
      p99_ms: 130,
      max_ms: 130,
      max_allowed_ms: 100.0,
      gaps_over_100ms: 1,
      gaps_over_100ms_count: 1,
    });
    expect(payload.error).toBe('ERR_CAPTURE_FPS_TOO_LOW');

    // prompt_timeline con transiciones ejecutadas y último cierre a finalDurationMs
    expect(payload.prompt_timeline).toHaveLength(5);
    expect(payload.prompt_timeline.map((p) => p.label)).toEqual([
      'reposo',
      'solo_derecha',
      'solo_izquierda',
      'ambas',
      'cruce',
    ]);
    expect(payload.prompt_timeline[0].actual_start_ms).toBe(0);
    expect(payload.prompt_timeline[0].actual_timestamp_iso).toBe('2026-11-16T10:00:00.000Z');
    expect(payload.prompt_timeline[4].actual_start_ms).toBe(15005.2);
    expect(payload.prompt_timeline[4].actual_end_ms).toBe(18000);

    // No modifica ni altera los arreglos de landmarks
    expect(payload.frames).toBe(sampleFrames);
    expect(payload.frames[0].hands).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('resuelve delegate efectivo desde _activeBackendInfo, preferredDelegate y query param', () => {
    expect(
      resolveActiveDelegate({
        engine: { _activeBackendInfo: { delegate: 'CPU' }, preferredDelegate: 'GPU' },
        search: '?delegate=GPU',
      })
    ).toBe('CPU');

    expect(
      resolveActiveDelegate({
        engine: { preferredDelegate: 'CPU' },
        search: '?delegate=GPU',
      })
    ).toBe('CPU');

    expect(resolveActiveDelegate({ search: '?delegate=cpu' })).toBe('CPU');
    expect(resolveActiveDelegate({})).toBe('GPU');
  });

  it('usa fallbackSettings o cameraNegotiation cuando videoEl ya cerró el stream', () => {
    const settings = extractTrackSettings({
      videoEl: { videoWidth: 320, videoHeight: 240, srcObject: null },
      engine: {
        _devTelemetry: {
          _cameraNegotiation: {
            settings: { width: 320, height: 240, frameRate: 15 },
          },
        },
      },
    });
    expect(settings).toEqual({
      width: 320,
      height: 240,
      frameRate: 15,
      videoWidth: 320,
      videoHeight: 240,
      effective_resolution: '320x240',
    });

    const fromFallback = extractTrackSettings({
      videoEl: { videoWidth: 640, videoHeight: 480 },
      fallbackSettings: { width: 640, height: 480, frameRate: 10 },
    });
    expect(fromFallback.frameRate).toBe(10);
    expect(fromFallback.effective_resolution).toBe('640x480');
  });

  it('calcula percentiles p50, p95, p99, max y gaps_over_100ms correctamente con buffer vacío o denso', () => {
    expect(computeIntervalMetrics([])).toEqual({
      count: 0,
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
      max_ms: 0,
      max_allowed_ms: 100.0,
      gaps_over_100ms: 0,
      gaps_over_100ms_count: 0,
    });

    // 101 frames con Δt de 1..100 + un salto de 120ms
    const denseFrames = [{ t_ms: 0 }];
    let acc = 0;
    for (let i = 1; i <= 99; i++) {
      acc += i;
      denseFrames.push({ t_ms: acc });
    }
    acc += 120;
    denseFrames.push({ t_ms: acc });

    const stats = computeIntervalMetrics(denseFrames);
    expect(stats.count).toBe(100);
    expect(stats.p50_ms).toBe(51);
    expect(stats.p95_ms).toBe(96);
    expect(stats.p99_ms).toBe(120);
    expect(stats.max_ms).toBe(120);
    expect(stats.gaps_over_100ms).toBe(1);
    expect(stats.gaps_over_100ms_count).toBe(1);
  });
});
