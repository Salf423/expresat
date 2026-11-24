import { describe, it, expect, vi } from 'vitest';
import {
  isAppAlreadyInstalled,
  shouldShowInstallBanner,
  triggerInstallPrompt,
} from '../pwaInstall.js';

describe('utils/pwaInstall — Detección de instalación PWA y flujo beforeinstallprompt', () => {
  it('detecta modo standalone por matchMedia, iOS navigator.standalone y referrer Android', () => {
    expect(isAppAlreadyInstalled(null)).toBe(false);
    expect(
      isAppAlreadyInstalled({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: false },
        document: { referrer: '' },
      })
    ).toBe(false);

    expect(
      isAppAlreadyInstalled({
        matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }),
        navigator: {},
        document: { referrer: '' },
      })
    ).toBe(true);

    expect(
      isAppAlreadyInstalled({
        matchMedia: () => ({ matches: false }),
        navigator: { standalone: true },
        document: { referrer: '' },
      })
    ).toBe(true);

    expect(
      isAppAlreadyInstalled({
        matchMedia: () => ({ matches: false }),
        navigator: {},
        document: { referrer: 'android-app://com.google.android.googlequicksearchbox' },
      })
    ).toBe(true);
  });

  it('muestra el banner únicamente cuando existe deferredPrompt y la app no está instalada ni descartada', () => {
    expect(
      shouldShowInstallBanner({
        hasDeferredPrompt: true,
        isInstalled: false,
        isDismissed: false,
      })
    ).toBe(true);

    expect(
      shouldShowInstallBanner({
        hasDeferredPrompt: false,
        isInstalled: false,
        isDismissed: false,
      })
    ).toBe(false);

    expect(
      shouldShowInstallBanner({
        hasDeferredPrompt: true,
        isInstalled: true,
        isDismissed: false,
      })
    ).toBe(false);

    expect(
      shouldShowInstallBanner({
        hasDeferredPrompt: true,
        isInstalled: false,
        isDismissed: true,
      })
    ).toBe(false);
  });

  it('ejecuta deferredPrompt.prompt() y resuelve accepted / dismissed / errores sin lanzar', async () => {
    const acceptedEvent = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    };
    const resAccepted = await triggerInstallPrompt(acceptedEvent);
    expect(acceptedEvent.prompt).toHaveBeenCalledTimes(1);
    expect(resAccepted).toEqual({ prompted: true, accepted: true, outcome: 'accepted' });

    const dismissedEvent = {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    };
    const resDismissed = await triggerInstallPrompt(dismissedEvent);
    expect(resDismissed).toEqual({ prompted: true, accepted: false, outcome: 'dismissed' });

    const brokenEvent = {
      prompt: vi.fn().mockRejectedValue(new Error('blocked')),
    };
    const resBroken = await triggerInstallPrompt(brokenEvent);
    expect(resBroken).toEqual({ prompted: false, accepted: false, outcome: 'error' });

    const resNull = await triggerInstallPrompt(null);
    expect(resNull).toEqual({ prompted: false, accepted: false, outcome: 'unavailable' });
  });
});
