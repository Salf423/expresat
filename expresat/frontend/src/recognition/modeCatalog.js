/**
 * Unified single source of truth for the full 70-sign LSM catalog and the 4 Translator
 * context modes (`general`, `alphabet`, `numbers`, `phrases`), shared cleanly between
 * `Translator.jsx`, `GeometricClassifier`, and `Learn.jsx`.
 */

import { SIGN_CATALOG, SIGN_LABELS } from './signCatalog.js';

const BASE_CATALOG_BY_ID = new Map(SIGN_CATALOG.map((entry) => [entry.id, entry]));

export const CONTEXT_MODES = Object.freeze({
  GENERAL: 'general',
  ALPHABET: 'alphabet',
  NUMBERS: 'numbers',
  PHRASES: 'phrases',
});

export const VALID_CONTEXT_MODES = Object.freeze(Object.values(CONTEXT_MODES));

export function normalizeContextMode(rawMode) {
  if (typeof rawMode === 'string') {
    const clean = rawMode.trim().toLowerCase();
    if (VALID_CONTEXT_MODES.includes(clean)) return clean;
  }
  return CONTEXT_MODES.GENERAL;
}

/**
 * Legacy ID aliases preserved so users who completed signs under earlier catalog versions
 * never lose their saved browser cookie progress.
 */
export const LEGACY_SIGN_ID_ALIASES = Object.freeze({
  lunes: 'letra_l',
});

function createProfile({
  fingers,
  orientation = 'ANY',
  handDirection = 'ANY',
  thumbUp = false,
  thumbIndexAngleRange = null,
  pinch = false,
  zeroOval = false,
  cArc = false,
  clawShape = false,
  hookIndex = false,
  dCircle = false,
  fPinch = false,
  kpShape = false,
  fingerSpread = null,
  dynamicMotion = null,
  motionWindowMs = null,
  motionHint = null,
  motionBadge = null,
}) {
  return Object.freeze({
    fingers: Object.freeze({
      thumb: fingers.thumb,
      index: fingers.index,
      middle: fingers.middle,
      ring: fingers.ring,
      pinky: fingers.pinky,
    }),
    orientation,
    handDirection,
    thumbUp,
    thumbIndexAngleRange: thumbIndexAngleRange ? Object.freeze([...thumbIndexAngleRange]) : null,
    pinch,
    zeroOval,
    cArc,
    clawShape,
    hookIndex,
    dCircle,
    fPinch,
    kpShape,
    fingerSpread,
    dynamicMotion,
    motionWindowMs: dynamicMotion ? (motionWindowMs ?? 900) : null,
    motionHint,
    motionBadge,
  });
}

/**
 * Complete 70-sign LSM definitions indexed by canonical `id`.
 * Every sign carries authentic LSM handshape, orientation, direction, and `t_ms` motion metadata.
 */
