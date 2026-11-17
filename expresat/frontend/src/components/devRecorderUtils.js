/**
 * Pure utilities and metadata payload builder for DevRecorder (.raw.json).
 */

export const PROMPT_TIMELINE = Object.freeze([
  {
    start_ms: 0,
    end_ms: 3000,
    label: 'reposo',
    instruction: 'REPOSO — BRAZOS ABAJO',
    subText: 'Mantén los brazos abajo y relajados fuera del encuadre.',
    toneFreq: 440,
    toneDuration: 0.15,
  },
  {
    start_ms: 3000,
    end_ms: 7000,
    label: 'solo_derecha',
    instruction: 'LEVANTA SOLO LA MANO DERECHA',
    subText: 'Frente a tu pecho. MediaPipe la etiquetará como "Left".',
    toneFreq: 660,
    toneDuration: 0.22,
  },
  {
    start_ms: 7000,
    end_ms: 11000,
    label: 'solo_izquierda',
    instruction: 'LEVANTA SOLO LA MANO IZQUIERDA',
    subText: 'Baja la derecha y levanta la izquierda ("Right" en MediaPipe).',
    toneFreq: 660,
    toneDuration: 0.22,
  },
  {
    start_ms: 11000,
    end_ms: 15000,
    label: 'ambas',
    instruction: 'LEVANTA AMBAS MANOS',
    subText: 'Ambas manos visibles a la altura del pecho sin cruzarse.',
    toneFreq: 880,
    toneDuration: 0.25,
  },
  {
    start_ms: 15000,
    end_ms: 18000,
    label: 'cruce',
    instruction: 'CRUZA AMBAS MANOS EN EL PECHO',
    subText: 'Cruza las manos en el espacio: mano derecha a la izquierda, izquierda a la derecha.',
    toneFreq: 990,
    toneDuration: 0.35,
  },
]);

export function computeIntervalMetrics(recordedFrames) {
  const gaps = [];
  if (Array.isArray(recordedFrames)) {
    for (let i = 1; i < recordedFrames.length; i++) {
      const dt = recordedFrames[i].t_ms - recordedFrames[i - 1].t_ms;
      if (!Number.isNaN(dt) && Number.isFinite(dt) && dt >= 0) {
        gaps.push(dt);
      }
    }
  }
  gaps.sort((a, b) => a - b);
  const n = gaps.length;
  const pickQuantile = (q) =>
    n > 0 ? Number(gaps[Math.min(n - 1, Math.floor(n * q))].toFixed(1)) : 0;

  const p50Ms = pickQuantile(0.5);
  const p95Ms = pickQuantile(0.95);
  const p99Ms = pickQuantile(0.99);
  const maxMs = n > 0 ? Number(gaps[n - 1].toFixed(1)) : 0;
  const gapsOver100 = gaps.filter((g) => g > 100.0).length;

  return {
    count: n,
    p50_ms: p50Ms,
    p95_ms: p95Ms,
    p99_ms: p99Ms,
    max_ms: maxMs,
    max_allowed_ms: 100.0,
    gaps_over_100ms: gapsOver100,
    gaps_over_100ms_count: gapsOver100,
  };
}

export function extractTrackSettings({ videoEl, engine, fallbackSettings = null } = {}) {
  let rawSettings = null;
  try {
    const stream = videoEl?.srcObject || engine?._mediaStream || null;
    const track = stream?.getVideoTracks?.()?.[0] || null;
    if (track && typeof track.getSettings === 'function') {
      rawSettings = { ...track.getSettings() };
    }
  } catch {
    rawSettings = null;
  }

  if (!rawSettings && fallbackSettings && typeof fallbackSettings === 'object') {
    rawSettings = { ...fallbackSettings };
  }
  if (!rawSettings) {
    const engineSettings = engine?._devTelemetry?._cameraNegotiation?.settings;
    if (engineSettings && typeof engineSettings === 'object') {
      rawSettings = { ...engineSettings };
    }
  }

  const vWidth = videoEl?.videoWidth || rawSettings?.width || 640;
  const vHeight = videoEl?.videoHeight || rawSettings?.height || 480;

  return {
    ...(rawSettings || {}),
    videoWidth: vWidth,
    videoHeight: vHeight,
    effective_resolution: `${vWidth}x${vHeight}`,
  };
}

