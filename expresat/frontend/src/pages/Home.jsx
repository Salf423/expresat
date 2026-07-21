import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Eye, Shield } from 'lucide-react';

const Home = () => {
  return (
    <div className="animate-fade-in" style={{ paddingBottom: '4rem', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <main className="container" style={{ margin: '0 auto', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <section className="reveal active" style={{ padding: '10vh 0' }}>
          <h1 className="gradient-text" style={{ fontSize: '4.5rem', marginBottom: '1.5rem', fontWeight: 'bold' }}>
            El Futuro de la Inclusión
          </h1>
          <p style={{ fontSize: '1.25rem', maxWidth: '600px', margin: '0 auto 2rem', color: 'var(--text)', lineHeight: '1.6' }}>
            ExpresaT traduce la Lengua de Señas Mexicana en tiempo real usando inteligencia artificial de última generación.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <Link to="/translator" className="btn-primary" style={{ fontSize: '1.2rem', padding: '1rem 2rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
              Probar Traductor <ArrowRight size={20} />
            </Link>
            <Link to="/about" className="btn-neon" style={{ fontSize: '1.2rem', padding: '1rem 2rem', textDecoration: 'none' }}>
              Conoce Más
            </Link>
          </div>
        </section>

        <section className="reveal active" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginTop: '4rem' }}>
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ background: 'var(--accent-cyan-bg, rgba(0, 243, 255, 0.1))', width: '50px', height: '50px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-cyan, #00f3ff)', margin: '0 auto 1.5rem' }}>
              <Zap size={28} />
            </div>
            <h3 style={{ color: 'var(--accent-cyan, #00f3ff)', marginBottom: '1rem', fontSize: '1.5rem' }}>IA en Tiempo Real</h3>
            <p style={{ color: 'var(--text)', lineHeight: '1.6' }}>Nuestra red neuronal procesa 15 fotogramas por segundo garantizando traducciones inmediatas.</p>
          </div>
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ background: 'var(--accent-purple-bg, rgba(157, 78, 221, 0.1))', width: '50px', height: '50px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-purple, #9d4edd)', margin: '0 auto 1.5rem' }}>
              <Eye size={28} />
            </div>
            <h3 style={{ color: 'var(--accent-purple, #9d4edd)', marginBottom: '1rem', fontSize: '1.5rem' }}>Estética Glassmorphism</h3>
            <p style={{ color: 'var(--text)', lineHeight: '1.6' }}>Una interfaz fluida, inmersiva y totalmente responsiva diseñada para ti.</p>
          </div>
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ background: 'var(--accent-cyan-bg, rgba(0, 243, 255, 0.1))', width: '50px', height: '50px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-cyan, #00f3ff)', margin: '0 auto 1.5rem' }}>
              <Shield size={28} />
            </div>
            <h3 style={{ color: 'var(--accent-cyan, #00f3ff)', marginBottom: '1rem', fontSize: '1.5rem' }}>Aprendizaje Activo</h3>
            <p style={{ color: 'var(--text)', lineHeight: '1.6' }}>No solo traduces, también aprendes con nuestra galería interactiva de señas.</p>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Home;
