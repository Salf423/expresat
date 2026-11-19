/**
 * Pure utilities, quality gates, reusable AudioContext tone player, and
 * FEATURE_SPEC v1.4.0 metadata payload builder for DevRecorder (.raw.json).
 */

import {
  FEATURE_SPEC_VERSION,
  HAND_LANDMARKER_SHA256,
  POSE_LANDMARKER_SHA256,
  computeConfigHash,
} from '../engine/featureExtractor.js';
import { validateVideoAspectRatio } from '../engine/signEngine.js';

export const DEV_RECORDER_VERSION = '1.4.0';
export const DEFAULT_BORDER_MARGIN = 0.03;
export const DEFAULT_ACTIVE_SIGN_MIN_HAND_RATIO = 0.6;

// Precomputed canonical SHA-256 digests for synchronous fallback when delegate/cadence are defaults
const SYNC_DEFAULT_CONFIG_HASHES = Object.freeze({
  'GPU:1': '7992397c3e4387e937c46b195fcb1e078109368f249bdc41171815212cae2ce5',
  'CPU:1': '516b342376f93926c360461c85e296489d48ff7f0ab99b1feeb2eec5b20d3579',
  'GPU:2': '977978feb5235fa525715f8e4ae3675c8b5d08810c1af22224e6e8d089ae4799',
});

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
    subText: 'Frente a tu pecho (convención directa v1.4.0: "Right" -> slot derecho).',
    toneFreq: 660,
    toneDuration: 0.22,
  },
  {
    start_ms: 7000,
    end_ms: 11000,
    label: 'solo_izquierda',
    instruction: 'LEVANTA SOLO LA MANO IZQUIERDA',
    subText: 'Baja la derecha y levanta la izquierda ("Left" -> slot izquierdo).',
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

/**
 * Create a leak-free tone player reusing a single AudioContext across all cues.
 * Always call `dispose()` on unmount to close the underlying audio hardware context.
 */
export function createReusableTonePlayer(getAudioContextCtor = null) {
  let ctx = null;
  let disposed = false;

  const resolveCtor = () => {
    if (typeof getAudioContextCtor === 'function') {
      return getAudioContextCtor();
    }
    if (typeof window !== 'undefined') {
      return window.AudioContext || window.webkitAudioContext || null;
    }
    return null;
  };

  return {
    play(freq = 660, durationSec = 0.2) {
      if (disposed) return;
      try {
        if (!ctx) {
          const AudioCtx = resolveCtor();
          if (!AudioCtx) return;
          ctx = new AudioCtx();
        }
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          ctx.resume().catch(() => {});
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.35, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durationSec);
      } catch {
        // Ignore browser autoplay restrictions or audio device unavailability
      }
    },
    dispose() {
      disposed = true;
      if (ctx) {
        const toClose = ctx;
        ctx = null;
        try {
          if (typeof toClose.close === 'function' && toClose.state !== 'closed') {
            Promise.resolve(toClose.close()).catch(() => {});
          }
        } catch {
          // Ignore AudioContext close errors during teardown
        }
      }
    },
  };
}

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

/**
 * Measure framing/border proximity metrics across captured frames:
 * - Hands touching within `borderMargin` of [0, 1] image edges (clip risk)
 * - Pose shoulders (P11 / P12) exiting [0, 1] bounds
 */
export function computeEdgeMetrics(recordedFrames, borderMargin = DEFAULT_BORDER_MARGIN) {
  const frames = Array.isArray(recordedFrames) ? recordedFrames : [];
  const total = frames.length;
  const low = borderMargin;
  const high = 1.0 - borderMargin;

  let framesWithHandNearEdge = 0;
  let poseShouldersOobFrames = 0;

  for (let i = 0; i < total; i++) {
    const fr = frames[i];
    if (!fr) continue;

    // Check pose shoulders P11 & P12 in [0, 1]
    const pose = fr.pose;
    if (Array.isArray(pose) && pose.length > 12) {
      const p11 = pose[11];
      const p12 = pose[12];
      const oob11 =
        p11 &&
        typeof p11.x === 'number' &&
        typeof p11.y === 'number' &&
        (p11.x < 0 || p11.x > 1 || p11.y < 0 || p11.y > 1);
      const oob12 =
        p12 &&
        typeof p12.x === 'number' &&
        typeof p12.y === 'number' &&
        (p12.x < 0 || p12.x > 1 || p12.y < 0 || p12.y > 1);
      if (oob11 || oob12) {
        poseShouldersOobFrames++;
      }
    }

    // Check any hand landmark touching border margin
    const hands = fr.hands;
    let handNearEdge = false;
    if (Array.isArray(hands)) {
      for (let hi = 0; hi < hands.length && !handNearEdge; hi++) {
        const hEntry = hands[hi];
        const lms = Array.isArray(hEntry?.landmarks)
          ? hEntry.landmarks
          : Array.isArray(hEntry)
            ? hEntry
            : null;
        if (!lms) continue;
        for (let li = 0; li < lms.length; li++) {
          const pt = lms[li];
          if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') continue;
          if (pt.x < low || pt.x > high || pt.y < low || pt.y > high) {
            handNearEdge = true;
            break;
          }
        }
      }
    }
    if (handNearEdge) {
      framesWithHandNearEdge++;
    }
  }

  return {
    border_margin: borderMargin,
    frames_checked: total,
    frames_with_hand_near_edge: framesWithHandNearEdge,
    edge_clip_ratio: total > 0 ? Number((framesWithHandNearEdge / total).toFixed(4)) : 0,
    pose_shoulders_oob_frames: poseShouldersOobFrames,
  };
}

