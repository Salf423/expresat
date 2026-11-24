/**
 * Pure state machine for the interactive "Reto: Deletrea tu nombre" mode in `Learn.jsx`.
 *
 * Guarantees:
 * - Normalizes Spanish accents (`á/é/í/ó/ú/ü -> A/E/I/O/U`) while preserving `Ñ` (NFC & NFD).
 * - Filters strictly to LSM alphabet letters (`A–Z` and `Ñ`) up to `MAX_SPELL_NAME_LENGTH`.
 * - Validates each letter cleanly (1 stable repetition per letter for fast live demos).
 * - Prevents double-triggering on consecutive identical letters (e.g. `ANNA`, `OTTO`, `GUILLERMO`)
 *   via an explicit `awaiting_release` anti-bounce gate (`repeatReleaseMs`).
 * - Zero DOM, camera, or React dependencies.
 */

import { getLearningSignById } from './catalog.js';

const ENIE_PLACEHOLDER = '\uE000';

export const MAX_SPELL_NAME_LENGTH = 24;
export const DEFAULT_LETTER_STABLE_MS = 200;
export const DEFAULT_REPEAT_RELEASE_MS = 320;
export const DEFAULT_TRANSITION_COOLDOWN_MS = 300;

/**
 * Normalizes a person's name into uppercase LSM alphabet letters (`A–Z` and `Ñ`).
 * Strips vowel accents, punctuation, digits, and whitespace while preserving `Ñ`.
 *
 * @param {string} rawInput
 * @param {number} [maxLength=MAX_SPELL_NAME_LENGTH]
 * @returns {string}
 */
export function normalizeSpellName(rawInput, maxLength = MAX_SPELL_NAME_LENGTH) {
  if (typeof rawInput !== 'string') return '';
  const cleaned = rawInput
    .normalize('NFC')
    .replace(/[ñÑ]/g, ENIE_PLACEHOLDER)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll(ENIE_PLACEHOLDER, 'Ñ')
    .toUpperCase()
    .replace(/[^A-ZÑ]/g, '');

  const cap = Math.max(1, Number.isFinite(maxLength) ? maxLength : MAX_SPELL_NAME_LENGTH);
  return cleaned.slice(0, cap);
}

/**
 * Maps a single normalized uppercase letter (`A–Z` or `Ñ`) to its canonical catalog sign ID.
 *
 * @param {string} letter
 * @returns {string|null}
 */
export function letterToSignId(letter) {
  if (typeof letter !== 'string' || letter.length !== 1) return null;
  if (letter === 'Ñ') return 'letra_enie';
  if (letter >= 'A' && letter <= 'Z') {
    return `letra_${letter.toLowerCase()}`;
  }
  return null;
}

/**
 * Builds the ordered list of target alphabet signs for a given name.
 *
 * @param {string} rawName
 * @returns {{ normalizedName: string, letters: ReadonlyArray<{ index: number, char: string, signId: string, sign: Object }> }}
 */
