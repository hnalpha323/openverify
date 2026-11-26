/**
 * C120.8, C120.9 (`api-engine`, foundation amendment 17): redaction and retention of runs on a real
 * schema. A redaction leaves none of the run tables holding a value, ends an unfinished run, cancels
 * what was waiting and what was scheduled, reaches every overflowed run of the environment, and names
 * the copies a run made. Every value is synthetic.
 */
import {
  claimWorkflowEffect,
  completeWorkflowEffect,
  createScheduledRun,
  deleteProcessedWaitCandidates,
  insertWorkflowWaitCandidate,
  markWaitCandidateProcessed,
  openWorkflowRunValues,
} from '@openverify/db';
import { seedWorkflowRunFile, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ActionHandler } from '../engine/action-port.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  outputsOf,
  publish,
  runOf,
  start,
  stepOf,
  stepsOf,
  type EngineHarness,
} from '../engine/testing.js';
import { redactRunsForSubjectsInTx } from './redaction.js';
import { runWorkflowRetention } from './retention.js';

const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';

const tag: ActionHandler = {
  key: 'tag_object',
  version: 1,
  shape: 'transaction',
  execute: () =>
    Promise.resolve({
      kind: 'succeeded',
      output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 1 },
    }),
};

let harness: EngineHarness;

