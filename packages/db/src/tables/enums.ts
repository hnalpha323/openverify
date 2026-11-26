/**
 * Postgres enums. The status and type values mirror `@openverify/core`; `schema.test.ts`
 * fails if they drift. They are spelled out here so drizzle-kit can load the schema
 * without building other workspace packages first.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const environmentKind = pgEnum('environment_kind', ['sandbox', 'production']);
export type EnvironmentKind = (typeof environmentKind.enumValues)[number];

export const inquiryStatus = pgEnum('inquiry_status', [
  'created',
  'pending',
  'completed',
  'failed',
  'expired',
  'approved',
  'declined',
  'needs_review',
]);

export const verificationStatus = pgEnum('verification_status', [
  'initiated',
  'confirmed',
  'submitted',
  'passed',
  'failed',
  'requires_retry',
  'canceled',
  'skipped',
  'needs_review',
]);

/** C50.1: migration 0016 renames `business` and adds `aamva` and `business_website`. */
export const verificationType = pgEnum('verification_type', [
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
]);

export const checkStatus = pgEnum('check_status', [
  'passed',
  'failed',
  'not_applicable',
  'pending',
]);

export const checkType = pgEnum('check_type', ['user_behavior', 'fraud']);

/** Whether the template requires the check; mirrors `{ required }` in verification config. */
export const checkRequirement = pgEnum('check_requirement', ['required', 'not_required']);

export const idClass = pgEnum('id_class', [
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
]);

/** Upload `kind` values, spelled as in C3 (`POST /flow/verifications/:id/files`). */
export const fileKind = pgEnum('file_kind', [
  'front',
  'back',
  'portrait',
  'selfie-center',
  'selfie-left',
  'selfie-right',
  // C52.4 (migration 0016): what a client uploads to a document or an NFC verification ...
  'document',
  'chip-sod',
  'chip-dg1',
  'chip-dg2',
  'chip-dg14',
  'chip-dg15',
  'chip-card-security',
  'chip-card-access',
  'chip-com',
  // ... and the two kinds only the server writes (`storeServerFile`, C54.1).
  'document-preview',
  'chip-portrait',
]);

/** `archived` (C14) is terminal: an archived webhook never delivers and cannot change. */
export const webhookStatus = pgEnum('webhook_status', ['enabled', 'disabled', 'archived']);

/** `pending` covers the first attempt and scheduled retries; `failed` means given up. */
export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'succeeded',
  'failed',
]);

export const auditActorType = pgEnum('audit_actor_type', [
  'user',
  'api_key',
  'system',
  // C121.1: a run acts as itself. A migration that adds a label cannot use it in the same batch,
  // so a CHECK naming this one reads `actor_type::text`.
  'workflow_run',
]);

/** C13 account status. A consolidated account is `archived` with `consolidated_into` set. */
export const accountStatus = pgEnum('account_status', ['active', 'archived']);

/** C11: creating an inquiry from an `archived` template answers 422. */
export const inquiryTemplateStatus = pgEnum('inquiry_template_status', ['active', 'archived']);

/** C11 version lifecycle: `draft` -> `published` -> `superseded`. One published per template. */
export const inquiryTemplateVersionStatus = pgEnum('inquiry_template_version_status', [
  'draft',
  'published',
  'superseded',
]);

/** C10 inquiry session status. */
export const inquirySessionStatus = pgEnum('inquiry_session_status', [
  'active',
  'expired',
  'canceled',
]);

/** C12 idempotency key state: a request holds the key until it completes or is released. */
export const idempotencyKeyState = pgEnum('idempotency_key_state', ['in_progress', 'completed']);

/** C12 principal kinds that own idempotency keys. */
export const principalType = pgEnum('principal_type', ['api_key', 'user']);

/** C15 operator status. Invited users have no password until they accept. */
export const userStatus = pgEnum('user_status', ['active', 'invited', 'deactivated']);

/** C15 MFA factor kinds. */
export const mfaFactorType = pgEnum('mfa_factor_type', ['totp', 'webauthn']);

// Phase 6 (C73.1): the report enums, mirroring `@openverify/core`'s report state machines.

/** C69.2: `submitted` is reserved (decision 3). */
export const reportStatus = pgEnum('report_status', ['pending', 'submitted', 'ready', 'errored']);

/** C74.1: `list_update` is a re-screen after a list update (C74.4). */
export const reportRunType = pgEnum('report_run_type', [
  'initial',
  'scheduled',
  'manual',
  'list_update',
]);

/** C73.2: what a history action did. */
export const reportActionType = pgEnum('report_action_type', [
  'dismiss',
  'review',
  'pause',
  'resume',
  'run',
  'redact',
]);

/** C75.8: only a person, or the entry leaving its source, closes a match. */
export const reportMatchStatus = pgEnum('report_match_status', ['open', 'dismissed', 'delisted']);

/** C75.5: the screening review of a match. */
export const reportReviewStatus = pgEnum('report_review_status', [
  'pending',
  'indeterminate',
  'true_positive',
  'false_positive',
]);

export const reportRiskLevel = pgEnum('report_risk_level', ['material', 'immaterial']);

/** C70.2 (P05): how a report was created. */
export const reportOrigin = pgEnum('report_origin', [
  'inquiry_completion',
  'api',
  'dashboard',
  // C127.2: only ever compared through `::text` in `0027` (Stage 1a amendment 2).
  'workflow',
  // C166.5 (Workflow 9B Stage 1b (X); contracts B34): a report a bulk job created. Added first in
  // `0031` and never used in it (Phase 8 Stage 1a amendment 2).
  'bulk',
]);

export type ReportStatus = (typeof reportStatus.enumValues)[number];
export type ReportRunType = (typeof reportRunType.enumValues)[number];
export type ReportActionType = (typeof reportActionType.enumValues)[number];
export type ReportMatchStatus = (typeof reportMatchStatus.enumValues)[number];
export type ReportReviewStatus = (typeof reportReviewStatus.enumValues)[number];
export type ReportRiskLevel = (typeof reportRiskLevel.enumValues)[number];
export type ReportOrigin = (typeof reportOrigin.enumValues)[number];

export type InquiryStatus = (typeof inquiryStatus.enumValues)[number];
export type VerificationStatus = (typeof verificationStatus.enumValues)[number];
export type VerificationType = (typeof verificationType.enumValues)[number];
export type CheckStatus = (typeof checkStatus.enumValues)[number];
export type CheckType = (typeof checkType.enumValues)[number];
export type CheckRequirement = (typeof checkRequirement.enumValues)[number];
export type IdClass = (typeof idClass.enumValues)[number];
export type FileKind = (typeof fileKind.enumValues)[number];
export type WebhookStatus = (typeof webhookStatus.enumValues)[number];
export type WebhookDeliveryStatus = (typeof webhookDeliveryStatus.enumValues)[number];
export type AuditActorType = (typeof auditActorType.enumValues)[number];
export type AccountStatus = (typeof accountStatus.enumValues)[number];
export type InquiryTemplateStatus = (typeof inquiryTemplateStatus.enumValues)[number];
export type InquiryTemplateVersionStatus = (typeof inquiryTemplateVersionStatus.enumValues)[number];
export type InquirySessionStatus = (typeof inquirySessionStatus.enumValues)[number];
export type IdempotencyKeyState = (typeof idempotencyKeyState.enumValues)[number];
export type PrincipalType = (typeof principalType.enumValues)[number];
export type UserStatus = (typeof userStatus.enumValues)[number];
export type MfaFactorType = (typeof mfaFactorType.enumValues)[number];
