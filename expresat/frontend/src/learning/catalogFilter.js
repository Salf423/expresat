/**
 * Pure search & filter helpers for the category sign selection modal in `Learn.jsx`.
 * Accent-insensitive and supports explicit Spanish `ñ` queries as well as unaccented lookups.
 */

/**
 * Normalizes text for accent-insensitive search (`Adiós` -> `adios`, `Ñ` -> `n`).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Extracts a short display glyph for alphabet tiles (e.g. `"Letra Ñ"` -> `"Ñ"`).
 *
 * @param {Object} sign
 * @returns {string}
 */
export function extractSignBadgeText(sign) {
  if (!sign || typeof sign !== 'object') return '';
  if (typeof sign.shortLabel === 'string' && sign.shortLabel.trim()) {
    return sign.shortLabel.trim();
  }
  const source = String(sign.displayName || sign.label || '').trim();
  const match = source.match(/^Letra\s+([A-ZÑ])/i);
  if (match) return match[1].toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * Counts signs per filter pill inside a category modal.
 *
 * @param {Array<Object>} signs
 * @param {Set<string>} [completedSet]
 * @returns {{ all: number, static: number, dynamic: number, pending: number }}
 */
export function countCategorySignFilters(signs, completedSet = new Set()) {
  const list = Array.isArray(signs) ? signs : [];
  let staticCount = 0;
  let dynamicCount = 0;
  let pendingCount = 0;

  for (let i = 0; i < list.length; i++) {
    const sign = list[i];
    if (sign.type === 'dynamic') {
      dynamicCount++;
    } else {
      staticCount++;
    }
    if (!completedSet.has(sign.id)) {
      pendingCount++;
    }
  }

  return {
    all: list.length,
    static: staticCount,
    dynamic: dynamicCount,
    pending: pendingCount,
  };
}

/**
 * Filters a category's signs by quick search query and active filter pill.
 * If the user explicitly types `ñ`, prioritizes exact `ñ` matches over plain `n`.
 *
 * @param {Array<Object>} signs
 * @param {Object} [options]
 * @param {string} [options.query='']
 * @param {'all'|'static'|'dynamic'|'pending'} [options.filter='all']
 * @param {Set<string>} [options.completedSet]
 * @returns {Array<Object>}
 */
export function filterCategorySigns(
  signs,
  { query = '', filter = 'all', completedSet = new Set() } = {}
) {
  const list = Array.isArray(signs) ? signs : [];
  const rawTrimmed = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const hasExplicitEnie = rawTrimmed.includes('ñ');
  const normalizedQuery = normalizeSearchText(rawTrimmed);

  return list.filter((sign) => {
    if (filter === 'static' && sign.type === 'dynamic') return false;
    if (filter === 'dynamic' && sign.type !== 'dynamic') return false;
    if (filter === 'pending' && completedSet.has(sign.id)) return false;

    if (!normalizedQuery) return true;

    // Single-character search (e.g. "a" or "ñ" in the 27-letter alphabet):
    // match the letter glyph or start of a word in displayName/label so hints
    // containing common vowels don't return every single card.
    if (rawTrimmed.length === 1) {
      const primaryRaw = [sign.shortLabel, sign.displayName, sign.label]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const tokens = primaryRaw.split(/[\s·\-_/()]+/).filter(Boolean);
      if (hasExplicitEnie) {
        return tokens.some((tok) => tok === rawTrimmed || tok.startsWith(rawTrimmed));
      }
      const normTokens = tokens.map((tok) => normalizeSearchText(tok));
      return normTokens.some(
        (tok) => tok === normalizedQuery || tok.startsWith(normalizedQuery)
      );
    }

    const rawHaystack = [sign.displayName, sign.label, sign.shortLabel, sign.hint, sign.meaning]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (hasExplicitEnie) {
      return rawHaystack.includes(rawTrimmed);
    }

    const normalizedHaystack = normalizeSearchText(rawHaystack);
    return normalizedHaystack.includes(normalizedQuery);
  });
}
