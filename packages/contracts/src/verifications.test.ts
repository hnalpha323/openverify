import { EXTRACTION_FIELDS, getCheckDefinition, type ExtractedFields } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';
import {
  GOVERNMENT_ID_EXTRACTION_ATTRIBUTES,
  PII_VERIFICATION_ATTRIBUTES,
  buildFlowVerificationResource,
  buildVerificationResource,
  flowVerificationDocumentSchema,
  flowVerificationResourceSchema,
  retryHintSchema,
  retryHintsFromChecks,
  verificationCheckSchema,
  verificationDocumentSchema,
  verificationResourceSchema,
  type VerificationCheck,
} from './verifications.js';

const passed = (name: string): VerificationCheck =>
  ({
    name,
    status: 'passed',
    reasons: [],
    requirement: 'required',
    metadata: {},
  }) as VerificationCheck;

const governmentId = {
  type: 'verification/government-id',
  id: IDS.governmentIdFailed,
  attributes: {
    status: 'failed',
    country: 'US',
    'id-class': 'drivers_license',
    checks: [
      {
        name: 'id_blur_detection',
        status: 'failed',
        reasons: ['image_blurry'],
        requirement: 'required',
        metadata: { side: 'front', blur_score: 41.7 },
      },
      passed('id_glare_detection'),
      passed('id_portrait_detection'),
      passed('id_double_side_detection'),
    ],
    'created-at': AT_ISO,
    'updated-at': LATER_ISO,
  },
  relationships: {
    inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
    files: {
      data: [
        { type: 'file', id: IDS.frontFailed },
        { type: 'file', id: IDS.backFailed },
      ],
    },
  },
};

const selfie = {
  type: 'verification/selfie',
  id: IDS.selfie,
  attributes: {
    status: 'passed',
    checks: [
      passed('selfie_image_quality_detection'),
      passed('selfie_multiple_faces_detection'),
      {
        name: 'selfie_id_comparison',
        status: 'passed',
        reasons: [],
        requirement: 'required',
        metadata: { similarity: 0.71, threshold: 0.363 },
      },
    ],
    'created-at': AT_ISO,
    'updated-at': LATER_ISO,
  },
  relationships: {
    inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
    files: { data: [{ type: 'file', id: IDS.selfieCenter }] },
  },
};

/**
 * What a server sends for a resource built from records stored before Phase 3: every check with
 * the registry's stage and no confidence or provenance (C29.2), and for a government ID every
 * extraction attribute, `null` (C31.5).
 */
function served<R extends { type: string; attributes: { checks: { name: string }[] } }>(
  resource: R,
): R {
  const extraction =
    resource.type === 'verification/government-id'
      ? {
          ...Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null])),
          'extraction-sources': null,
        }
      : {};
  return {
    ...resource,
    attributes: {
      ...resource.attributes,
      ...extraction,
      checks: resource.attributes.checks.map((check) => ({
        ...check,
        stage: getCheckDefinition(check.name)?.stage,
        confidence: null,
        provenance: null,
        // C50.8: derived from the registry at read time.
        category: getCheckDefinition(check.name)?.category,
      })),
    },
  };
}

describe('verification checks (C2)', () => {
  it('carry name, status, reasons, requirement and metadata', () => {
    const check = governmentId.attributes.checks[0];
    expect(verificationCheckSchema.parse(check)).toEqual(check);
  });

  it.each([
    ['an unregistered check', { name: 'id_magic_detection' }],
    ['a non-snake_case reason', { reasons: ['Image blurry'] }],
    ['an unknown requirement', { requirement: 'optional' }],
    ['the check type', { type: 'user_behavior' }],
  ])('rejects %s', (_name, change) => {
    expect(
      verificationCheckSchema.safeParse({ ...passed('id_blur_detection'), ...change }).success,
    ).toBe(false);
  });
});

