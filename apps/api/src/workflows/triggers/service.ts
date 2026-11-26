/**
 * C118.2, C118.5, C118.1: the routes that start a run, and the deliveries the runs view reads. Owner:
 * `api-triggers`. A start's checks are in `start.ts`, and the account actions in `account-actions.ts`.
 * A run's transaction also writes its trigger files and its audit entry, so a run is never committed
 * without either. An answer's values are masked by the run routes' own document (C120.6).
 */
import { readCsv, type CsvRow } from '@openverify/checks';
import {
  WORKFLOW_TRIGGER_LIMITS,
  anyIdSchema,
  buildWorkflowTriggerDeliveryResource,
  filterValues,
  idSchema,
  isId,
  type CreateWorkflowManualRunsBody,
  type EventName,
  type TriggerWorkflowBody,
  type WorkflowManualRunsDocument,
  type WorkflowRunDocument,
  listWorkflowTriggerDeliveriesQuerySchema,
  workflowTriggerDeliveryListDocumentSchema,
} from '@openverify/contracts';
import { workflowDeliveryStatusSchema, type WorkflowObjectType } from '@openverify/core';
import {
  listWorkflowDeliveries as listDeliveryRows,
  subjectIdsIn,
  type WorkflowLiveTarget,
} from '@openverify/db';
import type { z } from 'zod';
import { WorkflowProblemError } from '../../errors.js';
import { auditEntryOf, type ApiDependencies } from '../../services/context.js';
import { nextLink, pageRequest, withCursor } from '../../services/pagination.js';
import type { WorkflowActing } from '../acting.js';
import {
  startWorkflowRunInTx,
  wakeStartedRun,
  type StartedWorkflowRun,
} from '../engine/start-run.js';
import { getWorkflowRunDocument } from '../runs/service.js';
import { deferredUntil, runGuard } from './admission.js';
import { readTriggerFields } from './inputs.js';
import { isRedactedObject, snapshotFits, triggerDocumentOf, triggerViewOf } from './objects.js';
import {
  assertMayStart,
  assertMayStartEverySide,
  consumeTriggerRate,
  creatorOf,
  engineOfApi,
  idempotencyDigest,
  principalIdOf,
  recordTriggerFiles,
  removeTriggerFiles,
  runningWorkflow,
  storeTriggerFiles,
  targetFor,
} from './start.js';
import { caseObjectIdFits } from '../actions/cases/trigger.js';

export {
  createAccountAction,
  getAccountActionDocument,
  listAccountActions,
  listAccountAvailableActions,
  runAccountAction,
  updateAccountAction,
} from './account-actions.js';

export const WORKFLOW_TRIGGER_DELIVERIES_PATH = '/api/v1/workflow-trigger-deliveries';

/** The CSV of a manual run: one column of ids (C118.5). */
const OBJECT_ID_COLUMN = 'object-id';
/** A record is an id and its quotes. */
const CSV_RECORD_CHARACTERS = 128;

const ID_PREFIX_BY_OBJECT_TYPE = {
  account: 'acc',
  inquiry: 'inq',
  report: 'rep',
  transaction: 'txn',
} as const;

/**
 * C118.2: `POST /workflows/:id/trigger`. The fields are validated by the live version's inputs before
 * anything is stored, and a key repeated past the 24-hour store answers the run it made.
 */
