import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from './result.js';
import { idAgeComparison } from './id-age-comparison.js';

const now = new Date('2026-10-20T12:00:00Z');

describe('idAgeComparison', () => {
  it('passes an age within the limits', () => {
    const result = idAgeComparison({ birthDate: '2000-01-01' }, { now, minAge: 18, maxAge: 65 });
    expect(result).toEqual({
      name: 'id_age_comparison',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { age: 26, minAge: 18, maxAge: 65 },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: { 'min-age': 18, 'max-age': 65 } },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('passes on the 18th birthday and fails the day before', () => {
    expect(idAgeComparison({ birthDate: '2008-10-20' }, { now, minAge: 18 }).status).toBe('passed');
    expect(idAgeComparison({ birthDate: '2008-10-21' }, { now, minAge: 18 })).toMatchObject({
      status: 'failed',
      reasons: ['below_minimum_age'],
      metadata: { age: 17, minAge: 18 },
    });
  });

  it('reaches a 29 February birthday on 1 March in non-leap years', () => {
    const born = { birthDate: '2008-02-29' };
    expect(
      idAgeComparison(born, { now: new Date('2026-02-28T00:00:00Z'), minAge: 18 }).status,
    ).toBe('failed');
    expect(
      idAgeComparison(born, { now: new Date('2026-03-01T00:00:00Z'), minAge: 18 }).status,
    ).toBe('passed');
  });

  it('fails above the maximum age, and passes at it', () => {
    expect(idAgeComparison({ birthDate: '1960-10-20' }, { now, maxAge: 65 })).toMatchObject({
      status: 'failed',
      reasons: ['above_maximum_age'],
      metadata: { age: 66 },
    });
    expect(idAgeComparison({ birthDate: '1961-10-20' }, { now, maxAge: 65 }).status).toBe('passed');
  });

  it('is not applicable without age limits', () => {
    expect(idAgeComparison({ birthDate: '2000-01-01' }, { now })).toMatchObject({
      status: 'not_applicable',
      reasons: ['age_limits_not_configured'],
      metadata: {},
    });
  });

  it.each([undefined, '  ', null])(
    'answers input_missing without a birth date (%j, C29.6)',
    (birthDate) => {
      expect(idAgeComparison({ birthDate }, { now, minAge: 18 })).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
    },
  );

  it.each([
    ['impossible', '2000-02-30', 'birth_date_invalid'],
    ['in the future', '2027-01-01', 'birth_date_in_future'],
  ])('fails closed when the birth date is %s', (_label, birthDate, reason) => {
    expect(idAgeComparison({ birthDate }, { now, minAge: 18 })).toMatchObject({
      status: 'failed',
      reasons: [reason],
    });
  });

  it('defaults "now" to the current time', () => {
    expect(idAgeComparison({ birthDate: '1900-01-01' }, { minAge: 18 }).status).toBe('passed');
  });

  it.each([
    ['a negative minimum', { minAge: -1 }],
    ['a fractional maximum', { maxAge: 20.5 }],
    ['a minimum above the maximum', { minAge: 30, maxAge: 20 }],
    ['an unknown option', { minimumAge: 18 }],
  ])('rejects %s', (_label, config) => {
    expect(() => idAgeComparison({ birthDate: '2000-01-01' }, config as never)).toThrow(
      InvalidCheckConfigError,
    );
  });
});
