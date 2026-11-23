/**
 * Browser cookie persistence for completed LSM signs in `Learn.jsx`.
 *
 * Uses `document.cookie` with `path=/`, `SameSite=Lax`, and 1-year expiration,
 * with strict ID sanitization and fault-tolerant JSON/URI parsing.
 */

export const PROGRESS_COOKIE_NAME = 'expresat_completed_signs';
export const PROGRESS_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // 1 year
const MAX_STORED_SIGNS = 200;
const VALID_SIGN_ID_PATTERN = /^[a-z0-9_-]{1,40}$/;

/**
 * Legacy ID aliases automatically mapped when validating against an expanded catalog
 * so prior progress cookies remain intact when a sign ID is standardized (e.g. `lunes` -> `letra_l`).
 */
export const DEFAULT_LEGACY_SIGN_ID_ALIASES = Object.freeze({
  lunes: 'letra_l',
});

function resolveDocument(docOverride) {
  if (docOverride !== undefined) return docOverride;
  return typeof document !== 'undefined' ? document : null;
}

function toAllowedSet(validIds) {
  if (!validIds) return null;
  if (validIds instanceof Set) return validIds;
  if (Array.isArray(validIds)) return new Set(validIds);
  return null;
}

/**
 * Sanitizes a sign identifier into canonical lowercase slug format.
 * Rejects control characters, HTML, cookie delimiters, and oversized values.
 *
 * @param {unknown} rawId
 * @returns {string|null}
 */
export function sanitizeSignId(rawId) {
  if (typeof rawId !== 'string') return null;
  const normalized = rawId.trim().toLowerCase();
  if (!VALID_SIGN_ID_PATTERN.test(normalized)) return null;
  return normalized;
}

function resolveCanonicalId(cleanId, allowed, aliases = DEFAULT_LEGACY_SIGN_ID_ALIASES) {
  if (!cleanId) return null;
  if (!allowed) return cleanId;
  if (allowed.has(cleanId)) return cleanId;
  if (aliases && typeof aliases === 'object') {
    const mapped = sanitizeSignId(aliases[cleanId]);
    if (mapped && allowed.has(mapped)) {
      return mapped;
    }
  }
  return null;
}

function normalizeSignList(ids, validIds = null, aliases = DEFAULT_LEGACY_SIGN_ID_ALIASES) {
  if (!Array.isArray(ids)) return [];
  const allowed = toAllowedSet(validIds);
  const seen = new Set();
  const out = [];

  for (let i = 0; i < ids.length && out.length < MAX_STORED_SIGNS; i++) {
    const clean = sanitizeSignId(ids[i]);
    if (!clean) continue;
    const resolved = resolveCanonicalId(clean, allowed, aliases);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }

  return out;
}

/**
 * Safely parses completed sign IDs from a raw `document.cookie` string.
 * Never throws on malformed URI sequences, invalid JSON, or unexpected types.
 *
 * @param {string} cookieString
 * @param {Set<string>|Array<string>|null} [validIds=null]
 * @returns {string[]}
 */
export function parseCompletedSignsCookie(cookieString, validIds = null) {
  if (typeof cookieString !== 'string' || !cookieString.trim()) {
    return [];
  }

  const pairs = cookieString.split(';');
  let rawValue = null;

  for (let i = 0; i < pairs.length; i++) {
    const part = pairs[i].trim();
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = part.slice(0, eqIdx).trim();
    if (name === PROGRESS_COOKIE_NAME) {
      rawValue = part.slice(eqIdx + 1).trim();
      break;
    }
  }

  if (!rawValue) return [];

  try {
    const decoded = decodeURIComponent(rawValue);
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return normalizeSignList(parsed, validIds);
  } catch {
    return [];
  }
}

/**
 * Serializes a list of completed sign IDs into a `document.cookie` assignment string
 * with `path=/`, `SameSite=Lax`, and 1-year expiration.
 *
 * @param {string[]} signIds
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {Set<string>|Array<string>|null} [options.validIds]
 * @param {boolean} [options.secure]
 * @returns {string}
 */
