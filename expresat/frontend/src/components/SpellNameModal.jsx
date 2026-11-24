import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Sparkles,
  Camera,
  RotateCcw,
  Award,
  CheckCircle2,
  Hand,
  AlertTriangle,
  ArrowLeft,
  UserCheck,
} from 'lucide-react';
import { useSignEngine } from '../ui/index.js';
import { describeSignPosture } from '../recognition/index.js';
import {
  FINGER_ORDER,
  FINGER_LABELS_ES,
  MAX_SPELL_NAME_LENGTH,
  normalizeSpellName,
  SpellNameMachine,
  evaluateTargetSign,
  TargetedPracticeEvaluator,
} from '../learning/index.js';

const TRACKING_CONFIG = Object.freeze({
  enabled: true,
  showTrails: false,
  showLabels: false,
  showHalos: true,
  colorByPart: true,
  trailLength: 4,
});

const SAMPLE_NAMES = Object.freeze(['Ana', 'Luis', 'Sofía', 'Peña']);

const FINGER_ACTION_BADGE = Object.freeze({
  ok: '✓',
  extend: '↑',
  curl: '↓',
  adjust: '•',
  idle: '',
});

function isSameSpellSnap(prev, next) {
  if (!prev || !next) return false;
  return (
    prev.normalizedName === next.normalizedName &&
    prev.currentIndex === next.currentIndex &&
    prev.phase === next.phase &&
    prev.completed === next.completed &&
    prev.awaitingRelease === next.awaitingRelease &&
    Math.round((prev.stabilityProgress || 0) * 20) ===
      Math.round((next.stabilityProgress || 0) * 20) &&
    prev.promptMessage === next.promptMessage &&
    prev.lastEvent?.type === next.lastEvent?.type
  );
}

function isSameFeedback(prev, next) {
  if (!prev || !next) return false;
  if (
    prev.status !== next.status ||
    prev.message !== next.message ||
    prev.orientationIssue !== next.orientationIssue ||
    prev.directionIssue !== next.directionIssue ||
    prev.motionIssue !== next.motionIssue ||
    prev.distanceIssue !== next.distanceIssue ||
    prev.targetId !== next.targetId
  ) {
    return false;
  }
  for (const key of FINGER_ORDER) {
    if (prev.fingerStatus?.[key] !== next.fingerStatus?.[key]) return false;
  }
  return true;
}