export function buildNameLetterTargets(rawName, { maxLength = MAX_SPELL_NAME_LENGTH } = {}) {
  const normalizedName = normalizeSpellName(rawName, maxLength);
  const chars = Array.from(normalizedName);
  const letters = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const signId = letterToSignId(ch);
    const sign = signId ? getLearningSignById(signId) : null;
    if (sign) {
      letters.push(
        Object.freeze({
          index: letters.length,
          char: ch,
          signId,
          sign,
        })
      );
    }
  }

  return {
    normalizedName,
    letters: Object.freeze(letters),
  };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export class SpellNameMachine {
  /**
   * @param {Object} [options]
   * @param {string} [options.name='']
   * @param {number} [options.minStableMs=200] Continuous hold duration required for static letters
   * @param {number} [options.repeatReleaseMs=320] Continuous non-match duration required between identical consecutive letters
   * @param {number} [options.transitionCooldownMs=300] Brief cooldown right after advancing to the next letter
   */
  constructor({
    name = '',
    minStableMs = DEFAULT_LETTER_STABLE_MS,
    repeatReleaseMs = DEFAULT_REPEAT_RELEASE_MS,
    transitionCooldownMs = DEFAULT_TRANSITION_COOLDOWN_MS,
  } = {}) {
    this.minStableMs = Math.max(0, minStableMs);
    this.repeatReleaseMs = Math.max(50, repeatReleaseMs);
    this.transitionCooldownMs = Math.max(0, transitionCooldownMs);
    this._initName(name);
  }

  _initName(rawName) {
    const { normalizedName, letters } = buildNameLetterTargets(rawName);
    this.normalizedName = normalizedName;
    this.letters = letters;
    this.currentIndex = 0;
    this.phase = letters.length > 0 ? 'practicing' : 'idle';
    this.stabilityProgress = 0;
    this.lastEvent = null;
    this._holdSinceMs = null;
    this._releaseSinceMs = null;
    this._lastAdvanceMs = -Infinity;
    this._lastTimestampMs = null;
    this.promptMessage =
      letters.length > 0
        ? `Haz la letra «${letters[0].char}» frente a tu cámara.`
        : 'Escribe tu nombre para comenzar el reto.';
  }

  /**
   * Resets the challenge with a new (or the same) name.
   */
  reset(newName = this.normalizedName) {
    this._initName(newName);
    return this.getSnapshot();
  }

  getCurrentTarget() {
    if (this.currentIndex < 0 || this.currentIndex >= this.letters.length) return null;
    return this.letters[this.currentIndex];
  }

  /**
   * Processes one live evaluation tick from `evaluateTargetSign`.
   *
   * @param {Object} input
   * @param {boolean} input.matched Whether the live frame matches the active target letter
   * @param {number} [input.timestampMs] Monotonic timestamp in milliseconds
   * @param {boolean|null} [input.isDynamic] Optional override for dynamic letter trajectory
   */
  update({ matched = false, timestampMs = Date.now(), isDynamic = null } = {}) {
    if (this.phase === 'idle' || this.phase === 'completed') {
      return this.getSnapshot();
    }

    const nowMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();
    if (this._lastTimestampMs !== null && nowMs < this._lastTimestampMs) {
      // Non-monotonic clock reset: clear partial timers safely without losing letter progress
      this._holdSinceMs = null;
      this._releaseSinceMs = null;
      this._lastAdvanceMs = -Infinity;
    }
    this._lastTimestampMs = nowMs;

    const current = this.getCurrentTarget();
    if (!current) {
      this.phase = 'completed';
      this.stabilityProgress = 1;
      return this.getSnapshot();
    }

    this.lastEvent = null;

    // 1. Consecutive identical letter anti-bounce gate (e.g. "ANNA", "OTTO")
    if (this.phase === 'awaiting_release') {
      this.stabilityProgress = 0;
      this._holdSinceMs = null;

      if (matched) {
        // Still holding the previous letter posture -> cancel partial release
        this._releaseSinceMs = null;
        this.lastEvent = {
          type: 'need_release',
          char: current.char,
          index: this.currentIndex,
        };
        this.promptMessage = `¡Bien! Relaja o baja tu mano un instante para volver a hacer la letra «${current.char}».`;
        return this.getSnapshot();
      }

      if (this._releaseSinceMs === null) {
        this._releaseSinceMs = nowMs;
      }

      if (nowMs - this._releaseSinceMs >= this.repeatReleaseMs) {
        this.phase = 'practicing';
        this._releaseSinceMs = null;
        this.promptMessage = `¡Listo! Ahora haz nuevamente la letra «${current.char}».`;
      } else {
        this.promptMessage = `Relaja un instante tu mano antes de repetir la letra «${current.char}»…`;
      }
      return this.getSnapshot();
    }

    // 2. Brief transition cooldown right after advancing to a distinct letter
    if (nowMs - this._lastAdvanceMs < this.transitionCooldownMs) {
      this._holdSinceMs = null;
      this.stabilityProgress = 0;
      return this.getSnapshot();
    }

    // 3. Evaluate active letter stability
    if (!matched) {
      this._holdSinceMs = null;
      this.stabilityProgress = 0;
      this.promptMessage = `Haz la letra «${current.char}» frente a tu cámara.`;
      return this.getSnapshot();
    }

    const targetIsDynamic =
      typeof isDynamic === 'boolean'
        ? isDynamic
        : Boolean(current.sign?.profile?.dynamicMotion);

    let confirmed = false;
    if (targetIsDynamic || this.minStableMs <= 0) {
      this.stabilityProgress = 1;
      confirmed = true;
    } else {
      if (this._holdSinceMs === null) {
        this._holdSinceMs = nowMs;
      }
      const heldMs = Math.max(0, nowMs - this._holdSinceMs);
      this.stabilityProgress = Number(clamp01(heldMs / this.minStableMs).toFixed(3));
      confirmed = heldMs >= this.minStableMs;
      if (!confirmed) {
        this.promptMessage = `¡Exacto! Mantén firme la letra «${current.char}» un instante…`;
        return this.getSnapshot();
      }
    }

    // 4. Letter validated -> advance to next letter or complete challenge
    const prevChar = current.char;
    const prevIndex = this.currentIndex;
    this.currentIndex += 1;
    this._holdSinceMs = null;
    this._lastAdvanceMs = nowMs;

    if (this.currentIndex >= this.letters.length) {
      this.phase = 'completed';
      this.stabilityProgress = 1;
      this.lastEvent = {
        type: 'name_completed',
        name: this.normalizedName,
        char: prevChar,
        index: prevIndex,
      };
      this.promptMessage = `¡Felicidades, ${this.normalizedName}! Deletreaste tu nombre en LSM`;
      return this.getSnapshot();
    }

    const nextTarget = this.letters[this.currentIndex];
    const isRepeatedLetter = nextTarget.char === prevChar;

    this.stabilityProgress = 0;
    if (isRepeatedLetter) {
      this.phase = 'awaiting_release';
      this._releaseSinceMs = null;
      this.promptMessage = `¡Letra «${prevChar}» lograda! Relaja tu mano un instante para repetir la letra «${nextTarget.char}».`;
    } else {
      this.phase = 'practicing';
      this.promptMessage = `¡Letra «${prevChar}» lograda! Siguiente letra: «${nextTarget.char}».`;
    }

    this.lastEvent = {
      type: 'letter_completed',
      char: prevChar,
      index: prevIndex,
      nextChar: nextTarget.char,
      nextIndex: this.currentIndex,
      nextNeedsRelease: isRepeatedLetter,
    };

    return this.getSnapshot();
  }

  getSnapshot() {
    const totalLetters = this.letters.length;
    const completedCount = Math.min(this.currentIndex, totalLetters);
    const progressPct =
      totalLetters > 0 ? Math.round((completedCount / totalLetters) * 100) : 0;

    return {
      normalizedName: this.normalizedName,
      letters: this.letters,
      currentIndex: this.currentIndex,
      currentLetter: this.getCurrentTarget(),
      completedCount,
      totalLetters,
      progressPct,
      phase: this.phase,
      completed: this.phase === 'completed',
      awaitingRelease: this.phase === 'awaiting_release',
      stabilityProgress: this.stabilityProgress,
      lastEvent: this.lastEvent,
      promptMessage: this.promptMessage,
      celebrationMessage: this.normalizedName
        ? `¡Felicidades, ${this.normalizedName}! Deletreaste tu nombre en LSM`
        : '',
    };
  }
}
