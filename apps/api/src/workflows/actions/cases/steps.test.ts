/**
 * C140.3 (Workflow 8B, `api-case-workflows`): the eight case steps on the real engine, each through
 * the C131-C136 services in the effect's transaction with the run as the actor, and each exactly
 * once: a claim lost after the write rolls the case change back, the attempt that follows writes it
 * once, and a repeated job writes nothing. Every value is synthetic.
 */
import { getCaseRow, listTransactionChildren, type Case } from '@openverify/db';
import {
  createTestInquiry,
  seedTransaction,
  seedTransactionType,
  testId,
} from '@openverify/db/testing';
import type { JsonRecord } from '@openverify/workflow-engine';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { processWorkflowStep } from '../../../jobs/workflows/step.js';
import type { TestClock } from '../../../test-support/fakes.js';
import type { ActionHandler, ActionHandlerTable } from '../../engine/action-port.js';
import { effectsOf, runOf, start, stepOf } from '../../engine/testing.js';
import { action, chain, type ActionHarness } from '../testing.js';
import {
  CASE_GRANT,
  caseOn,
  createCaseStepHarness,
  handlersOf,
  personOf,
  policyOf,
  queueOf,
  rowsOf,
  stepOutputOf,
  useHandlers,
} from './testing.js';

let harness: ActionHarness;