function NameLetterTiles({ letters, currentIndex, completedAll = false }) {
  return (
    <div
      className="spell-tiles-row"
      role="list"
      aria-label="Progreso de letras del nombre"
      data-testid="spell-name-tiles"
    >
      {letters.map((item, idx) => {
        const isDone = completedAll || idx < currentIndex;
        const isActive = !completedAll && idx === currentIndex;
        return (
          <div
            key={`${item.char}-${idx}`}
            role="listitem"
            aria-current={isActive ? 'step' : undefined}
            aria-label={`Letra ${item.char}: ${
              isDone ? 'completada' : isActive ? 'activa' : 'pendiente'
            }`}
            className={`spell-tile ${
              isDone ? 'spell-tile--done' : isActive ? 'spell-tile--active' : ''
            }`}
          >
            <span>{item.char}</span>
            {isDone && (
              <CheckCircle2
                size={12}
                className="spell-tile__check"
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Mounted ONLY during active live camera spelling so webcam tracks are opened on demand
 * and released immediately upon completion, name change, or modal close.
 */
function ActiveSpellCamera({ normalizedName, onCompleted, onChangeName }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [machine] = useState(() => new SpellNameMachine({ name: normalizedName }));
  const initialTarget = machine.getCurrentTarget();

  // `staticMinStableMs: 0` so `SpellNameMachine` is the single source of truth for
  // stability hold (200 ms) and consecutive repeated-letter anti-bounce release (320 ms).
  const [evaluator] = useState(
    () => new TargetedPracticeEvaluator(initialTarget?.sign || null, { staticMinStableMs: 0 })
  );

  const activeIndexRef = useRef(0);
  const completedNotifiedRef = useRef(false);

  const [snap, setSnap] = useState(() => machine.getSnapshot());
  const [feedback, setFeedback] = useState(() =>
    initialTarget ? evaluateTargetSign(null, initialTarget.sign, []) : null
  );

  const handlePrediction = useCallback(
    (prediction, frameData) => {
      if (completedNotifiedRef.current) return;

      const currentTarget = machine.getCurrentTarget();
      if (!currentTarget) return;

      if (activeIndexRef.current !== machine.currentIndex) {
        activeIndexRef.current = machine.currentIndex;
        evaluator.reset(currentTarget.sign);
      }

      const timestampMs = frameData?.timestamp ?? performance.now();
      const { confirmed, evaluation } = evaluator.evaluate(frameData, {
        timestampMs,
        detectedLabel: prediction?.label ?? null,
      });

      const nextSnap = machine.update({
        matched: confirmed,
        timestampMs,
      });

      // Immediately re-arm the evaluator if the letter just advanced
      if (nextSnap.currentIndex !== activeIndexRef.current && nextSnap.currentLetter) {
        activeIndexRef.current = nextSnap.currentIndex;
        evaluator.reset(nextSnap.currentLetter.sign);
      }

      setSnap((prev) => (isSameSpellSnap(prev, nextSnap) ? prev : nextSnap));
      setFeedback((prev) => (isSameFeedback(prev, evaluation) ? prev : evaluation));

      if (nextSnap.completed && !completedNotifiedRef.current) {
        completedNotifiedRef.current = true;
        onCompleted?.(nextSnap);
      }
    },
    [machine, evaluator, onCompleted]
  );

  const { engineStatus, engineError, clearGesture } = useSignEngine({
    videoRef,
    canvasRef,
    trackingConfig: TRACKING_CONFIG,
    enableRemoteTransport: false,
    enablePose: false,
    onPrediction: handlePrediction,
  });

  const handleRestartName = useCallback(() => {
    completedNotifiedRef.current = false;
    activeIndexRef.current = 0;
    clearGesture();
    const freshSnap = machine.reset(normalizedName);
    if (freshSnap.currentLetter) {
      evaluator.reset(freshSnap.currentLetter.sign);
      setFeedback(evaluateTargetSign(null, freshSnap.currentLetter.sign, []));
    }
    setSnap(freshSnap);
  }, [clearGesture, machine, evaluator, normalizedName]);

  const activeTarget = snap.currentLetter;
  const activePostureBadges = useMemo(
    () => (activeTarget ? describeSignPosture(activeTarget.sign) : []),
    [activeTarget]
  );

  const bannerInfo = useMemo(() => {
    if (snap.awaitingRelease) {
      return {
        tone: 'info',
        title: `Letra repetida: «${activeTarget?.char || ''}»`,
        body: snap.promptMessage,
      };
    }
    if (!feedback) {
      return {
        tone: 'neutral',
        title: 'Esperando tu mano',
        body: snap.promptMessage,
      };
    }
    if (feedback.status === 'match') {
      return {
        tone: 'success',
        title: `¡Exacto! Letra «${activeTarget?.char || ''}»`,
        body:
          snap.stabilityProgress > 0 && snap.stabilityProgress < 1
            ? 'Mantén tu mano firme un instante…'
            : feedback.message,
      };
    }
    if (feedback.status === 'distance_adjust') {
      return {
        tone: 'info',
        title: 'Ajusta la distancia',
        body: feedback.message,
      };
    }
    if (feedback.status === 'wrong_sign' || feedback.status === 'adjust_posture') {
      return {
        tone: 'warning',
        title: feedback.motionIssue ? 'Falta el movimiento' : 'Ajusta tu postura',
        body: feedback.message,
      };
    }
    return {
      tone: 'neutral',
      title: 'Esperando tu mano',
      body: feedback.message,
    };
  }, [snap, feedback, activeTarget]);

  const bannerColors = {
    success: { bg: 'var(--success-bg)', border: 'var(--success-color)' },
    warning: { bg: 'var(--warning-bg)', border: 'var(--warning-color)' },
    info: { bg: 'var(--accent-primary-bg)', border: 'var(--accent-primary)' },
    neutral: { bg: 'var(--input-bg)', border: 'var(--panel-border)' },
  }[bannerInfo.tone];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Name Letter Progress Strip */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.55rem',
        }}
      >
        <NameLetterTiles letters={snap.letters} currentIndex={snap.currentIndex} />
        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          Letra {Math.min(snap.currentIndex + 1, snap.totalLetters)} de {snap.totalLetters} ·{' '}
          {snap.completedCount} completadas
        </span>
      </div>

      {/* Two-column layout: Active Letter Guide + Live Camera */}
      <div className="learn-practice-layout">
        {/* Left: Target Letter Guide */}
        {activeTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div
              className="glass-panel--static"
              style={{
                padding: '1.15rem',
                background: 'var(--input-bg)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.55rem',
              }}
            >
              <span className="chip" style={{ fontSize: '0.74rem' }}>
                {activeTarget.sign.type === 'dynamic' ? 'Letra con movimiento' : 'Letra activa'}
              </span>
              <div
                aria-hidden="true"
                style={{
                  width: '78px',
                  height: '78px',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--accent-primary-bg)',
                  border: '2px solid var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2.5rem',
                  fontWeight: 800,
                  color: 'var(--text-color)',
                  lineHeight: 1,
                }}
              >
                {activeTarget.char}
              </div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-color)' }}>
                {activeTarget.sign.displayName}
              </h3>

              {activePostureBadges.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.35rem' }}>
                  {activePostureBadges.map((b) => (
                    <span
                      key={b}
                      className="chip"
                      style={{
                        fontSize: '0.73rem',
                        background: 'var(--panel-bg-solid)',
                        color: 'var(--text-color)',
                        borderColor: 'var(--panel-border)',
                      }}
                    >
                      {b}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div
              className="glass-panel--static"
              style={{
                padding: '1rem 1.1rem',
                background: 'var(--accent-primary-bg)',
                borderColor: 'var(--accent-primary-border)',
              }}
            >
              <h4
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  margin: '0 0 0.4rem 0',
                  fontSize: '0.88rem',
                  color: 'var(--text-color)',
                }}
              >
                <Hand size={16} color="var(--accent-primary)" aria-hidden="true" />
                <span>Cómo hacer la letra «{activeTarget.char}»</span>
              </h4>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-color)', lineHeight: 1.55 }}>
                {activeTarget.sign.instructions}
              </p>
            </div>
          </div>
        )}

        {/* Right: Live Camera + Anatomical Correction */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {engineError && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                padding: '0.8rem 1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--error-bg)',
                border: '1px solid var(--error-color)',
                color: 'var(--text-color)',
                fontSize: '0.84rem',
              }}
            >
              <AlertTriangle size={18} color="var(--error-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong style={{ display: 'block' }}>No pudimos activar tu cámara</strong>
                <span>{engineError.message}</span>
              </div>
            </div>
          )}

          <div className="practice-video-stage">
            <video
              ref={videoRef}
              aria-label={`Cámara en vivo para deletrear ${normalizedName} en LSM`}
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
              className="practice-video-canvas"
              aria-label="Vista de cámara guiada para el reto Deletrea tu nombre"
            />

            <div
              style={{
                position: 'absolute',
                top: '0.6rem',
                left: '0.6rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.25rem 0.65rem',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(7, 9, 15, 0.78)',
                color: '#f8fafc',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              <span
                className={`status-dot ${
                  engineStatus.wasmReady ? 'status-dot--online' : 'status-dot--connecting'
                }`}
                aria-hidden="true"
              />
              <span>{engineStatus.wasmReady ? 'Cámara activa' : 'Preparando cámara…'}</span>
            </div>

            {snap.stabilityProgress > 0 && snap.stabilityProgress < 1 && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: '5px',
                  background: 'rgba(255, 255, 255, 0.2)',
                }}
              >
                <div
                  style={{
                    width: `${Math.round(snap.stabilityProgress * 100)}%`,
                    height: '100%',
                    background: 'var(--success-color)',
                    transition: 'width 60ms linear',
                  }}
                />
              </div>
            )}
          </div>

          {/* Live Anatomical Feedback Banner */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: bannerColors.bg,
              border: `1.5px solid ${bannerColors.border}`,
              color: 'var(--text-color)',
            }}
          >
            <strong style={{ display: 'block', fontSize: '0.86rem', marginBottom: '0.25rem' }}>
              {bannerInfo.title}
            </strong>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-color)', lineHeight: 1.5 }}>
              {bannerInfo.body}
            </p>

            {feedback && !snap.awaitingRelease && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.6rem' }}>
                {FINGER_ORDER.map((key) => {
                  const st = feedback.fingerStatus?.[key] || 'idle';
                  const isOk = st === 'ok';
                  const needsChange = st === 'extend' || st === 'curl' || st === 'adjust';
                  return (
                    <span
                      key={key}
                      style={{
                        fontSize: '0.73rem',
                        fontWeight: 600,
                        padding: '0.18rem 0.55rem',
                        borderRadius: 'var(--radius-sm)',
                        background: isOk
                          ? 'var(--success-bg)'
                          : needsChange
                            ? 'var(--warning-bg)'
                            : 'var(--panel-bg-solid)',
                        color: 'var(--text-color)',
                        border: `1px solid ${
                          isOk
                            ? 'var(--success-color)'
                            : needsChange
                              ? 'var(--warning-color)'
                              : 'var(--panel-border)'
                        }`,
                      }}
                    >
                      {FINGER_LABELS_ES[key].charAt(0).toUpperCase() + FINGER_LABELS_ES[key].slice(1)}
                      {FINGER_ACTION_BADGE[st] ? ` ${FINGER_ACTION_BADGE[st]}` : ''}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-outline"
              onClick={handleRestartName}
              style={{ flex: 1, padding: '0.55rem 0.9rem', fontSize: '0.82rem' }}
            >
              <RotateCcw size={15} aria-hidden="true" />
              <span>Reiniciar nombre</span>
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={onChangeName}
              style={{
                flex: 1,
                padding: '0.55rem 0.9rem',
                fontSize: '0.82rem',
                borderColor: 'var(--panel-border)',
                color: 'var(--text-color)',
              }}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              <span>Cambiar nombre</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive "Reto: Deletrea tu nombre" modal for Learn.jsx.
 */
const SpellNameModal = ({ onClose }) => {
  const [rawName, setRawName] = useState('');
  const [stage, setStage] = useState('input'); // 'input' | 'practicing' | 'celebrating'
  const [activeName, setActiveName] = useState('');
  const [completedLetters, setCompletedLetters] = useState([]);
  const [attemptKey, setAttemptKey] = useState(0);

  const closeBtnRef = useRef(null);
  const inputRef = useRef(null);

  const previewNormalized = useMemo(() => normalizeSpellName(rawName), [rawName]);
  const previewTiles = useMemo(
    () => Array.from(previewNormalized).map((char, index) => ({ char, index })),
    [previewNormalized]
  );

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.focus();
      else closeBtnRef.current?.focus();
    });

    return () => {
      document.body.style.overflow = 'unset';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const startChallenge = useCallback((candidateRaw) => {
    const clean = normalizeSpellName(candidateRaw);
    if (!clean) return;
    setActiveName(clean);
    setAttemptKey((n) => n + 1);
    setStage('practicing');
  }, []);

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      startChallenge(rawName);
    },
    [rawName, startChallenge]
  );

  const handleCompleted = useCallback((finalSnap) => {
    setCompletedLetters(finalSnap.letters || []);
    setStage('celebrating');
  }, []);

  const handleTryAnotherName = useCallback(() => {
    setRawName('');
    setActiveName('');
    setCompletedLetters([]);
    setStage('input');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spell-name-modal-title"
      onClick={onClose}
      data-testid="spell-name-modal"
    >
      <div
        className="modal-content learn-modal-content--practice"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Topbar (never cut off behind Navbar) */}
        <div className="learn-modal-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
            <div
              className="module-card__icon"
              style={{ width: '40px', height: '40px', flexShrink: 0 }}
            >
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h2
                id="spell-name-modal-title"
                style={{ fontSize: 'clamp(1.1rem, 3vw, 1.4rem)', margin: 0 }}
              >
                Reto: Deletrea tu nombre
              </h2>
              <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {stage === 'input' && 'Escribe cualquier nombre para practicarlo en vivo con LSM'}
                {stage === 'practicing' && `Deletreando «${activeName}» frente a tu cámara`}
                {stage === 'celebrating' && '¡Reto completado con éxito!'}
              </p>
            </div>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Cerrar reto Deletrea tu nombre"
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'var(--input-bg)',
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="learn-modal-body">
          {/* Stage 1: Name Input */}
          {stage === 'input' && (
            <form
              onSubmit={handleSubmit}
              style={{
                maxWidth: '520px',
                margin: '0.75rem auto 1rem auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '1.1rem',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                  Ingresa tu nombre (solo letras <strong>A–Z</strong> y <strong>Ñ</strong>; los
                  acentos se normalizan automáticamente). La cámara te guiará letra por letra con
                  corrección en tiempo real.
                </p>
              </div>

              <div className="form-field">
                <label htmlFor="spell-name-input" className="form-label">
                  Tu nombre
                </label>
                <input
                  ref={inputRef}
                  id="spell-name-input"
                  data-testid="spell-name-input"
                  type="text"
                  value={rawName}
                  onChange={(e) => setRawName(e.target.value)}
                  placeholder="Ej. Ana, Sofía, José, Peña…"
                  maxLength={MAX_SPELL_NAME_LENGTH + 8}
                  autoComplete="given-name"
                  className="form-input"
                  style={{ padding: '0.85rem 1rem', fontSize: '1.05rem', fontWeight: 600 }}
                />
              </div>

              {/* Live preview of normalized tiles */}
              {previewTiles.length > 0 && (
                <div
                  style={{
                    padding: '0.85rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--panel-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Se deletrearán {previewTiles.length}{' '}
                    {previewTiles.length === 1 ? 'letra' : 'letras'} en LSM:
                  </span>
                  <NameLetterTiles letters={previewTiles} currentIndex={-1} />
                </div>
              )}

              {/* Quick sample names for judges */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                }}
              >
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Prueba rápido:
                </span>
                {SAMPLE_NAMES.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="learn-filter-pill"
                    onClick={() => setRawName(sample)}
                  >
                    {sample}
                  </button>
                ))}
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={previewNormalized.length === 0}
                data-testid="spell-name-start-btn"
                style={{ width: '100%', padding: '0.85rem 1.25rem', fontSize: '0.96rem' }}
              >
                <Camera size={18} aria-hidden="true" />
                <span>Comenzar reto en vivo</span>
              </button>

              <p
                style={{
                  margin: 0,
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}
              >
                100% privado y sin conexión: ninguna imagen de tu cámara sale de este dispositivo.
              </p>
            </form>
          )}

          {/* Stage 2: Live Camera Practice */}
          {stage === 'practicing' && activeName && (
            <ActiveSpellCamera
              key={`${activeName}-${attemptKey}`}
              normalizedName={activeName}
              onCompleted={handleCompleted}
              onChangeName={handleTryAnotherName}
            />
          )}

          {/* Stage 3: Personalized Celebration */}
          {stage === 'celebrating' && (
            <div
              role="status"
              aria-live="polite"
              data-testid="spell-name-celebration"
              style={{
                maxWidth: '560px',
                margin: '0.75rem auto',
                padding: '2rem 1.4rem',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--success-bg)',
                border: '2px solid var(--success-color)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '1rem',
              }}
            >
              <div
                style={{
                  width: '66px',
                  height: '66px',
                  borderRadius: '50%',
                  background: 'var(--panel-bg-solid)',
                  border: '2px solid var(--success-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--success-color)',
                }}
              >
                <Award size={34} aria-hidden="true" />
              </div>

              <NameLetterTiles
                letters={completedLetters}
                currentIndex={completedLetters.length}
                completedAll
              />

              <div>
                <h3
                  style={{
                    margin: '0 0 0.35rem 0',
                    fontSize: 'clamp(1.35rem, 3.5vw, 1.8rem)',
                    color: 'var(--text-color)',
                  }}
                >
                  ¡Felicidades, {activeName}! Deletreaste tu nombre en LSM
                </h3>
                <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-color)' }}>
                  Completaste las {completedLetters.length}{' '}
                  {completedLetters.length === 1 ? 'letra' : 'letras'} de tu nombre con el
                  abecedario de Lengua de Señas Mexicana.
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: '0.65rem',
                  width: '100%',
                  marginTop: '0.35rem',
                }}
              >
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleTryAnotherName}
                  data-testid="spell-name-try-another-btn"
                  style={{ padding: '0.72rem 1.35rem', fontSize: '0.9rem' }}
                >
                  <UserCheck size={17} aria-hidden="true" />
                  <span>Probar otro nombre</span>
                </button>

                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => startChallenge(activeName)}
                  style={{ padding: '0.72rem 1.15rem', fontSize: '0.88rem' }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>Repetir «{activeName}»</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SpellNameModal;
