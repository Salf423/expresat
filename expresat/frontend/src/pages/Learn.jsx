import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Hash,
  BookOpen,
  MessageSquare,
  HeartHandshake,
  X,
  Info,
  ArrowLeft,
  CheckCircle2,
  Hand,
  Trophy,
} from 'lucide-react';
import {
  LEARNING_CATEGORIES,
  ALL_LEARNING_SIGN_IDS,
  FINGER_ORDER,
  FINGER_LABELS_ES,
} from '../learning/index.js';
import {
  readCompletedSigns,
  markSignCompleted,
  computeProgressStats,
} from '../utils/progressCookie.js';
import GuidedPracticePanel from '../components/GuidedPracticePanel.jsx';

const CATEGORY_ICONS = Object.freeze({
  hash: <Hash size={26} aria-hidden="true" />,
  book: <BookOpen size={26} aria-hidden="true" />,
  message: <MessageSquare size={26} aria-hidden="true" />,
  heart: <HeartHandshake size={26} aria-hidden="true" />,
});

function describeExpectedPostureBadges(sign) {
  const badges = [];
  const profile = sign?.profile;
  if (!profile) return badges;

  if (profile.pinch) {
    badges.push({ label: 'Pulgar + Índice en círculo', highlight: true });
  } else if (profile.zeroOval) {
    badges.push({ label: 'Dedos en óvalo (forma O)', highlight: true });
  } else {
    const extended = FINGER_ORDER.filter((key) => profile.fingers[key] === true);
    if (extended.length === 0) {
      badges.push({ label: 'Todos los dedos cerrados (Puño)', highlight: true });
    } else if (extended.length === 5) {
      badges.push({ label: 'Los 5 dedos abiertos', highlight: true });
    } else {
      for (const key of extended) {
        const name = FINGER_LABELS_ES[key];
        badges.push({
          label: `${name.charAt(0).toUpperCase() + name.slice(1)} extendido`,
          highlight: true,
        });
      }
    }
  }

  if (profile.orientation === 'FRONT') {
    badges.push({ label: 'Palma al frente', highlight: false });
  } else if (profile.orientation === 'BACK') {
    badges.push({ label: 'Dorso a la cámara', highlight: false });
  }

  if (profile.dynamicMotion === 'wave') {
    badges.push({ label: 'Movimiento lateral (saludo)', highlight: false });
  } else if (profile.dynamicMotion === 'rotation') {
    badges.push({ label: 'Giro de muñeca palma ↔ dorso', highlight: false });
  }

  return badges;
}

