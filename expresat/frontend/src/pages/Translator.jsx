import React, { Profiler, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Activity,
  MessageSquare,
  Sparkles,
  Volume2,
  VolumeX,
  Copy,
  Check,
  Trash2,
  Info,
  Layers,
  ChevronDown,
  ChevronUp,
  BarChart2,
  AlertTriangle,
  RefreshCw,
  ArrowLeftRight,
  Hand,
  Cpu,
} from 'lucide-react';
import { useSignEngine, CLASSIFIER_ENGINES } from '../ui/index.js';
import { onDevProfilerRender } from '../engine/index.js';
import {
  CONTEXT_MODES,
  CONTEXT_MODE_LIST,
  getContextModeMeta,
  getSignCatalogEntry,
} from '../recognition/index.js';
import { WS_STATES } from '../transport/index.js';
import { COLOR_LEGEND_ITEMS } from '../services/landmarkTracker.js';
import { CONFIG } from '../config.js';
import { DevRecorder } from '../components/DevRecorder.jsx';
import { DevInstrumentationPanel } from '../components/DevInstrumentationPanel.jsx';
import TextToSignPanel from '../components/TextToSignPanel.jsx';

const WS_STATE_LABELS = Object.freeze({
  [WS_STATES.IDLE]: 'Modo Demo Local',
  [WS_STATES.CONNECTING]: 'Conectando…',
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

function speakTextOffline(text, onStart, onEnd) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
    return false;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.0;
    utterance.onstart = () => onStart?.();
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    console.warn('[Translator] Error en síntesis de voz offline:', err?.message || err);
    onEnd?.();
    return false;
  }
}

const TRANSLATOR_DIRECTIONS = Object.freeze([
  Object.freeze({
    id: 'sign-to-text',
    label: 'Señas → Texto/Voz',
    shortLabel: 'Señas → Texto/Voz',
    description: 'Usa tu cámara para traducir señas LSM a texto y voz en español.',
  }),
  Object.freeze({
    id: 'text-to-sign',
    label: 'Texto/Voz → Señas',
    shortLabel: 'Texto/Voz → Señas',
    description: 'Escribe o dicta en español para ver cada seña LSM paso a paso.',
  }),
]);

