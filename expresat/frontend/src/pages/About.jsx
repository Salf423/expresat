import React from 'react';

const About = () => {
  return (
    <div className="container animate-fade-in" style={{ padding: '4rem 1.5rem' }}>
      <div className="glass-panel" style={{ padding: '3rem', maxWidth: '800px', margin: '0 auto' }}>
        <h1 className="gradient-text" style={{ fontSize: '3rem', marginBottom: '2rem', textAlign: 'center' }}>
          Sobre Nosotros
        </h1>
        
        <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: '1.8' }}>
          <p style={{ marginBottom: '1.5rem' }}>
            ExpresaT nació con la visión de derribar las barreras de comunicación para la comunidad sorda en México y el mundo.
          </p>
          <p style={{ marginBottom: '1.5rem' }}>
            Nuestro equipo combina experiencia en inteligencia artificial, desarrollo de interfaces modernas y un profundo compromiso social para ofrecer una herramienta tecnológica que no solo traduce, sino que conecta a las personas.
          </p>
          <p>
            Utilizamos las últimas tecnologías en visión por computadora a través de MediaPipe y redes neuronales procesadas en tiempo real para interpretar los complejos gestos de la Lengua de Señas Mexicana (LSM).
          </p>
        </div>
      </div>
    </div>
  );
};

export default About;
