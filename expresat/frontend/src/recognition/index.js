export {
  HAND_LANDMARKS,
  isValidPoint,
  isValidHandLandmarks,
  distance3D,
  distance2D,
  distanceRobust,
  palmScale,
  angleBetweenVectorsDeg,
  jointAngleDeg,
  normalizeHand,
  extractHandOrientation,
  canonicalizeHand,
  fingerStates,
} from './geometry.js';

export {
  SIGN_LABELS,
  extractHandWithMeta,
  extractHandFromFrame,
  classifyStaticHand,
  detectWaveMotion,
  SmoothingVoter,
  Classifier,
  GeometricClassifier,
  ModelClassifier,
  classify,
} from './classifier.js';

export {
  getSignCatalog,
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
} from './signs/index.js';

export {
  buildSyntheticHand,
  SYNTHETIC_PRESETS,
  SYNTHETIC_NUMBERS,
} from './syntheticHand.js';
