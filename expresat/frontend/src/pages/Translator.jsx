import React, { useRef, useState } from 'react';
import {
  Camera,
  Activity,
  MessageSquare,
  Sparkles,
  Volume2,
  Copy,
  Check,
  Info,
  Layers,
  ChevronDown,
  ChevronUp,
  BarChart2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useSignEngine } from '../ui/index.js';
import { WS_STATES } from '../transport/index.js';
import { COLOR_LEGEND_ITEMS } from '../services/landmarkTracker.js';
import { CONFIG } from '../config.js';

const WS_STATE_LABELS = Object.freeze({
  [WS_STATES.IDLE]: 'Modo Local',
  [WS_STATES.CONNECTING]: 'Conectando...',
  [WS_STATES.OPEN]: 'Conectado',
  [WS_STATES.AUTH_ERROR]: 'Modo Demo Local (Sin Token)',
  [WS_STATES.FAILED]: 'Modo Demo Local (Sin Backend)',
});

const FINGER_NAMES_ES = Object.freeze([
  { key: 'thumb', label: 'Pulgar' },
  { key: 'index', label: 'Índice' },
  { key: 'middle', label: 'Medio' },
  { key: 'ring', label: 'Anular' },
  { key: 'pinky', label: 'Meñique' },
]);

const CATEGORY_LABELS_ES = Object.freeze({
  letra: 'Letra',
  numero: 'Número',
  basica: 'Seña base',
});

