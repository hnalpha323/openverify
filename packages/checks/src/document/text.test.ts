import { describe, expect, it } from 'vitest';
import { documentTokens, foldDocumentToken, foldedPhrase } from './text.js';

describe('documentTokens', () => {
  it('cuts a line into words and numbers with their offsets in the line', () => {
    const tokens = documentTokens('Statement date: 30 September 2026');
    expect(tokens.map((token) => token.text)).toEqual([
      'Statement',
      'date',
      '30',
      'September',
      '2026',
    ]);
    expect(tokens.map((token) => token.folded)).toEqual([
      'statement',
      'date',
      '30',
      'september',
      '2026',
    ]);
    expect(tokens.map((token) => [token.start, token.end])).toEqual([
      [0, 9],
      [10, 14],
      [16, 18],
      [19, 28],
      [29, 33],
    ]);
  });

  it('splits at apostrophes, hyphens and other punctuation', () => {
    expect(documentTokens('Facture d’électricité').map((token) => token.folded)).toEqual([
      'facture',
      'd',
      'electricite',
    ]);
    expect(documentTokens('Form W-2 (Copy B)').map((token) => token.folded)).toEqual([
      'form',
      'w',
      '2',
      'copy',
      'b',
    ]);
  });

  it('reads only the first 300 code points of a line (C58.7)', () => {
    const tokens = documentTokens(`${'a '.repeat(150)}late word`);
    expect(tokens).toHaveLength(150);
    expect(tokens.every((token) => token.end <= 300)).toBe(true);
  });

  it('gives no token for a line of punctuation', () => {
    expect(documentTokens(' --- : ___ ')).toEqual([]);
  });

  it('folds each printed token once per map, so the lines of a document share the work (C58.7)', () => {
    const folds = new Map([['Balance', 'already-folded']]);

    const tokens = documentTokens('Balance B0ARD Balance', folds);

    expect(tokens.map((token) => token.folded)).toEqual([
      'already-folded',
      'board',
      'already-folded',
    ]);
    expect([...folds]).toEqual([
      ['Balance', 'already-folded'],
      ['B0ARD', 'board'],
    ]);
  });
});

describe('foldDocumentToken', () => {
  it.each([
    ['Zählerstand', 'zahlerstand'],
    ['Relevé', 'releve'],
    ['Straße', 'strasse'],
    ['NÓMINA', 'nomina'],
    ['m³', 'm3'],
    ['kWh', 'kwh'],
  ])('folds %s to %s', (token, folded) => {
    expect(foldDocumentToken(token)).toBe(folded);
  });

  it('reads 0, 1 and 5 as o, l and s inside a word of two letters or more', () => {
    expect(foldDocumentToken('B0ARD')).toBe('board');
    expect(foldDocumentToken('Ba1ance')).toBe('balance');
    expect(foldDocumentToken('5tatement')).toBe('statement');
  });

  it('keeps the digits of numbers and of codes with one letter', () => {
    expect(foldDocumentToken('1099')).toBe('1099');
    expect(foldDocumentToken('P60')).toBe('p60');
    expect(foldDocumentToken('m3')).toBe('m3');
  });
});

describe('foldedPhrase', () => {
  it('folds a lexicon phrase into the tokens it matches', () => {
    expect(foldedPhrase('Avis d’impôt')).toEqual(['avis', 'd', 'impot']);
    expect(foldedPhrase('Steuer-ID')).toEqual(['steuer', 'id']);
  });
});
