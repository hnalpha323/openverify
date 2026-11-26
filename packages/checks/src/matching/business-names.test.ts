import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../document/testing.js';
import { matchBusinessNames } from './business-names.js';

describe('matchBusinessNames (C58.6)', () => {
  it.each([
    ['Quillon Widgets Inc', 'QUILLON WIDGETS, INC.', ['remove_special_characters']],
    ['Quillon Widgets Incorporated', 'Quillon Widgets Inc', []],
    ['Quillon Widgets', 'Quillon Widgets Ltd', ['remove_suffixes']],
    ['The Quillon Company', 'Quillon Company', ['remove_prefixes']],
    ['Vellacott & Ostrander Ltd', 'Vellacott and Ostrander Limited', ['remove_special_characters']],
    ['Quillon Widgets GmbH', 'Quillon Widgets G.m.b.H.', ['remove_special_characters']],
    ['Lanternwerk Müller GmbH', 'Lanternwerk Mueller GmbH', ['fold_characters']],
  ])('%j and %j are full', (a, b, methods) => {
    expect(matchBusinessNames(a, b)).toEqual({ level: 'full', methods, flags: [] });
  });

  it('different legal forms cap the level at partial', () => {
    expect(matchBusinessNames('Quillon Widgets Inc', 'Quillon Widgets LLC')).toEqual({
      level: 'partial',
      methods: [],
      flags: ['legal-form-mismatch'],
    });
  });

  it.each([
    ['Quillon Widget Ltd', 'Quillon Widgets Ltd', ['string_similarity']],
    ['QuillonWidgets', 'Quillon Widgets', ['tokenization']],
    ['Quillon Widgets', 'Quillon Widgets International', ['tokenization']],
    ['Quillon', 'Quillon Holdings Ltd', ['remove_suffixes', 'tokenization']],
  ])('%j and %j are partial', (a, b, methods) => {
    expect(matchBusinessNames(a, b)).toEqual({ level: 'partial', methods, flags: [] });
  });

  it('another name is none', () => {
    expect(matchBusinessNames('Quillon Widgets Ltd', 'Zenith Lanterns Ltd')).toEqual({
      level: 'none',
      methods: [],
      flags: [],
    });
  });

  it('is missing without a name, or across writing systems', () => {
    expect(matchBusinessNames(null, 'Quillon Widgets').level).toBe('missing');
    expect(matchBusinessNames('Квиллон', 'Quillon')).toEqual({
      level: 'missing',
      methods: [],
      flags: ['script-mismatch'],
    });
  });

  it('is symmetric', () => {
    for (const [a, b] of [
      ['Quillon Widgets', 'Quillon Widgets Ltd'],
      ['Quillon Widgets Inc', 'Quillon Widgets LLC'],
      ['Quillon', 'Quillon Holdings Ltd'],
    ] as const) {
      expect(matchBusinessNames(a, b)).toEqual(matchBusinessNames(b, a));
    }
  });

  it('compares 100 KB of near-matching input in bounded time (C58.7)', () => {
    const long = 'Quillon Widgets Ltd '.repeat(5_000);
    expect(
      cpuMilliseconds(() => {
        matchBusinessNames(long, 'Quillon Widgets Ltd');
      }),
    ).toBeLessThan(200);
  });
});
