import { DomainError, VERIFICATION_TYPES } from '@openverify/core';
import { STEP_TYPES, parseFlow, type FlowStepType } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  API_VERIFICATION_TYPES,
  CHECK_REQUIREMENTS,
  DEFAULT_MAX_ATTEMPTS,
  STEP_VERIFICATION_TYPES,
  SUPPORTED_VERIFICATION_TYPES,
  UnsupportedVerificationTypeError,
  VERIFICATION_RESOURCE_TYPES,
  checkRequirementFor,
  fromApiVerificationType,
  fromVerificationResourceType,
  isSupportedVerificationType,
  isVerificationStep,
  stepForVerificationType,
  stepMaxAttempts,
  toApiVerificationType,
  toVerificationResourceType,
  verificationStatusForDecision,
  verificationTypeForStep,
  type ApiVerificationType,
  type SupportedVerificationType,
  type VerificationResourceType,
} from './verification-types.js';

/** C50.1: domain type, API type, resource type, the step that creates it and its default attempts. */
const TYPES: readonly (readonly [
  SupportedVerificationType,
  ApiVerificationType,
  VerificationResourceType,
  FlowStepType,
  number | undefined,
])[] = (
  [
    ['government_id', 'government-id', 'verification/government-id', 'government_id', undefined],
    ['selfie', 'selfie', 'verification/selfie', 'selfie', undefined],
    ['document', 'document', 'verification/document', 'document', 3],
    ['database', 'database', 'verification/database', 'database', 1],
    ['aamva', 'aamva', 'verification/aamva', 'aamva', 1],
    ['phone_number', 'phone-number', 'verification/phone-number', 'phone_otp', 5],
    ['email_address', 'email-address', 'verification/email-address', 'email_otp', 5],
    ['government_id_nfc', 'government-id-nfc', 'verification/government-id-nfc', 'nfc', 3],
    ['crypto_wallet', 'crypto-wallet', 'verification/crypto-wallet', 'crypto_wallet', 3],
    [
      'database_business',
      'database-business',
      'verification/database-business',
      'database_business',
      3,
    ],
    [
      'business_website',
      'business-website',
      'verification/business-website',
      'business_website',
      3,
    ],
  ] as const satisfies readonly (readonly [string, string, string, string, number | undefined])[]
).map(
  ([domain, api, resource, step, attempts]) =>
    [domain, api, resource, step as FlowStepType, attempts] as const,
);

describe('verification type vocabularies', () => {
  it('supports all eleven verification types since Phase 5 (C50.1)', () => {
    expect(SUPPORTED_VERIFICATION_TYPES).toEqual(TYPES.map(([domain]) => domain));
    expect(SUPPORTED_VERIFICATION_TYPES).toEqual(VERIFICATION_TYPES);
    expect(API_VERIFICATION_TYPES).toEqual(TYPES.map(([, api]) => api));
    expect(VERIFICATION_RESOURCE_TYPES).toEqual(TYPES.map(([, , resource]) => resource));
  });

  it('recognises domain types only', () => {
    for (const type of VERIFICATION_TYPES) {
      expect(isSupportedVerificationType(type)).toBe(true);
    }
    expect(isSupportedVerificationType('business')).toBe(false);
    expect(isSupportedVerificationType('government-id')).toBe(false);
    expect(isSupportedVerificationType('constructor')).toBe(false);
    expect(isSupportedVerificationType(undefined)).toBe(false);
  });
});

describe('domain to API mappers', () => {
  it.each(TYPES)('maps %s both ways', (domain, api, resource) => {
    expect(toApiVerificationType(domain)).toBe(api);
    expect(fromApiVerificationType(api)).toBe(domain);
    expect(toVerificationResourceType(domain)).toBe(resource);
    expect(fromVerificationResourceType(resource)).toBe(domain);
  });

  it('throws a typed domain error for unsupported values', () => {
    const attempts = [
      () => toApiVerificationType('business' as never),
      () => fromApiVerificationType('government_id' as never),
      () => toVerificationResourceType('toString' as never),
      () => fromVerificationResourceType('verification/business' as never),
    ];
    for (const attempt of attempts) {
      expect(attempt).toThrow(UnsupportedVerificationTypeError);
    }
    const error = new UnsupportedVerificationTypeError('business');
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('unsupported_verification_type');
    expect(error.value).toBe('business');
  });
});

