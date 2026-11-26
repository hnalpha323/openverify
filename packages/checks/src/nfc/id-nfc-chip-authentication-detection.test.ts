/**
 * C62.6: chip authentication is Active Authentication over this challenge's nonce. It passes when
 * the response verifies; fails `active_authentication_failed` for a well-formed one that does
 * not; `chip_data_malformed` for one that cannot be read; `active_authentication_withheld` when
 * the SOD lists DG15 and the response is missing; for a chip whose SOD lists no DG15,
 * `chip_auth_not_server_verifiable` (non-blocking) or, with `require-active-authentication`,
 * `active_authentication_unavailable`; `integrity_not_established` without trusted DG15.
 */
import { decideVerification } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { nfcContext } from './context.js';
import { idNfcChipAuthenticationDetection } from './id-nfc-chip-authentication-detection.js';
import { aaReport, nfcInput, nfcTemplate } from './testing.js';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

const judge = (input: Partial<GovernmentIdNfcCheckInput> = {}, config?: Record<string, unknown>) =>
  idNfcChipAuthenticationDetection(
    nfcContext(
      nfcInput(input),
      nfcTemplate(config === undefined ? {} : { id_nfc_chip_authentication_detection: config }),
    ),
  );

describe('id_nfc_chip_authentication_detection (C62.6)', () => {
  it('passes a verified response, recording the scheme and digest', () => {
    expect(judge()).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { outcome: 'verified', scheme: 'ecdsa-plain', 'hash-algorithm': 'sha256' },
      provenance: { thresholds: { 'require-active-authentication': false } },
    });
  });

  it.each([
    ['failed', 'failed', 'active_authentication_failed'],
    ['malformed', 'not_applicable', 'chip_data_malformed'],
    ['withheld', 'not_applicable', 'active_authentication_withheld'],
    ['not_listed', 'not_applicable', 'chip_auth_not_server_verifiable'],
    ['untrusted_key', 'not_applicable', 'integrity_not_established'],
  ] as const)('answers the %s outcome %s with %s', (outcome, status, reason) => {
    expect(judge({ activeAuthentication: aaReport(outcome) })).toMatchObject({
      status,
      reasons: [reason],
      metadata: { outcome },
    });
  });

  it('sends a chip without AA to review when the template requires it (decision 33)', () => {
    expect(
      judge(
        { activeAuthentication: aaReport('not_listed') },
        { 'require-active-authentication': true },
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['active_authentication_unavailable'] });
  });

  it('lets a chip without AA through as a non-blocking answer by default (C30.2)', () => {
    const result = judge({ activeAuthentication: aaReport('not_listed') });
    const decision = decideVerification(
      [result],
      nfcTemplate({}, ['id_nfc_chip_authentication_detection']),
    );
    // Non-blocking, but no evidence: a verification with nothing passed goes to review (C30.1).
    expect(decision.status).toBe('needs_review');
  });

  it('keeps what the device claimed as device-reported, from the known protocols only', () => {
    expect(
      judge({ deviceReportedProtocols: ['chip_authentication', 'pace', 'made-up', 'pace'] })
        .metadata,
    ).toMatchObject({ 'device-reported': ['chip_authentication', 'pace'] });
    expect(judge().metadata).not.toHaveProperty('device-reported');
  });

  it('answers input_missing when Active Authentication was not run', () => {
    expect(judge({ activeAuthentication: null })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});
