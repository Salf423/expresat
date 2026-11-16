import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Circle, Square, Activity, AlertTriangle, Volume2 } from 'lucide-react';
import { getActiveDevCollector } from '../engine/index.js';
import {
  PROMPT_TIMELINE,
  createPromptTransitionEntry,
  extractTrackSettings,
  buildDevRecordingPayload,
} from './devRecorderUtils.js';

/**
 * DevRecorder.jsx — Grabador Mínimo Exclusivo de Desarrollo (import.meta.env.DEV)
 *
 * Mejoras v1.3.1 (Puntos 2, 3, 4, 5):
 *   - Compuerta de Calidad: Medición de FPS en vivo y rechazo si avg_fps < 15 (ERR_CAPTURE_FPS_TOO_LOW).
 *   - Etiquetas estrictas: categoryName ('Left'|'Right') y score guardados en cada mano y en frame.handedness.
 *   - Indicaciones en pantalla: cuenta regresiva, aviso sonoro (Web Audio API) y texto grande.
 *   - Línea de tiempo: prompt_timeline persistida en .raw.json con transiciones reales y ventana de gracia.
 *   - Captura PNG: Snapshot a los 5.0 s del frame exacto que ve el detector (cámara nativa sin espejo).
 */

/**
 * Síntesis de beeps de aviso mediante Web Audio API (Punto 4).
 */
function playTone(freq = 660, durationSec = 0.2) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
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
    // Silencioso ante restricciones de autoplay
  }
}

