/**
 * Pure mappers between domain values (`@openverify/core`, snake_case) and API values.
 * Only verification types change spelling: `government_id` is `government-id` in request
 * bodies and `verification/government-id` as a resource type; the steps that create them are
 * named in {@link STEP_VERIFICATION_TYPES}. Status, check and reason
 * values are the domain values unchanged.
 */
import {
  DomainError,
  type VerificationDecisionStatus,
  type VerificationStatus,
  type VerificationType,
} from '@openverify/core';
import type { Flow, FlowStep, FlowStepType } from '@openverify/flow-spec';
import { z } from 'zod';

/**
 * The verification types the API serves: all eleven since Phase 5 (C50.1), so every union of
 * contracts, clients and the node SDK decodes every type (C50.6).
 */
export const SUPPORTED_VERIFICATION_TYPES = [
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
] as const satisfies readonly VerificationType[];
export const supportedVerificationTypeSchema = z.enum(SUPPORTED_VERIFICATION_TYPES);
export type SupportedVerificationType = z.infer<typeof supportedVerificationTypeSchema>;

/** Verification types as clients send them (C3 `POST /flow/verifications`, C50.1). */
export const API_VERIFICATION_TYPES = [
  'government-id',
  'selfie',
  'document',
  'database',
  'aamva',
  'phone-number',
  'email-address',
  'government-id-nfc',
  'crypto-wallet',
  'database-business',
  'business-website',
] as const;
export const apiVerificationTypeSchema = z.enum(API_VERIFICATION_TYPES);
export type ApiVerificationType = z.infer<typeof apiVerificationTypeSchema>;

/** JSON:API resource types of verifications (C1, C50.1). */
export const VERIFICATION_RESOURCE_TYPES = [
  'verification/government-id',
  'verification/selfie',
  'verification/document',
  'verification/database',
  'verification/aamva',
  'verification/phone-number',
  'verification/email-address',
  'verification/government-id-nfc',
  'verification/crypto-wallet',
  'verification/database-business',
  'verification/business-website',
] as const;
export const verificationResourceTypeSchema = z.enum(VERIFICATION_RESOURCE_TYPES);
export type VerificationResourceType = z.infer<typeof verificationResourceTypeSchema>;

const API_BY_DOMAIN = {
  government_id: 'government-id',
  selfie: 'selfie',
  document: 'document',
  database: 'database',
  aamva: 'aamva',
  phone_number: 'phone-number',
  email_address: 'email-address',
  government_id_nfc: 'government-id-nfc',
  crypto_wallet: 'crypto-wallet',
  database_business: 'database-business',
  business_website: 'business-website',
} as const satisfies Record<SupportedVerificationType, ApiVerificationType>;

const DOMAIN_BY_API = Object.fromEntries(
  Object.entries(API_BY_DOMAIN).map(([domain, api]) => [api, domain]),
) as { readonly [Domain in keyof typeof API_BY_DOMAIN as (typeof API_BY_DOMAIN)[Domain]]: Domain };

const RESOURCE_BY_DOMAIN = Object.fromEntries(
  Object.entries(API_BY_DOMAIN).map(([domain, api]) => [domain, `verification/${api}`]),
) as {
  readonly [Domain in keyof typeof API_BY_DOMAIN]: `verification/${(typeof API_BY_DOMAIN)[Domain]}`;
};

const DOMAIN_BY_RESOURCE = Object.fromEntries(
  Object.entries(RESOURCE_BY_DOMAIN).map(([domain, resource]) => [resource, domain]),
) as {
  readonly [
    Domain in keyof typeof RESOURCE_BY_DOMAIN as (typeof RESOURCE_BY_DOMAIN)[Domain]
  ]: Domain;
};

/** A value that is not a verification type reached a mapper. */
export class UnsupportedVerificationTypeError extends DomainError {
  readonly value: string;

  constructor(value: string) {
    super('unsupported_verification_type', `Unsupported verification type "${value}"`);
    this.value = value;
  }
}

/** Own-property lookup, so prototype keys such as `toString` never match. */
function lookup<Table extends Record<string, string>>(
  table: Table,
  key: string,
): Table[keyof Table] {
  if (!Object.hasOwn(table, key)) {
    throw new UnsupportedVerificationTypeError(key);
  }
  return table[key as keyof Table];
}

export function isSupportedVerificationType(value: unknown): value is SupportedVerificationType {
  return typeof value === 'string' && Object.hasOwn(API_BY_DOMAIN, value);
}

/** `government_id` → `government-id`. */
export function toApiVerificationType(type: SupportedVerificationType): ApiVerificationType {
  return lookup(API_BY_DOMAIN, type);
}

/** `government-id` → `government_id`. */
export function fromApiVerificationType(type: ApiVerificationType): SupportedVerificationType {
  return lookup(DOMAIN_BY_API, type);
}

