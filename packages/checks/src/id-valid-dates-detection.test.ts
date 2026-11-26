import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from './result.js';
import { idValidDatesDetection } from './id-valid-dates-detection.js';

const now = new Date('2026-10-20T12:00:00Z');
const VALID = { birthDate: '1990-05-15', issueDate: '2020-01-10', expirationDate: '2030-01-09' };

describe('idValidDatesDetection', () => {
  it('passes plausible, ordered dates', () => {
    const result = idValidDatesDetection(VALID, { now });
    expect(result).toEqual({
      name: 'id_valid_dates_detection',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { maxAgeYears: 130 },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: { 'max-age-years': 130 } },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('answers input_missing when no date is present (C29.6)', () => {
    expect(idValidDatesDetection({}, { now })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
    expect(
      idValidDatesDetection({ birthDate: null, issueDate: ' ', expirationDate: '' }, { now })
        .status,
    ).toBe('not_applicable');
  });

  it('fails a validity span longer than max-validity-years (C29.5)', () => {
    const dates = { issueDate: '2020-01-10', expirationDate: '2036-01-11' };
    expect(idValidDatesDetection(dates, { now, maxValidityYears: 15 })).toMatchObject({
      status: 'failed',
      reasons: ['validity_period_too_long'],
      provenance: { thresholds: { 'max-age-years': 130, 'max-validity-years': 15 } },
    });
    expect(
      idValidDatesDetection(
        { ...dates, expirationDate: '2035-01-10' },
        { now, maxValidityYears: 15 },
      ).status,
    ).toBe('passed');
    expect(idValidDatesDetection(dates, { now }).status).toBe('passed');
  });

  it('counts a span from 29 February to the same day as whole years', () => {
    expect(
      idValidDatesDetection(
        { issueDate: '2024-02-29', expirationDate: '2034-03-01' },
        { now, maxValidityYears: 10 },
      ).status,
    ).toBe('passed');
  });

  it.each([
    ['an impossible birth date', { birthDate: '1990-02-30' }, ['birth_date_invalid']],
    ['an unparseable issue date', { issueDate: '10/01/2020' }, ['issue_date_invalid']],
    [
      'an impossible expiration date',
      { expirationDate: '2030-13-01' },
      ['expiration_date_invalid'],
    ],
    [
      'a birth date in the future',
      { birthDate: '2027-01-01' },
      ['birth_date_in_future', 'birth_date_not_before_issue_date'],
    ],
    ['an issue date in the future', { issueDate: '2026-10-21' }, ['issue_date_in_future']],
    ['birth on the issue date', { birthDate: '2020-01-10' }, ['birth_date_not_before_issue_date']],
    [
      'birth after the issue date',
      { birthDate: '2021-01-01' },
      ['birth_date_not_before_issue_date'],
    ],
    [
      'issue on the expiration date',
      { issueDate: '2030-01-09' },
      ['issue_date_in_future', 'issue_date_not_before_expiration_date'],
    ],
    [
      'expiry before issue',
      { expirationDate: '2019-12-31' },
      ['issue_date_not_before_expiration_date'],
    ],
    [
      'an age of exactly 130',
      { birthDate: '1896-10-20', issueDate: undefined },
      ['age_exceeds_maximum'],
    ],
  ])('fails on %s', (_label, patch, reasons) => {
    const result = idValidDatesDetection({ ...VALID, ...patch }, { now });
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(reasons);
  });

  it('accepts an age just under the maximum', () => {
    expect(
      idValidDatesDetection({ birthDate: '1896-10-21', expirationDate: '2030-01-09' }, { now })
        .status,
    ).toBe('passed');
  });

  it('checks birth before expiration when there is no issue date', () => {
    expect(
      idValidDatesDetection({ birthDate: '2031-01-01', expirationDate: '2030-01-01' }, { now })
        .reasons,
    ).toEqual(['birth_date_in_future', 'birth_date_not_before_expiration_date']);
  });

  it('evaluates whatever dates are present', () => {
    expect(idValidDatesDetection({ expirationDate: '2000-01-01' }, { now }).status).toBe('passed');
    expect(idValidDatesDetection({ issueDate: '2020-01-01' }, { now }).status).toBe('passed');
  });

  it('skips ordering rules involving an invalid date', () => {
    expect(idValidDatesDetection({ ...VALID, issueDate: '2020-02-31' }, { now }).reasons).toEqual([
      'issue_date_invalid',
    ]);
  });

  it('supports a custom maximum age', () => {
    expect(
      idValidDatesDetection({ birthDate: '1920-01-01' }, { now, maxAgeYears: 100 }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['age_exceeds_maximum'],
      metadata: { maxAgeYears: 100 },
    });
  });

  it('defaults "now" to the current time', () => {
    expect(idValidDatesDetection({ birthDate: '9999-01-01' }).reasons).toEqual([
      'birth_date_in_future',
    ]);
  });

  it.each([{ maxAgeYears: 0 }, { maxAgeYears: 130.5 }, { now: new Date(Number.NaN) }])(
    'rejects the configuration %j',
    (config) => {
      expect(() => idValidDatesDetection(VALID, config)).toThrow(InvalidCheckConfigError);
    },
  );
});