export function DevRecorder({ engineRef, videoRef }) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [liveFps, setLiveFps] = useState(0);
  const [handsDetectedCount, setHandsDetectedCount] = useState(0);
  const [poseDetectedCount, setPoseDetectedCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [rejectionError, setRejectionError] = useState(null);
  const [activePromptIdx, setActivePromptIdx] = useState(0);

  const framesBufferRef = useRef([]);
  const startTimeRef = useRef(null);
  const unsubRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const recentTimestampsRef = useRef([]);
  const capturedPngDataUrlRef = useRef(null);
  const lastPromptIdxRef = useRef(-1);
  const trackSettingsRef = useRef(null);
  const executedTransitionsRef = useRef([]);

  const RECORDING_DURATION_MS = 18000;
  const MIN_FPS_THRESHOLD = 15.0;

  const stopAndDownload = useCallback(() => {
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

    if (recordedFrames.length === 0) {
      setStatusMsg('Grabación finalizada sin frames capturados.');
      return;
    }

    const payload = buildDevRecordingPayload({
      recordedFrames,
      finalDurationMs,
      minFpsThreshold: MIN_FPS_THRESHOLD,
      videoEl: videoRef?.current,
      engine: engineRef?.current,
      fallbackTrackSettings: trackSettingsRef.current,
      executedTransitions: executedTransitionsRef.current,
    });

    const { avg_fps: avgFps, valid: isValid, error: errCode, interval_metrics: metrics } = payload;

    if (errCode === 'ERR_CAPTURE_FPS_TOO_LOW') {
      setRejectionError(
        `ERR_CAPTURE_FPS_TOO_LOW: ${avgFps} FPS obtenidos < ${MIN_FPS_THRESHOLD} FPS requeridos`
      );
    } else if (errCode === 'ERR_CAPTURE_GAP_TOO_LARGE') {
      setRejectionError(
        `ERR_CAPTURE_GAP_TOO_LARGE: Intervalo máximo entre frames de ${metrics.max_ms} ms supera el límite de 100 ms (${metrics.gaps_over_100ms} intervalos > 100 ms; p50: ${metrics.p50_ms} ms, p95: ${metrics.p95_ms} ms)`
      );
    } else {
      setRejectionError(null);
    }

    // Descarga automática del .raw.json
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

      // Descarga de la captura PNG de 5s si se capturó (Punto 5)
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
          `✅ Toma APROBADA: ${filename} (${recordedFrames.length} frames a ${avgFps} FPS). PNG a los 5s descargado.`
        );
      } else {
        setStatusMsg(
          `❌ Toma RECHAZADA: ${filename} (${recordedFrames.length} frames a ${avgFps} FPS; p95 Δt ${metrics.p95_ms} ms). Archivo marcado con ${errCode}.`
        );
      }
    } catch (err) {
      console.error('[DevRecorder] Error generando descarga:', err);
      setStatusMsg('Error al descargar archivo JSON.');
    }
  }, [videoRef, engineRef]);

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
    setRejectionError(null);
    setActivePromptIdx(0);
    setStatusMsg('Iniciando toma de 18s...');
    setIsRecording(true);

    // Tono inicial
    playTone(PROMPT_TIMELINE[0].toneFreq, PROMPT_TIMELINE[0].toneDuration);

    // Temporizador de UI a 50ms para cuenta regresiva suave y transiciones de audio
    timerIntervalRef.current = setInterval(() => {
      if (!startTimeRef.current) return;
      const now = performance.now();
      const elapsedMs = now - startTimeRef.current;
      const elapsedSeconds = elapsedMs / 1000.0;
      setElapsedSec(Number(elapsedSeconds.toFixed(1)));

      // Identificar fase activa
      const promptIdx = PROMPT_TIMELINE.findIndex(
        (p) => elapsedMs >= p.start_ms && elapsedMs < p.end_ms
      );
      const safeIdx = promptIdx !== -1 ? promptIdx : PROMPT_TIMELINE.length - 1;
      setActivePromptIdx(safeIdx);

      // Si cambió de fase, cerrar transición previa, registrar timestamp real y emitir aviso sonoro (Punto 4)
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
        playTone(currentPrompt.toneFreq, currentPrompt.toneDuration);
      }

      // Cálculo de FPS en vivo en ventana rodante de 1000ms (Punto 2)
      const cutoff = now - 1000.0;
      recentTimestampsRef.current = recentTimestampsRef.current.filter((t) => t >= cutoff);
      setLiveFps(recentTimestampsRef.current.length);

      if (elapsedMs >= RECORDING_DURATION_MS) {
        stopAndDownload();
      }
    }, 50);

    // Suscribir listener de frames crudos
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

      // Garantizar que cada mano incluya categoryName y score sin perderlos (Punto 3)
      const formattedHands = rawHands.map((h, i) => {
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

        return {
          landmarks: h,
          categoryName: catName,
          score: scoreVal,
        };
      });

      const videoEl = videoRef?.current;
      const vWidth = videoEl?.videoWidth || 640;
      const vHeight = videoEl?.videoHeight || 480;

      // Captura PNG exacta a los 5.0 s (Punto 5) de lo que ve el detector (cámara nativa sin espejo)
      if (tMs >= 5000 && !capturedPngDataUrlRef.current && videoEl && videoEl.readyState >= 2) {
        try {
          const off = document.createElement('canvas');
          off.width = vWidth;
          off.height = vHeight;
          const octx = off.getContext('2d');
          // Sin transformaciones: frame crudo directo de la cámara
          octx.drawImage(videoEl, 0, 0, vWidth, vHeight);
          capturedPngDataUrlRef.current = off.toDataURL('image/png');
        } catch (pngErr) {
          console.warn('[DevRecorder] Error capturando PNG a los 5s:', pngErr);
        }
      }

      const frameData = {
        t_ms: tMs,
        videoWidth: vWidth,
        videoHeight: vHeight,
        hands: formattedHands,
        handedness: rawHandedness,
        pose: Array.isArray(raw.pose) ? raw.pose : null,
      };

      framesBufferRef.current.push(frameData);
      setFrameCount(framesBufferRef.current.length);

      if (formattedHands.length > 0) {
        setHandsDetectedCount((c) => c + 1);
      }
      if (raw.pose && raw.pose.length > 0) {
        setPoseDetectedCount((c) => c + 1);
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
  }, [engineRef, videoRef, stopAndDownload]);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (unsubRef.current) unsubRef.current();
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
      {/* Barra superior de controles */}
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
            DEV
          </span>
          <span style={{ fontWeight: '700', fontSize: '1rem' }}>
            Grabador Canónico de Tomas (18s) — Quality Gate 15 FPS
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Selector de Delegado CPU / GPU (Punto 1) */}
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

          {/* Badge de FPS en Vivo (Punto 2) */}
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

      {/* Banner Grande de Indicaciones en Pantalla (Punto 4) */}
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

      {/* Métricas en vivo durante la grabación */}
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
          <span>PNG a 5s: <b style={{ color: capturedPngDataUrlRef.current ? '#34d399' : '#f59e0b' }}>
            {capturedPngDataUrlRef.current ? 'Capturado ✅' : 'Pendiente...'}
          </b></span>
        </div>
      )}

      {/* Banner de Rechazo de Calidad (Punto 2) */}
      {rejectionError && !isRecording && (
        <div
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
          <span><b>CALIDAD INSUFICIENTE:</b> {rejectionError}. La toma fue rechazada porque la compuerta exige ≥ 15 FPS para prevenir brechas &gt; 100 ms.</span>
        </div>
      )}

      {/* Mensaje de estado final */}
      {statusMsg && !isRecording && (
        <div style={{ marginTop: '0.5rem', color: rejectionError ? '#f87171' : '#38bdf8', fontSize: '0.825rem' }}>
          {statusMsg}
        </div>
      )}
    </div>
  );
}

export default DevRecorder;