export const EXTENDED_SIGN_DEFINITIONS = Object.freeze({
  // =========================================================================
  // 1. NÚMEROS (0 al 10 — 11 señas)
  // =========================================================================
  cero: {
    displayName: 'Número 0 (Cero)',
    shortLabel: '0',
    meaning: 'Representa el cero o la ausencia de cantidad en LSM.',
    instructions:
      'Curva todos tus dedos hacia el frente formando un óvalo abierto (como una letra O) y junta las puntas con el pulgar.',
    profile: createProfile({
      fingers: { thumb: 'oval', index: 'oval', middle: 'oval', ring: false, pinky: false },
      zeroOval: true,
    }),
  },
  uno: {
    displayName: 'Número 1 (Uno)',
    shortLabel: '1',
    meaning: 'El primer dígito para contar o señalar una unidad.',
    instructions:
      'Cierra la mano en puño y extiende únicamente el dedo índice apuntando hacia arriba.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: false, ring: false, pinky: false },
    }),
  },
  dos: {
    displayName: 'Número 2 (Dos)',
    shortLabel: '2',
    meaning: 'Representa el número dos o un par de elementos.',
    instructions:
      'Con la mano cerrada, extiende únicamente los dedos índice y medio hacia arriba formando una V.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
    }),
  },
  tres: {
    displayName: 'Número 3 (Tres)',
    shortLabel: '3',
    meaning: 'Representa el número tres en Lengua de Señas Mexicana.',
    instructions:
      'Extiende hacia arriba los dedos índice, medio y anular; mantén doblados el pulgar y el meñique.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: false },
    }),
  },
  cuatro: {
    displayName: 'Número 4 (Cuatro)',
    shortLabel: '4',
    meaning: 'Representa el número cuatro con la palma orientada hacia el frente.',
    instructions:
      'Muestra tu palma hacia la cámara, extiende los cuatro dedos largos hacia arriba y dobla el pulgar sobre la palma.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
    }),
  },
  cinco: {
    displayName: 'Número 5 (Cinco)',
    shortLabel: '5',
    meaning: 'Representa el número cinco con la mano completamente abierta.',
    instructions:
      'Abre toda la mano extendiendo los cinco dedos con claridad y mantenla firme frente a la cámara.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    }),
  },
  seis: {
    displayName: 'Número 6 (Seis)',
    shortLabel: '6',
    meaning: 'Representa el número seis en LSM mostrando el dorso de la mano.',
    instructions:
      'Gira tu mano mostrando el dorso hacia la cámara, cierra los cuatro dedos largos y extiende el pulgar hacia arriba.',
    profile: createProfile({
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false },
      orientation: 'BACK',
      thumbUp: true,
    }),
  },
  siete: {
    displayName: 'Número 7 (Siete)',
    shortLabel: '7',
    meaning: 'Representa el número siete en LSM formando una L con el dorso al frente.',
    instructions:
      'Gira tu mano mostrando el dorso hacia la cámara, extiende el pulgar y el índice formando una L y cierra los otros tres dedos.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
      orientation: 'BACK',
      thumbIndexAngleRange: [28, 140],
    }),
  },
  ocho: {
    displayName: 'Número 8 (Ocho)',
    shortLabel: '8',
    meaning: 'Representa el número ocho en Lengua de Señas Mexicana.',
    instructions:
      'Extiende el pulgar, el índice y el dedo medio; mantén cerrados el anular y el meñique.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: false, pinky: false },
    }),
  },
  nueve: {
    displayName: 'Número 9 (Nueve)',
    shortLabel: '9',
    meaning: 'Representa el número nueve en LSM con los cuatro dedos largos y el dorso al frente.',
    instructions:
      'Gira tu mano mostrando el dorso hacia la cámara, extiende los dedos índice, medio, anular y meñique, y mantén el pulgar guardado.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'BACK',
    }),
  },
  diez: {
    displayName: 'Número 10 (Diez)',
    shortLabel: '10',
    meaning: 'Representa el número diez mediante un giro natural de muñeca.',
    instructions:
      'Abre los cinco dedos (como en Cinco) y gira tu muñeca suavemente alternando la palma y el dorso frente a la cámara.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      dynamicMotion: 'rotation',
      motionWindowMs: 900,
      motionHint: 'gira la muñeca alternando palma y dorso frente a la cámara',
      motionBadge: 'Giro de muñeca palma ↔ dorso',
    }),
  },

  // =========================================================================
  // 2. LETRAS — Abecedario completo de LSM (A–Z + Ñ — 27 señas)
  // =========================================================================
  letra_a: {
    label: 'Letra A',
    displayName: 'Letra A',
    shortLabel: 'A',
    type: 'static',
    hint: 'Puño cerrado con pulgar recto al costado',
    speakText: 'Letra A',
    meaning: 'Primera letra y vocal A del alfabeto dactilológico de la LSM.',
    instructions:
      'Muestra tu palma al frente, cierra los cuatro dedos largos en puño y coloca el pulgar estirado y pegado al costado del dedo índice apuntando hacia arriba.',
    profile: createProfile({
      fingers: { thumb: 'adducted', index: false, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      thumbUp: true,
    }),
  },
  letra_b: {
    label: 'Letra B',
    displayName: 'Letra B',
    shortLabel: 'B',
    type: 'static',
    hint: '4 dedos juntos arriba y pulgar sobre la palma',
    speakText: 'Letra B',
    meaning: 'Consonante B del alfabeto dactilológico de la LSM.',
    instructions:
      'Con la palma hacia la cámara, extiende hacia arriba los cuatro dedos largos bien juntos (sin separarlos) y dobla el pulgar cruzando sobre la palma.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
      handDirection: 'UP',
      fingerSpread: 'together',
    }),
  },
  letra_c: {
    label: 'Letra C',
    displayName: 'Letra C',
    shortLabel: 'C',
    type: 'static',
    hint: 'Dedos curvados formando un arco abierto en C',
    speakText: 'Letra C',
    meaning: 'Consonante C del alfabeto dactilológico de la LSM.',
    instructions:
      'Junta los cuatro dedos largos y cúrvalos formando un arco abierto frente al pulgar también curvado, dejando espacio entre las puntas como la silueta de una C.',
    profile: createProfile({
      fingers: { thumb: 'arch', index: 'arch', middle: 'arch', ring: 'arch', pinky: 'arch' },
      cArc: true,
    }),
  },
  letra_d: {
    label: 'Letra D',
    displayName: 'Letra D',
    shortLabel: 'D',
    type: 'static',
    hint: 'Índice arriba y demás dedos cerrados tocando el pulgar',
    speakText: 'Letra D',
    meaning: 'Consonante D del alfabeto dactilológico de la LSM.',
    instructions:
      'Con la palma al frente, extiende el dedo índice recto hacia arriba y junta las puntas del medio, anular y meñique contra el pulgar formando un círculo.',
    profile: createProfile({
      fingers: { thumb: 'pinch', index: true, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      dCircle: true,
    }),
  },
  letra_e: {
    label: 'Letra E',
    displayName: 'Letra E',
    shortLabel: 'E',
    type: 'static',
    hint: '4 dedos doblados en garra sobre el pulgar',
    speakText: 'Letra E',
    meaning: 'Vocal E del alfabeto dactilológico de la LSM.',
    instructions:
      'Con la palma al frente, dobla los cuatro dedos largos en forma de garra hacia la parte superior de la palma y apoya el pulgar doblado debajo de sus puntas.',
    profile: createProfile({
      fingers: { thumb: false, index: 'claw', middle: 'claw', ring: 'claw', pinky: 'claw' },
      orientation: 'FRONT',
      handDirection: 'UP',
      clawShape: true,
    }),
  },
  letra_f: {
    label: 'Letra F',
    displayName: 'Letra F',
    shortLabel: 'F',
    type: 'static',
    hint: 'Índice doblado con el pulgar y 3 dedos extendidos arriba',
    speakText: 'Letra F',
    meaning: 'Consonante F del alfabeto dactilológico de la LSM.',
    instructions:
      'Extiende hacia arriba los dedos medio, anular y meñique con la palma al frente; dobla el índice hacia la palma y apoya el pulgar sobre el costado o punta del índice.',
    profile: createProfile({
      fingers: { thumb: 'pinch', index: 'pinch', middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
      handDirection: 'UP',
      pinch: true,
      fPinch: true,
    }),
  },
  letra_g: {
    label: 'Letra G',
    displayName: 'Letra G',
    shortLabel: 'G',
    type: 'static',
    hint: 'Índice y pulgar horizontales apuntando de lado',
    speakText: 'Letra G',
    meaning: 'Consonante G del alfabeto dactilológico de la LSM.',
    instructions:
      'Cierra los dedos medio, anular y meñique; apunta el índice horizontalmente hacia un lado con el pulgar extendido paralelo encima de él.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
      handDirection: 'HORIZONTAL',
    }),
  },
  letra_h: {
    label: 'Letra H',
    displayName: 'Letra H',
    shortLabel: 'H',
    type: 'static',
    hint: 'Índice y medio juntos apuntando horizontalmente',
    speakText: 'Letra H',
    meaning: 'Consonante H del alfabeto dactilológico de la LSM.',
    instructions:
      'Extiende juntos los dedos índice y medio apuntando horizontalmente hacia un lado (con el pulgar paralelo y anular y meñique cerrados).',
    profile: createProfile({
      fingers: { thumb: 'any', index: true, middle: true, ring: false, pinky: false },
      handDirection: 'HORIZONTAL',
      fingerSpread: 'together',
    }),
  },
  letra_i: {
    displayName: 'Letra I',
    shortLabel: 'I',
    meaning: 'Vocal I del alfabeto dactilológico en LSM.',
    instructions:
      'Cierra la mano en puño y extiende únicamente el dedo meñique apuntando hacia arriba.',
    profile: createProfile({
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: true },
      handDirection: 'UP',
    }),
  },
  letra_j: {
    label: 'Letra J',
    displayName: 'Letra J',
    shortLabel: 'J',
    type: 'dynamic',
    hint: 'Meñique extendido trazando una curva en J',
    speakText: 'Letra J',
    meaning: 'Consonante J del alfabeto LSM; es dinámica y traza su curva con el meñique.',
    instructions:
      'Parte de la postura de la letra I (solo meñique extendido) y dibuja en el aire una curva suave hacia abajo y hacia el costado formando una J.',
    profile: createProfile({
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: true },
      dynamicMotion: 'j_curve',
      motionWindowMs: 1100,
      motionHint: 'dibuja una curva en forma de J hacia abajo y al costado con el meñique',
      motionBadge: 'Trazo curvo en J',
    }),
  },
  letra_k: {
    label: 'Letra K',
    displayName: 'Letra K',
    shortLabel: 'K',
    type: 'dynamic',
    hint: 'Índice y medio arriba con pulgar al centro, subiendo suave',
    speakText: 'Letra K',
    meaning: 'Consonante K en LSM; comparte postura con la P pero realiza un movimiento hacia arriba.',
    instructions:
      'Extiende el índice hacia arriba, el dedo medio inclinado al frente y apoya el pulgar entre ambos (anular y meñique cerrados); realiza un pequeño movimiento suave hacia arriba.',
    profile: createProfile({
      fingers: { thumb: 'between', index: true, middle: true, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      kpShape: true,
      dynamicMotion: 'upward',
      motionWindowMs: 850,
      motionHint: 'haz un pequeño movimiento suave hacia arriba con tu mano',
      motionBadge: 'Movimiento suave hacia arriba',
    }),
  },
  letra_l: {
    label: 'Letra L',
    aliases: [SIGN_LABELS.LUNES],
    legacyIds: ['lunes'],
    displayName: 'Letra L',
    shortLabel: 'L',
    type: 'static',
    hint: 'Pulgar e índice en ángulo recto (forma de L)',
    speakText: 'Letra L',
    meaning: 'Consonante L del alfabeto LSM, usada también como base de la seña para Lunes.',
    instructions:
      'Con la palma hacia la cámara, extiende el pulgar y el índice formando un ángulo recto en forma de L; cierra los dedos medio, anular y meñique.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      thumbIndexAngleRange: [35, 140],
    }),
  },
  letra_m: {
    label: 'Letra M',
    displayName: 'Letra M',
    shortLabel: 'M',
    type: 'static',
    hint: '3 dedos juntos apuntando hacia abajo',
    speakText: 'Letra M',
    meaning: 'Consonante M del alfabeto dactilológico de la LSM.',
    instructions:
      'Apunta hacia abajo los dedos índice, medio y anular juntos, mientras el pulgar sujeta el dedo meñique doblado contra la palma.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: false },
      handDirection: 'DOWN',
      fingerSpread: 'together',
    }),
  },
  letra_n: {
    label: 'Letra N',
    displayName: 'Letra N',
    shortLabel: 'N',
    type: 'static',
    hint: 'Índice y medio juntos apuntando hacia abajo',
    speakText: 'Letra N',
    meaning: 'Consonante N del alfabeto dactilológico de la LSM.',
    instructions:
      'Apunta hacia abajo los dedos índice y medio juntos, mientras el pulgar sujeta los dedos anular y meñique doblados contra la palma.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
      handDirection: 'DOWN',
      fingerSpread: 'together',
    }),
  },
  letra_enie: {
    label: 'Letra Ñ',
    displayName: 'Letra Ñ',
    shortLabel: 'Ñ',
    type: 'dynamic',
    hint: 'Como la N hacia abajo con pequeño movimiento lateral',
    speakText: 'Letra eñe',
    meaning: 'Consonante Ñ del español en LSM; usa la postura de N con un movimiento lateral suave.',
    instructions:
      'Coloca la mano igual que en la letra N (índice y medio juntos apuntando hacia abajo) y haz un pequeño movimiento lateral suave de lado a lado con la muñeca.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
      handDirection: 'DOWN',
      fingerSpread: 'together',
      dynamicMotion: 'lateral_shake',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento lateral suave de lado a lado',
      motionBadge: 'Movimiento lateral suave',
    }),
  },
  letra_o: {
    label: 'Letra O',
    displayName: 'Letra O',
    shortLabel: 'O',
    type: 'static',
    hint: 'Todos los dedos curvados cerrando un óvalo con el pulgar',
    speakText: 'Letra O',
    meaning: 'Vocal O del alfabeto dactilológico de la LSM.',
    instructions:
      'Curva todos tus dedos y une sus puntas con la punta del pulgar formando un óvalo redondo y cerrado semejante a la letra O.',
    profile: createProfile({
      fingers: { thumb: 'oval', index: 'oval', middle: 'oval', ring: false, pinky: false },
      zeroOval: true,
    }),
  },
  letra_p: {
    label: 'Letra P',
    displayName: 'Letra P',
    shortLabel: 'P',
    type: 'static',
    hint: 'Índice y medio arriba con pulgar al centro (quieta)',
    speakText: 'Letra P',
    meaning: 'Consonante P en LSM; a diferencia de la K, se mantiene completamente quieta.',
    instructions:
      'Con la palma al frente, extiende el índice hacia arriba, inclina el medio hacia adelante y apoya el pulgar entre ambos (anular y meñique cerrados). Mantén la mano quieta.',
    profile: createProfile({
      fingers: { thumb: 'between', index: true, middle: true, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      kpShape: true,
    }),
  },
  letra_q: {
    label: 'Letra Q',
    displayName: 'Letra Q',
    shortLabel: 'Q',
    type: 'dynamic',
    hint: 'Índice y pulgar en gancho con giro suave de muñeca',
    speakText: 'Letra Q',
    meaning: 'Consonante Q en LSM; se forma en pinza/gancho acompañada de un movimiento de muñeca.',
    instructions:
      'Cierra medio, anular y meñique; curva el índice y el pulgar como un gancho o pinza abierta y realiza un pequeño giro suave de muñeca de lado a lado.',
    profile: createProfile({
      fingers: { thumb: 'hook', index: 'hook', middle: false, ring: false, pinky: false },
      hookIndex: true,
      dynamicMotion: 'wrist_twist',
      motionWindowMs: 900,
      motionHint: 'gira o mece suavemente tu muñeca de lado a lado',
      motionBadge: 'Giro suave de muñeca',
    }),
  },
  letra_r: {
    label: 'Letra R',
    displayName: 'Letra R',
    shortLabel: 'R',
    type: 'static',
    hint: 'Índice y medio extendidos y cruzados entre sí',
    speakText: 'Letra R',
    meaning: 'Consonante R del alfabeto dactilológico de la LSM.',
    instructions:
      'Con la palma al frente, extiende los dedos índice y medio y crúzalos suavemente (el medio sobre el índice), manteniendo pulgar, anular y meñique cerrados.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      fingerSpread: 'crossed',
    }),
  },
  letra_s: {
    label: 'Letra S',
    displayName: 'Letra S',
    shortLabel: 'S',
    type: 'static',
    hint: 'Puño cerrado con el pulgar cruzado al frente',
    speakText: 'Letra S',
    meaning: 'Consonante S del alfabeto dactilológico de la LSM.',
    instructions:
      'Muestra la palma al frente, cierra los cuatro dedos largos en un puño firme y cruza el pulgar por delante de ellos.',
    profile: createProfile({
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
    }),
  },
  letra_t: {
    label: 'Letra T',
    displayName: 'Letra T',
    shortLabel: 'T',
    type: 'static',
    hint: 'Puño con el pulgar asomando entre índice y medio',
    speakText: 'Letra T',
    meaning: 'Consonante T del alfabeto dactilológico de la LSM.',
    instructions:
      'Cierra la mano en puño con la palma al frente y coloca la punta del pulgar asomando entre el dedo índice y el dedo medio.',
    profile: createProfile({
      fingers: { thumb: 'tucked', index: false, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
    }),
  },
  letra_u: {
    label: 'Letra U',
    displayName: 'Letra U',
    shortLabel: 'U',
    type: 'static',
    hint: 'Índice y medio extendidos hacia arriba y bien juntos',
    speakText: 'Letra U',
    meaning: 'Vocal U del alfabeto dactilológico de la LSM.',
    instructions:
      'Con la palma hacia la cámara, extiende hacia arriba los dedos índice y medio completamente juntos y pegados; mantén cerrados el pulgar, el anular y el meñique.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      fingerSpread: 'together',
    }),
  },
  letra_v: {
    label: 'Letra V',
    displayName: 'Letra V',
    shortLabel: 'V',
    type: 'static',
    hint: 'Índice y medio extendidos y separados en V',
    speakText: 'Letra V',
    meaning: 'Consonante V del alfabeto dactilológico de la LSM.',
    instructions:
      'Con la palma hacia la cámara, extiende hacia arriba los dedos índice y medio claramente separados formando una V; cierra pulgar, anular y meñique.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      fingerSpread: 'apart',
    }),
  },
  letra_w: {
    label: 'Letra W',
    displayName: 'Letra W',
    shortLabel: 'W',
    type: 'static',
    hint: 'Índice, medio y anular arriba y separados en W',
    speakText: 'Letra W',
    meaning: 'Consonante W del alfabeto dactilológico de la LSM.',
    instructions:
      'Con la palma al frente, extiende hacia arriba y separa los dedos índice, medio y anular formando una W, mientras el pulgar sujeta al meñique doblado.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      fingerSpread: 'apart',
    }),
  },
  letra_x: {
    label: 'Letra X',
    displayName: 'Letra X',
    shortLabel: 'X',
    type: 'dynamic',
    hint: 'Índice doblado en gancho con un pequeño jalón corto',
    speakText: 'Letra X',
    meaning: 'Consonante X en LSM; usa el índice en gancho acompañado de un breve movimiento.',
    instructions:
      'Cierra la mano en puño, levanta y dobla el dedo índice en forma de gancho y haz un pequeño movimiento corto hacia ti o hacia un lado.',
    profile: createProfile({
      fingers: { thumb: false, index: 'hook', middle: false, ring: false, pinky: false },
      hookIndex: true,
      dynamicMotion: 'pull_back',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento corto con el índice en gancho',
      motionBadge: 'Gancho con movimiento corto',
    }),
  },
  letra_y: {
    displayName: 'Letra Y',
    shortLabel: 'Y',
    meaning: 'Consonante Y del alfabeto dactilológico en LSM.',
    instructions:
      'Extiende el pulgar y el meñique al mismo tiempo mientras mantienes doblados los dedos índice, medio y anular.',
    profile: createProfile({
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: true },
    }),
  },
  letra_z: {
    label: 'Letra Z',
    displayName: 'Letra Z',
    shortLabel: 'Z',
    type: 'dynamic',
    hint: 'Índice extendido dibujando una Z en el aire',
    speakText: 'Letra Z',
    meaning: 'Consonante Z del alfabeto LSM; se traza dibujando su forma en el aire.',
    instructions:
      'Extiende únicamente el dedo índice (los demás dedos en puño) y dibuja una letra Z clara en el aire: trazo horizontal, diagonal hacia abajo y horizontal de nuevo.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: false, ring: false, pinky: false },
      dynamicMotion: 'z_trace',
      motionWindowMs: 1400,
      motionHint: 'dibuja una Z en el aire con tu dedo índice (lado, diagonal abajo y lado)',
      motionBadge: 'Trazo en Z en el aire',
    }),
  },

  // =========================================================================
  // 3. FRASES CORTAS (3 existentes + 13 nuevas = 16 señas)
  // =========================================================================
  te_quiero: {
    displayName: 'Te Quiero',
    meaning: 'Expresión universal de cariño y afecto en lengua de señas.',
    instructions:
      'Extiende el pulgar, el índice y el meñique al mismo tiempo; mantén cerrados los dedos medio y anular.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: true },
    }),
  },
  puno: {
    displayName: 'Puño · ¡Alto!',
    meaning: 'Postura base cerrada para enfatizar pausa, firmeza o detención.',
    instructions:
      'Flexiona los cuatro dedos largos contra la palma y recoge el pulgar sobre ellos formando un puño firme.',
    profile: createProfile({
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
    }),
  },
  cuernos: {
    displayName: '¡Genial! · Cuernos',
    meaning: 'Expresión gestual alegre para celebrar o animar en una conversación.',
    instructions:
      'Extiende únicamente los dedos índice y meñique hacia arriba; mantén doblados el pulgar, el medio y el anular.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: false, ring: false, pinky: true },
    }),
  },
  si: {
    label: 'Sí',
    displayName: 'Sí',
    type: 'dynamic',
    hint: 'Puño firme asintiendo suavemente arriba y abajo',
    speakText: 'Sí',
    meaning: 'Afirmación directa y clara para responder positivamente en LSM.',
    instructions:
      'Forma un puño cerrado con el pulgar al frente (como la letra S) y muévelo suavemente hacia abajo y arriba con la muñeca, como asintiendo.',
    profile: createProfile({
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      dynamicMotion: 'vertical_nod',
      motionWindowMs: 900,
      motionHint: 'mueve el puño suavemente arriba y abajo asintiendo',
      motionBadge: 'Asentimiento arriba y abajo',
    }),
  },
  no: {
    label: 'No',
    displayName: 'No',
    type: 'dynamic',
    hint: 'Índice y medio arriba moviéndose de lado a lado',
    speakText: 'No',
    meaning: 'Negación clara y cotidiana en una conversación en LSM.',
    instructions:
      'Con la palma hacia el frente, extiende los dedos índice y medio hacia arriba (pulgar, anular y meñique cerrados) y muévelos suavemente de lado a lado negando.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      dynamicMotion: 'lateral_shake',
      motionWindowMs: 900,
      motionHint: 'mueve los dedos índice y medio suavemente de lado a lado para negar',
      motionBadge: 'Movimiento lateral de negación',
    }),
  },
  ayuda: {
    label: 'Ayuda',
    displayName: 'Ayuda',
    type: 'dynamic',
    hint: 'Puño con pulgar arriba elevándose suavemente',
    speakText: 'Ayuda',
    meaning: 'Petición u ofrecimiento de apoyo o asistencia en LSM.',
    instructions:
      'Forma la letra A (puño cerrado con el pulgar recto hacia arriba al costado) y realiza un movimiento suave elevando tu mano hacia arriba frente al pecho.',
    profile: createProfile({
      fingers: { thumb: 'adducted', index: false, middle: false, ring: false, pinky: false },
      handDirection: 'UP',
      thumbUp: true,
      dynamicMotion: 'upward',
      motionWindowMs: 850,
      motionHint: 'eleva suavemente tu mano hacia arriba',
      motionBadge: 'Movimiento suave hacia arriba',
    }),
  },
  mas: {
    label: 'Más',
    displayName: 'Más',
    type: 'dynamic',
    hint: 'Yemas reunidas con el pulgar con pequeño toque lateral',
    speakText: 'Más',
    meaning: 'Indica deseo de agregar cantidad, repetir algo o pedir un poco más.',
    instructions:
      'Junta las yemas de todos tus dedos con el pulgar formando un pequeño cono cerrado y realiza un movimiento corto horizontal hacia el centro.',
    profile: createProfile({
      fingers: { thumb: 'oval', index: 'oval', middle: 'oval', ring: false, pinky: false },
      zeroOval: true,
      dynamicMotion: 'pull_back',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento corto hacia adelante o al centro con las yemas juntas',
      motionBadge: 'Pequeño toque hacia el centro',
    }),
  },
  listo: {
    label: 'Listo',
    displayName: 'Listo',
    type: 'dynamic',
    hint: 'Mano en forma de L desplazándose suavemente al lado',
    speakText: 'Listo',
    meaning: 'Expresa que algo ya está preparado, terminado o dispuesto.',
    instructions:
      'Forma la letra L (pulgar e índice extendidos en ángulo recto, palma al frente) y desliza tu mano suavemente hacia un lado.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      thumbIndexAngleRange: [30, 145],
      dynamicMotion: 'lateral_shake',
      motionWindowMs: 900,
      motionHint: 'desliza suavemente tu mano en L hacia un lado',
      motionBadge: 'Desplazamiento lateral en L',
    }),
  },
  esperar: {
    label: 'Esperar',
    displayName: 'Esperar',
    type: 'dynamic',
    hint: 'Mano abierta con suave vaivén hacia arriba y abajo',
    speakText: 'Esperar',
    meaning: 'Pide calma, pausa o aguardar un momento durante la charla.',
    instructions:
      'Abre los cinco dedos con naturalidad frente a ti y realiza un suave movimiento repetido hacia arriba y abajo indicando pausa.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      dynamicMotion: 'vertical_nod',
      motionWindowMs: 900,
      motionHint: 'haz un suave vaivén hacia arriba y abajo con la mano abierta',
      motionBadge: 'Vaivén vertical suave',
    }),
  },
  comer: {
    label: 'Comer',
    displayName: 'Comer',
    type: 'dynamic',
    hint: 'Dedos reunidos en cono acercándose arriba y abajo',
    speakText: 'Comer',
    meaning: 'Acción cotidiana de alimentarse o invitar a comer en LSM.',
    instructions:
      'Junta las yemas de tus dedos con la punta del pulgar formando un óvalo cerrado y realiza un suave vaivén vertical llevando la mano hacia la boca.',
    profile: createProfile({
      fingers: { thumb: 'oval', index: 'oval', middle: 'oval', ring: false, pinky: false },
      zeroOval: true,
      dynamicMotion: 'vertical_nod',
      motionWindowMs: 900,
      motionHint: 'mueve suavemente los dedos reunidos arriba y abajo frente a ti',
      motionBadge: 'Movimiento hacia la boca',
    }),
  },
  agua: {
    label: 'Agua',
    displayName: 'Agua',
    type: 'dynamic',
    hint: 'Letra A (pulgar recto) con pequeño vaivén suave',
    speakText: 'Agua',
    meaning: 'Sustantivo básico en LSM para pedir o referirse al agua.',
    instructions:
      'Forma la letra A (puño con el pulgar recto hacia arriba al costado) cerca de la barbilla y realiza un pequeño movimiento suave hacia arriba y abajo.',
    profile: createProfile({
      fingers: { thumb: 'adducted', index: false, middle: false, ring: false, pinky: false },
      handDirection: 'UP',
      thumbUp: true,
      dynamicMotion: 'vertical_nod',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño vaivén suave arriba y abajo con la mano en A',
      motionBadge: 'Pequeño vaivén en A',
    }),
  },
  casa: {
    label: 'Casa',
    displayName: 'Casa',
    type: 'static',
    hint: 'Mano plana inclinada formando un techo en diagonal',
    speakText: 'Casa',
    meaning: 'Representa el hogar o vivienda dibujando la inclinación del techo en LSM.',
    instructions:
      'Extiende los cuatro dedos largos bien juntos (mano plana) e inclina tu mano en diagonal hacia un lado formando el ángulo del techo de una casa.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      handDirection: 'TILTED',
      fingerSpread: 'together',
    }),
  },
  bano: {
    label: 'Baño',
    displayName: 'Baño',
    type: 'dynamic',
    hint: 'Letra B con dorso al frente y pequeño movimiento lateral',
    speakText: 'Baño',
    meaning: 'Seña indispensable en LSM para preguntar por el sanitario o baño.',
    instructions:
      'Coloca tu mano en letra B con la palma hacia tu pecho (mostrando el dorso a la cámara) y realiza un pequeño movimiento lateral suave.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'BACK',
      handDirection: 'UP',
      fingerSpread: 'together',
      dynamicMotion: 'lateral_shake',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento lateral suave mostrando el dorso en B',
      motionBadge: 'Movimiento lateral en B',
    }),
  },
  trabajo: {
    label: 'Trabajo',
    displayName: 'Trabajo',
    type: 'dynamic',
    hint: 'Puño en T haciendo un movimiento rítmico vertical',
    speakText: 'Trabajo',
    meaning: 'Expresa actividad laboral, empleo u ocupación diaria en LSM.',
    instructions:
      'Coloca tu mano en configuración de letra T (puño cerrado con el pulgar entre índice y medio) y haz un pequeño movimiento rítmico hacia abajo y arriba.',
    profile: createProfile({
      fingers: { thumb: 'tucked', index: false, middle: false, ring: false, pinky: false },
      dynamicMotion: 'vertical_nod',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento rítmico hacia abajo y arriba con el puño',
      motionBadge: 'Pulso vertical rítmico',
    }),
  },
  escuela: {
    label: 'Escuela',
    displayName: 'Escuela',
    type: 'dynamic',
    hint: 'Dedos en garra (E) con movimiento lateral suave',
    speakText: 'Escuela',
    meaning: 'Se refiere al centro de estudios, clases o colegio en LSM.',
    instructions:
      'Forma la letra E (palma al frente con los cuatro dedos doblados en garra sobre el pulgar) y realiza un suave movimiento lateral de lado a lado.',
    profile: createProfile({
      fingers: { thumb: false, index: 'claw', middle: 'claw', ring: 'claw', pinky: 'claw' },
      orientation: 'FRONT',
      clawShape: true,
      dynamicMotion: 'lateral_shake',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento lateral suave con los dedos en garra',
      motionBadge: 'Movimiento lateral en E',
    }),
  },
  entiendo: {
    label: 'Entiendo',
    displayName: 'Entiendo',
    type: 'dynamic',
    hint: 'Índice hacia arriba con pequeño impulso ascendente',
    speakText: 'Entiendo',
    meaning: 'Confirma que comprendiste el mensaje o la idea explicada.',
    instructions:
      'Extiende únicamente el dedo índice apuntando hacia arriba (los demás dedos en puño) y realiza un pequeño movimiento suave hacia arriba indicando claridad.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: false, ring: false, pinky: false },
      handDirection: 'UP',
      dynamicMotion: 'upward',
      motionWindowMs: 850,
      motionHint: 'haz un pequeño movimiento suave hacia arriba con el dedo índice',
      motionBadge: 'Impulso suave hacia arriba',
    }),
  },

  // =========================================================================
  // 4. AGRADECIMIENTOS / MODALES (3 existentes + 13 nuevas = 16 señas)
  // =========================================================================
  hola: {
    displayName: 'Hola',
    meaning: 'Saludo cordial y cercano para iniciar una conversación con respeto.',
    instructions:
      'Abre los cinco dedos con la palma visible y mueve tu mano suavemente de lado a lado saludando frente a la cámara.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      dynamicMotion: 'wave',
      motionWindowMs: 900,
      motionHint: 'mueve tu mano abierta suavemente de lado a lado para saludar',
      motionBadge: 'Movimiento lateral (saludo)',
    }),
  },
  bien: {
    displayName: 'Todo Bien · De acuerdo',
    meaning: 'Expresión amable de cortesía, aprobación y bienestar ("todo bien", "de acuerdo").',
    instructions:
      'Con la palma hacia el frente o de perfil, cierra los cuatro dedos largos y levanta el pulgar apuntando hacia arriba.',
    profile: createProfile({
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      thumbUp: true,
    }),
  },
  ok: {
    displayName: 'OK · Perfecto',
    meaning: 'Expresión cortés de entendimiento y confirmación ("perfecto", "entendido").',
    instructions:
      'Une las puntas del pulgar y el índice formando un círculo pequeño, y extiende hacia arriba los dedos medio, anular y meñique.',
    profile: createProfile({
      fingers: { thumb: 'pinch', index: 'pinch', middle: true, ring: true, pinky: true },
      pinch: true,
    }),
  },
  gracias: {
    label: 'Gracias',
    displayName: 'Gracias',
    type: 'dynamic',
    hint: '4 dedos juntos (palma al frente) bajando suavemente',
    speakText: 'Gracias',
    meaning: 'Expresión esencial de gratitud y aprecio en Lengua de Señas Mexicana.',
    instructions:
      'Mantén los cuatro dedos largos juntos y extendidos hacia arriba (pulgar doblado sobre la palma) a la altura del mentón, y desliza tu mano suavemente hacia adelante y abajo.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
      handDirection: 'UP',
      dynamicMotion: 'downward',
      motionWindowMs: 900,
      motionHint: 'desliza tu mano abierta suavemente hacia adelante y abajo',
      motionBadge: 'Deslizamiento hacia adelante y abajo',
    }),
  },
  por_favor: {
    label: 'Por favor',
    displayName: 'Por favor',
    type: 'dynamic',
    hint: '4 dedos juntos haciendo un círculo suave al pecho',
    speakText: 'Por favor',
    meaning: 'Fórmula de cortesía en LSM para solicitar algo con amabilidad.',
    instructions:
      'Coloca tu mano plana con los cuatro dedos largos juntos y el pulgar doblado frente a tu pecho, y realiza un movimiento circular suave.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
      dynamicMotion: 'circle',
      motionWindowMs: 1200,
      motionHint: 'haz un movimiento circular suave frente a tu pecho',
      motionBadge: 'Movimiento circular suave',
    }),
  },
  de_nada: {
    label: 'De nada',
    displayName: 'De nada',
    type: 'dynamic',
    hint: 'Mano abierta (5 dedos) bajando con gesto amable',
    speakText: 'De nada',
    meaning: 'Respuesta cortés y amable cuando alguien te agradece.',
    instructions:
      'Abre los cinco dedos frente a ti y baja suavemente tu mano hacia adelante y afuera con naturalidad.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      dynamicMotion: 'downward',
      motionWindowMs: 900,
      motionHint: 'baja suavemente tu mano abierta hacia adelante',
      motionBadge: 'Gesto descendente abierto',
    }),
  },
  perdon: {
    label: 'Perdón',
    displayName: 'Perdón',
    type: 'dynamic',
    hint: 'Letra Y (pulgar y meñique) con movimiento lateral suave',
    speakText: 'Perdón',
    meaning: 'Seña auténtica en LSM para ofrecer disculpas sinceras.',
    instructions:
      'Forma la letra Y (pulgar y meñique extendidos, los tres dedos del centro doblados) y realiza un suave movimiento lateral frente al mentón o pecho.',
    profile: createProfile({
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: true },
      dynamicMotion: 'lateral_shake',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento lateral suave con tu mano en Y',
      motionBadge: 'Movimiento lateral en Y',
    }),
  },
  disculpa: {
    label: 'Disculpa',
    displayName: 'Disculpa',
    type: 'dynamic',
    hint: 'Letra D (solo índice arriba) con pequeño movimiento lateral',
    speakText: 'Disculpa',
    meaning: 'Fórmula educada para llamar la atención o disculparse por un inconveniente.',
    instructions:
      'Forma la letra D (índice arriba y las puntas de los demás dedos cerradas tocando el pulgar) y haz un pequeño movimiento lateral suave frente al pecho.',
    profile: createProfile({
      fingers: { thumb: 'pinch', index: true, middle: false, ring: false, pinky: false },
      orientation: 'FRONT',
      handDirection: 'UP',
      dCircle: true,
      dynamicMotion: 'lateral_shake',
      motionWindowMs: 900,
      motionHint: 'haz un pequeño movimiento lateral suave con la mano en D',
      motionBadge: 'Movimiento lateral en D',
    }),
  },
  buenos_dias: {
    label: 'Buenos días',
    displayName: 'Buenos días',
    type: 'dynamic',
    hint: 'Letra B elevándose suavemente como el amanecer',
    speakText: 'Buenos días',
    meaning: 'Saludo matutino cordial en Lengua de Señas Mexicana.',
    instructions:
      'Forma la letra B (palma al frente, cuatro dedos largos juntos hacia arriba y pulgar doblado) y eleva tu mano suavemente hacia arriba.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
      handDirection: 'UP',
      dynamicMotion: 'upward',
      motionWindowMs: 900,
      motionHint: 'eleva suavemente tu mano hacia arriba como el amanecer',
      motionBadge: 'Elevación suave hacia arriba',
    }),
  },
  buenas_tardes: {
    label: 'Buenas tardes',
    displayName: 'Buenas tardes',
    type: 'dynamic',
    hint: 'Mano plana horizontal descendiendo como el atardecer',
    speakText: 'Buenas tardes',
    meaning: 'Saludo vespertino educado en Lengua de Señas Mexicana.',
    instructions:
      'Coloca los cuatro dedos largos juntos y extendidos en posición horizontal (pulgar doblado) y desciende tu mano suavemente hacia abajo, como el sol al atardecer.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      handDirection: 'HORIZONTAL',
      dynamicMotion: 'downward',
      motionWindowMs: 900,
      motionHint: 'baja tu mano plana horizontal suavemente hacia abajo',
      motionBadge: 'Descenso horizontal suave',
    }),
  },
  buenas_noches: {
    label: 'Buenas noches',
    displayName: 'Buenas noches',
    type: 'dynamic',
    hint: 'Mano en arco descendiendo suavemente al final del día',
    speakText: 'Buenas noches',
    meaning: 'Saludo o despedida nocturna en Lengua de Señas Mexicana.',
    instructions:
      'Curva todos tus dedos suavemente en forma de arco (como una C suave) y desciende tu mano con calma hacia abajo.',
    profile: createProfile({
      fingers: { thumb: 'arch', index: 'arch', middle: 'arch', ring: 'arch', pinky: 'arch' },
      cArc: true,
      dynamicMotion: 'downward',
      motionWindowMs: 900,
      motionHint: 'baja suavemente tu mano arqueada hacia abajo',
      motionBadge: 'Descenso suave en arco',
    }),
  },
  adios: {
    label: 'Adiós',
    displayName: 'Adiós',
    type: 'dynamic',
    hint: '4 dedos arriba (palma al frente) agitándose para despedirse',
    speakText: 'Adiós',
    meaning: 'Despedida cordial y amigable al cerrar una conversación.',
    instructions:
      'Levanta los cuatro dedos largos con la palma al frente (pulgar doblado sobre la palma) y agita tu mano suavemente de lado a lado para despedirte.',
    profile: createProfile({
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
      orientation: 'FRONT',
      dynamicMotion: 'wave',
      motionWindowMs: 900,
      motionHint: 'agita tu mano suavemente de lado a lado para despedirte',
      motionBadge: 'Despedida lateral suave',
    }),
  },
  mucho_gusto: {
    label: 'Mucho gusto',
    displayName: 'Mucho gusto',
    type: 'dynamic',
    hint: 'Mano abierta (5 dedos) trazando un círculo amable al frente',
    speakText: 'Mucho gusto',
    meaning: 'Expresión cálida al conocer a una persona nueva en LSM.',
    instructions:
      'Abre los cinco dedos con naturalidad frente a tu pecho y dibuja un círculo suave demostrando agrado y amabilidad.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      dynamicMotion: 'circle',
      motionWindowMs: 1200,
      motionHint: 'dibuja un círculo suave frente a tu pecho con la mano abierta',
      motionBadge: 'Círculo suave al pecho',
    }),
  },
  bienvenido: {
    label: 'Bienvenido',
    displayName: 'Bienvenido',
    type: 'dynamic',
    hint: 'Mano abierta acercándose hacia ti invitando a pasar',
    speakText: 'Bienvenido',
    meaning: 'Saludo hospitalario para recibir a alguien con cortesía.',
    instructions:
      'Extiende los cinco dedos con la palma abierta y haz un gesto acogedor acercando suavemente tu mano hacia ti.',
    profile: createProfile({
      fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
      dynamicMotion: 'pull_back',
      motionWindowMs: 900,
      motionHint: 'acerca suavemente tu mano abierta hacia ti en gesto de bienvenida',
      motionBadge: 'Gesto acogedor hacia ti',
    }),
  },
  con_permiso: {
    label: 'Con permiso',
    displayName: 'Con permiso',
    type: 'dynamic',
    hint: 'Letra P deslizándose suavemente hacia un lado',
    speakText: 'Con permiso',
    meaning: 'Expresión educada en LSM para pedir paso o permiso con respeto.',
    instructions:
      'Forma la letra P (índice arriba, medio inclinado y pulgar entre ambos) y realiza un desplazamiento corto y suave hacia un lado o al frente.',
    profile: createProfile({
      fingers: { thumb: 'between', index: true, middle: true, ring: false, pinky: false },
      orientation: 'FRONT',
      kpShape: true,
      dynamicMotion: 'pull_back',
      motionWindowMs: 900,
      motionHint: 'desliza suavemente tu mano en forma de P hacia un lado o adelante',
      motionBadge: 'Desplazamiento suave en P',
    }),
  },
  salud: {
    label: 'Salud',
    displayName: 'Salud',
    type: 'dynamic',
    hint: 'Puño firme elevándose suavemente hacia arriba',
    speakText: 'Salud',
    meaning: 'Expresión de buenos deseos y bienestar hacia otra persona.',
    instructions:
      'Cierra tu mano en puño firme frente al pecho y realiza un pequeño movimiento suave hacia arriba deseando bienestar.',
    profile: createProfile({
      fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      dynamicMotion: 'upward',
      motionWindowMs: 900,
      motionHint: 'eleva suavemente el puño hacia arriba con firmeza',
      motionBadge: 'Elevación suave hacia arriba',
    }),
  },
});