export async function triggerWorkflow(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: TriggerWorkflowBody,
  idempotencyKey?: string,
): Promise<WorkflowRunDocument> {
  const { principal, ctx, actor } = acting;
  const { environmentId } = ctx;
  await consumeTriggerRate(deps, acting);
  const live = await runningWorkflow(deps.db, environmentId, id);
  const target = targetFor(live, idempotencyKey ?? deps.ids.newId('wfr'), 'trigger-api');
  assertMayStart(principal, target);
  const { inputs, files } = readTriggerFields(
    target.definition.inputs,
    body.data.attributes.fields,
    deps.ids,
  );
  const stored = await storeTriggerFiles(deps, environmentId, files);
  const engine = engineOfApi(deps);
  let started: StartedWorkflowRun;
  try {
    started = await deps.db.transaction(async (tx) => {
      const run = await startWorkflowRunInTx(tx, engine, {
        environmentId,
        workflowId: id,
        workflowVersionId: target.version.id,
        deploymentId: target.deploymentId,
        rolloutLabel: target.rolloutLabel,
        triggerType: 'trigger-api',
        idempotencyKey:
          idempotencyKey === undefined ? null : idempotencyDigest(principal, idempotencyKey),
        creator: creatorOf(principal),
        trigger: inputs,
        inputs,
        subjectIds: subjectIdsIn(inputs),
        causedByPrincipal: principalIdOf(principal),
        grant: target.grant,
      });
      if (run.created) {
        await recordTriggerFiles(tx, environmentId, run.run.id, stored);
        await deps.audit.record(
          tx,
          auditEntryOf(ctx, actor, {
            action: 'workflow.triggered',
            resourceType: 'workflow',
            resourceId: id,
            metadata: { 'workflow-run-id': run.run.id },
          }),
        );
      }
      return run;
    });
  } catch (error) {
    await removeTriggerFiles(deps, stored);
    throw error;
  }
  if (!started.created) {
    await removeTriggerFiles(deps, stored);
  }
  await wakeStartedRun(engine, started);
  return getWorkflowRunDocument(deps, acting, started.run.id, {});
}

interface ManualRow {
  objectId: string | null;
  row: number | null;
  code: string | null;
}

/** One column named `object-id`. */
function manualCsvRows(csv: string): ManualRow[] {
  const reading = readCsv(new TextEncoder().encode(csv), {
    maxRows: WORKFLOW_TRIGGER_LIMITS['manual-run-objects'].value,
    maxRecordCharacters: CSV_RECORD_CHARACTERS,
    headerProblems: (header) =>
      header.includes(OBJECT_ID_COLUMN)
        ? []
        : [{ row: null, column: null, code: 'missing_column' }],
  });
  if (reading.refused) {
    throw new WorkflowProblemError(
      'trigger_input_invalid',
      `The CSV must hold one column, ${OBJECT_ID_COLUMN}, within the limits.`,
      { members: { source: { pointer: '/data/attributes/csv' } } },
    );
  }
  const rowOf = ({ row, cells }: CsvRow): ManualRow => {
    const parsed = anyIdSchema.safeParse(cells[OBJECT_ID_COLUMN]);
    return parsed.success
      ? { objectId: parsed.data, row, code: null }
      : { objectId: null, row, code: 'object_id_invalid' };
  };
  return [
    ...reading.rows.map(rowOf),
    ...reading.errors.map(({ row, code }) => ({ objectId: null, row, code })),
  ];
}

function manualRows(body: CreateWorkflowManualRunsBody): ManualRow[] {
  const { csv, 'object-ids': objectIds } = body.data.attributes;
  return csv === undefined
    ? (objectIds ?? []).map((objectId) => ({ objectId, row: null, code: null }))
    : manualCsvRows(csv);
}

/** C118.5: whether `id` can name an object of `objectType` in a manual run. */
export const objectIdFits = (objectType: WorkflowObjectType, id: string): boolean =>
  objectType === 'case' ? caseObjectIdFits(id) : isId(ID_PREFIX_BY_OBJECT_TYPE[objectType], id);

interface ManualContext {
  deps: ApiDependencies;
  acting: WorkflowActing;
  workflowId: string;
  live: WorkflowLiveTarget;
  objectType: WorkflowObjectType;
  idempotencyKey: string | undefined;
}

/** One object's run; a string when it started none. */
async function startManualRun(
  context: ManualContext,
  objectId: string,
): Promise<StartedWorkflowRun | string> {
  const { deps, acting, workflowId, live, objectType, idempotencyKey } = context;
  const { principal } = acting;
  const { environmentId } = acting.ctx;
  const document = await triggerDocumentOf(deps.db, environmentId, objectType, objectId);
  if (document === null) {
    return 'object_not_found';
  }
  if (isRedactedObject(document)) {
    return 'subject_redacted';
  }
  const target = targetFor(live, objectId, 'trigger-direct');
  const view = await triggerViewOf(deps.db, environmentId, target.definition, document);
  if (!snapshotFits(view)) {
    return 'payload_too_large';
  }
  const held = await deferredUntil(deps.rateLimiter, deps.clock.now(), [runGuard(environmentId)]);
  if (held !== null) {
    return 'rate_limited';
  }
  return deps.db.transaction((tx) =>
    startWorkflowRunInTx(tx, engineOfApi(deps), {
      environmentId,
      workflowId,
      workflowVersionId: target.version.id,
      deploymentId: target.deploymentId,
      rolloutLabel: target.rolloutLabel,
      triggerType: 'trigger-direct',
      idempotencyKey:
        idempotencyKey === undefined
          ? null
          : idempotencyDigest(principal, `${idempotencyKey}/${objectId}`),
      creator: creatorOf(principal),
      trigger: view,
      inputs: {},
      subjectIds: [objectId],
      causedByPrincipal: principalIdOf(principal),
      grant: target.grant,
      oneRunPerSubject:
        target.definition.trigger?.['one-run-per-subject'] === true ? objectId : null,
    }),
  );
}

