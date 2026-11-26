/**
 * C137.4 (Workflow 8B, `api-cases`): `POST /cases/bulk` and `GET /case-bulk-actions/:id`.
 *
 * - A selection is `case-ids` (at most 500) or a search, resolved now under the reader's visibility
 *   and C137.2's PII rule; a search past 500 is `case_bulk_too_large`.
 * - Assigning needs `cases:assign` (C129.4); a queue a set-queue names must be an active queue here.
 * - The action is written pending, its request sealed, and the `case-bulk` job applies it; the answer
 *   is 202. If the job cannot be enqueued, the row stays pending for a sweep
 *   (`requeueUnfinishedCaseBulkActions`), never lost and never reported done.
 * - Only the creating principal reads it (Stage 1a amendment 19); anyone else gets 404.
 */
import {
  buildCaseBulkActionResource,
  newId,
  type CaseBulkActionDocument,
  type CreateCaseBulkActionBody,
} from '@openverify/contracts';
import { CASE_LIMITS } from '@openverify/core';
import {
  createCaseBulkActionRow,
  getCaseBulkActionRow,
  listUnfinishedCaseBulkActions,
  type CaseBulkActionRecordRow,
  type Db,
} from '@openverify/db';
import { NotFoundError, PermissionDeniedError } from '../../../errors.js';
import type { CaseBulkQueue } from '../../../ports.js';
import type { ApiDependencies } from '../../context.js';
import { assertQueueIn } from '../create.js';
import { CaseProblemError } from '../problems.js';
import { caseIdsMatching, compileCaseSearch } from '../search.js';
import type { CaseActing } from '../service.js';
import { caseChange, readerOf } from '../shared.js';

const BULK_CASES = CASE_LIMITS['bulk-cases'].value;

function resourceOf(row: CaseBulkActionRecordRow) {
  return buildCaseBulkActionResource({
    id: row.id,
    action: row.action,
    status: row.status,
    requestedCount: row.requestedCount,
    outcomes: row.outcomes,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  });
}

/** C137.4: 202 with the pending action; the `case-bulk` job applies it. */
export async function createCaseBulkAction(
  deps: ApiDependencies,
  acting: CaseActing,
  body: CreateCaseBulkActionBody,
): Promise<CaseBulkActionDocument> {
  const { environmentId } = acting.ctx;
  const { attributes } = body.data;
  if (attributes.action === 'assign' && !acting.principal.permissions.has('cases:assign')) {
    throw new PermissionDeniedError('Assigning cases needs cases:assign.', ['cases:assign']);
  }
  if (attributes.action === 'set-queue') {
    const queueId = (body.meta as { 'case-queue-id': string | null })['case-queue-id'];
    if (queueId !== null) {
      await assertQueueIn(deps.db, environmentId, queueId, '/meta/case-queue-id');
    }
  }
  let caseIds = attributes['case-ids'] ?? [];
  if (attributes.search !== undefined) {
    const condition = await compileCaseSearch(
      deps,
      acting,
      attributes.search.query,
      '/data/attributes/search/query',
    );
    caseIds = await caseIdsMatching(
      deps.db,
      environmentId,
      readerOf(acting.principal),
      condition,
      BULK_CASES + 1,
    );
    if (caseIds.length > BULK_CASES) {
      throw new CaseProblemError(
        'case_bulk_too_large',
        `A bulk action takes at most ${String(BULK_CASES)} cases; narrow the search.`,
      );
    }
  }
  const row = await caseChange(deps, acting, async (unit) => {
    const created = await createCaseBulkActionRow(unit.tx, environmentId, {
      id: newId('cblk'),
      action: attributes.action,
      creatorType: acting.actor.type,
      creatorId: acting.actor.id,
      request: { 'case-ids': caseIds, meta: body.meta },
      requestedCount: caseIds.length,
    });
    await unit.audit({
      action: 'case-bulk-action.created',
      resourceType: 'case-bulk-action',
      resourceId: created.id,
      metadata: { action: attributes.action, 'case-count': caseIds.length },
    });
    return created;
  });
  await enqueue(deps.caseBulk, environmentId, row.id);
  return { data: resourceOf(row) };
}

/** Enqueues the job; a failure leaves the row pending for the sweep (C143.2). */
async function enqueue(queue: CaseBulkQueue | undefined, environmentId: string, id: string) {
  try {
    await queue?.enqueueCaseBulkAction({ environmentId, bulkActionId: id });
  } catch {
    // The row is the record: `requeueUnfinishedCaseBulkActions` enqueues it again.
  }
}

/** Read by its creating principal alone (Stage 1a amendment 19). */
export async function getCaseBulkAction(
  deps: ApiDependencies,
  acting: CaseActing,
  id: string,
): Promise<CaseBulkActionDocument> {
  const row = await getCaseBulkActionRow(deps.db, acting.ctx.environmentId, id);
  if (row?.creatorType !== acting.actor.type || row.creatorId !== acting.actor.id) {
    throw new NotFoundError(`Case bulk action ${id} was not found.`);
  }
  return { data: resourceOf(row) };
}

/**
 * C143.2: enqueues the unfinished actions made before `before` again (a lost enqueue, a crashed
 * worker). The plan names no sweep for `case-bulk`; this is the one to register (60 s is enough).
 */
export async function requeueUnfinishedCaseBulkActions(
  db: Db,
  queue: CaseBulkQueue,
  before: Date,
  limit = 500,
): Promise<number> {
  const rows = await listUnfinishedCaseBulkActions(db, before, limit);
  for (const row of rows) {
    await queue.enqueueCaseBulkAction({ environmentId: row.environmentId, bulkActionId: row.id });
  }
  return rows.length;
}