const Learn = () => {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedSign, setSelectedSign] = useState(null);
  const [completedIds, setCompletedIds] = useState(() =>
    readCompletedSigns(ALL_LEARNING_SIGN_IDS)
  );

  const modalCloseBtnRef = useRef(null);
  const lastFocusedRef = useRef(null);

  const completedSet = useMemo(() => new Set(completedIds), [completedIds]);
  const globalProgress = useMemo(
    () => computeProgressStats(completedIds, ALL_LEARNING_SIGN_IDS),
    [completedIds]
  );

  const handleSignCompleted = useCallback((signId) => {
    const updated = markSignCompleted(signId, { validIds: ALL_LEARNING_SIGN_IDS });
    setCompletedIds(updated);
  }, []);

  const openGroup = useCallback((category) => {
    lastFocusedRef.current = document.activeElement;
    setSelectedGroup(category);
  }, []);

  const closeAllModals = useCallback(() => {
    setSelectedSign(null);
    setSelectedGroup(null);
    const prev = lastFocusedRef.current;
    if (prev && typeof prev.focus === 'function') {
      requestAnimationFrame(() => prev.focus());
    }
  }, []);

  // Lock background scroll and handle Escape while any modal is open
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (selectedSign) {
          setSelectedSign(null);
        } else if (selectedGroup) {
          closeAllModals();
        }
      }
    };

    if (selectedGroup || selectedSign) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
      requestAnimationFrame(() => modalCloseBtnRef.current?.focus());
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedGroup, selectedSign, closeAllModals]);

  const nextSignInGroup = useMemo(() => {
    if (!selectedGroup || !selectedSign) return null;
    const idx = selectedGroup.signs.findIndex((s) => s.id === selectedSign.id);
    if (idx < 0 || idx + 1 >= selectedGroup.signs.length) return null;
    return selectedGroup.signs[idx + 1];
  }, [selectedGroup, selectedSign]);

  const postureBadges = useMemo(
    () => (selectedSign ? describeExpectedPostureBadges(selectedSign) : []),
    [selectedSign]
  );

  return (
    <div
      className="container animate-fade-in"
      style={{ padding: '2.5rem 1.5rem 6rem 1.5rem', flex: 1, position: 'relative' }}
    >
      {/* Header */}
      <header className="section-heading" style={{ marginBottom: '2.25rem' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.15rem)', fontWeight: 800, marginBottom: '0.75rem' }}>
          Aprende Lengua de Señas Mexicana
        </h1>
        <p style={{ maxWidth: '640px', margin: '0 auto', fontSize: '1.05rem' }}>
          Elige una categoría para descubrir cada seña y practicar en vivo frente a tu cámara con
          guía paso a paso para ambas manos.
        </p>
      </header>

      {/* Global Progress Bar Card (persisted in browser cookie) */}
      <section
        aria-label="Progreso de aprendizaje en LSM"
        className="glass-panel"
        style={{
          padding: 'clamp(1.1rem, 3vw, 1.5rem)',
          marginBottom: '2.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                background:
                  globalProgress.percentage === 100
                    ? 'var(--success-bg)'
                    : 'var(--accent-primary-bg)',
                color:
                  globalProgress.percentage === 100
                    ? 'var(--success-color)'
                    : 'var(--accent-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Trophy size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                Tu progreso en LSM
              </h2>
              <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                {globalProgress.percentage === 100
                  ? '¡Excelente trabajo! Completaste todas las señas disponibles.'
                  : 'Completa 5 repeticiones con tu mano derecha y 5 con tu mano izquierda en cada seña.'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <strong
              data-testid="learn-global-progress-text"
              style={{
                fontSize: '0.95rem',
                color: 'var(--text-color)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {globalProgress.completedCount} / {globalProgress.totalCount} señas completadas
            </strong>
            <span
              className="chip"
              style={{
                fontSize: '0.78rem',
                fontVariantNumeric: 'tabular-nums',
                background:
                  globalProgress.percentage === 100
                    ? 'var(--success-bg)'
                    : 'var(--accent-primary-bg)',
                color: 'var(--text-color)',
                borderColor:
                  globalProgress.percentage === 100
                    ? 'var(--success-color)'
                    : 'var(--accent-primary-border)',
              }}
            >
              {globalProgress.percentage}%
            </span>
          </div>
        </div>

        <div
          className="learn-progress-track"
          role="progressbar"
          aria-label="Señas completadas en el curso"
          aria-valuenow={globalProgress.completedCount}
          aria-valuemin={0}
          aria-valuemax={globalProgress.totalCount}
        >
          <div
            className="learn-progress-fill"
            style={{ width: `${globalProgress.percentage}%` }}
          />
        </div>
      </section>

      {/* 4 Official Categories Grid */}
      <section aria-label="Categorías de aprendizaje">
        <div className="learn-categories-grid">
          {LEARNING_CATEGORIES.map((category) => {
            const catCompleted = category.signs.filter((s) => completedSet.has(s.id)).length;
            const catTotal = category.signs.length;
            const catPct = catTotal > 0 ? Math.round((catCompleted / catTotal) * 100) : 0;
            const isCategoryDone = catTotal > 0 && catCompleted === catTotal;

            return (
              <button
                key={category.id}
                type="button"
                className="glass-panel module-card learn-card-button"
                aria-label={`Abrir categoría ${category.title}, ${catCompleted} de ${catTotal} señas completadas`}
                onClick={() => openGroup(category)}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    gap: '0.5rem',
                  }}
                >
                  <div className="module-card__icon">
                    {CATEGORY_ICONS[category.iconKey] || <BookOpen size={26} aria-hidden="true" />}
                  </div>
                  {isCategoryDone && (
                    <span
                      className="chip"
                      style={{
                        background: 'var(--success-bg)',
                        color: 'var(--text-color)',
                        borderColor: 'var(--success-color)',
                      }}
                    >
                      <CheckCircle2 size={14} color="var(--success-color)" aria-hidden="true" />
                      <span>Completada</span>
                    </span>
                  )}
                </div>

                <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: 'var(--text-color)' }}>
                  {category.title}
                </h2>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.9rem',
                    lineHeight: 1.6,
                    margin: 0,
                    flex: 1,
                  }}
                >
                  {category.description}
                </p>

                {/* Per-category mini progress bar */}
                <div style={{ width: '100%', marginTop: '0.25rem' }}>
                  <div
                    className="learn-progress-track"
                    style={{ height: '6px' }}
                    aria-hidden="true"
                  >
                    <div
                      className="learn-progress-fill"
                      style={{ width: `${catPct}%` }}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    marginTop: '0.35rem',
                    paddingTop: '0.85rem',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.82rem',
                      color: 'var(--text-muted)',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {catCompleted}/{catTotal} {catTotal === 1 ? 'seña' : 'señas'}
                  </span>
                  <span
                    className="btn-outline"
                    style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', pointerEvents: 'none' }}
                  >
                    Practicar
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Modal 1: Category Sign List (rendered via React Portal above fixed Navbar) */}
      {selectedGroup &&
        !selectedSign &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-modal-title"
            onClick={closeAllModals}
          >
            <div
              className="modal-content learn-modal-content--group"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="learn-modal-topbar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', minWidth: 0 }}>
                  <div
                    className="module-card__icon"
                    style={{ width: '42px', height: '42px', flexShrink: 0 }}
                  >
                    {CATEGORY_ICONS[selectedGroup.iconKey] || <BookOpen size={22} aria-hidden="true" />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h2
                      id="group-modal-title"
                      style={{ fontSize: 'clamp(1.2rem, 3vw, 1.5rem)', margin: 0 }}
                    >
                      {selectedGroup.title}
                    </h2>
                    <p
                      style={{
                        color: 'var(--text-muted)',
                        margin: '0.15rem 0 0 0',
                        fontSize: '0.84rem',
                      }}
                    >
                      Elige una seña para practicar en vivo con tu cámara
                    </p>
                  </div>
                </div>

                <button
                  ref={modalCloseBtnRef}
                  type="button"
                  className="btn-icon"
                  onClick={closeAllModals}
                  aria-label="Cerrar ventana"
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    background: 'var(--input-bg)',
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="learn-modal-body">
                <div className="learn-signs-grid">
                  {selectedGroup.signs.map((sign) => {
                    const isDone = completedSet.has(sign.id);
                    return (
                      <button
                        key={sign.id}
                        type="button"
                        className="glass-panel learn-card-button"
                        aria-label={`Practicar ${sign.displayName}${isDone ? ', completada' : ''}`}
                        style={{
                          padding: '1.1rem 0.95rem',
                          borderRadius: 'var(--radius-md)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.45rem',
                          background: isDone ? 'var(--success-bg)' : 'var(--input-bg)',
                          borderColor: isDone ? 'var(--success-color)' : 'var(--panel-border)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setSelectedSign(sign)}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.4rem',
                            width: '100%',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '1.05rem',
                              fontWeight: 700,
                              color: 'var(--text-color)',
                            }}
                          >
                            {sign.displayName}
                          </span>
                          {isDone && (
                            <CheckCircle2
                              size={18}
                              color="var(--success-color)"
                              style={{ flexShrink: 0 }}
                              aria-label="Seña completada"
                            />
                          )}
                        </div>

                        <span
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--text-muted)',
                            lineHeight: 1.4,
                          }}
                        >
                          {sign.hint}
                        </span>

                        <div
                          style={{
                            marginTop: 'auto',
                            paddingTop: '0.4rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.4rem',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.76rem',
                              fontWeight: 600,
                              color: 'var(--accent-primary)',
                            }}
                          >
                            {isDone ? 'Practicar otra vez' : 'Practicar ahora'}
                          </span>
                          {sign.type === 'dynamic' && (
                            <span
                              style={{
                                fontSize: '0.68rem',
                                padding: '0.1rem 0.45rem',
                                borderRadius: 'var(--radius-full)',
                                background: 'var(--accent-secondary-bg)',
                                color: 'var(--text-color)',
                                fontWeight: 600,
                              }}
                            >
                              Movimiento
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Modal 2: Sign Detail + Integrated Live Camera Practice (via React Portal) */}
      {selectedSign &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-detail-title"
            onClick={closeAllModals}
          >
            <div
              className="modal-content learn-modal-content--practice"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sticky Top Bar (never cut off behind Navbar) */}
              <div className="learn-modal-topbar">
                <button
                  type="button"
                  className="btn-outline"
                  style={{
                    padding: '0.42rem 0.9rem',
                    fontSize: '0.84rem',
                    borderRadius: 'var(--radius-full)',
                  }}
                  onClick={() => setSelectedSign(null)}
                >
                  <ArrowLeft size={16} />
                  <span>Volver a {selectedGroup?.title || 'categorías'}</span>
                </button>

                <button
                  ref={modalCloseBtnRef}
                  type="button"
                  className="btn-icon"
                  onClick={closeAllModals}
                  aria-label="Cerrar modal de práctica"
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    background: 'var(--input-bg)',
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div className="learn-modal-body">
                {/* Sign Header */}
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                      marginBottom: '0.45rem',
                    }}
                  >
                    <span className="chip">{selectedGroup?.title}</span>
                    {completedSet.has(selectedSign.id) && (
                      <span
                        className="chip"
                        style={{
                          background: 'var(--success-bg)',
                          color: 'var(--text-color)',
                          borderColor: 'var(--success-color)',
                        }}
                      >
                        <CheckCircle2 size={14} color="var(--success-color)" aria-hidden="true" />
                        <span>Completada</span>
                      </span>
                    )}
                  </div>
                  <h2
                    id="sign-detail-title"
                    className="gradient-text"
                    style={{ fontSize: 'clamp(1.6rem, 4vw, 2.2rem)', fontWeight: 800, margin: 0 }}
                  >
                    {selectedSign.displayName}
                  </h2>
                </div>

                {/* Responsive Two-Column Practice Layout */}
                <div className="learn-practice-layout">
                  {/* Left Column: Visual Posture Guide & Step Instructions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div
                      className="glass-panel--static"
                      style={{
                        padding: '1.15rem',
                        background: 'var(--input-bg)',
                      }}
                    >
                      <h3
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          margin: '0 0 0.7rem 0',
                          fontSize: '0.95rem',
                        }}
                      >
                        <Hand size={17} color="var(--accent-primary)" aria-hidden="true" />
                        <span>Postura clave</span>
                      </h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                        {postureBadges.map((badge) => (
                          <span
                            key={badge.label}
                            className="chip"
                            style={{
                              fontSize: '0.78rem',
                              background: badge.highlight
                                ? 'var(--accent-primary-bg)'
                                : 'var(--panel-bg-solid)',
                              color: 'var(--text-color)',
                              borderColor: badge.highlight
                                ? 'var(--accent-primary-border)'
                                : 'var(--panel-border)',
                            }}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="glass-panel--static" style={{ padding: '1.15rem' }}>
                      <h3
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          margin: '0 0 0.45rem 0',
                          fontSize: '0.95rem',
                        }}
                      >
                        <Info size={17} color="var(--accent-primary)" aria-hidden="true" />
                        <span>Significado</span>
                      </h3>
                      <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        {selectedSign.meaning}
                      </p>
                    </div>

                    <div
                      className="glass-panel--static"
                      style={{
                        padding: '1.15rem',
                        borderColor: 'var(--accent-primary-border)',
                        background: 'var(--accent-primary-bg)',
                      }}
                    >
                      <h3
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          margin: '0 0 0.45rem 0',
                          fontSize: '0.95rem',
                          color: 'var(--text-color)',
                        }}
                      >
                        <CheckCircle2 size={17} color="var(--accent-primary)" aria-hidden="true" />
                        <span>Cómo hacerla paso a paso</span>
                      </h3>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.9rem',
                          color: 'var(--text-color)',
                          lineHeight: 1.6,
                        }}
                      >
                        {selectedSign.instructions}
                      </p>
                    </div>
                  </div>

                  {/* Right Column: Integrated Live Camera & 5+5 Correction Engine */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <GuidedPracticePanel
                      key={selectedSign.id}
                      sign={selectedSign}
                      alreadyCompleted={completedSet.has(selectedSign.id)}
                      onSignCompleted={handleSignCompleted}
                      onNextSign={
                        nextSignInGroup ? () => setSelectedSign(nextSignInGroup) : null
                      }
                      onBackToGroup={() => setSelectedSign(null)}
                    />
                    <p
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--text-muted)',
                        textAlign: 'center',
                        margin: 0,
                      }}
                    >
                      Tu cámara funciona de forma privada en tu navegador: ninguna imagen se graba ni sale de tu dispositivo.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default Learn;
