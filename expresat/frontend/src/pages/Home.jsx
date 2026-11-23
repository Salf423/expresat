import React from 'react';
import { Link } from 'react-router-dom';
import { Zap, Shield, Sparkles, Hand, BookOpen, Heart, CheckCircle2 } from 'lucide-react';

const Home = () => {
  return (
    <div className="animate-fade-in" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Hero Section */}
      <section className="container hero-section">
        <h1 className="hero-title">
          Rompiendo barreras con <span className="gradient-text">Lengua de Señas Mexicana</span>
        </h1>

        <p className="hero-subtitle">
          ExpresaT traduce y enseña Lengua de Señas Mexicana en tiempo real desde tu cámara, ayudando a personas sordas y oyentes a comunicarse con naturalidad e inclusión.
        </p>

        <div className="hero-actions">
          <Link to="/translator" className="btn-gradient" style={{ fontSize: '1.05rem', padding: '0.85rem 2rem' }}>
            <span>Probar Traductor</span>
          </Link>
          <Link to="/learn" className="btn-outline" style={{ fontSize: '1.05rem', padding: '0.85rem 1.75rem' }}>
            <BookOpen size={18} />
            <span>Aprender LSM</span>
          </Link>
        </div>

        {/* Value Highlights */}
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
              Traducción al instante: <strong style={{ color: 'var(--text-color)' }}>Texto y Voz en Español</strong>
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
              Práctica guiada: <strong style={{ color: 'var(--text-color)' }}>Corrección en Vivo</strong>
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
              100% Privado: <strong style={{ color: 'var(--text-color)' }}>Directo en tu Dispositivo</strong>
            </span>
          </div>
        </div>
      </section>

      {/* Feature Cards Grid */}
      <section className="container" style={{ paddingBottom: '6rem' }}>
        <div className="section-heading">
          <h2>Diseñado para la comunicación sin barreras</h2>
          <p>
            Cada herramienta de ExpresaT está pensada para facilitar la conversación cotidiana y el aprendizaje práctico de la LSM desde cualquier computadora o teléfono.
          </p>
        </div>

        <div className="grid-auto">
          {/* Card 1 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon">
              <Zap size={26} />
            </div>
            <h3 className="feature-card__title">Traducción al Instante</h3>
            <p className="feature-card__desc">
              Reconoce tus señas con naturalidad y las transforma en texto y voz en español al momento, sin instalaciones ni pasos complicados.
            </p>
          </div>

          {/* Card 2 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon" style={{ background: 'var(--accent-secondary-bg)', color: 'var(--accent-secondary)' }}>
              <Hand size={26} />
            </div>
            <h3 className="feature-card__title">Lectura Clara de Manos</h3>
            <p className="feature-card__desc">
              Identifica con precisión la posición de cada dedo y el movimiento natural de tu mano derecha o izquierda, adaptándose a distintas distancias.
            </p>
          </div>

          {/* Card 3 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon">
              <BookOpen size={26} />
            </div>
            <h3 className="feature-card__title">Aprendizaje Guiado en Vivo</h3>
            <p className="feature-card__desc">
              Practica números, letras, frases cortas y agradecimientos frente a tu cámara con indicaciones claras para perfeccionar cada postura.
            </p>
          </div>

          {/* Card 4 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon" style={{ background: 'var(--accent-secondary-bg)', color: 'var(--accent-secondary)' }}>
              <Heart size={26} />
            </div>
            <h3 className="feature-card__title">Diseño Accesible e Inclusivo</h3>
            <p className="feature-card__desc">
              Interfaz limpia pensada para todas las personas, con alto contraste legible, modo claro u oscuro y navegación cómoda por teclado.
            </p>
          </div>

          {/* Card 5 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon">
              <Shield size={26} />
            </div>
            <h3 className="feature-card__title">Privacidad Garantizada</h3>
            <p className="feature-card__desc">
              Tu cámara funciona localmente en tu navegador sin grabar ni subir video a internet. Tu imagen permanece siempre bajo tu control.
            </p>
          </div>

          {/* Card 6 */}
          <div className="glass-panel feature-card">
            <div className="feature-card__icon" style={{ background: 'var(--accent-secondary-bg)', color: 'var(--accent-secondary)' }}>
              <Sparkles size={26} />
            </div>
            <h3 className="feature-card__title">Listo en Cualquier Dispositivo</h3>
            <p className="feature-card__desc">
              Funciona sin conexión en computadora, tablet o teléfono móvil en posición vertical, ideal para escuelas, hogares y espacios comunitarios.
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
            ¿Listo para comunicarte en Lengua de Señas Mexicana?
          </h2>
          <p style={{ maxWidth: '600px', fontSize: '1.1rem', margin: 0 }}>
            Activa tu cámara para traducir al instante o entra al módulo de aprendizaje para practicar paso a paso a tu propio ritmo.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link to="/translator" className="btn-primary" style={{ padding: '0.85rem 2rem', fontSize: '1rem' }}>
              <span>Abrir Traductor</span>
            </Link>
            <Link to="/learn" className="btn-outline" style={{ padding: '0.85rem 1.75rem', fontSize: '1rem' }}>
              <span>Empezar a Aprender</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
