import React, { useState } from 'react';
import { Server, ChevronDown } from 'lucide-react';

const EnvironmentSelector = () => {
  const [env, setEnv] = useState(() => localStorage.getItem('apiEnv') || 'Local');
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (selectedEnv) => {
    setEnv(selectedEnv);
    setIsOpen(false);
    console.log(`Environment changed to: ${selectedEnv}`);
    localStorage.setItem('apiEnv', selectedEnv);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="btn-outline"
        style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', borderColor: 'var(--panel-border)', color: 'var(--text-color)' }}
      >
        <Server size={16} />
        {env}
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div className="glass-panel" style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '0.5rem',
          minWidth: '150px',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          padding: '0.5rem',
          gap: '0.2rem'
        }}>
          <button 
            onClick={() => handleSelect('Local')}
            style={{ 
              background: 'transparent', border: 'none', color: 'var(--text-color)', 
              padding: '0.5rem', textAlign: 'left', borderRadius: '8px',
              cursor: 'pointer', display: 'block', width: '100%'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(150,150,150,0.1)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            Local (ws://127.0.0.1)
          </button>
          <button 
            onClick={() => handleSelect('Cloud')}
            style={{ 
              background: 'transparent', border: 'none', color: 'var(--text-color)', 
              padding: '0.5rem', textAlign: 'left', borderRadius: '8px',
              cursor: 'pointer', display: 'block', width: '100%'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(150,150,150,0.1)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            Nube (Producción)
          </button>
        </div>
      )}
    </div>
  );
};

export default EnvironmentSelector;
