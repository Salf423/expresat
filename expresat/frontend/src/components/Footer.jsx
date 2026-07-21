import React from 'react';
import { Link } from 'react-router-dom';
import logoImg from '../assets/logo.png';

const Footer = () => {
  return (
    <footer style={{
      background: 'var(--panel-bg)',
      backdropFilter: 'blur(10px)',
      borderTop: '1px solid var(--panel-border)',
      padding: '4rem 0 2rem 0',
      marginTop: 'auto'
    }}>
      <div className="container" style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
            <img src={logoImg} alt="ExpresaT Logo" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <p style={{ color: 'var(--text-muted)' }}>
            Rompiendo las barreras de la comunicacion con inovacion.
          </p>
        </div>
        
        <div>
          <h4 style={{ marginBottom: '1rem' }}>Enlaces Útiles</h4>
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <li><Link to="/support" style={{ color: 'var(--text-muted)' }}>Soporte Técnico</Link></li>
            <li><Link to="/privacy" style={{ color: 'var(--text-muted)' }}>Políticas de Privacidad</Link></li>
            <li><Link to="/terms" style={{ color: 'var(--text-muted)' }}>Términos y Condiciones</Link></li>
          </ul>
        </div>
        
        <div>
          <h4 style={{ marginBottom: '1rem' }}>Contacto</h4>
          <p style={{ color: 'var(--text-muted)' }}>infoexpresat@gmail.com</p>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <a href="https://github.com/Salf423/expresat" className="btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>GitHub</a>
            <a href="https://instagram.com/somosexpresat?igsh=MTB5NTk2Z2xqNHNtcA" className="btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>Instagram</a>
          </div>
        </div>
      </div>
      
      <div className="container" style={{
        marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid var(--panel-border)',
        textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem'
      }}>
        &copy; {new Date().getFullYear()} ExpresaT. Todos los derechos reservados.
      </div>
    </footer>
  );
};

export default Footer;
