import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Hand,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Award,
  Sparkles,
} from 'lucide-react';
import { useSignEngine } from '../ui/index.js';
import {
  FINGER_ORDER,
  FINGER_LABELS_ES,
  REPS_PER_HAND,
  PracticeSessionMachine,
  generateAnatomicalCorrection,
} from '../learning/index.js';

const TRACKING_CONFIG = Object.freeze({
  enabled: true,
  showTrails: false,
  showLabels: false,
  showHalos: true,
  colorByPart: true,
  trailLength: 4,
});

const FINGER_ACTION_BADGE = Object.freeze({
  ok: '✓',
  extend: '↑',
  curl: '↓',
  adjust: '•',
  idle: '',
});

function isSameSessionSnap(prev, next) {
  if (!prev || !next) return false;
  return (
    prev.rightCount === next.rightCount &&
    prev.leftCount === next.leftCount &&
    prev.phase === next.phase &&
    prev.completed === next.completed &&
    prev.awaitingRelease === next.awaitingRelease &&
    prev.rightWaitingRelease === next.rightWaitingRelease &&
    prev.leftWaitingRelease === next.leftWaitingRelease &&
    prev.activeHand === next.activeHand &&
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
    prev.motionIssue !== next.motionIssue
  ) {
    return false;
  }
  for (const key of FINGER_ORDER) {
    if (prev.fingerStatus?.[key] !== next.fingerStatus?.[key]) {
      return false;
    }
  }
  return true;
}

