/**
 * C62.6, C29.5: the document's expiry, read from DG1 (`YYMMDD`, at most 50 years ahead), past
 * `grace-days` fails `expired`; judged on DG1's integrity (C62.4): an expired document fails
 * even unverified, a current one is evidence only with integrity established.
 */
import { describe, expect, it } from 'vitest';
import { nfcContext } from './context.js';
import { nfcExpiredDetection } from './nfc-expired-detection.js';
import { nfcInput, nfcTemplate, paReport, TD3_LINES } from './testing.js';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

const judge = (input: Partial<GovernmentIdNfcCheckInput> = {}, config?: Record<string, unknown>) =>
  nfcExpiredDetection(
    nfcContext(
      nfcInput(input),
      nfcTemplate(config === undefined ? {} : { id_nfc_expired_detection: config }),
    ),
  );

/** TD3 lines whose expiry is `yymmdd` (check digits left as they were: not read here). */
const expiringOn = (yymmdd: string) => [
  TD3_LINES[0] ?? '',
  `${(TD3_LINES[1] ?? '').slice(0, 21)}${yymmdd}${(TD3_LINES[1] ?? '').slice(27)}`,
];

describe('id_nfc_expired_detection on the chip (C62.6)', () => {
  it('passes a document that expires after today', () => {
    expect(judge()).toMatchObject({
      name: 'id_nfc_expired_detection',
      status: 'passed',
      reasons: [],
      metadata: { 'days-past-expiration': 0, integrity: 'established' },
      provenance: {
        thresholds: { 'grace-days': 0 },
        'threshold-basis': { 'grace-days': 'provisional' },
      },
    });
  });

  it('fails an expired document, and passes it within the grace days with their reason', () => {
    const expired = { dg1: { mrzLines: expiringOn('261001') } };
    expect(judge(expired)).toMatchObject({
      status: 'failed',
      reasons: ['expired'],
      metadata: { 'days-past-expiration': 22 },
    });
    expect(judge(expired, { 'grace-days': 30 })).toMatchObject({
      status: 'passed',
      reasons: ['expired_within_grace_period'],
    });
  });

  it('fails an expiry that is no calendar date, and reads an unknown one as missing', () => {
    expect(judge({ dg1: { mrzLines: expiringOn('270230') } })).toMatchObject({
      status: 'failed',
      reasons: ['expiration_date_invalid'],
    });
    expect(judge({ dg1: { mrzLines: expiringOn('27<<<<') } }).reasons).toEqual(['input_missing']);
    expect(judge({ dg1: null }).reasons).toEqual(['input_missing']);
    expect(judge({ dg1: { mrzLines: ['NOT AN MRZ'] } }).reasons).toEqual(['input_missing']);
  });

  it('judges on DG1 integrity (C62.4)', () => {
    const unverified = paReport({
      integrity: 'not_established',
      integrityReason: 'trust_anchor_unavailable',
    });
    expect(judge({ passiveAuthentication: unverified })).toMatchObject({
      status: 'not_applicable',
      reasons: ['integrity_not_established'],
    });
    expect(
      judge({ passiveAuthentication: unverified, dg1: { mrzLines: expiringOn('200101') } }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['expired'],
      metadata: { integrity: 'not_established' },
    });
    expect(
      judge({
        passiveAuthentication: paReport({
          integrity: 'broken',
          integrityReason: 'dg_hash_mismatch',
        }),
        dg1: { mrzLines: expiringOn('200101') },
      }).reasons,
    ).toEqual(['integrity_not_established']);
  });
});
