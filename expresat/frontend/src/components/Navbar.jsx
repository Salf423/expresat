import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User, Menu, X } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import EnvironmentSelector from './EnvironmentSelector';

const Navbar = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const location = useLocation();
  const isLoggedIn = false; 

  const navLinks = [
    { name: 'Inicio', path: '/' },
    { name: 'Traductor', path: '/translator' },
    { name: 'Aprender LSM', path: '/learn' },
    { name: 'Nosotros', path: '/about' },
  ];

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      background: 'var(--navbar-bg)', backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--panel-border)'
    }}>
      <div className="container" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '80px'
      }}>
        {/* Brand */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold'
          }}>
            E
          </div>
          <span className="gradient-text" style={{ fontSize: '1.5rem', fontWeight: '700' }}>
            ExpresaT <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>V2</span>
          </span>
        </Link>

        {/* Desktop Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }} className="desktop-only">
          <ul style={{ display: 'flex', gap: '2rem', listStyle: 'none', margin: 0, padding: 0 }}>
            {navLinks.map((link) => (
              <li key={link.path}>
                <Link 
                  to={link.path}
                  style={{
                    fontWeight: '500',
                    color: location.pathname === link.path ? 'var(--accent-primary)' : 'var(--text-color)',
                    transition: 'color 0.2s'
                  }}
                >
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <EnvironmentSelector />
          <ThemeToggle />
          
          {isLoggedIn ? (
            <div className="user-avatar" style={{
              width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent-primary)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
            }}>
              U
            </div>
          ) : (
            <Link to="/auth" className="btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
              <User size={16} /> Iniciar Sesión
            </Link>
          )}

          {/* Mobile Toggle */}
          <button className="btn-icon mobile-only" onClick={() => setIsOpen(!isOpen)} style={{ display: 'none' }}>
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Basic Mobile Menu CSS handling can go in index.css */}
      <style dangerouslySetInnerHTML={{__html: `
        @media (max-width: 768px) {
          .desktop-only { display: none !important; }
          .mobile-only { display: inline-flex !important; }
        }
      `}} />
    </nav>
  );
};

export default Navbar;
