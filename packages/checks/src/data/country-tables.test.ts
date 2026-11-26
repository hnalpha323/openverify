import { describe, expect, it } from 'vitest';
import { ICAO_CODES_SOURCE, ICAO_PART3_SECTION5_CODES } from './icao-codes.js';
import { ISO3166_COUNTRIES, ISO3166_SOURCE } from './iso3166.js';

describe('ISO3166_COUNTRIES (generated from iso3166, C33)', () => {
  it('names its generator source and licence', () => {
    expect(ISO3166_SOURCE).toEqual({ package: 'iso3166', version: '3.0.0', license: 'MIT' });
  });

  it('holds the 249 ISO 3166-1 entries, each code unique and well formed', () => {
    expect(ISO3166_COUNTRIES).toHaveLength(249);
    for (const index of [0, 1, 2] as const) {
      expect(new Set(ISO3166_COUNTRIES.map((entry) => entry[index])).size).toBe(249);
    }
    for (const [alpha2, alpha3, numeric] of ISO3166_COUNTRIES) {
      expect(alpha2).toMatch(/^[A-Z]{2}$/);
      expect(alpha3).toMatch(/^[A-Z]{3}$/);
      expect(numeric).toMatch(/^\d{3}$/);
    }
  });

  it('is sorted by alpha-2 code', () => {
    const codes = ISO3166_COUNTRIES.map(([alpha2]) => alpha2);
    expect(codes).toEqual([...codes].sort());
  });

  it.each([
    ['DE', 'DEU', '276'],
    ['GB', 'GBR', '826'],
    ['US', 'USA', '840'],
    ['SS', 'SSD', '728'],
    ['CW', 'CUW', '531'],
    ['AX', 'ALA', '248'],
  ])('pairs %s with %s and %s', (alpha2, alpha3, numeric) => {
    expect(ISO3166_COUNTRIES).toContainEqual([alpha2, alpha3, numeric]);
  });

  it('leaves out the user-assigned XK (Kosovo), which ICAO writes RKS', () => {
    expect(ISO3166_COUNTRIES.some(([alpha2]) => alpha2 === 'XK')).toBe(false);
  });
});

describe('ICAO_PART3_SECTION5_CODES (C33)', () => {
  it('cites ICAO Doc 9303 Part 3 §5', () => {
    expect(ICAO_CODES_SOURCE.citation).toMatch(/Doc 9303.*Part 3.*§5/);
    expect(ICAO_CODES_SOURCE.url).toMatch(/^https:\/\/www\.icao\.int\/.*9303_p3/);
  });

  it('lists the 26 codes, by part', () => {
    const byPart = (part: string) =>
      ICAO_PART3_SECTION5_CODES.filter((entry) => entry.part === part).map((entry) => entry.code);
    expect(byPart('A')).toEqual(['D', 'GBD', 'GBN', 'GBO', 'GBP', 'GBS', 'RKS']);
    expect(byPart('B')).toEqual(['EUE']);
    expect(byPart('C')).toEqual(['UNO', 'UNA', 'UNK']);
    expect(byPart('D')).toEqual([
      'XBA',
      'XIM',
      'XCC',
      'XCE',
      'XCO',
      'XEC',
      'XPO',
      'XES',
      'XMP',
      'XOM',
      'XDC',
    ]);
    expect(byPart('E')).toEqual(['XXA', 'XXB', 'XXC', 'XXX']);
    expect(ICAO_PART3_SECTION5_CODES).toHaveLength(26);
  });

  it('describes each code and gives an alpha-2 code only to Germany and Kosovo', () => {
    for (const entry of ICAO_PART3_SECTION5_CODES) {
      expect(entry.description.length, entry.code).toBeGreaterThan(3);
    }
    expect(
      ICAO_PART3_SECTION5_CODES.filter((entry) => entry.alpha2 !== null).map((entry) => [
        entry.code,
        entry.alpha2,
      ]),
    ).toEqual([
      ['D', 'DE'],
      ['RKS', 'XK'],
    ]);
  });

  it('never repeats an ISO alpha-3 code', () => {
    const iso = new Set(ISO3166_COUNTRIES.map(([, alpha3]) => alpha3));
    for (const entry of ICAO_PART3_SECTION5_CODES) {
      expect(iso.has(entry.code), entry.code).toBe(false);
    }
  });
});
