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
  ChevronRight,
  Award,
  Globe2,
  Calendar
} from 'lucide-react';

const Github = ({ size = 20, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const Linkedin = ({ size = 20, ...rest }) => (
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
    department: 'Gestión & Producto',
    icon: <Users size={32} strokeWidth={1.75} />,
    description: 'Responsable de la dirección estratégica, coordinación de entregables y la integración entre los subsistemas de IA y frontend. Lidera la visión del producto asegurando que las necesidades de la comunidad sorda sean la máxima prioridad en cada iteración.',
    contributions: [
      'Definición de requerimientos funcionales, arquitectura y alcance del proyecto.',
      'Gestión de sprints ágiles y comunicación continua con el equipo de desarrollo.',
      'Coordinación de grupos de enfoque y pruebas de usabilidad con personas sordas.'
    ],
    timeline: [
      { date: 'Mes 1', event: 'Definición del roadmap, especificación funcional y planificación operativa.' },
      { date: 'Mes 3', event: 'Coordinación y validación del primer prototipo funcional interactivo.' },
      { date: 'Mes 5', event: 'Lanzamiento de versión beta pública y levantamiento de feedback.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 2,
    name: 'Adrian Flores',
    role: 'Senior AI Engineer',
    department: 'Ingeniería de IA',
    icon: <BrainCircuit size={32} strokeWidth={1.75} />,
    description: 'Especialista en visión por computadora e inteligencia artificial. Arquitecto principal detrás de los modelos de reconocimiento de LSM, enfocado en lograr ultra-alta precisión con latencias mínimas en navegador, entornos C++ nativos y backend.',
    contributions: [
      'Entrenamiento de modelos recurrentes GRU/LSTM para clasificación de secuencias temporales.',
      'Optimización de extracción de landmarks articulares utilizando MediaPipe Holistic.',
      'Pipeline de preprocesamiento, normalización relativa al torso y cuantización INT8.'
    ],
    timeline: [
      { date: 'Mes 1', event: 'Investigación de topologías articulares y extracción de 178 landmarks en 3D.' },
      { date: 'Mes 2', event: 'Entrenamiento de redes recurrentes sobre secuencias de señas mexicanas.' },
      { date: 'Mes 4', event: 'Cuantización INT8 y despliegue del runtime ONNX en microservicios.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 3,
    name: 'Jesus Enrique',
    role: 'Backend & Cloud Engineer',
    department: 'Sistemas & Cloud',
    icon: <Server size={32} strokeWidth={1.75} />,
    description: 'Ingeniero de software especializado en arquitecturas asíncronas, canales de streaming en tiempo real y optimización de recursos en la nube.',
    contributions: [
      'Diseño y desarrollo del servidor FastAPI con manejadores asíncronos WebSocket.',
      'Implementación de contratos de streaming de baja latencia con JSON estructurado.',
      'Integración con Supabase para almacenamiento seguro y autenticación JWT.'
    ],
    timeline: [
      { date: 'Mes 2', event: 'Diseño preliminar del gateway de streaming y pipelines de datos.' },
      { date: 'Mes 3', event: 'Implementación del canal WebSocket bidireccional en tiempo real.' },
      { date: 'Mes 4', event: 'Manejo de base de datos relacional y políticas de seguridad RLS.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 4,
    name: 'Nataly Guzman',
    role: 'UI/UX Designer',
    department: 'Diseño & Accesibilidad',
    icon: <PenTool size={32} strokeWidth={1.75} />,
    description: 'Creadora de la identidad visual de ExpresaT. Diseñó todas las interfaces interactivas adaptando el estilo Glassmorphism moderno para asegurar una experiencia limpia, intuitiva y universalmente accesible según directrices WCAG 2.2.',
    contributions: [
      'Diseño en Figma de sistemas de diseño, tokens tipográficos y prototipos de alta fidelidad.',
      'Definición de paletas de color de alto contraste compatibles con modo claro y oscuro.',
      'Auditoría heurística y pruebas de accesibilidad enfocadas en usabilidad visual.'
    ],
    timeline: [
      { date: 'Mes 1', event: 'Investigación de User Personas y propuesta de lenguaje visual de marca.' },
      { date: 'Mes 3', event: 'Diseño de la experiencia del traductor en vivo y módulo de aprendizaje.' },
      { date: 'Mes 5', event: 'Validación heurística final y refinamiento de micro-interacciones.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 5,
    name: 'Antonio Maqueda',
    role: 'QA & Security Engineer',
    department: 'Calidad & Pruebas',
    icon: <Code size={32} strokeWidth={1.75} />,
    description: 'Responsable del aseguramiento de calidad, auditoría de seguridad en endpoints, límites de tasa y validación de versiones candidatas a producción.',
    contributions: [
      'Baterías de pruebas funcionales, límites de rate-limit y stress testing.',
      'Verificación de estándares de validación de entradas y mitigación de vulnerabilidades.',
      'Coordinación de despliegues y monitoreo de estabilidad del servicio.'
    ],
    timeline: [
      { date: 'Mes 3', event: 'Pruebas de estrés y pruebas de integración de la demo de inferencia.' },
      { date: 'Mes 4', event: 'Validaciones de límites de consumo y seguridad en WebSockets.' },
      { date: 'Mes 5', event: 'Auditoría DOM, validación de accesibilidad WCAG y rendimiento.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  },
  {
    id: 6,
    name: 'Gerardo Emmanuel',
    role: 'LSM Specialist',
    department: 'Investigación Lingüística',
    icon: <HeartHandshake size={32} strokeWidth={1.75} />,
    description: 'Intérprete experto y consultor lingüístico de la Lengua de Señas Mexicana. Su labor fue determinante para garantizar que las expresiones corporales y traducciones del modelo respeten la gramática natural de la LSM.',
    contributions: [
      'Revisión lingüística y cultural de las señas para el dataset oficial.',
      'Validación de precisión de los movimientos espaciales capturados por MediaPipe.',
      'Asesoría en la estructuración gramatical y sintáctica de la lengua de señas.'
    ],
    timeline: [
      { date: 'Mes 3', event: 'Curaduría y validación del vocabulario inicial y señas estáticas.' },
      { date: 'Mes 4', event: 'Evaluación de precisión biomecánica sobre las señas dinámicas.' },
      { date: 'Mes 5', event: 'Pruebas de validación con usuarios nativos de la comunidad sorda.' }
    ],
    socials: { linkedin: '#', github: '#', mail: 'mailto:contacto@expresat.com' }
  }
];

const About = () => {
  const [selectedMember, setSelectedMember] = useState(null);

  // Manejar teclado (Escape) y bloquear scroll al abrir modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && selectedMember) {
        setSelectedMember(null);
      }
    };

    if (selectedMember) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedMember]);

  return (
    <div className="container animate-fade-in" style={{ padding: '3.5rem 1.5rem 6rem 1.5rem', flex: 1 }}>
      {/* Intro Mission Card */}
      <section
        className="glass-panel"
        style={{
          padding: 'clamp(2rem, 5vw, 4rem)',
          maxWidth: '900px',
          margin: '0 auto 5rem auto',
          borderRadius: 'var(--radius-xl)'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <span className="chip" style={{ marginBottom: '1rem' }}>
            <Globe2 size={15} /> Impacto Social & IA
          </span>
          <h1 className="gradient-text" style={{ fontSize: 'clamp(2.25rem, 5vw, 3.5rem)', fontWeight: 800 }}>
            Sobre Nosotros
          </h1>
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: '1.8', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <p style={{ margin: 0 }}>
            <strong style={{ color: 'var(--text-color)' }}>ExpresaT</strong> nació con la misión de derribar las barreras de comunicación para las personas con discapacidad auditiva o dificultades del habla en México y América Latina mediante tecnología abierta, ética y accesible.
          </p>
          <p style={{ margin: 0 }}>
            Nuestro equipo combina investigación avanzada en inteligencia artificial, desarrollo de interfaces intuitivas bajo estándares de accesibilidad universal y un profundo compromiso social para conectar a las personas de manera fluida y respetuosa.
          </p>
          <p style={{ margin: 0 }}>
            Utilizamos las tecnologías más modernas en visión por computadora a través de cualquier cámara web estándar y modelos neuronales ligeros optimizados para interpretar los gestos de la Lengua de Señas Mexicana (LSM) en tiempo real, directamente en el navegador y sin costos de suscripción prohibitivos.
          </p>
        </div>
      </section>

      {/* Team Grid Section */}
      <section style={{ maxWidth: '1100px', marginInline: 'auto' }}>
        <div className="section-heading" style={{ marginBottom: '3.5rem' }}>
          <span className="chip" style={{ marginBottom: '0.75rem' }}>
            <Award size={15} /> Nuestro Equipo
          </span>
          <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', fontWeight: 800 }}>
            Conoce a los Creadores de ExpresaT
          </h2>
          <p style={{ maxWidth: '620px', margin: '0 auto', fontSize: '1.05rem' }}>
            Un equipo multidisciplinario de ingenieros de IA, desarrolladores cloud, diseñadores de experiencia e intérpretes expertos de LSM.
          </p>
        </div>

        <div className="grid-auto" role="list">
          {teamMembers.map((member) => (
            <article
              key={member.id}
              className="glass-panel team-card"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedMember(member)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedMember(member);
                }
              }}
              aria-label={`Ver perfil de ${member.name}, ${member.role}`}
            >
              <div className="team-card__avatar">
                {member.icon}
              </div>

              <span className="chip" style={{ fontSize: '0.75rem', marginBottom: '0.75rem', alignSelf: 'center' }}>
                {member.department}
              </span>

              <h3 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 0.35rem 0', color: 'var(--text-color)' }}>
                {member.name}
              </h3>

              <p style={{ fontSize: '0.95rem', color: 'var(--accent-primary)', fontWeight: 600, margin: '0 0 1rem 0' }}>
                {member.role}
              </p>

              <span className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem', width: '100%', display: 'flex', justifyContent: 'center' }}>
                <span>Ver Aportaciones</span>
                <ChevronRight size={14} />
              </span>
            </article>
          ))}
        </div>
      </section>

      {/* Detail Modal (via React Portal) */}
      {selectedMember && createPortal(
        <div
          className="modal-overlay"
          onClick={() => setSelectedMember(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="member-modal-title"
        >
          <div
            className="modal-content"
            style={{ maxWidth: '720px', padding: 'clamp(1.5rem, 4vw, 2.5rem)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setSelectedMember(null)}
                aria-label="Cerrar modal"
                style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--input-bg)' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Header info */}
            <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1.5rem', marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <div
                className="team-card__avatar"
                style={{
                  width: '72px',
                  height: '72px',
                  margin: 0,
                  flexShrink: 0
                }}
              >
                {selectedMember.icon}
              </div>

              <div style={{ flex: 1, minWidth: '220px' }}>
                <span className="chip" style={{ fontSize: '0.75rem', marginBottom: '0.4rem' }}>
                  {selectedMember.department}
                </span>
                <h2 id="member-modal-title" style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.25rem 0', color: 'var(--text-color)' }}>
                  {selectedMember.name}
                </h2>
                <p style={{ fontSize: '1.05rem', color: 'var(--accent-primary)', fontWeight: 600, margin: 0 }}>
                  {selectedMember.role}
                </p>

                {/* Social Links */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem' }}>
                  <a
                    href={selectedMember.socials.linkedin}
                    className="btn-icon"
                    aria-label={`LinkedIn de ${selectedMember.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ width: '32px', height: '32px', background: 'var(--input-bg)' }}
                  >
                    <Linkedin size={16} />
                  </a>
                  <a
                    href={selectedMember.socials.github}
                    className="btn-icon"
                    aria-label={`GitHub de ${selectedMember.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ width: '32px', height: '32px', background: 'var(--input-bg)' }}
                  >
                    <Github size={16} />
                  </a>
                  <a
                    href={selectedMember.socials.mail}
                    className="btn-icon"
                    aria-label={`Correo de ${selectedMember.name}`}
                    style={{ width: '32px', height: '32px', background: 'var(--input-bg)' }}
                  >
                    <Mail size={16} />
                  </a>
                </div>
              </div>
            </header>

            {/* Description */}
            <section style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1.15rem', color: 'var(--text-color)', marginBottom: '0.75rem' }}>
                Responsabilidad y Enfoque
              </h3>
              <p style={{ color: 'var(--text-muted)', lineHeight: '1.7', fontSize: '0.95rem', margin: 0 }}>
                {selectedMember.description}
              </p>
            </section>

            {/* Contributions */}
            <section style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1.15rem', color: 'var(--text-color)', marginBottom: '0.85rem' }}>
                Principales Aportaciones
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {selectedMember.contributions.map((contribution, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem' }}>
                    <ChevronRight size={18} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                      {contribution}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Timeline */}
            <section>
              <h3 style={{ fontSize: '1.15rem', color: 'var(--text-color)', marginBottom: '1rem' }}>
                Línea de Tiempo del Proyecto
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--accent-primary-border)' }}>
                {selectedMember.timeline.map((item, idx) => (
                  <div key={idx} style={{ position: 'relative', paddingLeft: '1rem' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: '-1.05rem',
                        top: '0.35rem',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: 'var(--accent-primary)',
                        border: '2px solid var(--bg-color)'
                      }}
                    />
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 700 }}>
                      <Calendar size={13} />
                      <span>{item.date}</span>
                    </div>
                    <p style={{ margin: '0.2rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.5' }}>
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
