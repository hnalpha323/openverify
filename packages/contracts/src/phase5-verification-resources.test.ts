/**
 * C50.6: no strict decoder meets an unknown type. Every union that lists verification resources
 * takes the nine Phase 5 types, built from records like the Phase 1 ones, and each check carries
 * its C50.8 category, derived at read time.
 */
import { CHECK_REGISTRY, getCheckDefinition, listChecks } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { dashboardInquiryDocumentSchema } from './dashboard-api.js';
import { eventPayloadSchema, redactedResourceStubSchema } from './events.js';
import { verificationIdentifierSchema } from './identifiers.js';
import { inquiryDocumentSchema, inquiryIncludeDocumentSchema } from './inquiries.js';
import { RESOURCE_TYPES } from './resource-types.js';
import { AT, AT_ISO, IDS } from './test-support.js';
import {
  SUPPORTED_VERIFICATION_TYPES,
  toVerificationResourceType,
  type SupportedVerificationType,
} from './verification-types.js';
import {
  buildFlowVerificationResource,
  buildVerificationResource,
  flowVerificationResourceSchema,
  verificationCheckSchema,
  verificationDocumentSchema,
  verificationResourceSchema,
} from './verifications.js';

const PHASE5_TYPES: readonly SupportedVerificationType[] = SUPPORTED_VERIFICATION_TYPES.filter(
  (type: string) => type !== 'government_id' && type !== 'selfie',
);

/** The first check of a type, as a stored record. */
function recordOf(type: SupportedVerificationType) {
  const [first] = listChecks(type);
  return {
    id: IDS.governmentId,
    type,
    status: 'submitted' as const,
    inquiryId: IDS.inquiry,
    fileIds: [],
    checks: first
      ? [{ name: first.id, status: 'passed' as const, reasons: [], required: true, metadata: {} }]
      : [],
    createdAt: AT,
    updatedAt: AT,
  };
}

describe('the nine Phase 5 verification types in every union (C50.6)', () => {
  it('are the eleven supported types but government ID and selfie', () => {
    expect(PHASE5_TYPES).toEqual([
      'document',
      'database',
      'aamva',
      'phone_number',
      'email_address',
      'government_id_nfc',
      'crypto_wallet',
      'database_business',
      'business_website',
    ]);
  });

  it.each(PHASE5_TYPES)('build and parse a %s verification, full and flow views', (type) => {
    const full = buildVerificationResource(recordOf(type));
    expect(full.type).toBe(toVerificationResourceType(type));
    expect(verificationResourceSchema.parse(full)).toEqual(full);
    expect(verificationDocumentSchema.safeParse({ data: full }).success).toBe(true);

    const flow = buildFlowVerificationResource(recordOf(type));
    expect(flow.type).toBe(full.type);
    expect(flowVerificationResourceSchema.parse(flow)).toEqual(flow);
    expect(flow.attributes).not.toHaveProperty('checks');
  });

  it.each(PHASE5_TYPES)('refuse a check of another type on a %s verification', (type) => {
    const full = buildVerificationResource(recordOf(type));
    const foreign = { ...full.attributes.checks[0], name: 'id_blur_detection' };
    expect(
      verificationResourceSchema.safeParse({
        ...full,
        attributes: { ...full.attributes, checks: [foreign] },
      }).success,
    ).toBe(false);
  });

  it.each(PHASE5_TYPES)('take a %s verification in every resource union', (type) => {
    const verification = buildVerificationResource(recordOf(type));
    const inquiry = {
      type: 'inquiry',
      id: IDS.inquiry,
      attributes: {
        status: 'pending',
        'reference-id': null,
        fields: {},
        'created-at': AT_ISO,
        'updated-at': AT_ISO,
      },
      relationships: {
        'inquiry-template': { data: { type: 'inquiry-template', id: IDS.template } },
        verifications: { data: [{ type: verification.type, id: verification.id }] },
      },
    };
    expect(
      inquiryDocumentSchema.safeParse({ data: inquiry, included: [verification] }).success,
    ).toBe(true);
    expect(
      inquiryIncludeDocumentSchema.safeParse({ data: inquiry, included: [verification] }).success,
    ).toBe(true);
    expect(
      dashboardInquiryDocumentSchema.safeParse({ data: inquiry, included: [verification] }).success,
    ).toBe(true);
    expect(eventPayloadSchema.safeParse({ data: verification }).success).toBe(true);
    expect(eventPayloadSchema.safeParse({ data: inquiry, included: [verification] }).success).toBe(
      true,
    );
    expect(
      redactedResourceStubSchema.safeParse({
        type: verification.type,
        id: verification.id,
        attributes: { 'redacted-at': AT_ISO },
      }).success,
    ).toBe(true);
    expect(
      verificationIdentifierSchema.safeParse({ type: verification.type, id: verification.id })
        .success,
    ).toBe(true);
    expect(RESOURCE_TYPES).toContain(verification.type);
  });

  it('still refuse the old business type and an unknown one', () => {
    for (const type of ['verification/business', 'verification/unknown']) {
      expect(verificationIdentifierSchema.safeParse({ type, id: IDS.governmentId }).success).toBe(
        false,
      );
    }
  });
});

describe('check categories (C50.8)', () => {
  it('are served on every check, derived from the registry at read time', () => {
    for (const type of SUPPORTED_VERIFICATION_TYPES) {
      const built = buildVerificationResource(recordOf(type));
      for (const check of built.attributes.checks) {
        expect(check.category, check.name).toBe(getCheckDefinition(check.name)?.category);
      }
    }
    const document = buildVerificationResource(recordOf('document'));
    expect(document.attributes.checks[0]).toMatchObject({
      name: 'document_type_detection',
      category: 'validity',
    });
  });

  it('are optional, so earlier answers still parse, and refuse an unknown value', () => {
    const check = {
      name: 'id_blur_detection',
      status: 'passed',
      reasons: [],
      requirement: 'required',
      metadata: {},
    };
    expect(verificationCheckSchema.safeParse(check).success).toBe(true);
    expect(verificationCheckSchema.safeParse({ ...check, category: 'validity' }).success).toBe(
      true,
    );
    expect(verificationCheckSchema.safeParse({ ...check, category: 'risk' }).success).toBe(false);
  });

  it('cover every registered check', () => {
    expect(CHECK_REGISTRY.every((check) => check.category.length > 0)).toBe(true);
  });
});
