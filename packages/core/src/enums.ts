import { z } from 'zod';

/** Outcome of a single check. `not_applicable` never fails a verification. */
export const CHECK_STATUSES = ['passed', 'failed', 'not_applicable', 'pending'] as const;
export const checkStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

/**
 * `user_behavior` checks fail because of something the user can fix by retrying
 * (blur, glare, wrong document); `fraud` checks flag risk the user cannot fix.
 */
export const CHECK_TYPES = ['user_behavior', 'fraud'] as const;
export const checkTypeSchema = z.enum(CHECK_TYPES);
export type CheckType = z.infer<typeof checkTypeSchema>;

/**
 * What a check describes (C50.8), as the public check object names it: `validity` for the
 * document's own type, properties, expiry and recency, `user_action_required` for what the user
 * can fix, `fraud` for risk, `biometrics` for a biometric judgement. It describes the check, not
 * its result; the check type still decides retry hints.
 */
export const CHECK_CATEGORIES = [
  'biometrics',
  'fraud',
  'user_action_required',
  'validity',
] as const;
export const checkCategorySchema = z.enum(CHECK_CATEGORIES);
export type CheckCategory = z.infer<typeof checkCategorySchema>;

/** Release stage of a check implementation. Heuristic checks ship as `beta`. */
export const CHECK_STAGES = ['ga', 'beta', 'sunset'] as const;
export const checkStageSchema = z.enum(CHECK_STAGES);
export type CheckStage = z.infer<typeof checkStageSchema>;

/**
 * Implementation tier (PLAN §4): `R` real implementation, `H` heuristic
 * (beta, with a confidence score), `A` provider adapter plus sandbox provider.
 */
export const CHECK_TIERS = ['R', 'H', 'A'] as const;
export const checkTierSchema = z.enum(CHECK_TIERS);
export type CheckTier = z.infer<typeof checkTierSchema>;

/**
 * The evidence a check needs (C29.1), declared per registry entry as `inputs`:
 * - `upload`: what the user submitted in this verification (files, or entered values);
 * - `vision`: a vision service measurement of those files;
 * - `extraction`: the fields extracted from the document (C31);
 * - `history`: earlier verifications, extractions or selfies (repeats and comparisons);
 * - `provider`: an external provider or adapter (A-tier, C35).
 *
 * When a vision or provider call fails for good, the worker records every check with that
 * input as `execution_error`, and every check needing `extraction` as `input_missing` (C30.3).
 */
export const CHECK_INPUTS = ['upload', 'vision', 'extraction', 'history', 'provider'] as const;
export const checkInputSchema = z.enum(CHECK_INPUTS);
export type CheckInput = z.infer<typeof checkInputSchema>;

/** `requires_retry` is kept for compatibility but is deprecated. `needs_review` is Phase 3. */
export const VERIFICATION_STATUSES = [
  'initiated',
  'confirmed',
  'submitted',
  'passed',
  'failed',
  'requires_retry',
  'canceled',
  'skipped',
  /** C30.4: a required check had no evidence, so an operator decides; entered from submitted. */
  'needs_review',
] as const;
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

/**
 * C50.1: the eleven verification types, matching the public identifiers. `business` became
 * `database_business` (migration 0016 renames the Postgres value; no row ever held it), and
 * `aamva` and `business_website` split off `database` and `business`.
 */
export const VERIFICATION_TYPES = [
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
] as const;
export const verificationTypeSchema = z.enum(VERIFICATION_TYPES);
export type VerificationType = z.infer<typeof verificationTypeSchema>;

export const INQUIRY_STATUSES = [
  'created',
  'pending',
  'completed',
  'failed',
  'expired',
  'approved',
  'declined',
  'needs_review',
] as const;
export const inquiryStatusSchema = z.enum(INQUIRY_STATUSES);
export type InquiryStatus = z.infer<typeof inquiryStatusSchema>;

/** Government ID classes a template can allow or disallow. */
export const ID_CLASSES = [
  'passport',
  'passport_card',
  'drivers_license',
  'national_id',
  'residence_permit',
  'visa',
  'work_permit',
  'military_id',
  'voter_id',
  'travel_document',
] as const;
export const idClassSchema = z.enum(ID_CLASSES);
export type IdClass = z.infer<typeof idClassSchema>;

/** Supporting-document classes (PLAN §4.3, `document_type_detection`). */
export const DOCUMENT_TYPES = [
  'utility_bill',
  'bank_statement',
  'lease',
  'pay_stub',
  'tax_document',
] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof documentTypeSchema>;
