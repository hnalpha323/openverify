/**
 * C120.9 (F35): the run side of every redaction, called from `services/redaction.ts`,
 * `services/reports/redaction.ts` and `services/transactions/redaction.ts`.
 *
 * It finds the runs through `workflow_run_subjects`, plus every `subjects_overflow` run of the
 * environment (P33), and nulls their sealed columns. A run's state lives in those columns, so an
 * unfinished run cannot go on: it ends `errored` with `subject_redacted`, its waits and pending steps
 * canceled and its running steps fenced out. Scheduled runs about the subject are canceled. A run's
 * trigger files lose their key and name here, and the C16 pass deletes the objects, so a failed delete
 * fails nothing. A PII-to-PII copy a run made from the subject is named in a system audit entry, by
 * ids alone (P20): what wrote it cannot unwrite another object.
 *
 * The redaction's transaction already holds the subject's row and then takes each run's: the same
 * order the executor keeps, with a domain object before a run (`engine/executor.ts`).
 */
import {
  appendWorkflowJournal,
  cancelScheduledRunsForSubjects,
  cancelWorkflowRunSteps,
  endWorkflowRun,
  forgetStoredResponses,
  listWorkflowEffectCopiesOf,
  listWorkflowRunsForSubjects,
  lockWorkflowRun,
  redactWorkflowRunFiles,
  redactWorkflowRunValues,
  stubEventPayloads,
  type Db,
  type WorkflowRunRow,
} from '@openverify/db';
import { createEventPublisher } from '../../events/index.js';
import { appendSystemAuditEntry } from '../../services/audit-log.js';
import { workflowErrorTypeOf } from '@openverify/workflow-engine';
import { definitionOf } from '../engine/run-frame.js';
import { stageRunEnd } from '../engine/run-events.js';
import { redactCaseCopiesInTx } from '../../services/cases/redaction.js';

export interface RunRedactionInput {
  environmentId: string;
  /** The redacted objects' ids. */
  subjectIds: readonly string[];
  at: Date;
}

const REDACTED = 'subject_redacted';

/**
 * Staging needs no scheduler: the webhook sweep is the outbox, and this hook has no commit to wait
 * for. An event that causes nothing here: a run's own events never trigger a workflow (C118.8).
 */
const publisherFor = (tx: Db) =>
  createEventPublisher({
    db: tx,
    deliveries: { scheduleDelivery: () => Promise.resolve() },
  });

/** One run's values go; if it was unfinished, it ends here. */
export async function redactRunInTx(tx: Db, run: WorkflowRunRow, at: Date): Promise<void> {
  const { environmentId, id } = run;
  const locked = await lockWorkflowRun(tx, environmentId, id);
  if (locked === null) {
    return;
  }
  if (await redactWorkflowRunValues(tx, environmentId, id, at)) {
    await appendWorkflowJournal(tx, environmentId, [{ runId: id, kind: 'run_redacted' }]);
  }
  await redactWorkflowRunFiles(tx, environmentId, id, at);
  if (locked.status !== 'in_progress') {
    return;
  }
  await cancelWorkflowRunSteps(tx, environmentId, id, {
    at,
    errorType: workflowErrorTypeOf(REDACTED),
    errorCode: REDACTED,
  });
  const ended = await endWorkflowRun(tx, environmentId, id, {
    status: 'errored',
    errorType: workflowErrorTypeOf(REDACTED),
    errorCode: REDACTED,
    at,
  });
  if (ended !== null) {
    await appendWorkflowJournal(tx, environmentId, [
      {
        runId: id,
        kind: 'run_errored',
        errorType: workflowErrorTypeOf(REDACTED),
        errorCode: REDACTED,
      },
    ]);
    const definition = await definitionOf(tx, environmentId, run.workflowVersionId);
    await stageRunEnd(tx, publisherFor(tx), ended, definition, []);
  }
}

export async function redactRunsForSubjectsInTx(tx: Db, input: RunRedactionInput): Promise<void> {
  const { environmentId, subjectIds, at } = input;
  const runs = await listWorkflowRunsForSubjects(tx, environmentId, subjectIds);
  for (const run of [...runs].sort((left, right) => left.id.localeCompare(right.id))) {
    await redactRunInTx(tx, run, at);
  }
  const runIds = runs.map(({ id }) => id);
  if (runIds.length > 0) {
    await stubEventPayloads(tx, environmentId, runIds, at);
    await forgetStoredResponses(tx, environmentId, runIds);
  }
  await cancelScheduledRunsForSubjects(tx, environmentId, subjectIds);
  const copies = await listWorkflowEffectCopiesOf(tx, environmentId, subjectIds);
  const copied = [...new Set(copies.flatMap(({ copyTargetId }) => copyTargetId ?? []))];
  // C139.1 (Workflow 8B): a case field or comment a run copied goes with its source (`api-cases`).
  const redacted = new Set(
    copied.length === 0
      ? []
      : await redactCaseCopiesInTx(tx, { environmentId, targetIds: copied, at }),
  );
  const targets = copied.filter((id) => !redacted.has(id));
  if (targets.length > 0) {
    await appendSystemAuditEntry(tx, environmentId, {
      action: 'workflow-run.redaction-copies-found',
      resourceType: 'workflow-run',
      resourceId: copies[0]?.runId ?? '',
      metadata: { 'source-ids': [...subjectIds], 'target-ids': targets },
    });
  }
}
