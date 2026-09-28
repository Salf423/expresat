import React, { useState, useEffect } from 'react';
import { BookOpen, Video, Users, Calendar, Palette, X, Camera, Info, ArrowRight, ArrowLeft, CheckCircle2, Sparkles } from 'lucide-react';

const learningModules = [
  {
    id: 'abecedario',
    title: 'Abecedario',
    icon: <BookOpen size={28} />,
    desc: 'Domina las señas para cada letra del alfabeto dactilológico mexicano.',
    signs: [
      { id: 'a', name: 'Letra A', description: 'Primera vocal del abecedario.', instructions: 'Forma un puño con todos los dedos cerrados y coloca el pulgar extendido al costado del dedo índice.' },
      { id: 'b', name: 'Letra B', description: 'Primera consonante.', instructions: 'Mano abierta, los 4 dedos juntos apuntando hacia arriba y el pulgar doblado hacia el centro de la palma.' },
      { id: 'c', name: 'Letra C', description: 'Tercera letra del abecedario.', instructions: 'Curva todos los dedos de la mano formando un arco, asemejando la forma de la letra C.' },
    ]
  },
  {
    id: 'numeros',
    title: 'Números',
    icon: <BookOpen size={28} />,
    desc: 'Aprende a contar, señalar dígitos y expresar cantidades.',
    signs: [
      { id: '1', name: 'Número 1', description: 'El primer dígito.', instructions: 'Mano cerrada en puño, extiende únicamente el dedo índice hacia arriba.' },
      { id: '2', name: 'Número 2', description: 'El número dos.', instructions: 'Mano cerrada, extiende los dedos índice y medio en forma de V.' },
    ]
  },
  {
    id: 'saludos',
    title: 'Saludos Básicos',
    icon: <Video size={28} />,
    desc: 'Hola, gracias, por favor, buenos días y expresiones de cortesía cotidiana.',
    signs: [
      { id: 'hola', name: 'Hola', description: 'Saludo general e informal.', instructions: 'Coloca la mano derecha en la sien (como saludo de respeto) y extiéndela hacia adelante y a la derecha.' },
      { id: 'gracias', name: 'Gracias', description: 'Expresión de gratitud.', instructions: 'Extiende la mano derecha desde la parte inferior de la barbilla hacia adelante, con la palma mirando hacia arriba.' }
    ]
  },
  {
    id: 'familia',
    title: 'Familia',
    icon: <Users size={28} />,
    desc: 'Vocabulario para referirse al núcleo familiar y relaciones personales.',
    signs: [
      { id: 'mama', name: 'Mamá', description: 'Referencia a la madre.', instructions: 'Con el dedo índice derecho extendido, da dos toques suaves sobre la mejilla derecha.' },
      { id: 'papa', name: 'Papá', description: 'Referencia al padre.', instructions: 'Toca la frente repetidas veces con el pulgar e índice formando una "P".' }
    ]
  },
  {
    id: 'dias',
    title: 'Días y Calendario',
    icon: <Calendar size={28} />,
    desc: 'Expresa los días de la semana, meses y referencias temporales.',
    signs: [
      { id: 'lunes', name: 'Lunes', description: 'Primer día laboral de la semana.', instructions: 'Con la mano en forma de "L" (pulgar e índice extendidos), realiza pequeños círculos en el aire.' },
    ]
  },
  {
    id: 'colores',
    title: 'Colores',
    icon: <Palette size={28} />,
    desc: 'Aprende a identificar y nombrar la paleta de colores en LSM.',
    signs: [
      { id: 'rojo', name: 'Rojo', description: 'Color cálido primario.', instructions: 'Con el dedo índice apuntando hacia arriba, deslízalo suavemente hacia abajo tocando el labio inferior o mentón.' },
    ]
  }
];

