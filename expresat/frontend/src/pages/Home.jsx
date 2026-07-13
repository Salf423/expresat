import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Eye, Shield } from 'lucide-react';

const Home = () => {
  return (
    <div className="animate-fade-in" style={{ paddingBottom: '4rem' }}>
      {/* Hero Section */}
      <section className="container" style={{ textAlign: 'center', padding: '15vh 0 10vh 0' }}>
        <h1 className="gradient-text" style={{ fontSize: '4.5rem', marginBottom: '1.5rem', letterSpacing: '-0.02em' }}>
          El Futuro de la Inclusión
        </h1>
        <p style={{ fontSize: '1.25rem', maxWidth: '700px', margin: '0 auto 3rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
          ExpresaT traduce la Lengua de Señas Mexicana en tiempo real usando inteligencia artificial de última generación. Una interfaz fluida, inmersiva y totalmente responsiva diseñada para ti.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <Link to="/translator" className="btn-primary" style={{ fontSize: '1.1rem', padding: '1rem 2.5rem' }}>
            Probar Traductor <ArrowRight size={20} />
          </Link>
          <Link to="/about" className="btn-outline" style={{ fontSize: '1.1rem', padding: '1rem 2.5rem' }}>
            Conoce Más
          </Link>
        </div>
      </section>

      {/* Features Section */}
      <section className="container" style={{ marginTop: '2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          <div className="glass-panel" style={{ padding: '2.5rem' }}>
            <div style={{ background: 'rgba(56, 189, 248, 0.1)', width: '50px', height: '50px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)', marginBottom: '1.5rem' }}>
              <Zap size={28} />
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>IA en Tiempo Real</h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
              Nuestra red neuronal procesa 15 fotogramas por segundo garantizando traducciones inmediatas y fluidas directamente en tu navegador.
            </p>
          </div>
          
          <div className="glass-panel" style={{ padding: '2.5rem' }}>
            <div style={{ background: 'rgba(192, 132, 252, 0.1)', width: '50px', height: '50px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-secondary)', marginBottom: '1.5rem' }}>
              <Eye size={28} />
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Estética Glassmorphism</h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
              Diseño moderno, refinado y profesional. Disfruta de una  experiencia  sencilla e interactiva para poder eliminar las barreras de la comunicacion.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: '2.5rem' }}>
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', width: '50px', height: '50px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success-color)', marginBottom: '1.5rem' }}>
              <Shield size={28} />
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Aprendizaje Activo</h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
              No solo traduces, también aprendes. Explora nuestra sección educativa interactiva diseñada pedagógicamente para facilitar tu progreso.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
