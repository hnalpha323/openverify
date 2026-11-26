/**
 * C62.3: the passive authentication answer. Established and unrevoked passes (undetermined too
 * under `best-effort`, flagged); broken fails with its reason; revoked fails `dsc_revoked`; not
 * established, or undetermined under `strict`, is review with its reason, never `failed`; a `UTO`
 * issuer in production fails `specimen_issuer` before anything else (V04).
 */
import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { nfcContext } from './context.js';
import { idNfcPassiveAuthenticationDetection } from './id-nfc-passive-authentication-detection.js';
import { nfcInput, nfcTemplate, paReport } from './testing.js';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

const judge = (input: Partial<GovernmentIdNfcCheckInput> = {}, config?: Record<string, unknown>) =>
  idNfcPassiveAuthenticationDetection(
    nfcContext(
      nfcInput(input),
      nfcTemplate(config === undefined ? {} : { id_nfc_passive_authentication_detection: config }),
    ),
  );

describe('id_nfc_passive_authentication_detection (C62.3)', () => {
  it('passes an established, unrevoked chip and records the measurements, never chip data', () => {
    const result = judge();
    expect(checkResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        integrity: 'established',
        revocation: 'unrevoked',
        'hash-algorithm': 'sha256',
        'signature-algorithm': 'ecdsa-with-sha256',
        'anchor-matched-by': 'aki',
        'anchor-link': false,
        'data-groups': { dg1: 'identical', dg2: 'identical', dg14: 'identical', dg15: 'identical' },
        flags: [],
      },
      provenance: {
        thresholds: { revocation: 'strict', 'accept-sha1': true },
        'threshold-basis': { revocation: 'provisional', 'accept-sha1': 'provisional' },
      },
    });
  });

  it.each([['sod_signature_invalid'], ['dg_hash_mismatch']] as const)(
    'fails broken integrity with %s',
    (reason) => {
      expect(
        judge({
          passiveAuthentication: paReport({ integrity: 'broken', integrityReason: reason }),
        }),
      ).toMatchObject({
        status: 'failed',
        reasons: [reason],
      });
    },
  );

  it('fails a revoked DSC, and adds the revocation to a broken chip', () => {
    expect(judge({ passiveAuthentication: paReport({ revocation: 'revoked' }) })).toMatchObject({
      status: 'failed',
      reasons: ['dsc_revoked'],
    });
    expect(
      judge({
        passiveAuthentication: paReport({
          integrity: 'broken',
          integrityReason: 'dg_hash_mismatch',
          revocation: 'revoked',
        }),
      }).reasons,
    ).toEqual(['dg_hash_mismatch', 'dsc_revoked']);
    // A DSC no anchor verified is not proven revoked: the integrity gap stands.
    expect(
      judge({
        passiveAuthentication: paReport({
          integrity: 'not_established',
          integrityReason: 'trust_anchor_unavailable',
          revocation: 'revoked',
          anchor: null,
        }),
      }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['trust_anchor_unavailable'] });
  });

  it.each([
    'trust_anchor_unavailable',
    'trust_anchor_withdrawn',
    'dsc_missing',
    'certificate_expired',
    'certificate_profile_invalid',
    'issuer_country_inconsistent',
    'algorithm_unsupported',
    'chip_data_malformed',
    'input_missing',
  ] as const)('sends integrity not established by %s to review, never to failure', (reason) => {
    expect(
      judge({
        passiveAuthentication: paReport({ integrity: 'not_established', integrityReason: reason }),
      }),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: [reason],
      metadata: { 'integrity-reason': reason },
    });
  });

  it('sends an undetermined revocation to review under strict, crl_unavailable whatever the gap', () => {
    for (const gap of ['crl_unavailable', 'no_distribution_point'] as const) {
      expect(
        judge({
          passiveAuthentication: paReport({ revocation: 'undetermined', revocationGap: gap }),
        }),
      ).toMatchObject({
        status: 'not_applicable',
        reasons: ['crl_unavailable'],
        metadata: { revocation: 'undetermined', 'revocation-gap': gap },
      });
    }
  });

  it('passes an undetermined revocation under best-effort, flagged', () => {
    expect(
      judge(
        {
          passiveAuthentication: paReport({
            revocation: 'undetermined',
            revocationGap: 'crl_unavailable',
          }),
        },
        { revocation: 'best-effort' },
      ),
    ).toMatchObject({
      status: 'passed',
      metadata: { flags: ['revocation-undetermined'] },
      provenance: { thresholds: { revocation: 'best-effort' } },
    });
  });

  it('fails a Utopia chip in production with specimen_issuer, first (V04)', () => {
    for (const passiveAuthentication of [
      paReport(),
      paReport({
        integrity: 'not_established',
        integrityReason: 'trust_anchor_unavailable',
        anchor: null,
      }),
      paReport({ issuingState: null }),
    ]) {
      expect(judge({ environment: 'production', passiveAuthentication })).toMatchObject({
        status: 'failed',
        reasons: ['specimen_issuer'],
      });
    }
    expect(judge({ environment: 'sandbox' }).status).toBe('passed');
    const real = paReport({
      issuingState: 'D',
      dsc: { country: 'DE', notBefore: new Date(0), notAfter: new Date(0), embedded: true },
      anchor: {
        id: 'b'.repeat(64),
        country: 'DE',
        matchedBy: 'aki',
        isLink: false,
        sandboxOnly: false,
      },
    });
    expect(
      judge({ environment: 'production', passiveAuthentication: real, dg1: null }).status,
    ).toBe('passed');
  });

  it('answers input_missing without an SOD', () => {
    expect(judge({ passiveAuthentication: null })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});