describe('steps and verification types (C50.2)', () => {
  it('maps every flow step type, and each verification type to exactly one step (total, injective)', () => {
    expect(Object.keys(STEP_VERIFICATION_TYPES).sort()).toEqual([...STEP_TYPES].sort());
    const created = Object.values(STEP_VERIFICATION_TYPES).filter((type) => type !== null);
    expect(new Set(created).size).toBe(created.length);
    expect([...created].sort()).toEqual([...VERIFICATION_TYPES].sort());
    for (const [domain, , , step] of TYPES) {
      expect(STEP_VERIFICATION_TYPES[step], step).toBe(domain);
      expect(verificationTypeForStep(step)).toBe(domain);
    }
    for (const step of ['consent', 'form', 'completion', 'failure'] as const) {
      expect(verificationTypeForStep(step)).toBeNull();
    }
    expect(Object.isFrozen(STEP_VERIFICATION_TYPES)).toBe(true);
  });

  it('gives every verification step a number of attempts: its own, else the type default (C50.1)', () => {
    for (const [domain, , , , fallback] of TYPES) {
      const defaults: Readonly<Record<string, number | undefined>> = DEFAULT_MAX_ATTEMPTS;
      expect(defaults[domain], domain).toBe(fallback);
    }
    const steps = parseFlow(everyVerificationStep()).steps.filter(isVerificationStep);
    expect(steps.map((step) => [step.type, stepMaxAttempts(step)])).toEqual([
      ['government_id', 2],
      ['selfie', 3],
      ['document', 3],
      ['database', 1],
      ['aamva', 1],
      ['phone_otp', 5],
      ['email_otp', 4],
      ['nfc', 3],
      ['crypto_wallet', 3],
      ['database_business', 3],
      ['business_website', 3],
    ]);
  });

  it('finds the step of each verification type in a flow, or none', () => {
    const flow = parseFlow(everyVerificationStep());
    for (const [domain, , , step] of TYPES) {
      expect(stepForVerificationType(flow, domain)?.type, domain).toBe(step);
    }
    const consentOnly = parseFlow({
      ...everyVerificationStep(),
      steps: [{ id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true }],
    });
    expect(stepForVerificationType(consentOnly, 'document')).toBeUndefined();
    const [consent] = consentOnly.steps;
    expect(consent && isVerificationStep(consent)).toBe(false);
  });
});

/** A flow with one step of every verification type; two of them set their own attempts. */
function everyVerificationStep() {
  return {
    metadata: { specVersion: 1, id: 'every-type', version: 1, name: 'Every type' },
    steps: [
      {
        id: 'gov',
        type: 'government_id',
        sides: 'front',
        maxAttempts: 2,
        captureMethods: ['upload'],
      },
      { id: 'selfie', type: 'selfie', poses: ['center'], liveness: 'passive', maxAttempts: 3 },
      { id: 'doc', type: 'document', documentTypes: ['utility_bill'], captureMethods: ['upload'] },
      {
        id: 'db',
        type: 'database',
        fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
      },
      { id: 'aamva', type: 'aamva', source: 'government_id' },
      { id: 'phone', type: 'phone_otp', allowedCountries: ['US'] },
      { id: 'email', type: 'email_otp', maxAttempts: 4 },
      { id: 'nfc', type: 'nfc', androidOnly: true },
      { id: 'wallet', type: 'crypto_wallet', chains: ['eip155:1'], signing: ['paste'] },
      { id: 'business', type: 'database_business' },
      { id: 'website', type: 'business_website' },
      { id: 'done', type: 'completion' },
    ],
    transitions: [],
  };
}

describe('verification statuses', () => {
  it('maps decision-engine outcomes to verification statuses', () => {
    expect(verificationStatusForDecision('passed')).toBe('passed');
    expect(verificationStatusForDecision('failed')).toBe('failed');
    // C30.1: pending only while more results are expected; the verification stays submitted.
    expect(verificationStatusForDecision('pending')).toBe('submitted');
    // C30.4: a required check without evidence leaves the verification for an operator.
    expect(verificationStatusForDecision('needs_review')).toBe('needs_review');
    expect(() => verificationStatusForDecision('valueOf' as never)).toThrow(TypeError);
  });

  it('maps the template required flag to the check requirement', () => {
    expect(CHECK_REQUIREMENTS).toEqual(['required', 'not_required']);
    expect(checkRequirementFor(true)).toBe('required');
    expect(checkRequirementFor(false)).toBe('not_required');
  });
});