/** C118.5: one run per object, the operator's principal, and one audit entry. */
export async function createWorkflowManualRuns(
  deps: ApiDependencies,
  acting: WorkflowActing,
  id: string,
  body: CreateWorkflowManualRunsBody,
  idempotencyKey?: string,
): Promise<WorkflowManualRunsDocument> {
  const { principal, ctx, actor } = acting;
  await consumeTriggerRate(deps, acting);
  const live = await runningWorkflow(deps.db, ctx.environmentId, id);
  assertMayStartEverySide(principal, live, 'trigger-direct');
  const { trigger } = targetFor(live, id, 'trigger-direct').definition;
  if (trigger?.type !== 'trigger-direct') {
    throw new WorkflowProblemError('workflow_not_running', 'No manual run starts this workflow.');
  }
  const objectType = trigger.config['object-type'];
  const context: ManualContext = {
    deps,
    acting,
    workflowId: id,
    live,
    objectType,
    idempotencyKey,
  };
  const runIds: string[] = [];
  const refused: WorkflowManualRunsDocument['meta']['refused'] = [];
  const seen = new Set<string>();
  const engine = engineOfApi(deps);
  for (const { objectId, row, code } of manualRows(body)) {
    let refusal = code;
    if (refusal === null && objectId !== null) {
      if (!objectIdFits(objectType, objectId)) {
        refusal = 'object_id_invalid';
      } else if (seen.has(objectId)) {
        refusal = 'object_repeated';
      } else {
        seen.add(objectId);
        const started = await startManualRun(context, objectId);
        if (typeof started === 'string') {
          refusal = started;
        } else {
          runIds.push(started.run.id);
          await wakeStartedRun(engine, started);
        }
      }
    }
    if (refusal !== null) {
      refused.push({ 'object-id': objectId, row, code: refusal });
    }
  }
  await deps.audit.record(
    deps.db,
    auditEntryOf(ctx, actor, {
      action: 'workflow.manual-runs',
      resourceType: 'workflow',
      resourceId: id,
      metadata: { started: runIds.length, refused: refused.length },
    }),
  );
  return { meta: { 'workflow-run-ids': runIds, refused } };
}

/** C118.1 (H18): refused, filtered and expired deliveries, with their reason codes. */
export async function listWorkflowTriggerDeliveries(
  deps: ApiDependencies,
  acting: WorkflowActing,
  query: z.infer<typeof listWorkflowTriggerDeliveriesQuerySchema>,
): Promise<z.infer<typeof workflowTriggerDeliveryListDocumentSchema>> {
  const page = await withCursor(() =>
    listDeliveryRows(
      deps.db,
      acting.ctx.environmentId,
      {
        workflowIds: filterValues(query['filter[workflow-id]'], idSchema('wfl')),
        statuses: filterValues(query['filter[status]'], workflowDeliveryStatusSchema),
      },
      pageRequest(query),
    ),
  );
  return {
    data: page.items.map((row) =>
      buildWorkflowTriggerDeliveryResource({
        id: row.id,
        workflowId: row.workflowId,
        eventId: row.eventId,
        eventName: row.eventName as EventName,
        workflowRunId: row.workflowRunId,
        status: row.status,
        reasonCode: row.reasonCode,
        notBefore: row.notBefore,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    ),
    links: {
      next: nextLink(
        WORKFLOW_TRIGGER_DELIVERIES_PATH,
        {
          'filter[workflow-id]': query['filter[workflow-id]'],
          'filter[status]': query['filter[status]'],
        },
        query,
        page.next,
      ),
    },
  };
}