export const NUMBER_SIGN_IDS = Object.freeze([
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
]);

export const ALPHABET_SIGN_IDS = Object.freeze([
  'letra_a',
  'letra_b',
  'letra_c',
  'letra_d',
  'letra_e',
  'letra_f',
  'letra_g',
  'letra_h',
  'letra_i',
  'letra_j',
  'letra_k',
  'letra_l',
  'letra_m',
  'letra_n',
  'letra_enie',
  'letra_o',
  'letra_p',
  'letra_q',
  'letra_r',
  'letra_s',
  'letra_t',
  'letra_u',
  'letra_v',
  'letra_w',
  'letra_x',
  'letra_y',
  'letra_z',
]);

export const SHORT_PHRASE_SIGN_IDS = Object.freeze([
  'te_quiero',
  'puno',
  'cuernos',
  'si',
  'no',
  'ayuda',
  'mas',
  'listo',
  'esperar',
  'comer',
  'agua',
  'casa',
  'bano',
  'trabajo',
  'escuela',
  'entiendo',
]);

export const COURTESY_SIGN_IDS = Object.freeze([
  'hola',
  'bien',
  'ok',
  'gracias',
  'por_favor',
  'de_nada',
  'perdon',
  'disculpa',
  'buenos_dias',
  'buenas_tardes',
  'buenas_noches',
  'adios',
  'mucho_gusto',
  'bienvenido',
  'con_permiso',
  'salud',
]);

