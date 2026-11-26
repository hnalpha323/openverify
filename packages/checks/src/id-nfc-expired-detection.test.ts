import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { idNfcExpiredDetection } from './id-nfc-expired-detection.js';

const now = new Date('2026-10-21T12:00:00Z');

describe('idNfcExpiredDetection (logic only until Phase 5)', () => {
  it('passes a chip expiry in the future, through its last day', () => {
    const result = idNfcExpiredDetection({ expirationDate: '2026-10-21' }, { now });
    expect(result).toMatchObject({
      name: 'id_nfc_expired_detection',
      status: 'passed',
      reasons: [],
      metadata: { 'days-past-expiration': 0 },
      provenance: { thresholds: { 'grace-days': 0 } },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('fails a past expiry, within the grace period passes', () => {
    expect(idNfcExpiredDetection({ expirationDate: '2026-10-01' }, { now })).toMatchObject({
      status: 'failed',
      reasons: ['expired'],
      metadata: { 'days-past-expiration': 20 },
    });
    expect(
      idNfcExpiredDetection({ expirationDate: '2026-10-01' }, { now, graceDays: 30 }),
    ).toMatchObject({ status: 'passed', reasons: ['expired_within_grace_period'] });
  });

  it('fails an expiry that is not a calendar date', () => {
    expect(idNfcExpiredDetection({ expirationDate: '2026-02-30' }, { now })).toMatchObject({
      status: 'failed',
      reasons: ['expiration_date_invalid'],
    });
  });

  it.each([undefined, null, ' '])(
    'answers input_missing without a chip expiry (%j)',
    (expirationDate) => {
      expect(idNfcExpiredDetection({ expirationDate }, { now })).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
    },
  );

  it('defaults to now and no grace', () => {
    expect(idNfcExpiredDetection({ expirationDate: '1999-01-01' }).status).toBe('failed');
  });
});