function HandProgressCard({ title, count, target, isActive, isRecommended }) {
  const done = count >= target;
  const borderColor = done
    ? 'var(--success-color)'
    : isActive || isRecommended
      ? 'var(--accent-primary)'
      : 'var(--panel-border)';
  const background = done
    ? 'var(--success-bg)'
    : isActive || isRecommended
      ? 'var(--accent-primary-bg)'
      : 'var(--input-bg)';

  return (
    <div
      style={{
        padding: '0.7rem 0.85rem',
        borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${borderColor}`,
        background,
        transition: 'border-color var(--transition-fast), background-color var(--transition-fast)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.35rem',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.8rem',
            fontWeight: 700,
            color: 'var(--text-color)',
          }}
        >
          {done ? (
            <CheckCircle2 size={15} color="var(--success-color)" aria-hidden="true" />
          ) : (
            <Hand size={15} color="var(--accent-primary)" aria-hidden="true" />
          )}
          <span>{title}</span>
        </span>
        <strong
          style={{
            fontSize: '0.85rem',
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--text-color)',
          }}
        >
          {count}/{target}
        </strong>
      </div>
      <div className="rep-dots" aria-hidden="true">
        {Array.from({ length: target }, (_, idx) => (
          <span
            key={idx}
            className={`rep-dot ${idx < count ? 'rep-dot--filled' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Live camera session subcomponent. Mounted ONLY while camera practice is active so
 * `useSignEngine` automatically opens the webcam on mount and releases all tracks on unmount.
 */
function ActiveCameraPractice({ sign, onCompleted, onStopCamera, onRetryCamera }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [sessionMachine] = useState(
    () =>
      new PracticeSessionMachine({
        targetLabel: sign.label,
        repsPerHand: REPS_PER_HAND,
      })
  );
  const completedNotifiedRef = useRef(false);

  const [sessionSnap, setSessionSnap] = useState(() => sessionMachine.getSnapshot());
  const [feedback, setFeedback] = useState(() =>
    generateAnatomicalCorrection({
      targetLabel: sign.label,
      detectedLabel: null,
      states: null,
    })
  );

  const handlePrediction = useCallback(
    (prediction, frameData) => {
      const nextSnap = sessionMachine.update({
        detectedLabel: prediction?.label ?? null,
        handId: prediction?.details?.handId ?? null,
        timestampMs: frameData?.timestamp ?? performance.now(),
      });

      setSessionSnap((prev) => (isSameSessionSnap(prev, nextSnap) ? prev : nextSnap));

      const nextFeedback = generateAnatomicalCorrection({
        targetLabel: sign.label,
        detectedLabel: prediction?.label || prediction?.details?.rawLabel || null,
        states: prediction?.details?.states ?? null,
        reason: prediction?.details?.reason ?? null,
        wave: prediction?.details?.wave ?? null,
        palmRotation: prediction?.details?.palmRotation ?? null,
      });

      setFeedback((prev) => (isSameFeedback(prev, nextFeedback) ? prev : nextFeedback));

      if (nextSnap.completed && !completedNotifiedRef.current) {
        completedNotifiedRef.current = true;
        onCompleted?.(nextSnap);
      }
    },
    [sessionMachine, sign.label, onCompleted]
  );

  // 100% offline local mode: enablePose: false for maximum fluidity and portrait mobile camera support
  const { engineStatus, engineError, gesture, clearGesture } = useSignEngine({
    videoRef,
    canvasRef,
    trackingConfig: TRACKING_CONFIG,
    enableRemoteTransport: false,
    enablePose: false,
    onPrediction: handlePrediction,
  });

  const handleResetSession = useCallback(() => {
    completedNotifiedRef.current = false;
    clearGesture();
    setSessionSnap(sessionMachine.reset(sign.label));
    setFeedback(
      generateAnatomicalCorrection({
        targetLabel: sign.label,
        detectedLabel: null,
        states: null,
      })
    );
  }, [clearGesture, sessionMachine, sign.label]);

  const activeHandLabel =
    sessionSnap.activeHand === 'right'
      ? 'Mano Derecha'
      : sessionSnap.activeHand === 'left'
        ? 'Mano Izquierda'
        : null;

  // Determine the single clearest live coaching message to announce
  const bannerInfo = useMemo(() => {
    const activeHandDone =
      (sessionSnap.activeHand === 'right' && sessionSnap.rightCount >= sessionSnap.repsPerHand) ||
      (sessionSnap.activeHand === 'left' && sessionSnap.leftCount >= sessionSnap.repsPerHand);
    const activeHandWaitingRelease =
      (sessionSnap.activeHand === 'right' && sessionSnap.rightWaitingRelease) ||
      (sessionSnap.activeHand === 'left' && sessionSnap.leftWaitingRelease);

    if (sessionSnap.lastEvent?.type === 'hand_completed') {
      return {
        tone: 'success',
        title: '¡Primera mano completada!',
        body: sessionSnap.promptMessage,
      };
    }
    if (sessionSnap.lastEvent?.type === 'hand_already_done' || activeHandDone) {
      return {
        tone: 'info',
        title: 'Cambia de mano',
        body: sessionSnap.promptMessage,
      };
    }
    if (activeHandWaitingRelease && feedback.status === 'match') {
      return {
        tone: 'success',
        title: '¡Repetición registrada!',
        body: 'Baja o relaja tu mano un instante antes de hacer la siguiente repetición.',
      };
    }
    if (sessionSnap.phase === 'switch_hand' && feedback.status === 'no_hand') {
      return {
        tone: 'success',
        title: '¡Primera mano completada!',
        body: sessionSnap.promptMessage,
      };
    }
    if (feedback.status === 'match') {
      return {
        tone: 'success',
        title: '¡Postura correcta!',
        body: feedback.message,
      };
    }
    if (feedback.status === 'wrong_sign') {
      return {
        tone: 'warning',
        title: 'Ajusta tu seña',
        body: feedback.message,
      };
    }
    if (feedback.status === 'adjust_posture') {
      return {
        tone: 'warning',
        title: 'Casi lo logras',
        body: feedback.message,
      };
    }
    return {
      tone: 'neutral',
      title: 'Esperando tu mano',
      body: feedback.message,
    };
  }, [sessionSnap, feedback]);

  const bannerColors = {
    success: {
      bg: 'var(--success-bg)',
      border: 'var(--success-color)',
      accent: 'var(--success-color)',
    },
    warning: {
      bg: 'var(--warning-bg)',
      border: 'var(--warning-color)',
      accent: 'var(--warning-color)',
    },
    info: {
      bg: 'var(--accent-primary-bg)',
      border: 'var(--accent-primary)',
      accent: 'var(--accent-primary)',
    },
    neutral: {
      bg: 'var(--input-bg)',
      border: 'var(--panel-border)',
      accent: 'var(--accent-primary)',
    },
  }[bannerInfo.tone];

  const isStabilizingTarget =
    gesture.state === 'detecting' &&
    gesture.details?.rawLabel === sign.label &&
    (gesture.details?.stabilityProgress ?? 0) > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Camera Error Banner */}
      {engineError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.65rem',
            padding: '0.85rem 1rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--error-bg)',
            border: '1px solid var(--error-color)',
            color: 'var(--text-color)',
            fontSize: '0.85rem',
          }}
        >
          <AlertTriangle size={18} color="var(--error-color)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block' }}>No pudimos activar tu cámara</strong>
            <span>{engineError.message}</span>
            {onRetryCamera && (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={onRetryCamera}
                  style={{ padding: '0.35rem 0.85rem', fontSize: '0.78rem' }}
                >
                  <RotateCcw size={13} />
                  <span>Reintentar cámara</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Video + Canvas Stage */}
      <div className="practice-video-stage">
        <video
          ref={videoRef}
          aria-label={`Cámara en vivo para practicar ${sign.displayName}`}
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
          aria-label={`Vista de cámara guiada para ${sign.displayName}`}
        />

        {/* Top-left Camera Status Chip (no technical jargon) */}
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

        {/* Top-right Active Hand Badge */}
        {activeHandLabel && (
          <div
            style={{
              position: 'absolute',
              top: '0.6rem',
              right: '0.6rem',
              padding: '0.25rem 0.65rem',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(7, 9, 15, 0.78)',
              color: '#f8fafc',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {activeHandLabel}
          </div>
        )}

        {/* Bottom Stabilization Bar */}
        {isStabilizingTarget && (
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
                width: `${Math.round((gesture.details?.stabilityProgress ?? 0) * 100)}%`,
                height: '100%',
                background: 'var(--success-color)',
                transition: 'width 80ms linear',
              }}
            />
          </div>
        )}
      </div>

      {/* 5 Right + 5 Left Repetition Progress */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.45rem',
            fontSize: '0.78rem',
            color: 'var(--text-muted)',
          }}
        >
          <span style={{ fontWeight: 600 }}>Protocolo de práctica (5 por mano)</span>
          <strong style={{ color: 'var(--text-color)', fontVariantNumeric: 'tabular-nums' }}>
            {sessionSnap.totalCount} / {sessionSnap.totalTarget}
          </strong>
        </div>

        <div className="hand-counter-grid">
          <HandProgressCard
            title="Mano Derecha"
            count={sessionSnap.rightCount}
            target={sessionSnap.repsPerHand}
            isActive={sessionSnap.activeHand === 'right'}
            isRecommended={sessionSnap.nextRecommendedHand === 'right'}
          />
          <HandProgressCard
            title="Mano Izquierda"
            count={sessionSnap.leftCount}
            target={sessionSnap.repsPerHand}
            isActive={sessionSnap.activeHand === 'left'}
            isRecommended={sessionSnap.nextRecommendedHand === 'left'}
          />
        </div>
      </div>

      {/* Explicit Hand-Switch Banner when one hand reached 5/5 */}
      {sessionSnap.phase === 'switch_hand' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '0.65rem 0.9rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--accent-primary-bg)',
            border: '1px solid var(--accent-primary-border)',
            color: 'var(--text-color)',
            fontSize: '0.84rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Sparkles size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          <span>
            ¡Excelente! Ahora repite la seña {sessionSnap.repsPerHand} veces con tu otra mano (
            {sessionSnap.nextRecommendedHand === 'left' ? 'mano izquierda' : 'mano derecha'}).
          </span>
        </div>
      )}

      {/* Live Anatomical Correction Feedback (WCAG 2.2 AA polite status region) */}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            marginBottom: '0.3rem',
          }}
        >
          <strong style={{ fontSize: '0.86rem', color: 'var(--text-color)' }}>
            {bannerInfo.title}
          </strong>
          {feedback.detectedLabel && feedback.status === 'wrong_sign' && (
            <span
              className="chip"
              style={{
                fontSize: '0.72rem',
                background: 'var(--panel-bg-solid)',
                color: 'var(--text-color)',
                borderColor: bannerColors.accent,
              }}
            >
              Detectado: {feedback.detectedLabel}
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-color)', lineHeight: 1.5 }}>
          {bannerInfo.body}
        </p>

        {/* Per-finger visual guide pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.65rem' }}>
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
      </div>

      {/* Practice Action Controls */}
      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-outline"
          onClick={handleResetSession}
          style={{ flex: 1, padding: '0.55rem 0.9rem', fontSize: '0.82rem' }}
        >
          <RotateCcw size={15} />
          <span>Reiniciar conteo</span>
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={onStopCamera}
          style={{
            flex: 1,
            padding: '0.55rem 0.9rem',
            fontSize: '0.82rem',
            borderColor: 'var(--panel-border)',
            color: 'var(--text-color)',
          }}
        >
          <CameraOff size={15} />
          <span>Detener cámara</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Integrated Guided Practice Panel rendered inside the `Learn.jsx` sign modal.
 * Manages camera lifecycle cleanly: off initially, on during active practice, off on completion or unmount.
 */
const GuidedPracticePanel = ({
  sign,
  alreadyCompleted = false,
  onSignCompleted,
  onNextSign = null,
  onBackToGroup = null,
}) => {
  const [practiceState, setPracticeState] = useState('idle'); // 'idle' | 'active' | 'celebrating'
  const [cameraAttempt, setCameraAttempt] = useState(0);

  const handleSessionCompleted = useCallback(() => {
    setPracticeState('celebrating');
    onSignCompleted?.(sign.id);
  }, [onSignCompleted, sign.id]);

  const handleRetryCamera = useCallback(() => {
    setCameraAttempt((n) => n + 1);
  }, []);

  if (practiceState === 'celebrating') {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          padding: '1.75rem 1.25rem',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--success-bg)',
          border: '2px solid var(--success-color)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.9rem',
        }}
      >
        <div
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'var(--panel-bg-solid)',
            border: '2px solid var(--success-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--success-color)',
          }}
        >
          <Award size={32} />
        </div>

        <div>
          <span
            className="chip"
            style={{
              background: 'var(--panel-bg-solid)',
              color: 'var(--text-color)',
              borderColor: 'var(--success-color)',
              marginBottom: '0.45rem',
            }}
          >
            10 / 10 Repeticiones completadas
          </span>
          <h3 style={{ margin: '0.35rem 0 0.25rem 0', fontSize: '1.4rem', color: 'var(--text-color)' }}>
            ¡Felicidades! Dominaste {sign.displayName}
          </h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-color)' }}>
            Completaste 5 repeticiones con tu mano derecha y 5 con tu mano izquierda. Tu progreso quedó guardado automáticamente.
          </p>
        </div>

        <div className="hand-counter-grid" style={{ width: '100%', maxWidth: '340px' }}>
          <HandProgressCard title="Mano Derecha" count={5} target={5} />
          <HandProgressCard title="Mano Izquierda" count={5} target={5} />
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.65rem',
            justifyContent: 'center',
            width: '100%',
            marginTop: '0.35rem',
          }}
        >
          {onNextSign && (
            <button
              type="button"
              className="btn-primary"
              onClick={onNextSign}
              style={{ padding: '0.7rem 1.25rem', fontSize: '0.88rem' }}
            >
              <span>Siguiente seña</span>
              <ArrowRight size={16} />
            </button>
          )}
          <button
            type="button"
            className="btn-outline"
            onClick={() => setPracticeState('active')}
            style={{ padding: '0.7rem 1.15rem', fontSize: '0.88rem' }}
          >
            <RotateCcw size={15} />
            <span>Practicar de nuevo</span>
          </button>
          {onBackToGroup && (
            <button
              type="button"
              className="btn-outline"
              onClick={onBackToGroup}
              style={{
                padding: '0.7rem 1.15rem',
                fontSize: '0.88rem',
                borderColor: 'var(--panel-border)',
                color: 'var(--text-color)',
              }}
            >
              <span>Ver categoría</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (practiceState === 'active') {
    return (
      <ActiveCameraPractice
        key={cameraAttempt}
        sign={sign}
        onCompleted={handleSessionCompleted}
        onStopCamera={() => setPracticeState('idle')}
        onRetryCamera={handleRetryCamera}
      />
    );
  }

  return (
    <div
      style={{
        background: 'var(--input-bg)',
        border: '1px solid var(--panel-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'clamp(1.25rem, 3vw, 2rem)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '0.85rem',
        minHeight: '300px',
      }}
    >
      <div
        style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          background: 'var(--accent-primary-bg)',
          color: 'var(--accent-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Camera size={28} />
      </div>

      <div>
        <h3 style={{ margin: '0 0 0.35rem 0', fontSize: '1.15rem', color: 'var(--text-color)' }}>
          Práctica Guiada en Vivo
        </h3>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', maxWidth: '320px' }}>
          Activa tu cámara aquí mismo para recibir correcciones paso a paso y completar 5 repeticiones con cada mano.
        </p>
      </div>

      {alreadyCompleted && (
        <span
          className="chip"
          style={{
            background: 'var(--success-bg)',
            color: 'var(--text-color)',
            borderColor: 'var(--success-color)',
          }}
        >
          <CheckCircle2 size={14} color="var(--success-color)" />
          <span>Ya completaste esta seña · Puedes volver a practicarla</span>
        </span>
      )}

      <div className="hand-counter-grid" style={{ width: '100%', maxWidth: '320px' }}>
        <HandProgressCard title="Mano Derecha" count={0} target={REPS_PER_HAND} />
        <HandProgressCard title="Mano Izquierda" count={0} target={REPS_PER_HAND} />
      </div>

      <button
        type="button"
        className="btn-primary"
        onClick={() => setPracticeState('active')}
        style={{
          width: '100%',
          maxWidth: '280px',
          padding: '0.8rem 1.25rem',
          fontSize: '0.92rem',
          marginTop: '0.25rem',
        }}
      >
        <Camera size={18} />
        <span>Iniciar práctica con cámara</span>
      </button>
    </div>
  );
};

export default GuidedPracticePanel;
