import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from './result.js';
import { documentFeatures } from './data/feature-table.js';
import { idExpiredDetection } from './id-expired-detection.js';

const now = new Date('2026-10-20T12:00:00Z');

describe('idExpiredDetection', () => {
  it('passes a document that expires in the future', () => {
    const result = idExpiredDetection({ expirationDate: '2030-01-01' }, { now });
    expect(result).toEqual({
      name: 'id_expired_detection',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { graceDays: 0, daysPastExpiration: 0 },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: { 'grace-days': 0 } },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('treats a document as valid through its expiration day', () => {
    expect(idExpiredDetection({ expirationDate: '2026-10-20' }, { now }).status).toBe('passed');
  });

  it('fails the day after expiration', () => {
    expect(idExpiredDetection({ expirationDate: '2026-10-19' }, { now })).toMatchObject({
      status: 'failed',
      reasons: ['expired'],
      metadata: { graceDays: 0, daysPastExpiration: 1 },
    });
  });

  it('passes inside the grace period with an explanatory reason', () => {
    expect(
      idExpiredDetection({ expirationDate: '2026-09-20' }, { now, graceDays: 30 }),
    ).toMatchObject({
      status: 'passed',
      reasons: ['expired_within_grace_period'],
      metadata: { graceDays: 30, daysPastExpiration: 30 },
    });
  });

  it('fails once the grace period is over', () => {
    expect(
      idExpiredDetection({ expirationDate: '2026-09-19' }, { now, graceDays: 30 }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['expired'],
      metadata: { daysPastExpiration: 31 },
    });
  });

  it('uses the UTC calendar date of "now"', () => {
    const lateEvening = new Date('2026-10-20T23:30:00-05:00'); // 21 October in UTC
    expect(idExpiredDetection({ expirationDate: '2026-10-20' }, { now: lateEvening }).status).toBe(
      'failed',
    );
  });

  it('defaults "now" to the current time', () => {
    expect(idExpiredDetection({ expirationDate: '9999-12-31' }).status).toBe('passed');
    expect(idExpiredDetection({ expirationDate: '1970-01-01' }).status).toBe('failed');
  });

  it.each([undefined, null, '', '   '])(
    'answers input_missing without an expiration date (%j, C29.6)',
    (expirationDate) => {
      expect(idExpiredDetection({ expirationDate }, { now })).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
    },
  );

  it('answers feature_absent without an expiration date for a class the feature table says has none (C29.6)', () => {
    const features = documentFeatures(
      { scheme: 'icao', code: 'DEU', country: 'DE', jurisdiction: null },
      'national_id',
      'production',
    );
    if (features === null) {
      throw new Error('the EU national ID row exists');
    }
    expect(
      idExpiredDetection(
        { expirationDate: null, features: { ...features, expiry: false } },
        { now },
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['feature_absent'] });
    expect(idExpiredDetection({ expirationDate: null, features }, { now })).toMatchObject({
      reasons: ['input_missing'],
    });
  });

  it('lists the grace period it judged in the provenance (C29.2)', () => {
    expect(
      idExpiredDetection({ expirationDate: '2026-10-01' }, { now, graceDays: 30 }).provenance,
    ).toEqual({ 'implementation-version': 1, thresholds: { 'grace-days': 30 } });
  });

  it.each(['2026-02-30', '20/10/2026', 'never'])(
    'fails closed on the unreadable expiration date %j',
    (expirationDate) => {
      expect(idExpiredDetection({ expirationDate }, { now })).toMatchObject({
        status: 'failed',
        reasons: ['expiration_date_invalid'],
      });
    },
  );

  it.each([
    ['a negative grace period', { graceDays: -1 }],
    ['a fractional grace period', { graceDays: 1.5 }],
    ['an invalid "now"', { now: new Date('nope') }],
  ])('rejects %s', (_label, config) => {
    expect(() => idExpiredDetection({ expirationDate: '2030-01-01' }, config)).toThrow(
      InvalidCheckConfigError,
    );
  });
});