function DirectionSwitcher({ direction, onChange }) {
  const handleKeyDown = useCallback(
    (e, idx) => {
      const count = TRANSLATOR_DIRECTIONS.length;
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % count;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + count) % count;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = count - 1;
      if (nextIdx !== null) {
        e.preventDefault();
        onChange(TRANSLATOR_DIRECTIONS[nextIdx].id);
      }
    },
    [onChange]
  );

  return (
    <nav
      aria-label="Dirección de traducción bidireccional"
      data-testid="translator-direction-switcher"
      className="translator-direction-bar"
    >
      <div
        role="tablist"
        aria-label="Elegir dirección de traducción"
        className="translator-direction-tabs"
      >
        {TRANSLATOR_DIRECTIONS.map((item, idx) => {
          const isSelected = direction === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              data-testid={`direction-tab-${item.id}`}
              onClick={() => onChange(item.id)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={`translator-direction-tab ${
                isSelected ? 'translator-direction-tab--active' : ''
              }`}
            >
              {item.id === 'sign-to-text' ? (
                <Hand size={16} aria-hidden="true" />
              ) : (
                <ArrowLeftRight size={16} aria-hidden="true" />
              )}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const SignToTextTranslator = ({ direction, onDirectionChange }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [copied, setCopied] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [recognitionMode, setRecognitionMode] = useState(CONTEXT_MODES.GENERAL);
  const [classifierEngine, setClassifierEngine] = useState(CLASSIFIER_ENGINES.GEOMETRIC);
  const [neuralInfoNotice, setNeuralInfoNotice] = useState(false);
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

  const autoSpeakRef = useRef(autoSpeak);
  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const handleSignCommitted = useCallback((entry) => {
    if (!autoSpeakRef.current || !entry?.speakText) return;
    speakTextOffline(
      entry.speakText,
      () => setIsSpeaking(true),
      () => setIsSpeaking(false)
    );
  }, []);

  // Modo Demo Local 100% en navegador: sin backend WS ni PoseLandmarker (máximos FPS reales).
  // DevRecorder activa PoseLandmarker bajo demanda únicamente durante grabaciones de dataset v1.4.0.
  const {
    fps,
    engineStatus,
    engineError,
    gesture,
    history,
    wsSnapshot,
    landmarksCount,
    telemetry,
    devSnapshot,
    neuralStatus,
    refreshDevSnapshot,
    reconnectTransport,
    clearGesture,
    engineRef,
  } = useSignEngine({
    videoRef,
    canvasRef,
    trackingConfig,
    classifierEngine,
    probeNeuralModel: true,
    recognitionMode,
    enableRemoteTransport: false,
    enablePose: false,
    telemetryDrawerOpen: showTelemetryDrawer,
    showDiagnosticBadges: debugVisible,
    onSignCommitted: handleSignCommitted,
  });

  const isNeuralActive =
    classifierEngine === CLASSIFIER_ENGINES.NEURAL_LOCAL && neuralStatus.available;

  const handleSelectEngine = useCallback(
    (nextEngine) => {
      if (nextEngine === CLASSIFIER_ENGINES.NEURAL_LOCAL) {
        if (!neuralStatus.available) {
          setNeuralInfoNotice(true);
          return;
        }
        setNeuralInfoNotice(false);
        setClassifierEngine(CLASSIFIER_ENGINES.NEURAL_LOCAL);
        return;
      }
      setNeuralInfoNotice(false);
      setClassifierEngine(CLASSIFIER_ENGINES.GEOMETRIC);
    },
    [neuralStatus.available]
  );

  const activeModeMeta = useMemo(() => getContextModeMeta(recognitionMode), [recognitionMode]);
  const modeSigns = activeModeMeta.signs;

  const handleModeKeyDown = useCallback(
    (e, currentIdx) => {
      const count = CONTEXT_MODE_LIST.length;
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % count;
      else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + count) % count;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = count - 1;

      if (nextIdx !== null) {
        e.preventDefault();
        setRecognitionMode(CONTEXT_MODE_LIST[nextIdx].id);
      }
    },
    []
  );

  // Cancel any active speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Keyboard shortcuts: Ctrl+Shift+D (Debug) and Ctrl+Shift+T (Tracker)
  useEffect(() => {
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

  const showDiagnostics = import.meta.env.DEV || debugVisible;

  const translation = gesture.label || '';
  const confidencePct = gesture.confidence ? Math.round(gesture.confidence * 100) : 0;
  const fingerStates = gesture.details?.states || null;
  const isWsOpen = wsSnapshot.state === WS_STATES.OPEN;
  const wsStatusLabel = WS_STATE_LABELS[wsSnapshot.state] || wsSnapshot.state;

  const sentenceDisplayText = useMemo(
    () => history.map((item) => item.label).join(' · '),
    [history]
  );

  const sentenceSpeakText = useMemo(
    () => history.map((item) => item.speakText || item.label).join(', '),
    [history]
  );

  const copyPayload = sentenceDisplayText || translation;
  const speakPayload =
    sentenceSpeakText ||
    (translation ? getSignCatalogEntry(translation)?.speakText || translation : '');

  const handleSpeakSentence = useCallback(() => {
    if (!speakPayload) return;
    speakTextOffline(
      speakPayload,
      () => setIsSpeaking(true),
      () => setIsSpeaking(false)
    );
  }, [speakPayload]);

  const handleCopy = useCallback(() => {
    if (!copyPayload || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(copyPayload)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        console.warn('[Translator] No se pudo copiar al portapapeles:', err?.message || err);
      });
  }, [copyPayload]);

  const handleClearAll = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
    clearGesture();
  }, [clearGesture]);

  const emptyStateMessage =
    gesture.state === 'detecting'
      ? 'Estabilizando seña…'
      : gesture.state === 'rejected'
        ? 'Mano en reposo o postura no reconocida'
        : 'Esperando señas frente a la cámara…';

  const confidenceBadgeStyle =
    confidencePct >= 85
      ? {
          background: 'var(--success-bg)',
          color: 'var(--success-color)',
        }
      : {
          background: 'var(--warning-bg)',
          color: 'var(--warning-color)',
        };

  const content = (
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
            {showDiagnostics ? (
              <span
                data-testid="wasm-status-badge"
                className="chip"
                style={{
                  fontSize: '0.72rem',
                  background: engineStatus.wasmReady
                    ? 'var(--success-bg)'
                    : 'var(--warning-bg)',
                  color: engineStatus.wasmReady ? 'var(--success-color)' : 'var(--warning-color)',
                  borderColor: 'transparent',
                }}
              >
                {engineStatus.wasmReady ? 'WASM Activo' : 'Cargando WASM…'}
              </span>
            ) : (
              <span
                className="chip"
                style={{
                  fontSize: '0.72rem',
                  background: engineStatus.wasmReady
                    ? 'var(--success-bg)'
                    : 'var(--warning-bg)',
                  color: engineStatus.wasmReady ? 'var(--success-color)' : 'var(--warning-color)',
                  borderColor: 'transparent',
                }}
              >
                {engineStatus.wasmReady ? 'Cámara lista' : 'Preparando cámara…'}
              </span>
            )}
          </div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Colócate frente a la cámara con las manos visibles. Traduce tus señas a texto y voz en
            español al instante, de forma privada y sin conexión.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {showDiagnostics ? (
            /* Telemetry Indicator (dev / Ctrl+Shift+D only; non-live region so 1 Hz FPS updates never spam screen readers) */
            <div
              aria-label="Métricas de rendimiento y modo de operación"
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
              {/* Camera FPS */}
              <div
                data-testid="camera-fps"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                title="Fotogramas por segundo entregados por la cámara"
              >
                <Camera size={16} color="var(--accent-primary)" />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Cámara:{' '}
                  <strong style={{ color: 'var(--text-color)', fontVariantNumeric: 'tabular-nums' }}>
                    {fps.cameraFps}
                  </strong>{' '}
                  FPS
                </span>
              </div>

              <div style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />

              {/* Real Inference FPS */}
              <div
                data-testid="inference-fps"
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                title="Detecciones reales de MediaPipe procesadas por segundo"
              >
                <Activity size={16} color="var(--accent-secondary)" />
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Inferencia:{' '}
                  <strong style={{ color: 'var(--text-color)', fontVariantNumeric: 'tabular-nums' }}>
                    {fps.inferenceFps}
                  </strong>{' '}
                  FPS
                </span>
              </div>

              <div style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />

              {/* Explicit Local / WebSocket transport status */}
              <div
                data-testid="ws-status"
                data-ws-state={wsSnapshot.state}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                title={wsSnapshot.detail}
              >
                <span
                  className={`status-dot ${
                    isWsOpen || wsSnapshot.state === WS_STATES.IDLE
                      ? 'status-dot--online'
                      : 'status-dot--offline'
                  }`}
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
          ) : (
            <div
              className="glass-panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.55rem',
                padding: '0.55rem 1.15rem',
                borderRadius: 'var(--radius-full)',
              }}
            >
              <span className="status-dot status-dot--online" aria-hidden="true" />
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-color)' }}>
                Sin conexión · 100% privado
              </span>
            </div>
          )}

          {/* Separate DEV indicator: real camera rate (rVFC) decoupled from inference loop */}
          {import.meta.env.DEV && (
            <div
              data-testid="real-camera-fps"
              className="glass-panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.5rem 0.9rem',
                borderRadius: 'var(--radius-full)',
                border: '1px solid #0284c7',
                fontSize: '0.78rem',
              }}
              title="Tasa real de frames únicos de cámara medida por requestVideoFrameCallback (desacoplada del loop de inferencia)"
            >
              <Camera size={14} color="#38bdf8" />
              <span style={{ color: 'var(--text-muted)' }}>
                Cámara real (rVFC):{' '}
                <strong style={{ color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
                  {devSnapshot?.rvfcSupported === false
                    ? 'N/A'
                    : `${devSnapshot?.live?.realCameraFps ?? 0}`}
                </strong>{' '}
                FPS
              </span>
              <span style={{ color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                · Únic: {devSnapshot?.live?.uniqueInferredFps ?? 0} · Dup:{' '}
                {devSnapshot?.live?.duplicateInferenceFps ?? 0}
              </span>
            </div>
          )}
        </div>
      </header>

      <DirectionSwitcher direction={direction} onChange={onDirectionChange} />

      {/* Camera or WASM engine error banner */}
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
            background: 'var(--error-bg)',
            border: '1px solid var(--error-color)',
            color: 'var(--text-color)',
            fontSize: '0.88rem',
          }}
        >
          <AlertTriangle size={20} color="var(--error-color)" style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ display: 'block', color: 'var(--text-color)' }}>
              No pudimos iniciar la cámara{showDiagnostics ? ` (${engineError.code})` : ''}
            </strong>
            <span>{engineError.message}</span>
          </div>
        </div>
      )}

      {/* Info banner when remote transport is configured but unavailable */}
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
              background: 'var(--info-bg)',
              border: '1px solid var(--accent-primary-border)',
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

      {/* Context Mode Selector (hot-switches classifier without restarting camera or clearing sentence) */}
      <section
        aria-label="Modo de traducción en LSM"
        className="glass-panel--static translator-mode-bar"
        data-testid="translator-mode-selector"
      >
        <div className="translator-mode-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 700,
                color: 'var(--text-color)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Modo de contexto
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {activeModeMeta.description}
              {history.length > 0 ? ' · Tu oración acumulada se conserva al cambiar.' : ''}
            </span>
          </div>

          <div
            role="tablist"
            aria-label="Seleccionar modo de reconocimiento de señas"
            className="translator-mode-tabs"
          >
            {CONTEXT_MODE_LIST.map((modeItem, idx) => {
              const isSelected = recognitionMode === modeItem.id;
              return (
                <button
                  key={modeItem.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  data-testid={`mode-tab-${modeItem.id}`}
                  className={`translator-mode-tab ${
                    isSelected ? 'translator-mode-tab--active' : ''
                  }`}
                  onClick={() => setRecognitionMode(modeItem.id)}
                  onKeyDown={(e) => handleModeKeyDown(e, idx)}
                >
                  <span>{modeItem.title}</span>
                  <span className="translator-mode-tab__count">{modeItem.signs.length}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Discreet Local Engine Selector: Geometric (default) vs Neural Local (in-browser) */}
        <div
          data-testid="classifier-engine-selector"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
            paddingTop: '0.55rem',
            borderTop: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <Cpu size={14} color="var(--text-muted)" aria-hidden="true" />
            <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Motor local:
            </span>
            <div
              role="group"
              aria-label="Seleccionar motor de reconocimiento local"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}
            >
              <button
                type="button"
                data-testid="engine-btn-geometric"
                aria-pressed={!isNeuralActive}
                onClick={() => handleSelectEngine(CLASSIFIER_ENGINES.GEOMETRIC)}
                className={`learn-filter-pill ${!isNeuralActive ? 'learn-filter-pill--active' : ''}`}
                style={{ padding: '0.24rem 0.68rem', fontSize: '0.75rem' }}
              >
                Geométrico
              </button>

              <button
                type="button"
                data-testid="engine-btn-neural"
                aria-pressed={isNeuralActive}
                aria-disabled={!neuralStatus.available}
                onClick={() => handleSelectEngine(CLASSIFIER_ENGINES.NEURAL_LOCAL)}
                className={`learn-filter-pill ${isNeuralActive ? 'learn-filter-pill--active' : ''}`}
                style={{
                  padding: '0.24rem 0.68rem',
                  fontSize: '0.75rem',
                  opacity: neuralStatus.available ? 1 : 0.78,
                }}
                title={
                  neuralStatus.available
                    ? 'Activar inferencia neuronal local 100% en navegador'
                    : 'Modelo neuronal en preparación'
                }
              >
                <span>IA Neuronal (Local)</span>
                {!neuralStatus.available && neuralStatus.status !== 'checking' && (
                  <span
                    data-testid="neural-status-badge"
                    style={{
                      fontSize: '0.68rem',
                      opacity: 0.85,
                      fontWeight: 500,
                    }}
                  >
                    · Modelo neuronal en preparación
                  </span>
                )}
              </button>
            </div>
          </div>

          {(isNeuralActive || neuralInfoNotice) && (
            <span
              role="status"
              aria-live="polite"
              style={{
                fontSize: '0.75rem',
                color: isNeuralActive ? 'var(--success-color)' : 'var(--text-muted)',
                fontWeight: 500,
              }}
            >
              {isNeuralActive
                ? neuralStatus.status === 'loading'
                  ? 'Cargando IA Neuronal local…'
                  : 'IA Neuronal activa · 100% en navegador'
                : 'Modelo neuronal en preparación. El modo Geométrico continúa activo sin conexión.'}
            </span>
          )}
        </div>
      </section>

      {/* Main Dual Grid: Camera Feed & Output */}
      <div className="translator-grid" style={{ flex: 1 }}>
        {/* Panel 1: Camera Feed */}
        <section className="glass-panel translator-panel" aria-label="Visualizador de Cámara">
          <div className="panel-header">
            <Camera size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Tu Cámara</h2>
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {showDiagnostics && (
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
              )}
              <button
                type="button"
                onClick={() => setTrackingConfig((c) => ({ ...c, enabled: !c.enabled }))}
                className="chip"
                title="Mostrar u ocultar guía visual sobre tus manos"
                aria-pressed={trackingConfig.enabled}
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
                <span>{trackingConfig.enabled ? 'Guía visual' : 'Sin guía'}</span>
              </button>
            </div>
          </div>

          {import.meta.env.DEV ? (
            <>
              <Profiler id="dev_recorder" onRender={onDevProfilerRender}>
                <DevRecorder engineRef={engineRef} videoRef={videoRef} />
              </Profiler>
              <DevInstrumentationPanel
                engineRef={engineRef}
                devSnapshot={devSnapshot}
                onRefreshSnapshot={refreshDevSnapshot}
              />
            </>
          ) : null}

          <div className="video-container" style={{ position: 'relative' }}>
            <video
              ref={videoRef}
              aria-label="Vista previa de cámara para detección de señas"
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
              aria-label="Vista de cámara en vivo con guía visual de manos"
            />
          </div>

          {/* Tracker diagnostic controls (visible only in dev / Ctrl+Shift+D) */}
          {showDiagnostics && trackingConfig.enabled && (
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
                  {COLOR_LEGEND_ITEMS.filter((item) => item.group === 'Mano').map((item) => (
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

        {/* Panel 2: Live Translation, Sentence History, Offline TTS & Unified Guide */}
        <section className="glass-panel translator-panel" aria-label="Resultado de Traducción">
          <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <MessageSquare size={20} color="var(--accent-secondary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Seña Detectada</h2>
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                data-testid="auto-speak-toggle"
                onClick={() => setAutoSpeak((v) => !v)}
                disabled={!ttsSupported}
                aria-pressed={autoSpeak}
                className="chip"
                title={
                  ttsSupported
                    ? 'Activar o desactivar lectura automática en voz alta al confirmar cada seña'
                    : 'Lectura en voz alta no disponible en este navegador'
                }
                style={{
                  cursor: ttsSupported ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.73rem',
                  fontWeight: 600,
                  background: autoSpeak ? 'var(--accent-secondary-bg)' : 'var(--input-bg)',
                  color: autoSpeak ? 'var(--accent-secondary)' : 'var(--text-muted)',
                  border: `1px solid ${
                    autoSpeak ? 'var(--accent-secondary)' : 'var(--panel-border)'
                  }`,
                }}
              >
                {autoSpeak ? <Volume2 size={13} /> : <VolumeX size={13} />}
                <span>Voz automática: {autoSpeak ? 'Sí' : 'No'}</span>
              </button>

              <button
                type="button"
                data-testid="speak-sentence-btn"
                onClick={handleSpeakSentence}
                disabled={!ttsSupported || !speakPayload}
                className="btn-icon"
                title="Leer oración en voz alta"
                aria-label="Leer oración en voz alta"
                style={{
                  padding: '0.28rem 0.65rem',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-sm)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  cursor: ttsSupported && speakPayload ? 'pointer' : 'not-allowed',
                  opacity: ttsSupported && speakPayload ? 1 : 0.5,
                  border: `1px solid ${isSpeaking ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  background: isSpeaking ? 'var(--accent-primary-bg)' : 'var(--input-bg)',
                  color: isSpeaking ? 'var(--accent-primary)' : 'var(--text-color)',
                }}
              >
                <Volume2 size={14} />
                <span>Leer oración</span>
              </button>

              <button
                type="button"
                data-testid="copy-translation-btn"
                onClick={handleCopy}
                disabled={!copyPayload}
                className="btn-icon"
                title="Copiar al portapapeles"
                aria-label="Copiar traducción al portapapeles"
                style={{
                  width: '30px',
                  height: '30px',
                  opacity: copyPayload ? 1 : 0.45,
                  cursor: copyPayload ? 'pointer' : 'not-allowed',
                }}
              >
                {copied ? <Check size={15} color="var(--success-color)" /> : <Copy size={15} />}
              </button>

              <button
                type="button"
                data-testid="clear-translation-btn"
                onClick={handleClearAll}
                disabled={!translation && history.length === 0}
                className="btn-icon"
                title="Limpiar gesto actual e historial"
                aria-label="Limpiar oración e historial"
                style={{
                  padding: '0.28rem 0.6rem',
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-sm)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  opacity: translation || history.length > 0 ? 1 : 0.45,
                  cursor: translation || history.length > 0 ? 'pointer' : 'not-allowed',
                  border: '1px solid var(--border-color)',
                  background: 'var(--input-bg)',
                  color: 'var(--text-color)',
                }}
              >
                <Trash2 size={13} />
                <span>Limpiar</span>
              </button>
            </div>
          </div>

          {/* Active Sign Card (auto-expires cleanly to idle/rejected when hand drops or rests) */}
          <div
            className="translation-output"
            data-gesture-state={gesture.state}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '170px',
              position: 'relative',
            }}
          >
            {translation ? (
              <div style={{ textAlign: 'center', animation: 'fade-up 0.2s ease-out' }}>
                <span
                  data-testid="gesture-confidence-badge"
                  className="chip"
                  style={{
                    marginBottom: '0.65rem',
                    borderColor: 'transparent',
                    ...confidenceBadgeStyle,
                  }}
                >
                  Precisión: {confidencePct}%
                  {showDiagnostics
                    ? ` (${
                        gesture.source === 'remote'
                          ? 'Servidor'
                          : gesture.source === 'neural-local'
                            ? 'IA Neuronal'
                            : 'Local'
                      })`
                    : ''}
                </span>
                <p
                  data-testid="detected-gesture"
                  className="translation-text"
                  style={{ margin: 0 }}
                >
                  {translation}
                </p>
              </div>
            ) : (
              <div
                style={{
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.65rem',
                }}
              >
                <Sparkles
                  size={28}
                  color={
                    gesture.state === 'detecting' ? 'var(--accent-primary)' : 'var(--text-subtle)'
                  }
                />
                <p
                  data-testid="detected-gesture"
                  className="translation-placeholder"
                  style={{ margin: 0 }}
                >
                  {emptyStateMessage}
                </p>
                {gesture.state === 'detecting' && gesture.details?.stabilityProgress > 0 && (
                  <div
                    aria-hidden="true"
                    style={{
                      width: '140px',
                      height: '4px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--border-color)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round(gesture.details.stabilityProgress * 100)}%`,
                        height: '100%',
                        background: 'var(--accent-primary)',
                        transition: 'width 80ms linear',
                      }}
                    />
                  </div>
                )}
                <span
                  style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', maxWidth: '320px' }}
                >
                  Mantén cada seña firme ~0.3 s para agregarla a la oración.
                </span>
              </div>
            )}
          </div>

          {/* Accumulated Sentence / History Box (WCAG 2.2 AA polite incremental announcements) */}
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.85rem 1rem',
              background: 'var(--panel-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--panel-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Oración acumulada ({history.length})
              </span>
              {!ttsSupported && (
                <span style={{ fontSize: '0.7rem', color: 'var(--warning-color)' }}>
                  Lectura en voz alta no disponible en este navegador
                </span>
              )}
            </div>
            <div
              data-testid="sentence-history"
              role="status"
              aria-live="polite"
              aria-atomic="false"
              style={{
                minHeight: '44px',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.92rem',
                color: 'var(--text-color)',
              }}
            >
              {history.length > 0 ? (
                history.map((item) => (
                  <span
                    key={item.id}
                    className="chip"
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      background: 'var(--accent-primary-bg)',
                      color: 'var(--text-color)',
                      border: '1px solid var(--accent-primary-border)',
                    }}
                  >
                    {item.label}
                  </span>
                ))
              ) : (
                <span style={{ fontSize: '0.82rem', color: 'var(--text-subtle)' }}>
                  Las señas confirmadas aparecerán aquí formando tu oración…
                </span>
              )}
            </div>
          </div>

          {/* Live geometric finger state */}
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
                      background: isExt ? 'var(--success-bg)' : 'var(--input-bg)',
                      color: isExt ? 'var(--success-color)' : 'var(--text-muted)',
                      border: `1px solid ${isExt ? 'var(--success-color)' : 'var(--panel-border)'}`,
                    }}
                  >
                    {f.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Dynamic Quick Guide Card synchronized with active recognition mode */}
          <div
            data-testid="sign-catalog-guide"
            data-mode={recognitionMode}
            style={{
              marginTop: '0.85rem',
              padding: '0.9rem 1rem',
              background: 'var(--panel-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--panel-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
                flexWrap: 'wrap',
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
                Guía rápida · {activeModeMeta.title} ({modeSigns.length} señas)
              </span>
              {modeSigns.some((s) => s.type === 'dynamic') && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Las marcas con «Mov.» requieren movimiento
                </span>
              )}
            </div>
            <div
              className={`translator-guide-list ${
                modeSigns.length > 20 ? 'translator-guide-list--scrollable' : ''
              }`}
            >
              {modeSigns.map((sign) => {
                const isActive = translation === sign.label;
                const displayBadge =
                  recognitionMode === CONTEXT_MODES.ALPHABET && sign.shortLabel
                    ? sign.shortLabel
                    : sign.label;
                return (
                  <span
                    key={sign.id}
                    title={`${sign.displayName || sign.label}: ${sign.hint}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.28rem',
                      fontSize:
                        recognitionMode === CONTEXT_MODES.ALPHABET ? '0.8rem' : '0.74rem',
                      padding:
                        recognitionMode === CONTEXT_MODES.ALPHABET
                          ? '0.24rem 0.65rem'
                          : '0.2rem 0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      fontWeight:
                        isActive || recognitionMode === CONTEXT_MODES.ALPHABET ? 700 : 500,
                      background: isActive ? 'var(--success-bg)' : 'var(--input-bg)',
                      color: isActive ? 'var(--success-color)' : 'var(--text-color)',
                      border: `1px solid ${
                        isActive ? 'var(--success-color)' : 'var(--panel-border)'
                      }`,
                    }}
                  >
                    <span>{displayBadge}</span>
                    {sign.type === 'dynamic' && (
                      <span
                        style={{
                          fontSize: '0.62rem',
                          fontWeight: 600,
                          opacity: 0.78,
                        }}
                      >
                        · Mov.
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Diagnostic panel (Ctrl+Shift+D) */}
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
            {engineStatus.backendInfo?.delegate || '—'}) | Pose:{' '}
            {String(Boolean(engineStatus.backendInfo?.poseEnabled))}
          </div>
          <div>
            Modo: {recognitionMode} | Clasificador: {isNeuralActive ? 'neural-local' : 'geometric'} (
            {neuralStatus.status}
            {neuralStatus.reason ? `/${neuralStatus.reason}` : ''}) | Estado: {gesture.state} |
            Mano: {gesture.details?.handId || '—'} | Raw: {gesture.details?.rawLabel || '—'} |
            Razón: {gesture.details?.reason || '—'}
          </div>
        </section>
      )}
    </div>
  );

  return import.meta.env.DEV ? (
    <Profiler id="translator" onRender={onDevProfilerRender}>
      {content}
    </Profiler>
  ) : (
    content
  );
};

const Translator = () => {
  const [direction, setDirection] = useState('sign-to-text');

  if (direction === 'text-to-sign') {
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
                Bidireccional
              </span>
            </div>
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Escribe o dicta una frase en español para ver la secuencia paso a paso en Lengua de
              Señas Mexicana, con deletreo automático y 100% sin conexión.
            </p>
          </div>

          <div
            className="glass-panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.55rem',
              padding: '0.55rem 1.15rem',
              borderRadius: 'var(--radius-full)',
            }}
          >
            <span className="status-dot status-dot--online" aria-hidden="true" />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-color)' }}>
              Sin conexión · 100% privado
            </span>
          </div>
        </header>

        <DirectionSwitcher direction={direction} onChange={setDirection} />
        <TextToSignPanel />
      </div>
    );
  }

  return <SignToTextTranslator direction={direction} onDirectionChange={setDirection} />;
};

export default Translator;
