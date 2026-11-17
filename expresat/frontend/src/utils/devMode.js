/**
 * src/utils/devMode.js — Estado y persistencia del Modo Desarrollador en tiempo de ejecución
 *
 * Permite activar en producción (apagado por defecto) el grabador de calibración de
 * MediaPipe (`DevRecorder`), el panel de instrumentación y los controles de fixtures.
 * En entorno Vite DEV permanece encendido por defecto salvo que se desactive manualmente.
 */

export const DEV_MODE_STORAGE_KEY = 'expresat_dev_mode';

function resolveStorage(explicitStorage) {
  if (explicitStorage !== undefined) return explicitStorage;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readInitialDevMode({
  isDev = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.DEV),
  storage,
  search = typeof window !== 'undefined' ? window.location?.search || '' : '',
} = {}) {
  if (search) {
    try {
      const param = new URLSearchParams(search).get('dev');
      if (param === '1' || param === 'true') return true;
      if (param === '0' || param === 'false') return false;
    } catch {
      // Ignorar URLs malformadas
    }
  }

  const store = resolveStorage(storage);
  if (store && typeof store.getItem === 'function') {
    try {
      const saved = store.getItem(DEV_MODE_STORAGE_KEY);
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {
      // Ignorar bloqueo de almacenamiento (navegación privada / CSP)
    }
  }

  return Boolean(isDev);
}

export function persistDevMode(enabled, { storage } = {}) {
  const normalized = Boolean(enabled);
  const store = resolveStorage(storage);
  if (store && typeof store.setItem === 'function') {
    try {
      store.setItem(DEV_MODE_STORAGE_KEY, normalized ? 'true' : 'false');
    } catch {
      // Silencioso si localStorage no está disponible
    }
  }
  return normalized;
}
