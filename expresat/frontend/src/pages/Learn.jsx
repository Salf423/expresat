import React, { useState, useEffect } from 'react';
import { BookOpen, Video, Users, Calendar, Palette, X, Camera, Info, ArrowRight } from 'lucide-react';

const learningModules = [
  {
    id: 'abecedario',
    title: 'Abecedario',
    icon: <BookOpen size={32} />,
    desc: 'Aprende las señas para cada letra del abecedario.',
    signs: [
      { id: 'a', name: 'Letra A', description: 'Primera vocal del abecedario.', instructions: 'Forma un puño con todos los dedos cerrados y coloca el pulgar extendido al costado del dedo índice.' },
      { id: 'b', name: 'Letra B', description: 'Primera consonante.', instructions: 'Mano abierta, los 4 dedos juntos apuntando hacia arriba y el pulgar doblado hacia el centro de la palma.' },
      { id: 'c', name: 'Letra C', description: 'Tercera letra del abecedario.', instructions: 'Curva todos los dedos de la mano formando un arco, asemejando la forma de la letra C.' },
    ]
  },
  {
    id: 'numeros',
    title: 'Números',
    icon: <BookOpen size={32} />,
    desc: 'Aprende a contar y expresar cantidades.',
    signs: [
      { id: '1', name: 'Uno', description: 'El primer número.', instructions: 'Mano cerrada, extiende únicamente el dedo índice hacia arriba.' },
      { id: '2', name: 'Dos', description: 'El número dos.', instructions: 'Mano cerrada, extiende los dedos índice y medio en forma de V.' },
    ]
  },
  {
    id: 'saludos',
    title: 'Saludos Básicos',
    icon: <Video size={32} />,
    desc: 'Hola, gracias, por favor y otras cortesías.',
    signs: [
      { id: 'hola', name: 'Hola', description: 'Saludo general e informal.', instructions: 'Coloca la mano derecha en la sien (como saludo militar) y aléjala hacia adelante y a la derecha.' },
      { id: 'gracias', name: 'Gracias', description: 'Expresión de gratitud.', instructions: 'Extiende la mano derecha desde la parte inferior del labio hacia adelante, dejando la palma hacia arriba.' }
    ]
  },
  {
    id: 'familia',
    title: 'Familia',
    icon: <Users size={32} />,
    desc: 'Señas relacionadas con el núcleo familiar.',
    signs: [
      { id: 'mama', name: 'Mamá', description: 'Referencia a la madre.', instructions: 'Golpea suavemente con el dedo índice derecho extendido sobre la mejilla repetidas veces.' },
      { id: 'papa', name: 'Papá', description: 'Referencia al padre.', instructions: 'Toca la frente repetidas veces con el dedo índice derecho, o con el pulgar e índice formando una "P".' }
    ]
  },
  {
    id: 'dias',
    title: 'Días y Meses',
    icon: <Calendar size={32} />,
    desc: 'Expresa tiempos y fechas correctamente.',
    signs: [
      { id: 'lunes', name: 'Lunes', description: 'Primer día de la semana laboral.', instructions: 'Con la mano en forma de "L" (pulgar e índice extendidos), haz pequeños círculos en el aire.' },
    ]
  },
  {
    id: 'colores',
    title: 'Colores',
    icon: <Palette size={32} />,
    desc: 'Los colores primarios y secundarios.',
    signs: [
      { id: 'rojo', name: 'Rojo', description: 'Color cálido primario.', instructions: 'Con el dedo índice apuntando hacia arriba, deslízalo hacia abajo tocando el mentón.' },
    ]
  }
];

