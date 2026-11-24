/**
 * Official 4-category LSM educational catalog for `Learn.jsx` (70 signs total):
 *   1. Números:                 0 al 10 (11 señas)
 *   2. Letras:                  Abecedario completo LSM A–Z + Ñ (27 señas; J, K, Q, X, Z, Ñ dinámicas)
 *   3. Frases cortas:           16 señas (3 base + 13 cotidianas en LSM)
 *   4. Agradecimientos/Modales: 16 señas (3 base + 13 cortesías cotidianas en LSM)
 *
 * Built directly from the shared single source of truth in `recognition/modeCatalog.js`
 * so `Learn.jsx` and `Translator.jsx` context modes stay 100% synchronized.
 */

import {
  SIGN_LABELS,
  LEGACY_SIGN_ID_ALIASES,
  NUMBER_SIGN_IDS,
  ALPHABET_SIGN_IDS,
  SHORT_PHRASE_SIGN_IDS,
  COURTESY_SIGN_IDS,
  buildExtendedSignEntry,
} from '../recognition/index.js';

const CATEGORY_DEFINITIONS = [
  {
    id: 'numeros',
    title: 'Números',
    iconKey: 'hash',
    description: 'Aprende a contar del 0 al 10 en Lengua de Señas Mexicana con ambas manos.',
    signIds: NUMBER_SIGN_IDS,
  },
  {
    id: 'letras',
    title: 'Letras',
    iconKey: 'book',
    description:
      'Domina el abecedario completo de la LSM (A a Z + Ñ), incluyendo las letras con movimiento.',
    signIds: ALPHABET_SIGN_IDS,
  },
  {
    id: 'frases_cortas',
    title: 'Frases cortas',
    iconKey: 'message',
    description: 'Palabras y expresiones cotidianas para comunicarte con claridad y confianza.',
    signIds: SHORT_PHRASE_SIGN_IDS,
  },
  {
    id: 'agradecimientos_modales',
    title: 'Agradecimientos/Modales',
    iconKey: 'heart',
    description: 'Saludos, agradecimientos y gestos de cortesía esenciales en la LSM.',
    signIds: COURTESY_SIGN_IDS,
  },
];

function buildLearningSign(signId, categoryId, categoryTitle) {
  const base = buildExtendedSignEntry(signId);
  return Object.freeze({
    ...base,
    categoryId,
    categoryTitle,
  });
}

export const LEARNING_CATEGORIES = Object.freeze(
  CATEGORY_DEFINITIONS.map((cat) =>
    Object.freeze({
      id: cat.id,
      title: cat.title,
      iconKey: cat.iconKey,
      description: cat.description,
      signs: Object.freeze(cat.signIds.map((id) => buildLearningSign(id, cat.id, cat.title))),
    })
  )
);

export const ALL_LEARNING_SIGNS = Object.freeze(
  LEARNING_CATEGORIES.flatMap((category) => category.signs)
);

export const ALL_LEARNING_SIGN_IDS = Object.freeze(ALL_LEARNING_SIGNS.map((sign) => sign.id));

const SIGN_BY_LABEL = new Map();
const SIGN_BY_ID = new Map();

for (const sign of ALL_LEARNING_SIGNS) {
  SIGN_BY_ID.set(sign.id, sign);
  SIGN_BY_LABEL.set(sign.label, sign);
  for (const legacyId of sign.legacyIds) {
    if (!SIGN_BY_ID.has(legacyId)) {
      SIGN_BY_ID.set(legacyId, sign);
    }
  }
  for (const alias of sign.aliases) {
    if (!SIGN_BY_LABEL.has(alias)) {
      SIGN_BY_LABEL.set(alias, sign);
    }
  }
}

export function getLearningSignByLabel(label) {
  return SIGN_BY_LABEL.get(label) || null;
}

export function getLearningSignById(id) {
  return SIGN_BY_ID.get(id) || null;
}

export function getSignProfile(label) {
  return SIGN_BY_LABEL.get(label)?.profile || null;
}

export { SIGN_LABELS, LEGACY_SIGN_ID_ALIASES };
