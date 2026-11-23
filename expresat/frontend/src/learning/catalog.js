/**
 * Official 4-category LSM learning catalog derived 1:1 from `SIGN_CATALOG`.
 *
 * Guarantees that 100% of signs shown in `Learn.jsx` can be evaluated live by
 * `GeometricClassifier` in offline browser mode (zero dead signs, zero duplicates).
 */

import { SIGN_CATALOG, SIGN_LABELS } from '../recognition/index.js';

const CATALOG_BY_ID = new Map(SIGN_CATALOG.map((entry) => [entry.id, entry]));

/**
 * Expected anatomical profiles per canonical sign label.
 * Consumed by `anatomicalFeedback.js` to compare live `fingerStates` against the target sign.
 */
const SIGN_METADATA = Object.freeze({
  cero: {
    displayName: 'Número 0 (Cero)',
    meaning: 'Representa el cero o la ausencia de cantidad en LSM.',
    instructions:
      'Curva todos tus dedos hacia el frente formando un óvalo abierto (como una letra O) y junta las puntas con el pulgar.',
    profile: {
      fingers: { thumb: 'oval', index: 'oval', middle: 'oval', ring: false, pinky: false },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: true,
      dynamicMotion: null,
    },
  },
  uno: {
    displayName: 'Número 1 (Uno)',
    meaning: 'El primer dígito para contar o señalar una unidad.',
    instructions:
      'Cierra la mano en puño y extiende únicamente el dedo índice apuntando hacia arriba.',
    profile: {
      fingers: { thumb: false, index: true, middle: false, ring: false, pinky: false },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  dos: {
    displayName: 'Número 2 (Dos)',
    meaning: 'Representa el número dos o un par de elementos.',
    instructions:
      'Con la mano cerrada, extiende únicamente los dedos índice y medio hacia arriba formando una V.',
    profile: {
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  tres: {
    displayName: 'Número 3 (Tres)',
    meaning: 'Representa el número tres en Lengua de Señas Mexicana.',
    instructions:
      'Extiende hacia arriba los dedos índice, medio y anular; mantén doblados el pulgar y el meñique.',
    profile: {
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: false },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  cuatro: {
    displayName: 'Número 4 (Cuatro)',
    meaning: 'Representa el número cuatro con la palma orientada hacia el frente.',
    instructions:
      'Muestra tu palma hacia la cámara, extiende los cuatro dedos largos hacia arriba y dobla el pulgar sobre la palma.',
    profile: {
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  cinco: {
    displayName: 'Número 5 (Cinco)',
    meaning: 'Representa el número cinco con la mano completamente abierta.',
    instructions:
      'Abre toda la mano extendiendo los cinco dedos con claridad y mantenla firme frente a la cámara.',
    profile: {
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  seis: {
    displayName: 'Número 6 (Seis)',
    meaning: 'Representa el número seis en LSM mostrando el dorso de la mano.',
    instructions:
      'Gira tu mano mostrando el dorso hacia la cámara, cierra los cuatro dedos largos y extiende el pulgar hacia arriba.',
    profile: {
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false },
      orientation: 'BACK',
      thumbUp: true,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  siete: {
    displayName: 'Número 7 (Siete)',
    meaning: 'Representa el número siete en LSM formando una L con el dorso al frente.',
    instructions:
      'Gira tu mano mostrando el dorso hacia la cámara, extiende el pulgar y el índice formando una L y cierra los otros tres dedos.',
    profile: {
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
      orientation: 'BACK',
      thumbUp: false,
      thumbIndexAngleRange: [28, 140],
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  ocho: {
    displayName: 'Número 8 (Ocho)',
    meaning: 'Representa el número ocho en Lengua de Señas Mexicana.',
    instructions:
      'Extiende el pulgar, el índice y el dedo medio; mantén cerrados el anular y el meñique.',
    profile: {
      fingers: { thumb: true, index: true, middle: true, ring: false, pinky: false },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  nueve: {
    displayName: 'Número 9 (Nueve)',
    meaning: 'Representa el número nueve en LSM con los cuatro dedos largos y el dorso al frente.',
    instructions:
      'Gira tu mano mostrando el dorso hacia la cámara, extiende los dedos índice, medio, anular y meñique, y mantén el pulgar guardado.',
    profile: {
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'BACK',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  diez: {
    displayName: 'Número 10 (Diez)',
    meaning: 'Representa el número diez mediante un giro natural de muñeca.',
    instructions:
      'Abre los cinco dedos (como en Cinco) y gira tu muñeca suavemente alternando la palma y el dorso frente a la cámara.',
    profile: {
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: 'rotation',
    },
  },
  letra_i: {
    displayName: 'Letra I',
    meaning: 'Vocal I del alfabeto dactilológico en LSM.',
    instructions:
      'Cierra la mano en puño y extiende únicamente el dedo meñique apuntando hacia arriba.',
    profile: {
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  letra_y: {
    displayName: 'Letra Y',
    meaning: 'Consonante Y del alfabeto dactilológico en LSM.',
    instructions:
      'Extiende el pulgar y el meñique al mismo tiempo mientras mantienes doblados los dedos índice, medio y anular.',
    profile: {
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  lunes: {
    displayName: 'Letra L · Lunes',
    meaning: 'Forma de la letra L en el alfabeto LSM, usada también para el día Lunes.',
    instructions:
      'Con la palma hacia la cámara, extiende el pulgar y el índice formando un ángulo recto en forma de L; cierra los dedos medio, anular y meñique.',
    profile: {
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      thumbUp: false,
      thumbIndexAngleRange: [35, 140],
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  te_quiero: {
    displayName: 'Te Quiero',
    meaning: 'Expresión universal de cariño y afecto en lengua de señas.',
    instructions:
      'Extiende el pulgar, el índice y el meñique al mismo tiempo; mantén cerrados los dedos medio y anular.',
    profile: {
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  puno: {
    displayName: 'Puño · ¡Alto!',
    meaning: 'Postura base cerrada para enfatizar pausa, firmeza o detención.',
    instructions:
      'Flexiona los cuatro dedos largos contra la palma y recoge el pulgar sobre ellos formando un puño firme.',
    profile: {
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  cuernos: {
    displayName: '¡Genial! · Cuernos',
    meaning: 'Expresión gestual alegre para celebrar o animar en una conversación.',
    instructions:
      'Extiende únicamente los dedos índice y meñique hacia arriba; mantén doblados el pulgar, el medio y el anular.',
    profile: {
      fingers: { thumb: false, index: true, middle: false, ring: false, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  hola: {
    displayName: 'Hola',
    meaning: 'Saludo cordial y cercano para iniciar una conversación con respeto.',
    instructions:
      'Abre los cinco dedos con la palma visible y mueve tu mano suavemente de lado a lado saludando frente a la cámara.',
    profile: {
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: 'wave',
    },
  },
  bien: {
    displayName: 'Todo Bien · Gracias',
    meaning: 'Expresión amable de cortesía, aprobación y bienestar ("todo bien", "de acuerdo").',
    instructions:
      'Con la palma hacia el frente o de perfil, cierra los cuatro dedos largos y levanta el pulgar apuntando hacia arriba.',
    profile: {
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      thumbUp: true,
      thumbIndexAngleRange: null,
      pinch: false,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
  ok: {
    displayName: 'OK · Perfecto',
    meaning: 'Expresión cortés de entendimiento y confirmación ("perfecto", "entendido").',
    instructions:
      'Une las puntas del pulgar y el índice formando un círculo pequeño, y extiende hacia arriba los dedos medio, anular y meñique.',
    profile: {
      fingers: { thumb: 'pinch', index: 'pinch', middle: true, ring: true, pinky: true },
      orientation: 'ANY',
      thumbUp: false,
      thumbIndexAngleRange: null,
      pinch: true,
      zeroOval: false,
      dynamicMotion: null,
    },
  },
});

const CATEGORY_DEFINITIONS = [
  {
    id: 'numeros',
    title: 'Números',
    iconKey: 'hash',
    description: 'Aprende a contar del 0 al 10 en Lengua de Señas Mexicana con ambas manos.',
    signIds: [
      'cero',
      'uno',
      'dos',
      'tres',
      'cuatro',
      'cinco',
      'seis',
      'siete',
      'ocho',
      'nueve',
      'diez',
    ],
  },
  {
    id: 'letras',
    title: 'Letras',
    iconKey: 'book',
    description: 'Practica configuraciones manuales clave del alfabeto dactilológico en LSM.',
    signIds: ['letra_i', 'letra_y', 'lunes'],
  },
  {
    id: 'frases_cortas',
    title: 'Frases cortas',
    iconKey: 'message',
    description: 'Expresiones directas para comunicarte con afecto, claridad y energía.',
    signIds: ['te_quiero', 'puno', 'cuernos'],
  },
  {
    id: 'agradecimientos_modales',
    title: 'Agradecimientos/Modales',
    iconKey: 'heart',
    description: 'Saludos y gestos de cortesía cotidianos para conversar con amabilidad.',
    signIds: ['hola', 'bien', 'ok'],
  },
];

function buildLearningSign(signId, categoryId, categoryTitle) {
  const catalogEntry = CATALOG_BY_ID.get(signId);
  if (!catalogEntry) {
    throw new Error(`La seña "${signId}" no existe en SIGN_CATALOG.`);
  }
  const meta = SIGN_METADATA[signId];
  if (!meta) {
    throw new Error(`Falta metadata educativa para la seña "${signId}".`);
  }
  return Object.freeze({
    id: catalogEntry.id,
    label: catalogEntry.label,
    displayName: meta.displayName,
    type: catalogEntry.type,
    hint: catalogEntry.hint,
    speakText: catalogEntry.speakText,
    categoryId,
    categoryTitle,
    meaning: meta.meaning,
    instructions: meta.instructions,
    profile: Object.freeze({
      ...meta.profile,
      fingers: Object.freeze({ ...meta.profile.fingers }),
    }),
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

const SIGN_BY_LABEL = new Map(ALL_LEARNING_SIGNS.map((sign) => [sign.label, sign]));
const SIGN_BY_ID = new Map(ALL_LEARNING_SIGNS.map((sign) => [sign.id, sign]));

export function getLearningSignByLabel(label) {
  return SIGN_BY_LABEL.get(label) || null;
}

export function getLearningSignById(id) {
  return SIGN_BY_ID.get(id) || null;
}

export function getSignProfile(label) {
  return SIGN_BY_LABEL.get(label)?.profile || null;
}

export { SIGN_LABELS };
