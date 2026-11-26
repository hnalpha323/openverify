/**
 * The Phase 3 government ID surface through the client: the `needs_review` status (C30.4), each
 * check's stage, confidence and provenance (C29.2), and the extracted fields with their sources
 * (C31.5), typed and read from the golden fixture. Every value is synthetic.
 */
import { VERIFICATION_RESOURCE_TYPES, buildVerificationResource } from '@openverify/contracts';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createClient } from './client.js';
import { apiFixture, scriptedFetch } from './test-support.js';
import {
  EXTRACTION_ATTRIBUTES,
  extractionOf,
  isGovernmentIdVerification,
  isVerificationOfType,
  type AamvaVerification,
  type BusinessWebsiteVerification,
  type CheckCategory,
  type CheckProvenance,
  type Connection,
  type ConnectEventName,
  type ConsentRecord,
  isConnectEventName,
  type ShareToken,
  type CheckStage,
  type CryptoWalletVerification,
  type DatabaseBusinessVerification,
  type DatabaseVerification,
  type DocumentVerification,
  type EmailAddressVerification,
  type GovernmentIdNfcVerification,
  type PhoneNumberVerification,
  type VerificationOf,
  type VerificationResourceType,
  type ExtractionField,
  type ExtractionSource,
  type GovernmentIdVerification,
  type InquiryStatus,
  type SelfieCapture,
  type SelfieCaptureStatus,
  type SelfieVerification,
  type VerificationStatus,
} from './types.js';

const AT = new Date('2026-10-20T12:00:00.000Z');

function client(body: unknown) {
  return createClient({
    apiKey: 'ov_sbx_synthetic_node_types_key',
    baseUrl: 'https://openverify.example.test',
    fetch: scriptedFetch([{ status: 200, body }]).fetch,
  });
}

describe('the Phase 3 types (C29.2, C30.4, C31.5)', () => {
  it('names the statuses, with needs_review', () => {
    expectTypeOf<'needs_review'>().toExtend<VerificationStatus>();
    expectTypeOf<'needs_review'>().toExtend<InquiryStatus>();
    expectTypeOf<CheckStage>().toEqualTypeOf<'ga' | 'beta' | 'sunset'>();
    expectTypeOf<ExtractionSource>().toEqualTypeOf<'mrz' | 'barcode' | 'viz' | 'nfc'>();
    expectTypeOf<'identification-number'>().toExtend<ExtractionField>();
    expectTypeOf<CheckProvenance['implementation-version']>().toEqualTypeOf<number>();
  });

  it('reads a government ID with its extraction and each check with its stage and provenance', async () => {
    const document = await client(apiFixture('verification-government-id')).verifications.retrieve(
      'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
    );

    const verification = document.data;
    expect(isGovernmentIdVerification(verification)).toBe(true);
    if (!isGovernmentIdVerification(verification)) {
      return;
    }
    expectTypeOf(verification.attributes['name-last']).toEqualTypeOf<string | null | undefined>();
    expect(extractionOf(verification)).toEqual({
      fields: expect.objectContaining({
        'name-first': 'JORDAN',
        'name-last': 'TESTWORTH',
        'identification-number': 'Y9876543',
        'issuing-authority-code': '636014',
        'personal-number': null,
      }) as unknown,
      sources: { 'name-first': ['barcode', 'viz'], 'name-last': ['barcode', 'viz'] },
    });
    expect(Object.keys(extractionOf(verification).fields)).toEqual([...EXTRACTION_ATTRIBUTES]);
    expect(verification.attributes.checks[0]).toMatchObject({
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: { 'min-blur-score': 100 } },
    });
  });

  it('reads a selfie as not a government ID, and an absent or masked extraction as null fields', () => {
    const selfie = buildVerificationResource({
      id: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
      type: 'selfie',
      status: 'needs_review',
      inquiryId: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
      fileIds: [],
      checks: [],
      createdAt: AT,
      updatedAt: AT,
    });
    const governmentId = buildVerificationResource({
      id: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
      type: 'government_id',
      status: 'needs_review',
      inquiryId: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
      fileIds: [],
      checks: [],
      createdAt: AT,
      updatedAt: AT,
    });

    expect(isGovernmentIdVerification(selfie)).toBe(false);
    expect(isGovernmentIdVerification(governmentId)).toBe(true);
    const extraction = extractionOf(governmentId as GovernmentIdVerification);
    expect(Object.values(extraction.fields).every((value) => value === null)).toBe(true);
    expect(extraction.sources).toEqual({});
  });
});