/**
 * Enforce active-sign hand presence gate:
 * Labeled active signs (`signLabel` present and not `'reposo'`) must detect at least one hand
 * in `>= minRatio` (default 60%) of frames to prevent empty takes from polluting the dataset.
 */
export function evaluateActiveSignHandPresence(
  recordedFrames,
  { signLabel = null, minRatio = DEFAULT_ACTIVE_SIGN_MIN_HAND_RATIO } = {}
) {
  const frames = Array.isArray(recordedFrames) ? recordedFrames : [];
  const total = frames.length;
  let framesWithHands = 0;
  for (let i = 0; i < total; i++) {
    const hands = frames[i]?.hands;
    if (Array.isArray(hands) && hands.length > 0) {
      framesWithHands++;
    }
  }

  const ratio = total > 0 ? Number((framesWithHands / total).toFixed(4)) : 0;
  const normalizedLabel = typeof signLabel === 'string' && signLabel.trim() ? signLabel.trim() : null;
  const isActiveSign = Boolean(normalizedLabel && normalizedLabel.toLowerCase() !== 'reposo');
  const passed = !isActiveSign || (total > 0 && ratio >= minRatio);

  return {
    sign_label: normalizedLabel,
    is_active_sign: isActiveSign,
    frames_with_hands: framesWithHands,
    hand_presence_ratio: ratio,
    min_required_ratio: minRatio,
    passed,
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
  signLabel = null,
  minActiveHandRatio = DEFAULT_ACTIVE_SIGN_MIN_HAND_RATIO,
  configHash = null,
  recordingMetadata = null,
  search = typeof window !== 'undefined' ? window.location?.search || '' : '',
  recordedAt = new Date().toISOString(),
} = {}) {
  const frames = Array.isArray(recordedFrames) ? recordedFrames : [];
  const vWidth = videoEl?.videoWidth || fallbackTrackSettings?.videoWidth || 640;
  const vHeight = videoEl?.videoHeight || fallbackTrackSettings?.videoHeight || 480;

  const avgFps =
    finalDurationMs > 0 ? Number(((frames.length / finalDurationMs) * 1000).toFixed(1)) : 0;

  const intervalMetrics = computeIntervalMetrics(frames);
  const edgeMetrics = computeEdgeMetrics(frames);
  const handPresenceMetrics = evaluateActiveSignHandPresence(frames, {
    signLabel,
    minRatio: minActiveHandRatio,
  });
  const aspectCheck = validateVideoAspectRatio(vWidth, vHeight);

  const isFpsValid = avgFps >= minFpsThreshold;
  const isGapValid = intervalMetrics.max_ms <= 100.0;
  const isAspectValid = aspectCheck.valid;
  const isHandPresenceValid = handPresenceMetrics.passed;
  const isValid = isFpsValid && isGapValid && isAspectValid && isHandPresenceValid;

  let errCode = null;
  if (!isFpsValid) {
    errCode = 'ERR_CAPTURE_FPS_TOO_LOW';
  } else if (!isGapValid) {
    errCode = 'ERR_CAPTURE_GAP_TOO_LARGE';
  } else if (!isAspectValid) {
    errCode = 'ERR_INVALID_ASPECT_RATIO';
  } else if (!isHandPresenceValid) {
    errCode = 'ERR_CAPTURE_NO_HANDS_IN_ACTIVE_SIGN';
  }

  const delegate = resolveActiveDelegate({ engine, search });
  const poseCadence = Math.max(1, Math.trunc(engine?.poseCadence ?? 1));
  const resolvedHash =
    configHash ||
    SYNC_DEFAULT_CONFIG_HASHES[`${delegate}:${poseCadence}`] ||
    SYNC_DEFAULT_CONFIG_HASHES['GPU:1'];

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

  const payload = {
    version: DEV_RECORDER_VERSION,
    feature_spec_version: FEATURE_SPEC_VERSION,
    config_hash: resolvedHash,
    pose_cadence: poseCadence,
    model_artifacts: {
      hand_landmarker_sha256: HAND_LANDMARKER_SHA256,
      pose_landmarker_sha256: POSE_LANDMARKER_SHA256,
    },
    type: 'expresat_dev_recording_raw',
    recorded_at: recordedAt,
    delegate,
    track_settings: trackSettings,
    duration_ms: finalDurationMs,
    total_frames: frames.length,
    avg_fps: avgFps,
    min_fps_required: minFpsThreshold,
    interval_metrics: intervalMetrics,
    edge_metrics: edgeMetrics,
    hand_presence_metrics: handPresenceMetrics,
    valid: isValid,
    error: errCode,
    prompt_timeline: timeline,
    videoWidth: vWidth,
    videoHeight: vHeight,
    frames,
  };

  if (recordingMetadata && typeof recordingMetadata === 'object') {
    payload.recording_metadata = recordingMetadata;
  }

  return payload;
}

/**
 * Async builder that dynamically computes the exact Web Crypto SHA-256 `config_hash`
 * for any `(delegate, poseCadence)` before constructing the canonical v1.4.0 payload.
 */
export async function buildDevRecordingPayloadAsync(options = {}) {
  const delegate = resolveActiveDelegate({
    engine: options.engine,
    search: options.search ?? (typeof window !== 'undefined' ? window.location?.search || '' : ''),
  });
  const poseCadence = Math.max(1, Math.trunc(options.engine?.poseCadence ?? 1));
  const computedHash = await computeConfigHash({ delegate, poseCadence });
  return buildDevRecordingPayload({
    ...options,
    configHash: computedHash,
  });
}
