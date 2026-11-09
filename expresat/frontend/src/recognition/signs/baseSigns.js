/**
 * src/recognition/signs/baseSigns.js — Definiciones declarativas de las 9 señas base de la demo
 *
 * Mantiene el 100% de compatibilidad de regresión con la versión inicial (`rearquitectura-demo`),
 * incluyendo invariancia a rotación (-90° a 180°) y escala (0.4x a 3.0x).
 */

import { SIGN_CATEGORIES, SIGN_TYPES, CONFUSABLE_GROUPS } from './schema.js';

export const BASE_SIGNS = [
  {
    id: 'BASE_HOLA',
    label: 'Hola',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.DINAMICA,
    fuente: 'Learn.jsx#L32 / [CONAPRED-LSM]',
    descripcion: 'Mano abierta con saludo dinámico lateral',
    grupoConfundible: CONFUSABLE_GROUPS.G6_CUATRO_CINCO,
    estado: 'LISTA',
    aliases: [],
    priority: 0.05,
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'EXTENDED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'EXTENDED',
      pinky: 'EXTENDED',
    },
    trayectoria: {
      kind: 'WAVE_X',
      windowMs: 750,
      minDirectionChanges: 2,
    },
    pesos: { fingers: 0.5, dynamic: 0.5 },
    refineScore: (base) => Math.max(base, 0.97),
  },
  {
    id: 'BASE_OK',
    label: 'OK / Pinza',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'src/recognition/classifier.js (Pinza pulgar-índice)',
    descripcion: 'Pulgar e índice formando pinza/círculo OK con medio, anular y meñique abiertos',
    grupoConfundible: CONFUSABLE_GROUPS.G5_TRES_DEDOS,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'PINCHING',
      index: 'ANY',
      middle: 'EXTENDED',
      ring: 'EXTENDED',
      pinky: 'EXTENDED',
    },
    metricas: [
      { metric: 'thumbIndexTipDist', min: 0, max: 0.36, slack: 0.06, weight: 1.5, required: true },
      { metric: 'threeFingersSpread', min: 0.36, max: 2.5, slack: 0.12, weight: 1.0 },
    ],
    pesos: { fingers: 0.55, metrics: 0.45 },
  },
  {
    id: 'BASE_MANO_ABIERTA',
    label: 'Mano Abierta',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'src/recognition/classifier.js / [CONAPRED-LSM]',
    descripcion: 'Cinco dedos extendidos',
    grupoConfundible: CONFUSABLE_GROUPS.G6_CUATRO_CINCO,
    estado: 'LISTA',
    aliases: ['5'],
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
    id: 'BASE_PUNO',
    label: 'Puño',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'src/recognition/classifier.js',
    descripcion: 'Cinco dedos cerrados en puño',
    grupoConfundible: CONFUSABLE_GROUPS.G1_PUNO_CERRADO,
    estado: 'LISTA',
    aliases: ['S'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'CURLED',
      index: 'TIGHTLY_CURLED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      // En el puño base (y S), el pulgar se dobla hacia el centro de la palma (tipCanonicalX >= -0.10 y tipY >= -0.85)
      { metric: 'tipCanonicalX', min: -0.1, max: 0.35, slack: 0.06, weight: 1.0, required: true },
      { metric: 'tipY', min: -0.85, max: 0.2, slack: 0.08, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.7, metrics: 0.3 },
    refineScore: (base) => Math.min(0.95, base * 0.95),
  },
  {
    id: 'BASE_UNO',
    label: 'Uno',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'Learn.jsx#L22 / [CONAPRED-LSM]',
    descripcion: 'Solo dedo índice extendido',
    grupoConfundible: CONFUSABLE_GROUPS.G2_INDICE_SOLO,
    estado: 'LISTA',
    aliases: ['1'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'CURLED',
      index: 'EXTENDED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      // Diferenciar de D: en Uno/1 la punta del medio está doblada en palma y lejos de hacer círculo con el pulgar
      { metric: 'thumbMiddleTipDist', min: 0.32, max: 2.5, slack: 0.08, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.75, metrics: 0.25 },
    refineScore: (base) => Math.min(0.95, base * 0.95),
  },
  {
    id: 'BASE_DOS',
    label: 'Dos',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'Learn.jsx#L23 / [CONAPRED-LSM]',
    descripcion: 'Dedos índice y medio extendidos en V',
    grupoConfundible: CONFUSABLE_GROUPS.G4_DOS_DEDOS,
    estado: 'LISTA',
    aliases: ['2', 'V'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'CURLED',
      index: 'EXTENDED',
      middle: 'EXTENDED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'indexMiddleSpread2D', min: 0.25, max: 1.5, slack: 0.04, weight: 1.5, required: true },
      { metric: 'indexMiddleCrossDeltaX', min: -1.2, max: -0.2, slack: 0.05, weight: 1.0, required: true },
      { metric: 'thumbToIndexMiddlePipMid', min: 0.35, max: 2.0, slack: 0.08, weight: 1.0, required: true },
    ],
    pesos: { fingers: 0.65, metrics: 0.35 },
    refineScore: (base, features) => {
      // Si la mano está orientada horizontalmente o hacia abajo con dorso al frente, corresponde a H o N
      const dir = features.orientation?.direction;
      const face = features.orientation?.palmFacing;
      if ((dir === 'HORIZONTAL' || dir === 'DOWN') && face === 'BACK') {
        return 0;
      }
      return Math.min(0.96, base * 0.96);
    },
  },
  {
    id: 'BASE_TE_QUIERO',
    label: 'Te Quiero',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'src/recognition/classifier.js (ILY)',
    descripcion: 'Pulgar, índice y meñique extendidos (ILY)',
    grupoConfundible: CONFUSABLE_GROUPS.G7_MENIQUE_PULGAR,
    estado: 'LISTA',
    aliases: [],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'EXTENDED',
      index: 'EXTENDED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'EXTENDED',
    },
    pesos: { fingers: 1.0 },
    refineScore: (base) => Math.min(0.95, base * 0.95),
  },
  {
    id: 'BASE_LUNES',
    label: 'Lunes',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'Learn.jsx#L52 / imagenes_abecedario/l.png',
    descripcion: 'Pulgar e índice extendidos en forma de L',
    grupoConfundible: CONFUSABLE_GROUPS.G3_PULGAR_INDICE,
    estado: 'LISTA',
    aliases: ['L'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'EXTENDED',
      index: 'EXTENDED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    metricas: [
      { metric: 'thumbIndexAngleDeg', min: 38, max: 135, slack: 15, weight: 1.0 },
    ],
    pesos: { fingers: 0.75, metrics: 0.25 },
    refineScore: (base, features) => {
      // Si la mano está horizontal o inclinada con dorso al frente (G o 7), ceder prioridad a G/7
      const dir = features.orientation?.direction;
      const face = features.orientation?.palmFacing;
      if ((dir === 'HORIZONTAL' || dir === 'OBLIQUE') && face === 'BACK') {
        return base * 0.72;
      }
      return Math.min(0.94, base * 0.94);
    },
  },
  {
    id: 'BASE_BIEN',
    label: 'Bien',
    categoria: SIGN_CATEGORIES.BASICA,
    tipo: SIGN_TYPES.ESTATICA,
    fuente: 'src/recognition/classifier.js / exported_model/model_metadata.json',
    descripcion: 'Solo pulgar extendido',
    grupoConfundible: CONFUSABLE_GROUPS.G7_MENIQUE_PULGAR,
    estado: 'LISTA',
    aliases: ['6'],
    orientacion: { directions: ['ANY'], palmFacing: ['ANY'] },
    dedos: {
      thumb: 'EXTENDED',
      index: 'TIGHTLY_CURLED',
      middle: 'TIGHTLY_CURLED',
      ring: 'TIGHTLY_CURLED',
      pinky: 'TIGHTLY_CURLED',
    },
    pesos: { fingers: 1.0 },
    refineScore: (base, features) => {
      // Si muestra explícitamente el dorso a cámara con orientación UP, en LSM corresponde al número 6
      if (features.orientation?.palmFacing === 'BACK' && features.orientation?.direction === 'UP') {
        return base * 0.85;
      }
      return Math.min(0.93, base * 0.93);
    },
  },
];
