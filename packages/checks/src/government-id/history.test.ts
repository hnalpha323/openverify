/** The C34 history and comparison checks: the worker looks the candidates up and passes them in. */
import { FACE_MATCH_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { goldenAnalysis } from '../testing/fixtures.js';
import { extractionWith } from '../testing/extraction.js';
import { contextFor, template } from '../testing/context.js';
import type { RepeatCandidate, SameNumberCandidate } from './inputs.js';
import { idAccountComparison } from './id-account-comparison.js';
import { idInconsistentRepeatDetection } from './id-inconsistent-repeat-detection.js';
import { idInquiryComparison } from './id-inquiry-comparison.js';
import { idRepeatDetection } from './id-repeat-detection.js';
import { idSelfieComparison } from './id-selfie-comparison.js';

const candidate = (patch: Partial<RepeatCandidate>): RepeatCandidate => ({
  verificationId: 'ver_01ABCDEFGHJKMNPQRSTVWXYZ00',
  sameIdentificationNumber: false,
  phashDistance: null,
  sameAccount: false,
  ...patch,
});

describe('idRepeatDetection (C34)', () => {
  const lookups = { identificationNumberLookup: true, phashLookup: true };

  it('passes when no other account used the number', () => {
    expect(
      idRepeatDetection(contextFor({ history: { repeat: { ...lookups, candidates: [] } } })),
    ).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { matches: 0, lookups: ['identification-number'] },
      provenance: { thresholds: { 'phash-matching': false } },
    });
  });

  it('fails a number another account used, naming the earlier verification', () => {
    const result = idRepeatDetection(
      contextFor({
        history: {
          repeat: { ...lookups, candidates: [candidate({ sameIdentificationNumber: true })] },
        },
      }),
    );
    expect(result).toMatchObject({
      status: 'failed',
      reasons: ['id_repeat_detected'],
      metadata: {
        'matched-by': ['identification-number'],
        matches: 1,
        'matched-verification-ids': ['ver_01ABCDEFGHJKMNPQRSTVWXYZ00'],
      },
    });
  });

  it('ignores earlier uses by the same account', () => {
    expect(
      idRepeatDetection(
        contextFor({
          history: {
            repeat: {
              ...lookups,
              candidates: [candidate({ sameIdentificationNumber: true, sameAccount: true })],
            },
          },
        }),
      ).status,
    ).toBe('passed');
  });

  it('matches the front image within max-phash-distance only when configured', () => {
    const repeat = { ...lookups, candidates: [candidate({ phashDistance: 3 })] };
    expect(idRepeatDetection(contextFor({ history: { repeat } })).status).toBe('passed');
    const configured = template({ id_repeat_detection: { 'max-phash-distance': 4 } });
    expect(idRepeatDetection(contextFor({ history: { repeat } }, configured))).toMatchObject({
      status: 'failed',
      metadata: { 'matched-by': ['image'] },
      provenance: { thresholds: { 'max-phash-distance': 4 } },
    });
    const tight = template({ id_repeat_detection: { 'max-phash-distance': 2 } });
    expect(idRepeatDetection(contextFor({ history: { repeat } }, tight)).status).toBe('passed');
  });

  it('answers input_missing when the worker did not look the history up, or could not', () => {
    expect(idRepeatDetection(contextFor())).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
    expect(
      idRepeatDetection(
        contextFor({
          history: {
            repeat: { identificationNumberLookup: false, phashLookup: false, candidates: [] },
          },
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
  });
});

describe('idInconsistentRepeatDetection (C34)', () => {
  const same = (patch: Partial<SameNumberCandidate>): SameNumberCandidate => ({
    verificationId: 'ver_01ABCDEFGHJKMNPQRSTVWXYZ01',
    fields: { 'name-first': 'QUINN', 'name-last': 'VALEMONT', birthdate: '1990-02-14' },
    faceSimilarity: 0.8,
    ...patch,
  });

  it('passes earlier uses of the number by the same person and face', () => {
    expect(
      idInconsistentRepeatDetection(
        contextFor({ history: { inconsistentRepeat: { candidates: [same({})] } } }),
      ),
    ).toMatchObject({
      status: 'passed',
      metadata: { candidates: 1, 'face-compared': true },
      provenance: { thresholds: { 'face-threshold': 0.394 } },
    });
  });

  it.each([
    [
      { fields: { 'name-first': 'ROBIN', 'name-last': 'VALEMONT', birthdate: '1990-02-14' } },
      ['name-first'],
    ],
    [
      { fields: { 'name-first': 'QUINN', 'name-last': 'VALEMONT', birthdate: '1991-02-14' } },
      ['birthdate'],
    ],
    [{ faceSimilarity: 0.1 }, ['face']],
  ])('fails the same number with another identity (%j)', (patch, fields) => {
    expect(
      idInconsistentRepeatDetection(
        contextFor({ history: { inconsistentRepeat: { candidates: [same(patch)] } } }),
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['inconsistent_repeat_detected'],
      metadata: { 'disagreeing-fields': fields },
    });
  });

  it('compares names and birth dates only when the earlier files are gone (C31.9)', () => {
    expect(
      idInconsistentRepeatDetection(
        contextFor({
          history: { inconsistentRepeat: { candidates: [same({ faceSimilarity: null })] } },
        }),
      ),
    ).toMatchObject({ status: 'passed', metadata: { 'face-compared': false } });
  });

  it('never counts an earlier field that was not read as a difference', () => {
    expect(
      idInconsistentRepeatDetection(
        contextFor({
          history: {
            inconsistentRepeat: {
              candidates: [
                same({ fields: { 'name-first': null, 'name-last': 'VALEMONT', birthdate: null } }),
              ],
            },
          },
        }),
      ).status,
    ).toBe('passed');
  });

  it('answers input_missing without the lookup or without a number', () => {
    expect(idInconsistentRepeatDetection(contextFor())).toMatchObject({
      reasons: ['input_missing'],
    });
    expect(
      idInconsistentRepeatDetection(
        contextFor({
          extraction: extractionWith({}),
          history: { inconsistentRepeat: { candidates: [] } },
        }),
      ),
    ).toMatchObject({ reasons: ['input_missing'] });
  });
});

describe('idInquiryComparison and idAccountComparison (C34)', () => {
  const MATCHING = {
    name_first: 'Quinn',
    name_last: 'Valemont',
    birthdate: '1990-02-14',
    address_street_1: '12 Lantern Row',
    address_city: 'North Haven',
    identification_number: 'X12K45P78',
  };

  it.each([
    [
      'inquiry',
      idInquiryComparison,
      (fields: Record<string, unknown> | null) => ({ inquiryFields: fields }),
    ],
    [
      'account',
      idAccountComparison,
      (fields: Record<string, unknown> | null) => ({ accountFields: fields }),
    ],
  ] as const)('compares the %s fields with the extraction', (_label, check, references) => {
    expect(check(contextFor({ references: references(MATCHING) }))).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        'compared-fields': ['name', 'birthdate', 'address', 'identification-number'],
        'mismatched-fields': [],
      },
      provenance: {
        thresholds: {
          'name-threshold': 0.88,
          fields: ['name', 'birthdate', 'address', 'identification-number'],
        },
      },
    });
    expect(
      check(
        contextFor({
          references: references({ ...MATCHING, name_last: 'Ashgrove', birthdate: '1990-02-15' }),
        }),
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['name_mismatch', 'birthdate_mismatch'],
      metadata: { 'mismatched-fields': ['name', 'birthdate'] },
    });
    expect(check(contextFor({ references: references(null) }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
    });
    expect(check(contextFor())).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('tolerates a middle name the user left out, case and spelling noise within the threshold', () => {
    expect(
      idInquiryComparison(
        contextFor({
          references: {
            inquiryFields: { name_first: 'QUINN', name_middle: 'A', name_last: 'Valemond' },
          },
        }),
      ).status,
    ).toBe('passed');
  });

  it('compares only the configured fields', () => {
    const context = contextFor(
      { references: { inquiryFields: { ...MATCHING, birthdate: '1999-01-01' } } },
      template({ id_inquiry_comparison: { fields: ['name'] } }),
    );
    expect(idInquiryComparison(context)).toMatchObject({
      status: 'passed',
      metadata: { 'compared-fields': ['name'] },
    });
  });

  it('fails an address or a number that differs', () => {
    expect(
      idAccountComparison(
        contextFor({
          references: {
            accountFields: {
              ...MATCHING,
              address_street_1: '14 Lantern Row',
              identification_number: 'Y12K45P78',
            },
          },
        }),
      ),
    ).toMatchObject({ reasons: ['address_mismatch', 'identification_number_mismatch'] });
  });

  it('answers no_reference_data when the reference has none of the compared fields', () => {
    expect(
      idInquiryComparison(
        contextFor({ references: { inquiryFields: { email_address: 'x@example.com' } } }),
      ),
    ).toMatchObject({
      reasons: ['no_reference_data'],
    });
  });

  it('answers input_missing when the reference has data the extraction lacks', () => {
    expect(
      idInquiryComparison(
        contextFor({ extraction: extractionWith({}), references: { inquiryFields: MATCHING } }),
      ),
    ).toMatchObject({ reasons: ['input_missing'] });
  });

  it('never puts a value in the result', () => {
    const serialized = JSON.stringify(
      idAccountComparison(
        contextFor({ references: { accountFields: { ...MATCHING, name_last: 'Ashgrove' } } }),
      ),
    );
    for (const value of ['Ashgrove', 'Valemont', 'VALEMONT', '1990']) {
      expect(serialized).not.toContain(value);
    }
  });
});

describe('idSelfieComparison (C34)', () => {
  const portrait = () => {
    const face = goldenAnalysis().sides.front.portrait;
    if (face === null) {
      throw new Error('the golden fixture has a portrait');
    }
    return face;
  };

  it("passes the inquiry's selfie of the same face, with its similarity and models", () => {
    const recognizer = { id: 'sface-2021dec', sha256: 'f'.repeat(64) };
    const result = idSelfieComparison(
      contextFor({
        selfie: { face: portrait(), verificationId: 'ver_01SELFIE00000000000000000' },
        models: { faceRecognizer: recognizer },
      }),
    );
    expect(result).toMatchObject({
      status: 'passed',
      stage: 'beta',
      metadata: { similarity: 1, 'selfie-verification-id': 'ver_01SELFIE00000000000000000' },
      provenance: { models: [recognizer], thresholds: { threshold: 0.394 } },
    });
    expect(result.confidence).toBe(1);
  });

  it('reads the shared FACE_MATCH_DEFAULTS threshold and records its basis (v2, C39.3)', () => {
    const selfie = { face: portrait(), verificationId: 'ver_01SELFIE00000000000000000' };
    const result = idSelfieComparison(contextFor({ selfie }));
    expect(result.provenance).toMatchObject({
      'implementation-version': 2,
      thresholds: { threshold: FACE_MATCH_DEFAULTS.threshold },
      'threshold-basis': { threshold: FACE_MATCH_DEFAULTS.basis },
    });
    const configured = idSelfieComparison(
      contextFor({ selfie }, template({ id_selfie_comparison: { threshold: 0.5 } })),
    );
    expect(configured.provenance.thresholds).toEqual({ threshold: 0.5 });
    expect(configured.provenance).not.toHaveProperty('threshold-basis');
  });

  it('fails a different face', () => {
    const face = portrait();
    const other = {
      ...face,
      embedding: face.embedding.map((value, index) => (index % 2 === 0 ? -value : value)),
    };
    expect(
      idSelfieComparison(
        contextFor({ selfie: { face: other, verificationId: 'ver_01SELFIE00000000000000000' } }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['face_mismatch'] });
  });

  it('answers input_missing without a selfie, without its face or without the portrait (C34)', () => {
    expect(idSelfieComparison(contextFor())).toMatchObject({ reasons: ['input_missing'] });
    expect(idSelfieComparison(contextFor({ selfie: null }))).toMatchObject({
      reasons: ['input_missing'],
    });
    expect(
      idSelfieComparison(
        contextFor({ selfie: { face: null, verificationId: 'ver_01SELFIE00000000000000000' } }),
      ),
    ).toMatchObject({ reasons: ['input_missing'] });
    const analysis = goldenAnalysis();
    analysis.sides.front.portrait = null;
    expect(
      idSelfieComparison(
        contextFor({
          analysis,
          selfie: { face: portrait(), verificationId: 'ver_01SELFIE00000000000000000' },
        }),
      ),
    ).toMatchObject({ reasons: ['input_missing'] });
  });
});
