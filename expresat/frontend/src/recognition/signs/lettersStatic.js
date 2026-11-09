/**
 * src/recognition/signs/lettersStatic.js — Catálogo declarativo de Letras Estáticas del Alfabeto LSM
 *
 * Implementado por grupos confundibles (Fase D):
 * - Sub-fase D.1: Grupo G1_PUNO_CERRADO (A, E, O, S, T)
 */

import { SIGN_CATEGORIES, SIGN_TYPES, CONFUSABLE_GROUPS } from './schema.js';

export const STATIC_LETTER_SIGNS = [
  // ============================================================================
  // GRUPO G1_PUNO_CERRADO: A, E, O, S, T
  // ============================================================================
  {
    id: 'LETRA_A',
    label: 'A',
    categoria: SIGN_CATEGORIES.LETRA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'imagenes_abecedario/a.png / Learn.jsx#L11',
    descripcion: 'Puño cerrado con los cuatro dedos flexionados y el pulgar extendido al costado radial del índice',
    grupoConfundible: CONFUSABLE_GROUPS.G1_PUNO_CERRADO,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['UP'], palmFacing: ['FRONT', 'SIDE'] },
    dedos: {
      thumb: 'NOT_EXTENDED',
      index: 'TIGHTLY_CURLED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'tipCanonicalX', min: -0.62, max: -0.34, slack: 0.05, weight: 1.5, required: true },
      { metric: 'tipY', min: -1.32, max: -0.88, slack: 0.08, weight: 1.2, required: true },
      { metric: 'ipAngle', min: 135, max: 180, slack: 15, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.5, orientation: 0.1, metrics: 0.4 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
  {
    id: 'LETRA_E',
    label: 'E',
    categoria: SIGN_CATEGORIES.LETRA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'imagenes_abecedario/e.png',
    descripcion: 'Cuatro dedos flexionados en garra alta y pulgar doblado horizontalmente por debajo sin tocarlos',
    grupoConfundible: CONFUSABLE_GROUPS.G1_PUNO_CERRADO,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['UP'], palmFacing: ['FRONT'] },
    dedos: {
      thumb: 'CURLED',
      index: 'HOOKED',
      middle: 'HOOKED',
      ring: 'HOOKED',
      pinky: 'HOOKED',
    },
    metricas: [
      { metric: 'thumbIndexTipDist', min: 0.42, max: 2.0, slack: 0.06, weight: 1.5, required: true },
      { metric: 'thumbMiddleTipDist', min: 0.42, max: 2.0, slack: 0.06, weight: 1.5, required: true },
      { metric: 'tipY', min: -0.78, max: 0.1, slack: 0.08, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.55, orientation: 0.1, metrics: 0.35 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
  {
    id: 'LETRA_O',
    label: 'O',
    categoria: SIGN_CATEGORIES.LETRA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'imagenes_abecedario/o.png',
    descripcion: 'Dedos curvados de modo que las puntas del índice y medio se unen con la punta del pulgar formando una O',
    grupoConfundible: CONFUSABLE_GROUPS.G1_PUNO_CERRADO,
    estado: 'LISTA',
    aliases: ['0'],
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
    id: 'LETRA_S',
    label: 'S',
    categoria: SIGN_CATEGORIES.LETRA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'imagenes_abecedario/s.png',
    descripcion: 'Puño cerrado con los cuatro dedos enrollados y el pulgar cruzado por delante de ellos',
    grupoConfundible: CONFUSABLE_GROUPS.G1_PUNO_CERRADO,
    estado: 'LISTA',
    aliases: ['Puño'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'CURLED',
      index: 'TIGHTLY_CURLED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'tipCanonicalX', min: -0.1, max: 0.35, slack: 0.06, weight: 1.2, required: true },
      { metric: 'tipY', min: -0.85, max: 0.2, slack: 0.08, weight: 1.2, required: true },
    ],
    pesos: { fingers: 0.65, metrics: 0.35 },
    refineScore: (base) => Math.min(0.95, base * 0.95),
  },
  {
    id: 'LETRA_T',
    label: 'T',
    categoria: SIGN_CATEGORIES.LETRA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'imagenes_abecedario/t.png',
    descripcion: 'Puño cerrado donde la punta del pulgar se inserta entre los dedos índice y medio flexionados',
    grupoConfundible: CONFUSABLE_GROUPS.G1_PUNO_CERRADO,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['UP'], palmFacing: ['FRONT'] },
    dedos: {
      thumb: 'NOT_EXTENDED',
      index: 'TIGHTLY_CURLED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'tipCanonicalX', min: -0.26, max: -0.06, slack: 0.04, weight: 1.5, required: true },
      { metric: 'tipY', min: -1.3, max: -0.95, slack: 0.06, weight: 1.5, required: true },
      { metric: 'thumbToIndexMiddlePipMid', min: 0, max: 0.24, slack: 0.05, weight: 1.5, required: true },
    ],
    pesos: { fingers: 0.45, orientation: 0.1, metrics: 0.45 },
    refineScore: (base) => Math.min(0.95, base * 0.96),
  },
];