const Translator = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [copied, setCopied] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [recognitionMode, setRecognitionMode] = useState('all');
  const [trackingConfig, setTrackingConfig] = useState({
    enabled: true,
    showTrails: true,
    showLabels: false,
    showHalos: true,
    colorByPart: true,
    trailLength: 8,
  });
  const [showTelemetryDrawer, setShowTelemetryDrawer] = useState(false);
  const [selectedPartFilter, setSelectedPartFilter] = useState('all');

  const {
    fps,
    engineStatus,
    engineError,
    gesture,
    wsSnapshot,
    landmarksCount,
    telemetry,
    reconnectTransport,
  } = useSignEngine({
    videoRef,
    canvasRef,
    trackingConfig,
    enableRemoteTransport: true,
    recognitionMode,
  });

  // Atajos de teclado: Ctrl+Shift+D (Debug) y Ctrl+Shift+T (Tracker)
  React.useEffect(() => {
    const handleKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setDebugVisible((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        setTrackingConfig((c) => ({ ...c, enabled: !c.enabled }));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const translation = gesture.label || '';
  const gestureCategory = gesture.category || gesture.details?.category || null;
  const categoryLabel = gestureCategory ? CATEGORY_LABELS_ES[gestureCategory] || gestureCategory : null;
  const isLowConfidenceRejection =
    !translation && gesture.details?.reason === 'LOW_CONFIDENCE';
  const confidencePct = gesture.confidence ? Math.round(gesture.confidence * 100) : 0;
  const fingerStates = gesture.details?.states || null;
  const isWsOpen = wsSnapshot.state === WS_STATES.OPEN;
  const wsStatusLabel = WS_STATE_LABELS[wsSnapshot.state] || wsSnapshot.state;

  const handleSpeak = () => {
    if ('speechSynthesis' in window && translation) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(translation);
      utterance.lang = 'es-MX';
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleCopy = () => {
    if (translation && navigator.clipboard) {
      navigator.clipboard.writeText(translation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="container animate-fade-in"
      style={{
        padding: '2rem 1.5rem 4rem 1.5rem',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}
    >
      {/* Top Header & Status Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <h1
              className="gradient-text"
              style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', margin: 0 }}
            >
              Traductor LSM
            </h1>
            <span className="chip" style={{ fontSize: '0.75rem' }}>
              En Vivo
            </span>
            <span
              data-testid="wasm-status-badge"
              className="chip"
              style={{
                fontSize: '0.72rem',
                background: engineStatus.wasmReady
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(245, 158, 11, 0.15)',
                color: engineStatus.wasmReady ? '#10B981' : '#F59E0B',
                borderColor: 'transparent',
              }}
            >
              {engineStatus.wasmReady ? 'WASM Activo' : 'Cargando WASM...'}
            </span>
          </div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Posiciónate frente a la cámara con las manos visibles. Reconocimiento geométrico 100% en
            navegador.
          </p>
        </div>

        {/* Telemetry Indicator (WCAG aria-live="polite") */}
        <div
          role="status"
          aria-live="polite"
          className="glass-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '0.6rem 1.25rem',
            borderRadius: 'var(--radius-full)',
            flexWrap: 'wrap',
          }}
        >
          {/* FPS Cámara */}
          <div
            data-testid="camera-fps"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            title="Fotogramas por segundo entregados por la cámara"
          >
            <Camera size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Cámara:{' '}
              <strong style={{ color: 'var(--text-color)', fontFamily: 'monospace' }}>
                {fps.cameraFps}
              </strong>{' '}
              FPS
            </span>
          </div>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />

          {/* FPS Inferencia Real */}
          <div
            data-testid="inference-fps"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            title="Detecciones reales de MediaPipe procesadas por segundo"
          >
            <Activity size={16} color="var(--accent-secondary)" />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Inferencia:{' '}
              <strong style={{ color: 'var(--text-color)', fontFamily: 'monospace' }}>
                {fps.inferenceFps}
              </strong>{' '}
              FPS
            </span>
          </div>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />

          {/* Estado explícito del transporte WebSocket */}
          <div
            data-testid="ws-status"
            data-ws-state={wsSnapshot.state}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            title={wsSnapshot.detail}
          >
            <span
              className={`status-dot ${isWsOpen ? 'status-dot--online' : 'status-dot--offline'}`}
              aria-hidden="true"
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-color)' }}>
              {wsStatusLabel}
            </span>
            {(wsSnapshot.state === WS_STATES.FAILED ||
              wsSnapshot.state === WS_STATES.AUTH_ERROR) && (
              <button
                type="button"
                onClick={reconnectTransport}
                className="btn-icon"
                title="Reintentar conexión con el servidor backend"
                aria-label="Reintentar conexión con servidor"
                style={{ width: '24px', height: '24px', padding: '2px' }}
              >
                <RefreshCw size={13} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Banner de Error Visible de Cámara o WASM */}
      {engineError && (
        <div
          role="alert"
          data-testid="engine-error-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.85rem 1.15rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(239, 68, 68, 0.14)',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            color: '#FCA5A5',
            fontSize: '0.88rem',
          }}
        >
          <AlertTriangle size={20} color="#EF4444" style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ display: 'block', color: '#FECACA' }}>
              Error en el motor de visión ({engineError.code})
            </strong>
            <span>{engineError.message}</span>
          </div>
        </div>
      )}

      {/* Aviso informativo cuando se opera sin backend o sin token (No bloquea tracking) */}
      {!engineError &&
        (wsSnapshot.state === WS_STATES.FAILED || wsSnapshot.state === WS_STATES.AUTH_ERROR) && (
          <div
            role="status"
            data-testid="transport-notice-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
              padding: '0.6rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              color: 'var(--text-color)',
              fontSize: '0.82rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Info size={16} color="var(--accent-primary)" />
              <span>{wsSnapshot.detail}</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Estado WS: <code>{wsSnapshot.state}</code>
            </span>
          </div>
        )}

      {/* Main Dual Grid: Camera Feed & Output */}
      <div className="translator-grid" style={{ flex: 1 }}>
        {/* Panel 1: Camera Feed */}
        <section className="glass-panel translator-panel" aria-label="Visualizador de Cámara">
          <div className="panel-header">
            <Camera size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Captura de Cámara</h2>
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span
                data-testid="landmarks-count"
                className="chip"
                style={{
                  fontSize: '0.72rem',
                  background: 'var(--accent-primary-bg)',
                  color: 'var(--accent-primary)',
                  borderColor: 'transparent',
                }}
              >
                {landmarksCount} landmarks
              </span>
              <button
                type="button"
                onClick={() => setTrackingConfig((c) => ({ ...c, enabled: !c.enabled }))}
                className="chip"
                title="Alternar sistema de seguimiento de puntos (Ctrl+Shift+T)"
                style={{
                  cursor: 'pointer',
                  border: `1px solid ${
                    trackingConfig.enabled ? 'var(--accent-primary)' : 'var(--panel-border)'
                  }`,
                  background: trackingConfig.enabled
                    ? 'var(--accent-primary-bg)'
                    : 'var(--input-bg)',
                  color: trackingConfig.enabled ? 'var(--accent-primary)' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                <Layers size={13} />
                <span>{trackingConfig.enabled ? 'Tracker On' : 'Tracker Off'}</span>
              </button>
            </div>
          </div>

          <div className="video-container" style={{ position: 'relative' }}>
            <video
              ref={videoRef}
              style={{
                position: 'absolute',
                width: 0,
                height: 0,
                opacity: 0,
                pointerEvents: 'none',
              }}
              autoPlay
              playsInline
              muted
              controls={false}
            />

            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              style={{
                width: '100%',
                height: '100%',
                maxHeight: '480px',
                objectFit: 'contain',
                display: 'block',
              }}
              aria-label="Feed de video con landmarks de MediaPipe trazados"
            />
          </div>

          {/* Controles del Tracker */}
          {trackingConfig.enabled && (
            <div
              style={{
                marginTop: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
                padding: '0.85rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--panel-bg)',
                border: '1px solid var(--panel-border)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: 'var(--accent-primary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    <Layers size={13} />
                    Tracker de Puntos
                  </span>
                  <span
                    className="chip"
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.1rem 0.45rem',
                      background: 'var(--accent-primary-bg)',
                      color: 'var(--accent-primary)',
                      borderColor: 'transparent',
                    }}
                  >
                    {telemetry?.counts?.totalActive ?? landmarksCount} pts
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setTrackingConfig((c) => ({ ...c, showTrails: !c.showTrails }))}
                    className="btn-icon"
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: trackingConfig.showTrails
                        ? 'var(--accent-primary-bg)'
                        : 'transparent',
                      color: trackingConfig.showTrails
                        ? 'var(--accent-primary)'
                        : 'var(--text-muted)',
                      border: `1px solid ${
                        trackingConfig.showTrails ? 'var(--accent-primary)' : 'var(--border-color)'
                      }`,
                      cursor: 'pointer',
                    }}
                  >
                    <span>Estelas</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTrackingConfig((c) => ({ ...c, showLabels: !c.showLabels }))}
                    className="btn-icon"
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: trackingConfig.showLabels
                        ? 'var(--accent-primary-bg)'
                        : 'transparent',
                      color: trackingConfig.showLabels
                        ? 'var(--accent-primary)'
                        : 'var(--text-muted)',
                      border: `1px solid ${
                        trackingConfig.showLabels ? 'var(--accent-primary)' : 'var(--border-color)'
                      }`,
                      cursor: 'pointer',
                    }}
                  >
                    <span>IDs</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowTelemetryDrawer((v) => !v)}
                    className="btn-icon"
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: showTelemetryDrawer
                        ? 'var(--accent-secondary-bg)'
                        : 'transparent',
                      color: showTelemetryDrawer ? 'var(--accent-secondary)' : 'var(--text-muted)',
                      border: `1px solid ${
                        showTelemetryDrawer ? 'var(--accent-secondary)' : 'var(--border-color)'
                      }`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <BarChart2 size={12} />
                    <span>Telemetría</span>
                    {showTelemetryDrawer ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
              </div>

              {trackingConfig.colorByPart && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.35rem',
                    alignItems: 'center',
                  }}
                >
                  {COLOR_LEGEND_ITEMS.map((item) => (
                    <span
                      key={item.label}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: '0.7rem',
                        padding: '0.15rem 0.45rem',
                        borderRadius: 'var(--radius-sm)',
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-color)',
                      }}
                    >
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: item.color,
                          display: 'inline-block',
                        }}
                      />
                      <span>{item.label}</span>
                    </span>
                  ))}
                </div>
              )}

              {showTelemetryDrawer && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(0, 0, 0, 0.35)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.65rem',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    {[
                      { key: 'all', label: 'Todos' },
                      { key: 'leftHand', label: 'Mano Izq' },
                      { key: 'rightHand', label: 'Mano Der' },
                    ].map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setSelectedPartFilter(f.key)}
                        style={{
                          fontSize: '0.68rem',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '3px',
                          border: `1px solid ${
                            selectedPartFilter === f.key
                              ? 'var(--accent-primary)'
                              : 'var(--border-color)'
                          }`,
                          background:
                            selectedPartFilter === f.key
                              ? 'var(--accent-primary-bg)'
                              : 'transparent',
                          color:
                            selectedPartFilter === f.key
                              ? 'var(--accent-primary)'
                              : 'var(--text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div
                    style={{
                      maxHeight: '160px',
                      overflowY: 'auto',
                      fontSize: '0.7rem',
                      fontFamily: 'monospace',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Articulación</th>
                          <th>X</th>
                          <th>Y</th>
                          <th>Z</th>
                        </tr>
                      </thead>
                      <tbody>
                        {telemetry?.points
                          ?.filter((pt) => {
                            if (selectedPartFilter === 'leftHand') return pt.type === 'hand_Left';
                            if (selectedPartFilter === 'rightHand') return pt.type === 'hand_Right';
                            return true;
                          })
                          ?.map((pt) => (
                            <tr key={pt.key}>
                              <td style={{ color: pt.color }}>{pt.id}</td>
                              <td>{pt.name}</td>
                              <td>{pt.x.toFixed(3)}</td>
                              <td>{pt.y.toFixed(3)}</td>
                              <td>{pt.z.toFixed(3)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Panel 2: Live Translation & Finger State */}
        <section className="glass-panel translator-panel" aria-label="Resultado de Traducción">
          <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <MessageSquare size={20} color="var(--accent-secondary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Gesto Detectado</h2>
            <div
              role="group"
              aria-label="Modo de vocabulario LSM"
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                flexWrap: 'wrap',
              }}
            >
              {[
                { id: 'all', label: 'Todo' },
                { id: 'alphabet', label: 'Alfabeto' },
                { id: 'numbers', label: 'Números' },
                { id: 'legacy', label: 'Básicas' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-testid={`mode-btn-${m.id}`}
                  onClick={() => setRecognitionMode(m.id)}
                  style={{
                    fontSize: '0.72rem',
                    padding: '0.2rem 0.55rem',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${
                      recognitionMode === m.id ? 'var(--accent-primary)' : 'var(--panel-border)'
                    }`,
                    background:
                      recognitionMode === m.id ? 'var(--accent-primary-bg)' : 'var(--input-bg)',
                    color: recognitionMode === m.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                    fontWeight: recognitionMode === m.id ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {m.label}
                </button>
              ))}
              {translation && (
                <>
                  <button
                    type="button"
                    onClick={handleSpeak}
                    className="btn-icon"
                    title="Pronunciar texto en voz alta"
                    aria-label="Pronunciar traducción"
                    style={{ width: '32px', height: '32px' }}
                  >
                    <Volume2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="btn-icon"
                    title="Copiar al portapapeles"
                    aria-label="Copiar traducción al portapapeles"
                    style={{ width: '32px', height: '32px' }}
                  >
                    {copied ? <Check size={16} color="var(--success-color)" /> : <Copy size={16} />}
                  </button>
                </>
              )}
            </div>
          </div>

          <div
            className="translation-output"
            role="region"
            aria-live="polite"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '220px',
              position: 'relative',
            }}
          >
            {translation ? (
              <div style={{ textAlign: 'center', animation: 'fade-up 0.2s ease-out' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    marginBottom: '0.75rem',
                  }}
                >
                  {categoryLabel && (
                    <span
                      data-testid="detected-category"
                      className="chip"
                      style={{
                        background: 'var(--accent-primary-bg)',
                        color: 'var(--accent-primary)',
                        borderColor: 'var(--accent-primary)',
                        fontWeight: 700,
                      }}
                    >
                      Categoría: {categoryLabel}
                    </span>
                  )}
                  <span
                    data-testid="detected-confidence"
                    className="chip"
                    style={{
                      background: 'var(--success-bg)',
                      color: 'var(--success-color)',
                      borderColor: 'transparent',
                    }}
                  >
                    Confianza: {confidencePct}% ({gesture.source === 'remote' ? 'Servidor' : 'Local'})
                  </span>
                </div>
                <p
                  data-testid="detected-gesture"
                  className="translation-text"
                  style={{ margin: 0 }}
                >
                  {translation}
                </p>
                {Array.isArray(gesture.details?.aliases) && gesture.details.aliases.length > 0 && (
                  <p
                    data-testid="detected-aliases"
                    style={{
                      margin: '0.45rem 0 0 0',
                      fontSize: '0.78rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Equivalente en LSM: {gesture.details.aliases.join(', ')}
                  </p>
                )}
              </div>
            ) : isLowConfidenceRejection ? (
              <div
                style={{
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.6rem',
                }}
              >
                <span
                  data-testid="detected-category"
                  className="chip"
                  style={{
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#F59E0B',
                    borderColor: 'transparent',
                  }}
                >
                  Baja confianza ({confidencePct}%)
                </span>
                <p
                  data-testid="detected-gesture"
                  className="translation-placeholder"
                  style={{ margin: 0, color: 'var(--text-color)', fontWeight: 600 }}
                >
                  No reconocido
                </p>
                <span
                  style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', maxWidth: '300px' }}
                >
                  Ajusta la postura u orientación de tu mano frente a la cámara
                </span>
              </div>
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <Sparkles size={32} color="var(--text-subtle)" />
                <p
                  data-testid="detected-gesture"
                  className="translation-placeholder"
                  style={{ margin: 0 }}
                >
                  Esperando señas frente a la cámara...
                </p>
                <span
                  style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', maxWidth: '320px' }}
                >
                  Realiza números (0–10), letras del alfabeto LSM (A–Z, Ñ, LL, RR) o señas base
                </span>
              </div>
            )}
          </div>

          {/* Estado Geométrico de los 5 Dedos en Tiempo Real */}
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem 1rem',
              background: 'var(--panel-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--panel-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
              }}
            >
              Dedos extendidos:
            </span>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {FINGER_NAMES_ES.map((f) => {
                const isExt = Boolean(fingerStates?.[f.key]);
                return (
                  <span
                    key={f.key}
                    style={{
                      fontSize: '0.72rem',
                      padding: '0.18rem 0.55rem',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight: 600,
                      background: isExt ? 'rgba(16, 185, 129, 0.18)' : 'var(--input-bg)',
                      color: isExt ? '#10B981' : 'var(--text-muted)',
                      border: `1px solid ${isExt ? '#10B981' : 'var(--panel-border)'}`,
                    }}
                  >
                    {f.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Quick Guide Card */}
          <div
            style={{
              marginTop: '0.85rem',
              padding: '0.9rem 1rem',
              background: 'var(--panel-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--panel-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: 'var(--text-color)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Señas geométricas soportadas (Modo Demo):
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {[
                'Mano Abierta',
                'Puño / Sí',
                'Uno / No',
                'Dos / V',
                'OK / Pinza',
                'Bien (Pulgar)',
                'Te Quiero (ILY)',
                'Lunes (L)',
                'Hola (Saludo)',
              ].map((sign) => (
                <span
                  key={sign}
                  style={{
                    fontSize: '0.74rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--input-bg)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--panel-border)',
                  }}
                >
                  {sign}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Panel de Diagnóstico (Ctrl+Shift+D) */}
      {debugVisible && (
        <section
          aria-label="Panel de diagnóstico"
          style={{
            marginTop: '1rem',
            padding: '1rem 1.25rem',
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid rgba(99,255,99,0.3)',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'monospace',
            fontSize: '0.78rem',
            color: '#7fff7f',
            lineHeight: 1.6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong style={{ color: '#0f0' }}>DEBUG PANEL — Ctrl+Shift+D</strong>
            <span>
              Cámara: {fps.cameraFps} FPS | Inferencia: {fps.inferenceFps} FPS | WS:{' '}
              {wsSnapshot.state}
            </span>
          </div>
          <div>Configuración: {CONFIG.validation.summary}</div>
          <div>
            Motor: {engineStatus.state} | Backend: {engineStatus.backendInfo?.type || '—'} (
            {engineStatus.backendInfo?.delegate || '—'})
          </div>
          <div>Razón clasificador: {gesture.details?.reason || '—'}</div>
        </section>
      )}
    </div>
  );
};

export default Translator;
