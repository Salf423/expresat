import React, { useRef, useState } from 'react';
import { Camera, Activity, MessageSquare, Sparkles, Volume2, Copy, Check, Info } from 'lucide-react';
import { ApiService } from '../services/apiService';
import { useMediaPipe } from '../hooks/useMediaPipe';

const Translator = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const apiRef = useRef(null);

  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState('Desconectado');
  const [statusClass, setStatusClass] = useState('status-offline');
  const [fps, setFps] = useState(0);
  const [copied, setCopied] = useState(false);

  // Initialize ApiService once (stable ref — no re-renders)
  if (!apiRef.current) {
    const env = localStorage.getItem('apiEnv') || 'Local';
    const wsUrl = env === 'Local'
      ? (import.meta.env.VITE_WS_URL_LOCAL || 'ws://127.0.0.1:8000/ws')
      : (import.meta.env.VITE_WS_URL_PROD || 'wss://api.expresat.cloud/ws');

    const api = new ApiService(wsUrl);
    api.connect('mock_token');
    api.onStatusChange((text, className) => {
      setStatus(text);
      setStatusClass(className);
    });
    api.onMessage((text) => {
      if (text?.payload?.label) {
        setTranslation(text.payload.label);
      } else if (typeof text === 'string') {
        setTranslation(text);
      }
    });

    apiRef.current = api;
  }

  // Off-main-thread MediaPipe + EMA filter + canvas drawing
  useMediaPipe(
    videoRef,
    canvasRef,
    (landmarks) => apiRef.current?.sendLandmarks(landmarks), // throttled 2/sec
    (currentFps) => setFps(currentFps),                      // called 1/sec
    { alpha: 0.45, targetFPS: 15, sendInterval: 500 }
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
          </div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Posiciónate frente a la cámara con las manos visibles y buena iluminación.
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
                <span className="chip" style={{ marginBottom: '1rem', background: 'var(--success-bg)', color: 'var(--success-color)', borderColor: 'transparent' }}>
                  Reconocimiento Confiable
                </span>
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
                  Realiza una seña con movimiento claro dentro del recuadro
                </span>
              </div>
            )}
          </div>

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
              Señas sugeridas en este modelo:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {['Hola', 'Gracias', 'Letra A', 'Letra B', 'Letra C', 'Mamá', 'Papá', 'Lunes'].map((sign) => (
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
    </div>
  );
};

export default Translator;
