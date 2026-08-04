import React, { useEffect, useRef, useState } from 'react';
import { Camera, Activity, MessageSquare } from 'lucide-react';
import { ApiService } from '../services/apiService';
import { MediaPipeEngine } from '../services/mediapipeEngine';

const Translator = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const apiRef = useRef(null);

  const [translation, setTranslation] = useState('');
  const [status, setStatus] = useState('Desconectado');
  const [statusClass, setStatusClass] = useState('status-offline');
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const env = localStorage.getItem('apiEnv') || 'Local';
    const wsUrl = env === 'Local' 
      ? (import.meta.env.VITE_WS_URL_LOCAL || 'ws://127.0.0.1:8000/ws') 
      : (import.meta.env.VITE_WS_URL_PROD || 'wss://api.expresat.cloud/ws');

    const apiService = new ApiService(wsUrl);
    apiRef.current = apiService;

    apiService.connect('mock_token');

    apiService.onStatusChange((text, className) => {
      setStatus(text);
      setStatusClass(className);
    });

    apiService.onMessage((text) => {
      setTranslation(text);
    });

    if (videoRef.current && canvasRef.current && !engineRef.current) {
      const engine = new MediaPipeEngine(videoRef.current, canvasRef.current, (landmarks) => {
        apiService.sendLandmarks(landmarks);
      });

      // Track FPS without breaking the original render loop
      engine.frameCount = 0;
      engine.lastFpsTime = performance.now();

      const originalRenderLoop = engine.renderLoop.bind(engine);
      engine.renderLoop = () => {
        engine.frameCount++;
        const now = performance.now();
        if (now - engine.lastFpsTime >= 1000) {
          setFps(engine.frameCount);
          engine.frameCount = 0;
          engine.lastFpsTime = now;
        }
        // Call the original render loop so MediaPipe actually processes frames
        originalRenderLoop();
      };

      engine.start();
      engineRef.current = engine;
      
      // Dispatch event to pause background particles
      window.dispatchEvent(new CustomEvent('camera-active', { detail: true }));
    }

    return () => {
      if (apiRef.current && apiRef.current.ws) {
        apiRef.current.ws.close();
      }
      if (engineRef.current) {
        // Detiene la cámara y cancela el renderLoop + listeners de visibilidad
        if (engineRef.current.camera) engineRef.current.camera.stop();
        engineRef.current.destroy();
      }
      // Resume background particles when camera stops
      window.dispatchEvent(new CustomEvent('camera-active', { detail: false }));
    };
  }, []);

  return (
    <div className="container animate-fade-in" style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 className="gradient-text" style={{ fontSize: '2.5rem' }}>Traductor LSM</h1>
        
        <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 1rem', borderRadius: '50px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>FPS: <strong style={{ color: 'var(--text-color)' }}>{fps}</strong></span>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'var(--panel-border)' }}></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ 
              width: '10px', height: '10px', borderRadius: '50%', 
              background: statusClass.includes('online') ? 'var(--success-color)' : 'var(--error-color)',
              boxShadow: `0 0 8px ${statusClass.includes('online') ? 'var(--success-color)' : 'var(--error-color)'}`
            }}></div>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-color)' }}>{status}</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem', flex: 1 }}>
        {/* Video Area */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', position: 'relative', minHeight: '400px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--accent-primary)' }}>
            <Camera size={20} />
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-color)' }}>Cámara</h3>
          </div>
          
          <div style={{ 
            position: 'relative', width: '100%', flex: 1, background: '#000', borderRadius: '12px', overflow: 'hidden',
            display: 'flex', justifyContent: 'center', alignItems: 'center'
          }}>
            <video 
              ref={videoRef} 
              style={{ display: 'none' }} 
              playsInline 
            ></video>
            <canvas 
              ref={canvasRef} 
              width={640} 
              height={480}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            ></canvas>
          </div>
        </div>

        {/* Translation Output */}
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--accent-secondary)' }}>
            <MessageSquare size={20} />
            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-color)' }}>Traducción</h3>
          </div>
          
          <div style={{ 
            flex: 1, background: 'rgba(0,0,0,0.05)', borderRadius: '12px', padding: '1.5rem',
            border: '1px solid var(--panel-border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center'
          }}>
            {translation ? (
              <p style={{ fontSize: '2rem', fontWeight: '500', color: 'var(--text-color)', textAlign: 'center', lineHeight: '1.4' }}>
                {translation}
              </p>
            ) : (
              <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic', marginTop: '2rem' }}>
                Esperando señas...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Translator;
