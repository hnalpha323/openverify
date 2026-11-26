import { describe, expect, it } from 'vitest';
import {
  CHECK_CATEGORIES,
  CHECK_INPUTS,
  CHECK_STAGES,
  CHECK_STATUSES,
  CHECK_TIERS,
  CHECK_TYPES,
  DOCUMENT_TYPES,
  ID_CLASSES,
  INQUIRY_STATUSES,
  VERIFICATION_STATUSES,
  VERIFICATION_TYPES,
  checkCategorySchema,
  checkInputSchema,
  checkStageSchema,
  checkStatusSchema,
  checkTierSchema,
  checkTypeSchema,
  documentTypeSchema,
  idClassSchema,
  inquiryStatusSchema,
  verificationStatusSchema,
  verificationTypeSchema,
} from './enums.js';

describe('domain enums', () => {
  it.each([
    ['check status', CHECK_STATUSES, ['passed', 'failed', 'not_applicable', 'pending']],
    ['check type', CHECK_TYPES, ['user_behavior', 'fraud']],
    ['check stage', CHECK_STAGES, ['ga', 'beta', 'sunset']],
    ['check tier', CHECK_TIERS, ['R', 'H', 'A']],
    ['check input', CHECK_INPUTS, ['upload', 'vision', 'extraction', 'history', 'provider']],
    // C50.8: the public check object's four categories.
    [
      'check category',
      CHECK_CATEGORIES,
      ['biometrics', 'fraud', 'user_action_required', 'validity'],
    ],
    [
      'verification status',
      VERIFICATION_STATUSES,
      [
        'initiated',
        'confirmed',
        'submitted',
        'passed',
        'failed',
        'requires_retry',
        'canceled',
        'skipped',
        'needs_review',
      ],
    ],
    [
      'verification type',
      VERIFICATION_TYPES,
      [
        // C50.1: `business` became `database_business`; `aamva` and `business_website` are new.
        'government_id',
        'selfie',
        'document',
        'database',
        'aamva',
        'phone_number',
        'email_address',
        'government_id_nfc',
        'crypto_wallet',
        'database_business',
        'business_website',
      ],
    ],
    [
      'inquiry status',
      INQUIRY_STATUSES,
      [
        'created',
        'pending',
        'completed',
        'failed',
        'expired',
        'approved',
        'declined',
        'needs_review',
      ],
    ],
  ])('lists every %s value in order', (_label, values, expected) => {
    expect(values).toEqual(expected);
  });

  it.each([
    ['check status', checkStatusSchema, CHECK_STATUSES],
    ['check type', checkTypeSchema, CHECK_TYPES],
    ['check stage', checkStageSchema, CHECK_STAGES],
    ['check tier', checkTierSchema, CHECK_TIERS],
    ['check input', checkInputSchema, CHECK_INPUTS],
    ['check category', checkCategorySchema, CHECK_CATEGORIES],
    ['verification status', verificationStatusSchema, VERIFICATION_STATUSES],
    ['verification type', verificationTypeSchema, VERIFICATION_TYPES],
    ['inquiry status', inquiryStatusSchema, INQUIRY_STATUSES],
    ['id class', idClassSchema, ID_CLASSES],
    ['document type', documentTypeSchema, DOCUMENT_TYPES],
  ] as const)('the %s schema accepts exactly its listed values', (_label, schema, values) => {
    for (const value of values) {
      expect(schema.parse(value)).toBe(value);
    }
    expect(schema.options).toEqual(values);
  });

  it.each([
    ['check status', checkStatusSchema, 'PASSED'],
    ['check status', checkStatusSchema, 'error'],
    ['check type', checkTypeSchema, 'user-behavior'],
    ['check stage', checkStageSchema, 'GA'],
    ['check tier', checkTierSchema, 'r'],
    ['verification status', verificationStatusSchema, 'cancelled'],
    ['verification type', verificationTypeSchema, 'government-id'],
    // C50.1: no row can hold the old value.
    ['verification type', verificationTypeSchema, 'business'],
    ['check category', checkCategorySchema, 'user-action-required'],
    ['inquiry status', inquiryStatusSchema, 'marked-for-review'],
    ['id class', idClassSchema, 'library_card'],
    ['document type', documentTypeSchema, 'selfie'],
  ] as const)('the %s schema rejects %j', (_label, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(checkStatusSchema.safeParse(1).success).toBe(false);
    expect(checkStatusSchema.safeParse(null).success).toBe(false);
    expect(checkStatusSchema.safeParse(undefined).success).toBe(false);
  });

  it('uses snake_case for every multi-word enum value', () => {
    const multiWord = [
      ...CHECK_STATUSES,
      ...CHECK_TYPES,
      ...CHECK_CATEGORIES,
      ...VERIFICATION_STATUSES,
      ...VERIFICATION_TYPES,
      ...INQUIRY_STATUSES,
      ...ID_CLASSES,
      ...DOCUMENT_TYPES,
    ];
    for (const value of multiWord) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(value).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    }
  });
});