beforeAll(async () => {
  harness = await createCaseStepHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const one = (key: string, config: Record<string, unknown>) => chain([action('step', key, config)]);

async function run(key: string, config: Record<string, unknown>, trigger?: JsonRecord) {
  const ran = await harness.run(one(key, config), {
    grant: CASE_GRANT,
    ...(trigger === undefined ? {} : { trigger }),
  });
  return {
    ...ran,
    output: ran.status === 'completed' ? await stepOutputOf(harness, ran.id) : null,
  };
}

const caseRow = async (id: string): Promise<Case> => {
  const row = await getCaseRow(harness.db, harness.environmentId, id);
  if (row === null) {
    throw new Error(`no case ${id}`);
  }
  return row;
};

const historyOf = (caseId: string) =>
  rowsOf<{ kind: string; actor_type: string; actor_id: string | null }>(
    harness,
    'select kind, actor_type, actor_id from case_history where case_id = $1 order by id',
    [caseId],
  );

const eventsOf = async (caseId: string) =>
  (
    await rowsOf<{ name: string }>(
      harness,
      'select name from events where environment_id = $1 and object_id = $2',
      [harness.environmentId, caseId],
    )
  )
    .map(({ name }) => name)
    .sort();

const casesOn = (templateId: string) =>
  rowsOf<{ id: string }>(harness, 'select id from cases where case_template_id = $1', [templateId]);

/** An id of a kind no case holds (C136.1: no SARs). */
const UNHELD_ID = 'sar_01ARZ3NDEKTSV4RRFFQ69G5FAV';

const runActor = (runId: string) => ({ actor_type: 'workflow-run', actor_id: runId });

describe('create_case (C140.3)', () => {
  it('makes a case as the run, holding what it names, with its step and its events', async () => {
    const { templateId } = await caseOn(harness);
    const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
    const queueId = await queueOf(harness);

    const ran = await run(
      'create_case',
      {
        'case-template-id': templateId,
        'object-ids': ['{{ trigger.id }}'],
        tags: ['escalated'],
        'case-queue-id': queueId,
        fields: { reference: 'synthetic-reference' },
      },
      { type: 'inquiry', id: inquiry.id, status: 'completed' },
    );

    expect(ran.status, ran.errorCode ?? '').toBe('completed');
    const caseId = String(ran.output?.['case-id']);
    expect(ran.output).toMatchObject({ status: 'open', outcome: 'applied' });
    const row = await caseRow(caseId);
    expect(ran.output?.name).toBe(row.name);
    expect(row).toMatchObject({
      caseTemplateId: templateId,
      creatorType: 'workflow-run',
      creatorId: ran.id,
      caseQueueId: queueId,
      tags: ['escalated'],
    });
    expect(row.workflowRunStepId).toBe((await stepOf(harness, ran.id, 'step')).id);
    expect(
      await rowsOf(harness, 'select inquiry_id from case_inquiries where case_id = $1', [caseId]),
    ).toEqual([{ inquiry_id: inquiry.id }]);
    expect(await historyOf(caseId)).toEqual([
      expect.objectContaining({ kind: 'created', ...runActor(ran.id) }),
      expect.objectContaining({ kind: 'object-attached', ...runActor(ran.id) }),
    ]);
    expect(await eventsOf(caseId)).toEqual(['case.created']);
  });

  it('starts a wall-clock SLA in the unit it names', async () => {
    const { templateId } = await caseOn(harness);
    // V8C-2: the step reads the clock it was given, which under load trails the wall clock; a
    // minute behind makes that gap certain, so the test cannot pass by timing alone.
    const clock = harness.services.clock as TestClock;
    const given = clock.now();
    clock.set(new Date(Date.now() - 60_000));
    onTestFinished(() => {
      clock.set(given);
    });
    const at = clock.now().getTime();
    const ran = await run('create_case', {
      'case-template-id': templateId,
      sla: { value: 2, unit: 'hours' },
    });
    const row = await caseRow(String(ran.output?.['case-id']));
    expect(row.slaState).toBe('running');
    // The fixed clock does not move, so the deadline is exactly two hours past what it reads.
    expect(row.slaExpiresAt?.getTime()).toBe(at + 2 * 3_600_000);
  });

  it('makes its case a child of the transaction that started the run (C127.7)', async () => {
    const { templateId } = await caseOn(harness);
    const type = await seedTransactionType(harness.db, harness.environmentId);
    const transaction = await seedTransaction(harness.db, harness.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    const ran = await run(
      'create_case',
      { 'case-template-id': templateId },
      { type: 'transaction', id: transaction.id },
    );
    const children = await listTransactionChildren(
      harness.db,
      harness.environmentId,
      transaction.id,
    );
    expect(children).toEqual([
      expect.objectContaining({ childType: 'case', childId: ran.output?.['case-id'] }),
    ]);
  });

  it('records a templated field as a copy from the trigger (C120.9, P20)', async () => {
    const { templateId } = await caseOn(harness);
    const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
    const ran = await run(
      'create_case',
      { 'case-template-id': templateId, fields: { reference: '{{ trigger.id }}' } },
      { type: 'inquiry', id: inquiry.id },
    );
    const [effect] = await effectsOf(harness, ran.id);
    expect(effect?.copyTargetId).toBe(ran.output?.['case-id']);
    expect(effect?.copySourceSubjectIds).toEqual([inquiry.id]);
  });

  it('refuses a template it cannot make a case on, and writes nothing', async () => {
    const { templateId } = await caseOn(harness);
    await harness.db.execute(
      sql`update case_templates set status = 'archived', archived_at = now() where id = ${templateId}`,
    );
    expect((await run('create_case', { 'case-template-id': templateId })).errorCode).toBe(
      'case_template_archived',
    );
    expect((await run('create_case', { 'case-template-id': testId('ctmpl') })).errorCode).toBe(
      'object_not_found',
    );
    const { templateId: other } = await caseOn(harness);
    expect(
      (await run('create_case', { 'case-template-id': other, 'object-ids': [UNHELD_ID] }))
        .errorCode,
    ).toBe('object_type_unsupported');
    expect(
      (await run('create_case', { 'case-template-id': other, fields: { unknown: 1 } })).errorCode,
    ).toBe('action_input_invalid');
    expect(await casesOn(other)).toHaveLength(1);
  });

  it('defers at the case-create budget, never past it, whether or not the limiter answers', async () => {
    // C143.3 (H30): a step past the budget waits for its next attempt (60, 300, 900 s), so the run
    // stays in progress with nothing made; it never fails open.
    const { templateId } = await caseOn(harness);
    const limiter = harness.services.rateLimiter;
    const deferred = async () => {
      const ran = await run('create_case', { 'case-template-id': templateId });
      expect(ran).toMatchObject({ status: 'in_progress', errorCode: null });
      return rowsOf<{ status: string; attempt: number; error_code: string | null }>(
        harness,
        `select status, attempt, error_code from workflow_run_steps
         where run_id = $1 and action_key = 'create_case'`,
        [ran.id],
      );
    };
    try {
      harness.services.rateLimiter = {
        consume: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }),
      } as never;
      const refused = await deferred();
      harness.services.rateLimiter = {
        consume: () => Promise.reject(new Error('the limiter cannot answer')),
      };
      const unanswered = await deferred();
      for (const steps of [refused, unanswered]) {
        expect(steps).toHaveLength(1);
        expect(steps[0]?.status).not.toBe('done');
      }
    } finally {
      harness.services.rateLimiter = limiter;
    }
    expect(await casesOn(templateId)).toHaveLength(1);
  });
});

describe('assign_case (C140.3, C132.3)', () => {
  it('assigns a person as the run, with its history, event and notification', async () => {
    const { caseId } = await caseOn(harness);
    const userId = await personOf(harness);
    const ran = await run('assign_case', { 'case-id': caseId, 'user-id': userId });

    expect(ran.output).toEqual({ 'case-id': caseId, 'assignee-id': userId, outcome: 'applied' });
    expect(await caseRow(caseId)).toMatchObject({
      assigneeId: userId,
      assignerType: 'workflow-run',
      assignerId: ran.id,
    });
    expect(await historyOf(caseId)).toEqual([
      expect.objectContaining({ kind: 'assigned', ...runActor(ran.id) }),
    ]);
    expect(await eventsOf(caseId)).toEqual(['case.assigned']);
    expect(
      await rowsOf(harness, 'select kind from user_notifications where case_id = $1', [caseId]),
    ).toEqual([{ kind: 'assigned' }]);
    const again = await run('assign_case', { 'case-id': caseId, 'user-id': userId });
    expect(again.output?.outcome).toBe('no_change');
  });

  it('refuses a person who cannot hold the case', async () => {
    const { caseId } = await caseOn(harness);
    const reader = await personOf(harness, ['cases:read']);
    expect((await run('assign_case', { 'case-id': caseId, 'user-id': reader })).errorCode).toBe(
      'case_assignee_ineligible',
    );
    expect((await caseRow(caseId)).assigneeId).toBeNull();
  });

  it('lets a named policy choose, and says when it found nobody', async () => {
    const { caseId } = await caseOn(harness);
    const agent = await personOf(harness);
    const policyId = await policyOf(harness, [agent]);
    const ran = await run('assign_case', { 'case-id': caseId, 'assignment-policy-id': policyId });
    expect(ran.output).toEqual({ 'case-id': caseId, 'assignee-id': agent, outcome: 'applied' });
    expect(await caseRow(caseId)).toMatchObject({
      assignerType: 'case-assignment-policy',
      assignerId: policyId,
    });
    expect(await eventsOf(caseId)).toEqual(['case.assigned']);

    const empty = await caseOn(harness);
    const nobody = await policyOf(harness, [await personOf(harness, ['cases:read'])]);
    const unassigned = await run('assign_case', {
      'case-id': empty.caseId,
      'assignment-policy-id': nobody,
    });
    expect(unassigned.output).toEqual({
      'case-id': empty.caseId,
      'assignee-id': null,
      outcome: 'no_change',
    });
    expect(
      (
        await run('assign_case', {
          'case-id': empty.caseId,
          'assignment-policy-id': testId('cap'),
        })
      ).errorCode,
    ).toBe('object_not_found');
  });
});

describe('update_case_status (C140.3, C131)', () => {
  it('resolves a case as the run, events in the machine’s order', async () => {
    const { caseId } = await caseOn(harness);
    const ran = await run('update_case_status', {
      'case-id': caseId,
      status: 'approved',
      resolution: 'Approved',
    });
    expect(ran.output).toEqual({
      'case-id': caseId,
      status: 'approved',
      'status-category': 'end',
      resolution: 'Approved',
      outcome: 'applied',
    });
    expect(await caseRow(caseId)).toMatchObject({
      resolverType: 'workflow-run',
      resolverId: ran.id,
    });
    expect(await eventsOf(caseId)).toEqual(['case.resolved', 'case.status-updated']);
    const again = await run('update_case_status', { 'case-id': caseId, status: 'approved' });
    expect(again.output?.outcome).toBe('no_change');
  });

  it('refuses what the template refuses, and writes nothing', async () => {
    const { caseId } = await caseOn(harness);
    expect(
      (await run('update_case_status', { 'case-id': caseId, status: 'archived' })).errorCode,
    ).toBe('case_transition_refused');
    expect(
      (
        await run('update_case_status', {
          'case-id': caseId,
          status: 'approved',
          resolution: 'Unheard of',
        })
      ).errorCode,
    ).toBe('case_resolution_invalid');
    expect((await caseRow(caseId)).status).toBe('open');
  });

  it('writes its comment as the run’s, and records a templated one as a copy', async () => {
    const { caseId } = await caseOn(harness);
    const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
    const ran = await run(
      'update_case_status',
      { 'case-id': caseId, status: 'pending', comment: 'Waiting on {{ trigger.id }}' },
      { type: 'inquiry', id: inquiry.id },
    );
    const comments = await rowsOf<{ id: string; commenter_type: string }>(
      harness,
      'select id, commenter_type from case_comments where case_id = $1',
      [caseId],
    );
    expect(comments).toEqual([expect.objectContaining({ commenter_type: 'workflow-run' })]);
    const [effect] = await effectsOf(harness, ran.id);
    expect(effect?.copyTargetId).toBe(comments[0]?.id);
    expect(effect?.copySourceSubjectIds).toEqual([inquiry.id]);
  });
});

describe('add_case_comment (C140.3, C134)', () => {
  it('comments as the run, sealed, with its step, history and event', async () => {
    const { caseId } = await caseOn(harness);
    const ran = await run('add_case_comment', {
      'case-id': caseId,
      message: 'A synthetic note',
    });
    const commentId = String(ran.output?.['comment-id']);
    expect(ran.output).toEqual({ 'case-id': caseId, 'comment-id': commentId, outcome: 'applied' });
    const [comment] = await rowsOf<{
      commenter_type: string;
      commenter_id: string;
      workflow_run_step_id: string;
    }>(
      harness,
      'select commenter_type, commenter_id, workflow_run_step_id from case_comments where id = $1',
      [commentId],
    );
    expect(comment).toEqual({
      commenter_type: 'workflow-run',
      commenter_id: ran.id,
      workflow_run_step_id: (await stepOf(harness, ran.id, 'step')).id,
    });
    expect(await historyOf(caseId)).toEqual([
      expect.objectContaining({ kind: 'comment-added', ...runActor(ran.id) }),
    ]);
    const [{ total } = { total: -1 }] = await rowsOf<{ total: number }>(
      harness,
      `select count(*)::int as total from events where name = 'case-comment.created'
        and object_id = $1`,
      [commentId],
    );
    expect(total).toBe(1);
  });
});

describe('add_case_to_queue (C140.3, C132.1)', () => {
  it('moves the case into the queue, and its policy may assign', async () => {
    const { caseId } = await caseOn(harness);
    const agent = await personOf(harness);
    const queueId = await queueOf(harness, [agent]);
    const policyId = await policyOf(harness, null);
    await harness.db.execute(
      sql`update case_queues set case_assignment_policy_id = ${policyId} where id = ${queueId}`,
    );
    const ran = await run('add_case_to_queue', { 'case-id': caseId, 'case-queue-id': queueId });
    expect(ran.output).toEqual({ 'case-id': caseId, 'case-queue-id': queueId, outcome: 'applied' });
    expect(await caseRow(caseId)).toMatchObject({ caseQueueId: queueId, assigneeId: agent });
    expect(await eventsOf(caseId)).toEqual(['case.assigned', 'case.queue-updated']);
    const again = await run('add_case_to_queue', { 'case-id': caseId, 'case-queue-id': queueId });
    expect(again.output?.outcome).toBe('no_change');
  });

  it('refuses a queue this environment does not hold, or holds archived', async () => {
    const { caseId } = await caseOn(harness);
    expect(
      (await run('add_case_to_queue', { 'case-id': caseId, 'case-queue-id': testId('cqueue') }))
        .errorCode,
    ).toBe('object_not_found');
    const archived = await queueOf(harness);
    await harness.db.execute(
      sql`update case_queues set status = 'archived', archived_at = now() where id = ${archived}`,
    );
    expect(
      (await run('add_case_to_queue', { 'case-id': caseId, 'case-queue-id': archived })).errorCode,
    ).toBe('action_refused');
  });
});

describe('attach_objects_to_case (C140.3, C136)', () => {
  it('attaches each object once, and counts only the new ones', async () => {
    const { caseId } = await caseOn(harness);
    const first = await createTestInquiry(harness.db, harness.environmentId);
    const second = await createTestInquiry(harness.db, harness.environmentId);
    const ran = await run('attach_objects_to_case', {
      'case-id': caseId,
      'object-ids': [first.inquiry.id, second.inquiry.id],
    });
    expect(ran.output).toEqual({ 'case-id': caseId, 'attached-count': 2, outcome: 'applied' });
    const again = await run('attach_objects_to_case', {
      'case-id': caseId,
      'object-ids': [first.inquiry.id],
    });
    expect(again.output).toEqual({ 'case-id': caseId, 'attached-count': 0, outcome: 'no_change' });
    expect(await eventsOf(caseId)).toEqual(['case.updated']);
  });

  it('refuses an id no case can hold', async () => {
    const { caseId } = await caseOn(harness);
    expect(
      (
        await run('attach_objects_to_case', {
          'case-id': caseId,
          'object-ids': [UNHELD_ID],
        })
      ).errorCode,
    ).toBe('object_type_unsupported');
  });
});

describe('set_case_sla and clear_case_sla (C140.3, C133.1)', () => {
  it('sets a wall-clock deadline, and clears it', async () => {
    const { caseId } = await caseOn(harness);
    const ran = await run('set_case_sla', {
      'case-id': caseId,
      sla: { value: 3, unit: 'days' },
    });
    const row = await caseRow(caseId);
    expect(ran.output).toEqual({
      'case-id': caseId,
      'sla-expires-at': row.slaExpiresAt?.toISOString(),
      'sla-state': 'running',
      outcome: 'applied',
    });
    expect(row.slaState).toBe('running');
    expect(await eventsOf(caseId)).toEqual(['case.updated']);

    const cleared = await run('clear_case_sla', { 'case-id': caseId });
    expect(cleared.output).toEqual({ 'case-id': caseId, outcome: 'applied' });
    expect((await caseRow(caseId)).slaState).toBe('none');
    expect((await run('clear_case_sla', { 'case-id': caseId })).output?.outcome).toBe('no_change');
  });

  it('refuses a deadline out of range', async () => {
    const { caseId } = await caseOn(harness);
    expect(
      (await run('set_case_sla', { 'case-id': caseId, sla: { value: 91, unit: 'days' } }))
        .errorCode,
    ).toBe('sla_out_of_range');
    expect((await caseRow(caseId)).slaState).toBe('none');
  });

  it('sets a paused SLA in a pausing status, with no deadline yet (Workflow 8C review K8-26)', async () => {
    const { caseId } = await caseOn(harness);
    await harness.db.execute(
      sql`update cases set status = 'pending', status_category = 'intermediate' where id = ${caseId}`,
    );
    const ran = await run('set_case_sla', { 'case-id': caseId, sla: { value: 1, unit: 'hours' } });
    expect(ran.errorCode).toBeNull();
    expect(ran.output).toEqual({
      'case-id': caseId,
      'sla-expires-at': null,
      'sla-state': 'paused',
      outcome: 'applied',
    });
    expect((await caseRow(caseId)).slaState).toBe('paused');
  });
});

describe('every case step (C140.3)', () => {
  it('refuses a case this environment does not hold, and one that was redacted', async () => {
    const { caseId } = await caseOn(harness);
    await harness.db.execute(
      sql`update cases set redacted_at = now(), fields = null, tags = '{}' where id = ${caseId}`,
    );
    for (const [key, config] of [
      ['add_case_comment', { message: 'x' }],
      ['clear_case_sla', {}],
      ['update_case_status', { status: 'approved' }],
    ] as const) {
      expect((await run(key, { 'case-id': caseId, ...config })).errorCode, key).toBe(
        'subject_redacted',
      );
      expect(
        (await run(key, { 'case-id': testId('case'), ...config })).errorCode,
        `${key} on a missing case`,
      ).toBe('object_not_found');
    }
  });

  it('is exactly once: a lost claim rolls the change back, and a repeated job writes nothing', async () => {
    const agent = await personOf(harness);
    const queueId = await queueOf(harness);
    const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
    const onCase = (config: Record<string, unknown>) => async () => {
      const { caseId, templateId } = await caseOn(harness);
      return { config: { 'case-id': caseId, ...config }, templateId, caseId };
    };
    const cases: Record<
      string,
      () => Promise<{ config: Record<string, unknown>; templateId: string; caseId: string | null }>
    > = {
      create_case: async () => {
        const { templateId } = await caseOn(harness);
        return { config: { 'case-template-id': templateId }, templateId, caseId: null };
      },
      assign_case: onCase({ 'user-id': agent }),
      update_case_status: onCase({ status: 'approved' }),
      add_case_comment: onCase({ message: 'A synthetic note' }),
      add_case_to_queue: onCase({ 'case-queue-id': queueId }),
      attach_objects_to_case: onCase({ 'object-ids': [inquiry.id] }),
      set_case_sla: onCase({ sla: { value: 1, unit: 'hours' } }),
      clear_case_sla: async () => {
        const prepared = await onCase({})();
        await run('set_case_sla', { ...prepared.config, sla: { value: 1, unit: 'hours' } });
        return prepared;
      },
    };
    const handlers = handlersOf(harness);
    for (const [key, prepare] of Object.entries(cases)) {
      const { config, templateId, caseId } = await prepare();
      const real = handlers.get(key, 1);
      if (real?.shape !== 'transaction') {
        throw new Error(`${key} is not a transaction handler`);
      }
      const losing: ActionHandler = {
        ...real,
        execute: async (tx, context) => {
          const result = await real.execute(tx, context);
          await tx.execute(
            sql`update workflow_run_steps set status = 'ready', claimed_by = null,
              claimed_until = null where id = ${context.stepId}`,
          );
          return result;
        },
      };
      const swap = (table: ActionHandlerTable) => {
        useHandlers(harness, table);
      };
      const changes = async () =>
        caseId === null
          ? (await casesOn(templateId)).length
          : (await historyOf(caseId)).length + (await eventsOf(caseId)).length;
      const before = await changes();
      swap({ get: (k, v) => (k === key ? losing : handlers.get(k, v)) });
      const runId = await start(harness, one(key, config), { grant: CASE_GRANT });
      const job = harness.steps.jobs.shift()?.job;
      if (job === undefined) {
        throw new Error('no step job');
      }
      await processWorkflowStep(job, harness.deps);
      swap(handlers);

      expect(await changes(), `${key}: the lost attempt left nothing`).toBe(before);
      expect(await effectsOf(harness, runId), key).toEqual([]);

      const step = await stepOf(harness, runId, 'step');
      await harness.database.client.query(
        `update workflow_run_steps set status = 'ready', claimed_by = null, claimed_until = null,
           due_at = now() where id = $1`,
        [step.id],
      );
      await processWorkflowStep({ ...job, stepId: step.id }, harness.deps);
      expect((await runOf(harness, runId)).status, key).toBe('completed');
      const once = await changes();
      expect(once, `${key}: the next attempt wrote it`).toBeGreaterThan(before);
      await processWorkflowStep({ ...job, stepId: step.id }, harness.deps);
      expect(await changes(), `${key}: a repeated job wrote nothing`).toBe(once);
      expect(
        (await effectsOf(harness, runId)).map(({ status }) => status),
        key,
      ).toEqual(['done']);
    }
  });
});
