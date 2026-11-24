/**
 * Pure Text/Voice -> LSM sign sequencer (`sequenceTextToSigns`).
 *
 * Normalizes Spanish text (preserving `Ñ` while stripping vowel diacritics and punctuation),
 * greedily matches multi-word phrases and single words from the canonical 70-sign LSM catalog,
 * and automatically fingerspells unknown words letter by letter using the LSM alphabet (A–Z + Ñ)
 * and digits (0–9).
 *
 * Zero DOM, network, or React dependencies — 100% offline & deterministic.
 */

import {
  NUMBER_SIGN_IDS,
  ALPHABET_SIGN_IDS,
  SHORT_PHRASE_SIGN_IDS,
  COURTESY_SIGN_IDS,
  buildExtendedSignEntry,
} from './modeCatalog.js';

const ENIE_PLACEHOLDER = '\uE000';

export const PLAYBACK_SPEEDS = Object.freeze({
  slow: Object.freeze({ id: 'slow', label: 'Lento', intervalMs: 2400 }),
  normal: Object.freeze({ id: 'normal', label: 'Normal', intervalMs: 1400 }),
});

const FINGER_ORDER = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);
const FINGER_LABELS_ES = Object.freeze({
  thumb: 'Pulgar',
  index: 'Índice',
  middle: 'Medio',
  ring: 'Anular',
  pinky: 'Meñique',
});

/**
 * Normalizes Spanish text for dictionary lookup and fingerspelling:
 * - Preserves `Ñ` / `ñ` (both NFC and NFD forms)
 * - Strips vowel accents (`á -> a`, `é -> e`, `í -> i`, `ó -> o`, `ú -> u`, `ü -> u`)
 * - Lowercases and collapses whitespace
 *
 * @param {string} rawText
 * @returns {string}
 */
