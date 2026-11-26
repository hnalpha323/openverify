import { describe, expect, it } from 'vitest';
import {
  ISO_ALPHA2_TO_ALPHA3,
  alpha3ToAlpha2,
  isIcaoIssuerCode,
  normalizeCountryCode,
} from './country-codes.js';
import { ISO3166_COUNTRIES } from './data/iso3166.js';

describe('country lookups from the generated table (C33)', () => {
  it('build ISO_ALPHA2_TO_ALPHA3 from ISO3166_COUNTRIES', () => {
    expect([...ISO_ALPHA2_TO_ALPHA3]).toEqual(
      ISO3166_COUNTRIES.map(([alpha2, alpha3]) => [alpha2, alpha3]),
    );
  });

  it.each([
    ['DEU', 'DE'],
    ['usa', 'US'],
    ['GBR', 'GB'],
    ['D', 'DE'],
    ['D<<', 'DE'],
    ['RKS', 'XK'],
    ['UTO', null],
    ['XXA', null],
    ['EUE', null],
    ['GBD', null],
    ['ZZZ', null],
    ['US', null],
    ['', null],
  ])('maps the issuer code %j to the alpha-2 code %j', (code, expected) => {
    expect(alpha3ToAlpha2(code)).toBe(expected);
  });

  it.each([
    ['DEU', true],
    ['D', true],
    ['D<', true],
    ['GBD', true],
    ['XXX', true],
    ['UNO', true],
    ['UTO', false],
    ['ZZZ', false],
    ['DE', false],
    ['', false],
  ])('knows whether %j is an ICAO issuer or nationality code (%j)', (code, expected) => {
    expect(isIcaoIssuerCode(code)).toBe(expected);
  });
});

describe('normalizeCountryCode', () => {
  it.each([
    ['US', 'USA'],
    ['us', 'USA'],
    [' GB ', 'GBR'],
    ['DE', 'DEU'],
    ['USA', 'USA'],
    ['deu', 'DEU'],
    // ICAO 9303-3 codes
    ['D', 'DEU'],
    ['D<<', 'DEU'],
    ['UTO', 'UTO'],
    ['XXA', 'XXA'],
    ['RKS', 'RKS'],
    ['XK', 'RKS'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeCountryCode(input)).toBe(expected);
  });

  it.each(['', 'ZZ', 'Q', '1A', 'USAA', 'U S', '<<<', 'É'])('rejects %j', (input) => {
    expect(normalizeCountryCode(input)).toBeNull();
  });
});

describe('ISO_ALPHA2_TO_ALPHA3', () => {
  it('pairs 249 ISO 3166-1 codes one to one', () => {
    const alpha3 = [...ISO_ALPHA2_TO_ALPHA3.values()];
    expect(ISO_ALPHA2_TO_ALPHA3.size).toBe(249);
    expect(new Set(alpha3).size).toBe(249);
    for (const [two, three] of ISO_ALPHA2_TO_ALPHA3) {
      expect(two).toMatch(/^[A-Z]{2}$/);
      expect(three).toMatch(/^[A-Z]{3}$/);
    }
  });

  it.each([
    ['FR', 'FRA'],
    ['JP', 'JPN'],
    ['ZA', 'ZAF'],
    ['SS', 'SSD'],
    ['CW', 'CUW'],
  ])('maps %s to %s', (two, three) => {
    expect(ISO_ALPHA2_TO_ALPHA3.get(two)).toBe(three);
  });
});