export const PHRASE_MODE_SIGN_IDS = Object.freeze([
  ...SHORT_PHRASE_SIGN_IDS,
  ...COURTESY_SIGN_IDS,
]);

export function buildExtendedSignEntry(signId) {
  const def = EXTENDED_SIGN_DEFINITIONS[signId];
  if (!def) {
    throw new Error(`La seña "${signId}" no existe en EXTENDED_SIGN_DEFINITIONS.`);
  }
  const baseEntry = BASE_CATALOG_BY_ID.get(signId) || null;
  const resolvedType =
    def.type || baseEntry?.type || (def.profile.dynamicMotion ? 'dynamic' : 'static');
  const resolvedLabel = def.label || baseEntry?.label || def.displayName;
  const resolvedHint = def.hint || baseEntry?.hint || '';
  const resolvedSpeakText = def.speakText || baseEntry?.speakText || def.displayName;

  return Object.freeze({
    id: signId,
    label: resolvedLabel,
    displayName: def.displayName,
    shortLabel: def.shortLabel || null,
    type: resolvedType,
    hint: resolvedHint,
    speakText: resolvedSpeakText,
    aliases: Object.freeze(Array.isArray(def.aliases) ? [...def.aliases] : []),
    legacyIds: Object.freeze(Array.isArray(def.legacyIds) ? [...def.legacyIds] : []),
    meaning: def.meaning,
    instructions: def.instructions,
    profile: def.profile,
  });
}

