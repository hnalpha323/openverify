/**
 * C137.4 (Workflow 8B, `api-cases`): the `case-bulk` job: applies one bulk action to each case
 * through the same services as the single routes, in its own transaction per case, under
 * `runWithEventCause` with the action's `cblk_` id and its creator as the principal (C121.3), acting
 * as that creator (its visibility holds), and records each outcome on the row: `applied`,
 * `no_change`, or `refused` with the refusal's problem code. A resolution a bulk action makes is no
 * person's step (C128.2): its events carry the bulk id.
 *
 * The claim is `FOR UPDATE SKIP LOCKED`, so two jobs never apply one action at once; an action done
 * is never applied again. Without the worker's publisher no change can stage its events, so the
 * action is left pending, logged by id, rather than half applied.
 */
import type { SetCaseStatusBody } from '@openverify/contracts';
import {
  claimCaseBulkActionRow,
  completeCaseBulkActionRow,
  environments,
  type CaseBulkOutcomeRow,
  type Db,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { UNMASKED } from '../../../auth/pii.js';
import { AppError } from '../../../errors.js';
import type { TransactionalEventPublisher } from '../../../events/index.js';
import { runWithEventCause } from '../../../events/cause-context.js';
import type { WorkerLogger } from '../../../jobs/logger.js';
import { systemClock, type CaseBulkJob } from '../../../ports.js';
import { createAuditLogger } from '../../audit-log.js';
import { tagsOf } from '../create.js';
import { changeCaseTagsInTx, setCaseStatusInTx } from '../service.js';
import { caseChange, type CaseActor, type CaseUnit } from '../shared.js';
import { assignCaseManuallyInTx, setCaseQueueInTx } from './apply.js';

export interface CaseBulkDeps {
  db: Db;
  logger: WorkerLogger;
  /**
   * The worker's publisher, which each case's events are staged through. Without it no change can
   * be applied honestly, so an action waits, pending, for a worker that passes it.
   */
  events?: TransactionalEventPublisher;
}

/** A job, then its dependencies, as every queue's processor (`listJobProcessor`). */
export type ProcessCaseBulkAction = (job: CaseBulkJob, deps: CaseBulkDeps) => Promise<void>;

interface BulkRequest {
  'case-ids': string[];
  meta: Record<string, unknown>;
}

/** The code a refusal records: its problem code, or the status's when it has none. */
function refusalCode(error: AppError): string {
  if (error.code !== undefined) {
    return error.code.replaceAll('-', '_');
  }
  switch (error.status) {
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 410:
      return 'gone';
    default:
      return 'unprocessable';
  }
}

/** What one case of the action does; whether it changed anything. */
function applyOne(unit: CaseUnit, action: string, caseId: string, meta: Record<string, unknown>) {
  switch (action) {
    case 'add-tags': {
      const names = meta['tag-names'] as string[];
      return changeCaseTagsInTx(unit, caseId, (tags) => tagsOf([...tags, ...names]));
    }
    case 'remove-tags': {
      const names = new Set((meta['tag-names'] as string[]).map((name) => name.toLowerCase()));
      return changeCaseTagsInTx(unit, caseId, (tags) =>
        tags.filter((tag) => !names.has(tag.toLowerCase())),
      );
    }
    case 'set-status':
      return setCaseStatusInTx(unit, caseId, meta as SetCaseStatusBody['meta']);
    case 'set-queue':
      return setCaseQueueInTx(unit, caseId, meta['case-queue-id'] as string | null);
    case 'assign':
      return assignCaseManuallyInTx(unit, caseId, meta['user-id'] as string | null);
    default:
      throw new Error(`Unknown case bulk action ${action}`);
  }
}

export const processCaseBulkAction: ProcessCaseBulkAction = async (job, deps) => {
  const { environmentId, bulkActionId } = job;
  const { events } = deps;
  if (events === undefined) {
    deps.logger.warn(
      { 'case-bulk-action-id': bulkActionId },
      'case bulk action left pending: the worker passed no event publisher',
    );
    return;
  }
  const claimed = await deps.db.transaction((tx) =>
    claimCaseBulkActionRow(tx, environmentId, bulkActionId),
  );
  if (claimed?.request === null || claimed === null) {
    return;
  }
  const [environment] = await deps.db
    .select({ organizationId: environments.organizationId })
    .from(environments)
    .where(eq(environments.id, environmentId))
    .limit(1);
  if (environment === undefined) {
    return;
  }
  const request = claimed.request as unknown as BulkRequest;
  const acting: CaseActor = {
    ctx: { environmentId, organizationId: environment.organizationId },
    actor: { type: claimed.creatorType, id: claimed.creatorId },
    mask: UNMASKED,
    principal: null,
  };
  const writeDeps = { db: deps.db, events, audit: createAuditLogger(), clock: systemClock };
  const outcomes: CaseBulkOutcomeRow[] = [];
  for (const caseId of request['case-ids']) {
    try {
      const changed = await runWithEventCause(
        { bulkId: bulkActionId, principal: claimed.creatorId },
        () =>
          caseChange(writeDeps, acting, (unit) =>
            applyOne(unit, claimed.action, caseId, request.meta),
          ),
      );
      outcomes.push({ caseId, outcome: changed ? 'applied' : 'no_change', code: null });
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      outcomes.push({ caseId, outcome: 'refused', code: refusalCode(error) });
    }
  }
  await deps.db.transaction((tx) =>
    completeCaseBulkActionRow(tx, environmentId, bulkActionId, outcomes, systemClock.now()),
  );
  deps.logger.info(
    { 'case-bulk-action-id': bulkActionId, 'case-count': outcomes.length },
    'case bulk action done',
  );
};