const Learn = () => {
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedSign, setSelectedSign] = useState(null);

  // Prevent background scrolling when a modal is open
  useEffect(() => {
    if (selectedGroup || selectedSign) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [selectedGroup, selectedSign]);

  return (
    <div className="container animate-fade-in" style={{ padding: '4rem 1.5rem', minHeight: '100vh', position: 'relative' }}>
      {/* Main Content */}
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 className="gradient-text" style={{ fontSize: '3rem', marginBottom: '1rem', fontWeight: '800' }}>
          Aprende Lengua de Señas Mexicana
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '650px', margin: '0 auto', lineHeight: '1.6' }}>
          Selecciona una categoría para explorar el vocabulario, practicar con guías detalladas y poner a prueba tu aprendizaje con nuestro modelo interactivo.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
        {learningModules.map((module) => (
          <div 
            key={module.id} 
            className="glass-panel" 
            style={{ 
              padding: '2.5rem 2rem', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-5px)';
              e.currentTarget.style.boxShadow = '0 15px 30px rgba(0,0,0,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            onClick={() => setSelectedGroup(module)}
          >
            <div style={{ 
              color: 'var(--accent-primary)', 
              marginBottom: '1.5rem',
              background: 'rgba(0, 243, 255, 0.1)',
              padding: '1.5rem',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {module.icon}
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: '700' }}>{module.title}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '1rem', marginBottom: '2rem', flex: 1, lineHeight: '1.5' }}>
              {module.desc}
            </p>
            <button className="btn-outline" style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '0.5rem', alignItems: 'center' }}>
              Explorar <ArrowRight size={18} />
            </button>
          </div>
        ))}
      </div>

      {/* Group Modal */}
      {selectedGroup && !selectedSign && (
        <div style={modalOverlayStyle} onClick={() => setSelectedGroup(null)}>
          <div 
            className="glass-panel animate-fade-in" 
            style={modalContentStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <button style={closeBtnStyle} onClick={() => setSelectedGroup(null)}>
              <X size={24} />
            </button>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
              <div style={{ color: 'var(--accent-primary)' }}>{selectedGroup.icon}</div>
              <div>
                <h2 style={{ fontSize: '2rem', margin: 0 }}>{selectedGroup.title}</h2>
                <p style={{ color: 'var(--text-muted)', margin: '0.5rem 0 0 0' }}>Selecciona una seña para practicar</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
              {selectedGroup.signs.map(sign => (
                <div 
                  key={sign.id}
                  className="glass-panel"
                  style={{
                    padding: '1.5rem 1rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--glass-border)',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    e.currentTarget.style.borderColor = 'var(--glass-border)';
                  }}
                  onClick={() => setSelectedSign(sign)}
                >
                  <span style={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>{sign.name}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ver detalles</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sign Detail Modal */}
      {selectedSign && (
        <div style={{...modalOverlayStyle, zIndex: 9999}} onClick={() => { setSelectedSign(null); setSelectedGroup(null); }}>
          <div 
            className="glass-panel animate-fade-in" 
            style={{...modalContentStyle, maxWidth: '900px'}}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Back Button */}
            <button 
              style={{...closeBtnStyle, right: 'auto', left: '1.5rem', width: 'auto', padding: '0 1rem', gap: '0.5rem', borderRadius: '20px'}} 
              onClick={() => setSelectedSign(null)}
            >
              <ArrowRight size={20} style={{ transform: 'rotate(180deg)' }} /> Volver
            </button>

            {/* Close All Button */}
            <button style={closeBtnStyle} onClick={() => { setSelectedSign(null); setSelectedGroup(null); }}>
              <X size={24} />
            </button>
            
            <h2 style={{ fontSize: '2.5rem', marginBottom: '1.5rem', marginTop: '2.5rem', textAlign: 'center', color: 'var(--accent-primary)' }}>
              {selectedSign.name}
            </h2>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
              
              {/* Left Column: Info & Instructions */}
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Image Placeholder */}
                <div style={{
                  width: '100%',
                  height: '250px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '2px dashed var(--glass-border)',
                  borderRadius: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)'
                }}>
                  <p style={{ fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>[Espacio para imagen de ejemplo de {selectedSign.name}]</p>
                </div>

                <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>
                    <Info size={20} /> Descripción
                  </h4>
                  <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: '1.6' }}>{selectedSign.description}</p>
                </div>

                <div className="glass-panel" style={{ padding: '1.5rem', background: 'rgba(0, 243, 255, 0.05)', border: '1px solid rgba(0, 243, 255, 0.2)' }}>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>
                    <BookOpen size={20} /> Instrucciones
                  </h4>
                  <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: '1.6' }}>{selectedSign.instructions}</p>
                </div>
              </div>

              {/* Right Column: AI / Camera Interface */}
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: '350px' }}>
                <div style={{
                  flex: 1,
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  minHeight: '300px'
                }}>
                  <Camera size={48} style={{ color: 'var(--text-muted)', opacity: 0.5, marginBottom: '1rem' }} />
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '0 2rem' }}>
                    [Espacio para el feed de la cámara y modelo de IA]
                  </p>
                  
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    padding: '1rem',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                    display: 'flex',
                    justifyContent: 'center'
                  }}>
                    <button className="btn-primary" style={{ width: '80%', padding: '0.8rem' }}>
                      Activar Cámara
                    </button>
                  </div>
                </div>
                
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
                    Al activar la cámara, nuestro modelo evaluará tu postura y te dará retroalimentación en tiempo real.
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

// Extracted styles for Modals to keep JSX clean
const modalOverlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100vw',
  height: '100vh',
  background: 'rgba(0, 0, 0, 0.7)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9998,
  padding: '2rem'
};

const modalContentStyle = {
  width: '100%',
  maxWidth: '700px',
  maxHeight: '90vh',
  overflowY: 'auto',
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: '24px',
  padding: '3rem 2rem',
  position: 'relative',
  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
};

const closeBtnStyle = {
  position: 'absolute',
  top: '1.5rem',
  right: '1.5rem',
  background: 'rgba(255, 255, 255, 0.1)',
  border: 'none',
  borderRadius: '50%',
  width: '40px',
  height: '40px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  transition: 'background 0.2s',
};

export default Learn;
