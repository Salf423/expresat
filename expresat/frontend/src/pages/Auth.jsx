import React, { useState } from 'react';
import { Mail, Lock, LogIn, UserPlus, User, Eye, EyeOff, CheckCircle2, ArrowLeft, KeyRound, AlertCircle } from 'lucide-react';
import { AuthService } from '../services/authService';
import logoImg from '../assets/logo.png';

const Auth = () => {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const authService = new AuthService();

  const validateEmail = (val) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
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
    if (score === 1) return { label: 'Débil', color: 'var(--error-color)', width: '25%' };
    if (score === 2) return { label: 'Regular', color: 'var(--warning-color)', width: '50%' };
    if (score === 3) return { label: 'Fuerte', color: 'var(--success-color)', width: '75%' };
    return { label: 'Excelente', color: 'var(--success-color)', width: '100%' };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validateEmail(email)) {
      setError('Por favor ingresa un correo electrónico válido.');
      return;
    }

    if (mode === 'register') {
      if (!fullName.trim()) {
        setError('El nombre completo es obligatorio.');
        return;
      }
      if (calculatePasswordStrength(password) < 4) {
        setError('La contraseña debe tener mínimo 8 caracteres, una mayúscula, un número y un carácter especial.');
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
        setSuccess('¡Registro exitoso! Revisa tu correo electrónico para confirmar tu cuenta.');
        setMode('login');
      } else if (mode === 'forgot') {
        await authService.resetPassword(email);
        setSuccess('Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.');
        setMode('login');
      }
    } catch (err) {
      setError(err.message || 'Error de autenticación. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const strength = calculatePasswordStrength(password);
  const strengthConfig = getStrengthConfig(strength);

  return (
    <div
      className="container animate-fade-in"
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flex: 1,
        padding: '3rem 1.5rem'
      }}
    >
      <div className="glass-panel auth-card" style={{ maxWidth: '440px' }}>
        {/* Header */}
        <div className="auth-header">
          <img
            src={logoImg}
            alt="ExpresaT"
            className="auth-logo"
          />
          <h1
            className="gradient-text"
            style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.4rem' }}
          >
            {mode === 'login' && 'Bienvenido de vuelta'}
            {mode === 'register' && 'Crea tu cuenta'}
            {mode === 'forgot' && 'Recuperar contraseña'}
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
            {mode === 'login' && 'Ingresa tus credenciales para acceder a tus preferencias'}
            {mode === 'register' && 'Únete a la plataforma inclusiva de traducción LSM'}
            {mode === 'forgot' && 'Te enviaremos las instrucciones de recuperación'}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert alert--error" role="alert" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        {/* Success Alert */}
        {success && (
          <div className="alert alert--success" role="status" style={{ marginBottom: '1.5rem' }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{success}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {/* Full Name (Only on Register) */}
          {mode === 'register' && (
            <div className="form-field">
              <label htmlFor="fullName" className="form-label">
                Nombre Completo
              </label>
              <div style={{ position: 'relative' }}>
                <span className="form-field__icon">
                  <User size={18} />
                </span>
                <input
                  id="fullName"
                  type="text"
                  placeholder="Ej. Ana Morales"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="form-input"
                  required
                />
              </div>
            </div>
          )}

          {/* Email */}
          <div className="form-field">
            <label htmlFor="email" className="form-label">
              Correo Electrónico
            </label>
            <div style={{ position: 'relative' }}>
              <span className="form-field__icon">
                <Mail size={18} />
              </span>
              <input
                id="email"
                type="email"
                placeholder="correo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                autoComplete="email"
                required
              />
            </div>
          </div>

          {/* Password (Login & Register) */}
          {mode !== 'forgot' && (
            <div className="form-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="password" className="form-label">
                  Contraseña
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-primary)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      padding: 0
                    }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <span className="form-field__icon">
                  <Lock size={18} />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-input"
                  style={{ paddingRight: '2.75rem' }}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  className="btn-icon form-field__action"
                  style={{ padding: '0.25rem', width: '28px', height: '28px' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Password Strength Indicator */}
              {mode === 'register' && password.length > 0 && (
                <div style={{ marginTop: '0.4rem' }}>
                  <div
                    style={{
                      height: '4px',
                      width: '100%',
                      background: 'var(--panel-border)',
                      borderRadius: 'var(--radius-full)',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: strengthConfig.width,
                        background: strengthConfig.color,
                        transition: 'all 0.3s ease'
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '0.35rem',
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)'
                    }}
                  >
                    <span style={{ color: strengthConfig.color, fontWeight: 600 }}>{strengthConfig.label}</span>
                    <span>8+ caract., mayúscula, núm., símbolo</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Confirm Password (Only on Register) */}
          {mode === 'register' && (
            <div className="form-field">
              <label htmlFor="confirmPassword" className="form-label">
                Confirmar Contraseña
              </label>
              <div style={{ position: 'relative' }}>
                <span className="form-field__icon">
                  <KeyRound size={18} />
                </span>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="form-input"
                  autoComplete="new-password"
                  required
                />
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className={`btn-primary ${loading ? 'btn-primary--loading' : ''}`}
            disabled={loading}
            style={{ width: '100%', padding: '0.85rem', marginTop: '0.5rem', fontSize: '0.95rem' }}
          >
            {!loading && mode === 'login' && (
              <>
                <LogIn size={18} />
                <span>Iniciar Sesión</span>
              </>
            )}
            {!loading && mode === 'register' && (
              <>
                <UserPlus size={18} />
                <span>Crear Cuenta</span>
              </>
            )}
            {!loading && mode === 'forgot' && (
              <>
                <Mail size={18} />
                <span>Enviar Instrucciones</span>
              </>
            )}
          </button>
        </form>

        {/* Mode Switcher */}
        <div
          style={{
            textAlign: 'center',
            marginTop: '2rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid var(--border-color)'
          }}
        >
          {mode !== 'login' ? (
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                transition: 'color var(--transition-fast)'
              }}
              onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-color)'}
              onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <ArrowLeft size={16} />
              <span>Volver a Iniciar Sesión</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); setSuccess(''); }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-primary)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                textDecoration: 'none'
              }}
              onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
              onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
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