export function normalizeSpanishText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return '';
  return rawText
    .normalize('NFC')
    .replace(/[ñÑ]/g, ENIE_PLACEHOLDER)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll(ENIE_PLACEHOLDER, 'ñ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates concise anatomical posture chips from a catalog sign profile.
 */
export function describeSignPosture(sign) {
  const badges = [];
  const profile = sign?.profile;
  if (!profile) return badges;

  if (profile.fPinch) {
    badges.push('Índice y pulgar en pinza');
    badges.push('Medio, anular y meñique arriba');
  } else if (profile.pinch) {
    badges.push('Pulgar + índice en círculo');
  } else if (profile.zeroOval) {
    badges.push('Dedos en óvalo (forma O)');
  } else if (profile.cArc) {
    badges.push('Dedos curvados en arco (C)');
  } else if (profile.clawShape) {
    badges.push('4 dedos doblados en garra');
  } else if (profile.hookIndex) {
    badges.push('Índice doblado en gancho');
  } else if (profile.dCircle) {
    badges.push('Índice arriba + círculo con pulgar');
  } else if (profile.kpShape) {
    badges.push('Índice y medio arriba + pulgar al centro');
  } else if (profile.fingers?.thumb === 'adducted') {
    badges.push('Puño + pulgar recto al costado');
  } else if (profile.fingers?.thumb === 'tucked') {
    badges.push('Puño + pulgar entre índice y medio');
  } else if (profile.fingers) {
    const extended = FINGER_ORDER.filter((key) => profile.fingers[key] === true);
    if (extended.length === 0) {
      badges.push('Todos los dedos cerrados (Puño)');
    } else if (extended.length === 5) {
      badges.push('Los 5 dedos abiertos');
    } else {
      badges.push(`Extiende: ${extended.map((k) => FINGER_LABELS_ES[k]).join(', ')}`);
    }
  }

  if (profile.fingerSpread === 'together') badges.push('Dedos juntos');
  else if (profile.fingerSpread === 'apart') badges.push('Dedos separados');
  else if (profile.fingerSpread === 'crossed') badges.push('Índice y medio cruzados');

  if (profile.orientation === 'FRONT') badges.push('Palma al frente');
  else if (profile.orientation === 'BACK') badges.push('Dorso a la cámara');

  if (profile.handDirection === 'DOWN') badges.push('Dedos hacia abajo');
  else if (profile.handDirection === 'HORIZONTAL') badges.push('Dedos horizontales');
  else if (profile.handDirection === 'TILTED') badges.push('Mano inclinada en diagonal');

  if (profile.motionBadge) {
    badges.push(profile.motionBadge);
  } else if (profile.dynamicMotion === 'wave') {
    badges.push('Movimiento lateral (saludo)');
  } else if (profile.dynamicMotion === 'rotation') {
    badges.push('Giro de muñeca palma ↔ dorso');
  }

  return badges;
}

// Build lookup tables once from the single source of truth (`modeCatalog.js`)
const ENTRY_BY_ID = new Map();
const LETTER_BY_CHAR = new Map();
const DIGIT_BY_CHAR = new Map();
const DIRECT_PHRASE_MAP = new Map();

for (const id of [
  ...NUMBER_SIGN_IDS,
  ...ALPHABET_SIGN_IDS,
  ...SHORT_PHRASE_SIGN_IDS,
  ...COURTESY_SIGN_IDS,
]) {
  ENTRY_BY_ID.set(id, buildExtendedSignEntry(id));
}

// Alphabet map: 'a'..'z' + 'ñ' -> sign entry
for (const id of ALPHABET_SIGN_IDS) {
  const entry = ENTRY_BY_ID.get(id);
  const charKey = normalizeSpanishText(entry.shortLabel || '');
  if (charKey.length === 1) {
    LETTER_BY_CHAR.set(charKey, entry);
  }
}

// Digits '0'..'10' and number words 'cero'..'diez'
for (const id of NUMBER_SIGN_IDS) {
  const entry = ENTRY_BY_ID.get(id);
  const wordKey = normalizeSpanishText(entry.label);
  if (wordKey) {
    DIRECT_PHRASE_MAP.set(wordKey, { entry, category: 'number' });
  }
  const digitKey = normalizeSpanishText(entry.shortLabel || '');
  if (digitKey) {
    DIRECT_PHRASE_MAP.set(digitKey, { entry, category: 'number' });
    if (digitKey.length === 1) {
      DIGIT_BY_CHAR.set(digitKey, entry);
    }
  }
}

// Phrases & courtesy signs (single-word and multi-word)
for (const id of [...SHORT_PHRASE_SIGN_IDS, ...COURTESY_SIGN_IDS]) {
  const entry = ENTRY_BY_ID.get(id);
  const key = normalizeSpanishText(entry.label);
  if (key && !DIRECT_PHRASE_MAP.has(key)) {
    DIRECT_PHRASE_MAP.set(key, { entry, category: key.includes(' ') ? 'phrase' : 'word' });
  }
  const speakKey = normalizeSpanishText(entry.speakText);
  if (speakKey && !DIRECT_PHRASE_MAP.has(speakKey)) {
    DIRECT_PHRASE_MAP.set(speakKey, {
      entry,
      category: speakKey.includes(' ') ? 'phrase' : 'word',
    });
  }
}

// Natural conversational aliases mapped strictly to existing verified LSM catalog signs
const NATURAL_ALIASES = Object.freeze([
  ['ok', 'ok'],
  ['okay', 'ok'],
  ['perfecto', 'ok'],
  ['todo bien', 'bien'],
  ['de acuerdo', 'bien'],
  ['porfavor', 'por_favor'],
  ['alto', 'puno'],
  ['genial', 'cuernos'],
  ['bienvenida', 'bienvenido'],
  ['bienvenidos', 'bienvenido'],
  ['disculpe', 'disculpa'],
  ['perdoname', 'perdon'],
  ['muchas gracias', 'gracias'],
  ['buen dia', 'buenos_dias'],
]);

for (const [aliasText, targetId] of NATURAL_ALIASES) {
  const norm = normalizeSpanishText(aliasText);
  const entry = ENTRY_BY_ID.get(targetId);
  if (norm && entry && !DIRECT_PHRASE_MAP.has(norm)) {
    DIRECT_PHRASE_MAP.set(norm, { entry, category: norm.includes(' ') ? 'phrase' : 'word' });
  }
}

let MAX_PHRASE_WORDS = 1;
for (const key of DIRECT_PHRASE_MAP.keys()) {
  const count = key.split(' ').length;
  if (count > MAX_PHRASE_WORDS) MAX_PHRASE_WORDS = count;
}

/**
 * Returns a sorted list of direct vocabulary phrases/words supported without fingerspelling.
 */
export function getDirectSignVocabulary() {
  return Array.from(DIRECT_PHRASE_MAP.keys()).sort();
}

/**
 * Tokenizes raw text into `{ raw, norm }` word tokens while stripping punctuation
 * and keeping Spanish letters (`a-z`, `ñ`) and digits (`0-9`).
 */
function tokenizeInput(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return [];
  const rawChunks = rawText.trim().split(/\s+/);
  const tokens = [];

  for (const chunk of rawChunks) {
    const cleanedDisplay = chunk.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+|[^A-Za-zÀ-ÖØ-öø-ÿ0-9]+$/g, '');
    const norm = normalizeSpanishText(chunk).replace(/[^a-zñ0-9]/g, '');
    if (norm.length > 0) {
      tokens.push({
        raw: cleanedDisplay || chunk,
        norm,
      });
    }
  }

  return tokens;
}

