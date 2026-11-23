import { describe, it, expect } from 'vitest';
import {
  normalizeSearchText,
  filterCategorySigns,
  countCategorySignFilters,
  extractSignBadgeText,
} from '../catalogFilter.js';

const SAMPLE_SIGNS = [
  {
    id: 'letra_n',
    label: 'Letra N',
    displayName: 'Letra N',
    shortLabel: 'N',
    type: 'static',
    hint: 'Índice y medio hacia abajo',
  },
  {
    id: 'letra_enie',
    label: 'Letra Ñ',
    displayName: 'Letra Ñ',
    shortLabel: 'Ñ',
    type: 'dynamic',
    hint: 'Como N con movimiento lateral',
  },
  {
    id: 'adios',
    label: 'Adiós',
    displayName: 'Adiós',
    type: 'dynamic',
    hint: 'Despedida con mano abierta',
  },
  {
    id: 'si',
    label: 'Sí',
    displayName: 'Sí',
    type: 'dynamic',
    hint: 'Puño asintiendo arriba y abajo',
  },
];

describe('learning/catalogFilter — Búsqueda rápida y filtros del modal de categorías', () => {
  it('normaliza mayúsculas y acentos preservando la coincidencia con Ñ y vocales acentuadas', () => {
    expect(normalizeSearchText('Adiós')).toBe('adios');
    expect(normalizeSearchText('  SÍ  ')).toBe('si');
    expect(normalizeSearchText('Letra Ñ')).toBe('letra n');
    expect(normalizeSearchText('')).toBe('');
    expect(normalizeSearchText(null)).toBe('');
  });

  it('filtra señas por consulta de texto sin importar acentos ni mayúsculas', () => {
    const byAdios = filterCategorySigns(SAMPLE_SIGNS, { query: 'adios' });
    expect(byAdios.map((s) => s.id)).toEqual(['adios']);

    const byEnie = filterCategorySigns(SAMPLE_SIGNS, { query: 'ñ' });
    expect(byEnie.map((s) => s.id)).toEqual(['letra_enie']);

    const bySingleN = filterCategorySigns(SAMPLE_SIGNS, { query: 'n' });
    expect(bySingleN.map((s) => s.id)).toEqual(['letra_n', 'letra_enie']);

    const byHint = filterCategorySigns(SAMPLE_SIGNS, { query: 'lateral' });
    expect(byHint.map((s) => s.id)).toEqual(['letra_enie']);
  });

  it('filtra correctamente por tipo (static/dynamic) y pendientes según completedSet', () => {
    const completed = new Set(['letra_n', 'si']);

    expect(
      filterCategorySigns(SAMPLE_SIGNS, { filter: 'static', completedSet: completed }).map(
        (s) => s.id
      )
    ).toEqual(['letra_n']);

    expect(
      filterCategorySigns(SAMPLE_SIGNS, { filter: 'dynamic', completedSet: completed }).map(
        (s) => s.id
      )
    ).toEqual(['letra_enie', 'adios', 'si']);

    expect(
      filterCategorySigns(SAMPLE_SIGNS, { filter: 'pending', completedSet: completed }).map(
        (s) => s.id
      )
    ).toEqual(['letra_enie', 'adios']);

    expect(countCategorySignFilters(SAMPLE_SIGNS, completed)).toEqual({
      all: 4,
      static: 1,
      dynamic: 3,
      pending: 2,
    });
  });

  it('extrae glifo corto legible para tarjetas del abecedario', () => {
    expect(extractSignBadgeText(SAMPLE_SIGNS[1])).toBe('Ñ');
    expect(extractSignBadgeText({ displayName: 'Letra I', label: 'Letra I' })).toBe('I');
    expect(extractSignBadgeText({ displayName: 'Letra L · Lunes', label: 'Lunes' })).toBe('L');
  });
});
