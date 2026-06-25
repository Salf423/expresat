import React, { useState } from 'react';
import { Mail, Lock, LogIn, UserPlus } from 'lucide-react';
import { AuthService } from '../services/authService';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const authService = new AuthService();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await authService.login(email, password);
        window.location.href = '/translator';
      } else {
        await authService.register(email, password);
        setError('Registro exitoso. Por favor inicia sesión.');
        setIsLogin(true);
      }
    } catch (err) {
      setError(err.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container animate-fade-in" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', padding: '4rem 1.5rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 className="gradient-text" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
            {isLogin ? 'Bienvenido de vuelta' : 'Crea tu cuenta'}
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            {isLogin ? 'Inicia sesión para continuar' : 'Únete a ExpresaT'}
          </p>
        </div>

        {error && (
          <div style={{
            background: error.includes('exitoso') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: error.includes('exitoso') ? 'var(--success-color)' : 'var(--error-color)',
            padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'center', fontSize: '0.9rem'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ position: 'relative' }}>
            <Mail size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="email" 
              placeholder="Correo electrónico" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '0.8rem 1rem 0.8rem 3rem', borderRadius: '8px',
                background: 'rgba(0,0,0,0.05)', border: '1px solid var(--panel-border)',
                color: 'var(--text-color)', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s'
              }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <Lock size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="password" 
              placeholder="Contraseña" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%', padding: '0.8rem 1rem 0.8rem 3rem', borderRadius: '8px',
                background: 'rgba(0,0,0,0.05)', border: '1px solid var(--panel-border)',
                color: 'var(--text-color)', fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s'
              }}
            />
          </div>

          <button type="submit" className="btn-primary" style={{ width: '100%', padding: '1rem', marginTop: '0.5rem', fontSize: '1rem' }} disabled={loading}>
            {loading ? 'Procesando...' : (isLogin ? <><LogIn size={18} /> Iniciar Sesión</> : <><UserPlus size={18} /> Registrarse</>)}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button 
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}
          >
            {isLogin ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