const Learn = () => {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedSign, setSelectedSign] = useState(null);

  // Prevent background scrolling when a modal is open and handle Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (selectedSign) {
          setSelectedSign(null);
        } else if (selectedGroup) {
          setSelectedGroup(null);
        }
      }
    };

    if (selectedGroup || selectedSign) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedGroup, selectedSign]);

  return (
    <div className="container animate-fade-in" style={{ padding: '3rem 1.5rem 6rem 1.5rem', flex: 1, position: 'relative' }}>
      {/* Header */}
      <div className="section-heading" style={{ marginBottom: '3.5rem' }}>
        <span className="chip" style={{ marginBottom: '1rem' }}>
          <Sparkles size={14} /> Módulos Interactivos
        </span>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.25rem)', fontWeight: 800 }}>
          Aprende Lengua de Señas Mexicana
        </h1>
        <p style={{ maxWidth: '650px', margin: '0 auto', fontSize: '1.1rem' }}>
          Selecciona una categoría para explorar el vocabulario, practicar con instrucciones anatómicas paso a paso y prepararte para la interacción en vivo.
        </p>
      </div>

      {/* Grid of Learning Modules */}
      <div className="grid-auto">
        {learningModules.map((module) => (
          <div 
            key={module.id} 
            className="glass-panel module-card"
            role="button"
            tabIndex={0}
            aria-label={`Módulo ${module.title}`}
            onClick={() => setSelectedGroup(module)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedGroup(module); }}
          >
            <div className="module-card__icon">
              {module.icon}
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, color: 'var(--text-color)' }}>
              {module.title}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.6', margin: 0, flex: 1 }}>
              {module.desc}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                {module.signs.length} {module.signs.length === 1 ? 'seña' : 'señas'}
              </span>
              <span className="btn-outline" style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}>
                <span>Explorar</span>
                <ArrowRight size={14} />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Modal 1: Signs Group List */}
      {selectedGroup && !selectedSign && (
        <div 
          className="modal-overlay" 
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-modal-title"
          onClick={() => setSelectedGroup(null)}
        >
          <div 
            className="modal-content"
            style={{ maxWidth: '640px', padding: '2rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <div className="module-card__icon" style={{ width: '44px', height: '44px' }}>
                  {selectedGroup.icon}
                </div>
                <div>
                  <h2 id="group-modal-title" style={{ fontSize: '1.5rem', margin: 0 }}>
                    {selectedGroup.title}
                  </h2>
                  <p style={{ color: 'var(--text-muted)', margin: '0.2rem 0 0 0', fontSize: '0.85rem' }}>
                    Selecciona una seña para ver instrucciones anatómicas
                  </p>
                </div>
              </div>

              <button 
                type="button"
                className="btn-icon"
                onClick={() => setSelectedGroup(null)}
                aria-label="Cerrar ventana"
                style={{ width: '36px', height: '36px', borderRadius: '50%' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.85rem', maxHeight: '55dvh', overflowY: 'auto', padding: '0.25rem' }}>
              {selectedGroup.signs.map(sign => (
                <div 
                  key={sign.id}
                  className="glass-panel"
                  role="button"
                  tabIndex={0}
                  style={{
                    padding: '1.25rem 1rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                    background: 'var(--input-bg)'
                  }}
                  onClick={() => setSelectedSign(sign)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedSign(sign); }}
                >
                  <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-color)' }}>
                    {sign.name}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.2rem' }}>
                    Ver guía <ArrowRight size={12} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Sign Detail & Practice */}
      {selectedSign && (
        <div 
          className="modal-overlay" 
          role="dialog"
          aria-modal="true"
          aria-labelledby="sign-detail-title"
          onClick={() => { setSelectedSign(null); setSelectedGroup(null); }}
        >
          <div 
            className="modal-content"
            style={{ maxWidth: '850px', padding: '2rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.75rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
              <button 
                type="button"
                className="btn-outline"
                style={{ padding: '0.4rem 0.9rem', fontSize: '0.85rem', borderRadius: 'var(--radius-full)' }}
                onClick={() => setSelectedSign(null)}
              >
                <ArrowLeft size={16} /> Volver a {selectedGroup?.title || 'la lista'}
              </button>

              <button 
                type="button"
                className="btn-icon"
                onClick={() => { setSelectedSign(null); setSelectedGroup(null); }}
                aria-label="Cerrar modal"
                style={{ width: '36px', height: '36px', borderRadius: '50%' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <span className="chip" style={{ marginBottom: '0.5rem' }}>{selectedGroup?.title}</span>
              <h2 id="sign-detail-title" className="gradient-text" style={{ fontSize: '2.25rem', fontWeight: 800 }}>
                {selectedSign.name}
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.75rem' }}>
              {/* Left Column: Visual Guide & Instructions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div 
                  style={{
                    width: '100%',
                    height: '200px',
                    background: 'var(--input-bg)',
                    border: '1.5px dashed var(--panel-border)',
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-muted)',
                    gap: '0.5rem',
                    padding: '1rem',
                    textAlign: 'center'
                  }}
                >
                  <Sparkles size={28} color="var(--accent-primary)" />
                  <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Esquema visual de referencia</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Representación postural para "{selectedSign.name}"</span>
                </div>

                <div className="glass-panel" style={{ padding: '1.25rem' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.5rem 0', fontSize: '0.95rem' }}>
                    <Info size={17} color="var(--accent-primary)" /> Significado
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    {selectedSign.description}
                  </p>
                </div>

                <div className="glass-panel" style={{ padding: '1.25rem', borderColor: 'var(--accent-primary-border)', background: 'var(--accent-primary-bg)' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.5rem 0', fontSize: '0.95rem', color: 'var(--accent-primary)' }}>
                    <CheckCircle2 size={17} /> Instrucciones de Ejecución
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-color)', lineHeight: '1.6' }}>
                    {selectedSign.instructions}
                  </p>
                </div>
              </div>

              {/* Right Column: Interactive Practice Preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div 
                  style={{
                    flex: 1,
                    background: '#07090f',
                    border: '1px solid var(--panel-border)',
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden',
                    minHeight: '280px',
                    padding: '1.5rem',
                    textAlign: 'center'
                  }}
                >
                  <Camera size={40} color="var(--accent-primary)" style={{ opacity: 0.8, marginBottom: '0.75rem' }} />
                  <span style={{ color: '#fff', fontSize: '1rem', fontWeight: 600 }}>
                    Práctica Guiada con IA
                  </span>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '260px', marginTop: '0.4rem' }}>
                    Verifica si tu postura manual coincide con el estándar de LSM
                  </p>
                  
                  <div style={{ marginTop: '1.5rem', width: '100%', maxWidth: '240px' }}>
                    <a 
                      href="/translator" 
                      className="btn-primary" 
                      style={{ width: '100%', fontSize: '0.9rem', padding: '0.7rem' }}
                    >
                      <span>Abrir en Traductor</span>
                      <ArrowRight size={16} />
                    </a>
                  </div>
                </div>

                <div style={{ padding: '0.5rem', textAlign: 'center' }}>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', margin: 0 }}>
                    El motor de inferencia MediaPipe procesará tus articulaciones sin salir de tu dispositivo.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Learn;
