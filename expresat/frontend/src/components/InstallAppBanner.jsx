import React, { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import {
  isAppAlreadyInstalled,
  shouldShowInstallBanner,
  triggerInstallPrompt,
} from '../utils/pwaInstall.js';

/**
 * Discreet, WCAG 2.2 AA accessible "Instalar App" prompt shown only when the browser
 * dispatches `beforeinstallprompt` and ExpresaT is not already running as an installed PWA.
 */
const InstallAppBanner = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => isAppAlreadyInstalled());
  const [isDismissed, setIsDismissed] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    if (isAppAlreadyInstalled(window)) {
      setIsInstalled(true);
      return undefined;
    }

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const displayModeQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : null;

    const handleDisplayModeChange = (event) => {
      if (event.matches) {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    if (displayModeQuery && typeof displayModeQuery.addEventListener === 'function') {
      displayModeQuery.addEventListener('change', handleDisplayModeChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      if (displayModeQuery && typeof displayModeQuery.removeEventListener === 'function') {
        displayModeQuery.removeEventListener('change', handleDisplayModeChange);
      }
    };
  }, []);

  const handleInstallClick = useCallback(async () => {
    if (!deferredPrompt || isInstalling) return;
    setIsInstalling(true);
    const result = await triggerInstallPrompt(deferredPrompt);
    setIsInstalling(false);
    setDeferredPrompt(null);
    if (result.accepted) {
      setIsInstalled(true);
    }
  }, [deferredPrompt, isInstalling]);

  const visible = shouldShowInstallBanner({
    hasDeferredPrompt: Boolean(deferredPrompt),
    isInstalled,
    isDismissed,
  });

  if (!visible) return null;

  return (
    <aside
      role="region"
      aria-label="Instalar aplicación ExpresaT"
      data-testid="pwa-install-banner"
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: '1rem',
        zIndex: 'var(--z-toast, 400)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.65rem',
        padding: '0.6rem 0.85rem',
        borderRadius: 'var(--radius-full)',
        background: 'var(--panel-bg-solid)',
        border: '1px solid var(--accent-primary-border)',
        boxShadow: 'var(--panel-shadow-hover)',
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      <button
        type="button"
        className="btn-primary"
        onClick={handleInstallClick}
        disabled={isInstalling}
        data-testid="pwa-install-btn"
        style={{
          padding: '0.45rem 0.95rem',
          fontSize: '0.82rem',
        }}
      >
        <Download size={15} aria-hidden="true" />
        <span>{isInstalling ? 'Instalando…' : 'Instalar App'}</span>
      </button>

      <span
        className="desktop-only"
        style={{
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
        }}
      >
        Funciona sin conexión
      </span>

      <button
        type="button"
        className="btn-icon"
        onClick={() => setIsDismissed(true)}
        aria-label="Ocultar botón de instalar aplicación"
        style={{
          width: '28px',
          height: '28px',
          padding: '4px',
        }}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </aside>
  );
};

export default InstallAppBanner;
