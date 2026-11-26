/**
 * Verifications as the server API sees them (C2): status, every check and the files. Every
 * status change, in the API and in the worker, goes through {@link moveVerification}, which
 * applies the C10 state machine (`transitionVerification`) and names the event to emit.
 */
import { buildVerificationResource, type VerificationDocument } from '@openverify/contracts';
import { transitionVerification, type VerificationEventName } from '@openverify/core';
import {
  getGovernmentIdExtraction,
  getVerification,
  listInquiryVerifications,
  listSelfieCaptures,
  listVerificationFiles,
  setVerificationStatus,
  type Db,
  type Verification,
  type VerificationStatus,
  type VerificationWithChecks,
} from '@openverify/db';
import type { PiiMask } from '../auth/pii.js';
import type { StagedEvent, TransactionalEventPublisher } from '../events/index.js';
import { NotFoundError } from '../errors.js';
import { verificationRecordOf } from '../jobs/records.js';
import { loadVerificationAttributes } from './attributes/index.js';
import type { ApiDependencies } from './context.js';
import { verificationResource } from './resources.js';
import { resolveTransactionRelationships } from './transactions/relationships.js';
import { cancelSubResources } from './sub-resources/index.js';
import {
  selfieCaptureResources,
  selfieDetailsForVerification,
  selfieDetailsOf,
  type ErroredCaptures,
} from './selfie-captures.js';

/** @throws {NotFoundError} when the verification is not in this environment. */
export async function findVerification(
  db: Db,
  environmentId: string,
  id: string,
): Promise<VerificationWithChecks> {
  const verification = await getVerification(db, environmentId, id);
  if (verification === null) {
    throw new NotFoundError(`Verification ${id} was not found.`);
  }
  return verification;
}

/** File ids per verification, oldest first. */
export async function fileIdsByVerification(
  db: Db,
  environmentId: string,
  verificationIds: readonly string[],
): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>(verificationIds.map((id) => [id, []]));
  for (const file of await listVerificationFiles(db, environmentId, verificationIds)) {
    grouped.get(file.verificationId)?.push(file.id);
  }
  return grouped;
}

/**
 * C2 `GET /verifications/:id`, with a government ID's C31.5 extraction attributes masked for
 * the principal (C31.6).
 */
export async function getVerificationDocument(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
  mask: PiiMask,
  include?: 'selfies',
): Promise<VerificationDocument> {
  const verification = await findVerification(db, environmentId, id);
  const files = await fileIdsByVerification(db, environmentId, [id]);
  const extraction = await getGovernmentIdExtraction(db, environmentId, id);
  const captures =
    verification.type === 'selfie'
      ? await listSelfieCaptures(db, environmentId, { verificationId: id })
      : [];
  const transactions = await resolveTransactionRelationships(db, environmentId, [id]);
  const data = verificationResource(verification, files.get(id) ?? [], {
    extraction,
    mask,
    ...(verification.type === 'selfie' ? { selfie: selfieDetailsOf(captures, id) } : {}),
    attributes: await loadVerificationAttributes(db, verification),
    transactionId: transactions.get(id),
  });
  return include === 'selfies'
    ? { data, included: await selfieCaptureResources(db, captures) }
    : { data };
}

export interface MovedVerification {
  verification: Verification;
  /** The event the change announces; `null` for a change into `confirmed`. */
  event: VerificationEventName | null;
}

/**
 * Moves `verification` from the status it was read with to `to`, through the C10 state
 * machine. The write is conditional on that status, so a concurrent change wins and this
 * returns `null`.
 * @throws {InvalidVerificationTransitionError} when the state machine forbids the change.
 */
export async function moveVerification(
  db: Db,
  verification: Pick<Verification, 'id' | 'environmentId' | 'status'>,
  to: VerificationStatus,
  at: Date,
): Promise<MovedVerification | null> {
  const event = transitionVerification(verification.status, to);
  const moved = await setVerificationStatus(db, verification.environmentId, verification.id, {
    from: verification.status,
    to,
    at,
  });
  return moved === null ? null : { verification: moved, event };
}

/**
 * Stages the `verification.*` event of a verification, with its checks, files and (a government
 * ID) its stored extraction, (a selfie) its captures and the C40.10 attributes, or (a Phase 5
 * type) the C52.8 attributes its hook loads, in `tx`. The payload is the integrator's, unmasked;
 * the Events API masks it per principal, and redaction stubs it (C31.6, C53.7, 2B F005).
 */
export async function stageVerificationEvent(
  tx: Db,
  events: TransactionalEventPublisher,
  name: VerificationEventName,
  verification: VerificationWithChecks,
  fileIds: readonly string[],
): Promise<StagedEvent> {
  const extraction =
    verification.type === 'government_id'
      ? await getGovernmentIdExtraction(tx, verification.environmentId, verification.id)
      : null;
  const transactions = await resolveTransactionRelationships(tx, verification.environmentId, [
    verification.id,
  ]);
  const record = verificationRecordOf(
    verification,
    fileIds,
    extraction,
    await loadVerificationAttributes(tx, verification),
    transactions.get(verification.id),
  );
  return events.stage(tx, {
    environmentId: verification.environmentId,
    name,
    payload: {
      data: buildVerificationResource(
        verification.type === 'selfie'
          ? {
              ...record,
              selfie: await selfieDetailsForVerification(
                tx,
                verification.environmentId,
                verification.id,
              ),
            }
          : record,
      ),
    },
  });
}

/**
 * C10 `expire`: the inquiry's open verifications, `initiated` and (C50.7, phone and email)
 * `confirmed`, become `canceled`, each through the state machine with its `verification.canceled`
 * event staged in `tx`. Each type's cancel hook
 * (`services/sub-resources/`, C54.1) runs first: a selfie's open capture is moved to `errored`
 * (`canceled`) with `selfie.errored`, its file rows deleted (C40.2); the objects of deleted rows
 * are returned for deletion after commit.
 */
export async function cancelInitiatedVerifications(
  tx: Db,
  events: TransactionalEventPublisher,
  environmentId: string,
  inquiryId: string,
  at: Date,
): Promise<ErroredCaptures> {
  const initiated = (await listInquiryVerifications(tx, environmentId, inquiryId)).filter(
    (verification) => verification.status === 'initiated' || verification.status === 'confirmed',
  );
  const staged: StagedEvent[] = [];
  const storageKeys: string[] = [];
  for (const verification of initiated) {
    const canceled = await cancelSubResources(tx, events, verification);
    staged.push(...canceled.staged);
    storageKeys.push(...canceled.storageKeys);
  }
  const files = await fileIdsByVerification(
    tx,
    environmentId,
    initiated.map((verification) => verification.id),
  );
  for (const verification of initiated) {
    const moved = await moveVerification(tx, verification, 'canceled', at);
    if (moved?.event != null) {
      staged.push(
        await stageVerificationEvent(
          tx,
          events,
          moved.event,
          { ...moved.verification, checks: verification.checks },
          files.get(verification.id) ?? [],
        ),
      );
    }
  }
  return { staged, storageKeys };
}
