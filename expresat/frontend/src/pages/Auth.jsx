import React, { useState } from 'react';
import { Mail, Lock, LogIn, UserPlus, User, Eye, EyeOff, CheckCircle, ArrowLeft } from 'lucide-react';
import { AuthService } from '../services/authService';
import logoImg from '../assets/logo.png';

const Auth = () => {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const authService = new AuthService();

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const calculatePasswordStrength = (pass) => {
    let score = 0;
    if (pass.length > 7) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return score;
  };

  const getStrengthConfig = (score) => {
    if (score === 0) return { label: '', color: 'transparent', width: '0%' };
    if (score === 1) return { label: 'Débil', color: '#ef4444', width: '25%' };
    if (score === 2) return { label: 'Regular', color: '#eab308', width: '50%' };
    if (score === 3) return { label: 'Fuerte', color: '#22c55e', width: '75%' };
    return { label: 'Muy Fuerte', color: '#16a34a', width: '100%' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validateEmail(email)) {
      setError('Por favor, ingresa un correo electrónico válido.');
      return;
    }

    if (mode === 'register') {
      if (!fullName.trim()) {
        setError('El nombre completo es obligatorio.');
        return;
      }
      if (calculatePasswordStrength(password) < 4) {
        setError('La contraseña debe tener al menos 8 caracteres, una mayúscula, un número y un carácter especial.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden.');
        return;
      }
    } else if (mode === 'login') {
      if (!password) {
        setError('La contraseña es obligatoria.');
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === 'login') {
        await authService.login(email, password);
        window.location.href = '/translator';
      } else if (mode === 'register') {
        await authService.register(email, password, fullName);
        setSuccess('¡Registro exitoso! Por favor revisa tu bandeja de entrada para confirmar tu correo electrónico.');
        setMode('login');
      } else if (mode === 'forgot') {
        await authService.resetPassword(email);
        setSuccess('Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.');
        setMode('login');
      }
    } catch (err) {
      setError(err.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  const strength = calculatePasswordStrength(password);
  const strengthConfig = getStrengthConfig(strength);

  return (
    <div className="container animate-fade-in" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', padding: '4rem 1.5rem' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img src={logoImg} alt="ExpresaT Logo" style={{ height: '60px', width: 'auto', objectFit: 'contain', marginBottom: '1rem' }} />
          <h2 className="gradient-text" style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>
            {mode === 'login' && 'Bienvenido de vuelta'}
            {mode === 'register' && 'Crea tu cuenta'}
            {mode === 'forgot' && 'Recuperar contraseña'}
          </h2>
          <p style={{ color: 'var(--text-muted)' }}>
            {mode === 'login' && 'Inicia sesión para continuar'}
            {mode === 'register' && 'Únete a ExpresaT'}
            {mode === 'forgot' && 'Te enviaremos instrucciones'}
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--error-color)',
            padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'center', fontSize: '0.9rem',
            border: '1px solid rgba(239, 68, 68, 0.2)'
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            background: 'rgba(34, 197, 94, 0.1)',
            color: 'var(--success-color)',
            padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'center', fontSize: '0.9rem',
            border: '1px solid rgba(34, 197, 94, 0.2)'
          }}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

          {mode === 'register' && (
            <div style={{ position: 'relative' }}>
              <User size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Nombre completo"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={{
                  width: '100%', padding: '0.8rem 1rem 0.8rem 3rem', borderRadius: '8px',
                  background: 'rgba(0,0,0,0.05)', border: '1px solid var(--panel-border)',
                  color: 'var(--text-color)', fontSize: '1rem', outline: 'none'
                }}
              />
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <Mail size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="email"
              placeholder="Correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%', padding: '0.8rem 1rem 0.8rem 3rem', borderRadius: '8px',
                background: 'rgba(0,0,0,0.05)', border: '1px solid var(--panel-border)',
                color: 'var(--text-color)', fontSize: '1rem', outline: 'none'
              }}
            />
          </div>

          {mode !== 'forgot' && (
            <div style={{ position: 'relative' }}>
              <Lock size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%', padding: '0.8rem 3rem 0.8rem 3rem', borderRadius: '8px',
                  background: 'rgba(0,0,0,0.05)', border: '1px solid var(--panel-border)',
                  color: 'var(--text-color)', fontSize: '1rem', outline: 'none'
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}

          {mode === 'register' && password.length > 0 && (
            <div style={{ marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ height: '4px', width: '100%', background: 'var(--panel-border)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: strengthConfig.width, background: strengthConfig.color, transition: 'all 0.3s' }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.3rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                <span>{strengthConfig.label}</span>
                <span>(8+ chars, Mayús, Núm, Especial)</span>
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div style={{ position: 'relative' }}>
              <CheckCircle size={20} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirmar contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={{
                  width: '100%', padding: '0.8rem 1rem 0.8rem 3rem', borderRadius: '8px',
                  background: 'rgba(0,0,0,0.05)', border: '1px solid var(--panel-border)',
                  color: 'var(--text-color)', fontSize: '1rem', outline: 'none'
                }}
              />
            </div>
          )}

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginTop: '-0.5rem' }}>
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}

          <button type="submit" className="btn-primary" style={{ width: '100%', padding: '1rem', marginTop: '0.5rem', fontSize: '1rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }} disabled={loading}>
            {loading ? 'Procesando...' : (
              mode === 'login' ? <><LogIn size={18} /> Iniciar Sesión</> :
                mode === 'register' ? <><UserPlus size={18} /> Registrarse</> :
                  <><Mail size={18} /> Enviar enlace</>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          {mode !== 'login' ? (
            <button
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', margin: '0 auto' }}
            >
              <ArrowLeft size={16} /> Volver a Iniciar Sesión
            </button>
          ) : (
            <button
              onClick={() => { setMode('register'); setError(''); setSuccess(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}
            >
              ¿No tienes cuenta? Regístrate aquí
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