const ALPHABET_CATALOG = Object.freeze(ALPHABET_SIGN_IDS.map(buildExtendedSignEntry));
const NUMBERS_CATALOG = Object.freeze(NUMBER_SIGN_IDS.map(buildExtendedSignEntry));
const PHRASES_CATALOG = Object.freeze(PHRASE_MODE_SIGN_IDS.map(buildExtendedSignEntry));

export const CONTEXT_MODE_LIST = Object.freeze([
  Object.freeze({
    id: CONTEXT_MODES.GENERAL,
    title: 'General',
    shortTitle: 'General',
    description: 'Señas esenciales verificadas: saludos, cortesías y números del 0 al 10.',
    signs: SIGN_CATALOG,
  }),
  Object.freeze({
    id: CONTEXT_MODES.ALPHABET,
    title: 'Abecedario',
    shortTitle: 'Abecedario',
    description: 'Las 27 letras del alfabeto LSM (A–Z y Ñ), incluyendo letras con movimiento.',
    signs: ALPHABET_CATALOG,
  }),
  Object.freeze({
    id: CONTEXT_MODES.NUMBERS,
    title: 'Números',
    shortTitle: 'Números',
    description: 'Números del 0 al 10 en Lengua de Señas Mexicana.',
    signs: NUMBERS_CATALOG,
  }),
  Object.freeze({
    id: CONTEXT_MODES.PHRASES,
    title: 'Frases y Modales',
    shortTitle: 'Frases y Modales',
    description: 'Frases cotidianas, saludos, agradecimientos y expresiones de cortesía en LSM.',
    signs: PHRASES_CATALOG,
  }),
]);

