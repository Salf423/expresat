/**
 * src/recognition/signs/numbers.js — Catálogo declarativo de Números Básicos de LSM (0 a 10)
 *
 * Fuentes verificadas:
 * - [LEARN-REPO]: `expresat/frontend/src/pages/Learn.jsx` (números 1 y 2)
 * - [CONAPRED-LSM]: Serafín de Fleischmann & González Pérez (2011), *Manos con Voz: Diccionario de LSM* (CONAPRED/SEP)
 * - [IMG-REPO]: `imagenes_abecedario/o.png` (homomorfo a 0) y `w.png` (homomorfo a 3)
 */

import { SIGN_CATEGORIES, SIGN_TYPES, CONFUSABLE_GROUPS } from './schema.js';

export const NUMBER_SIGNS = [
  {
    id: 'NUM_0',
    label: '0',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM] / homomorfo a imagenes_abecedario/o.png',
    descripcion: 'Dedos curvados uniendo sus yemas con el pulgar formando un círculo (0)',
    grupoConfundible: CONFUSABLE_GROUPS.G1_PUNO_CERRADO,
    estado: 'LISTA',
    aliases: ['O'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'PINCHING',
      index: 'HOOKED',
      middle: 'HOOKED',
      ring: 'HOOKED',
      pinky: 'HOOKED',
    },
    metricas: [
      { metric: 'thumbIndexTipDist', min: 0, max: 0.34, slack: 0.06, weight: 1.5, required: true },
      { metric: 'thumbMiddleTipDist', min: 0, max: 0.38, slack: 0.08, weight: 1.5, required: true },
    ],
    pesos: { fingers: 0.55, metrics: 0.45 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
  {
    id: 'NUM_1',
    label: '1',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'Learn.jsx#L22 / [CONAPRED-LSM]',
    descripcion: 'Mano cerrada en puño con únicamente el dedo índice extendido hacia arriba',
    grupoConfundible: CONFUSABLE_GROUPS.G2_INDICE_SOLO,
    estado: 'LISTA',
    aliases: ['Uno'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'CURLED',
      index: 'EXTENDED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'thumbMiddleTipDist', min: 0.32, max: 2.5, slack: 0.08, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.75, metrics: 0.25 },
    refineScore: (base) => Math.min(0.95, base * 0.95),
  },
  {
    id: 'NUM_2',
    label: '2',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'Learn.jsx#L23 / [CONAPRED-LSM]',
    descripcion: 'Dedos índice y medio extendidos y separados en forma de V',
    grupoConfundible: CONFUSABLE_GROUPS.G4_DOS_DEDOS,
    estado: 'LISTA',
    aliases: ['Dos', 'V'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'CURLED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'indexMiddleSpread2D', min: 0.21, max: 1.5, slack: 0.05, weight: 1.2, required: true },
      { metric: 'indexMiddleCrossDeltaX', min: -1.2, max: -0.15, slack: 0.06, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.65, metrics: 0.35 },
    refineScore: (base, features) => {
      const dir = features.orientation?.direction;
      const face = features.orientation?.palmFacing;
      if ((dir === 'HORIZONTAL' || dir === 'DOWN') && face === 'BACK') {
        return base * 0.6;
      }
      return Math.min(0.96, base * 0.96);
    },
  },
  {
    id: 'NUM_3',
    label: '3',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM] / homomorfo a imagenes_abecedario/w.png',
    descripcion: 'Dedos índice, medio y anular extendidos hacia arriba; meñique y pulgar doblados',
    grupoConfundible: CONFUSABLE_GROUPS.G5_TRES_DEDOS,
    estado: 'LISTA',
    aliases: ['W'],
    orientacion: { directions: ['UP'], palmFacing: ['FRONT', 'SIDE'], required: true },
    dedos: {
      thumb: 'CURLED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'EXTENDED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'indexMiddleSpread2D', min: 0.14, max: 1.2, slack: 0.06, weight: 1.0 },
    ],
    pesos: { fingers: 0.6, orientation: 0.2, metrics: 0.2 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
  {
    id: 'NUM_4',
    label: '4',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM]',
    descripcion: 'Cuatro dedos largos extendidos hacia arriba y separados en abanico; pulgar doblado en la palma',
    grupoConfundible: CONFUSABLE_GROUPS.G6_CUATRO_CINCO,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['UP'], palmFacing: ['FRONT'], required: true },
    dedos: {
      thumb: 'CURLED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'EXTENDED',
      pinky: 'EXTENDED',
    },
    metricas: [
      // Se diferencia de B porque en el 4 los cuatro dedos están separados (fourFingersSpread >= 0.48)
      { metric: 'fourFingersSpread', min: 0.48, max: 2.5, slack: 0.08, weight: 1.5, required: true },
    ],
    pesos: { fingers: 0.55, orientation: 0.2, metrics: 0.25 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
  {
    id: 'NUM_5',
    label: '5',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM]',
    descripcion: 'Cinco dedos completamente extendidos y separados',
    grupoConfundible: CONFUSABLE_GROUPS.G6_CUATRO_CINCO,
    estado: 'LISTA',
    aliases: ['Mano Abierta'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'EXTENDED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'EXTENDED',
      pinky: 'EXTENDED',
    },
    pesos: { fingers: 1.0 },
    refineScore: (base) => Math.min(0.96, base * 0.96),
  },
  {
    id: 'NUM_6',
    label: '6',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM] (Manos con Voz)',
    descripcion: 'Puño cerrado con el pulgar extendido hacia arriba y el dorso de la mano orientado hacia el frente',
    grupoConfundible: CONFUSABLE_GROUPS.G7_MENIQUE_PULGAR,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['UP'], palmFacing: ['BACK'], required: true },
    dedos: {
      thumb: 'EXTENDED',
      index: 'TIGHTLY_CURLED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    pesos: { fingers: 0.65, orientation: 0.35 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
  {
    id: 'NUM_7',
    label: '7',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM] (Manos con Voz)',
    descripcion: 'Configuración de letra G inclinada diagonalmente con pulgar e índice estirados y dorso al frente',
    grupoConfundible: CONFUSABLE_GROUPS.G3_PULGAR_INDICE,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['OBLIQUE'], palmFacing: ['BACK'], required: true },
    dedos: {
      thumb: 'EXTENDED',
      index: 'EXTENDED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'thumbIndexAngleDeg', min: 25, max: 120, slack: 15, weight: 1.0 },
    ],
    pesos: { fingers: 0.55, orientation: 0.3, metrics: 0.15 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
  {
    id: 'NUM_8',
    label: '8',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM] (Manos con Voz)',
    descripcion: 'Dedos pulgar, índice y medio extendidos y separados con dorso al frente; anular y meñique cerrados',
    grupoConfundible: CONFUSABLE_GROUPS.G5_TRES_DEDOS,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['UP', 'OBLIQUE'], palmFacing: ['BACK', 'FRONT'], required: true },
    dedos: {
      thumb: 'EXTENDED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'indexMiddleSpread2D', min: 0.16, max: 1.5, slack: 0.06, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.65, orientation: 0.15, metrics: 0.2 },
    refineScore: (base, features) => {
      // Si la mano está horizontal con dorso al frente y dedos juntos, corresponde a la letra H
      if (
        features.orientation?.direction === 'HORIZONTAL' &&
        features.indexMiddleSpread2D < 0.24
      ) {
        return 0;
      }
      return Math.min(0.95, base * 0.96);
    },
  },
  {
    id: 'NUM_9',
    label: '9',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: '[CONAPRED-LSM] (Manos con Voz)',
    descripcion: 'Cuatro dedos largos extendidos con la palma hacia el señante (dorso al frente) cubriendo el pulgar',
    grupoConfundible: CONFUSABLE_GROUPS.G6_CUATRO_CINCO,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['UP'], palmFacing: ['BACK'], required: true },
    dedos: {
      thumb: 'CURLED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'EXTENDED',
      pinky: 'EXTENDED',
    },
    pesos: { fingers: 0.65, orientation: 0.35 },
    refineScore: (base) => Math.min(0.94, base * 0.95),
  },
  {
    id: 'NUM_10',
    label: '10',
    categoria: SIGN_CATEGORIES.NUMERO,
    tipo: SIGN_TYPES.DINAMICA,
    fuente: '[CONAPRED-LSM] (Manos con Voz)',
    descripcion: 'Mano abierta (5) que ejecuta un giro rápido de muñeca invirtiendo la orientación de la palma',
    grupoConfundible: CONFUSABLE_GROUPS.G6_CUATRO_CINCO,
    estado: 'LISTA',
    aliases: [],
    priority: 0.04,
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'EXTENDED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'EXTENDED',
      pinky: 'EXTENDED',
    },
    trayectoria: {
      kind: 'PALM_ROTATION',
      windowMs: 750,
    },
    pesos: { fingers: 0.5, dynamic: 0.5 },
    refineScore: (base, _features, traj) => {
      // Si hay oscilación lateral pura sin rotación de palma, es "Hola", no "10"
      if (traj?.oscillationX?.isOscillating && !traj?.palmRotation?.isRotating) {
        return 0;
      }
      return Math.min(0.96, Math.max(base, 0.95));
    },
  },
];
