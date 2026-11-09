/**
 * src/recognition/signs/index.js — Punto de entrada del catálogo declarativo de LSM y su matcher
 */

import { BASE_SIGNS } from './baseSigns.js';
import { NUMBER_SIGNS } from './numbers.js';
import { STATIC_LETTER_SIGNS } from './lettersStatic.js';
import { DYNAMIC_LETTER_SIGNS } from './lettersDynamic.js';
import { SIGN_CATEGORIES, SIGN_TYPES, CONFUSABLE_GROUPS, isValidSignEntry } from './schema.js';
import { scoreSign, scoreRange, matchCatalog } from './matcher.js';
import {
  TRAJECTORY_TEMPLATES,
  normalizeTimedEntries,
  extractWindowMs,
  resampleTrajectory,
  matchTrajectoryTemplate,
  buildTrajectoryContext,
} from './trajectory.js';

/**
 * Devuelve la lista completa de entradas declarativas registradas hasta la fase actual.
 */
export function getSignCatalog() {
  return [
    ...BASE_SIGNS,
    ...NUMBER_SIGNS,
    ...STATIC_LETTER_SIGNS,
    ...DYNAMIC_LETTER_SIGNS,
  ];
}

export {
  BASE_SIGNS,
  NUMBER_SIGNS,
  STATIC_LETTER_SIGNS,
  DYNAMIC_LETTER_SIGNS,
  SIGN_CATEGORIES,
  SIGN_TYPES,
  CONFUSABLE_GROUPS,
  isValidSignEntry,
  scoreSign,
  scoreRange,
  matchCatalog,
  TRAJECTORY_TEMPLATES,
  normalizeTimedEntries,
  extractWindowMs,
  resampleTrajectory,
  matchTrajectoryTemplate,
  buildTrajectoryContext,
};