export function serializeCompletedSignsCookie(signIds, options = {}) {
  const { now = new Date(), validIds = null, secure = false } = options;
  const cleanIds = normalizeSignList(signIds, validIds);
  const encoded = encodeURIComponent(JSON.stringify(cleanIds));
  const expiresDate = new Date(now.getTime() + PROGRESS_COOKIE_MAX_AGE_SECONDS * 1000);
  const parts = [
    `${PROGRESS_COOKIE_NAME}=${encoded}`,
    'path=/',
    `max-age=${PROGRESS_COOKIE_MAX_AGE_SECONDS}`,
    `expires=${expiresDate.toUTCString()}`,
    'SameSite=Lax',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Reads completed sign IDs from `document.cookie`.
 *
 * @param {Set<string>|Array<string>|null} [validIds=null]
 * @param {Document|null} [docOverride]
 * @returns {string[]}
 */
export function readCompletedSigns(validIds = null, docOverride = undefined) {
  const doc = resolveDocument(docOverride);
  if (!doc || typeof doc.cookie !== 'string') return [];
  return parseCompletedSignsCookie(doc.cookie, validIds);
}

/**
 * Writes sanitized completed sign IDs to `document.cookie` and returns the persisted list.
 *
 * @param {string[]} signIds
 * @param {Object} [options]
 * @param {Set<string>|Array<string>|null} [options.validIds]
 * @param {Date} [options.now]
 * @param {Document|null} [options.doc]
 * @returns {string[]}
 */
export function writeCompletedSigns(signIds, options = {}) {
  const { validIds = null, now = new Date(), doc: docOverride = undefined } = options;
  const cleanIds = normalizeSignList(signIds, validIds);
  const doc = resolveDocument(docOverride);
  if (!doc) return cleanIds;

  const isHttps =
    typeof window !== 'undefined' && window.location?.protocol === 'https:';
  try {
    doc.cookie = serializeCompletedSignsCookie(cleanIds, {
      now,
      validIds,
      secure: isHttps,
    });
  } catch {
    // Non-fatal in restricted storage contexts
  }
  return cleanIds;
}

/**
 * Marks a single sign ID as completed in the browser progress cookie (idempotent).
 * Preserves all previously saved cookie IDs even when the active catalog (`validIds`)
 * expands or changes, avoiding accidental erasure of prior user progress.
 *
 * @param {string} signId
 * @param {Object} [options]
 * @param {Set<string>|Array<string>|null} [options.validIds]
 * @param {Record<string, string>} [options.aliases]
 * @param {Date} [options.now]
 * @param {Document|null} [options.doc]
 * @returns {string[]}
 */
export function markSignCompleted(signId, options = {}) {
  const {
    validIds = null,
    aliases = DEFAULT_LEGACY_SIGN_ID_ALIASES,
    now = new Date(),
    doc: docOverride = undefined,
  } = options;
  const allowed = toAllowedSet(validIds);
  const rawExisting = readCompletedSigns(null, docOverride);
  const filteredExisting = normalizeSignList(rawExisting, allowed, aliases);

  const clean = sanitizeSignId(signId);
  if (!clean) return filteredExisting;

  const resolvedNew = resolveCanonicalId(clean, allowed, aliases);
  if (!resolvedNew) return filteredExisting;

  if (filteredExisting.includes(resolvedNew)) {
    return filteredExisting;
  }

  // Merge non-destructively so prior cookie entries are never wiped out on catalog expansion
  const mergedRaw = rawExisting.includes(resolvedNew)
    ? rawExisting
    : [...rawExisting, resolvedNew];
  writeCompletedSigns(mergedRaw, { validIds: null, now, doc: docOverride });

  return normalizeSignList(mergedRaw, allowed, aliases);
}

/**
 * Clears the progress cookie from the browser.
 *
 * @param {Object} [options]
 * @param {Document|null} [options.doc]
 */
export function clearCompletedSigns(options = {}) {
  const doc = resolveDocument(options.doc);
  if (!doc) return;
  try {
    doc.cookie = `${PROGRESS_COOKIE_NAME}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  } catch {
    // Ignore storage write failure
  }
}

/**
 * Computes global learning progress stats (`completedCount / totalCount` and integer percentage).
 *
 * @param {string[]} completedIds
 * @param {string[]} totalIds
 * @returns {{ completedCount: number, totalCount: number, percentage: number }}
 */
export function computeProgressStats(completedIds, totalIds) {
  const catalogSet = new Set(normalizeSignList(Array.isArray(totalIds) ? totalIds : []));
  const totalCount = catalogSet.size;
  if (totalCount === 0) {
    return { completedCount: 0, totalCount: 0, percentage: 0 };
  }
  const completedClean = normalizeSignList(
    Array.isArray(completedIds) ? completedIds : [],
    catalogSet
  );
  const completedCount = completedClean.length;
  const percentage = Math.round((completedCount / totalCount) * 100);
  return { completedCount, totalCount, percentage };
}