/** `government_id` → `verification/government-id`. */
export function toVerificationResourceType(
  type: SupportedVerificationType,
): VerificationResourceType {
  return lookup(RESOURCE_BY_DOMAIN, type);
}

/** `verification/government-id` → `government_id`. */
export function fromVerificationResourceType(
  type: VerificationResourceType,
): SupportedVerificationType {
  return lookup(DOMAIN_BY_RESOURCE, type);
}

/**
 * C50.2: the verification each flow step creates, total over the flow-spec step types and
 * injective: no two steps create the same type. Step names differ from type names for the
 * contact and NFC steps (`phone_otp`, `email_otp`, `nfc`).
 */
export const STEP_VERIFICATION_TYPES = Object.freeze({
  consent: null,
  form: null,
  government_id: 'government_id',
  selfie: 'selfie',
  document: 'document',
  phone_otp: 'phone_number',
  email_otp: 'email_address',
  database: 'database',
  aamva: 'aamva',
  nfc: 'government_id_nfc',
  crypto_wallet: 'crypto_wallet',
  database_business: 'database_business',
  business_website: 'business_website',
  // C96.1 (Phase 7): the handoff creates no verification.
  device_handoff: null,
  completion: null,
  failure: null,
} as const satisfies Record<FlowStepType, SupportedVerificationType | null>);

/** A flow step type that creates a verification. */
export type VerificationStepType = {
  [Step in FlowStepType]: (typeof STEP_VERIFICATION_TYPES)[Step] extends null ? never : Step;
}[FlowStepType];

/** A flow step that creates a verification. */
export type VerificationStep = Extract<FlowStep, { type: VerificationStepType }>;

/**
 * C50.1: the attempts a step allows when it sets no `maxAttempts`. The government ID and selfie
 * steps always set theirs.
 */
export const DEFAULT_MAX_ATTEMPTS = Object.freeze({
  document: 3,
  database: 1,
  aamva: 1,
  phone_number: 5,
  email_address: 5,
  government_id_nfc: 3,
  crypto_wallet: 3,
  database_business: 3,
  business_website: 3,
} as const satisfies Partial<Record<SupportedVerificationType, number>>);

/** Whether `step` creates a verification. */
export function isVerificationStep(step: FlowStep): step is VerificationStep {
  return Object.hasOwn(STEP_VERIFICATION_TYPES, step.type)
    ? STEP_VERIFICATION_TYPES[step.type] !== null
    : false;
}

/** The step of `flow` that creates verifications of `type`, or `undefined` (C50.2). */
export function stepForVerificationType(
  flow: Flow,
  type: SupportedVerificationType,
): VerificationStep | undefined {
  return flow.steps.find(
    (step): step is VerificationStep =>
      isVerificationStep(step) && STEP_VERIFICATION_TYPES[step.type] === type,
  );
}

/** How many attempts `step` allows: its own `maxAttempts`, else its type's default (C50.2). */
export function stepMaxAttempts(step: VerificationStep): number {
  if (step.maxAttempts !== undefined) {
    return step.maxAttempts;
  }
  const type = STEP_VERIFICATION_TYPES[step.type];
  return (DEFAULT_MAX_ATTEMPTS as Readonly<Record<string, number>>)[type] ?? 1;
}

/** The verification a flow step creates, or `null` for steps that create none (C50.2). */
export function verificationTypeForStep(stepType: FlowStepType): SupportedVerificationType | null {
  return Object.hasOwn(STEP_VERIFICATION_TYPES, stepType)
    ? STEP_VERIFICATION_TYPES[stepType]
    : null;
}

const STATUS_BY_DECISION = {
  passed: 'passed',
  failed: 'failed',
  // C30.1: pending only while more results are expected; the verification stays submitted.
  pending: 'submitted',
  // C30.4: a required check without evidence leaves the verification to an operator.
  needs_review: 'needs_review',
} as const satisfies Record<VerificationDecisionStatus, VerificationStatus>;

/**
 * The verification status for a `decideVerification` outcome.
 * @throws {TypeError} for an unknown outcome.
 */
export function verificationStatusForDecision(
  status: VerificationDecisionStatus,
): (typeof STATUS_BY_DECISION)[VerificationDecisionStatus] {
  if (!Object.hasOwn(STATUS_BY_DECISION, status)) {
    throw new TypeError(`Unknown decision status "${status}"`);
  }
  return STATUS_BY_DECISION[status];
}

/** Whether the template requires a check (C2 `checks[].requirement`). */
export const CHECK_REQUIREMENTS = ['required', 'not_required'] as const;
export const checkRequirementSchema = z.enum(CHECK_REQUIREMENTS);
export type CheckRequirement = z.infer<typeof checkRequirementSchema>;

export function checkRequirementFor(required: boolean): CheckRequirement {
  return required ? 'required' : 'not_required';
}
