import { describe, it, expect } from 'vitest';
import {
  DEV_MODE_STORAGE_KEY,
  readInitialDevMode,
  persistDevMode,
} from '../devMode.js';

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe('utils/devMode — Activación y persistencia de Modo Desarrollador en producción', () => {
  it('en producción inicia apagado por defecto para usuarios finales y encendido en DEV', () => {
    const emptyStore = createMemoryStorage();
    expect(readInitialDevMode({ isDev: false, storage: emptyStore, search: '' })).toBe(false);
    expect(readInitialDevMode({ isDev: true, storage: emptyStore, search: '' })).toBe(true);
  });

  it('respeta persistencia en localStorage cuando el usuario activa o desactiva el botón', () => {
    const store = createMemoryStorage();
    persistDevMode(true, { storage: store });
    expect(store.getItem(DEV_MODE_STORAGE_KEY)).toBe('true');
    expect(readInitialDevMode({ isDev: false, storage: store, search: '' })).toBe(true);

    persistDevMode(false, { storage: store });
    expect(store.getItem(DEV_MODE_STORAGE_KEY)).toBe('false');
    expect(readInitialDevMode({ isDev: true, storage: store, search: '' })).toBe(false);
  });

  it('permite override por parámetro URL ?dev=1 o ?dev=0 y tolera fallos de almacenamiento', () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readInitialDevMode({ isDev: false, storage: brokenStorage, search: '?dev=1' })).toBe(
      true
    );
    expect(readInitialDevMode({ isDev: true, storage: brokenStorage, search: '?dev=0' })).toBe(
      false
    );
    expect(readInitialDevMode({ isDev: false, storage: brokenStorage, search: '' })).toBe(false);
    expect(persistDevMode(true, { storage: brokenStorage })).toBe(true);
  });
});
