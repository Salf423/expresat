import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User, Menu, X, ArrowRight } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import EnvironmentSelector from './EnvironmentSelector';
import logoImg from '../assets/logo.png';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const isLoggedIn = false;

  const navLinks = [
    { name: 'Inicio', path: '/' },
    { name: 'Traductor', path: '/translator' },
    { name: 'Aprender LSM', path: '/learn' },
    { name: 'Nosotros', path: '/about' },
  ];

  // Cerrar menú móvil al navegar
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  // Prevenir scroll cuando el menú móvil está abierto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  return (
    <header
      role="banner"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '80px',
        zIndex: 'var(--z-sticky, 100)',
        background: 'var(--navbar-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--navbar-border, var(--panel-border))',
        transition: 'background-color var(--transition-base), border-color var(--transition-base)'
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '100%'
        }}
      >
        {/* Brand / Logo */}
        <Link
          to="/"
          aria-label="ExpresaT Inicio"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            textDecoration: 'none'
          }}
        >
          <img
            src={logoImg}
            alt="ExpresaT Logo"
            style={{
              height: '42px',
              width: 'auto',
              objectFit: 'contain',
              filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.15))'
            }}
          />
        </Link>

        {/* Desktop Navigation */}
        <nav
          role="navigation"
          aria-label="Navegación principal"
          className="desktop-only"
        >
          <ul
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2.25rem',
              listStyle: 'none',
              margin: 0,
              padding: 0
            }}
          >
            {navLinks.map((link) => {
              const isActive = location.pathname === link.path;
              return (
                <li key={link.path}>
                  <Link
                    to={link.path}
                    className={`nav-link ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-color)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      padding: '0.5rem 0'
                    }}
                  >
                    {link.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Actions & Utilities */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem'
          }}
        >
          <EnvironmentSelector />
          <ThemeToggle />

          {isLoggedIn ? (
            <div
              className="user-avatar"
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: 'var(--panel-shadow)'
              }}
              title="Perfil de Usuario"
            >
              U
            </div>
          ) : (
            <Link
              to="/auth"
              className="btn-primary desktop-only"
              style={{
                padding: '0.55rem 1.15rem',
                fontSize: '0.875rem'
              }}
            >
              <User size={16} />
              <span>Iniciar Sesión</span>
            </Link>
          )}

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            className="btn-icon mobile-only"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú de navegación'}
            style={{
              padding: '0.5rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--panel-border)'
            }}
          >
            {isOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {isOpen && (
        <div
          className="mobile-only"
          style={{
            position: 'fixed',
            top: '80px',
            left: 0,
            right: 0,
            bottom: 0,
            height: 'calc(100dvh - 80px)',
            background: 'var(--navbar-bg)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            padding: '2rem 1.5rem',
            gap: '1.5rem',
            overflowY: 'auto',
            zIndex: 'var(--z-modal, 300)',
            animation: 'fade-in 0.2s ease-out'
          }}
        >
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            {navLinks.map((link) => {
              const isActive = location.pathname === link.path;
              return (
                <li key={link.path}>
                  <Link
                    to={link.path}
                    className="glass-panel"
                    aria-current={isActive ? 'page' : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '1rem 1.25rem',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '1.05rem',
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-color)',
                      borderColor: isActive ? 'var(--accent-primary-border)' : 'var(--panel-border)',
                      background: isActive ? 'var(--accent-primary-bg)' : 'var(--panel-bg)',
                      textDecoration: 'none'
                    }}
                  >
                    <span>{link.name}</span>
                    <ArrowRight size={18} color={isActive ? 'var(--accent-primary)' : 'var(--text-muted)'} />
                  </Link>
                </li>
              );
            })}
          </ul>

          <div
            style={{
              marginTop: 'auto',
              paddingTop: '1.5rem',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            {!isLoggedIn && (
              <Link
                to="/auth"
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  fontSize: '1rem',
                  display: 'flex',
                  justifyContent: 'center'
                }}
              >
                <User size={18} />
                <span>Iniciar Sesión / Registro</span>
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
