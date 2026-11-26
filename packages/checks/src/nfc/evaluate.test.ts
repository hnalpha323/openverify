/**
 * C62 at the logic level: the runner evaluates every enabled NFC check over one context, every
 * evaluator emits only the reasons its C51.2 row lists (by status), and the decision engine reads
 * the default template as the plan says. The last cases run real synthetic chips through
 * `@openverify/emrtd`: a Utopia chip with its own face passes every required check; replayed with
 * another face it fails `face_mismatch`; in production it fails `specimen_issuer`.
 */
import {
  checkResultSchema,
  decideVerification,
  defaultTemplateConfig,
  type CheckResult,
} from '@openverify/core';
import {
  parseDg1,
  verifyActiveAuthentication,
  verifyPassiveAuthentication,
} from '@openverify/emrtd';
import {
  buildUtopiaChip,
  buildUtopiaCrl,
  buildUtopiaCsca,
  signActiveAuthentication,
  testTrustStore,
} from '@openverify/emrtd/testing';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import { nfcPassiveAuthenticationOptions } from './config.js';
import { evaluateGovernmentIdNfcChecks } from './evaluate.js';
import { NFC_EVALUATORS } from './evaluators.js';
import { nfcIssuerCountry } from './issuer-country.js';
import { NFC_EVALUATOR_OUTCOMES } from './reasons.js';
import {
  aaReport,
  embedding,
  mrzReference,
  nfcInput,
  nfcTemplate,
  NFC_CHECKS,
  paReport,
  TD3_LINES,
} from './testing.js';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

/** Every reason a result carries is in its check's row for its status. */
function expectListedReasons(results: readonly CheckResult[]): void {
  for (const result of results) {
    const row = NFC_EVALUATOR_OUTCOMES[result.name];
    const listed =
      result.status === 'passed'
        ? row?.passed
        : result.status === 'failed'
          ? row?.failed
          : row?.notApplicable;
    for (const reason of result.reasons) {
      expect(listed, `${result.name} ${result.status} ${reason}`).toContain(reason);
    }
  }
}

describe('evaluateGovernmentIdNfcChecks (C62)', () => {
  it('runs every enabled NFC check in configuration order, every one passing for a good chip', () => {
    const results = evaluateGovernmentIdNfcChecks(nfcInput(), nfcTemplate());
    expect(results.map((result) => [result.name, result.status])).toEqual(
      NFC_CHECKS.map((id) => [id, 'passed']),
    );
    for (const result of results) {
      expect(checkResultSchema.safeParse(result).success).toBe(true);
    }
  });

  it('has an evaluator for each NFC check of the registry, and skips disabled checks', () => {
    expect(Object.keys(NFC_EVALUATORS).sort()).toEqual([...NFC_CHECKS].sort());
    const template = nfcTemplate();
    const disabled = {
      checks: { ...template.checks, id_nfc_repeat_detection: { enabled: false, required: false } },
    };
    expect(
      evaluateGovernmentIdNfcChecks(nfcInput(), disabled).map((result) => result.name),
    ).not.toContain('id_nfc_repeat_detection');
  });

  it('refuses a check of another type and a config that breaks its schema', () => {
    expect(() =>
      evaluateGovernmentIdNfcChecks(nfcInput(), {
        checks: { selfie_liveness_detection: { enabled: true, required: true } },
      }),
    ).toThrow(InvalidCheckConfigError);
    expect(() =>
      evaluateGovernmentIdNfcChecks(
        nfcInput(),
        nfcTemplate({ id_nfc_repeat_detection: { 'sighting-outcome': 'maybe' } }),
      ),
    ).toThrow(InvalidCheckConfigError);
  });

  const MATRIX: readonly Partial<GovernmentIdNfcCheckInput>[] = [
    {},
    { environment: 'production' },
    { passiveAuthentication: null, activeAuthentication: null, dg1: null, sightings: null },
    {
      passiveAuthentication: paReport({
        integrity: 'broken',
        integrityReason: 'dg_hash_mismatch',
        revocation: 'revoked',
      }),
    },
    {
      passiveAuthentication: paReport({
        integrity: 'not_established',
        integrityReason: 'dsc_missing',
      }),
    },
    {
      passiveAuthentication: paReport({
        revocation: 'undetermined',
        revocationGap: 'no_distribution_point',
      }),
    },
    { activeAuthentication: aaReport('failed'), sightings: 4 },
    { activeAuthentication: aaReport('not_listed'), governmentIdStep: false },
    { activeAuthentication: aaReport('withheld'), selfie: { kind: 'missing' } },
    { activeAuthentication: aaReport('malformed'), chipPortrait: { kind: 'error' } },
    {
      chipPortrait: { kind: 'face', embedding: embedding(Math.PI / 2) },
      mrzReferences: [mrzReference({ fields: { birthdate: '1991-01-01' } })],
    },
    { selfie: { kind: 'error' }, chipPortrait: { kind: 'no_face' }, mrzReferences: [] },
    { dg1: { mrzLines: ['NOT AN MRZ'] }, chipPortrait: { kind: 'not_decoded' } },
  ];

  it('emits only the reasons each check lists for the status it answers (C51.2)', () => {
    for (const input of MATRIX) {
      const results = evaluateGovernmentIdNfcChecks(
        nfcInput(input),
        nfcTemplate({ id_nfc_repeat_detection: { 'sighting-outcome': 'fail' } }),
      );
      expectListedReasons(results);
      expectListedReasons(evaluateGovernmentIdNfcChecks(nfcInput(input), nfcTemplate()));
    }
  });

  it('lists expired_within_grace_period as a reason a passed expiry carries (C51.2, C29.5)', () => {
    const [line1, line2] = TD3_LINES;
    // Expired on 2026-10-01, 22 days before the input's clock (2026-10-23), within 30 grace days.
    const expired = `${(line2 ?? '').slice(0, 21)}261001${(line2 ?? '').slice(27)}`;
    const results = evaluateGovernmentIdNfcChecks(
      nfcInput({ dg1: { mrzLines: [line1 ?? '', expired] } }),
      nfcTemplate({ id_nfc_expired_detection: { 'grace-days': 30 } }),
    );
    const expiry = results.find((result) => result.name === 'id_nfc_expired_detection');
    expect(expiry).toMatchObject({ status: 'passed', reasons: ['expired_within_grace_period'] });
    expectListedReasons(results);
  });

  it('decides a good chip under the default template passed, and a trust-store gap needs review (C62.3)', () => {
    const template = defaultTemplateConfig('government_id_nfc');
    expect(
      decideVerification(evaluateGovernmentIdNfcChecks(nfcInput(), template), template).status,
    ).toBe('passed');
    const gap = nfcInput({
      passiveAuthentication: paReport({
        integrity: 'not_established',
        integrityReason: 'trust_anchor_unavailable',
        anchor: null,
      }),
    });
    expect(decideVerification(evaluateGovernmentIdNfcChecks(gap, template), template).status).toBe(
      'needs_review',
    );
    const tampered = nfcInput({
      passiveAuthentication: paReport({ integrity: 'broken', integrityReason: 'dg_hash_mismatch' }),
    });
    expect(
      decideVerification(evaluateGovernmentIdNfcChecks(tampered, template), template).status,
    ).toBe('failed');
  });
});

