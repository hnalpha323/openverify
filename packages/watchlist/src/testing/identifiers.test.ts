import { describe, expect, it } from 'vitest';
import {
  imoCheckDigit,
  isValidImo,
  isValidLei,
  leiCheckDigits,
  syntheticAircraftSerial,
  syntheticAircraftTail,
  syntheticBic,
  syntheticDomain,
  syntheticImo,
  syntheticLei,
  syntheticMmsi,
  syntheticNationalId,
  syntheticPassportNumber,
  syntheticRegistrationNumber,
  syntheticTaxId,
} from './identifiers.js';
import { seededRandom } from './random.js';

describe('LEI (ISO 17442)', () => {
  it('computes the MOD 97-10 check digits the plan’s sandbox LEI carries', () => {
    expect(leiCheckDigits('5299000SANDBOXLEI0')).toBe('47');
    expect(isValidLei('5299000SANDBOXLEI047')).toBe(true);
  });

  it('refuses a changed character, a wrong length or a lower-case LEI', () => {
    expect(isValidLei('5299000SANDBOXLEI048')).toBe(false);
    expect(isValidLei('5299000SANDBOXLEJ047')).toBe(false);
    expect(isValidLei('5299000SANDBOXLEI04')).toBe(false);
    expect(isValidLei('5299000sandboxlei047')).toBe(false);
    expect(() => leiCheckDigits('SHORT')).toThrow(RangeError);
  });

  it('generates valid synthetic LEIs under the fictional SYNT prefix', () => {
    const random = seededRandom('lei');
    for (let index = 0; index < 200; index += 1) {
      const lei = syntheticLei(random);
      expect(lei).toMatch(/^SYNT00[\dA-Z]{12}\d{2}$/);
      expect(isValidLei(lei)).toBe(true);
    }
  });
});

describe('IMO numbers', () => {
  it('computes the check digit the plan’s sandbox IMO carries', () => {
    expect(imoCheckDigit('999999')).toBe(3);
    expect(isValidImo('9999993')).toBe(true);
    expect(isValidImo('9999994')).toBe(false);
    expect(isValidImo('999999')).toBe(false);
    expect(() => imoCheckDigit('12345')).toThrow(RangeError);
  });

  it('generates valid IMO numbers below the range ships are given', () => {
    const random = seededRandom('imo');
    for (let index = 0; index < 200; index += 1) {
      const imo = syntheticImo(random);
      expect(imo).toMatch(/^1\d{6}$/);
      expect(isValidImo(imo)).toBe(true);
    }
  });
});

describe('other synthetic identifiers', () => {
  it('writes MMSIs, test BICs, document and registration numbers in their shapes', () => {
    const random = seededRandom('identifiers');
    for (let index = 0; index < 100; index += 1) {
      expect(syntheticMmsi(random)).toMatch(/^100\d{6}$/);
      const bic = syntheticBic(random, 'GB');
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(bic).toMatch(/^[A-Z]{4}GB[A-Z2-9]0(?:[A-Z0-9]{3})?$/);
      expect(syntheticPassportNumber(random)).toMatch(/^SP\d{7}$/);
      expect(syntheticNationalId(random)).toMatch(/^NI\d{9}$/);
      expect(syntheticTaxId(random)).toMatch(/^TX\d{8}$/);
      expect(syntheticRegistrationNumber(random)).toMatch(/^RN\d{8}$/);
      expect(syntheticAircraftTail(random)).toMatch(/^SBX-[A-Z]{3}$/);
      expect(syntheticAircraftSerial(random)).toMatch(/^SYN-\d{5}$/);
    }
    expect(() => syntheticBic(random, 'gb')).toThrow(RangeError);
  });

  it('writes domains under the reserved .example TLD', () => {
    const random = seededRandom('domains');
    for (let index = 0; index < 100; index += 1) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(syntheticDomain(random)).toMatch(/^[a-z]+(?:-[a-z]+)?\.example$/);
    }
  });

  it('is reproducible from its seed', () => {
    const run = (): string[] => {
      const again = seededRandom('again');
      return [syntheticLei(again), syntheticImo(again), syntheticBic(again, 'FR')];
    };
    expect(run()).toEqual(run());
  });
});
