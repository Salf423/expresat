import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Circle, Square, Activity, AlertTriangle, Volume2 } from 'lucide-react';
import { getActiveDevCollector } from '../engine/index.js';
import {
  PROMPT_TIMELINE,
  createPromptTransitionEntry,
  createReusableTonePlayer,
  extractTrackSettings,
  buildDevRecordingPayloadAsync,
} from './devRecorderUtils.js';

/**
 * Development-only raw landmark recorder (guarded by `import.meta.env.DEV`, v1.4.0).
 *
 * Guarantees:
 * - Zero `setState` per frame inside `engine.onFrame` (counters kept in refs).
 * - UI refresh throttled to <= 4 Hz (250 ms interval) during active capture.
 * - Single reusable `AudioContext` closed cleanly on unmount (zero leaks).
 * - Enforces >= 15 FPS, <= 100 ms gap, 4:3 aspect ratio, active-sign hand presence,
 *   edge clipping telemetry, and canonical v1.4.0 `config_hash` + `.task` SHA-256 sealing.
 */

const RECORDING_DURATION_MS = 18000;
const MIN_FPS_THRESHOLD = 15.0;
const UI_THROTTLE_INTERVAL_MS = 250; // 4 Hz max UI updates while recording

export function DevRecorder({ engineRef, videoRef, signLabel = null }) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [liveFps, setLiveFps] = useState(0);
  const [handsDetectedCount, setHandsDetectedCount] = useState(0);
  const [poseDetectedCount, setPoseDetectedCount] = useState(0);
  const [pngCaptured, setPngCaptured] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [rejectionError, setRejectionError] = useState(null);
  const [activePromptIdx, setActivePromptIdx] = useState(0);

  const framesBufferRef = useRef([]);
  const handsDetectedCountRef = useRef(0);
  const poseDetectedCountRef = useRef(0);
  const startTimeRef = useRef(null);
  const unsubRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const recentTimestampsRef = useRef([]);
  const capturedPngDataUrlRef = useRef(null);
  const lastPromptIdxRef = useRef(-1);
  const trackSettingsRef = useRef(null);
  const executedTransitionsRef = useRef([]);
  const tonePlayerRef = useRef(null);

  const getTonePlayer = useCallback(() => {
    if (!tonePlayerRef.current) {
      tonePlayerRef.current = createReusableTonePlayer();
    }
    return tonePlayerRef.current;
  }, []);

  const stopAndDownload = useCallback(async () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (import.meta.env.DEV) {
      engineRef?.current?.setDevPhase?.('reposo');
    }

    const recordedFrames = framesBufferRef.current;
    const finalDurationMs = startTimeRef.current
      ? Math.round(performance.now() - startTimeRef.current)
      : 0;

    setIsRecording(false);
    setFrameCount(recordedFrames.length);
    setHandsDetectedCount(handsDetectedCountRef.current);
    setPoseDetectedCount(poseDetectedCountRef.current);
    setPngCaptured(Boolean(capturedPngDataUrlRef.current));

    if (recordedFrames.length === 0) {
      setStatusMsg('Grabación finalizada sin frames capturados.');
      return;
    }

    const payload = await buildDevRecordingPayloadAsync({
      recordedFrames,
      finalDurationMs,
      minFpsThreshold: MIN_FPS_THRESHOLD,
      videoEl: videoRef?.current,
      engine: engineRef?.current,
      fallbackTrackSettings: trackSettingsRef.current,
      executedTransitions: executedTransitionsRef.current,
      signLabel,
    });

    const {
      avg_fps: avgFps,
      valid: isValid,
      error: errCode,
      interval_metrics: metrics,
      hand_presence_metrics: handPresence,
    } = payload;

    if (errCode === 'ERR_CAPTURE_FPS_TOO_LOW') {
      setRejectionError(
        `ERR_CAPTURE_FPS_TOO_LOW: ${avgFps} FPS obtenidos < ${MIN_FPS_THRESHOLD} FPS requeridos`
      );
    } else if (errCode === 'ERR_CAPTURE_GAP_TOO_LARGE') {
      setRejectionError(
        `ERR_CAPTURE_GAP_TOO_LARGE: Intervalo máximo entre frames de ${metrics.max_ms} ms supera el límite de 100 ms (${metrics.gaps_over_100ms} intervalos > 100 ms; p50: ${metrics.p50_ms} ms, p95: ${metrics.p95_ms} ms)`
      );
    } else if (errCode === 'ERR_INVALID_ASPECT_RATIO') {
      setRejectionError(
        `ERR_INVALID_ASPECT_RATIO: Resolución ${payload.videoWidth}x${payload.videoHeight} fuera de contrato 4:3 (±0.05)`
      );
    } else if (errCode === 'ERR_CAPTURE_NO_HANDS_IN_ACTIVE_SIGN') {
      setRejectionError(
        `ERR_CAPTURE_NO_HANDS_IN_ACTIVE_SIGN: Presencia de manos ${(handPresence.hand_presence_ratio * 100).toFixed(1)}% < ${(handPresence.min_required_ratio * 100).toFixed(0)}% requerido para '${handPresence.sign_label}'`
      );
    } else {
      setRejectionError(null);
    }

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `grabacion_dev_18s_${Date.now()}${isValid ? '' : '_RECHAZADA'}.raw.json`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (capturedPngDataUrlRef.current) {
        const linkPng = document.createElement('a');
        linkPng.href = capturedPngDataUrlRef.current;
        linkPng.download = `captura_detector_5s_${Date.now()}.png`;
        document.body.appendChild(linkPng);
        linkPng.click();
        document.body.removeChild(linkPng);
      }

      if (isValid) {
        setStatusMsg(
          `Toma APROBADA (v${payload.version}): ${filename} (${recordedFrames.length} frames a ${avgFps} FPS; hash ${payload.config_hash.slice(0, 10)}…).`
        );
      } else {
        setStatusMsg(
          `Toma RECHAZADA: ${filename} (${recordedFrames.length} frames a ${avgFps} FPS; p95 Δt ${metrics.p95_ms} ms). Código: ${errCode}.`
        );
      }
    } catch (err) {
      console.error('[DevRecorder] Error generando descarga:', err);
      setStatusMsg('Error al descargar archivo JSON.');
    }
  }, [videoRef, engineRef, signLabel]);

  const startRecording = useCallback(() => {
    const engine = engineRef?.current;
    if (!engine) {
      setStatusMsg('Error: SignEngine no inicializado.');
      return;
    }

    if (import.meta.env.DEV) {
      engine.setDevPhase?.('grabando');
    }
    framesBufferRef.current = [];
    handsDetectedCountRef.current = 0;
    poseDetectedCountRef.current = 0;
    recentTimestampsRef.current = [];
    capturedPngDataUrlRef.current = null;
    lastPromptIdxRef.current = 0;
    trackSettingsRef.current = extractTrackSettings({
      videoEl: videoRef?.current,
      engine,
    });
    executedTransitionsRef.current = [createPromptTransitionEntry(PROMPT_TIMELINE[0], 0, 0)];
    startTimeRef.current = performance.now();

    setElapsedSec(0);
    setFrameCount(0);
    setLiveFps(0);
    setHandsDetectedCount(0);
    setPoseDetectedCount(0);
    setPngCaptured(false);
    setRejectionError(null);
    setActivePromptIdx(0);
    setStatusMsg('Iniciando toma de 18s...');
    setIsRecording(true);

    const player = getTonePlayer();
    player.play(PROMPT_TIMELINE[0].toneFreq, PROMPT_TIMELINE[0].toneDuration);

    // Throttled <= 4 Hz (250 ms) UI ticker: batches all counters & phase transitions
    timerIntervalRef.current = setInterval(() => {
      if (!startTimeRef.current) return;
      const now = performance.now();
      const elapsedMs = now - startTimeRef.current;
      const elapsedSeconds = elapsedMs / 1000.0;

      const promptIdx = PROMPT_TIMELINE.findIndex(
        (p) => elapsedMs >= p.start_ms && elapsedMs < p.end_ms
      );
      const safeIdx = promptIdx !== -1 ? promptIdx : PROMPT_TIMELINE.length - 1;

      if (safeIdx !== lastPromptIdxRef.current) {
        lastPromptIdxRef.current = safeIdx;
        const prevEntry = executedTransitionsRef.current[executedTransitionsRef.current.length - 1];
        if (prevEntry && prevEntry.actual_end_ms === null) {
          prevEntry.actual_end_ms = Number(elapsedMs.toFixed(2));
        }
        const currentPrompt = PROMPT_TIMELINE[safeIdx];
        executedTransitionsRef.current.push(
          createPromptTransitionEntry(currentPrompt, safeIdx, elapsedMs)
        );
        player.play(currentPrompt.toneFreq, currentPrompt.toneDuration);
      }

      // Rolling 1000 ms live FPS window (in-place pruning)
      const cutoff = now - 1000.0;
      const tsBuf = recentTimestampsRef.current;
      let dropCount = 0;
      while (dropCount < tsBuf.length && tsBuf[dropCount] < cutoff) {
        dropCount++;
      }
      if (dropCount > 0) {
        tsBuf.splice(0, dropCount);
      }

      setElapsedSec(Number(elapsedSeconds.toFixed(1)));
      setActivePromptIdx(safeIdx);
      setLiveFps(tsBuf.length);
      setFrameCount(framesBufferRef.current.length);
      setHandsDetectedCount(handsDetectedCountRef.current);
      setPoseDetectedCount(poseDetectedCountRef.current);
      if (capturedPngDataUrlRef.current) {
        setPngCaptured(true);
      }

      if (elapsedMs >= RECORDING_DURATION_MS) {
        stopAndDownload();
      }
    }, UI_THROTTLE_INTERVAL_MS);

    const devTel = import.meta.env.DEV ? engine._devTelemetry : null;
    unsubRef.current = engine.onFrame((framePayload) => {
      if (!framePayload || !startTimeRef.current) return;
      devTel?.mark('expresat:recorder_onframe:start');

      const now = performance.now();
      const tMs = Number((now - startTimeRef.current).toFixed(2));
      recentTimestampsRef.current.push(now);

      const raw = framePayload.raw || {};
      const rawHands = Array.isArray(raw.hands) ? raw.hands : [];
      const rawHandedness = Array.isArray(raw.handedness) ? raw.handedness : [];

      const formattedHands = new Array(rawHands.length);
      for (let i = 0; i < rawHands.length; i++) {
        const catItem = rawHandedness[i];
        const catObj = Array.isArray(catItem) ? catItem[0] : catItem;
        const fallbackCat = framePayload.handedness?.[i]?.[0];

        const catName =
          catObj?.categoryName ||
          catObj?.displayName ||
          catObj?.label ||
          fallbackCat?.categoryName ||
          fallbackCat?.label ||
          'Unknown';

        const scoreVal = Number(catObj?.score ?? fallbackCat?.score ?? 0.95);

        formattedHands[i] = {
          landmarks: rawHands[i],
          categoryName: catName,
          score: scoreVal,
        };
      }

      const videoEl = videoRef?.current;
      const vWidth = videoEl?.videoWidth || 640;
      const vHeight = videoEl?.videoHeight || 480;

      // Capture unmirrored raw frame seen by the detector at 5.0 s
      if (tMs >= 5000 && !capturedPngDataUrlRef.current && videoEl && videoEl.readyState >= 2) {
        try {
          const off = document.createElement('canvas');
          off.width = vWidth;
          off.height = vHeight;
          const octx = off.getContext('2d');
          octx.drawImage(videoEl, 0, 0, vWidth, vHeight);
          capturedPngDataUrlRef.current = off.toDataURL('image/png');
        } catch (pngErr) {
          console.warn('[DevRecorder] Error capturando PNG a los 5s:', pngErr);
        }
      }

      framesBufferRef.current.push({
        t_ms: tMs,
        videoWidth: vWidth,
        videoHeight: vHeight,
        hands: formattedHands,
        handedness: rawHandedness,
        pose: Array.isArray(raw.pose) ? raw.pose : null,
      });

      // Pure O(1) ref counters — ZERO setState per frame
      if (formattedHands.length > 0) {
        handsDetectedCountRef.current++;
      }
      if (raw.pose && raw.pose.length > 0) {
        poseDetectedCountRef.current++;
      }

      const recMs = devTel?.endAndMeasure(
        'expresat:stage:recorder_onframe',
        'expresat:recorder_onframe:start',
        'expresat:recorder_onframe:end'
      );
      if (recMs !== null && recMs !== undefined) {
        devTel?.recordStageDuration('recorder_onframe', recMs);
      }
    });
  }, [engineRef, videoRef, stopAndDownload, getTonePlayer]);

  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (unsubRef.current) unsubRef.current();
      tonePlayerRef.current?.dispose();
      tonePlayerRef.current = null;
      if (import.meta.env.DEV) {
        getActiveDevCollector()?.setPhase('reposo');
      }
    };
  }, []);

  if (!import.meta.env.DEV) {
    return null;
  }

  const activePrompt = PROMPT_TIMELINE[activePromptIdx] || PROMPT_TIMELINE[0];
  const phaseRemainingSec = Math.max(
    0,
    Number(((activePrompt.end_ms - elapsedSec * 1000) / 1000).toFixed(1))
  );

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.98)',
        border: rejectionError ? '2px solid #ef4444' : '1px solid #3b82f6',
        borderRadius: '10px',
        padding: '1rem',
        margin: '0.75rem 0',
        color: '#f8fafc',
        fontSize: '0.875rem',
        boxShadow: '0 8px 16px -2px rgba(0, 0, 0, 0.4)',
      }}
      data-testid="dev-recorder-panel"
    >
      {/* Top controls bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span
            style={{
              background: '#ef4444',
              color: '#fff',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontWeight: 'bold',
              fontSize: '0.75rem',
            }}
          >
            DEV v1.4.0
          </span>
          <span style={{ fontWeight: '700', fontSize: '1rem' }}>
            Grabador Canónico de Tomas (18s) — Quality Gate 15 FPS
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* CPU / GPU delegate selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Delegado:</span>
            <select
              value={
                (typeof window !== 'undefined' &&
                  new URLSearchParams(window.location.search).get('delegate')?.toUpperCase()) ||
                engineRef?.current?._activeBackendInfo?.delegate ||
                'GPU'
              }
              onChange={(e) => {
                const next = e.target.value;
                if (typeof window !== 'undefined') {
                  const url = new URL(window.location.href);
                  url.searchParams.set('delegate', next);
                  window.location.href = url.toString();
                }
              }}
              style={{
                background: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #0284c7',
                borderRadius: '4px',
                padding: '0.2rem 0.45rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
              data-testid="delegate-selector"
              aria-label="Selector de delegado MediaPipe"
            >
              <option value="GPU">GPU</option>
              <option value="CPU">CPU</option>
            </select>
          </div>

          {/* Live FPS badge */}
          {isRecording && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: liveFps >= MIN_FPS_THRESHOLD ? '#065f46' : '#7f1d1d',
                color: liveFps >= MIN_FPS_THRESHOLD ? '#34d399' : '#f87171',
                padding: '0.3rem 0.6rem',
                borderRadius: '6px',
                fontWeight: 'bold',
                fontSize: '0.85rem',
                border: `1px solid ${liveFps >= MIN_FPS_THRESHOLD ? '#10b981' : '#ef4444'}`,
              }}
              data-testid="live-fps-badge"
            >
              <Activity size={14} />
              <span>FPS: {liveFps}</span>
              <span style={{ fontSize: '0.7rem' }}>
                ({liveFps >= MIN_FPS_THRESHOLD ? '≥ 15 OK' : '< 15 BAJO'})
              </span>
            </div>
          )}

          {!isRecording ? (
            <button
              type="button"
              onClick={startRecording}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.9rem',
              }}
              data-testid="dev-record-start-btn"
            >
              <Circle size={16} fill="#ef4444" color="#ef4444" />
              Grabar Toma 18s (con Audio y Prompts)
            </button>
          ) : (
            <button
              type="button"
              onClick={stopAndDownload}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.5rem 1rem',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.9rem',
              }}
              data-testid="dev-record-stop-btn"
            >
              <Square size={16} fill="#fff" />
              Detener y Guardar ({elapsedSec}s / 18s)
            </button>
          )}
        </div>
      </div>

      {/* On-screen prompt instruction banner */}
      {isRecording && (
        <div
          style={{
            marginTop: '0.85rem',
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98))',
            border: '2px solid #38bdf8',
            borderRadius: '8px',
            padding: '0.85rem 1.25rem',
            textAlign: 'center',
            boxShadow: '0 4px 12px rgba(56, 189, 248, 0.25)',
          }}
          data-testid="prompt-instruction-banner"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Volume2 size={18} color="#38bdf8" />
            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8' }}>
              Fase {activePromptIdx + 1} de {PROMPT_TIMELINE.length} — Quedan {phaseRemainingSec}s
            </span>
          </div>
          <div
            style={{
              fontSize: '1.4rem',
              fontWeight: '800',
              color: '#38bdf8',
              letterSpacing: '0.02em',
              textShadow: '0 2px 4px rgba(0,0,0,0.5)',
            }}
          >
            {activePrompt.instruction}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: '0.2rem' }}>
            {activePrompt.subText}
          </div>
        </div>
      )}

      {/* Live recording metrics */}
      {isRecording && (
        <div
          style={{
            marginTop: '0.65rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.25rem',
            fontSize: '0.85rem',
            color: '#94a3b8',
            background: 'rgba(0,0,0,0.25)',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
          }}
        >
          <span>Progreso: <b style={{ color: '#fff' }}>{elapsedSec}s / 18.0s</b></span>
          <span>Frames: <b style={{ color: '#fff' }}>{frameCount}</b></span>
          <span>Manos detectadas: <b style={{ color: '#fff' }}>{handsDetectedCount}</b></span>
          <span>Pose detectada: <b style={{ color: '#fff' }}>{poseDetectedCount}</b></span>
          <span>PNG a 5s: <b style={{ color: pngCaptured ? '#34d399' : '#f59e0b' }}>
            {pngCaptured ? 'Capturado' : 'Pendiente...'}
          </b></span>
        </div>
      )}

      {/* Quality gate rejection banner */}
      {rejectionError && !isRecording && (
        <div
          role="alert"
          style={{
            marginTop: '0.65rem',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            padding: '0.6rem 0.85rem',
            color: '#fca5a5',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
          data-testid="rejection-error-banner"
        >
          <AlertTriangle size={18} color="#ef4444" />
          <span><b>CALIDAD INSUFICIENTE:</b> {rejectionError}.</span>
        </div>
      )}

      {/* Final status message */}
      {statusMsg && !isRecording && (
        <div
          role="status"
          aria-live="polite"
          style={{ marginTop: '0.5rem', color: rejectionError ? '#f87171' : '#38bdf8', fontSize: '0.825rem' }}
        >
          {statusMsg}
        </div>
      )}
    </div>
  );
}

export default DevRecorder;