describe('the Phase 4 selfie types (C40)', () => {
  it('describe the selfie capture and the selfie verification attributes', () => {
    const capture: SelfieCapture = {
      type: 'selfie',
      id: 'self_01M5CJXHG07XPHF3HRM6NREDH9',
      attributes: {
        status: 'processed',
        'capture-method': 'camera',
        liveness: 'active',
        prompts: ['center', 'left', 'right'],
        'prompt-timings': [],
        'created-at': '2026-10-21T12:00:00.000Z',
        'expires-at': '2026-10-21T12:03:00.000Z',
        'submitted-at': null,
        'processed-at': null,
        'error-code': null,
      },
      relationships: {
        verification: {
          data: { type: 'verification/selfie', id: 'ver_01M5CJXHG07XPHF3HRM6NREDH8' },
        },
        inquiry: { data: { type: 'inquiry', id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7' } },
      },
    };
    const score: SelfieVerification['attributes']['liveness-score'] = 0.97;
    const status: SelfieCaptureStatus = capture.attributes.status;
    expect([status, score]).toEqual(['processed', 0.97]);
  });
});

describe('the Phase 5 verification types (C50.6, C51.1)', () => {
  /** Each resource type with its golden API fixture. */
  const FIXTURES = [
    ['verification/government-id', 'verification-government-id'],
    ['verification/selfie', 'verification-selfie'],
    ['verification/document', 'verification-document'],
    ['verification/database', 'verification-database'],
    ['verification/aamva', 'verification-aamva'],
    ['verification/phone-number', 'verification-phone-number'],
    ['verification/email-address', 'verification-email-address'],
    ['verification/government-id-nfc', 'verification-government-id-nfc'],
    ['verification/crypto-wallet', 'verification-crypto-wallet'],
    ['verification/database-business', 'verification-database-business'],
    ['verification/business-website', 'verification-business-website'],
  ] as const satisfies readonly (readonly [VerificationResourceType, string])[];

  it('name every resource type, each narrowed type and the check categories', () => {
    expect(FIXTURES.map(([type]) => type)).toEqual([...VERIFICATION_RESOURCE_TYPES]);
    expectTypeOf<VerificationResourceType>().toEqualTypeOf<
      (typeof VERIFICATION_RESOURCE_TYPES)[number]
    >();
    expectTypeOf<CheckCategory>().toEqualTypeOf<
      'biometrics' | 'fraud' | 'user_action_required' | 'validity'
    >();
    expectTypeOf<DocumentVerification['type']>().toEqualTypeOf<'verification/document'>();
    expectTypeOf<DatabaseVerification['type']>().toEqualTypeOf<'verification/database'>();
    expectTypeOf<AamvaVerification['type']>().toEqualTypeOf<'verification/aamva'>();
    expectTypeOf<PhoneNumberVerification['type']>().toEqualTypeOf<'verification/phone-number'>();
    expectTypeOf<EmailAddressVerification['type']>().toEqualTypeOf<'verification/email-address'>();
    expectTypeOf<
      GovernmentIdNfcVerification['type']
    >().toEqualTypeOf<'verification/government-id-nfc'>();
    expectTypeOf<CryptoWalletVerification['type']>().toEqualTypeOf<'verification/crypto-wallet'>();
    expectTypeOf<
      DatabaseBusinessVerification['type']
    >().toEqualTypeOf<'verification/database-business'>();
    expectTypeOf<
      BusinessWebsiteVerification['type']
    >().toEqualTypeOf<'verification/business-website'>();
    expectTypeOf<VerificationOf<'verification/selfie'>>().toEqualTypeOf<SelfieVerification>();
  });

  it.each(FIXTURES)(
    'reads %s from its golden fixture, recognised by its own type only',
    async (type, fixture) => {
      const document = await client(apiFixture(fixture)).verifications.retrieve(
        'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
      );

      const verification = document.data;
      expect(verification.type).toBe(type);
      expect(isVerificationOfType(verification, type)).toBe(true);
      for (const other of VERIFICATION_RESOURCE_TYPES.filter((each) => each !== type)) {
        expect(isVerificationOfType(verification, other)).toBe(false);
      }
      expect(isGovernmentIdVerification(verification)).toBe(type === 'verification/government-id');
      const categories: (CheckCategory | undefined)[] = verification.attributes.checks.map(
        (check) => check.category,
      );
      expect(categories.length).toBeGreaterThan(0);
      expect(categories.every((category) => category !== undefined)).toBe(true);
    },
  );

  it('narrows to the attributes of the type it names', async () => {
    const document = await client(apiFixture('verification-crypto-wallet')).verifications.retrieve(
      'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
    );

    const verification = document.data;
    expect(isVerificationOfType(verification, 'verification/crypto-wallet')).toBe(true);
    if (isVerificationOfType(verification, 'verification/crypto-wallet')) {
      expectTypeOf(verification).toEqualTypeOf<CryptoWalletVerification>();
      expect(verification.attributes['chain-id']).toMatch(/^[a-z0-9-]+:/);
    }
  });
});

describe('the connect group’s types (C230-C239; Workflow 11A integration-11a)', () => {
  it('tells a Connect event name from any other', () => {
    expect(isConnectEventName('connect/share-token.inbound-created')).toBe(true);
    expect(isConnectEventName('connect/connection.activated')).toBe(true);
    expect(isConnectEventName('consent-record.withdrawn')).toBe(true);
    expect(isConnectEventName('inquiry.created')).toBe(false);
  });

  it('types the three resources from their contract schemas', () => {
    const token = apiFixture('connect/share-token-inbound').data as ShareToken;
    expectTypeOf(token.attributes.status).toEqualTypeOf<ShareToken['attributes']['status']>();
    expectTypeOf<Connection['type']>().toEqualTypeOf<'connect/connection'>();
    expectTypeOf<ConsentRecord['type']>().toEqualTypeOf<'consent-record'>();
    expectTypeOf<ConnectEventName>().toExtend<string>();
  });
});
