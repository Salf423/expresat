import { describe, it, expect } from 'vitest';
import { SIGN_CATALOG, SIGN_LABELS } from '../../recognition/index.js';
import {
  LEARNING_CATEGORIES,
  ALL_LEARNING_SIGNS,
  ALL_LEARNING_SIGN_IDS,
  LEGACY_SIGN_ID_ALIASES,
  getLearningSignByLabel,
  getLearningSignById,
  getSignProfile,
} from '../catalog.js';

const EXPECTED_SPANISH_ALPHABET = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'Ñ',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
];

const TECHNICAL_JARGON_REGEX =
  /\b(wasm|mediapipe|landmark|landmarks|onnx|tensor|fps|pipangle|signedfrontz|websocket|mcp|pip|dip)\b/i;

describe('learning/catalog — Catálogo completo LSM (Números 0-10, Abecedario A-Z+Ñ, Frases y Modales)', () => {
  it('define exactamente las 4 categorías oficiales en orden con los mínimos requeridos', () => {
    const titles = LEARNING_CATEGORIES.map((c) => c.title);
    expect(titles).toEqual([
      'Números',
      'Letras',
      'Frases cortas',
      'Agradecimientos/Modales',
    ]);

    const byId = new Map(LEARNING_CATEGORIES.map((c) => [c.id, c]));
    expect(byId.get('numeros').signs).toHaveLength(11);
    expect(byId.get('letras').signs).toHaveLength(27);
    expect(byId.get('frases_cortas').signs.length).toBeGreaterThanOrEqual(13);
    expect(byId.get('agradecimientos_modales').signs.length).toBeGreaterThanOrEqual(13);
    expect(ALL_LEARNING_SIGNS.length).toBeGreaterThanOrEqual(64);
  });

  it('mantiene completos los números del 0 al 10 en la categoría Números', () => {
    const numbersCat = LEARNING_CATEGORIES.find((c) => c.id === 'numeros');
    const numberLabels = numbersCat.signs.map((s) => s.label);
    expect(numberLabels).toEqual([
      SIGN_LABELS.CERO,
      SIGN_LABELS.UNO,
      SIGN_LABELS.DOS,
      SIGN_LABELS.TRES,
      SIGN_LABELS.CUATRO,
      SIGN_LABELS.CINCO,
      SIGN_LABELS.SEIS,
      SIGN_LABELS.SIETE,
      SIGN_LABELS.OCHO,
      SIGN_LABELS.NUEVE,
      SIGN_LABELS.DIEZ,
    ]);
    const diez = numbersCat.signs.find((s) => s.id === 'diez');
    expect(diez.type).toBe('dynamic');
    expect(diez.profile.dynamicMotion).toBe('rotation');
  });

  it('incluye el abecedario completo LSM (27 letras: A-Z + Ñ) distinguiendo letras dinámicas en t_ms', () => {
    const lettersCat = LEARNING_CATEGORIES.find((c) => c.id === 'letras');
    expect(lettersCat.signs).toHaveLength(27);
    expect(lettersCat.signs.map((s) => s.shortLabel)).toEqual(EXPECTED_SPANISH_ALPHABET);

    const dynamicLetters = lettersCat.signs
      .filter((s) => s.type === 'dynamic')
      .map((s) => s.shortLabel);

    for (const requiredDynamic of ['J', 'K', 'Q', 'X', 'Z', 'Ñ']) {
      expect(dynamicLetters).toContain(requiredDynamic);
      const entry = lettersCat.signs.find((s) => s.shortLabel === requiredDynamic);
      expect(entry.profile.dynamicMotion).toBeTruthy();
      expect(entry.profile.motionWindowMs).toBeGreaterThanOrEqual(600);
      expect(entry.profile.motionHint?.length).toBeGreaterThan(8);
    }

    // Static letters must explicitly declare type='static' and dynamicMotion=null
    const staticLetters = lettersCat.signs.filter((s) => s.type === 'static');
    expect(staticLetters.length).toBeGreaterThanOrEqual(21);
    for (const s of staticLetters) {
      expect(s.profile.dynamicMotion).toBeNull();
    }
  });

  it('conserva las señas previas de Frases cortas y Agradecimientos/Modales y suma >= 10 nuevas en cada una', () => {
    const phrasesCat = LEARNING_CATEGORIES.find((c) => c.id === 'frases_cortas');
    const phraseIds = phrasesCat.signs.map((s) => s.id);
    expect(phraseIds).toContain('te_quiero');
    expect(phraseIds).toContain('puno');
    expect(phraseIds).toContain('cuernos');
    expect(phraseIds.length).toBeGreaterThanOrEqual(13);

    const courtesyCat = LEARNING_CATEGORIES.find((c) => c.id === 'agradecimientos_modales');
    const courtesyIds = courtesyCat.signs.map((s) => s.id);
    expect(courtesyIds).toContain('hola');
    expect(courtesyIds).toContain('bien');
    expect(courtesyIds).toContain('ok');
    expect(courtesyIds.length).toBeGreaterThanOrEqual(13);
  });

  it('garantiza IDs y etiquetas únicos, sin jerga técnica, y compatibilidad total con SIGN_CATALOG y alias heredados', () => {
    expect(new Set(ALL_LEARNING_SIGN_IDS).size).toBe(ALL_LEARNING_SIGNS.length);
    expect(new Set(ALL_LEARNING_SIGNS.map((s) => s.label)).size).toBe(ALL_LEARNING_SIGNS.length);

    // Every legacy SIGN_CATALOG entry resolves cleanly by ID and by Label (incl. lunes -> letra_l)
    for (const entry of SIGN_CATALOG) {
      const resolvedById = getLearningSignById(entry.id);
      const resolvedByLabel = getLearningSignByLabel(entry.label);
      expect(resolvedById, `SIGN_CATALOG id "${entry.id}" debe resolverse`).toBeTruthy();
      expect(resolvedByLabel, `SIGN_CATALOG label "${entry.label}" debe resolverse`).toBeTruthy();
      expect(getSignProfile(entry.label)).toBeTruthy();
    }
    expect(LEGACY_SIGN_ID_ALIASES.lunes).toBe('letra_l');

    for (const sign of ALL_LEARNING_SIGNS) {
      expect(sign.id).toMatch(/^[a-z0-9_-]{1,40}$/);
      expect(['static', 'dynamic']).toContain(sign.type);
      expect(sign.displayName.length).toBeGreaterThan(1);
      expect(sign.hint.length).toBeGreaterThan(5);
      expect(sign.meaning.length).toBeGreaterThan(8);
      expect(sign.instructions.length).toBeGreaterThan(15);
      expect(sign.instructions).not.toMatch(TECHNICAL_JARGON_REGEX);
      expect(sign.meaning).not.toMatch(TECHNICAL_JARGON_REGEX);
      expect(sign.hint).not.toMatch(TECHNICAL_JARGON_REGEX);

      expect(sign.profile).toBeTruthy();
      expect(sign.profile.fingers).toBeTruthy();
      for (const k of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        expect(sign.profile.fingers[k]).not.toBeUndefined();
      }
      if (sign.type === 'dynamic') {
        expect(sign.profile.dynamicMotion).toBeTruthy();
        expect(sign.profile.motionWindowMs).toBeGreaterThanOrEqual(600);
      } else {
        expect(sign.profile.dynamicMotion).toBeNull();
      }

      expect(getLearningSignById(sign.id)?.id).toBe(sign.id);
      expect(getLearningSignByLabel(sign.label)?.id).toBe(sign.id);
      expect(getSignProfile(sign.label)).toBe(sign.profile);
    }
  });
});
