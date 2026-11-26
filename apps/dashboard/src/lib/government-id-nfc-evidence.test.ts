// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  CHIP_IDS,
  chipCheck,
  chipFiles,
  chipVerification,
  selfieCenterFiles,
} from '../testing/fixtures/government-id-nfc';
import { chipEvidenceOf, chipPortraitOf, selfieCenterOf } from './government-id-nfc-evidence';

const PA = 'id_nfc_passive_authentication_detection';

describe('chipEvidenceOf (C62, C66)', () => {
  it('reads passive authentication: integrity, revocation, algorithms and the anchor', () => {
    const evidence = chipEvidenceOf(chipVerification()).passiveAuthentication;

    expect(evidence).toMatchObject({
      outcome: 'passed',
      integrity: 'established',
      integrityReason: null,
      revocation: 'unrevoked',
      revocationGap: null,
      revocationMode: 'strict',
      hashAlgorithm: 'sha256',
      signatureAlgorithm: 'ecdsa-with-sha256',
      anchorSource: 'openverify-sandbox',
      anchorMatchedBy: 'aki',
      anchorLink: false,
      anchorSandboxOnly: true,
      signerValidity: 'valid',
      flags: [],
    });
    expect(evidence.result?.name).toBe(PA);
  });

  it('lists every data group by its number, with its state against the signed SOD', () => {
    const verification = chipVerification({
      checks: {
        [PA]: {
          metadata: {
            ...chipCheck(PA).metadata,
            'data-groups': {
              dg15: 'missing_from_upload',
              dg2: 'identical',
              dg11: 'not_listed',
              dg1: 'not_identical',
              dgx: 'identical',
              dg3: 7,
            },
          },
        },
      },
    });

    expect(chipEvidenceOf(verification).passiveAuthentication.dataGroups).toEqual([
      { key: 'dg1', number: 1, state: 'not_identical' },
      { key: 'dg2', number: 2, state: 'identical' },
      { key: 'dg11', number: 11, state: 'not_listed' },
      { key: 'dg15', number: 15, state: 'missing_from_upload' },
    ]);
  });

  it.each([
    ['certificate_expired', 'expired'],
    ['certificate_profile_invalid', 'profile_invalid'],
    ['dsc_missing', 'missing'],
    ['trust_anchor_unavailable', 'not_judged'],
  ] as const)(
    'says how the signer certificate stood when integrity is not established for %s',
    (reason, validity) => {
      const verification = chipVerification({
        checks: {
          [PA]: {
            status: 'not_applicable',
            reasons: [reason],
            metadata: {
              integrity: 'not_established',
              'integrity-reason': reason,
              revocation: 'undetermined',
              'revocation-gap': 'crl_unavailable',
              'data-groups': {},
              flags: ['sha1'],
            },
          },
        },
      });

      const evidence = chipEvidenceOf(verification).passiveAuthentication;

      expect(evidence).toMatchObject({
        integrity: 'not_established',
        integrityReason: reason,
        revocation: 'undetermined',
        revocationGap: 'crl_unavailable',
        signerValidity: validity,
        flags: ['sha1'],
      });
    },
  );

  it('never calls the signer valid when integrity is broken', () => {
    const verification = chipVerification({
      checks: {
        [PA]: {
          status: 'failed',
          reasons: ['dg_hash_mismatch'],
          metadata: { integrity: 'broken', 'integrity-reason': 'dg_hash_mismatch' },
        },
      },
    });

    expect(chipEvidenceOf(verification).passiveAuthentication.signerValidity).toBe('not_judged');
  });

  it('falls back to the attribute, which survives redaction, when the metadata is gone', () => {
    const verification = chipVerification({ checks: { [PA]: { metadata: {} } } });

    const evidence = chipEvidenceOf(verification).passiveAuthentication;

    expect(evidence).toMatchObject({
      integrity: 'established',
      revocation: 'unrevoked',
      hashAlgorithm: 'sha256',
      anchorSource: 'openverify-sandbox',
      anchorSandboxOnly: null,
      signerValidity: 'valid',
      dataGroups: [],
    });
  });

  it('records nothing it was not given', () => {
    const verification = chipVerification({
      attributes: { 'passive-authentication': null, 'active-authentication': null },
      checks: { [PA]: null, id_nfc_chip_authentication_detection: null },
    });

    const evidence = chipEvidenceOf(verification);

    expect(evidence.passiveAuthentication).toMatchObject({
      result: undefined,
      outcome: null,
      integrity: null,
      revocation: null,
      anchorSource: null,
      signerValidity: 'not_judged',
    });
    expect(evidence.activeAuthentication).toMatchObject({ result: undefined, outcome: null });
  });

  it('reads Active Authentication, and keeps the device report apart from it', () => {
    expect(chipEvidenceOf(chipVerification()).activeAuthentication).toEqual({
      result: chipCheck('id_nfc_chip_authentication_detection'),
      outcome: 'verified',
      scheme: 'ecdsa-plain',
      hashAlgorithm: 'sha256',
      required: false,
      deviceReported: [],
    });

    const reported = chipVerification({
      checks: {
        id_nfc_chip_authentication_detection: {
          metadata: {
            outcome: 'verified',
            'device-reported': ['pace', 7, 'active_authentication'],
          },
        },
      },
    });
    expect(chipEvidenceOf(reported).activeAuthentication.deviceReported).toEqual([
      'pace',
      'active_authentication',
    ]);
  });

  it('reads the MRZ comparison, the selfie comparison, the sightings and the expiry', () => {
    const evidence = chipEvidenceOf(chipVerification());

    expect(evidence.mrz).toMatchObject({
      compared: ['identification-number', 'birthdate', 'expiration-date', 'name', 'nationality'],
      mismatched: [],
      confusablesTolerated: true,
      governmentIdVerificationId: 'ver_01M5CK0A1B2C3D4E5F6G7H8J9K',
    });
    expect(evidence.selfie).toMatchObject({
      similarity: 0.71,
      threshold: 0.394,
      selfieVerificationId: CHIP_IDS.selfie,
    });
    expect(evidence.repeat).toMatchObject({ sightings: 0, sightingOutcome: 'review' });
    expect(evidence.expiry).toMatchObject({ daysPastExpiration: 0, graceDays: 0 });
  });

  it('reads the chip fields in their API order, and the class and country', () => {
    const evidence = chipEvidenceOf(chipVerification());

    expect(evidence.fields).toEqual([
      ['name-first', 'AVERY'],
      ['name-last', 'EXAMPLE'],
      ['birthdate', '1990-04-12'],
      ['sex', 'F'],
      ['expiration-date', '2031-04-11'],
      ['identification-number', 'UT1234567'],
      ['nationality', 'UTO'],
    ]);
    expect(evidence.idClass).toBe('passport');
    expect(evidence.issuingCountry).toBe('UT');
  });

  it('names the sandbox test chip’s scenario, and nothing for any other chip (C208.4)', () => {
    expect(chipEvidenceOf(chipVerification()).sandboxChip).toBeNull();
    expect(
      chipEvidenceOf(chipVerification({ attributes: { 'sandbox-chip': 'face-mismatch' } }))
        .sandboxChip,
    ).toBe('face-mismatch');
  });

  it('keeps the masked fields null', () => {
    const { fields } = chipEvidenceOf(chipVerification({ masked: true }));

    expect(fields).toHaveLength(7);
    expect(fields.every(([, value]) => value === null)).toBe(true);
  });
});

describe('the chip files (C52.4, C62.6)', () => {
  it('finds the chip portrait, never a raw chip file', () => {
    expect(chipPortraitOf(chipFiles(), CHIP_IDS.verification)?.id).toBe(CHIP_IDS.portrait);
    expect(chipPortraitOf(chipFiles().filter((f) => f.attributes.kind !== 'chip-portrait'))).toBe(
      undefined,
    );
  });

  it('finds the centre photo of the selfie the portrait was compared with', () => {
    expect(selfieCenterOf(selfieCenterFiles(), CHIP_IDS.selfie)?.id).toBe(CHIP_IDS.selfieCenter);
    expect(selfieCenterOf(selfieCenterFiles(), null)).toBeUndefined();
    expect(selfieCenterOf(chipFiles(), CHIP_IDS.selfie)).toBeUndefined();
  });
});
