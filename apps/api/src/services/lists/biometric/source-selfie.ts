/**
 * C99.5, C99.7 (Workflow 7B): the selfie a face or background list reads, and the consent it stands
 * on. Both an item's source and a probe are the inquiry's centre selfie: the latest selfie
 * verification with a decision, a failed one included, since a failed fraud attempt is what a list
 * keeps. A selfie a rejected handoff left is nobody's (C96.3).
 *
 * The consent is the one that authorised the capture: the session of its capture, or of its
 * verification, reads through `matchingConsentHolds` and `getEffectiveConsent`, so a phone reached by
 * handoff answers for itself and a rejected phone's consent authorises nothing (C94.6, V03). With
 * no such session the read is the inquiry's.
 */
import type { VerificationStatus } from '@openverify/core';
import {
  getInquiryTemplateVersion,
  listInquiryVerifications,
  listSelfieCaptures,
  listVerificationFiles,
  type Db,
  type Inquiry,
  type StoredFile,
} from '@openverify/db';
import { safeStoredFlowView } from '../../stored-flow.js';
import { latestOfKind } from '../../../jobs/images.js';
import { matchingConsentHolds } from '../../../jobs/selfie.js';

export interface SourceSelfie {
  verificationId: string;
  /** The centre file; `null` when the verification has none. */
  center: StoredFile | null;
  /** The session the consent is read for; `null` reads the inquiry's. */
  sessionId: string | null;
}

/** A decided selfie: one still to be retried, or canceled, has not said anything. */
const DECIDED: ReadonlySet<VerificationStatus> = new Set(['passed', 'failed', 'needs_review']);

/** The inquiry's latest decided selfie, `null` without one. */
export async function latestSelfieOf(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<SourceSelfie | null> {
  const verification = (await listInquiryVerifications(db, environmentId, inquiryId))
    .filter(
      (candidate) =>
        candidate.type === 'selfie' &&
        !candidate.fromRejectedHandoff &&
        DECIDED.has(candidate.status),
    )
    .at(-1);
  if (verification === undefined) {
    return null;
  }
  const { id: verificationId } = verification;
  const files = await listVerificationFiles(db, environmentId, [verificationId]);
  const captures = await listSelfieCaptures(db, environmentId, { verificationId });
  const capture = captures.find(({ status }) => status === 'processed') ?? captures[0];
  return {
    verificationId,
    center: latestOfKind(files, 'selfie-center') ?? null,
    sessionId: capture?.createdBySessionId ?? verification.createdBySessionId ?? null,
  };
}

/** C99.7: whether `consent.biometric-matching` holds for `selfie`, by the rule above. */
export async function selfieConsentHolds(
  db: Db,
  inquiry: Pick<Inquiry, 'id' | 'environmentId' | 'inquiryTemplateVersionId'>,
  selfie: SourceSelfie | null,
): Promise<boolean> {
  const { environmentId } = inquiry;
  const version = await getInquiryTemplateVersion(
    db,
    environmentId,
    inquiry.inquiryTemplateVersionId,
  );
  const flow = safeStoredFlowView(version?.flow);
  return (
    flow !== null &&
    matchingConsentHolds(
      db,
      { environmentId, inquiryId: inquiry.id, sessionId: selfie?.sessionId ?? null },
      flow,
    )
  );
}
