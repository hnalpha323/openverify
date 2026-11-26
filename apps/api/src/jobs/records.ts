/** Maps database rows to the `@openverify/contracts` records the resource builders take. */
import type { ListScreening } from '@openverify/db';
import { servedInquirySignals, type SignalView } from '../services/signals/served.js';
import {
  type InquiryFieldValue,
  type InquiryRecord,
  type InquirySessionRecord,
  type VerificationCheckRecord,
  type VerificationRecord,
} from '@openverify/contracts';
import type {
  GovernmentIdExtraction,
  Inquiry,
  InquirySession,
  VerificationCheck,
  VerificationType,
  VerificationWithChecks,
} from '@openverify/db';

/** A stored check as the contract record (C2, C29.2). */
export function checkRecordOf(check: VerificationCheck): VerificationCheckRecord {
  return {
    name: check.name,
    status: check.status,
    reasons: check.reasons,
    required: check.requirement === 'required',
    metadata: check.metadata,
    stage: check.stage,
    confidence: check.confidence,
    provenance: check.provenance,
  };
}

/**
 * The full verification record (with checks) for a `verification.*` event payload or a
 * response; a government ID's stored extraction gives its C31.5 attributes (`null` fields once
 * redacted), and a Phase 5 type's attribute hook its C52.8 ones. Mask the resource for the
 * principal it is served to (C31.6, C53.7).
 */
export function verificationRecordOf(
  row: VerificationWithChecks,
  fileIds: readonly string[],
  extraction: GovernmentIdExtraction | null = null,
  attributes?: Readonly<Record<string, unknown>>,
  transactionId?: string | null,
): VerificationRecord {
  return {
    // C105.7 (Workflow 7B): left out until `resolveTransactionRelationships` answers.
    ...(transactionId === undefined ? {} : { transactionId }),
    // C52.8: a Phase 5 type's attributes, as its attribute hook loaded them.
    ...(attributes === undefined ? {} : { attributes }),
    id: row.id,
    type: row.type,
    status: row.status,
    inquiryId: row.inquiryId,
    fileIds,
    checks: row.checks.map(checkRecordOf),
    country: row.country,
    idClass: row.idClass,
    extraction:
      extraction === null ? null : { fields: extraction.fields, sources: extraction.fieldSources },
    fromRejectedHandoff: row.fromRejectedHandoff,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The inquiry record for an `inquiry.*` event payload or a response, with the Phase 2
 * attributes (C10, C13) and the pinned template version (C25.4), naming its verifications of
 * every type (C50.6).
 */
export function inquiryRecordOf(
  inquiry: Inquiry,
  verifications: readonly { id: string; type: VerificationType }[],
  view: SignalView = { exposeSignals: true },
  listScreening: ListScreening | null = null,
  transactionId?: string | null,
): InquiryRecord {
  // C90.5, C90.8 (Workflow 7A): always present; `[]` and `computed-at` alone when not computed or
  // hidden.
  const { signals, signalDetails } = servedInquirySignals({ inquiry, listScreening }, view);
  return {
    // C105.7 (Workflow 7B): left out until `resolveTransactionRelationships` answers.
    ...(transactionId === undefined ? {} : { transactionId }),
    signals,
    signalDetails,
    id: inquiry.id,
    status: inquiry.status,
    referenceId: inquiry.referenceId,
    // Validated against the C2 field schema by the resource builder.
    fields: inquiry.fields as Record<string, InquiryFieldValue>,
    inquiryTemplateId: inquiry.inquiryTemplateId,
    inquiryTemplateVersionId: inquiry.inquiryTemplateVersionId,
    verifications: verifications.map(({ id, type }) => ({ id, type })),
    createdAt: inquiry.createdAt,
    updatedAt: inquiry.updatedAt,
    tags: inquiry.tags,
    note: inquiry.note,
    expiresAt: inquiry.expiresAt,
    redactedAt: inquiry.redactedAt,
    decisionedAt: inquiry.decisionedAt,
    accountId: inquiry.accountId,
  };
}

/**
 * The inquiry-session record (C10) with the status it has at `now`: an `active` session past
 * its TTL is `expired` before the sweep marks it, and a session revoked in Phase 1 is
 * `canceled`.
 */
export function inquirySessionRecordOf(session: InquirySession, now: Date): InquirySessionRecord {
  return {
    id: session.id,
    inquiryId: session.inquiryId,
    status: inquirySessionStatusAt(session, now),
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    ipAddress: session.ip,
    userAgent: session.userAgent,
  };
}

/** The C10 status of a session at `now`. */
export function inquirySessionStatusAt(
  session: Pick<InquirySession, 'status' | 'expiresAt' | 'revokedAt'>,
  now: Date,
): InquirySessionRecord['status'] {
  if (session.status !== 'active') {
    return session.status;
  }
  if (session.revokedAt !== null) {
    return 'canceled';
  }
  return session.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
}
