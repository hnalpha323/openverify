import { describe, expect, it } from 'vitest';
import { AAMVA_IINS, AAMVA_IIN_SOURCE, aamvaIssuerOf } from './aamva-iins.js';

describe('AAMVA_IINS (C33)', () => {
  it('names its source page, the retrieval date and the Colorado correction', () => {
    expect(AAMVA_IIN_SOURCE.url).toBe('https://aamva.org/identity/issuer-identification-numbers-(iin)');
    expect(AAMVA_IIN_SOURCE.retrieved).toMatch(/^2026-10-\d{2}$/);
    expect(AAMVA_IIN_SOURCE.corrections.join(' ')).toMatch(/636020.*GM.*CO/);
  });

  it('holds the 72 IINs: 57 US, 13 Canadian and 2 Mexican, each a unique six-digit number', () => {
    expect(AAMVA_IINS).toHaveLength(72);
    expect(new Set(AAMVA_IINS.map((entry) => entry.iin)).size).toBe(72);
    const count = (country: string) => AAMVA_IINS.filter((entry) => entry.country === country);
    expect(count('US')).toHaveLength(57);
    expect(count('CA')).toHaveLength(13);
    expect(count('MX')).toHaveLength(2);
    for (const entry of AAMVA_IINS) {
      expect(entry.iin).toMatch(/^(604|636)\d{3}$/);
      expect(entry.code === null || /^[A-Z]{2}$/.test(entry.code), entry.iin).toBe(true);
    }
  });

  it('runs from 604426 to 636062, sorted', () => {
    const iins = AAMVA_IINS.map((entry) => entry.iin);
    expect(iins).toEqual([...iins].sort());
    expect(iins[0]).toBe('604426');
    expect(iins.at(-1)).toBe('636062');
  });

  it('covers the 50 states and the District of Columbia', () => {
    const states = new Set(
      AAMVA_IINS.filter((entry) => entry.country === 'US').map((entry) => entry.code),
    );
    for (const code of ['AL', 'AK', 'CA', 'CO', 'DC', 'NY', 'TX', 'WA', 'WY', 'HI']) {
      expect(states.has(code), code).toBe(true);
    }
  });

  it.each([
    ['636014', 'California', 'CA', 'US'],
    ['636020', 'Colorado', 'CO', 'US'],
    ['636043', 'District of Columbia', 'DC', 'US'],
    ['636012', 'Ontario', 'ON', 'CA'],
    ['636056', 'Coahuila', 'CU', 'MX'],
    ['604426', 'Prince Edward Island', 'PE', 'CA'],
  ])('maps %s to %s (%s, %s)', (iin, jurisdiction, code, country) => {
    expect(aamvaIssuerOf(iin)).toEqual({ iin, jurisdiction, code, country });
  });

  it('keeps the State Department row without an abbreviation, as listed', () => {
    expect(aamvaIssuerOf('636027')).toMatchObject({ code: null, country: 'US' });
  });

  it.each(['636063', '000000', '63601', 'abcdef', ''])('knows no issuer %j', (iin) => {
    expect(aamvaIssuerOf(iin)).toBeNull();
  });
});
