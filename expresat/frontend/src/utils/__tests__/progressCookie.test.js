import { describe, it, expect } from 'vitest';
import {
  PROGRESS_COOKIE_NAME,
  PROGRESS_COOKIE_MAX_AGE_SECONDS,
  sanitizeSignId,
  parseCompletedSignsCookie,
  serializeCompletedSignsCookie,
  readCompletedSigns,
  writeCompletedSigns,
  markSignCompleted,
  clearCompletedSigns,
  computeProgressStats,
} from '../progressCookie.js';

function createMockDocument(initialCookie = '') {
  const jar = new Map();
  const writes = [];

  if (initialCookie) {
    for (const part of initialCookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
      }
    }
  }

  return {
    writes,
    get cookie() {
      return Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    set cookie(raw) {
      writes.push(raw);
      const firstSemi = raw.indexOf(';');
      const pair = firstSemi >= 0 ? raw.slice(0, firstSemi) : raw;
      const eq = pair.indexOf('=');
      if (eq <= 0) return;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0/i.test(raw)) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
    },
  };
}

describe('utils/progressCookie — Persistencia segura de señas completadas en cookie', () => {
  it('devuelve lista vacía cuando no existe la cookie o el entorno no tiene document', () => {
    expect(parseCompletedSignsCookie('')).toEqual([]);
    expect(parseCompletedSignsCookie('theme=dark; session=abc123')).toEqual([]);
    expect(readCompletedSigns(null, createMockDocument(''))).toEqual([]);
    expect(readCompletedSigns(null, null)).toEqual([]);
  });

  it('serializa con path=/, SameSite=Lax y expiración de 1 año (31536000s)', () => {
    const fixedNow = new Date('2026-11-23T12:00:00.000Z');
    const serialized = serializeCompletedSignsCookie(['uno', 'dos', 'uno'], { now: fixedNow });

    expect(serialized).toContain(`${PROGRESS_COOKIE_NAME}=`);
    expect(serialized).toContain('path=/');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain(`max-age=${PROGRESS_COOKIE_MAX_AGE_SECONDS}`);
    expect(PROGRESS_COOKIE_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
    expect(serialized).toContain('expires=Tue, 23 Nov 2027 12:00:00 GMT');

    // Roundtrip parsing restores deduplicated sanitized IDs
    expect(parseCompletedSignsCookie(serialized)).toEqual(['uno', 'dos']);
  });

  it('escribe, lee y actualiza señas completadas en document.cookie sin duplicados', () => {
    const mockDoc = createMockDocument('other_pref=light');

    const written = writeCompletedSigns(['uno', 'tres'], { doc: mockDoc });
    expect(written).toEqual(['uno', 'tres']);
    expect(mockDoc.writes).toHaveLength(1);
    expect(mockDoc.writes[0]).toContain('path=/');
    expect(mockDoc.writes[0]).toContain('SameSite=Lax');
    expect(mockDoc.writes[0]).toContain('max-age=31536000');

    expect(readCompletedSigns(null, mockDoc)).toEqual(['uno', 'tres']);

    const afterAdd = markSignCompleted('hola', { doc: mockDoc });
    expect(afterAdd).toEqual(['uno', 'tres', 'hola']);
    expect(readCompletedSigns(null, mockDoc)).toEqual(['uno', 'tres', 'hola']);

    // Idempotent when already completed
    const afterDup = markSignCompleted('uno', { doc: mockDoc });
    expect(afterDup).toEqual(['uno', 'tres', 'hola']);
  });

  it('sanitiza IDs inválidos y resiste cookies corruptas o manipuladas sin lanzar excepciones', () => {
    expect(sanitizeSignId('Letra_I')).toBe('letra_i');
    expect(sanitizeSignId('  te_quiero ')).toBe('te_quiero');
    expect(sanitizeSignId('<script>alert(1)</script>')).toBeNull();
    expect(sanitizeSignId('uno; path=/evil')).toBeNull();
    expect(sanitizeSignId('')).toBeNull();
    expect(sanitizeSignId(123)).toBeNull();

    // Malformed URI sequence
    expect(parseCompletedSignsCookie(`${PROGRESS_COOKIE_NAME}=%E0%A4%A`)).toEqual([]);
    // Malformed JSON
    expect(parseCompletedSignsCookie(`${PROGRESS_COOKIE_NAME}=%7Bbad-json`)).toEqual([]);
    // Non-array JSON
    expect(
      parseCompletedSignsCookie(`${PROGRESS_COOKIE_NAME}=${encodeURIComponent('{"uno":true}')}`)
    ).toEqual([]);
    // Mixed valid and malicious entries
    const mixed = encodeURIComponent(
      JSON.stringify(['uno', '<img src=x>', 'dos;evil', 'hola', null, 42, 'UNO'])
    );
    expect(parseCompletedSignsCookie(`${PROGRESS_COOKIE_NAME}=${mixed}`)).toEqual(['uno', 'hola']);

    // Filtering against valid catalog IDs
    const validIds = new Set(['uno', 'dos']);
    expect(parseCompletedSignsCookie(`${PROGRESS_COOKIE_NAME}=${mixed}`, validIds)).toEqual([
      'uno',
    ]);
  });

  it('limpia la cookie correctamente y calcula estadísticas de progreso global', () => {
    const mockDoc = createMockDocument('');
    writeCompletedSigns(['uno', 'dos', 'tres'], { doc: mockDoc });
    expect(readCompletedSigns(null, mockDoc)).toEqual(['uno', 'dos', 'tres']);

    clearCompletedSigns({ doc: mockDoc });
    expect(readCompletedSigns(null, mockDoc)).toEqual([]);
    expect(mockDoc.writes[mockDoc.writes.length - 1]).toContain('max-age=0');
    expect(mockDoc.writes[mockDoc.writes.length - 1]).toContain('path=/');
    expect(mockDoc.writes[mockDoc.writes.length - 1]).toContain('SameSite=Lax');

    const stats = computeProgressStats(['uno', 'dos', 'tres', 'uno'], [
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
    ]);
    expect(stats).toEqual({
      completedCount: 3,
      totalCount: 10,
      percentage: 30,
    });
    expect(computeProgressStats([], [])).toEqual({
      completedCount: 0,
      totalCount: 0,
      percentage: 0,
    });
  });
});
