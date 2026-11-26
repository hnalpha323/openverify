import { describe, expect, it } from 'vitest';
import { AAMVA_IINS } from './aamva-iins.js';
import {
  US_DL_FORMAT_SOURCES,
  US_DL_NUMBER_FORMATS,
  usDriverLicenseNumberValid,
} from './us-dl-formats.js';

describe('US_DL_NUMBER_FORMATS (C33)', () => {
  it('has a grammar for each of the 50 states and DC, and names its sources', () => {
    const states = AAMVA_IINS.filter(
      (entry) => entry.country === 'US' && entry.code !== null,
    ).map((entry) => entry.code ?? '');
    const territories = ['AS', 'MP', 'PR', 'GU', 'VI'];
    expect(Object.keys(US_DL_NUMBER_FORMATS).sort()).toEqual(
      states.filter((code) => !territories.includes(code)).sort(),
    );
    expect(Object.keys(US_DL_NUMBER_FORMATS)).toHaveLength(51);
    for (const formats of Object.values(US_DL_NUMBER_FORMATS)) {
      expect(formats.length).toBeGreaterThan(0);
    }
    expect(US_DL_FORMAT_SOURCES.length).toBeGreaterThanOrEqual(2);
    for (const source of US_DL_FORMAT_SOURCES) {
      expect(source.url).toMatch(/^https:\/\//);
    }
  });

  it.each([
    ['CA', 'Y9876543'],
    ['CO', '987654321'],
    ['CO', 'A123456'],
    ['FL', 'A123456789012'],
    ['FL', 'A123-456-78-901-2'],
    ['IL', 'A12345678901'],
    ['NY', '123 456 789'],
    ['NY', 'ABCDEFGH'],
    ['TX', '12345678'],
    ['WA', 'WDLABCD456DG'],
    ['WA', 'SMITHJ*123AB'],
    ['NH', '12ABC34567'],
    ['MO', 'A123456R'],
    ['DC', '1234567'],
    ['WI', 'A1234567890123'],
    ['wy', '123456789'],
  ])('accepts the %s number %j', (state, number) => {
    expect(usDriverLicenseNumberValid(state, number)).toBe(true);
  });

  it.each([
    ['CA', '98765432'],
    ['CA', 'Y987654'],
    ['CO', 'ABC12'],
    ['FL', '1234567890123'],
    ['TX', 'A1234567'],
    ['PA', '1234567'],
    ['DC', '12345678'],
    ['WI', 'A123456789012'],
    ['CA', ''],
  ])('rejects the %s number %j', (state, number) => {
    expect(usDriverLicenseNumberValid(state, number)).toBe(false);
  });

  it.each(['ON', 'PR', 'ZZ', ''])('has no grammar for %j', (jurisdiction) => {
    expect(usDriverLicenseNumberValid(jurisdiction, '123456789')).toBeNull();
  });
});
