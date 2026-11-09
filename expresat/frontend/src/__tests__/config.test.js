import { describe, it, expect } from 'vitest';
import { buildConfig, validateConfig } from '../config.js';

describe('src/config.js — Validación de variables de entorno', () => {
  it('aplica valores por defecto seguros cuando el entorno está vacío', () => {
    const cfg = buildConfig({});
    const validation = validateConfig({});
    expect(validation.valid).toBe(true);
    expect(cfg.demoMode).toBe(true);
    expect(cfg.wsUrlLocal).toBe('ws://127.0.0.1:8000/ws/translate');
    expect(cfg.wsUrlProd).toBe('wss://expresat.onrender.com/ws/translate');
    expect(cfg.apiUrlProd).toBe('https://expresat.onrender.com');
    expect(cfg.supabaseConfigured).toBe(false);
    expect(cfg.targetFps).toBeGreaterThanOrEqual(15);
    expect(cfg.targetFps).toBeLessThanOrEqual(30);
    expect(cfg.validation.valid).toBe(true);
    expect(cfg.validation.missingOptional).toContain('VITE_SUPABASE_URL');
    expect(cfg.validation.missingOptional).toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('reemplaza dominios placeholder obsoletos (api.expresat.cloud) por el fallback real de Render', () => {
    const cfg = buildConfig({
      VITE_WS_URL_PROD: 'wss://api.expresat.cloud/ws',
      VITE_SUPABASE_URL: 'https://your-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'your-anon-key',
    });
    expect(cfg.wsUrlProd).toBe('wss://expresat.onrender.com/ws/translate');
    expect(cfg.supabaseConfigured).toBe(false);
    expect(cfg.validation.warnings.length).toBeGreaterThan(0);
  });

  it('respeta variables válidas explícitas sin exponer secretos en validation.summary', () => {
    const secretKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.supersecret';
    const cfg = buildConfig({
      VITE_SUPABASE_URL: 'https://xyzcompany.supabase.co',
      VITE_SUPABASE_ANON_KEY: secretKey,
      VITE_WS_URL_PROD: 'wss://expresat.onrender.com/ws/translate',
      VITE_API_URL: 'https://expresat.onrender.com',
      VITE_TARGET_FPS: '24',
      VITE_ENABLE_POSE: 'true',
    });
    expect(cfg.supabaseConfigured).toBe(true);
    expect(cfg.targetFps).toBe(24);
    expect(cfg.enablePose).toBe(true);
    expect(cfg.validation.missingOptional).toEqual([]);
    expect(cfg.validation.summary).not.toContain(secretKey);
  });
});
