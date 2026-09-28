import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Cloud, Monitor } from 'lucide-react';

const EnvironmentSelector = () => {
  const [env, setEnv] = useState(() => localStorage.getItem('apiEnv') || 'Local');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const handleSelect = (selectedEnv) => {
    setEnv(selectedEnv);
    setIsOpen(false);
    localStorage.setItem('apiEnv', selectedEnv);
    // Disparar evento para que otras partes reactivas puedan actualizar el WebSocket si es necesario
    window.dispatchEvent(new CustomEvent('environment-changed', { detail: selectedEnv }));
  };

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const isLocal = env === 'Local';

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`Servidor API: ${env}`}
        className="btn-outline"
        style={{
          padding: '0.45rem 0.85rem',
          fontSize: '0.85rem',
          borderColor: 'var(--panel-border)',
          color: 'var(--text-color)',
          background: 'var(--panel-bg)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          borderRadius: 'var(--radius-full)'
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isLocal ? 'var(--info-color)' : 'var(--success-color)',
            boxShadow: `0 0 6px ${isLocal ? 'var(--info-color)' : 'var(--success-color)'}`
          }}
        />
        {isLocal ? <Monitor size={14} /> : <Cloud size={14} />}
        <span style={{ fontWeight: 500 }}>{env}</span>
        <ChevronDown 
          size={14} 
          style={{ 
            transition: 'transform 0.2s ease', 
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' 
          }} 
        />
      </button>

      {isOpen && (
        <div 
          role="menu"
          className="glass-panel" 
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.5rem)',
            right: 0,
            minWidth: '200px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 'var(--z-dropdown, 50)',
            padding: '0.4rem',
            gap: '0.2rem',
            animation: 'fade-up 0.15s ease-out'
          }}
        >
          <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Servidor de Inferencia
          </div>

          <button 
            role="menuitem"
            type="button"
            onClick={() => handleSelect('Local')}
            className={`env-menu-item ${isLocal ? 'active' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.6rem 0.75rem',
              borderRadius: 'var(--radius-md)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Monitor size={16} color="var(--info-color)" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Local (Dev)</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ws://127.0.0.1:8000</span>
              </div>
            </div>
            {isLocal && <Check size={16} color="var(--accent-primary)" />}
          </button>

          <button 
            role="menuitem"
            type="button"
            onClick={() => handleSelect('Cloud')}
            className={`env-menu-item ${!isLocal ? 'active' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.6rem 0.75rem',
              borderRadius: 'var(--radius-md)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cloud size={16} color="var(--success-color)" />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Nube (Prod)</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>wss://api.expresat.cloud</span>
              </div>
            </div>
            {!isLocal && <Check size={16} color="var(--accent-primary)" />}
          </button>
        </div>
      )}
    </div>
  );
};

export default EnvironmentSelector;
