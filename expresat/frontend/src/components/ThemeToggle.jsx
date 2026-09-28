import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { Sun, Moon } from 'lucide-react';

const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button 
      type="button"
      onClick={toggleTheme} 
      className="btn-icon" 
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      style={{
        width: '40px',
        height: '40px',
        borderRadius: 'var(--radius-full)',
        border: '1px solid var(--panel-border)',
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        cursor: 'pointer',
        transition: 'all var(--transition-fast)'
      }}
    >
      {isDark ? (
        <Sun size={19} color="#fbbf24" style={{ transition: 'transform 0.3s ease' }} />
      ) : (
        <Moon size={19} color="var(--accent-secondary)" style={{ transition: 'transform 0.3s ease' }} />
      )}
    </button>
  );
};

export default ThemeToggle;