beforeAll(async () => {
  harness = await createEngineHarness([tag]);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const tagStep = action('t', 'tag_object', { 'object-type': 'inquiry', tag: 'x' });

const redact = (subjectIds: readonly string[]) =>
  harness.db.transaction((tx) =>
    redactRunsForSubjectsInTx(tx, {
      environmentId: harness.environmentId,
      subjectIds,
      at: new Date('2026-11-02T00:00:00.000Z'),
    }),
  );

const ids = () => ({ subjectIds: [testId('inq')] });

/** Every column of the run tables that can hold a value, for one run. */
async function heldValues(runId: string): Promise<unknown[]> {
  const queries = [
    'select trigger_snapshot, inputs, variables, outputs from workflow_runs where id = $1',
    'select input, output, console from workflow_run_steps where run_id = $1',
    'select result from workflow_step_effects where run_id = $1',
    'select wrapped_dek, filename from workflow_run_files where run_id = $1',
  ];
  const found: unknown[] = [];
  for (const text of queries) {
    const { rows } = await harness.database.client.query<Record<string, unknown>>(text, [runId]);
    found.push(...rows.flatMap((row) => Object.values(row).filter((value) => value !== null)));
  }
  return found;
}

describe('redactRunsForSubjectsInTx (C120.9)', () => {
  it('leaves no run table holding a value of a finished run, keeping it finished', async () => {
    const input = ids();
    const id = await start(harness, chain([tagStep]), input);
    await drain(harness);
    await seedWorkflowRunFile(harness.db, harness.environmentId, { runId: id });
    expect((await heldValues(id)).length).toBeGreaterThan(0);

    await redact(input.subjectIds);

    expect(await heldValues(id)).toEqual([]);
    const run = await runOf(harness, id);
    expect(run.status).toBe('completed');
    expect(run.redactedAt).not.toBeNull();
    expect(await outputsOf(harness, id)).toBeNull();
  });

  it('ends an unfinished run, canceling its waits and fencing what runs', async () => {
    const input = ids();
    const id = await start(
      harness,
      chain([
        tagStep,
        {
          id: 'hold',
          type: 'wait',
          name: 'Hold',
          mode: 'events',
          subject: 'trigger.id',
          events: ['inquiry.approved'],
          'timeout-seconds': 600,
          'on-timeout': 'continue',
        },
      ]),
      input,
    );
    await drain(harness);
    expect((await stepOf(harness, id, 'hold')).status).toBe('waiting');

    await redact(input.subjectIds);

    const run = await runOf(harness, id);
    expect(run.status).toBe('errored');
    expect(run.errorCode).toBe('subject_redacted');
    expect(run.errorType).toBe('resource-error');
    const hold = await stepOf(harness, id, 'hold');
    expect(hold.status).toBe('canceled');
    expect(hold.errorCode).toBe('subject_redacted');
  });

  it('fences a step already enqueued: its job finds nothing to do', async () => {
    const input = ids();
    const id = await start(harness, chain([tagStep]), input);

    await redact(input.subjectIds);
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('subject_redacted');
    expect((await stepOf(harness, id, 't')).status).toBe('canceled');
  });

  it('reaches every overflowed run of the environment, and no other (P33)', async () => {
    const overflowed = await start(harness, chain([tagStep]), ids());
    await drain(harness);
    await harness.database.client.query(
      'update workflow_runs set subjects_overflow = true where id = $1',
      [overflowed],
    );
    const unrelated = await start(harness, chain([tagStep]), ids());
    await drain(harness);
    const named = ids();
    await start(harness, chain([tagStep]), named);
    await drain(harness);

    await redact(named.subjectIds);

    expect(await heldValues(overflowed)).toEqual([]);
    expect((await heldValues(unrelated)).length).toBeGreaterThan(0);
    await harness.database.client.query(
      'update workflow_runs set subjects_overflow = false where id = $1',
      [overflowed],
    );
  });

  it('finds an id a step put in its output (C117.2)', async () => {
    const id = await start(harness, chain([tagStep]));
    await drain(harness);

    await redact([SUBJECT]);

    expect(openWorkflowRunValues(await runOf(harness, id)).inputs).toBeNull();
  });

  it('cancels a scheduled run about the subject', async () => {
    const input = ids();
    const published = await publish(harness, chain([tagStep]));
    const scheduled = testId('srrun');
    await createScheduledRun(harness.db, harness.environmentId, {
      id: scheduled,
      targetWorkflowId: published.workflowId,
      sourceRunId: null,
      subjectId: input.subjectIds[0] ?? '',
      baseAt: new Date(),
      offsetValue: 1,
      offsetUnit: 'days',
      offsetDirection: 'after',
      fireAt: new Date('2027-01-01T00:00:00.000Z'),
      inputs: null,
    } as never);

    await redact(input.subjectIds);

    const rows = await harness.database.client.query<{ status: string }>(
      'select status from scheduled_runs where id = $1',
      [scheduled],
    );
    expect(rows.rows[0]?.status).toBe('canceled');
  });

  it('names a copy a run made from the subject, by ids alone (P20)', async () => {
    const input = ids();
    const id = await start(harness, chain([tagStep]));
    await drain(harness);
    const [{ id: stepId } = { id: '' }] = await stepsOf(harness, id);
    const effectKey = `${id}/copy/`;
    await claimWorkflowEffect(harness.db, harness.environmentId, {
      id: testId('wfef'),
      runId: id,
      stepId,
      effectKey,
      kind: 'update_object',
    });
    await completeWorkflowEffect(harness.db, harness.environmentId, effectKey, null, {
      targetId: 'acc_target',
      sourceSubjectIds: input.subjectIds,
    });

    await redact(input.subjectIds);

    const rows = await harness.database.client.query<{ action: string; metadata: unknown }>(
      `select action, metadata from audit_logs where environment_id = $1
         and action = 'workflow-run.redaction-copies-found'`,
      [harness.environmentId],
    );
    expect(rows.rows.map(({ metadata }) => metadata)).toContainEqual({
      'source-ids': input.subjectIds,
      'target-ids': ['acc_target'],
    });
  });

  it('does nothing for no subjects', async () => {
    await expect(redact([])).resolves.toBeUndefined();
  });
});

describe('runWorkflowRetention (C120.8)', () => {
  it('purges values, deletes skeletons, files and old candidates, leaving what is live', async () => {
    const old = await start(harness, chain([tagStep]));
    await drain(harness);
    await seedWorkflowRunFile(harness.db, harness.environmentId, { runId: old });
    const live = await start(
      harness,
      chain([{ id: 'pause', type: 'wait', name: 'Pause', mode: 'time', seconds: 86_400 }]),
    );
    await drain(harness);
    const storage = { delete: vi.fn(() => Promise.resolve()) };
    const eventId = testId('evt');
    await insertWorkflowWaitCandidate(harness.db, {
      eventId,
      environmentId: harness.environmentId,
      eventName: 'inquiry.approved',
      subjectIds: [],
    });
    await markWaitCandidateProcessed(
      harness.db,
      harness.environmentId,
      eventId,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const report = await runWorkflowRetention(
      { db: harness.db, storage: storage as never },
      { now: new Date(Date.now() + 40 * 86_400_000), limit: 500 },
    );

    expect(report.purgedWorkflowRunValues).toBeGreaterThanOrEqual(1);
    expect(report.purgedWorkflowRunFiles).toBeGreaterThanOrEqual(1);
    expect(storage.delete).toHaveBeenCalled();
    expect(await heldValues(old)).toEqual([]);
    expect((await heldValues(live)).length).toBeGreaterThan(0);
    expect((await runOf(harness, live)).status).toBe('in_progress');
    expect(
      await deleteProcessedWaitCandidates(harness.db, {
        before: new Date('2027-01-01T00:00:00.000Z'),
        limit: 10,
      }),
    ).toBe(0);

    const later = await runWorkflowRetention(
      { db: harness.db, storage: storage as never },
      { now: new Date(Date.now() + 400 * 86_400_000), limit: 500 },
    );

    expect(later.deletedWorkflowRunSkeletons).toBeGreaterThanOrEqual(1);
    const left = await harness.database.client.query('select 1 from workflow_runs where id = $1', [
      old,
    ]);
    expect(left.rows).toEqual([]);
    expect((await runOf(harness, live)).status).toBe('in_progress');
  });

  it('leaves a file whose delete failed for the next pass', async () => {
    const id = await start(harness, chain([tagStep]));
    await drain(harness);
    await seedWorkflowRunFile(harness.db, harness.environmentId, { runId: id });
    await harness.database.client.query(
      `update workflow_run_files set redacted_at = now(), wrapped_dek = null, filename = null
         where run_id = $1`,
      [id],
    );
    const storage = { delete: vi.fn(() => Promise.reject(new Error('storage is down'))) };

    const report = await runWorkflowRetention(
      { db: harness.db, storage: storage as never },
      { now: new Date(), limit: 500 },
    );

    expect(report.purgedWorkflowRunFiles).toBe(0);
  });
});
