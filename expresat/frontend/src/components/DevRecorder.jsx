import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Circle, Square, Download, Activity, Video } from 'lucide-react';

/**
 * DevRecorder.jsx — Grabador Mínimo Exclusivo de Desarrollo (import.meta.env.DEV)
 *
 * Captura 18 s de framePayload.raw con:
 *   - t_ms (timestamp relativo al inicio de la toma)
 *   - hands: [{ landmarks: [...], categoryName: 'Left'|'Right', score: number }]
 *   - pose: [{ x, y, z, visibility }]
 *   - videoWidth, videoHeight
 *
 * Descarga automáticamente un archivo Blob .json (.raw.json) al finalizar.
 */
export function DevRecorder({ engineRef, videoRef }) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [handsDetectedCount, setHandsDetectedCount] = useState(0);
  const [poseDetectedCount, setPoseDetectedCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  const framesBufferRef = useRef([]);
  const startTimeRef = useRef(null);
  const unsubRef = useRef(null);
  const timerIntervalRef = useRef(null);

  const RECORDING_DURATION_MS = 18000; // 18 segundos estrictos

  const stopAndDownload = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
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

    const videoEl = videoRef?.current;
    const vWidth = videoEl?.videoWidth || 640;
    const vHeight = videoEl?.videoHeight || 480;

    const payload = {
      version: '1.3.0',
      type: 'expresat_dev_recording_raw',
      recorded_at: new Date().toISOString(),
      duration_ms: finalDurationMs,
      total_frames: recordedFrames.length,
      videoWidth: vWidth,
      videoHeight: vHeight,
      frames: recordedFrames,
    };

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `grabacion_dev_18s_${Date.now()}.raw.json`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setStatusMsg(`Descargado: ${filename} (${recordedFrames.length} frames)`);
    } catch (err) {
      console.error('[DevRecorder] Error generando descarga:', err);
      setStatusMsg('Error al descargar archivo JSON.');
    }
  }, [videoRef]);

  const startRecording = useCallback(() => {
    const engine = engineRef?.current;
    if (!engine) {
      setStatusMsg('Error: SignEngine no inicializado.');
      return;
    }

    framesBufferRef.current = [];
    startTimeRef.current = performance.now();
    setElapsedSec(0);
    setFrameCount(0);
    setHandsDetectedCount(0);
    setPoseDetectedCount(0);
    setStatusMsg('Grabando toma de 18s...');
    setIsRecording(true);

    // Temporizador de interfaz y auto-stop a los 18 segundos
    timerIntervalRef.current = setInterval(() => {
      if (!startTimeRef.current) return;
      const elapsed = (performance.now() - startTimeRef.current) / 1000.0;
      setElapsedSec(Number(elapsed.toFixed(1)));

      if (elapsed * 1000 >= RECORDING_DURATION_MS) {
        stopAndDownload();
      }
    }, 100);

    // Suscribir listener de frames crudos
    unsubRef.current = engine.onFrame((framePayload) => {
      if (!framePayload || !startTimeRef.current) return;

      const now = performance.now();
      const tMs = Number((now - startTimeRef.current).toFixed(2));

      const raw = framePayload.raw || {};
      const rawHands = Array.isArray(raw.hands) ? raw.hands : [];
      const rawHandedness = Array.isArray(raw.handedness) ? raw.handedness : [];

      const formattedHands = rawHands.map((h, i) => {
        const catObj = rawHandedness[i]?.[0];
        return {
          landmarks: h,
          categoryName: catObj?.categoryName || 'Unknown',
          score: Number(catObj?.score ?? 0.9),
        };
      });

      const videoEl = videoRef?.current;
      const vWidth = videoEl?.videoWidth || 640;
      const vHeight = videoEl?.videoHeight || 480;

      const frameData = {
        t_ms: tMs,
        videoWidth: vWidth,
        videoHeight: vHeight,
        hands: formattedHands,
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
    });
  }, [engineRef, videoRef, stopAndDownload]);

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (unsubRef.current) unsubRef.current();
    };
  }, []);

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid #3b82f6',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        margin: '0.75rem 0',
        color: '#f8fafc',
        fontSize: '0.875rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
      }}
      data-testid="dev-recorder-panel"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              background: '#ef4444',
              color: '#fff',
              padding: '0.15rem 0.4rem',
              borderRadius: '4px',
              fontWeight: 'bold',
              fontSize: '0.75rem',
            }}
          >
            DEV
          </span>
          <span style={{ fontWeight: '600' }}>Grabador Crudo de Tomas (18s)</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                padding: '0.4rem 0.8rem',
                cursor: 'pointer',
                fontWeight: '500',
              }}
              data-testid="dev-record-start-btn"
            >
              <Circle size={16} fill="#ef4444" color="#ef4444" />
              Grabar Toma 18s
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
                padding: '0.4rem 0.8rem',
                cursor: 'pointer',
                fontWeight: '500',
              }}
              data-testid="dev-record-stop-btn"
            >
              <Square size={16} fill="#fff" />
              Detener y Guardar ({elapsedSec}s / 18s)
            </button>
          )}
        </div>
      </div>

      {isRecording && (
        <div
          style={{
            marginTop: '0.5rem',
            display: 'flex',
            gap: '1rem',
            fontSize: '0.8rem',
            color: '#94a3b8',
          }}
        >
          <span>Progreso: <b>{elapsedSec}s / 18.0s</b></span>
          <span>Frames: <b>{frameCount}</b></span>
          <span>Manos detectadas: <b>{handsDetectedCount}</b></span>
          <span>Pose detectada: <b>{poseDetectedCount}</b></span>
        </div>
      )}

      {statusMsg && !isRecording && (
        <div style={{ marginTop: '0.4rem', color: '#38bdf8', fontSize: '0.8rem' }}>
          {statusMsg}
        </div>
      )}
    </div>
  );
}

export default DevRecorder;
