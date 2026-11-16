import React, { useState } from 'react';
import { Activity, Camera, Copy, Download, RotateCcw, Sliders } from 'lucide-react';
import { formatReportMarkdown } from '../engine/index.js';

function StageRow({ label, reposoStats, grabandoStats }) {
  const fmt = (s) => {
    if (!s || s.count === 0) return '—';
    return `${s.p50} / ${s.p95} / ${s.p99} / ${s.max}`;
  };
  return (
    <tr style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
      <td style={{ padding: '0.32rem 0.45rem', color: '#e2e8f0' }}>{label}</td>
      <td
        style={{
          padding: '0.32rem 0.45rem',
          fontFamily: 'monospace',
          fontVariantNumeric: 'tabular-nums',
          color: '#93c5fd',
        }}
      >
        {fmt(reposoStats)}
      </td>
      <td
        style={{
          padding: '0.32rem 0.45rem',
          fontFamily: 'monospace',
          fontVariantNumeric: 'tabular-nums',
          color: '#fde68a',
        }}
      >
        {fmt(grabandoStats)}
      </td>
    </tr>
  );
}

export function DevInstrumentationPanel({ engineRef, fps, devSnapshot }) {
  const [expanded, setExpanded] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');

  if (!import.meta.env.DEV) {
    return null;
  }

  const currentCamExp =
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('camExp')) ||
    devSnapshot?.runtimeConfig?.cameraExperiment ||
    'default';

  const live = devSnapshot?.live || {};
  const cfg = devSnapshot?.runtimeConfig || {};
  const cam = devSnapshot?.cameraNegotiation || {};
  const settings = cam.settings || {};
  const capabilities = cam.capabilities || {};
  const rep = devSnapshot?.phases?.reposo;
  const grab = devSnapshot?.phases?.grabando;
  const activePhase = devSnapshot?.phase || 'reposo';
  const activeCounts = (activePhase === 'grabando' ? grab?.counts : rep?.counts) || {};

  const handleCamExpChange = (nextExp) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (nextExp === 'default') {
      url.searchParams.delete('camExp');
    } else {
      url.searchParams.set('camExp', nextExp);
    }
    window.location.href = url.toString();
  };

  const handleExportJson = () => {
    const report = engineRef?.current?.getDevReport?.();
    if (!report) return;
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `informe_instrumentacion_dev_${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn('[DevInstrumentationPanel] Error exportando JSON:', err);
    }
  };

  const handleCopyMarkdown = async () => {
    const report = engineRef?.current?.getDevReport?.();
    if (!report || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(formatReportMarkdown(report));
      setCopyStatus('Copiado');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch {
      setCopyStatus('Error al copiar');
      setTimeout(() => setCopyStatus(''), 2000);
    }
  };

  const handleReset = () => {
    engineRef?.current?.resetDevTelemetry?.();
  };

  return (
    <div
      data-testid="dev-instrumentation-panel"
      style={{
        background: 'rgba(15, 23, 42, 0.96)',
        border: '1px solid #0284c7',
        borderRadius: '10px',
        padding: '0.85rem 1rem',
        margin: '0.5rem 0 0.75rem 0',
        color: '#f1f5f9',
        fontSize: '0.78rem',
      }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span
            style={{
              background: '#0284c7',
              color: '#fff',
              padding: '0.15rem 0.45rem',
              borderRadius: '4px',
              fontWeight: 700,
              fontSize: '0.7rem',
            }}
          >
            DEV TELEMETRY
          </span>
          <strong style={{ fontSize: '0.88rem' }}>
            Instrumentación (solo medición) — Fase activa:{' '}
            <span style={{ color: activePhase === 'grabando' ? '#fbbf24' : '#38bdf8' }}>
              {activePhase.toUpperCase()}
            </span>
          </strong>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#94a3b8' }}>
            <Sliders size={13} />
            <span>Restricciones cámara:</span>
            <select
              data-testid="camera-experiment-selector"
              value={currentCamExp}
              onChange={(e) => handleCamExpChange(e.target.value)}
              style={{
                background: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #0284c7',
                borderRadius: '4px',
                padding: '0.15rem 0.4rem',
                fontSize: '0.74rem',
              }}
            >
              <option value="default">Estándar (ideal, actual)</option>
              <option value="exact15">Experimento: W/H exact + frameRate min 15</option>
            </select>
          </label>

          <button
            type="button"
            onClick={handleReset}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #475569',
              borderRadius: '4px',
              padding: '0.2rem 0.5rem',
              cursor: 'pointer',
              fontSize: '0.73rem',
            }}
          >
            <RotateCcw size={12} />
            <span>Reiniciar</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            data-testid="dev-export-report-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              background: '#0369a1',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '0.22rem 0.55rem',
              cursor: 'pointer',
              fontSize: '0.73rem',
              fontWeight: 600,
            }}
          >
            <Download size={12} />
            <span>Informe JSON</span>
          </button>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              background: '#1e293b',
              color: '#93c5fd',
              border: '1px solid #0284c7',
              borderRadius: '4px',
              padding: '0.2rem 0.5rem',
              cursor: 'pointer',
              fontSize: '0.73rem',
            }}
          >
            <Copy size={12} />
            <span>{copyStatus || 'Copiar MD'}</span>
          </button>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: 'transparent',
              color: '#94a3b8',
              border: '1px solid #334155',
              borderRadius: '4px',
              padding: '0.2rem 0.45rem',
              cursor: 'pointer',
              fontSize: '0.72rem',
            }}
          >
            {expanded ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {/* Resumen separado Cámara Real vs Loop vs Inferencia */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
              gap: '0.5rem',
            }}
          >
            <div style={{ background: 'rgba(2, 132, 199, 0.14)', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#38bdf8', fontWeight: 700 }}>
                <Camera size={13} />
                <span>Cámara Real (rVFC)</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.92rem', marginTop: '0.15rem' }}>
                <strong>{devSnapshot?.rvfcSupported === false ? 'N/A' : `${live.realCameraFps ?? 0} FPS`}</strong>
                <span style={{ color: '#94a3b8', fontSize: '0.72rem', marginLeft: '0.4rem' }}>
                  (cb/s: {live.rvfcCallbacksPerSec ?? 0})
                </span>
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>
                Únicos fase: {activeCounts.uniqueCameraFrames ?? 0} | Saltados: {activeCounts.skippedCameraFramesAtInference ?? 0}
              </div>
            </div>

            <div style={{ background: 'rgba(30, 41, 59, 0.7)', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid #334155' }}>
              <div style={{ color: '#cbd5e1', fontWeight: 700 }}>Cámara vista por loop _tick</div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.92rem', marginTop: '0.15rem' }}>
                <strong>{fps?.cameraFps ?? live.loopCameraFps ?? 0} FPS</strong>
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>
                Vistos _tick: {activeCounts.loopObservedCameraFrames ?? 0} | Playback/s:{' '}
                {live.playbackTotalFramesPerSec ?? '—'}
              </div>
            </div>

            <div style={{ background: 'rgba(139, 92, 246, 0.14)', padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(167, 139, 250, 0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#c4b5fd', fontWeight: 700 }}>
                <Activity size={13} />
                <span>Inferencia (Únic vs Dup)</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.92rem', marginTop: '0.15rem' }}>
                <strong>{fps?.inferenceFps ?? live.inferenceFps ?? 0} FPS</strong>
                <span style={{ color: '#86efac', fontSize: '0.72rem', marginLeft: '0.35rem' }}>
                  únic: {live.uniqueInferredFps ?? 0}
                </span>
                <span style={{ color: '#fca5a5', fontSize: '0.72rem', marginLeft: '0.35rem' }}>
                  dup: {live.duplicateInferenceFps ?? 0}
                </span>
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>
                Tot: {activeCounts.totalInferences ?? 0} | Únic: {activeCounts.uniqueInferredFrames ?? 0} | Dup: {activeCounts.duplicateInferences ?? 0} ({activeCounts.duplicateRatioPct ?? 0}%)
                {(activeCounts.inferenceErrors ?? 0) > 0 ? ` | Err: ${activeCounts.inferenceErrors}` : ''}
              </div>
            </div>
          </div>

          {/* Negociación getUserMedia & Config */}
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.3)',
              padding: '0.5rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid #334155',
              fontFamily: 'monospace',
              fontSize: '0.72rem',
              lineHeight: 1.5,
            }}
          >
            <div>
              <b>Config motor:</b> targetFps={cfg.targetFps ?? '—'} (intervalo={cfg.frameIntervalMs ?? '—'} ms) |
              delegate={cfg.delegate ?? cfg.preferredDelegate ?? '—'} | pose={String(cfg.poseEnabledActual ?? cfg.enablePose ?? false)} (cad={cfg.poseCadence ?? 1}) |
              crossOriginIsolated={String(cfg.crossOriginIsolated ?? false)} | threads={cfg.hardwareConcurrency ?? '—'}
            </div>
            <div>
              <b>getUserMedia ({cam.experimentMode ?? 'default'}):</b>{' '}
              getSettings={settings.width ?? '—'}×{settings.height ?? '—'} @ {settings.frameRate ?? '—'} fps
              {settings.aspectRatio ? ` (AR ${Number(settings.aspectRatio).toFixed(3)})` : ''} |{' '}
              videoEl={cam.videoWidth ?? '—'}×{cam.videoHeight ?? '—'} | fallback={String(Boolean(cam.usedFallback))}
              {cam.trackLabel ? ` | "${cam.trackLabel}"` : ''}
            </div>
            {Object.keys(settings).length > 0 && (
              <div style={{ color: '#94a3b8', wordBreak: 'break-all' }}>
                <b>getSettings() completo:</b> {JSON.stringify(settings)}
              </div>
            )}
            {Object.keys(capabilities).length > 0 && !capabilities.unsupported && (
              <div style={{ color: '#94a3b8', wordBreak: 'break-all' }}>
                <b>getCapabilities():</b> {JSON.stringify(capabilities)}
              </div>
            )}
            {cam.error && (
              <div style={{ color: '#fca5a5' }}>
                <b>Error negociación:</b> {cam.error.name} (constraint: {cam.error.constraint || 'N/A'}) — {cam.error.message}
              </div>
            )}
          </div>

          {/* Tabla comparativa Reposo vs Grabando (ms: p50 / p95 / p99 / máx) */}
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.72rem',
                textAlign: 'left',
              }}
            >
              <thead>
                <tr style={{ color: '#94a3b8', borderBottom: '1px solid #475569' }}>
                  <th style={{ padding: '0.3rem 0.45rem' }}>Etapa / Espera (ms: p50 / p95 / p99 / máx)</th>
                  <th style={{ padding: '0.3rem 0.45rem', color: '#93c5fd' }}>
                    Reposo ({rep?.counts?.totalInferences ?? 0} inf / {rep?.durationSec ?? 0}s)
                  </th>
                  <th style={{ padding: '0.3rem 0.45rem', color: '#fde68a' }}>
                    Grabando ({grab?.counts?.totalInferences ?? 0} inf / {grab?.durationSec ?? 0}s)
                  </th>
                </tr>
              </thead>
              <tbody>
                <StageRow
                  label="Espera inter-frame cámara (rVFC)"
                  reposoStats={rep?.stages?.cameraInterFrameMs}
                  grabandoStats={grab?.stages?.cameraInterFrameMs}
                />
                <StageRow
                  label="Espera de frame nuevo (loop)"
                  reposoStats={rep?.stages?.frameWaitForNewCameraMs}
                  grabandoStats={grab?.stages?.frameWaitForNewCameraMs}
                />
                <StageRow
                  label="Espera fuera de inferencia (tickWait)"
                  reposoStats={rep?.stages?.tickWaitMs}
                  grabandoStats={grab?.stages?.tickWaitMs}
                />
                <StageRow
                  label="Edad del frame al inferir (rVFC)"
                  reposoStats={rep?.stages?.frameAgeSinceRvfcMs}
                  grabandoStats={grab?.stages?.frameAgeSinceRvfcMs}
                />
                <StageRow
                  label="Etapa hand (detectForVideo)"
                  reposoStats={rep?.stages?.handMs}
                  grabandoStats={grab?.stages?.handMs}
                />
                <StageRow
                  label="Etapa pose (detectForVideo)"
                  reposoStats={rep?.stages?.poseInvokedMs}
                  grabandoStats={grab?.stages?.poseInvokedMs}
                />
                <StageRow
                  label="Etapa dibujo (tracker + canvas)"
                  reposoStats={rep?.stages?.dibujoMs}
                  grabandoStats={grab?.stages?.dibujoMs}
                />
                <StageRow
                  label="Etapa UI dispatch (onFrame + setState)"
                  reposoStats={rep?.stages?.uiDispatchMs}
                  grabandoStats={grab?.stages?.uiDispatchMs}
                />
                <StageRow
                  label="Etapa UI commit (React render + DOM)"
                  reposoStats={rep?.stages?.uiCommitMs}
                  grabandoStats={grab?.stages?.uiCommitMs}
                />
                <StageRow
                  label="Total _runInferenceStep"
                  reposoStats={rep?.stages?.totalFrameMs}
                  grabandoStats={grab?.stages?.totalFrameMs}
                />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default DevInstrumentationPanel;
