/**
 * C119.3, C146.2 (`api-engine`) against Postgres 17: the interleavings a single connection cannot
 * show. An event that starts before a wait's registration and commits after its check; one that
 * commits between its snapshot and its check; an event against a timeout; two events at once;
 * concurrent join completions; a lapsed claim with a live worker; a cancel against a completion; and
 * a resume that never repeats a `done` effect. Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createEvent,
  createKeyring,
  enterWorkflowWait,
  getWorkflowRunStep,
  listUnseenWaitCandidates,
  lockWorkflowRun,
  recordWorkflowWaitIndex,
  resolveWorkflowWait,
  runMigrations,
  setDefaultKeyring,
  settleWorkflowRunStep,
  takeWorkflowCorrelationLock,
  type Database,
  type Db,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processWorkflowWaitMatch } from '../../jobs/workflows/wait-match.js';
import { processWorkflowStep } from '../../jobs/workflows/step.js';
import { cancelRun, resumeRun } from '../runs/control.js';
import type { ActionHandler } from './action-port.js';
import {
  action,
  chain,
  createEngineHarnessOnDatabase,
  definitionOf,
  drain,
  edge,
  output,
  publish,
  runOf,
  scripted,
  startOf,
  stepOf,
  stepsOf,
  type EngineHarness,
} from './testing.js';
import { recordWaitCandidatesInTx } from './wait-resolution.js';
import { engineDepsOf } from './worker-deps.js';

const keyring = createKeyring(randomBytes(32));
const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const EVENT = 'inquiry.approved';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let harness: EngineHarness;

interface Gate {
  open: () => void;
  opened: Promise<void>;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

let holdTag: Gate | null = null;
let reached: Gate | null = null;
const tagCalls: string[] = [];
const tag: ActionHandler = {
  key: 'tag_object',
  version: 1,
  shape: 'transaction',
  async execute(_tx, context) {
    tagCalls.push(context.nodeId);
    reached?.open();
    await holdTag?.opened;
    return {
      kind: 'succeeded',
      output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 1 },
    };
  },
};

/**
 * K8-6: an action that reads its object, finds it unfinished and waits for it, as `rerun_report` does
 * for the next pending report. The gates hold it between its read and the wait it answers.
 */
