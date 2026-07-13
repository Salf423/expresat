import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Users,
  BrainCircuit,
  Server,
  PenTool,
  Code,
  HeartHandshake,
  Mail,
  ChevronRight
} from 'lucide-react';


const Github = ({ size = 24, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const Linkedin = ({ size = 24, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const teamMembers = [
  {
    id: 1,
    name: 'Ulises Eliel',
    role: 'Project Lead',
    department: 'Management',
    icon: <Users size={36} strokeWidth={1.5} />,
    description: 'Responsable de la dirección estratégica, coordinación de entregables y la integración integral de los componentes de IA y frontend. Lidera la visión del producto asegurando que las necesidades de la comunidad sorda sean la prioridad en cada etapa.',
    contributions: [
      'Definición de requerimientos funcionales y alcance del proyecto.',
      'Gestión de sprints ágiles y comunicación continua con el equipo de desarrollo.',
      'Coordinación de grupos focales y pruebas de usabilidad iniciales con la comunidad.'
    ],
    timeline: [
      { date: 'Mes 1', event: 'Definición del roadmap e inicio del proyect ademas de la planificacin de como se va a ejecutar la idea.' },
      { date: 'Mes 3', event: 'Coordinación del primer prototipo funcional.' },
      { date: 'Mes 5', event: 'Lanzamiento de la versión beta y análisis de feedback.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 2,
    name: 'Adrian Flores',
    role: 'Senior Engineer',
    department: 'Engineering',
    icon: <BrainCircuit size={36} strokeWidth={1.5} />,
    description: 'Especialista en visión por computadora e inteligencia artificial. Arquitecto principal detrás de los modelos de reconocimiento de LSM, enfocado en lograr alta precisión con baja latencia en entornos web, deploys y backend.',
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
    name: 'Jesus Enrique',
    role: 'Junior Developer',
    department: 'Engineering',
    icon: <Server size={36} strokeWidth={1.5} />,
    description: 'Ingeniero de software encargado de la optimización, mediación con administradores y depuración (debugging).',
    contributions: [
      'Simplificación y optimización de la lógica del backend.',
      'Implementación de conexión bidireccional y streaming mediante WebSockets.',
      'Integración con Supabase para la gestión segura de almacenamiento de perfiles.'
    ],
    timeline: [
      { date: 'Mes 2', event: 'Sugerencia de la cuantización del modelo a 4 bits' },
      { date: 'Mes 3', event: 'Implementación del canal WebSocket bidireccional en tiempo real.' },
      { date: 'Mes 4', event: 'Manejo de la base de datos y flujos seguros de autenticación.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 4,
    name: 'Nataly Guzman',
    role: 'UI/UX Designer',
    department: 'Design',
    icon: <PenTool size={36} strokeWidth={1.5} />,
    description: 'Creadora de la identidad visual de ExpresaT. Diseñó todas las interfaces interactivas adaptando el estilo Glassmorphism moderno para asegurar una experiencia de usuario limpia, accesible y premium.',
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
    name: 'Antonio Maqueda',
    role: 'QA',
    department: 'Engineering',
    icon: <Code size={36} strokeWidth={1.5} />,
    description: 'Verificación del control de calidad, mediación con los administradores y visto bueno a los deploys.',
    contributions: [
      'Búsqueda de errores.',
      'Chequeo de las validaciones y restricciones del servidor.',
      'Reuniones con roles administrativos.'
    ],
    timeline: [
      { date: 'Mes 3', event: 'Testeos de la demo.' },
      { date: 'Mes 4', event: 'Validaciones de rate limits en el servidor.' },
      { date: 'Mes 5', event: 'Pulido estético general, accesibilidad DOM y optimización de rendimiento.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 6,
    name: 'Gerardo Emmanuel',
    role: 'LSM Specialist',
    department: 'Research & QA',
    icon: <HeartHandshake size={36} strokeWidth={1.5} />,
    description: 'Intérprete experto y consultor lingüístico de la Lengua de Señas Mexicana. Su labor fue fundamental para garantizar que las traducciones e interpretación del modelo sean cultural y gramaticalmente correctas.',
    contributions: [
      'Búsqueda de errores en las traducciones.',
      'Revisión lingüística y cultural de las señas registradas.',
      'Asesoría en la estructuración gramatical de la LSM.'
    ],
    timeline: [
      { date: 'Mes 3', event: 'Validación inicial de vocabulario y señas base.' },
      { date: 'Mes 4', event: 'Evaluación de precisión lingüística de las traducciones.' },
      { date: 'Mes 5', event: 'Pruebas de aceptación con usuarios nativos de la comunidad sorda.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  }
];

const About = () => {
  const [selectedMember, setSelectedMember] = useState(null);

  
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && selectedMember) {
        setSelectedMember(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMember]);

  
  useEffect(() => {
    if (selectedMember) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [selectedMember]);

  return (
    <div className="container animate-fade-in" style={{ padding: '4rem 1.5rem' }}>
      <style>{`
        /* ── Team Grid ─────────────────────────── */
        .team-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2rem;
          margin-top: 4rem;
        }
        @media (max-width: 992px) {
          .team-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 600px) {
          .team-grid { grid-template-columns: 1fr; }
        }

        /* ── Member Card ───────────────────────── */
        .member-card {
          cursor: pointer;
          transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                      box-shadow 0.3s ease,
                      border-color 0.3s ease,
                      background-color 0.3s ease;
          border: 1px solid var(--panel-border);
          border-radius: 20px;
          background: var(--panel-bg);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          padding: 2.5rem 2rem;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          box-shadow: var(--panel-shadow);
          opacity: 0;
          animation: slideUpFade 0.6s ease-out forwards;
          position: relative;
          overflow: hidden;
        }

        .member-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; width: 100%; height: 4px;
          background: linear-gradient(90deg, transparent, var(--accent-primary), var(--accent-secondary), transparent);
          opacity: 0;
          transition: opacity 0.3s;
        }

        .member-card:hover,
        .member-card:focus-visible {
          transform: translateY(-8px);
          border-color: var(--accent-primary);
          box-shadow: 0 12px 40px 0 rgba(0, 0, 0, 0.15);
          outline: none;
        }

        .member-card:hover::before,
        .member-card:focus-visible::before {
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
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Department Badge ──────────────────── */
        .department-badge {
          font-size: 0.7rem;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 1.2px;
          color: var(--text-muted);
          background: var(--panel-border);
          padding: 0.35rem 0.8rem;
          border-radius: 20px;
          margin-bottom: 1.5rem;
          transition: background 0.3s, color 0.3s;
        }

        .member-card:hover .department-badge {
          background: rgba(37, 99, 235, 0.1);
          color: var(--accent-primary);
        }

        /* ── Member Avatar ─────────────────────── */
        .member-avatar {
          color: var(--accent-primary);
          margin-bottom: 1.5rem;
          background: rgba(37, 99, 235, 0.08);
          width: 85px;
          height: 85px;
          border-radius: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(37, 99, 235, 0.25);
          transition: transform 0.3s ease, border-radius 0.3s ease;
          transform: rotate(-3deg);
        }

        .member-card:hover .member-avatar {
          transform: rotate(3deg) scale(1.05);
          border-radius: 50%;
        }

        /* ── Modal ─────────────────────────────── */
        .about-modal-overlay {
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
          animation: aboutFadeIn 0.3s ease-out;
          padding: 1.5rem;
          box-sizing: border-box;
        }

        .about-modal-content {
          background: var(--bg-color);
          border: 1px solid var(--panel-border);
          border-radius: 24px;
          max-width: 700px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          padding: 3rem;
          position: relative;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: aboutScaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          text-align: left;
        }

        .about-modal-content::-webkit-scrollbar {
          width: 8px;
        }
        .about-modal-content::-webkit-scrollbar-track {
          background: transparent;
        }
        .about-modal-content::-webkit-scrollbar-thumb {
          background: var(--panel-border);
          border-radius: 10px;
        }

        @keyframes aboutFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes aboutScaleUp {
          from { transform: scale(0.95) translateY(20px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }

        /* ── Modal Close Button ────────────────── */
        .about-modal-close {
          position: absolute;
          top: 1.5rem;
          right: 1.5rem;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          color: var(--text-color);
          border-radius: 50%;
          cursor: pointer;
          padding: 0.6rem;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          z-index: 10;
        }
        .about-modal-close:hover {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
          color: white;
          transform: rotate(90deg);
        }

        /* ── Social Links ──────────────────────── */
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
          background: var(--panel-bg);
          color: var(--text-muted);
          border: 1px solid var(--panel-border);
          transition: all 0.2s;
          text-decoration: none;
        }

        .social-btn:hover {
          background: rgba(37, 99, 235, 0.1);
          color: var(--accent-primary);
          border-color: rgba(37, 99, 235, 0.3);
          transform: translateY(-2px);
        }

        /* ── Timeline ──────────────────────────── */
        .about-timeline {
          position: relative;
          border-left: 2px dashed var(--panel-border);
          padding-left: 2rem;
          margin-top: 1.5rem;
          margin-left: 0.5rem;
        }

        .about-timeline-item {
          position: relative;
          margin-bottom: 2rem;
        }
        .about-timeline-item:last-child {
          margin-bottom: 0;
        }

        .about-timeline-badge {
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--accent-primary);
          background: rgba(37, 99, 235, 0.1);
          padding: 0.3rem 0.8rem;
          border-radius: 20px;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          margin-bottom: 0.6rem;
          border: 1px solid rgba(37, 99, 235, 0.25);
        }

        .about-timeline-item::before {
          content: '';
          position: absolute;
          left: -2.45rem;
          top: 0.5rem;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--bg-color);
          border: 3px solid var(--accent-primary);
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.1);
        }

        /* ── Contribution Items ────────────────── */
        .contribution-item {
          display: flex;
          gap: 1rem;
          margin-bottom: 0.8rem;
          align-items: flex-start;
        }
        .contribution-icon {
          color: var(--accent-primary);
          margin-top: 0.2rem;
          flex-shrink: 0;
        }

        /* ── Intro panel override: no hover lift ─ */
        .about-intro-panel {
          pointer-events: auto;
        }
        .about-intro-panel:hover {
          transform: none;
          box-shadow: var(--panel-shadow);
        }
      `}</style>

      {/* Intro Section */}
      <div className="glass-panel about-intro-panel" style={{ padding: '3.5rem', maxWidth: '900px', margin: '0 auto', borderRadius: '24px' }}>
        <h1 className="gradient-text" style={{ fontSize: '3.5rem', marginBottom: '2rem', textAlign: 'center', letterSpacing: '-0.03em' }}>
          Sobre Nosotros
        </h1>

        <div style={{ color: 'var(--text-muted)', fontSize: '1.15rem', lineHeight: '1.8' }}>
          <p style={{ marginBottom: '1.5rem', textAlign: 'justify' }}>
            <strong style={{ color: 'var(--text-color)' }}>ExpresaT</strong> nació con la visión de derribar las barreras de
            comunicación para la comunidadcon dicapacidades auditivas o prblemas del habla en México y el mundo, esto gracias a
            nuestro apasionado equipo de desarrollo.
          </p>
          <p style={{ marginBottom: '1.5rem', textAlign: 'justify' }}>
            Nuestro equipo combina tecnologia avanzada en inteligencia artificial, desarrollo de
            interfaces modernas intentando que sea lo mas atracyiva y sencilla posible, tenemos un profundo compromiso social para ofrecer una
            herramienta tecnológica que no solo traduce, sino que conecta a las personas de manera genuina.
          </p>
          <p style={{ textAlign: 'justify' }}>
            Utilizamos las últimas tecnologías en visión por computador traves de una web cam
            y redes neuronales procesadas en tiempo real para interpretar los complejos
            gestos de la Lengua de Señas Mexicana (LSM) directamente en tu navegador sin que debas de tener conocimiento de LLM's o vison computacional.
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
              <h3 style={{ fontSize: '1.5rem', margin: '0.5rem 0 0.2rem', color: 'var(--text-color)', fontWeight: '600' }}>
                {member.name}
              </h3>
              <p style={{ fontSize: '1rem', color: 'var(--accent-primary)', fontWeight: '500', margin: 0 }}>
                {member.role}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Detail Modal */}
      {selectedMember && createPortal(
        <div
          className="about-modal-overlay"
          onClick={() => setSelectedMember(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="about-modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              className="about-modal-close"
              onClick={() => setSelectedMember(null)}
              aria-label="Cerrar modal"
            >
              <X size={24} strokeWidth={2} />
            </button>

            <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2rem', marginBottom: '2rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '2rem' }}>
              <div className="member-avatar" style={{ margin: 0, transform: 'none', borderRadius: '24px' }}>
                {React.cloneElement(selectedMember.icon, { size: 42 })}
              </div>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <span className="department-badge" style={{ display: 'inline-block', marginBottom: '0.8rem' }}>
                  {selectedMember.department}
                </span>
                <h2 id="modal-title" style={{ fontSize: '2.2rem', margin: '0 0 0.3rem 0', color: 'var(--text-color)', lineHeight: '1.1' }}>
                  {selectedMember.name}
                </h2>
                <p style={{ fontSize: '1.2rem', color: 'var(--accent-primary)', fontWeight: '600', margin: 0 }}>
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
              <h3 style={{ fontSize: '1.3rem', color: 'var(--text-color)', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Rol y Responsabilidades
              </h3>
              <p style={{ color: 'var(--text-muted)', lineHeight: '1.7', fontSize: '1.05rem', margin: 0 }}>
                {selectedMember.description}
              </p>
            </section>

            <section style={{ marginBottom: '2.5rem' }}>
              <h3 style={{ fontSize: '1.3rem', color: 'var(--text-color)', margin: '0 0 1.2rem 0' }}>
                Principales Aportaciones
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {selectedMember.contributions.map((contribution, idx) => (
                  <div key={idx} className="contribution-item">
                    <ChevronRight size={20} className="contribution-icon" />
                    <span style={{ color: 'var(--text-muted)', lineHeight: '1.6', fontSize: '1.05rem' }}>
                      {contribution}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 style={{ fontSize: '1.3rem', color: 'var(--text-color)', margin: '0 0 1.5rem 0' }}>
                Línea de Tiempo de Desarrollo
              </h3>
              <div className="about-timeline">
                {selectedMember.timeline.map((item, idx) => (
                  <div key={idx} className="about-timeline-item">
                    <span className="about-timeline-badge">
                      {item.date}
                    </span>
                    <p style={{ margin: '0.4rem 0 0 0', color: 'var(--text-muted)', fontSize: '1.05rem', lineHeight: '1.6' }}>
                      {item.event}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default About;