function buildStep({
  stepIndex,
  entry,
  matchType,
  sourceToken,
  wordPosition = null,
}) {
  return Object.freeze({
    stepIndex,
    signId: entry.id,
    label: entry.label,
    displayName: entry.displayName,
    shortLabel: entry.shortLabel || entry.label,
    matchType,
    sourceToken,
    wordPosition: wordPosition ? Object.freeze({ ...wordPosition }) : null,
    type: entry.type,
    hint: entry.hint,
    instructions: entry.instructions,
    meaning: entry.meaning,
    profile: entry.profile,
    postureSummary: Object.freeze(describeSignPosture(entry)),
  });
}

/**
 * Converts free Spanish text (typed or speech-transcribed) into an ordered sequence
 * of LSM visual steps.
 *
 * Strategy:
 * 1. Longest greedy phrase/word match against the verified LSM catalog (e.g. "por favor",
 *    "buenos días", "mucho gusto", "hola", "gracias", "uno").
 * 2. Automatic letter-by-letter fingerspelling (`A`–`Z` + `Ñ`) and digit-by-digit signing
 *    (`0`–`9`) for any word not present in the direct catalog.
 *
 * @param {string} rawText
 * @returns {{
 *   originalText: string,
 *   normalizedText: string,
 *   steps: ReadonlyArray<Object>,
 *   stats: { totalSteps: number, directMatches: number, spelledLetters: number, spelledWords: number }
 * }}
 */
export function sequenceTextToSigns(rawText) {
  const originalText = typeof rawText === 'string' ? rawText.trim() : '';
  const normalizedText = normalizeSpanishText(originalText);
  const tokens = tokenizeInput(originalText);

  const steps = [];
  let directMatches = 0;
  let spelledLetters = 0;
  let spelledWords = 0;

  let i = 0;
  while (i < tokens.length) {
    let matched = null;
    let matchedSpan = 0;

    // 1. Try longest phrase match first (up to MAX_PHRASE_WORDS tokens)
    const maxLen = Math.min(MAX_PHRASE_WORDS, tokens.length - i);
    for (let len = maxLen; len >= 1; len--) {
      const candidateKey = tokens
        .slice(i, i + len)
        .map((t) => t.norm)
        .join(' ');
      const hit = DIRECT_PHRASE_MAP.get(candidateKey);
      if (hit) {
        matched = hit;
        matchedSpan = len;
        break;
      }
    }

    if (matched) {
      const sourceToken = tokens
        .slice(i, i + matchedSpan)
        .map((t) => t.raw)
        .join(' ');
      steps.push(
        buildStep({
          stepIndex: steps.length,
          entry: matched.entry,
          matchType: matched.category,
          sourceToken,
        })
      );
      directMatches++;
      i += matchedSpan;
      continue;
    }

    // 2. Fallback: fingerspell unknown word letter-by-letter (A–Z + Ñ) and digits (0–9)
    const token = tokens[i];
    const chars = Array.from(token.norm);
    const spellEntries = [];
    for (const ch of chars) {
      const letterEntry = LETTER_BY_CHAR.get(ch) || DIGIT_BY_CHAR.get(ch);
      if (letterEntry) {
        spellEntries.push(letterEntry);
      }
    }

    if (spellEntries.length > 0) {
      spelledWords++;
      for (let cIdx = 0; cIdx < spellEntries.length; cIdx++) {
        steps.push(
          buildStep({
            stepIndex: steps.length,
            entry: spellEntries[cIdx],
            matchType: 'spell',
            sourceToken: token.raw,
            wordPosition: { index: cIdx, total: spellEntries.length },
          })
        );
        spelledLetters++;
      }
    }

    i += 1;
  }

  return {
    originalText,
    normalizedText,
    steps: Object.freeze(steps),
    stats: Object.freeze({
      totalSteps: steps.length,
      directMatches,
      spelledLetters,
      spelledWords,
    }),
  };
}
