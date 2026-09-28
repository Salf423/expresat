import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, Mail, ShieldCheck, FileText, HelpCircle } from 'lucide-react';
import logoImg from '../assets/logo.png';

const Github = ({ size = 16, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const Instagram = ({ size = 16, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const Footer = () => {
  return (
    <footer
      role="contentinfo"
      style={{
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderTop: '1px solid var(--panel-border)',
        padding: '3.5rem 0 2rem 0',
        marginTop: 'auto',
        position: 'relative',
        zIndex: 'var(--z-base, 0)'
      }}
    >
      <div className="container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
            gap: '2.5rem',
            marginBottom: '3rem'
          }}
        >
          {/* Brand & Mission */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <img
                src={logoImg}
                alt="ExpresaT Logo"
                style={{ height: '36px', width: 'auto', objectFit: 'contain' }}
              />
            </Link>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: '1.6', maxWidth: '320px' }}>
              Rompiendo las barreras de la comunicación mediante inteligencia artificial inclusiva y accesible para la Lengua de Señas Mexicana.
            </p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <span>Hecho con</span>
              <Heart size={14} color="var(--error-color)" fill="var(--error-color)" />
              <span>para la comunidad sorda</span>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--text-color)',
                marginBottom: '1.25rem',
                letterSpacing: '0.02em'
              }}
            >
              Navegación
            </h4>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}
            >
              <li>
                <Link to="/" className="footer-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  Inicio
                </Link>
              </li>
              <li>
                <Link to="/translator" className="footer-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  Traductor LSM en Tiempo Real
                </Link>
              </li>
              <li>
                <Link to="/learn" className="footer-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  Aprender LSM
                </Link>
              </li>
              <li>
                <Link to="/about" className="footer-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  Sobre Nosotros y el Equipo
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal & Docs */}
          <div>
            <h4
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--text-color)',
                marginBottom: '1.25rem',
                letterSpacing: '0.02em'
              }}
            >
              Recursos y Legal
            </h4>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}
            >
              <li>
                <a href="#support" className="footer-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <HelpCircle size={15} /> Soporte Técnico
                </a>
              </li>
              <li>
                <a href="#privacy" className="footer-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={15} /> Políticas de Privacidad
                </a>
              </li>
              <li>
                <a href="#terms" className="footer-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={15} /> Términos y Condiciones
                </a>
              </li>
            </ul>
          </div>

          {/* Socials & Contact */}
          <div>
            <h4
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--text-color)',
                marginBottom: '1.25rem',
                letterSpacing: '0.02em'
              }}
            >
              Comunidad y Contacto
            </h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              ¿Tienes sugerencias o deseas colaborar en el dataset?
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
              <a
                href="https://github.com/Salf423/expresat"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline"
                style={{
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.85rem',
                  borderRadius: 'var(--radius-md)'
                }}
                aria-label="ExpresaT en GitHub"
              >
                <Github size={15} />
                <span>GitHub</span>
              </a>
              <a
                href="https://instagram.com/somosexpresat?igsh=MTB5NTk2Z2xqNHNtcA"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline"
                style={{
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.85rem',
                  borderRadius: 'var(--radius-md)'
                }}
                aria-label="ExpresaT en Instagram"
              >
                <Instagram size={15} />
                <span>Instagram</span>
              </a>
              <a
                href="mailto:infoexpresat@gmail.com"
                className="btn-outline"
                style={{
                  padding: '0.45rem 0.9rem',
                  fontSize: '0.85rem',
                  borderRadius: 'var(--radius-md)'
                }}
                aria-label="Contacto por Correo"
              >
                <Mail size={15} />
                <span>Email</span>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div
          style={{
            paddingTop: '1.75rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            color: 'var(--text-subtle)',
            fontSize: '0.85rem'
          }}
        >
          <p style={{ margin: 0 }}>
            &copy; {new Date().getFullYear()} ExpresaT. Proyecto de código abierto e investigación en IA.
          </p>
          <div style={{ display: 'flex', gap: '1.25rem' }}>
            <span>WCAG 2.2 AA</span>
            <span>•</span>
            <span>React 19</span>
            <span>•</span>
            <span>MediaPipe ONNX</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
