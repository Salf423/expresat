export {
  LEARNING_CATEGORIES,
  ALL_LEARNING_SIGNS,
  ALL_LEARNING_SIGN_IDS,
  LEGACY_SIGN_ID_ALIASES,
  getLearningSignByLabel,
  getLearningSignById,
  getSignProfile,
} from './catalog.js';

export {
  FINGER_ORDER,
  FINGER_LABELS_ES,
  generateAnatomicalCorrection,
} from './anatomicalFeedback.js';

export {
  REPS_PER_HAND,
  DEFAULT_RELEASE_MS,
  DEFAULT_COOLDOWN_MS,
  normalizeHandSide,
  PracticeSessionMachine,
} from './practiceSession.js';

export {
  normalizeSearchText,
  extractSignBadgeText,
  countCategorySignFilters,
  filterCategorySigns,
} from './catalogFilter.js';

export {
  MIN_PRACTICE_PALM_SCALE,
  MAX_PRACTICE_PALM_SCALE,
  resolveTargetSign,
  evaluateDynamicMotion,
  evaluateTargetSign,
  TargetedPracticeEvaluator,
} from './targetEvaluator.js';

export {
  MAX_SPELL_NAME_LENGTH,
  DEFAULT_LETTER_STABLE_MS,
  DEFAULT_REPEAT_RELEASE_MS,
  DEFAULT_TRANSITION_COOLDOWN_MS,
  normalizeSpellName,
  letterToSignId,
  buildNameLetterTargets,
  SpellNameMachine,
} from './spellNameMachine.js';