describe('real synthetic chips through @openverify/emrtd (C62, C65.5)', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  const csca = buildUtopiaCsca({ now });
  const trust = testTrustStore({ anchors: [csca], crls: [buildUtopiaCrl({ csca, now })] });
  const nonce = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
  const template = defaultTemplateConfig('government_id_nfc');

  /** What `api-nfc`'s job will pass: the emrtd reports, then the inquiry's own evidence. */
  function inputOf(
    chip: ReturnType<typeof buildUtopiaChip>,
    overrides: Partial<GovernmentIdNfcCheckInput> = {},
  ) {
    const passiveAuthentication = verifyPassiveAuthentication(chip.files, trust, {
      now,
      issuerCountry: nfcIssuerCountry,
      ...nfcPassiveAuthenticationOptions(template),
    });
    const key = chip.activeAuthenticationKey;
    const activeAuthentication = verifyActiveAuthentication({
      dg15: chip.files.dataGroups[15] ?? null,
      dg15Listed:
        passiveAuthentication.dataGroups[15] !== undefined &&
        passiveAuthentication.dataGroups[15] !== 'not_listed',
      integrity: passiveAuthentication.integrity,
      nonce,
      response: key === null ? null : signActiveAuthentication(key, nonce),
      dg14: chip.files.dataGroups[14] ?? null,
    });
    return nfcInput({
      passiveAuthentication,
      activeAuthentication,
      dg1: parseDg1(chip.files.dataGroups[1] ?? new Uint8Array()),
      now,
      ...overrides,
    });
  }

  const chipOf = (seed: string, variants: readonly 'tampered-dg1'[] = []) =>
    buildUtopiaChip({
      now,
      seed,
      mrzLines: TD3_LINES,
      portrait: { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mimeType: 'image/jpeg' },
      variants,
    });

  it('passes every required check of a Utopia chip read with its own face', () => {
    const results = evaluateGovernmentIdNfcChecks(inputOf(chipOf('nfc-good')), template);
    expect(results.filter((result) => result.status !== 'passed')).toEqual([]);
    expect(decideVerification(results, template).status).toBe('passed');
  });

  it('fails the same chip replayed with another face, and records the sighting (C65.5)', () => {
    const replay = inputOf(chipOf('nfc-good'), {
      selfie: {
        kind: 'face',
        verificationId: 'ver_01JD0000000000000000000SF2',
        embedding: embedding(Math.PI / 2),
      },
      sightings: 1,
    });
    const results = evaluateGovernmentIdNfcChecks(replay, template);
    expect(results.find((result) => result.name === 'id_nfc_selfie_comparison')).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
    });
    expect(results.find((result) => result.name === 'id_nfc_repeat_detection')).toMatchObject({
      status: 'not_applicable',
      reasons: ['chip_seen_on_other_account'],
      metadata: { sightings: 1 },
    });
    expect(decideVerification(results, template).status).toBe('failed');
  });

  it('fails a Utopia chip in production with specimen_issuer (V04)', () => {
    const results = evaluateGovernmentIdNfcChecks(
      inputOf(chipOf('nfc-good'), { environment: 'production' }),
      template,
    );
    expect(
      results.find((result) => result.name === 'id_nfc_passive_authentication_detection'),
    ).toMatchObject({
      status: 'failed',
      reasons: ['specimen_issuer'],
    });
  });

  it('fails a tampered DG1 as dg_hash_mismatch and withholds every DG1 verdict (V05)', () => {
    const results = evaluateGovernmentIdNfcChecks(
      inputOf(chipOf('nfc-tampered', ['tampered-dg1'])),
      template,
    );
    expect(
      results.find((result) => result.name === 'id_nfc_passive_authentication_detection'),
    ).toMatchObject({
      status: 'failed',
      reasons: ['dg_hash_mismatch'],
    });
    for (const name of [
      'id_nfc_mrz_comparison',
      'id_nfc_expired_detection',
      'id_nfc_chip_authentication_detection',
    ]) {
      expect(results.find((result) => result.name === name)?.reasons).toEqual([
        'integrity_not_established',
      ]);
    }
  });
});
