import React, { useRef, useState } from 'react';
import {
  Camera, Activity, MessageSquare, Sparkles, Volume2, Copy, Check, Info,
  Layers, ChevronDown, ChevronUp, BarChart2
} from 'lucide-react';
import { ApiService } from '../services/apiService';
import { useMediaPipe } from '../hooks/useMediaPipe';
import { COLOR_LEGEND_ITEMS } from '../services/landmarkTracker';

const Translator = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const apiRef = useRef(null);

  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState('Desconectado');
  const [statusClass, setStatusClass] = useState('status-offline');
  const [fps, setFps] = useState(0);
  const [copied, setCopied] = useState(false);
  // H5: Use authenticated token if session exists, degrade to development token with warning
  const [usingDemoToken, setUsingDemoToken] = useState(false);
  const [_authWarning, setAuthWarning] = useState(false);
  // [DEBUG] Panel de diagnóstico oculto — activar con Ctrl+Shift+D
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugData, setDebugData] = useState(null);

  // [SEGUIMIENTO EXPERIMENTAL] Estado del sistema de seguimiento de puntos MediaPipe
  const [trackingConfig, setTrackingConfig] = useState({
    enabled: true,         // Activo por defecto para experimentación y testeo
    showTrails: true,      // Estelas temporales de movimiento
    showLabels: false,     // IDs numéricos sobre cada landmark
    showHalos: true,       // Halos en articulaciones clave y puntas de dedos
    colorByPart: true,     // Separación de cada parte en colores vivos
    trailLength: 8,        // Longitud de frames de la estela
  });
  const [telemetry, setTelemetry] = useState(null);
  const [showTelemetryDrawer, setShowTelemetryDrawer] = useState(false);
  const [selectedPartFilter, setSelectedPartFilter] = useState('all');

  // [DEBUG & TRACKER] Atajos de teclado:
  //   Ctrl+Shift+D: Panel de diagnóstico backend
  //   Ctrl+Shift+T: Alternar modo seguimiento de puntos MediaPipe
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

  // [DEMO] Sincronizar estado inicial de DEMO_MODE consultando /health
  React.useEffect(() => {
    const isLocalHost = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const defaultEnv = isLocalHost ? 'Local' : 'Cloud';
    const env = localStorage.getItem('apiEnv') || defaultEnv;
    const baseUrl = env === 'Local'
      ? (import.meta.env.VITE_WS_URL_LOCAL || 'http://127.0.0.1:8000')
      : (import.meta.env.VITE_WS_URL_PROD || 'https://api.expresat.cloud');

    const httpUrl = baseUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    try {
      const origin = new URL(httpUrl).origin;
      fetch(`${origin}/health`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.demo_mode !== undefined) {
            setIsDemo(Boolean(data.demo_mode));
          }
        })
        .catch(() => {
          // Si falla el health check inicial, se mantiene el valor por defecto
        });
    } catch {
      // URL inválida, ignorar
    }
  }, []);

  // Initialize ApiService once (stable ref — no re-renders)
  if (!apiRef.current) {
    const isLocalHost = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const defaultEnv = isLocalHost ? 'Local' : 'Cloud';
    const env = localStorage.getItem('apiEnv') || defaultEnv;
    const wsUrl = env === 'Local'
      ? (import.meta.env.VITE_WS_URL_LOCAL || 'ws://127.0.0.1:8000/ws')
      : (import.meta.env.VITE_WS_URL_PROD || 'wss://api.expresat.cloud/ws');

    const api = new ApiService(wsUrl);
    
    // H5: Determinar token de autenticación - usar token real si hay sesión,
    //     degradar a demo con aviso visual en lugar de 'mock_token' ciego
    let authToken = null;
    
    // Intentar obtener token de sesión (simulación - en producción vendría de auth state)
    const storedToken = localStorage.getItem('supabaseToken');
    if (storedToken && storedToken !== 'mock_token') {
      authToken = storedToken;
      setUsingDemoToken(false);
      setAuthWarning(false);
    } else {
      // Modo demo con aviso visual
      authToken = 'demo_fallback_token';
      setUsingDemoToken(true);
      setAuthWarning(true);
    }
    
    api.connect(authToken);
    api.onStatusChange((text, className) => {
      setStatus(text);
      setStatusClass(className);
    });
    // [DEMO] Manejo de mensajes entrantes con soporte para bandera is_demo
    api.onMessage((msg) => {
      // M10: Validar estructura del mensaje entrante - advertir si es desconocida
      if (!msg || typeof msg !== 'object') {
        console.warn('[Translator] Mensaje entrante inválido: estructura inesperada', msg);
        return;
      }

      // msg ya es data.payload (desenvuelto por apiService.js)
      const label = msg?.label || (typeof msg === 'string' ? msg : null);
      if (label) {
        setTranslation(label);
      } else {
        // M10: Advertir si el mensaje no tiene estructura reconocida
        console.warn('[Translator] Mensaje sin label reconocido:', msg);
      }

      // [DEMO] Detectar si la respuesta viene del motor de demo
      if (msg?.is_demo !== undefined) {
        setIsDemo(Boolean(msg.is_demo));
      }

      // [DEBUG] Capturar telemetría de diagnóstico por frame
      if (msg?.debug) {
        setDebugData(msg.debug);
      }
    });

    apiRef.current = api;
  }

  // Off-main-thread MediaPipe + EMA filter + canvas drawing + tracking
  useMediaPipe(
    videoRef,
    canvasRef,
    (landmarks) => apiRef.current?.sendLandmarks(landmarks), // throttled 2/sec
    (currentFps) => setFps(currentFps),                      // called 1/sec
    {
      alpha: 0.45,
      targetFPS: 15,
      sendInterval: 500,
      trackingConfig,
      onTelemetry: setTelemetry
    }
  );

  // Helper de accesibilidad: lectura por voz si el navegador lo soporta
  const handleSpeak = () => {
    if ('speechSynthesis' in window && translation) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(translation);
      utterance.lang = 'es-MX';
      window.speechSynthesis.speak(utterance);
    }
  };

  // Helper para copiar al portapapeles
  const handleCopy = () => {
    if (translation) {
      navigator.clipboard.writeText(translation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isConnected = statusClass.includes('online');

  return (
    <div className="container animate-fade-in" style={{ padding: '2rem 1.5rem 4rem 1.5rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Top Header & Status Bar */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h1 className="gradient-text" style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', margin: 0 }}>
              Traductor LSM
            </h1>
            <span className="chip" style={{ fontSize: '0.75rem' }}>En Vivo</span>
            {/* [DEMO] Indicador visual superior de MODO DEMO — oculto al usuario (Tarea 3) */}
          </div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Posiciónate frente a la cámara con las manos visibles y buena iluminación.
          </p>
          {usingDemoToken && (
            <span style={{
              marginLeft: '1rem',
              fontSize: '0.75rem',
              color: 'var(--accent-warning, #f5a623)',
              background: 'var(--accent-warning-bg, #fff3e0)',
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--accent-warning, #f5a623)'
            }}>
              Modo demo activo — funcionalidad limitada
            </span>
          )}
        </div>

        {/* Telemetry Indicator (WCAG aria-live="polite") */}
        <div
          role="status"
          aria-live="polite"
          className="glass-panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.25rem',
            padding: '0.6rem 1.25rem',
            borderRadius: 'var(--radius-full)'
          }}
        >
          {/* FPS Counter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={17} color="var(--accent-primary)" />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              FPS: <strong style={{ color: 'var(--text-color)', fontFamily: 'monospace' }}>{fps}</strong>
            </span>
          </div>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-color)' }}></div>

          {/* WebSocket Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              className={`status-dot ${isConnected ? 'status-dot--online' : 'status-dot--offline'}`}
              aria-hidden="true"
            />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-color)' }}>
              {status}
            </span>
          </div>
        </div>
      </header>

      {/* Main Dual Grid: Camera Feed & Output */}
      <div className="translator-grid" style={{ flex: 1 }}>
        {/* Panel 1: Camera Feed */}
        <section className="glass-panel translator-panel" aria-label="Visualizador de Cámara">
          <div className="panel-header">
            <Camera size={20} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Captura de Cámara</h2>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setTrackingConfig(c => ({ ...c, enabled: !c.enabled }))}
                className="chip"
                title="Alternar sistema experimental de seguimiento de puntos (Ctrl+Shift+T)"
                style={{
                  cursor: 'pointer',
                  border: `1px solid ${trackingConfig.enabled ? 'var(--accent-primary)' : 'var(--panel-border)'}`,
                  background: trackingConfig.enabled ? 'var(--accent-primary-bg)' : 'var(--input-bg)',
                  color: trackingConfig.enabled ? 'var(--accent-primary)' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  transition: 'all 0.2s ease'
                }}
              >
                <Layers size={13} />
                <span>{trackingConfig.enabled ? 'Tracker On' : 'Tracker Off'}</span>
              </button>
              <span className={`badge ${isConnected ? 'badge--success' : 'badge--info'}`}>
                {isConnected ? 'Stream Activo' : 'Esperando'}
              </span>
            </div>
          </div>

          <div className="video-container" style={{ position: 'relative' }}>
            {/* video feeds the canvas — MUST NOT use display:none on mobile     */}
            {/* (WebKit won't decode frames if the element is display:none).      */}
            {/* autoPlay + playsInline + muted + controls={false} are all required */}
            {/* for video.play() to resolve without a user gesture on iOS/Android. */}
            <video
              ref={videoRef}
              style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
              autoPlay
              playsInline
              muted
              controls={false}
            />

            {/* Canvas for landmark drawing & video stream */}
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              style={{
                width: '100%',
                height: '100%',
                maxHeight: '480px',
                objectFit: 'contain',
                display: 'block'
              }}
              aria-label="Feed de video con landmarks de MediaPipe trazados"
            />

            {/* Visual Alignment Guides (Overlay sutil para centrar al usuario) */}
            <div
              style={{
                position: 'absolute',
                inset: '20px',
                border: '1px dashed rgba(255, 255, 255, 0.15)',
                borderRadius: 'var(--radius-md)',
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '10px'
              }}
              aria-hidden="true"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ width: '12px', height: '12px', borderLeft: '2px solid var(--accent-primary)', borderTop: '2px solid var(--accent-primary)' }} />
                <span style={{ width: '12px', height: '12px', borderRight: '2px solid var(--accent-primary)', borderTop: '2px solid var(--accent-primary)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ width: '12px', height: '12px', borderLeft: '2px solid var(--accent-primary)', borderBottom: '2px solid var(--accent-primary)' }} />
                <span style={{ width: '12px', height: '12px', borderRight: '2px solid var(--accent-primary)', borderBottom: '2px solid var(--accent-primary)' }} />
              </div>
            </div>
          </div>

          {/* [SEGUIMIENTO EXPERIMENTAL] Barra de Controles y Guía de Colores */}
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
                border: '1px solid var(--panel-border)'
              }}
            >
              {/* Barra superior de herramientas del rastreador */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
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
                      gap: '0.3rem'
                    }}
                  >
                    <Layers size={13} />
                    Tracker de Puntos [Test]
                  </span>
                  <span
                    className="chip"
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.1rem 0.45rem',
                      background: 'var(--accent-primary-bg)',
                      color: 'var(--accent-primary)',
                      borderColor: 'transparent'
                    }}
                  >
                    {telemetry?.counts?.totalActive ?? 0} pts
                  </span>
                </div>

                {/* Sub-toggles visuales */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setTrackingConfig(c => ({ ...c, showTrails: !c.showTrails }))}
                    className="btn-icon"
                    title={trackingConfig.showTrails ? "Ocultar estelas de movimiento" : "Mostrar estelas de movimiento"}
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: trackingConfig.showTrails ? 'var(--accent-primary-bg)' : 'transparent',
                      color: trackingConfig.showTrails ? 'var(--accent-primary)' : 'var(--text-muted)',
                      border: `1px solid ${trackingConfig.showTrails ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    <span>🌊 Estelas</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTrackingConfig(c => ({ ...c, showLabels: !c.showLabels }))}
                    className="btn-icon"
                    title={trackingConfig.showLabels ? "Ocultar números de ID" : "Mostrar números de ID"}
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: trackingConfig.showLabels ? 'var(--accent-primary-bg)' : 'transparent',
                      color: trackingConfig.showLabels ? 'var(--accent-primary)' : 'var(--text-muted)',
                      border: `1px solid ${trackingConfig.showLabels ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    <span>🔢 IDs</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTrackingConfig(c => ({ ...c, showHalos: !c.showHalos }))}
                    className="btn-icon"
                    title={trackingConfig.showHalos ? "Ocultar halos en articulaciones" : "Mostrar halos en articulaciones"}
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: trackingConfig.showHalos ? 'var(--accent-primary-bg)' : 'transparent',
                      color: trackingConfig.showHalos ? 'var(--accent-primary)' : 'var(--text-muted)',
                      border: `1px solid ${trackingConfig.showHalos ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    <span>🎯 Halos</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTrackingConfig(c => ({ ...c, colorByPart: !c.colorByPart }))}
                    className="btn-icon"
                    title={trackingConfig.colorByPart ? "Paleta monocromática" : "Paleta de colores por parte"}
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: trackingConfig.colorByPart ? 'var(--accent-primary-bg)' : 'transparent',
                      color: trackingConfig.colorByPart ? 'var(--accent-primary)' : 'var(--text-muted)',
                      border: `1px solid ${trackingConfig.colorByPart ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    <span>🎨 Partes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowTelemetryDrawer(v => !v)}
                    className="btn-icon"
                    title="Inspeccionar telemetría 3D de cada punto"
                    style={{
                      padding: '0.25rem 0.55rem',
                      fontSize: '0.72rem',
                      borderRadius: 'var(--radius-sm)',
                      background: showTelemetryDrawer ? 'var(--accent-secondary-bg)' : 'transparent',
                      color: showTelemetryDrawer ? 'var(--accent-secondary)' : 'var(--text-muted)',
                      border: `1px solid ${showTelemetryDrawer ? 'var(--accent-secondary)' : 'var(--border-color)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    <BarChart2 size={12} />
                    <span>Telemetría</span>
                    {showTelemetryDrawer ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
              </div>

              {/* Guía visual de Colores por Parte Anatómica */}
              {trackingConfig.colorByPart && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: '0.2rem' }}>
                    Partes:
                  </span>
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
                        color: 'var(--text-color)'
                      }}
                    >
                      <span
                        style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: item.color,
                          display: 'inline-block'
                        }}
                      />
                      <span>{item.label}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Panel Desplegable de Telemetría 3D e Inspección de Puntos */}
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
                    gap: '0.65rem'
                  }}
                >
                  {/* Resumen de contadores */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.4rem' }}>
                    <div style={{ padding: '0.4rem', borderRadius: '4px', background: 'var(--input-bg)', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Pose (Upper)</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#06B6D4' }}>
                        {telemetry?.counts?.pose ?? 0} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/ 33</span>
                      </div>
                    </div>
                    <div style={{ padding: '0.4rem', borderRadius: '4px', background: 'var(--input-bg)', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Mano Izquierda</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#EC4899' }}>
                        {telemetry?.counts?.leftHand ?? 0} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/ 21</span>
                      </div>
                    </div>
                    <div style={{ padding: '0.4rem', borderRadius: '4px', background: 'var(--input-bg)', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Mano Derecha</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#D946EF' }}>
                        {telemetry?.counts?.rightHand ?? 0} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/ 21</span>
                      </div>
                    </div>
                    <div style={{ padding: '0.4rem', borderRadius: '4px', background: 'var(--input-bg)', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Normalización Hom.</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-color)', fontFamily: 'monospace' }}>
                        {telemetry?.normalization ? `D=${telemetry.normalization.shoulderWidth}` : 'Esperando...'}
                      </div>
                    </div>
                  </div>

                  {/* Filtros de articulación */}
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.2rem' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Filtrar:</span>
                    {[
                      { key: 'all', label: 'Todos' },
                      { key: 'leftHand', label: 'Mano Izq' },
                      { key: 'rightHand', label: 'Mano Der' },
                      { key: 'pose', label: 'Pose' }
                    ].map(f => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setSelectedPartFilter(f.key)}
                        style={{
                          fontSize: '0.68rem',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '3px',
                          border: `1px solid ${selectedPartFilter === f.key ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          background: selectedPartFilter === f.key ? 'var(--accent-primary-bg)' : 'transparent',
                          color: selectedPartFilter === f.key ? 'var(--accent-primary)' : 'var(--text-muted)',
                          cursor: 'pointer'
                        }}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Tabla de Coordenadas 3D en tiempo real */}
                  <div
                    style={{
                      maxHeight: '180px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontFamily: 'monospace'
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'rgba(15, 23, 42, 0.95)', color: 'var(--text-muted)' }}>
                        <tr>
                          <th style={{ padding: '0.3rem 0.5rem' }}>#</th>
                          <th style={{ padding: '0.3rem 0.5rem' }}>Articulación</th>
                          <th style={{ padding: '0.3rem 0.5rem' }}>Parte</th>
                          <th style={{ padding: '0.3rem 0.5rem' }}>X</th>
                          <th style={{ padding: '0.3rem 0.5rem' }}>Y</th>
                          <th style={{ padding: '0.3rem 0.5rem' }}>Z</th>
                          <th style={{ padding: '0.3rem 0.5rem' }}>Velocidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {telemetry?.points
                          ?.filter(pt => {
                            if (selectedPartFilter === 'leftHand') return pt.type === 'hand_Left';
                            if (selectedPartFilter === 'rightHand') return pt.type === 'hand_Right';
                            if (selectedPartFilter === 'pose') return pt.type === 'pose';
                            return true;
                          })
                          ?.map(pt => (
                            <tr key={pt.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '0.25rem 0.5rem', color: pt.color }}>{pt.id}</td>
                              <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-color)' }}>{pt.name}</td>
                              <td style={{ padding: '0.25rem 0.5rem' }}>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '0.05rem 0.35rem',
                                    borderRadius: '3px',
                                    fontSize: '0.65rem',
                                    background: `${pt.color}22`,
                                    color: pt.color
                                  }}
                                >
                                  {pt.part}
                                </span>
                              </td>
                              <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-muted)' }}>{pt.x.toFixed(3)}</td>
                              <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-muted)' }}>{pt.y.toFixed(3)}</td>
                              <td style={{ padding: '0.25rem 0.5rem', color: 'var(--text-muted)' }}>{pt.z.toFixed(3)}</td>
                              <td style={{ padding: '0.25rem 0.5rem', color: pt.speed > 100 ? '#10B981' : 'var(--text-muted)' }}>
                                {pt.speed} px/s
                              </td>
                            </tr>
                          ))}
                        {(!telemetry?.points || telemetry.points.length === 0) && (
                          <tr>
                            <td colSpan={7} style={{ padding: '0.8rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                              Esperando detección de landmarks en cámara...
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <Info size={14} color="var(--accent-primary)" />
            <span>Tracking facial, postural y de 21 articulaciones por mano en 3D</span>
          </div>
        </section>

        {/* Panel 2: Live Translation Box */}
        <section className="glass-panel translator-panel" aria-label="Resultado de Traducción">
          <div className="panel-header">
            <MessageSquare size={20} color="var(--accent-secondary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Traducción Detectada</h2>
            {translation && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
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
              </div>
            )}
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
              minHeight: '260px',
              position: 'relative'
            }}
          >
            {translation ? (
              <div style={{ textAlign: 'center', animation: 'fade-up 0.2s ease-out' }}>
                {/* [DEMO] Distintivo de modo demo vs modelo final — oculto al usuario (Tarea 3) */}
                {!isDemo && (
                  <span className="chip" style={{ marginBottom: '1rem', background: 'var(--success-bg)', color: 'var(--success-color)', borderColor: 'transparent' }}>
                    Reconocimiento Confiable
                  </span>
                )}
                <p className="translation-text" style={{ margin: 0 }}>
                  {translation}
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <Sparkles size={32} color="var(--text-subtle)" />
                <p className="translation-placeholder" style={{ margin: 0 }}>
                  Esperando señas frente a la cámara...
                </p>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', maxWidth: '280px' }}>
                  {isDemo
                    ? 'Haz un gesto claro (Hola, Si, No, Bien, Amor y Paz, etc.) frente a la cámara'
                    : 'Realiza una seña con movimiento claro dentro del recuadro'}
                </span>
              </div>
            )}
          </div>

          {/* [DEMO] Banner de información sobre el prototipo determinista — oculto al usuario (Tarea 3) */}

          {/* Quick Guide Card */}
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1rem',
              background: 'var(--panel-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--panel-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}
          >
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-color)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {isDemo ? 'Señas soportadas' : 'Señas sugeridas en este modelo:'}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {(isDemo
                ? ['Hola', 'Gracias', 'Si', 'No', 'Bien (Pulgar arriba)', 'Amor y Paz (V)', 'Te Quiero (ILY)', 'Lunes (L)']
                : ['Hola', 'Gracias', 'Letra A', 'Letra B', 'Letra C', 'Mamá', 'Papá', 'Lunes']
              ).map((sign) => (
                <span
                  key={sign}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--input-bg)',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--panel-border)'
                  }}
                >
                  {sign}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* [DEBUG] Panel de diagnóstico oculto — Ctrl+Shift+D para activar */}
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
            <strong style={{ color: '#0f0', letterSpacing: '0.08em' }}>⬛ DEBUG PANEL — Ctrl+Shift+D</strong>
            <span style={{ color: '#aaa' }}>FPS actual: <strong style={{ color: '#fff' }}>{fps}</strong></span>
          </div>
          {debugData ? (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                <tr><td style={{ color: '#aaa', paddingRight: '1rem' }}>Mano detectada</td><td><strong style={{ color: debugData.hand_detected ? '#0f0' : '#f55' }}>{String(debugData.hand_detected)}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Mano activa</td><td>{debugData.hand_label ?? '—'}</td></tr>
                <tr><td style={{ color: '#aaa' }}>Pulgar ext.</td><td><strong style={{ color: debugData.fingers?.thumb ? '#0f0' : '#f55' }}>{String(debugData.fingers?.thumb ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Índice ext.</td><td><strong style={{ color: debugData.fingers?.index ? '#0f0' : '#f55' }}>{String(debugData.fingers?.index ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Medio ext.</td><td><strong style={{ color: debugData.fingers?.middle ? '#0f0' : '#f55' }}>{String(debugData.fingers?.middle ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Anular ext.</td><td><strong style={{ color: debugData.fingers?.ring ? '#0f0' : '#f55' }}>{String(debugData.fingers?.ring ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Meñique ext.</td><td><strong style={{ color: debugData.fingers?.pinky ? '#0f0' : '#f55' }}>{String(debugData.fingers?.pinky ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>4 ded. tol.</td><td><strong style={{ color: debugData.all_four_extended_tolerant ? '#0f0' : '#f55' }}>{String(debugData.all_four_extended_tolerant ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Palma al frente</td><td><strong style={{ color: debugData.palm_facing_camera ? '#0f0' : '#f55' }}>{String(debugData.palm_facing_camera ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Normal palma Z</td><td>{debugData.palm_normal_z ?? '—'}</td></tr>
                <tr><td style={{ color: '#aaa' }}>Muñeca (x,y,z)</td><td>{debugData.wrist_position ? `[${debugData.wrist_position.join(', ')}]` : '—'}</td></tr>
                <tr><td style={{ color: '#aaa' }}>Agitando (wave)</td><td><strong style={{ color: debugData.is_waving ? '#0f0' : '#f55' }}>{String(debugData.is_waving ?? '—')}</strong></td></tr>
                <tr><td style={{ color: '#aaa' }}>Cambios direc.</td><td>{debugData.direction_changes ?? '—'} / 2 req.</td></tr>
                <tr><td style={{ color: '#aaa' }}>Amplitud wave</td><td>{debugData.wave_amplitude ?? '—'}</td></tr>
                <tr><td style={{ color: '#aaa' }}>Regla evaluada</td><td style={{ color: '#ff0' }}>{debugData.evaluated_rule ?? '—'}</td></tr>
                <tr><td style={{ color: '#aaa' }}>Razón</td><td style={{ color: '#ccc', maxWidth: '240px', wordBreak: 'break-word' }}>{debugData.rule_reason ?? '—'}</td></tr>
              </tbody>
            </table>
          ) : (
            <span style={{ color: '#888' }}>Esperando datos del servidor...</span>
          )}
        </section>
      )}
    </div>
  );
};

export default Translator;
