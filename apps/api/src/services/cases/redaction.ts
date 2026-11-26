/**
 * C139.1 (F35, Workflow 8B, `api-cases`): a case's redaction in the caller's transaction (public
 * `DELETE /cases/:id`, `case.redacted`; no cascade).
 *
 * - Comment messages and sealed fields are nulled (ids, authors and times kept), the searchable-field
 *   keys deleted, tags cleared, `redacted-at` set; the history stays (it holds no value) and gains a
 *   `redacted` row; held objects are not redacted with the case (C139.2).
 * - The stored copies of the case and its comments are stubbed and forgotten (`stubEventPayloads`,
 *   `forgetStoredResponses`) before `case.redacted` is staged, so the new event is not stubbed.
 * - The case's own audit entry is written here, because only here a first redaction is known from a
 *   repeat: by the actor, or as the system naming the cause for a cascade (C127.7) or retention.
 * - A case redacted before is no change: no second entry or event. Cases are locked in id order.
 * - Attachments' objects and renditions come with checkpoint (F) (`api-case-files`); until then a
 *   case holds none, so nothing is handed back for deletion.
 *
 * `RedactionService.redactCase` (`services/redaction.ts`) and the transaction children's cascade
 * (`workflows/actions/transactions/children.ts`) call it.
 */
import type { AuditActor } from '@openverify/contracts';
import {
  appendAuditLog,
  appendCaseHistory,
  deleteCaseFieldKeys,
  forgetStoredResponses,
  getCaseRow,
  listCaseCommentIds,
  lockCaseRow,
  redactCaseCommentRows,
  redactCaseCommentsById,
  stubEventPayloads,
  updateCaseRow,
  cases,
  type Db,
} from '@openverify/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { StagedEvent, TransactionalEventPublisher } from '../../events/index.js';
import type { Clock } from '../../ports.js';
import { appendSystemAuditEntry, storedActorOf } from '../audit-log.js';
import { redactCaseAttachmentsInTx } from './attachments/redaction.js';
import { caseEventResource } from './resources.js';
import { checkedCaseAuditMetadata } from './audit.js';

export interface CaseRedactionDeps {
  events: TransactionalEventPublisher;
  clock: Clock;
}

export interface CaseRedactionInput {
  environmentId: string;
  caseIds: readonly string[];
  at: Date;
  /** Who asked; `null` for the system (a cascade, the C16 pass). */
  actor: AuditActor | null;
  /** C127.7: a cascade names what reached the case, for its system audit entry. */
  cause?: Readonly<Record<string, string>>;
}

export interface RedactedCases {
  /** Each case found, and whether it was redacted before this pass. */
  cases: readonly { id: string; redactedAt: Date; alreadyRedacted: boolean }[];
  staged: readonly StagedEvent[];
  /** Attachment and rendition objects to delete after the commit (a failure is the C16 purge's). */
  storageKeys: readonly string[];
}

export const NO_CASES_REDACTED: RedactedCases = { cases: [], staged: [], storageKeys: [] };

export async function redactCasesInTx(
  tx: Db,
  deps: CaseRedactionDeps,
  input: CaseRedactionInput,
): Promise<RedactedCases> {
  const { environmentId, at, actor } = input;
  const found: { id: string; redactedAt: Date; alreadyRedacted: boolean }[] = [];
  const staged: StagedEvent[] = [];
  const storageKeys: string[] = [];
  for (const id of [...new Set(input.caseIds)].sort()) {
    const row = await lockCaseRow(tx, environmentId, id);
    if (row === null) {
      continue;
    }
    if (row.redactedAt !== null) {
      found.push({ id, redactedAt: row.redactedAt, alreadyRedacted: true });
      continue;
    }
    const commentIds = await listCaseCommentIds(tx, environmentId, [id]);
    await redactCaseCommentRows(tx, environmentId, [id], at);
    await deleteCaseFieldKeys(tx, environmentId, [id]);
    await updateCaseRow(tx, environmentId, id, { fields: null, tags: [], redactedAt: at });
    // C139.1 (P34; Stage 1b item 45): names and digests nulled, objects deleted after the commit.
    const files = await redactCaseAttachmentsInTx(tx, { environmentId, caseIds: [id], at });
    storageKeys.push(...files.storageKeys);
    await appendCaseHistory(tx, environmentId, [
      {
        caseId: id,
        kind: 'redacted',
        actorType: actor?.type ?? 'system',
        actorId: actor?.id ?? null,
        ...(input.cause === undefined ? {} : { to: { ...input.cause } }),
      },
    ]);
    await stubEventPayloads(tx, environmentId, [id, ...commentIds], at);
    await forgetStoredResponses(tx, environmentId, [id, ...commentIds]);
    const redacted = await getCaseRow(tx, environmentId, id);
    if (redacted !== null) {
      staged.push(
        await deps.events.stage(tx, {
          environmentId,
          name: 'case.redacted',
          payload: { data: await caseEventResource(tx, environmentId, redacted) },
        }),
      );
    }
    const metadata = {
      'comment-count': commentIds.length,
      ...(input.cause ?? {}),
    };
    checkedCaseAuditMetadata('case.redacted', metadata);
    if (actor === null) {
      await appendSystemAuditEntry(tx, environmentId, {
        action: 'case.redacted',
        resourceType: 'case',
        resourceId: id,
        metadata,
      });
    } else {
      await appendAuditLog(tx, environmentId, {
        ...storedActorOf(actor),
        action: 'case.redacted',
        resourceType: 'case',
        resourceId: id,
        metadata,
      });
    }
    found.push({ id, redactedAt: at, alreadyRedacted: false });
  }
  return { cases: found, staged, storageKeys };
}

/**
 * C120.9, C139.1 (P20): the case fields and comments a run copied from a redacted subject (its effect
 * rows' targets), redacted with that subject: a case target loses its fields and their keys (the
 * case itself stays, so its other content is not lost), a comment target its message. Answers the
 * ids it redacted, which `redactRunsForSubjectsInTx` leaves out of its audit entry.
 */
export async function redactCaseCopiesInTx(
  tx: Db,
  input: { environmentId: string; targetIds: readonly string[]; at: Date },
): Promise<readonly string[]> {
  const { environmentId, at } = input;
  const caseIds = input.targetIds.filter((id) => id.startsWith('case_'));
  const commentIds = input.targetIds.filter((id) => id.startsWith('cscm_'));
  const redacted: string[] = [];
  if (caseIds.length > 0) {
    const live = await tx
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          eq(cases.environmentId, environmentId),
          inArray(cases.id, caseIds),
          isNull(cases.redactedAt),
        ),
      );
    for (const { id } of live) {
      await updateCaseRow(tx, environmentId, id, { fields: {} });
      redacted.push(id);
    }
    await deleteCaseFieldKeys(
      tx,
      environmentId,
      live.map(({ id }) => id),
    );
  }
  redacted.push(...(await redactCaseCommentsById(tx, environmentId, commentIds, at)));
  return redacted.sort();
}
