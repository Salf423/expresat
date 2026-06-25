import React from 'react';
import { BookOpen, Video } from 'lucide-react';

const Learn = () => {
  return (
    <div className="container animate-fade-in" style={{ padding: '4rem 1.5rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 className="gradient-text" style={{ fontSize: '3rem', marginBottom: '1rem' }}>
          Aprende Lengua de Señas Mexicana
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', maxWidth: '600px', margin: '0 auto' }}>
          Nuestra biblioteca interactiva te ayuda a aprender las bases de la LSM a tu propio ritmo.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
        {[
          { title: 'Abecedario', icon: <BookOpen size={32} />, desc: 'Aprende las señas para cada letra del abecedario.' },
          { title: 'Saludos Básicos', icon: <Video size={32} />, desc: 'Hola, gracias, por favor y otras cortesías.' },
          { title: 'Familia', icon: <Video size={32} />, desc: 'Señas relacionadas con el núcleo familiar.' },
          { title: 'Días y Meses', icon: <Video size={32} />, desc: 'Expresa tiempos y fechas correctamente.' }
        ].map((module, idx) => (
          <div key={idx} className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ color: 'var(--accent-primary)', marginBottom: '1rem' }}>
              {module.icon}
            </div>
            <h3 style={{ fontSize: '1.3rem', marginBottom: '0.5rem' }}>{module.title}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '1.5rem', flex: 1 }}>
              {module.desc}
            </p>
            <button className="btn-outline" style={{ width: '100%' }}>Comenzar Módulo</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Learn;
