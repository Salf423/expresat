/**
 * Pure PWA installation state helpers (beforeinstallprompt + standalone detection).
 * Zero React dependencies so state transitions can be tested deterministically.
 */

export function isAppAlreadyInstalled(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  try {
    if (typeof win.matchMedia === 'function') {
      if (win.matchMedia('(display-mode: standalone)').matches) return true;
      if (win.matchMedia('(display-mode: minimal-ui)').matches) return true;
    }
    if (win.navigator && win.navigator.standalone === true) {
      return true;
    }
    if (win.document && typeof win.document.referrer === 'string') {
      if (win.document.referrer.startsWith('android-app://')) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function shouldShowInstallBanner({
  hasDeferredPrompt = false,
  isInstalled = false,
  isDismissed = false,
} = {}) {
  return Boolean(hasDeferredPrompt && !isInstalled && !isDismissed);
}

/**
 * Triggers a captured `BeforeInstallPromptEvent` safely and normalizes its outcome.
 *
 * @param {Event|null|undefined} deferredPrompt
 * @returns {Promise<{ prompted: boolean, accepted: boolean, outcome: string }>}
 */
export async function triggerInstallPrompt(deferredPrompt) {
  if (!deferredPrompt || typeof deferredPrompt.prompt !== 'function') {
    return { prompted: false, accepted: false, outcome: 'unavailable' };
  }
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    const outcome = choice?.outcome || 'dismissed';
    return {
      prompted: true,
      accepted: outcome === 'accepted',
      outcome,
    };
  } catch {
    return { prompted: false, accepted: false, outcome: 'error' };
  }
}
