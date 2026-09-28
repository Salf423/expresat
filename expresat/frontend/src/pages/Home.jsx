import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Zap, Shield, Sparkles, Cpu, BookOpen, Layers, CheckCircle2 } from 'lucide-react';

const Home = () => {
  return (
    <div className="animate-fade-in" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Hero Section */}
      <section className="container hero-section">
        <div className="hero-eyebrow chip" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>
          <Sparkles size={16} />
          <span>Inteligencia Artificial para la Inclusión</span>
        </div>

        <h1 className="hero-title">
          Rompiendo barreras con <span className="gradient-text">Lengua de Señas Mexicana</span>
        </h1>

        <p className="hero-subtitle">
          ExpresaT traduce señas en tiempo real combinando visión por computadora de ultra-baja latencia y redes neuronales recurrentes directamente en tu navegador.
        </p>

        <div className="hero-actions">
          <Link to="/translator" className="btn-gradient" style={{ fontSize: '1.05rem', padding: '0.85rem 2rem' }}>
            <span>Probar Traductor</span>
            <ArrowRight size={20} />
          </Link>
          <Link to="/learn" className="btn-outline" style={{ fontSize: '1.05rem', padding: '0.85rem 1.75rem' }}>
            <BookOpen size={18} />
            <span>Aprender LSM</span>
          </Link>
        </div>

        {/* Live Performance Metric Badges */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            justifyContent: 'center',
            marginTop: '2rem'
          }}
        >
          <div
            className="glass-panel"
            style={{
              padding: '0.6rem 1.2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              borderRadius: 'var(--radius-full)'
            }}
          >
            <CheckCircle2 size={16} color="var(--success-color)" />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Latencia de Inferencia: <strong style={{ color: 'var(--text-color)' }}>~2.02 ms</strong>
            </span>
          </div>

          <div
            className="glass-panel"
            style={{
              padding: '0.6rem 1.2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              borderRadius: 'var(--radius-full)'
            }}
          >
            <CheckCircle2 size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Tracking Biomecánico: <strong style={{ color: 'var(--text-color)' }}>178 Puntos Clave</strong>
            </span>
          </div>

          <div
            className="glass-panel"
            style={{
              padding: '0.6rem 1.2rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              borderRadius: 'var(--radius-full)'
            }}
          >
            <CheckCircle2 size={16} color="var(--accent-secondary)" />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Arquitectura: <strong style={{ color: 'var(--text-color)' }}>ONNX INT8 Edge Ready</strong>
            </span>
          </div>
        </div>
      </section>

      {/* Feature Cards Grid */}
      <section className="container" style={{ paddingBottom: '6rem' }}>
        <div className="section-heading">
          <span className="chip" style={{ marginBottom: '1rem' }}>Tecnología & Rendimiento</span>
          <h2>Diseñado para la comunicación sin fricciones</h2>
          <p>
            Cada componente de ExpresaT ha sido optimizado para ejecutarse fluidamente en cualquier dispositivo sin depender de servidores con GPU costosos.
          </p>
        </div>

        <div className="grid-auto">
          {/* Card 1 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon">
              <Zap size={26} />
            </div>
            <h3 className="feature-card__title">IA en Tiempo Real</h3>
            <p className="feature-card__desc">
              Pipeline de alta frecuencia que procesa flujos continuos a 15 FPS con buffers circulares y cuantización INT8 para respuestas instantáneas.
            </p>
          </div>

          {/* Card 2 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon" style={{ background: 'var(--accent-secondary-bg)', color: 'var(--accent-secondary)' }}>
              <Cpu size={26} />
            </div>
            <h3 className="feature-card__title">Tracking Biomecánico</h3>
            <p className="feature-card__desc">
              MediaPipe Holistic extrae 178 coordenadas 3D de manos, rostro y torso, normalizadas geométricamente respecto al centro de los hombros.
            </p>
          </div>

          {/* Card 3 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon">
              <BookOpen size={26} />
            </div>
            <h3 className="feature-card__title">Aprendizaje Interactivo</h3>
            <p className="feature-card__desc">
              Módulos didácticos estructurados por categorías: abecedario, saludos, números y familia, diseñados para aprender de forma visual y guiada.
            </p>
          </div>

          {/* Card 4 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon" style={{ background: 'var(--accent-secondary-bg)', color: 'var(--accent-secondary)' }}>
              <Layers size={26} />
            </div>
            <h3 className="feature-card__title">Glassmorphism Accesible</h3>
            <p className="feature-card__desc">
              Interfaz fluida con desenfoque optimizado por hardware, contraste cromático validado WCAG 2.2 AA y soporte nativo para modo oscuro y claro.
            </p>
          </div>

          {/* Card 5 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon">
              <Shield size={26} />
            </div>
            <h3 className="feature-card__title">Privacidad por Diseño</h3>
            <p className="feature-card__desc">
              El video de tu cámara nunca se graba ni se transmite en crudo; únicamente los vectores matemáticos de coordenadas viajan a través del WebSocket.
            </p>
          </div>

          {/* Card 6 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon" style={{ background: 'var(--accent-secondary-bg)', color: 'var(--accent-secondary)' }}>
              <Sparkles size={26} />
            </div>
            <h3 className="feature-card__title">Multi-Entorno Inteligente</h3>
            <p className="feature-card__desc">
              Cambia instantáneamente entre servidores de desarrollo local y clústeres en la nube directamente desde la barra de navegación.
            </p>
          </div>
        </div>
      </section>

      {/* Call to Action Banner */}
      <section className="container" style={{ paddingBottom: '6rem' }}>
        <div
          className="glass-panel"
          style={{
            padding: 'clamp(2rem, 5vw, 4rem)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <h2 style={{ fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)' }}>
            ¿Listo para experimentar la traducción de LSM?
          </h2>
          <p style={{ maxWidth: '600px', fontSize: '1.1rem', margin: 0 }}>
            Conecta tu cámara o explora nuestro catálogo interactivo para comenzar a tender puentes de comunicación hoy mismo.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/translator" className="btn-primary" style={{ padding: '0.85rem 2rem', fontSize: '1rem' }}>
              <span>Abrir Traductor</span>
              <ArrowRight size={18} />
            </Link>
            <Link to="/about" className="btn-outline" style={{ padding: '0.85rem 1.75rem', fontSize: '1rem' }}>
              <span>Conoce al Equipo</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
