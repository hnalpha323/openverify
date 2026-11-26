/**
 * C51.2 contract for the government ID NFC job: every reason its evaluators may emit is one the
 * contracts publish for the six `id_nfc_*` checks, so the job never writes a reason the clients
 * and the console do not know; and every published reason but one is one an evaluator emits.
 * `packages/checks` cannot import `@openverify/contracts`, so the two tables meet here. They are
 * compared by reason set: the expiry's `expired_within_grace_period` rides on a passed result in
 * the evaluators and is listed as a failure reason in the contracts, and `issuer_mismatch` is
 * never emitted, because the issuer selects the MRZ reading (the emrtd agent's C62.6 decision).
 */
import { NFC_EVALUATOR_OUTCOMES, evaluateGovernmentIdNfcChecks } from '@openverify/checks';
import { NFC_CHECK_IDS, NFC_CHECK_REASONS, sharedReasonsFor } from '@openverify/contracts';
import { CHECK_REGISTRY, defaultTemplateConfig } from '@openverify/core';
import type { PassiveAuthenticationReport } from '@openverify/emrtd';
import { describe, expect, it } from 'vitest';
import { td3Mrz } from '../../services/chip-challenges/testing.js';

const NEVER_EMITTED = new Set(['issuer_mismatch']);
const GRACE = 'expired_within_grace_period';

/**
 * The expiry's reasons on a document expired yesterday within 30 grace days, integrity
 * established: the evaluator emits `expired_within_grace_period` on a passed result (it delegates
 * to the Phase 3 `idNfcExpiredDetection`), which its outcome table lists under `passed`.
 */
function graceReasons(): readonly string[] {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const report: PassiveAuthenticationReport = {
    integrity: 'established',
    integrityReason: null,
    revocation: 'unrevoked',
    revocationGap: null,
    dataGroups: { 1: 'identical', 2: 'identical' },
    hashAlgorithm: 'sha256',
    signatureAlgorithm: null,
    anchor: null,
    dsc: null,
    issuingState: 'UTO',
    flags: [],
  };
  const config = defaultTemplateConfig('government_id_nfc');
  config.checks.id_nfc_expired_detection = {
    enabled: true,
    required: true,
    config: { 'grace-days': 30 },
  };
  const [result] = evaluateGovernmentIdNfcChecks(
    {
      environment: 'sandbox',
      passiveAuthentication: report,
      activeAuthentication: null,
      dg1: { mrzLines: td3Mrz({ expiryDate: '261019' }) },
      governmentIdStep: false,
      mrzReferences: [],
      selfie: { kind: 'missing' },
      chipPortrait: { kind: 'not_decoded' },
      sightings: null,
      now,
    },
    { checks: { id_nfc_expired_detection: config.checks.id_nfc_expired_detection } },
  );
  return result?.status === 'passed' ? result.reasons : [];
}

const emitted = (id: string): Set<string> => {
  const row = NFC_EVALUATOR_OUTCOMES[id];
  return new Set([
    ...(row?.passed ?? []),
    ...(row?.failed ?? []),
    ...(row?.notApplicable ?? []),
    ...(id === 'id_nfc_expired_detection' ? graceReasons() : []),
  ]);
};

describe('the government ID NFC reasons (C51.2)', () => {
  it('cover every NFC check of the registry, in the evaluators and the contracts', () => {
    const registered = CHECK_REGISTRY.filter(
      (check) => check.verificationType === 'government_id_nfc',
    ).map((check) => check.id);

    expect([...registered].sort()).toEqual([...NFC_CHECK_IDS].sort());
    expect(Object.keys(NFC_EVALUATOR_OUTCOMES).sort()).toEqual([...NFC_CHECK_IDS].sort());
  });

  it.each([...NFC_CHECK_IDS])('%s emits only published reasons', (id) => {
    const published = new Set(NFC_CHECK_REASONS[id]);

    expect([...emitted(id)].filter((reason) => !published.has(reason))).toEqual([]);
  });

  it('the expiry emits expired_within_grace_period on a passed result', () => {
    expect(graceReasons()).toEqual([GRACE]);
  });

  it.each([...NFC_CHECK_IDS])(
    '%s publishes no reason it never emits, but issuer_mismatch',
    (id) => {
      const shared = new Set(sharedReasonsFor(id));
      const emits = emitted(id);

      expect(
        NFC_CHECK_REASONS[id].filter(
          (reason) => !shared.has(reason) && !NEVER_EMITTED.has(reason) && !emits.has(reason),
        ),
      ).toEqual([]);
    },
  );
});
