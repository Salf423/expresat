export {
  LEARNING_CATEGORIES,
  ALL_LEARNING_SIGNS,
  ALL_LEARNING_SIGN_IDS,
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
