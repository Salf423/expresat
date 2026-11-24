import { describe, it, expect } from 'vitest';
import {
  normalizeSpanishText,
  sequenceTextToSigns,
  getDirectSignVocabulary,
} from '../textToSignSequencer.js';

describe('recognition/textToSignSequencer — Traductor inverso Texto/Voz -> LSM', () => {
  it('normaliza acentos, mayúsculas y puntuación preservando la Ñ (NFC y NFD)', () => {
    expect(normalizeSpanishText('  ¡Hola, Buenos Días!  ')).toBe('¡hola, buenos dias!');
    expect(normalizeSpanishText('Ñandú y Baño en México')).toBe('ñandu y baño en mexico');
    // NFD decomposed 'n' + combining tilde (\u0303) must remain 'ñ'
    expect(normalizeSpanishText('Nin\u0303o ping\u00fcino')).toBe('niño pinguino');
    expect(normalizeSpanishText('')).toBe('');
    expect(normalizeSpanishText(null)).toBe('');
  });

  it('empareja frases compuestas antes que palabras individuales (ej. "por favor", "buenos días", "mucho gusto")', () => {
    const seq = sequenceTextToSigns('¡Hola! Buenos días, por favor, mucho gusto y gracias.');
    expect(seq.steps.map((s) => s.signId)).toEqual([
      'hola',
      'buenos_dias',
      'por_favor',
      'mucho_gusto',
      'letra_y',
      'gracias',
    ]);
    expect(seq.steps[0].matchType).toBe('word');
    expect(seq.steps[1].matchType).toBe('phrase');
    expect(seq.steps[2].matchType).toBe('phrase');
    expect(seq.steps[3].matchType).toBe('phrase');
    expect(seq.steps[4].matchType).toBe('spell');
    expect(seq.steps[5].matchType).toBe('word');
    expect(seq.stats.directMatches).toBe(5);
    expect(seq.stats.spelledLetters).toBe(1);
  });

  it('empareja números del 0 al 10 por palabra o dígito y deletrea cifras mayores dígito a dígito', () => {
    const seq = sequenceTextToSigns('uno 5 diez 24');
    expect(seq.steps.map((s) => s.signId)).toEqual(['uno', 'cinco', 'diez', 'dos', 'cuatro']);
    expect(seq.steps[0].matchType).toBe('number');
    expect(seq.steps[1].matchType).toBe('number');
    expect(seq.steps[2].matchType).toBe('number');
    expect(seq.steps[3].matchType).toBe('spell');
    expect(seq.steps[4].matchType).toBe('spell');
  });

  it('deletrea automáticamente palabras desconocidas letra por letra incluyendo Ñ y tildes', () => {
    const seq = sequenceTextToSigns('Hola, Niño José');
    expect(seq.steps.map((s) => s.signId)).toEqual([
      'hola',
      'letra_n',
      'letra_i',
      'letra_enie',
      'letra_o',
      'letra_j',
      'letra_o',
      'letra_s',
      'letra_e',
    ]);

    const enieStep = seq.steps[3];
    expect(enieStep.shortLabel).toBe('Ñ');
    expect(enieStep.matchType).toBe('spell');
    expect(enieStep.sourceToken).toBe('Niño');
    expect(enieStep.wordPosition).toEqual({ index: 2, total: 4 });
    expect(enieStep.type).toBe('dynamic');
    expect(enieStep.instructions.length).toBeGreaterThan(20);
    expect(enieStep.postureSummary.length).toBeGreaterThan(0);

    expect(seq.stats).toEqual({
      totalSteps: 9,
      directMatches: 1,
      spelledLetters: 8,
      spelledWords: 2,
    });
  });

  it('reconoce palabras del catálogo con acento o Ñ sin deletrearlas (Sí, Más, Perdón, Adiós, Baño)', () => {
    const seq = sequenceTextToSigns('Sí, más perdón, baño, adiós');
    expect(seq.steps.map((s) => s.signId)).toEqual(['si', 'mas', 'perdon', 'bano', 'adios']);
    expect(seq.stats.directMatches).toBe(5);
    expect(seq.stats.spelledWords).toBe(0);
  });

  it('maneja cadenas vacías o solo símbolos sin lanzar errores', () => {
    const empty = sequenceTextToSigns('   ');
    expect(empty.steps).toEqual([]);
    expect(empty.stats.totalSteps).toBe(0);

    const symbolsOnly = sequenceTextToSigns('... ¡¿?! ---');
    expect(symbolsOnly.steps).toEqual([]);
    expect(getDirectSignVocabulary().length).toBeGreaterThan(35);
  });
});
