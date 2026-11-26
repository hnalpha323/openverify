/**
 * C119.2, C119.3, C119.9 (`api-engine`): waits on a real schema, one connection at a time: what each
 * interleaving must do is proved here, and two transactions really racing is
 * `wait-races.integration.test.ts`. Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createEvent,
  getWaitCandidate,
  openWorkflowStepValues,
  recordWorkflowWaitIndex,
  type Db,
} from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { processWorkflowStep } from '../../jobs/workflows/step.js';
import { processWorkflowWaitMatch } from '../../jobs/workflows/wait-match.js';
import { runWorkflowStepSweep, runWorkflowWaitMatchSweep } from '../../jobs/workflows/sweeps.js';
import type { ActionHandler } from './action-port.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  journalOf,
  output,
  outputsOf,
  publish,
  runOf,
  start,
  startOf,
  stepOf,
  type EngineHarness,
} from './testing.js';
import { recordWaitCandidatesInTx, subjectIdsOfPayload } from './wait-resolution.js';

const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const OTHER = 'inq_01M5CK16P0D13FXHZSS4TCFBVM';

const REPORT = 'rep_01M5CK16P0D13FXHZSS4TCFBVH';

const report: ActionHandler = {
  key: 'run_report',
  version: 1,
  shape: 'transaction',
  execute: () =>
    Promise.resolve({
      kind: 'waiting',
      correlationKey: REPORT,
      events: ['report/watchlist.ready', 'report/watchlist.errored'],
      timeoutSeconds: 60,
      timeoutCode: 'report_timed_out',
      carry: { 'report-id': REPORT },
    }),
  resume: (_tx, _context, resolution) =>
    Promise.resolve(
      resolution.eventName.endsWith('.errored')
        ? { kind: 'failed', code: 'report_errored' }
        : {
            kind: 'succeeded',
            output: {
              'report-id': resolution.carry['report-id'] as string,
              'report-type': 'watchlist',
              'review-model': 'matches',
              status: 'ready',
              'has-match': false,
              'match-count': 0,
              coverage: null,
              'unavailable-fields': [],
              errors: [],
              matches: [],
              flagged: null,
            },
          },
    ),
};

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
  harness = await createEngineHarness([report, tag]);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

interface EventOptions {
  name?: string;
  id?: string;
  subject?: string;
  attributes?: Record<string, unknown>;
  cause?: Parameters<typeof createEvent>[2]['cause'];
}

/** An event committed now, with its candidate, as `stage()` writes them. */
async function commitEvent(tx: Db, options: EventOptions = {}): Promise<string> {
  const id = options.id ?? testId('evt');
  const name = options.name ?? 'inquiry.approved';
  const payload = {
    data: {
      type: 'inquiry',
      id: options.subject ?? SUBJECT,
      attributes: options.attributes ?? { status: 'approved' },
    },
  };
  await createEvent(tx, harness.environmentId, {
    id,
    name,
    payload: payload,
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
  await recordWaitCandidatesInTx(tx, {
    environmentId: harness.environmentId,
    eventId: id,
    name,
    payload,
    cause: undefined,
  });
  return id;
}

const match = (eventId: string) =>
  processWorkflowWaitMatch({ environmentId: harness.environmentId, eventId }, harness.deps);

const waitStep = (more: Record<string, unknown> = {}) => ({
  id: 'hold',
  type: 'wait',
  name: 'Hold',
  mode: 'events',
  subject: 'trigger.id',
  events: ['inquiry.approved', 'inquiry.declined'],
  'timeout-seconds': 3_600,
  'on-timeout': 'continue',
  ...more,
});

async function waiting(more: Record<string, unknown> = {}) {
  const definition = chain([
    waitStep(more),
    action('after_wait', 'tag_object', { 'object-type': 'inquiry', tag: 'x' }),
  ]);
  const published = await publish(harness, definition);
  await recordWorkflowWaitIndex(harness.db, harness.environmentId, published.workflowVersionId, [
    'inquiry.approved',
    'inquiry.declined',
  ]);
  return startOf(harness, published, { trigger: { id: SUBJECT, status: 'completed' } });
}

const pastTimeout = (id: string) =>
  harness.database.client.query(
    `update workflow_run_steps set timeout_at = now() - interval '1 second'
       where run_id = $1 and status = 'waiting'`,
    [id],
  );

describe('candidates (C119.3)', () => {
  it('names an event’s resource and what it relates to one to one', () => {
    expect(
      subjectIdsOfPayload({
        data: {
          id: 'rep_1',
          relationships: {
            inquiry: { data: { type: 'inquiry', id: 'inq_1' } },
            none: { data: null },
            many: { data: [{ type: 'x', id: 'x_1' }] },
          },
        },
      }),
    ).toEqual(['rep_1', 'inq_1']);
    expect(subjectIdsOfPayload({})).toEqual([]);
    expect(subjectIdsOfPayload(null)).toEqual([]);
  });

  it('writes a candidate only for a name a version waits on', async () => {
    const unwatched = await commitEvent(harness.db, { name: 'inquiry.never-waited-on' });

    expect(await getWaitCandidate(harness.db, harness.environmentId, unwatched)).toBeNull();
  });
});

describe('a wait for events', () => {
  it('stays waiting until its event, then records who resolved it', async () => {
    const id = await waiting();
    expect((await runOf(harness, id)).waitingOn).toBe('event');
    expect((await stepOf(harness, id, 'hold')).status).toBe('waiting');
    const user = 'usr_01M5CK16P0D13FXHZSS4TCFBVH';

    const eventId = await commitEvent(harness.db, {
      cause: { principal: user, principalHeldInquiriesWrite: true },
    });
    await match(eventId);
    await drain(harness);

    const hold = await stepOf(harness, id, 'hold');
    expect(hold.status).toBe('succeeded');
    expect(hold.resolvedByEventId).toBe(eventId);
    expect(openWorkflowStepValues(hold).output).toEqual({
      'resolved-by': 'event',
      'event-id': eventId,
      'event-name': 'inquiry.approved',
      'resolver-type': 'user',
      'resolver-id': user,
      'resolved-via': 'single',
      'resolver-held-inquiries-write': true,
    });
    expect((await runOf(harness, id)).status).toBe('completed');
    expect(
      (await getWaitCandidate(harness.db, harness.environmentId, eventId))?.processedAt,
    ).not.toBeNull();
  });

  it('says a bulk resolution is one, so it never counts as a person (C128.2)', async () => {
    const id = await waiting();
    const eventId = await commitEvent(harness.db, {
      cause: {
        principal: 'usr_01M5CK16P0D13FXHZSS4TCFBVH',
        bulkId: 'cblk_01M5CK16P0D13FXHZSS4TCFBVH',
        principalHeldInquiriesWrite: true,
      },
    });
    await match(eventId);
    await drain(harness);

    expect(openWorkflowStepValues(await stepOf(harness, id, 'hold')).output).toEqual(
      expect.objectContaining({ 'resolved-via': 'bulk' }),
    );
  });

  it('never takes an event committed before the wait began', async () => {
    const before = await commitEvent(harness.db);
    const id = await waiting();

    await match(before);
    await drain(harness);

    expect((await stepOf(harness, id, 'hold')).status).toBe('waiting');
    expect(
      (await getWaitCandidate(harness.db, harness.environmentId, before))?.processedAt,
    ).not.toBeNull();
  });

  it('never takes an event its own transaction staged', async () => {
    const stagingTag: ActionHandler = {
      key: 'tag_object',
      version: 1,
      shape: 'transaction',
      execute: async (tx) => {
        const stagedId = testId('evt');
        staged.push(stagedId);
        await commitEventIn(local, tx, stagedId);
        return {
          kind: 'succeeded',
          output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 1 },
        };
      },
    };
    const staged: string[] = [];
    const local = await createEngineHarness([stagingTag]);
    try {
      const definition = chain([
        action('emit', 'tag_object', { 'object-type': 'inquiry', tag: 'x' }),
        waitStep(),
      ]);
      const published = await publish(local, definition);
      await recordWorkflowWaitIndex(local.db, local.environmentId, published.workflowVersionId, [
        'inquiry.approved',
      ]);
      const id = await startOf(local, published, { trigger: { id: SUBJECT } });
      await drain(local);

      await processWorkflowWaitMatch(
        { environmentId: local.environmentId, eventId: staged[0] ?? '' },
        local.deps,
      );
      await drain(local);

      expect((await stepOf(local, id, 'hold')).status).toBe('waiting');
    } finally {
      await local.close();
    }
  });

  it('leaves another subject’s wait alone', async () => {
    const id = await waiting();

    await match(await commitEvent(harness.db, { subject: OTHER }));
    await drain(harness);

    expect((await stepOf(harness, id, 'hold')).status).toBe('waiting');
  });

  it('a later event finds a wait that already resolved, and changes nothing', async () => {
    const id = await waiting();
    const first = await commitEvent(harness.db);
    await match(first);
    await match(await commitEvent(harness.db));
    await drain(harness);

    expect((await stepOf(harness, id, 'hold')).resolvedByEventId).toBe(first);
  });
});

describe('a wait’s filter', () => {
  const filter = { filter: { '===': [{ var: 'event.status' }, 'approved'] } };

  it('keeps waiting past an event that does not match, and takes the next that does', async () => {
    const id = await waiting(filter);

    await match(await commitEvent(harness.db, { attributes: { status: 'declined' } }));
    await drain(harness);
    expect((await stepOf(harness, id, 'hold')).status).toBe('waiting');
    expect(await journalOf(harness, id)).toContain('wait_restored:hold');

    const eventId = await commitEvent(harness.db);
    await match(eventId);
    await drain(harness);

    expect((await stepOf(harness, id, 'hold')).resolvedByEventId).toBe(eventId);
  });

  it('errors a filter whose input is null when on-null says so (C114.6)', async () => {
    const id = await waiting({ ...filter, 'on-null': 'error' });

    await match(await commitEvent(harness.db, { attributes: { status: null } }));
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('condition_input_null');
  });

  it('accepts or keeps waiting as on-null says', async () => {
    const accepting = await waiting({ ...filter, 'on-null': 'accept' });
    const keeping = await waiting({ ...filter, 'on-null': 'keep-waiting' });

    await match(await commitEvent(harness.db, { attributes: { status: null } }));
    await drain(harness);

    expect((await stepOf(harness, accepting, 'hold')).status).toBe('succeeded');
    expect((await stepOf(harness, keeping, 'hold')).status).toBe('waiting');
  });
});

describe('a wait’s timeout', () => {
  it('continues, and its output says it timed out', async () => {
    const id = await waiting();
    await pastTimeout(id);

    await runWorkflowStepSweep(harness.deps);
    await drain(harness);

    const hold = await stepOf(harness, id, 'hold');
    expect(hold.status).toBe('timed_out');
    expect(openWorkflowStepValues(hold).output).toEqual(
      expect.objectContaining({ 'resolved-by': 'timeout', 'event-id': null }),
    );
    expect((await stepOf(harness, id, 'after_wait')).status).toBe('succeeded');
    const run = await runOf(harness, id);
    expect(run.status).toBe('completed');
    expect(run.stepOutcomes['timed-out']).toBe(1);
  });

  it('errors with wait_timed_out when the step says so', async () => {
    const id = await waiting({ 'on-timeout': 'error' });
    await pastTimeout(id);

    await runWorkflowStepSweep(harness.deps);

    const run = await runOf(harness, id);
    expect(run.status).toBe('errored');
    expect(run.errorCode).toBe('wait_timed_out');
    expect(run.errorType).toBe('resource-error');
  });

  it('loses to an event that got there first', async () => {
    const id = await waiting();
    await match(await commitEvent(harness.db));
    await pastTimeout(id);

    await runWorkflowStepSweep(harness.deps);
    await drain(harness);

    expect((await stepOf(harness, id, 'hold')).status).toBe('succeeded');
  });
});

describe('a wait for time (C119.2)', () => {
  const timed = chain([
    { id: 'pause', type: 'wait', name: 'Pause', mode: 'time', seconds: 600 },
    action('after_pause', 'tag_object', { 'object-type': 'inquiry', tag: 'x' }),
  ]);

  it('takes its due time from the database, and a job cannot end it early', async () => {
    const id = await start(harness, timed);
    const pause = await stepOf(harness, id, 'pause');
    expect(pause.status).toBe('waiting');
    expect((await runOf(harness, id)).waitingOn).toBe('time');

    const [wake] = harness.steps.jobs.splice(0);
    expect(wake?.options.delayMs).toBe(600_000);
    if (wake !== undefined) {
      harness.steps.jobs.push(wake);
    }
    await drain(harness);

    expect((await stepOf(harness, id, 'pause')).status).toBe('waiting');
  });

  it('runs on when it is due, through the sweep if the job was lost', async () => {
    const id = await start(harness, timed);
    harness.steps.jobs.splice(0);
    await harness.database.client.query(
      `update workflow_run_steps set due_at = now() - interval '1 second' where run_id = $1`,
      [id],
    );

    await runWorkflowStepSweep(harness.deps);
    await drain(harness);

    expect((await stepOf(harness, id, 'pause')).status).toBe('succeeded');
    expect((await runOf(harness, id)).status).toBe('completed');
  });

  it('leaves a timer past the hour to the sweep', async () => {
    const id = await start(
      harness,
      chain([{ id: 'pause', type: 'wait', name: 'Pause', mode: 'time', seconds: 7_200 }]),
    );

    expect(harness.steps.jobs.filter(({ job }) => job.runId === id)).toEqual([]);
    await runWorkflowStepSweep(harness.deps);
    expect(harness.steps.jobs.filter(({ job }) => job.runId === id)).toEqual([]);
  });
});

describe('an outside action whose object finished before it waited (K8-6)', () => {
  it('resolves its wait at once from the event committed after the snapshot', async () => {
    const QUERY = 'gq_01M5CK16P0D13FXHZSS4TCFBVH';
    const COMPLETED = 'graph-query.completed';
    const local = await createEngineHarness([
      {
        key: 'run_graph_query',
        version: 1,
        shape: 'outside',
        async execute() {
          // The query ends between the engine's snapshot and the wait this answers.
          await local.db.transaction((tx) =>
            commitEventIn(local, tx, testId('evt'), { name: COMPLETED, subject: QUERY }),
          );
          return {
            kind: 'waiting',
            correlationKey: QUERY,
            events: [COMPLETED],
            timeoutSeconds: 60,
            timeoutCode: 'graph_query_timed_out',
            carry: {},
          };
        },
      },
    ]);
    try {
      const published = await publish(
        local,
        chain([action('query', 'run_graph_query', { 'template-id': 'x', mode: 'synchronous' })]),
      );
      await recordWorkflowWaitIndex(local.db, local.environmentId, published.workflowVersionId, [
        COMPLETED,
      ]);
      const id = await startOf(local, published, {
        grant: { scopes: ['graph:write', 'graph:read'], pii: true },
      });
      // Only the claim: a drain would claim the resolved step again, and this handler has no resume.
      const first = local.steps.jobs.shift();
      if (first !== undefined) {
        await processWorkflowStep(first.job, local.deps);
      }

      const query = await stepOf(local, id, 'query');
      expect(query.status, query.errorCode ?? '').toBe('ready');
      expect(query.resolvedByEventId).toMatch(/^evt_/);
    } finally {
      await local.close();
    }
  });
});

describe('an action that waits (C127.2)', () => {
  const definition = chain([action('screen', 'run_report', { 'template-id': 'x' })]);

  it('resumes on its object’s event with what it carried', async () => {
    const id = await start(harness, definition);
    await drain(harness);
    expect((await stepOf(harness, id, 'screen')).status).toBe('waiting');
    const eventId = await commitEvent(harness.db, {
      name: 'report/watchlist.ready',
      subject: REPORT,
    });

    await match(eventId);
    await drain(harness);

    const step = await stepOf(harness, id, 'screen');
    expect(step.status).toBe('succeeded');
    expect(openWorkflowStepValues(step).output).toEqual(
      expect.objectContaining({ 'report-id': REPORT, 'has-match': false }),
    );
  });

  it('fails with the action’s own code on a terminal event, never no match', async () => {
    const id = await start(harness, definition);
    await drain(harness);

    await match(
      await commitEvent(harness.db, { name: 'report/watchlist.errored', subject: REPORT }),
    );
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('report_errored');
  });

  it('fails with its own timeout code, which on-timeout never softens', async () => {
    const id = await start(harness, definition);
    await drain(harness);
    await pastTimeout(id);

    await runWorkflowStepSweep(harness.deps);

    const run = await runOf(harness, id);
    expect(run.errorCode).toBe('report_timed_out');
    expect(run.errorType).toBe('resource-error');
  });
});

describe('the wait-match sweep', () => {
  it('is the outbox for a candidate whose job was lost', async () => {
    const id = await waiting();
    const eventId = await commitEvent(harness.db);
    harness.waitMatches.jobs.splice(0);

    await runWorkflowWaitMatchSweep(harness.deps);

    expect(harness.waitMatches.jobs).toContainEqual({
      environmentId: harness.environmentId,
      eventId,
    });
    await match(eventId);
    await drain(harness);
    expect((await stepOf(harness, id, 'hold')).status).toBe('succeeded');
  });
});

describe('Run Workflow (C119.9, C121.3)', () => {
  const child = chain([action('inner', 'tag_object', { 'object-type': 'inquiry', tag: 'x' })], {
    steps: [
      action('inner', 'tag_object', { 'object-type': 'inquiry', tag: 'x' }),
      output({ done: 'yes' }),
    ],
    outputs: [{ name: 'done', pii: false }],
  });

  const publishedChild = async (grant = { scopes: ['inquiries:write'], pii: false }) => {
    const published = await publish(harness, child);
    await harness.database.client.query(
      `update workflow_versions set "grant" = $2::jsonb where id = $1`,
      [published.workflowVersionId, JSON.stringify(grant)],
    );
    return published;
  };

  const runStep = (workflowId: string, more: Record<string, unknown> = {}) =>
    action('start_child', 'run_workflow', {
      'workflow-id': workflowId,
      version: 'latest-published',
      ...more,
    });

  it('starts a child with the parent as its creator, one level down', async () => {
    const { workflowId } = await publishedChild();
    const id = await start(harness, chain([runStep(workflowId)]));
    await drain(harness);

    const step = await stepOf(harness, id, 'start_child');
    expect(step.status).toBe('succeeded');
    const childId = openWorkflowStepValues(step).output?.['workflow-run-id'] as string;
    const started = await runOf(harness, childId);
    expect(started.parentRunId).toBe(id);
    expect(started.rootRunId).toBe(id);
    expect(started.depth).toBe(1);
    expect(started.creatorType).toBe('workflow-run');
    expect(started.creatorId).toBe(id);
    expect(started.status).toBe('completed');
  });

  it('waits for the child when asked, and reads its outputs', async () => {
    const { workflowId } = await publishedChild();
    const id = await start(harness, chain([runStep(workflowId, { 'wait-for-completion': true })]));
    const parentJobs = harness.steps.jobs.splice(0);
    harness.steps.jobs.push(...parentJobs);
    await drain(harness);

    expect((await runOf(harness, id)).waitingOn).toBe('child-run');
    for (const job of harness.waitMatches.jobs.splice(0)) {
      await processWorkflowWaitMatch(job, harness.deps);
    }
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    expect(openWorkflowStepValues(await stepOf(harness, id, 'start_child')).output).toEqual(
      expect.objectContaining({ status: 'completed', outputs: { done: 'yes' } }),
    );
  });

  it('refuses a child whose grant the parent does not hold, naming no value', async () => {
    const { workflowId } = await publishedChild({ scopes: ['accounts:write'], pii: false });
    const id = await start(harness, chain([runStep(workflowId)]), {
      grant: { scopes: ['inquiries:write', 'workflows:trigger'], pii: false },
    });
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('run_grant_insufficient');
  });

  it('refuses past the depth limit', async () => {
    const { workflowId } = await publishedChild();
    const id = await start(harness, chain([runStep(workflowId)]), { depth: 5 });
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('run_depth_exceeded');
  });

  it('refuses a workflow already in its lineage', async () => {
    const self = 'wfl_01M5CK16P0D13FXHZSS4TCFBVX';
    const published = await publish(harness, chain([runStep(self)]), { id: self });
    const id = await startOf(harness, published);
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('run_depth_exceeded');
    expect((await stepOf(harness, id, 'start_child')).status).toBe('failed');
  });

  it('refuses a paused target', async () => {
    const paused = await publish(harness, child, { status: 'paused' });
    const id = await start(harness, chain([runStep(paused.workflowId)]));
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('workflow_not_running');
  });

  it('makes one child for one step, whatever the attempts', async () => {
    const { workflowId } = await publishedChild();
    const id = await start(harness, chain([runStep(workflowId)]));
    await drain(harness);

    const rows = await harness.database.client.query(
      'select id from workflow_runs where parent_run_id = $1',
      [id],
    );
    expect(rows.rows.length).toBe(1);
    expect(await outputsOf(harness, id)).toEqual({});
  });
});

/** The same as {@link commitEvent}, for another harness inside its transaction. */
async function commitEventIn(
  on: EngineHarness,
  tx: Db,
  id: string,
  options: { name?: string; subject?: string } = {},
): Promise<void> {
  const payload = { data: { type: 'inquiry', id: options.subject ?? SUBJECT, attributes: {} } };
  await createEvent(tx, on.environmentId, {
    id,
    name: options.name ?? 'inquiry.approved',
    payload: payload,
  });
  await recordWaitCandidatesInTx(tx, {
    environmentId: on.environmentId,
    eventId: id,
    name: options.name ?? 'inquiry.approved',
    payload,
    cause: undefined,
  });
}