const MODE_BY_ID = new Map(CONTEXT_MODE_LIST.map((m) => [m.id, m]));

const ALL_ENTRIES_BY_LABEL = new Map();
for (const entry of SIGN_CATALOG) {
  ALL_ENTRIES_BY_LABEL.set(entry.label, entry);
}
for (const list of [NUMBERS_CATALOG, ALPHABET_CATALOG, PHRASES_CATALOG]) {
  for (const entry of list) {
    if (!ALL_ENTRIES_BY_LABEL.has(entry.label)) {
      ALL_ENTRIES_BY_LABEL.set(entry.label, entry);
    }
    for (const alias of entry.aliases) {
      if (!ALL_ENTRIES_BY_LABEL.has(alias)) {
        ALL_ENTRIES_BY_LABEL.set(alias, entry);
      }
    }
  }
}

export function getContextModeMeta(mode = CONTEXT_MODES.GENERAL) {
  return MODE_BY_ID.get(normalizeContextMode(mode)) || MODE_BY_ID.get(CONTEXT_MODES.GENERAL);
}

export function getModeCatalog(mode = CONTEXT_MODES.GENERAL) {
  return getContextModeMeta(mode).signs;
}

/**
 * Looks up catalog metadata (id, type, hint, speakText) by canonical sign label
 * across `'general'` and all extended context modes (for TTS & UI badges).
 */
export function getSignCatalogEntry(label) {
  return ALL_ENTRIES_BY_LABEL.get(label) || null;
}

export { SIGN_LABELS, SIGN_CATALOG };