const REPORT = 'rep_01M5CK16P0D13FXHZSS4TCFBVH';
const REPORT_READY = 'report/watchlist.ready';
let holdReport: Gate | null = null;
let reportRead: Gate | null = null;
const report: ActionHandler = {
  key: 'run_report',
  version: 1,
  shape: 'transaction',
  async execute() {
    reportRead?.open();
    await holdReport?.opened;
    return {
      kind: 'waiting',
      correlationKey: REPORT,
      events: [REPORT_READY, 'report/watchlist.errored'],
      timeoutSeconds: 3_600,
      timeoutCode: 'report_timed_out',
      carry: { 'report-id': REPORT },
    };
  },
  resume: () =>
    Promise.resolve({
      kind: 'succeeded',
      output: {
        'report-id': REPORT,
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
    }),
};

let failCreate = false;
const create = scripted('create_inquiry', 'transaction', () =>
  failCreate
    ? { kind: 'failed', code: 'invalid_transition' }
    : {
        kind: 'succeeded',
        output: { 'inquiry-id': SUBJECT, status: 'created', 'account-id': null },
      },
);

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  harness = createEngineHarnessOnDatabase(db, tenant, [tag, create, report]);
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const waitStep = {
  id: 'hold',
  type: 'wait',
  name: 'Hold',
  mode: 'events',
  subject: 'trigger.id',
  events: [EVENT],
  'timeout-seconds': 3_600,
  'on-timeout': 'continue',
};

async function eventIn(tx: Db, id: string): Promise<void> {
  const payload = { data: { type: 'inquiry', id: SUBJECT, attributes: {} } };
  await createEvent(tx, harness.environmentId, { id, name: EVENT, payload });
  await recordWaitCandidatesInTx(tx, {
    environmentId: harness.environmentId,
    eventId: id,
    name: EVENT,
    payload,
    cause: undefined,
  });
}

async function publishedWait() {
  const published = await publish(harness, chain([waitStep]));
  await recordWorkflowWaitIndex(db, harness.environmentId, published.workflowVersionId, [EVENT]);
  return published;
}

const match = (eventId: string) =>
  processWorkflowWaitMatch({ environmentId: harness.environmentId, eventId }, harness.deps);

const startWaiting = async (published: Awaited<ReturnType<typeof publishedWait>>) =>
  startOf(harness, published, { trigger: { id: SUBJECT } });

describe('wait registration against an event (C119.3)', () => {
  it('resolves on an event that began before the registration and committed after its check', async () => {
    const published = await publishedWait();
    const staged = gate();
    const release = gate();
    const eventId = testId('evt');
    const event = db.transaction(async (tx) => {
      await eventIn(tx, eventId);
      staged.open();
      await release.opened;
    });
    await staged.opened;

    const id = await startWaiting(published);
    expect((await stepOf(harness, id, 'hold')).status).toBe('waiting');
    release.open();
    await event;

    await match(eventId);

    const hold = await stepOf(harness, id, 'hold');
    expect(hold.status).toBe('ready');
    expect(hold.resolvedByEventId).toBe(eventId);
  });

  it('resolves on an event that committed between the snapshot and the check, once', async () => {
    const published = await publishedWait();
    const id = await startWaiting(published);
    const hold = await stepOf(harness, id, 'hold');
    await pool.query(
      `update workflow_run_steps set status = 'pending', waiting_snapshot = null where id = $1`,
      [hold.id],
    );
    const eventId = testId('evt');

    await db.transaction(async (tx) => {
      await takeWorkflowCorrelationLock(tx, harness.environmentId, SUBJECT);
      await enterWorkflowWait(tx, harness.environmentId, {
        stepId: hold.id,
        eventNames: [EVENT],
        correlationKey: SUBJECT,
        timeoutAt: new Date(Date.now() + 3_600_000),
      });
      // Another connection, with no lock: `stage()` takes none.
      await db.transaction((other) => eventIn(other, eventId));
      const [seen] = await listUnseenWaitCandidates(tx, harness.environmentId, hold.id);
      expect(seen?.eventId).toBe(eventId);
      await resolveWorkflowWait(tx, harness.environmentId, hold.id, eventId);
    });
    await match(eventId);

    expect((await stepOf(harness, id, 'hold')).resolvedByEventId).toBe(eventId);
  });

  it('never resolves on an event committed before the registration', async () => {
    const published = await publishedWait();
    const eventId = testId('evt');
    await db.transaction((tx) => eventIn(tx, eventId));

    const id = await startWaiting(published);
    await match(eventId);

    expect((await stepOf(harness, id, 'hold')).status).toBe('waiting');
  });

  it('makes a job wait for a registration in flight, then finds its row', async () => {
    const published = await publishedWait();
    const id = await startWaiting(published);
    const hold = await stepOf(harness, id, 'hold');
    await pool.query(
      `update workflow_run_steps set status = 'pending', waiting_snapshot = null where id = $1`,
      [hold.id],
    );
    const eventId = testId('evt');
    const locked = gate();
    const release = gate();
    const registration = db.transaction(async (tx) => {
      await takeWorkflowCorrelationLock(tx, harness.environmentId, SUBJECT);
      await enterWorkflowWait(tx, harness.environmentId, {
        stepId: hold.id,
        eventNames: [EVENT],
        correlationKey: SUBJECT,
        timeoutAt: new Date(Date.now() + 3_600_000),
      });
      locked.open();
      await release.opened;
    });
    await locked.opened;
    await db.transaction((tx) => eventIn(tx, eventId));
    const job = match(eventId);
    release.open();
    await registration;
    await job;

    expect((await stepOf(harness, id, 'hold')).resolvedByEventId).toBe(eventId);
  });
});

describe('an action’s own wait (K8-6, C127.12)', () => {
  it('resolves on its object’s event committed between the action’s read and its wait', async () => {
    const published = await publish(
      harness,
      chain([action('screen', 'run_report', { 'template-id': 'x' })]),
    );
    await recordWorkflowWaitIndex(db, harness.environmentId, published.workflowVersionId, [
      REPORT_READY,
    ]);
    reportRead = gate();
    holdReport = gate();
    const id = await startOf(harness, published);
    const running = drain(harness);
    await reportRead.opened;

    // The report finishes after the action read it as unfinished, before the action waits.
    const eventId = testId('evt');
    await db.transaction(async (tx) => {
      const payload = { data: { type: 'report/watchlist', id: REPORT, attributes: {} } };
      await createEvent(tx, harness.environmentId, { id: eventId, name: REPORT_READY, payload });
      await recordWaitCandidatesInTx(tx, {
        environmentId: harness.environmentId,
        eventId,
        name: REPORT_READY,
        payload,
        cause: undefined,
      });
    });
    holdReport.open();
    await running;
    await match(eventId);
    await drain(harness);

    // Resolved by that event, so the step went on and the run finished; never a timeout.
    const screen = await stepOf(harness, id, 'screen');
    expect(screen.resolvedByEventId).toBe(eventId);
    expect(screen.status).toBe('succeeded');
    expect((await runOf(harness, id)).status).toBe('completed');
    holdReport = null;
    reportRead = null;
  });
});

describe('races on one row (C119.3)', () => {
  it('leaves one winner of an event against a timeout, every time', async () => {
    const published = await publishedWait();
    for (let round = 0; round < 10; round += 1) {
      const id = await startWaiting(published);
      const hold = await stepOf(harness, id, 'hold');
      const [resolved, timedOut] = await Promise.all([
        db.transaction((tx) =>
          resolveWorkflowWait(tx, harness.environmentId, hold.id, testId('evt')),
        ),
        db.transaction((tx) =>
          settleWorkflowRunStep(tx, harness.environmentId, {
            stepId: hold.id,
            status: 'timed_out',
            at: new Date(),
            from: ['waiting'],
          }),
        ),
      ]);
      expect([resolved, timedOut].filter((row) => row !== null).length).toBe(1);
    }
  });

  it('resolves one wait once when two events arrive at once', async () => {
    const published = await publishedWait();
    const id = await startWaiting(published);
    const first = testId('evt');
    const second = testId('evt');
    await Promise.all([
      db.transaction((tx) => eventIn(tx, first)),
      db.transaction((tx) => eventIn(tx, second)),
    ]);

    await Promise.all([match(first), match(second)]);

    const hold = await stepOf(harness, id, 'hold');
    expect(hold.status).toBe('ready');
    expect([first, second]).toContain(hold.resolvedByEventId);
  });
});

describe('joins (C119.4)', () => {
  it('runs what follows a join once, however the branches interleave', async () => {
    const step = (id: string) => action(id, 'tag_object', { 'object-type': 'inquiry', tag: id });
    const definition = definitionOf(
      [
        {
          id: 'fork',
          type: 'parallel',
          name: 'Fork',
          branches: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
        },
        step('one'),
        step('two'),
        step('three'),
        { id: 'meet', type: 'join', name: 'Meet', 'join-of': 'fork' },
        step('after_join'),
        output(),
      ],
      [
        edge('trigger', 'fork'),
        edge('fork', 'one', 'branch:a'),
        edge('fork', 'two', 'branch:b'),
        edge('fork', 'three', 'branch:c'),
        edge('one', 'meet'),
        edge('two', 'meet'),
        edge('three', 'meet'),
        edge('meet', 'after_join'),
        edge('after_join', 'output'),
      ],
    );
    const published = await publish(harness, definition);
    const before = tagCalls.filter((node) => node === 'after_join').length;
    const id = await startOf(harness, published);

    const jobs = harness.steps.jobs.splice(0);
    await Promise.all(jobs.map(({ job }) => processWorkflowStep(job, harness.deps)));
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    expect(tagCalls.filter((node) => node === 'after_join').length).toBe(before + 1);
    expect((await stepsOf(harness, id)).filter(({ nodeId }) => nodeId === 'meet').length).toBe(1);
  });
});

describe('fencing (C117.3, C120.5)', () => {
  const tagged = chain([action('slow', 'tag_object', { 'object-type': 'inquiry', tag: 'x' })]);

  it('rolls back a completion a sweeper’s reclaim overtook', async () => {
    const published = await publish(harness, tagged);
    const id = await startOf(harness, published);
    const job = harness.steps.jobs.splice(0)[0]?.job;
    holdTag = gate();
    reached = gate();
    const working = job === undefined ? Promise.resolve() : processWorkflowStep(job, harness.deps);
    await reached.opened;
    // A lapsed lease, reclaimed while the worker is alive.
    await pool.query(
      `update workflow_run_steps set status = 'ready', claimed_by = null, claimed_until = null
         where run_id = $1`,
      [id],
    );
    holdTag.open();
    await working;
    holdTag = null;
    reached = null;

    expect((await stepOf(harness, id, 'slow')).status).toBe('ready');
    expect((await runOf(harness, id)).status).toBe('in_progress');
    const effects = await pool.query('select id from workflow_step_effects where run_id = $1', [
      id,
    ]);
    expect(effects.rows).toEqual([]);
  });

  it('fences out a running step when a cancel gets there first', async () => {
    const published = await publish(harness, tagged);
    const id = await startOf(harness, published);
    const job = harness.steps.jobs.splice(0)[0]?.job;
    holdTag = gate();
    reached = gate();
    const working = job === undefined ? Promise.resolve() : processWorkflowStep(job, harness.deps);
    await reached.opened;

    await cancelRun(engineDepsOf(harness.deps), harness.environmentId, id, () => Promise.resolve());
    holdTag.open();
    await working;
    holdTag = null;
    reached = null;

    expect((await runOf(harness, id)).status).toBe('canceled');
    expect((await stepOf(harness, id, 'slow')).status).toBe('canceled');
    const effects = await pool.query('select id from workflow_step_effects where run_id = $1', [
      id,
    ]);
    expect(effects.rows).toEqual([]);
  });
});

describe('resume (C120.3)', () => {
  it('never repeats a done effect', async () => {
    const definition = chain([
      action('first', 'tag_object', { 'object-type': 'inquiry', tag: 'x' }),
      action('second', 'create_inquiry', { 'inquiry-template-id': 'x' }),
    ]);
    failCreate = true;
    const published = await publish(harness, definition);
    const id = await startOf(harness, published);
    await drain(harness);
    expect((await runOf(harness, id)).status).toBe('errored');
    failCreate = false;
    const before = tagCalls.filter((node) => node === 'first').length;

    await resumeRun(engineDepsOf(harness.deps), harness.environmentId, id, {
      skipUnknownEffects: false,
      audit: () => Promise.resolve(),
    });
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    expect(tagCalls.filter((node) => node === 'first').length).toBe(before);
    expect((await lockRun(id))?.status).toBe('completed');
    expect(
      (
        await getWorkflowRunStep(
          db,
          harness.environmentId,
          (await stepOf(harness, id, 'second')).id,
        )
      )?.attempt,
    ).toBe(2);
  });
});

const lockRun = (id: string) =>
  db.transaction((tx) => lockWorkflowRun(tx, harness.environmentId, id));
