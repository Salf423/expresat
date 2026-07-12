import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  BrainCircuit,
  Server,
  PenTool,
  Code,
  HeartHandshake,
  Github,
  Linkedin,
  Mail,
  ChevronRight
} from 'lucide-react';

const teamMembers = [
  {
    id: 1,
    name: 'Ana Laura Gómez',
    role: 'Project Lead',
    department: 'Management',
    icon: <Users size={36} strokeWidth={1.5} />,
    color: 'var(--accent)',
    description: 'Responsable de la dirección estratégica, coordinación de entregables y la integración integral de los componentes de IA y frontend. Lidera la visión del producto asegurando que las necesidades de la comunidad sorda sean la prioridad en cada etapa.',
    contributions: [
      'Definición de requerimientos funcionales y alcance del proyecto.',
      'Gestión de sprints ágiles y comunicación continua con stakeholders.',
      'Coordinación de grupos focales y pruebas de usabilidad iniciales con la comunidad.'
    ],
    timeline: [
      { date: 'Mes 1', event: 'Definición del roadmap e inicio del proyecto.' },
      { date: 'Mes 3', event: 'Coordinación del primer prototipo funcional.' },
      { date: 'Mes 5', event: 'Lanzamiento de la versión beta y análisis de feedback.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 2,
    name: 'Carlos Mendoza',
    role: 'AI Engineer',
    department: 'Engineering',
    icon: <BrainCircuit size={36} strokeWidth={1.5} />,
    color: 'var(--accent)',
    description: 'Especialista en visión por computadora e inteligencia artificial. Arquitecto principal detrás de los modelos de reconocimiento de LSM, enfocado en lograr alta precisión con baja latencia en entornos web.',
    contributions: [
      'Entrenamiento de modelos LSTM para clasificación de señas dinámicas.',
      'Optimización de la detección de puntos clave (landmarks) utilizando MediaPipe.',
      'Creación del pipeline de preprocesamiento de coordenadas espaciales en tiempo real.'
    ],
    timeline: [
      { date: 'Mes 1', event: 'Investigación de MediaPipe y extracción de landmarks.' },
      { date: 'Mes 2', event: 'Entrenamiento del modelo clasificador secuencial (LSTM).' },
      { date: 'Mes 4', event: 'Integración y cuantización del modelo optimizado en el servidor.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 3,
    name: 'Elena Rostova',
    role: 'Backend Developer',
    department: 'Engineering',
    icon: <Server size={36} strokeWidth={1.5} />,
    color: 'var(--accent)',
    description: 'Ingeniera de software encargada de construir la infraestructura del servidor, conexiones de WebSocket de baja latencia y la arquitectura de bases de datos para un rendimiento impecable.',
    contributions: [
      'Desarrollo de la API robusta y asíncrona utilizando FastAPI.',
      'Implementación de conexión bidireccional y streaming mediante WebSockets.',
      'Integración con Supabase para la gestión segura de autenticación y almacenamiento de perfiles.'
    ],
    timeline: [
      { date: 'Mes 2', event: 'Creación del servidor FastAPI base y ruteo inicial.' },
      { date: 'Mes 3', event: 'Implementación del canal WebSocket bidireccional en tiempo real.' },
      { date: 'Mes 4', event: 'Diseño de la base de datos y flujos seguros de autenticación.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 4,
    name: 'Mateo Ortiz',
    role: 'UI/UX Designer',
    department: 'Design',
    icon: <PenTool size={36} strokeWidth={1.5} />,
    color: 'var(--accent)',
    description: 'Creador de la identidad visual de ExpresaT V2. Diseñó todas las interfaces interactivas adaptando el estilo Glassmorphism moderno para asegurar una experiencia de usuario limpia, accesible y premium.',
    contributions: [
      'Diseño en Figma de alta fidelidad, wireframes y prototipos interactivos.',
      'Creación de la guía de estilos maestra (paleta de colores, tipografía y tokens).',
      'Investigación y aplicación estricta de patrones de accesibilidad visual (contraste, jerarquía).'
    ],
    timeline: [
      { date: 'Mes 1', event: 'Investigación de User Personas, wireframes y propuesta de marca.' },
      { date: 'Mes 3', event: 'Diseño final en Figma del traductor y el área de aprendizaje interactiva.' },
      { date: 'Mes 5', event: 'Validación heurística de la interfaz final y refinamiento de UX.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 5,
    name: 'Sofía Valenzuela',
    role: 'Frontend Developer',
    department: 'Engineering',
    icon: <Code size={36} strokeWidth={1.5} />,
    color: 'var(--accent)',
    description: 'Desarrolladora frontend responsable de dar vida a los diseños a través de componentes React. Apasionada por las microinteracciones fluidas y el rendimiento del cliente.',
    contributions: [
      'Estructuración del proyecto en React y configuración del ruteo SPA.',
      'Implementación del reproductor de video de cámara y el lienzo de renderizado de landmarks.',
      'Integración de animaciones CSS avanzadas, transiciones Fluid y efectos Glassmorphism.'
    ],
    timeline: [
      { date: 'Mes 3', event: 'Configuración inicial del ecosistema React y estructura de la SPA.' },
      { date: 'Mes 4', event: 'Integración del feed de cámara web y respuesta visual de la IA.' },
      { date: 'Mes 5', event: 'Pulido estético general, accesibilidad DOM y optimización de rendimiento.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 6,
    name: 'Diego López',
    role: 'LSM Specialist',
    department: 'Research & QA',
    icon: <HeartHandshake size={36} strokeWidth={1.5} />,
    color: 'var(--accent)',
    description: 'Intérprete experto y consultor lingüístico de la Lengua de Señas Mexicana. Su labor fue fundamental para garantizar que las traducciones e interpretación del modelo sean cultural y gramaticalmente correctas.',
    contributions: [
      'Creación del dataset base de señas asegurando la estructura gramatical y semántica correcta.',
      'Auditoría minuciosa y corrección de la interpretación arrojada por el modelo de IA.',
      'Vinculación y empatía directa con la comunidad sorda para dirigir las pruebas piloto.'
    ],
    timeline: [
      { date: 'Mes 2', event: 'Recopilación, validación y etiquetado preciso del dataset de LSM.' },
      { date: 'Mes 4', event: 'Evaluación lingüística exhaustiva de las predicciones del modelo.' },
      { date: 'Mes 5', event: 'Ejecución de pruebas de campo reales con usuarios nativos sordos.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  }
];

const About = () => {
  const [selectedMember, setSelectedMember] = useState(null);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && selectedMember) {
        setSelectedMember(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMember]);

  // Handle body scroll locking when modal is open
  useEffect(() => {
    if (selectedMember) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [selectedMember]);

  return (
    <div className="container animate-fade-in" style={{ padding: '4rem 1.5rem' }}>
      <style>{`
        .team-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem;
          margin-top: 4rem;
        }
        @media (max-width: 992px) {
          .team-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 600px) {
          .team-grid {
            grid-template-columns: 1fr;
          }
        }

        .member-card {
          cursor: pointer;
          transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), 
                      box-shadow 0.3s ease, 
                      border-color 0.3s ease,
                      background-color 0.3s ease;
          border: 1px solid var(--border);
          border-radius: 20px;
          background: var(--code-bg);
          padding: 2.5rem 2rem;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          box-shadow: var(--shadow);
          opacity: 0;
          animation: slideUpFade 0.6s ease-out forwards;
          position: relative;
          overflow: hidden;
        }
        
        .member-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; width: 100%; height: 4px;
          background: linear-gradient(90deg, transparent, var(--accent), transparent);
          opacity: 0;
          transition: opacity 0.3s;
        }

        .member-card:hover, .member-card:focus-visible {
          transform: translateY(-8px);
          border-color: var(--accent);
          background: var(--bg);
          outline: none;
        }
        
        .member-card:hover::before, .member-card:focus-visible::before {
          opacity: 1;
        }

        /* Staggered animation delays */
        .member-card:nth-child(1) { animation-delay: 0.1s; }
        .member-card:nth-child(2) { animation-delay: 0.2s; }
        .member-card:nth-child(3) { animation-delay: 0.3s; }
        .member-card:nth-child(4) { animation-delay: 0.4s; }
        .member-card:nth-child(5) { animation-delay: 0.5s; }
        .member-card:nth-child(6) { animation-delay: 0.6s; }

        @keyframes slideUpFade {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .department-badge {
          font-size: 0.7rem;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 1.2px;
          color: var(--text);
          background: var(--border);
          padding: 0.35rem 0.8rem;
          border-radius: 20px;
          margin-bottom: 1.5rem;
          transition: background 0.3s, color 0.3s;
        }

        .member-card:hover .department-badge {
          background: var(--accent-bg);
          color: var(--accent);
        }

        .member-avatar {
          color: var(--accent);
          margin-bottom: 1.5rem;
          background: var(--accent-bg);
          width: 85px;
          height: 85px;
          border-radius: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--accent-border);
          transition: transform 0.3s ease, border-radius 0.3s ease;
          transform: rotate(-3deg);
        }

        .member-card:hover .member-avatar {
          transform: rotate(3deg) scale(1.05);
          border-radius: 50%;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          animation: fadeIn 0.3s ease-out;
          padding: 1.5rem;
          box-sizing: border-box;
        }

        .modal-content {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 24px;
          max-width: 700px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          padding: 3rem;
          position: relative;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          text-align: left;
        }

        .modal-content::-webkit-scrollbar {
          width: 8px;
        }
        .modal-content::-webkit-scrollbar-track {
          background: transparent;
        }
        .modal-content::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 10px;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { transform: scale(0.95) translateY(20px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }

        .modal-close {
          position: absolute;
          top: 1.5rem;
          right: 1.5rem;
          background: var(--code-bg);
          border: 1px solid var(--border);
          color: var(--text-h);
          border-radius: 50%;
          cursor: pointer;
          padding: 0.6rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          z-index: 10;
        }
        .modal-close:hover {
          background: var(--accent);
          border-color: var(--accent);
          color: white;
          transform: rotate(90deg);
        }

        .social-links {
          display: flex;
          gap: 0.8rem;
          margin-top: 1rem;
        }

        .social-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--code-bg);
          color: var(--text);
          border: 1px solid var(--border);
          transition: all 0.2s;
        }

        .social-btn:hover {
          background: var(--accent-bg);
          color: var(--accent);
          border-color: var(--accent-border);
          transform: translateY(-2px);
        }

        .modal-timeline {
          position: relative;
          border-left: 2px dashed var(--border);
          padding-left: 2rem;
          margin-top: 1.5rem;
          margin-left: 0.5rem;
        }
        
        .modal-timeline-item {
          position: relative;
          margin-bottom: 2rem;
        }
        .modal-timeline-item:last-child {
          margin-bottom: 0;
        }
        
        .modal-timeline-badge {
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--accent);
          background: var(--accent-bg);
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          margin-bottom: 0.6rem;
          border: 1px solid var(--accent-border);
        }
        
        .modal-timeline-item::before {
          content: '';
          position: absolute;
          left: -2.45rem;
          top: 0.5rem;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--bg);
          border: 3px solid var(--accent);
          box-shadow: 0 0 0 4px var(--accent-bg);
        }

        .contribution-item {
          display: flex;
          gap: 1rem;
          margin-bottom: 0.8rem;
          align-items: flex-start;
        }
        .contribution-icon {
          color: var(--accent);
          margin-top: 0.2rem;
          flex-shrink: 0;
        }
      `}</style>

      {/* Intro Section */}
      <div className="glass-panel" style={{ padding: '3.5rem', maxWidth: '900px', margin: '0 auto', borderRadius: '24px' }}>
        <h1 className="gradient-text" style={{ fontSize: '3.5rem', marginBottom: '2rem', textAlign: 'center', letterSpacing: '-0.03em' }}>
          Sobre Nosotros
        </h1>

        <div style={{ color: 'var(--text-muted)', fontSize: '1.15rem', lineHeight: '1.8' }}>
          <p style={{ marginBottom: '1.5rem', textAlign: 'justify' }}>
            <strong style={{ color: 'var(--text-h)' }}>ExpresaT</strong> nació con la visión de derribar las barreras de
            comunicación para la comunidad sorda en México y el mundo, esto gracias a
            nuestro apasionado equipo de desarrollo.
          </p>
          <p style={{ marginBottom: '1.5rem', textAlign: 'justify' }}>
            Nuestro equipo combina experiencia avanzada en inteligencia artificial, desarrollo de
            interfaces modernas y un profundo compromiso social para ofrecer una
            herramienta tecnológica que no solo traduce, sino que conecta a las personas de manera genuina.
          </p>
          <p style={{ textAlign: 'justify' }}>
            Utilizamos las últimas tecnologías en visión por computadora a través de MediaPipe
            y redes neuronales procesadas en tiempo real para interpretar los complejos
            gestos de la Lengua de Señas Mexicana (LSM) directamente en tu navegador.
          </p>
        </div>
      </div>

      {/* Team Section */}
      <section style={{ marginTop: '6rem', maxWidth: '1100px', marginInline: 'auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <h2 className="gradient-text" style={{ fontSize: '2.8rem', marginBottom: '1rem', letterSpacing: '-0.02em' }}>
            Conoce al Equipo
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', maxWidth: '600px', margin: '0 auto' }}>
            Un grupo multidisciplinario de expertos unidos por una sola misión: hacer la comunicación accesible para todos.
          </p>
        </div>

        <div className="team-grid" role="list">
          {teamMembers.map((member) => (
            <article
              key={member.id}
              className="member-card"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedMember(member)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedMember(member);
                }
              }}
              aria-label={`Ver detalles de ${member.name}, ${member.role}`}
            >
              <span className="department-badge">{member.department}</span>
              <div className="member-avatar">
                {member.icon}
              </div>
              <h3 style={{ fontSize: '1.5rem', margin: '0.5rem 0 0.2rem', color: 'var(--text-h)', fontWeight: '600' }}>
                {member.name}
              </h3>
              <p style={{ fontSize: '1rem', color: 'var(--accent)', fontWeight: '500', margin: 0 }}>
                {member.role}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Detail Modal */}
      {selectedMember && (
        <div
          className="modal-overlay"
          onClick={() => setSelectedMember(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="modal-close"
              onClick={() => setSelectedMember(null)}
              aria-label="Cerrar modal"
            >
              <X size={24} strokeWidth={2} />
            </button>

            <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2rem', marginBottom: '2rem', borderBottom: '1px solid var(--border)', paddingBottom: '2rem' }}>
              <div className="member-avatar" style={{ margin: 0, transform: 'none', borderRadius: '24px' }}>
                {React.cloneElement(selectedMember.icon, { size: 42 })}
              </div>
              <div style={{ flex: 1, minWidth: '250px' }}>
                <span className="department-badge" style={{ display: 'inline-block', marginBottom: '0.8rem' }}>
                  {selectedMember.department}
                </span>
                <h2 id="modal-title" style={{ fontSize: '2.2rem', margin: '0 0 0.3rem 0', color: 'var(--text-h)', lineHeight: '1.1' }}>
                  {selectedMember.name}
                </h2>
                <p style={{ fontSize: '1.2rem', color: 'var(--accent)', fontWeight: '600', margin: 0 }}>
                  {selectedMember.role}
                </p>

                <div className="social-links">
                  <a href={selectedMember.socials.linkedin} className="social-btn" aria-label={`LinkedIn de ${selectedMember.name}`} target="_blank" rel="noopener noreferrer">
                    <Linkedin size={18} />
                  </a>
                  <a href={selectedMember.socials.github} className="social-btn" aria-label={`GitHub de ${selectedMember.name}`} target="_blank" rel="noopener noreferrer">
                    <Github size={18} />
                  </a>
                  <a href={selectedMember.socials.mail} className="social-btn" aria-label={`Email a ${selectedMember.name}`}>
                    <Mail size={18} />
                  </a>
                </div>
              </div>
            </header>

            <section style={{ marginBottom: '2.5rem' }}>
              <h3 style={{ fontSize: '1.3rem', color: 'var(--text-h)', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Rol y Responsabilidades
              </h3>
              <p style={{ color: 'var(--text)', lineHeight: '1.7', fontSize: '1.05rem', margin: 0 }}>
                {selectedMember.description}
              </p>
            </section>

            <section style={{ marginBottom: '2.5rem' }}>
              <h3 style={{ fontSize: '1.3rem', color: 'var(--text-h)', margin: '0 0 1.2rem 0' }}>
                Principales Aportaciones
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {selectedMember.contributions.map((contribution, idx) => (
                  <div key={idx} className="contribution-item">
                    <ChevronRight size={20} className="contribution-icon" />
                    <span style={{ color: 'var(--text)', lineHeight: '1.6', fontSize: '1.05rem' }}>
                      {contribution}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: '1.3rem', color: 'var(--text-h)', margin: '0 0 1.5rem 0' }}>
                Línea de Tiempo de Desarrollo
              </h3>
              <div className="modal-timeline">
                {selectedMember.timeline.map((item, idx) => (
                  <div key={idx} className="modal-timeline-item">
                    <span className="modal-timeline-badge">
                      {item.date}
                    </span>
                    <p style={{ margin: 0, color: 'var(--text)', fontSize: '1.05rem', lineHeight: '1.6', marginTop: '0.4rem' }}>
                      {item.event}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

export default About;