describe('verification resources', () => {
  it('describe government ID and selfie verifications', () => {
    expect(verificationResourceSchema.parse(governmentId)).toEqual(governmentId);
    expect(verificationResourceSchema.parse(selfie)).toEqual(selfie);
    expect(verificationDocumentSchema.safeParse({ data: governmentId }).success).toBe(true);
  });

  it('allow an unknown country and ID class', () => {
    const value = {
      ...governmentId,
      attributes: { ...governmentId.attributes, country: null, 'id-class': null },
    };
    expect(verificationResourceSchema.safeParse(value).success).toBe(true);
  });

  it('keep government ID attributes off selfies', () => {
    const value = { ...selfie, attributes: { ...selfie.attributes, country: 'US' } };
    expect(verificationResourceSchema.safeParse(value).success).toBe(false);
  });

  it('only carry checks of their own verification type', () => {
    const value = {
      ...selfie,
      attributes: { ...selfie.attributes, checks: [passed('id_blur_detection')] },
    };
    const result = verificationResourceSchema.safeParse(value);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'check "id_blur_detection" belongs to government_id verifications',
    ]);
  });

  it('report each check once', () => {
    const value = {
      ...selfie,
      attributes: {
        ...selfie.attributes,
        checks: [passed('selfie_id_comparison'), passed('selfie_id_comparison')],
      },
    };
    expect(verificationResourceSchema.safeParse(value).success).toBe(false);
  });

  it('may include their files', () => {
    const file = {
      type: 'file',
      id: IDS.selfieCenter,
      attributes: {
        kind: 'selfie-center',
        'mime-type': 'image/png',
        'byte-size': 1024,
        'created-at': AT_ISO,
        'capture-method': null,
        'capture-trigger': null,
      },
      relationships: { verification: { data: { type: 'verification/selfie', id: IDS.selfie } } },
    };
    expect(verificationDocumentSchema.safeParse({ data: selfie, included: [file] }).success).toBe(
      true,
    );
  });

  it('are built from verification records', () => {
    expect(
      buildVerificationResource({
        id: IDS.governmentIdFailed,
        type: 'government_id',
        status: 'failed',
        inquiryId: IDS.inquiry,
        fileIds: [IDS.frontFailed, IDS.backFailed],
        country: 'US',
        idClass: 'drivers_license',
        checks: [
          {
            name: 'id_blur_detection',
            status: 'failed',
            reasons: ['image_blurry'],
            required: true,
            metadata: { side: 'front', blur_score: 41.7 },
          },
          {
            name: 'id_glare_detection',
            status: 'passed',
            reasons: [],
            required: true,
            metadata: {},
          },
          {
            name: 'id_portrait_detection',
            status: 'passed',
            reasons: [],
            required: true,
            metadata: {},
          },
          {
            name: 'id_double_side_detection',
            status: 'passed',
            reasons: [],
            required: true,
            metadata: {},
          },
        ],
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(served(governmentId));

    expect(
      buildVerificationResource({
        id: IDS.selfie,
        type: 'selfie',
        status: 'passed',
        inquiryId: IDS.inquiry,
        fileIds: [IDS.selfieCenter],
        checks: selfie.attributes.checks.map(({ requirement, ...check }) => ({
          ...check,
          status: 'passed' as const,
          required: requirement === 'required',
        })),
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(served(selfie));
  });

  it('default the government ID country and class to null', () => {
    const built = buildVerificationResource({
      id: IDS.governmentId,
      type: 'government_id',
      status: 'initiated',
      inquiryId: IDS.inquiry,
      fileIds: [],
      checks: [],
      createdAt: AT,
      updatedAt: AT,
    });
    expect(built.attributes).toMatchObject({ country: null, 'id-class': null });
  });
});

describe('from-rejected-handoff (C96.3)', () => {
  const record = {
    id: IDS.governmentIdFailed,
    type: 'government_id' as const,
    status: 'submitted' as const,
    inquiryId: IDS.inquiry,
    fileIds: [],
    checks: [],
    createdAt: AT,
    updatedAt: LATER,
  };

  it('is built on every verification read, true for one the phone created before a rejection', () => {
    expect(
      buildVerificationResource({ ...record, fromRejectedHandoff: true }).attributes,
    ).toMatchObject({ 'from-rejected-handoff': true });
    expect(
      buildVerificationResource({ ...record, fromRejectedHandoff: false }).attributes,
    ).toMatchObject({ 'from-rejected-handoff': false });
  });

  it('parses on every type, and is optional so earlier answers still parse', () => {
    const { attributes } = buildVerificationResource(record);
    expect(attributes).not.toHaveProperty('from-rejected-handoff');
    for (const type of ['selfie', 'phone_number', 'document'] as const) {
      const attributes = buildVerificationResource({
        ...record,
        type,
        fromRejectedHandoff: true,
      }).attributes;
      expect(attributes).toMatchObject({ 'from-rejected-handoff': true });
    }
  });

  it('is not PII, and never reaches the flow view', () => {
    expect(PII_VERIFICATION_ATTRIBUTES).not.toContain('from-rejected-handoff');
    const flow = buildFlowVerificationResource(record);
    expect(flow.attributes).not.toHaveProperty('from-rejected-handoff');
  });
});

describe('retry hints (C3)', () => {
  it('name only user_behavior checks', () => {
    expect(
      retryHintSchema.safeParse({ name: 'id_blur_detection', reasons: ['image_blurry'] }).success,
    ).toBe(true);
    expect(
      retryHintSchema.safeParse({ name: 'selfie_id_comparison', reasons: ['face_mismatch'] })
        .success,
    ).toBe(false);
  });

  it('come from failed, required user_behavior checks and never reveal fraud checks', () => {
    const checks: VerificationCheck[] = [
      {
        name: 'id_blur_detection',
        status: 'failed',
        reasons: ['image_blurry'],
        requirement: 'required',
        metadata: {},
      },
      {
        name: 'id_glare_detection',
        status: 'failed',
        reasons: ['glare_present'],
        requirement: 'not_required',
        metadata: {},
      },
      {
        name: 'id_portrait_detection',
        status: 'failed',
        reasons: ['portrait_not_present'],
        requirement: 'required',
        metadata: {},
      },
      {
        name: 'id_double_side_detection',
        status: 'passed',
        reasons: [],
        requirement: 'required',
        metadata: {},
      },
    ];
    expect(retryHintsFromChecks(checks)).toEqual([
      { name: 'id_blur_detection', reasons: ['image_blurry'] },
    ]);
  });
});

describe('flow verification resources (C3)', () => {
  const flowView = {
    type: 'verification/government-id',
    id: IDS.governmentIdFailed,
    attributes: {
      status: 'failed',
      'retry-hints': [{ name: 'id_blur_detection', reasons: ['image_blurry'] }],
      'created-at': AT_ISO,
      'updated-at': LATER_ISO,
    },
  };

  it('expose status and retry hints only', () => {
    expect(flowVerificationResourceSchema.parse(flowView)).toEqual(flowView);
    expect(flowVerificationDocumentSchema.safeParse({ data: flowView }).success).toBe(true);
    expect(flowVerificationResourceSchema.safeParse(governmentId).success).toBe(false);
  });

  it('are built from verification records without fraud details', () => {
    expect(
      buildFlowVerificationResource({
        id: IDS.governmentIdFailed,
        type: 'government_id',
        status: 'failed',
        checks: [
          {
            name: 'id_blur_detection',
            status: 'failed',
            reasons: ['image_blurry'],
            required: true,
            metadata: {},
          },
          {
            name: 'id_portrait_detection',
            status: 'failed',
            reasons: ['portrait_not_present'],
            required: true,
            metadata: {},
          },
        ],
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(flowView);
  });

  it('build selfie views too', () => {
    const built = buildFlowVerificationResource({
      id: IDS.selfie,
      type: 'selfie',
      status: 'initiated',
      checks: [],
      createdAt: AT,
      updatedAt: AT,
    });
    expect(built).toEqual({
      type: 'verification/selfie',
      id: IDS.selfie,
      attributes: {
        status: 'initiated',
        'retry-hints': [],
        'created-at': AT_ISO,
        'updated-at': AT_ISO,
      },
    });
  });
});

describe('check stage, confidence and provenance (C29.2)', () => {
  const provenance = { 'implementation-version': 1, thresholds: { 'min-blur-score': 100 } };

  it('are optional on a check, so earlier answers still parse', () => {
    expect(verificationCheckSchema.safeParse(passed('id_blur_detection')).success).toBe(true);
    for (const extra of [
      { stage: 'beta', confidence: 0.91, provenance },
      { stage: 'ga', confidence: null, provenance: null },
    ]) {
      expect(
        verificationCheckSchema.safeParse({ ...passed('id_portrait_detection'), ...extra }).success,
      ).toBe(true);
    }
    expect(verificationResourceSchema.parse(governmentId)).toEqual(governmentId);
  });

  it.each([
    ['an unknown stage', { stage: 'alpha' }],
    ['a confidence above 1', { confidence: 1.2 }],
    ['a provenance without its implementation version', { provenance: { thresholds: {} } }],
  ])('reject %s', (_label, change) => {
    expect(
      verificationCheckSchema.safeParse({ ...passed('id_blur_detection'), ...change }).success,
    ).toBe(false);
  });

  it('are built from the record; a stored row without a stage takes it from the registry', () => {
    const built = buildVerificationResource({
      id: IDS.governmentId,
      type: 'government_id',
      status: 'passed',
      inquiryId: IDS.inquiry,
      fileIds: [],
      checks: [
        { name: 'id_blur_detection', status: 'passed', reasons: [], required: true, metadata: {} },
        {
          name: 'id_portrait_detection',
          status: 'passed',
          reasons: [],
          required: true,
          metadata: {},
          stage: null,
          confidence: null,
          provenance: null,
        },
        {
          name: 'id_glare_detection',
          status: 'passed',
          reasons: [],
          required: true,
          metadata: {},
          stage: 'ga',
          confidence: 0.75,
          provenance,
        },
      ],
      createdAt: AT,
      updatedAt: AT,
    });
    expect(built.attributes.checks).toEqual([
      expect.objectContaining({ stage: 'ga', confidence: null, provenance: null }),
      expect.objectContaining({ stage: 'beta', confidence: null, provenance: null }),
      expect.objectContaining({ stage: 'ga', confidence: 0.75, provenance }),
    ]);
  });

  it('never reach the flow view', () => {
    const built = buildFlowVerificationResource({
      id: IDS.governmentId,
      type: 'government_id',
      status: 'failed',
      checks: [
        {
          name: 'id_blur_detection',
          status: 'failed',
          reasons: ['image_blurry'],
          required: true,
          metadata: {},
          stage: 'ga',
          confidence: 0.4,
          provenance,
        },
      ],
      createdAt: AT,
      updatedAt: AT,
    });
    const serialized = JSON.stringify(built);
    for (const field of ['stage', 'confidence', 'provenance', 'min-blur-score']) {
      expect(serialized).not.toContain(field);
    }
  });
});

describe('extraction attributes of a government ID (C31.5, C31.6)', () => {
  /** A fictional holder of the sandbox test issuer Utopia; no real person. */
  const fields: ExtractedFields = {
    'name-first': 'QUINN',
    'name-middle': null,
    'name-last': 'VALEMONT',
    birthdate: '1990-02-14',
    sex: 'X',
    nationality: 'UTO',
    'identification-number': 'X12K45P78',
    'personal-number': null,
    'issue-date': '2024-03-01',
    'expiration-date': '2034-02-28',
    'issuing-authority-code': 'UTO',
    'address-street-1': '12 LANTERN ROW',
    'address-street-2': null,
    'address-city': 'NORTH HAVEN',
    'address-subdivision': null,
    'address-postal-code': 'UT 1024',
    'address-country-code': null,
    endorsements: null,
    restrictions: null,
    'vehicle-class': null,
  };
  const sources = { birthdate: ['mrz', 'viz'], 'name-last': ['mrz', 'viz'] } as const;
  const record = (extraction?: Parameters<typeof buildVerificationResource>[0]['extraction']) =>
    buildVerificationResource({
      id: IDS.governmentId,
      type: 'government_id',
      status: 'passed',
      inquiryId: IDS.inquiry,
      fileIds: [],
      checks: [],
      ...(extraction === undefined ? {} : { extraction }),
      createdAt: AT,
      updatedAt: AT,
    });

  it('names every C31.5 field as a PII attribute, and not the sources', () => {
    expect(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES).toEqual(EXTRACTION_FIELDS);
    expect(GOVERNMENT_ID_EXTRACTION_ATTRIBUTES).not.toContain('extraction-sources');
  });

  it('are built from the extraction, with the sources that agreed', () => {
    const built = record({ fields, sources });
    expect(built.attributes).toMatchObject({ ...fields, 'extraction-sources': sources });
    expect(verificationResourceSchema.parse(built)).toEqual(built);
  });

  it('are null without an extraction, and every value is null after redaction', () => {
    const none = record();
    const redacted = record({ fields: null, sources });
    for (const field of EXTRACTION_FIELDS) {
      expect(none.attributes, field).toHaveProperty(field, null);
      expect(redacted.attributes, field).toHaveProperty(field, null);
    }
    expect(none.attributes).toHaveProperty('extraction-sources', null);
    expect(redacted.attributes).toHaveProperty('extraction-sources', sources);
  });

  it('are optional, so earlier answers still parse, and nullable', () => {
    expect(verificationResourceSchema.parse(governmentId)).toEqual(governmentId);
    const masked = {
      ...governmentId,
      attributes: {
        ...governmentId.attributes,
        ...Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null])),
        'extraction-sources': null,
      },
    };
    expect(verificationResourceSchema.safeParse(masked).success).toBe(true);
  });

  it.each([
    ['a malformed birthdate', { birthdate: '14/02/1990' }],
    ['an unknown source', { 'extraction-sources': { birthdate: ['ocr'] } }],
    ['an unknown extraction field', { 'eye-color': 'BRO' }],
  ])('reject %s', (_label, change) => {
    const value = { ...governmentId, attributes: { ...governmentId.attributes, ...change } };
    expect(verificationResourceSchema.safeParse(value).success).toBe(false);
  });

  it('stay off selfies', () => {
    const value = { ...selfie, attributes: { ...selfie.attributes, 'name-last': 'VALEMONT' } };
    expect(verificationResourceSchema.safeParse(value).success).toBe(false);
  });

  it('never reach the flow view', () => {
    const built = buildFlowVerificationResource({
      id: IDS.governmentId,
      type: 'government_id',
      status: 'passed',
      checks: [],
      createdAt: AT,
      updatedAt: AT,
    });
    for (const field of [...EXTRACTION_FIELDS, 'extraction-sources']) {
      expect(built.attributes, field).not.toHaveProperty(field);
    }
    const leaked = {
      ...built,
      attributes: { ...built.attributes, 'name-last': 'VALEMONT' },
    };
    expect(flowVerificationResourceSchema.safeParse(leaked).success).toBe(false);
  });
});
