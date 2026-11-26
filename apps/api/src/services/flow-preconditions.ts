/**
 * C52.1, C54.1: the preconditions of every flow API route that acts on a verification, in one
 * place, so each Phase 5 route calls them first and none forgets one:
 *
 * | Condition | Answer |
 * |---|---|
 * | The verification belongs to another inquiry or environment | 404 |
 * | Inquiry redacted | 410 `redacted` |
 * | Inquiry decided, completed, failed or expired | 409 |
 * | Wrong type for the route | 422 |
 * | Verification not in a status the route acts on (`initiated` by default) | 409 |
 * | No consent recorded | 409 |
 *
 * `requireFlowVerification` checks them before any lock; `requireFlowVerificationUnderLock`
 * re-checks the inquiry and the verification under the C40.6 lock order (the inquiry, then the
 * verification) in the transaction that writes, where a route's writes must happen.
 */
import { toApiVerificationType, type SupportedVerificationType } from '@openverify/contracts';
import {
  getEffectiveConsent,
  lockInquiry,
  lockVerification,
  type Db,
  type Inquiry,
  type Verification,
  type VerificationStatus,
  type VerificationWithChecks,
} from '@openverify/db';
import type { FlowSession } from '../auth/flow-session.js';
import {
  ConflictError,
  NotFoundError,
  RedactedError,
  UnprocessableContentError,
} from '../errors.js';
import type { ApiDependencies } from './context.js';
import { findInquiry, isInquiryOpen, startInquiry } from './inquiries.js';
import { findVerification } from './verifications.js';

/**
 * The session's inquiry, started if it was still `created`; 410 `redacted` once it was redacted
 * (no new PII after an erasure, Workflow 2B F018), 409 once it is finished.
 */
export async function openInquiry(deps: ApiDependencies, session: FlowSession): Promise<Inquiry> {
  const inquiry = await findInquiry(deps.db, session.environmentId, session.inquiryId);
  if (inquiry.redactedAt !== null) {
    throw new RedactedError(`Inquiry ${inquiry.id} was redacted.`);
  }
  if (!isInquiryOpen(inquiry)) {
    throw new ConflictError(`The inquiry is already ${inquiry.status}.`);
  }
  return startInquiry(deps, inquiry);
}

/**
 * Locks the inquiry's row for the rest of `tx` and checks, on its committed state, that it is
 * still open and not redacted (C40.6: the first lock of every flow write).
 * @throws {RedactedError} when it was redacted meanwhile.
 * @throws {ConflictError} when it was decided, completed, failed or expired meanwhile.
 */
export async function assertInquiryOpenUnderLock(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<Inquiry> {
  await lockInquiry(tx, environmentId, inquiryId);
  const current = await findInquiry(tx, environmentId, inquiryId);
  if (current.redactedAt !== null) {
    throw new RedactedError(`Inquiry ${current.id} was redacted.`);
  }
  if (!isInquiryOpen(current)) {
    throw new ConflictError(`The inquiry is already ${current.status}.`);
  }
  return current;
}

/** A verification of the session's inquiry; any other one, here or elsewhere, is 404. */
export async function sessionVerification(
  { db }: ApiDependencies,
  session: FlowSession,
  id: string,
): Promise<VerificationWithChecks> {
  const verification = await findVerification(db, session.environmentId, id);
  if (verification.inquiryId !== session.inquiryId) {
    throw new NotFoundError(`Verification ${id} was not found.`);
  }
  return verification;
}

/** What a route acts on (C52.1). */
export interface FlowVerificationRequirements {
  /** The verification types the route serves; any other answers 422. Every type when omitted. */
  types?: readonly SupportedVerificationType[];
  /** The statuses the route acts on; any other answers 409. `initiated` when omitted. */
  statuses?: readonly VerificationStatus[];
  /** Whether consent must be recorded first (409 otherwise). True when omitted. */
  consent?: boolean;
}

/** The session's open inquiry and the verification the route acts on. */
export interface FlowVerificationTarget {
  inquiry: Inquiry;
  verification: VerificationWithChecks;
}

/**
 * C52.1: the checks every flow route that acts on a verification runs first, before reading its
 * body, in the order of the table above.
 */
export async function requireFlowVerification(
  deps: ApiDependencies,
  session: FlowSession,
  verificationId: string,
  requirements: FlowVerificationRequirements = {},
): Promise<FlowVerificationTarget> {
  const verification = await sessionVerification(deps, session, verificationId);
  const inquiry = await openInquiry(deps, session);
  const { types, statuses = ['initiated'], consent = true } = requirements;
  if (types !== undefined && !types.includes(verification.type)) {
    throw new UnprocessableContentError(
      `This route does not take a ${toApiVerificationType(verification.type)} verification.`,
    );
  }
  if (!statuses.includes(verification.status)) {
    throw new ConflictError(`The verification is ${verification.status}.`);
  }
  // C94.6 (Workflow 7A, V03): the session's effective consent, never the desktop's for a phone.
  if (
    consent &&
    (await getEffectiveConsent(deps.db, {
      environmentId: session.environmentId,
      inquiryId: session.inquiryId,
      sessionId: session.id,
    })) === null
  ) {
    throw new ConflictError('Consent is required first.');
  }
  return { inquiry, verification };
}

/**
 * C52.1 in the transaction that writes: locks the inquiry (re-checked open and not redacted),
 * then the verification (re-checked in one of `statuses`), in the C40.6 order.
 * @throws {RedactedError | ConflictError} as {@link assertInquiryOpenUnderLock}, or 409 when
 *   the verification moved out of the statuses meanwhile.
 */
export async function requireFlowVerificationUnderLock(
  tx: Db,
  session: FlowSession,
  verificationId: string,
  statuses: readonly VerificationStatus[] = ['initiated'],
): Promise<{ inquiry: Inquiry; verification: Verification }> {
  const inquiry = await assertInquiryOpenUnderLock(tx, session.environmentId, session.inquiryId);
  const verification = await lockVerification(tx, session.environmentId, verificationId);
  if (verification?.inquiryId !== session.inquiryId) {
    throw new NotFoundError(`Verification ${verificationId} was not found.`);
  }
  if (!statuses.includes(verification.status)) {
    throw new ConflictError(`The verification is ${verification.status}.`);
  }
  return { inquiry, verification };
}
