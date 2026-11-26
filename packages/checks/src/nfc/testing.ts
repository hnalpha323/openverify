/**
 * Test builders of the NFC checks (C62): synthetic Utopia MRZ lines, Passive and Active
 * Authentication reports as `@openverify/emrtd` writes them, MRZ readings, face embeddings and
 * templates. Never imported by runtime code; every name and number is invented.
 */
import type { CheckId, VerificationTemplateConfig } from '@openverify/core';
import type { ActiveAuthenticationReport, PassiveAuthenticationReport } from '@openverify/emrtd';
import { FACE_EMBEDDING_LENGTH } from '../face-match.js';
import type { GovernmentIdNfcCheckInput, NfcMrzReference } from './inputs.js';

/** A Utopia passport's MRZ (TD3), check digits valid: QUILL, ROWAN ASH, born 1990-01-01. */
export const TD3_LINES: readonly string[] = Object.freeze([
  'P<UTOQUILL<<ROWAN<ASH<<<<<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO9001011M3101012<<<<<<<<<<<<<<04',
]);

/** The government ID checks' reading of {@link TD3_LINES}, as the extraction holds it. */
export function mrzReference(overrides: Partial<NfcMrzReference> = {}): NfcMrzReference {
  return {
    verificationId: 'ver_01JD0000000000000000000ID1',
    idClass: 'passport',
    checkDigitsValid: true,
    ...overrides,
    fields: {
      'name-first': 'ROWAN ASH',
      'name-last': 'QUILL',
      birthdate: '1990-01-01',
      'identification-number': 'L898902C3',
      'expiration-date': '2031-01-01',
      nationality: 'UTO',
      'issuing-authority-code': 'UTO',
      ...overrides.fields,
    },
  };
}

/** An established, unrevoked report over DG1, DG2, DG14 and DG15. */
export function paReport(
  overrides: Partial<PassiveAuthenticationReport> = {},
): PassiveAuthenticationReport {
  return {
    integrity: 'established',
    integrityReason: null,
    revocation: 'unrevoked',
    revocationGap: null,
    dataGroups: { 1: 'identical', 2: 'identical', 14: 'identical', 15: 'identical' },
    hashAlgorithm: 'sha256',
    signatureAlgorithm: 'ecdsa-with-sha256',
    anchor: {
      id: 'a'.repeat(64),
      country: 'UT',
      matchedBy: 'aki',
      isLink: false,
      sandboxOnly: true,
    },
    dsc: {
      country: 'UT',
      notBefore: new Date('2026-01-01T00:00:00Z'),
      notAfter: new Date('2036-04-01T00:00:00Z'),
      embedded: true,
    },
    issuingState: 'UTO',
    flags: [],
    ...overrides,
  };
}

export function aaReport(
  outcome: ActiveAuthenticationReport['outcome'] = 'verified',
): ActiveAuthenticationReport {
  return outcome === 'verified' || outcome === 'failed'
    ? { outcome, scheme: 'ecdsa-plain', hashAlgorithm: 'sha256' }
    : { outcome, scheme: null, hashAlgorithm: null };
}

/** A unit embedding along two axes: `angle` 0 is one face, near 0 the same face, π/2 another. */
export function embedding(angle: number): number[] {
  const vector = new Array<number>(FACE_EMBEDDING_LENGTH).fill(0);
  vector[0] = Math.cos(angle);
  vector[1] = Math.sin(angle);
  return vector;
}

/** Every NFC check passing: a sandbox chip under Utopia, its selfie and its printed MRZ. */
export function nfcInput(
  overrides: Partial<GovernmentIdNfcCheckInput> = {},
): GovernmentIdNfcCheckInput {
  return {
    environment: 'sandbox',
    passiveAuthentication: paReport(),
    activeAuthentication: aaReport(),
    dg1: { mrzLines: TD3_LINES },
    governmentIdStep: true,
    mrzReferences: [mrzReference()],
    selfie: {
      kind: 'face',
      verificationId: 'ver_01JD0000000000000000000SF1',
      embedding: embedding(0),
    },
    chipPortrait: { kind: 'face', embedding: embedding(0.1) },
    sightings: 0,
    now: new Date('2026-10-23T12:00:00Z'),
    ...overrides,
  };
}

export const NFC_CHECKS: readonly CheckId[] = [
  'id_nfc_passive_authentication_detection',
  'id_nfc_chip_authentication_detection',
  'id_nfc_mrz_comparison',
  'id_nfc_selfie_comparison',
  'id_nfc_repeat_detection',
  'id_nfc_expired_detection',
];

/** Every listed check enabled and required, with optional per-check config. */
export function nfcTemplate(
  config: Partial<Record<CheckId, Record<string, unknown>>> = {},
  checks: readonly CheckId[] = NFC_CHECKS,
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      checks.map((id) => [
        id,
        {
          enabled: true,
          required: true,
          ...(config[id] === undefined ? {} : { config: config[id] }),
        },
      ]),
    ),
  };
}
