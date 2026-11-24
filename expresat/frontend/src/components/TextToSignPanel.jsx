import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Hand,
  Sparkles,
  Trash2,
  Gauge,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { PLAYBACK_SPEEDS, sequenceTextToSigns } from '../recognition/index.js';

const QUICK_DEMO_PHRASES = Object.freeze([
  'Hola, mucho gusto',
  'Buenos días, por favor',
  'Gracias, de nada',
  'Hola Ana',
  'Por favor ayuda',
]);

function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function mapSpeechErrorMessage(errorCode) {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'No se otorgó permiso al micrófono. Puedes escribir tu frase directamente aquí.';
    case 'network':
      return 'El dictado por voz requiere conexión en este navegador. El modo texto sigue funcionando 100% sin conexión.';
    case 'no-speech':
      return 'No detectamos voz. Intenta hablar de nuevo o escribe tu frase.';
    case 'audio-capture':
      return 'No encontramos un micrófono disponible en este dispositivo. Usa el teclado para traducir.';
    case 'aborted':
      return '';
    default:
      return 'El dictado por voz no pudo completarse. Puedes escribir tu frase directamente sin conexión.';
  }
}

const TextToSignPanel = () => {
  const [inputText, setInputText] = useState('Hola, mucho gusto');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedKey, setSpeedKey] = useState('normal'); // 'slow' | 'normal'
  const [isListening, setIsListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');

  const recognitionRef = useRef(null);
  const speechSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);

  const sequence = useMemo(() => sequenceTextToSigns(inputText), [inputText]);
  const steps = sequence.steps;
  const totalSteps = steps.length;

  const safeIndex = totalSteps > 0 ? Math.min(currentIndex, totalSteps - 1) : 0;
  const currentStep = totalSteps > 0 ? steps[safeIndex] : null;
  const activeSpeed = PLAYBACK_SPEEDS[speedKey] || PLAYBACK_SPEEDS.normal;

  const updateInputText = useCallback((nextText, { autoStart = false } = {}) => {
    setInputText(nextText);
    setCurrentIndex(0);
    setIsPlaying(autoStart);
  }, []);

  // Stop speech recognition safely on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Ignore abort errors on unmount
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  // Step-by-step autoplay timer
  useEffect(() => {
    if (!isPlaying || totalSteps === 0) return undefined;

    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev + 1 >= totalSteps) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, activeSpeed.intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, totalSteps, activeSpeed.intervalMs]);

  const handleTogglePlay = useCallback(() => {
    if (totalSteps === 0) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (safeIndex >= totalSteps - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  }, [isPlaying, safeIndex, totalSteps]);

  const handlePrev = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.min(Math.max(0, totalSteps - 1), prev + 1));
  }, [totalSteps]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
  }, []);

  const handleClear = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setInputText('');
    setSpeechNotice('');
  }, []);

  const handleToggleDictation = useCallback(() => {
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // Ignore stop errors
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      setSpeechNotice(
        'Tu navegador no incluye dictado por voz. Escribe cualquier palabra o frase para traducirla a LSM sin conexión.'
      );
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSpeechNotice(
        'Sin conexión a internet: el dictado por voz puede no responder en algunos dispositivos. Puedes escribir tu frase aquí 100% sin conexión.'
      );
    } else {
      setSpeechNotice('');
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'es-MX';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0]?.transcript || '';
        }
        const cleaned = transcript.trim();
        if (cleaned) {
          const isFinal = Boolean(event.results[event.results.length - 1]?.isFinal);
          updateInputText(cleaned, { autoStart: isFinal });
        }
      };

      recognition.onerror = (event) => {
        setIsListening(false);
        const msg = mapSpeechErrorMessage(event?.error);
        if (msg) setSpeechNotice(msg);
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setSpeechNotice(
        'No fue posible iniciar el micrófono en este momento. Puedes escribir tu frase directamente sin conexión.'
      );
    }
  }, [isListening, updateInputText]);

  const progressPct = totalSteps > 0 ? Math.round(((safeIndex + 1) / totalSteps) * 100) : 0;

  return (
    <div className="translator-grid" style={{ flex: 1 }} data-testid="text-to-sign-panel">
      {/* Left Column: Text / Voice Input & Interactive Sequence Strip */}
      <section className="glass-panel translator-panel" aria-label="Entrada de texto o voz a LSM">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Mic size={20} color="var(--accent-primary)" aria-hidden="true" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
            Escribe o dicta en español
          </h2>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              type="button"
              data-testid="voice-dictation-btn"
              onClick={handleToggleDictation}
              aria-pressed={isListening}
              className="chip"
              title={
                speechSupported
                  ? isListening
                    ? 'Detener dictado por voz'
                    : 'Dictar frase con micrófono (es-MX)'
                  : 'Dictado por voz no disponible en este navegador'
              }
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.76rem',
                fontWeight: 600,
                background: isListening
                  ? 'var(--error-bg)'
                  : speechSupported
                    ? 'var(--accent-primary-bg)'
                    : 'var(--input-bg)',
                color: isListening
                  ? 'var(--error-color)'
                  : speechSupported
                    ? 'var(--accent-primary)'
                    : 'var(--text-muted)',
                border: `1px solid ${
                  isListening
                    ? 'var(--error-color)'
                    : speechSupported
                      ? 'var(--accent-primary-border)'
                      : 'var(--panel-border)'
                }`,
              }}
            >
              {isListening ? (
                <>
                  <MicOff size={14} aria-hidden="true" />
                  <span>Escuchando… (Detener)</span>
                </>
              ) : (
                <>
                  <Mic size={14} aria-hidden="true" />
                  <span>{speechSupported ? 'Dictar voz' : 'Voz no disponible'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={!inputText}
              className="btn-icon"
              aria-label="Limpiar texto"
              title="Limpiar texto"
              style={{
                padding: '0.28rem 0.6rem',
                fontSize: '0.74rem',
                fontWeight: 600,
                borderRadius: 'var(--radius-sm)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                opacity: inputText ? 1 : 0.45,
                cursor: inputText ? 'pointer' : 'not-allowed',
                border: '1px solid var(--border-color)',
                background: 'var(--input-bg)',
                color: 'var(--text-color)',
              }}
            >
              <Trash2 size={13} aria-hidden="true" />
              <span>Limpiar</span>
            </button>
          </div>
        </div>

        <label htmlFor="reverse-sign-input" className="form-label" style={{ marginBottom: '0.4rem' }}>
          Frase o palabra para mostrar en Lengua de Señas Mexicana
        </label>
        <textarea
          id="reverse-sign-input"
          data-testid="reverse-sign-input"
          value={inputText}
          onChange={(e) => updateInputText(e.target.value)}
          placeholder="Ej. Hola, buenos días. Por favor ayuda…"
          rows={3}
          maxLength={240}
          className="form-input"
          style={{
            padding: '0.85rem 1rem',
            resize: 'vertical',
            minHeight: '92px',
            lineHeight: 1.5,
          }}
        />

        {/* Graceful SpeechRecognition fallback / status notice */}
        {speechNotice && (
          <div
            role="status"
            aria-live="polite"
            style={{
              marginTop: '0.65rem',
              padding: '0.65rem 0.85rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--info-bg)',
              border: '1px solid var(--accent-primary-border)',
              color: 'var(--text-color)',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
            }}
          >
            <Info size={16} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{speechNotice}</span>
          </div>
        )}

        {/* Quick demo phrases for judges */}
        <div style={{ marginTop: '1rem' }}>
          <span
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '0.45rem',
            }}
          >
            Frases rápidas de ejemplo
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {QUICK_DEMO_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                onClick={() => updateInputText(phrase, { autoStart: true })}
                className="learn-filter-pill"
              >
                {phrase}
              </button>
            ))}
          </div>
        </div>

        {/* Generated Sequence Strip */}
        <div
          style={{
            marginTop: '1.1rem',
            padding: '0.9rem 1rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--panel-bg)',
            border: '1px solid var(--panel-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
            flex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.4rem',
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
              Secuencia generada ({totalSteps} {totalSteps === 1 ? 'paso' : 'pasos'})
            </span>
            {totalSteps > 0 && (
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                {sequence.stats.directMatches} señas directas · {sequence.stats.spelledLetters} deletreadas
              </span>
            )}
          </div>

          {totalSteps > 0 ? (
            <div
              className="translator-guide-list translator-guide-list--scrollable"
              style={{ maxHeight: '190px' }}
              role="list"
              aria-label="Pasos de señas generados"
            >
              {steps.map((step, idx) => {
                const isActive = idx === safeIndex;
                const isDone = idx < safeIndex;
                return (
                  <button
                    key={`${step.signId}-${idx}`}
                    type="button"
                    role="listitem"
                    aria-current={isActive ? 'step' : undefined}
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentIndex(idx);
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.3rem 0.65rem',
                      borderRadius: 'var(--radius-sm)',
                      fontFamily: 'inherit',
                      fontSize: '0.78rem',
                      fontWeight: isActive ? 700 : 600,
                      cursor: 'pointer',
                      border: `1.5px solid ${
                        isActive
                          ? 'var(--accent-primary)'
                          : isDone
                            ? 'var(--success-color)'
                            : 'var(--panel-border)'
                      }`,
                      background: isActive
                        ? 'var(--accent-primary)'
                        : isDone
                          ? 'var(--success-bg)'
                          : 'var(--input-bg)',
                      color: isActive ? 'var(--text-on-accent)' : 'var(--text-color)',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <span style={{ opacity: isActive ? 0.9 : 0.65, fontVariantNumeric: 'tabular-nums' }}>
                      {idx + 1}.
                    </span>
                    <span>{step.matchType === 'spell' ? step.shortLabel : step.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-subtle)' }}>
              Escribe una frase arriba para ver la secuencia en LSM. Las palabras del catálogo se
              muestran completas y las demás se deletrean letra por letra (A–Z y Ñ).
            </p>
          )}
        </div>
      </section>

      {/* Right Column: Visual Step-by-Step LSM Player */}
      <section className="glass-panel translator-panel" aria-label="Reproductor visual paso a paso en LSM">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <Hand size={20} color="var(--accent-secondary)" aria-hidden="true" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Guía Visual en LSM</h2>

          {/* Speed selector: Lento / Normal */}
          <div
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
            role="group"
            aria-label="Velocidad de reproducción"
          >
            <Gauge size={14} color="var(--text-muted)" aria-hidden="true" />
            {Object.values(PLAYBACK_SPEEDS).map((spd) => {
              const selected = speedKey === spd.id;
              return (
                <button
                  key={spd.id}
                  type="button"
                  data-testid={`speed-btn-${spd.id}`}
                  aria-pressed={selected}
                  onClick={() => setSpeedKey(spd.id)}
                  className={`learn-filter-pill ${selected ? 'learn-filter-pill--active' : ''}`}
                  style={{ padding: '0.24rem 0.65rem', fontSize: '0.75rem' }}
                >
                  {spd.label}
                </button>
              );
            })}
          </div>
        </div>

        {currentStep ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
            {/* Step Progress Header */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                data-testid="reverse-step-counter"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.82rem',
                  color: 'var(--text-muted)',
                }}
              >
                <span>
                  Paso{' '}
                  <strong style={{ color: 'var(--text-color)', fontVariantNumeric: 'tabular-nums' }}>
                    {safeIndex + 1}
                  </strong>{' '}
                  de{' '}
                  <strong style={{ color: 'var(--text-color)', fontVariantNumeric: 'tabular-nums' }}>
                    {totalSteps}
                  </strong>
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {progressPct}%
                </span>
              </div>
              <div
                className="learn-progress-track"
                style={{ height: '8px' }}
                role="progressbar"
                aria-label="Progreso de la secuencia en LSM"
                aria-valuenow={safeIndex + 1}
                aria-valuemin={1}
                aria-valuemax={totalSteps}
              >
                <div className="learn-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {/* Active Sign Visual Card */}
            <div
              data-testid="reverse-active-card"
              style={{
                padding: '1.35rem 1.2rem',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--input-bg)',
                border: '1.5px solid var(--accent-primary-border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '0.75rem',
              }}
            >
              {/* Classification Badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.4rem' }}>
                {currentStep.matchType === 'spell' ? (
                  <span className="chip" style={{ fontSize: '0.75rem' }}>
                    Deletreando «{currentStep.sourceToken}» · letra{' '}
                    {(currentStep.wordPosition?.index ?? 0) + 1}/{currentStep.wordPosition?.total ?? 1}
                  </span>
                ) : currentStep.matchType === 'number' ? (
                  <span
                    className="chip"
                    style={{
                      fontSize: '0.75rem',
                      background: 'var(--success-bg)',
                      color: 'var(--text-color)',
                      borderColor: 'var(--success-color)',
                    }}
                  >
                    <CheckCircle2 size={13} color="var(--success-color)" aria-hidden="true" />
                    <span>Número LSM</span>
                  </span>
                ) : (
                  <span
                    className="chip"
                    style={{
                      fontSize: '0.75rem',
                      background: 'var(--success-bg)',
                      color: 'var(--text-color)',
                      borderColor: 'var(--success-color)',
                    }}
                  >
                    <CheckCircle2 size={13} color="var(--success-color)" aria-hidden="true" />
                    <span>Seña directa LSM</span>
                  </span>
                )}

                {currentStep.type === 'dynamic' && (
                  <span
                    className="chip"
                    style={{
                      fontSize: '0.75rem',
                      background: 'var(--accent-secondary-bg)',
                      color: 'var(--text-color)',
                      borderColor: 'var(--accent-secondary)',
                    }}
                  >
                    Con movimiento
                  </span>
                )}
              </div>

              {/* Large Sign Visual Emblem */}
              {(currentStep.matchType === 'spell' || currentStep.matchType === 'number') && (
                <div
                  aria-hidden="true"
                  style={{
                    width: '84px',
                    height: '84px',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--accent-primary-bg)',
                    border: '2px solid var(--accent-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '2.65rem',
                    fontWeight: 800,
                    color: 'var(--text-color)',
                    lineHeight: 1,
                  }}
                >
                  {currentStep.shortLabel}
                </div>
              )}

              <div>
                <h3
                  data-testid="reverse-active-sign-label"
                  style={{
                    margin: 0,
                    fontSize: 'clamp(1.55rem, 3.5vw, 2.15rem)',
                    fontWeight: 800,
                    color: 'var(--text-color)',
                  }}
                >
                  {currentStep.displayName}
                </h3>
                {currentStep.hint && (
                  <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                    {currentStep.hint}
                  </p>
                )}
              </div>

              {/* Key Posture Badges */}
              {currentStep.postureSummary.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    marginTop: '0.15rem',
                  }}
                >
                  {currentStep.postureSummary.map((badge) => (
                    <span
                      key={badge}
                      className="chip"
                      style={{
                        fontSize: '0.75rem',
                        background: 'var(--panel-bg-solid)',
                        color: 'var(--text-color)',
                        borderColor: 'var(--panel-border)',
                      }}
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Clear Anatomical Instructions Box */}
            <div
              style={{
                padding: '1rem 1.1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent-primary-bg)',
                border: '1px solid var(--accent-primary-border)',
              }}
            >
              <h4
                style={{
                  margin: '0 0 0.35rem 0',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  color: 'var(--text-color)',
                }}
              >
                Cómo hacer esta seña paso a paso
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.92rem',
                  color: 'var(--text-color)',
                  lineHeight: 1.6,
                }}
              >
                {currentStep.instructions}
              </p>
            </div>

            {/* Playback Controls */}
            <div
              style={{
                marginTop: 'auto',
                paddingTop: '0.4rem',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.6rem',
              }}
            >
              <button
                type="button"
                className="btn-outline"
                onClick={handlePrev}
                disabled={safeIndex === 0}
                aria-label="Paso anterior"
                data-testid="reverse-prev-btn"
                style={{
                  padding: '0.55rem 0.95rem',
                  fontSize: '0.84rem',
                  opacity: safeIndex === 0 ? 0.45 : 1,
                  cursor: safeIndex === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <SkipBack size={16} aria-hidden="true" />
                <span>Anterior</span>
              </button>

              <button
                type="button"
                className="btn-primary"
                onClick={handleTogglePlay}
                data-testid="reverse-play-btn"
                aria-pressed={isPlaying}
                style={{ padding: '0.6rem 1.35rem', fontSize: '0.88rem' }}
              >
                {isPlaying ? (
                  <>
                    <Pause size={16} aria-hidden="true" />
                    <span>Pausar</span>
                  </>
                ) : (
                  <>
                    <Play size={16} aria-hidden="true" />
                    <span>{safeIndex >= totalSteps - 1 ? 'Repetir' : 'Reproducir'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn-outline"
                onClick={handleNext}
                disabled={safeIndex >= totalSteps - 1}
                aria-label="Siguiente paso"
                data-testid="reverse-next-btn"
                style={{
                  padding: '0.55rem 0.95rem',
                  fontSize: '0.84rem',
                  opacity: safeIndex >= totalSteps - 1 ? 0.45 : 1,
                  cursor: safeIndex >= totalSteps - 1 ? 'not-allowed' : 'pointer',
                }}
              >
                <span>Siguiente</span>
                <SkipForward size={16} aria-hidden="true" />
              </button>

              <button
                type="button"
                className="btn-icon"
                onClick={handleRestart}
                aria-label="Volver al primer paso"
                title="Volver al primer paso"
                style={{
                  width: '38px',
                  height: '38px',
                  border: '1px solid var(--panel-border)',
                  background: 'var(--input-bg)',
                }}
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: '0.75rem',
              padding: '2rem 1rem',
            }}
          >
            <Sparkles size={32} color="var(--accent-primary)" aria-hidden="true" />
            <p style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-color)' }}>
              Listo para traducir a Lengua de Señas Mexicana
            </p>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '360px' }}>
              Escribe una palabra, una frase o toca uno de los ejemplos de la izquierda para ver
              cada seña paso a paso.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default TextToSignPanel;