export function resolveActiveDelegate({ engine, search = '' } = {}) {
  if (engine?._activeBackendInfo?.delegate) {
    return engine._activeBackendInfo.delegate;
  }
  if (engine?.preferredDelegate) {
    return engine.preferredDelegate;
  }
  if (search) {
    try {
      const q = new URLSearchParams(search).get('delegate')?.toUpperCase();
      if (q === 'GPU' || q === 'CPU') return q;
    } catch {
      // Ignore malformed URL query params
    }
  }
  return 'GPU';
}

export function createPromptTransitionEntry(promptDef, index, actualStartMs, timestampIso) {
  return {
    index,
    label: promptDef.label,
    instruction: promptDef.instruction,
    start_ms: promptDef.start_ms,
    end_ms: promptDef.end_ms,
    actual_start_ms: Number(actualStartMs.toFixed(2)),
    actual_end_ms: null,
    actual_timestamp_iso: timestampIso || new Date().toISOString(),
  };
}

export function buildDevRecordingPayload({
  recordedFrames,
  finalDurationMs,
  minFpsThreshold = 15.0,
  videoEl = null,
  engine = null,
  fallbackTrackSettings = null,
  executedTransitions = null,
  search = typeof window !== 'undefined' ? window.location?.search || '' : '',
  recordedAt = new Date().toISOString(),
} = {}) {
  const frames = Array.isArray(recordedFrames) ? recordedFrames : [];
  const vWidth = videoEl?.videoWidth || fallbackTrackSettings?.videoWidth || 640;
  const vHeight = videoEl?.videoHeight || fallbackTrackSettings?.videoHeight || 480;

  const avgFps =
    finalDurationMs > 0 ? Number(((frames.length / finalDurationMs) * 1000).toFixed(1)) : 0;

  const intervalMetrics = computeIntervalMetrics(frames);
  const isFpsValid = avgFps >= minFpsThreshold;
  const isGapValid = intervalMetrics.max_ms <= 100.0;
  const isValid = isFpsValid && isGapValid;

  let errCode = null;
  if (!isFpsValid) {
    errCode = 'ERR_CAPTURE_FPS_TOO_LOW';
  } else if (!isGapValid) {
    errCode = 'ERR_CAPTURE_GAP_TOO_LARGE';
  }

  const delegate = resolveActiveDelegate({ engine, search });
  const trackSettings = extractTrackSettings({
    videoEl,
    engine,
    fallbackSettings: fallbackTrackSettings,
  });

  const timeline =
    Array.isArray(executedTransitions) && executedTransitions.length > 0
      ? executedTransitions.map((entry, idx) =>
          idx === executedTransitions.length - 1 && entry.actual_end_ms === null
            ? { ...entry, actual_end_ms: Number(finalDurationMs.toFixed(2)) }
            : { ...entry }
        )
      : PROMPT_TIMELINE.map((p, idx) => ({
          index: idx,
          label: p.label,
          instruction: p.instruction,
          start_ms: p.start_ms,
          end_ms: p.end_ms,
          actual_start_ms: p.start_ms,
          actual_end_ms: Math.min(p.end_ms, finalDurationMs),
          actual_timestamp_iso: recordedAt,
        }));

  return {
    version: '1.3.1',
    type: 'expresat_dev_recording_raw',
    recorded_at: recordedAt,
    delegate,
    track_settings: trackSettings,
    duration_ms: finalDurationMs,
    total_frames: frames.length,
    avg_fps: avgFps,
    min_fps_required: minFpsThreshold,
    interval_metrics: intervalMetrics,
    valid: isValid,
    error: errCode,
    prompt_timeline: timeline,
    videoWidth: vWidth,
    videoHeight: vHeight,
    frames,
  };
}
