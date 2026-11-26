/**
 * C117.4, C120.7, C121.3, C121.5 (`api-engine`): what a step may do, and what its events say. The
 * executor sets the event's cause for a run and a test run, an adverse step needs its causing
 * principal to hold its scope, a revoked publisher stops egress and adverse steps, and a heartbeat
 * keeps a claim until it is lost. Every value is synthetic.
 */
import type { Permission } from '@openverify/core';
import { createApiKey, generateApiKey, openWorkflowStepValues } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processWorkflowStep } from '../../jobs/workflows/step.js';
import { currentEventCause } from '../../events/cause-context.js';
import type { ActionHandler } from './action-port.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  publish,
  runOf,
  start,
  startOf,
  stepOf,
  type EngineHarness,
} from './testing.js';

const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';

let cause: unknown;
let refused = 0;

const output = { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 1 };

const tag: ActionHandler = {
  key: 'tag_object',
  version: 1,
  shape: 'transaction',
  execute() {
    cause = currentEventCause();
    return Promise.resolve({ kind: 'succeeded', output, console: ['a line'] });
  },
};

const decline: ActionHandler = {
  key: 'decline_inquiry',
  version: 1,
  shape: 'transaction',
  execute: () =>
    Promise.resolve({
      kind: 'succeeded',
      output: {
        'inquiry-id': SUBJECT,
        status: 'declined',
        outcome: 'no_change',
        'decision-id': null,
        'solely-automated': null,
      },
    }),
  onCauseRefused() {
    refused += 1;
    return Promise.resolve({});
  },
};

let signalled: AbortSignal | null = null;
let finish: () => void = () => undefined;
const finished = () =>
  new Promise<void>((resolve) => {
    finish = resolve;
  });

const slow: ActionHandler = {
  key: 'sync_graph',
  version: 1,
  shape: 'outside',
  leaseSeconds: () => 300,
  async execute(context) {
    signalled = context.signal;
    await finished();
    return { kind: 'succeeded', output: { synced: true, mode: 'all' } };
  },
};

let harness: EngineHarness;

beforeAll(async () => {
  harness = await createEngineHarness([tag, decline, slow]);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const tagStep = action('t', 'tag_object', { 'object-type': 'inquiry', tag: 'x' });
const declineStep = action('no', 'decline_inquiry', { 'inquiry-id': SUBJECT });

describe('the event cause (C121.3)', () => {
  it('names the run and the root’s principal around a step', async () => {
    const principal = 'usr_01M5CK16P0D13FXHZSS4TCFBVH';
    const id = await start(harness, chain([tagStep]), { causedByPrincipal: principal });
    await drain(harness);

    expect(cause).toEqual(
      expect.objectContaining({ runId: id, principal, testRunId: null, bulkId: null }),
    );
  });

  it('marks a test run’s events with its id, and carries the request’s opt-in', async () => {
    const id = await start(harness, chain([tagStep]), {
      test: {
        overrides: {},
        allowHosts: [],
        acknowledgements: [],
        allowTriggers: true,
        endStep: null,
        egressAllowed: false,
      },
    });
    await drain(harness);

    expect(cause).toEqual(
      expect.objectContaining({ runId: id, testRunId: id, testRunAllowsTriggers: true }),
    );
  });
});

describe('the causing principal (C121.3)', () => {
  it('refuses an adverse step whose cause lacks its scope, and offers the handler the refusal', async () => {
    const id = await start(harness, chain([declineStep]), {
      causedByPrincipal: await keyWith(['inquiries:read']),
    });
    await drain(harness);

    const run = await runOf(harness, id);
    expect(run.errorCode).toBe('cause_lacks_scope');
    expect(run.errorType).toBe('configuration-error');
    expect(refused).toBe(1);
  });

  it('lets a cause through that holds it', async () => {
    const id = await start(harness, chain([declineStep]), {
      causedByPrincipal: await keyWith(['inquiries:write']),
    });
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
  });

  it('exempts an event with no principal', async () => {
    const id = await start(harness, chain([declineStep]));
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
  });

  it('counts a principal that is gone as holding nothing', async () => {
    const id = await start(harness, chain([declineStep]), {
      causedByPrincipal: `usr_${'0'.repeat(26)}`,
    });
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('cause_lacks_scope');
  });
});

describe('a revoked publisher (C121.5)', () => {
  it('stops an adverse step and leaves a plain one running', async () => {
    const adverse = await publish(harness, chain([declineStep]));
    const plain = await publish(harness, chain([tagStep]));
    await harness.database.client.query(
      `update workflows set status = 'paused', paused_reason = 'publisher_revoked'
         where id = any($1)`,
      [[adverse.workflowId, plain.workflowId]],
    );

    const stopped = await startOf(harness, adverse);
    const running = await startOf(harness, plain);
    await drain(harness);

    expect((await runOf(harness, stopped)).errorCode).toBe('publisher_revoked');
    expect((await runOf(harness, running)).status).toBe('completed');
  });
});

describe('a test run’s console (C120.7, C123.4)', () => {
  it('is sealed on the step of a test run, and dropped on any other', async () => {
    const ordinary = await start(harness, chain([tagStep]));
    await drain(harness);
    const tested = await start(harness, chain([tagStep]), {
      test: {
        overrides: {},
        allowHosts: [],
        acknowledgements: [],
        allowTriggers: false,
        endStep: null,
        egressAllowed: false,
      },
    });
    await drain(harness);

    expect(openWorkflowStepValues(await stepOf(harness, ordinary, 't')).console).toBeNull();
    expect(openWorkflowStepValues(await stepOf(harness, tested, 't')).console).toEqual(['a line']);
  });
});

describe('the heartbeat (C117.4)', () => {
  const syncStep = action('sync', 'sync_graph', { 'account-id': 'acc_1', mode: 'all' });

  const local = async () => {
    harness.deps.heartbeatMs = 5;
    const id = await start(harness, chain([syncStep]), {
      grant: { scopes: ['graph:read'], pii: false },
    });
    const next = harness.steps.jobs.splice(0)[0];
    if (next === undefined) {
      throw new Error('no job');
    }
    return { id, running: processWorkflowStep(next.job, harness.deps) };
  };

  it('extends the lease to the action’s own while it runs', async () => {
    const { id, running } = await local();
    await expect.poll(() => signalled !== null).toBe(true);
    await expect
      .poll(async () => {
        const { claimedUntil } = await stepOf(harness, id, 'sync');
        return (claimedUntil?.getTime() ?? 0) - Date.now();
      })
      .toBeGreaterThan(200_000);

    finish();
    await running;
    harness.deps.heartbeatMs = undefined;

    expect((await runOf(harness, id)).status).toBe('completed');
    signalled = null;
  });

  it('aborts the handler when its claim is lost', async () => {
    const { id, running } = await local();
    await expect.poll(() => signalled !== null).toBe(true);
    await harness.database.client.query(
      `update workflow_run_steps set status = 'ready', claimed_by = null, claimed_until = null
         where run_id = $1`,
      [id],
    );

    await expect.poll(() => signalled?.aborted).toBe(true);
    finish();
    await running;
    harness.deps.heartbeatMs = undefined;
    harness.steps.jobs.splice(0);

    expect((await stepOf(harness, id, 'sync')).status).toBe('ready');
  });
});

async function keyWith(scopes: readonly Permission[]): Promise<string> {
  const generated = generateApiKey('sandbox', Buffer.alloc(32, 7));
  const key = await createApiKey(harness.db, harness.environmentId, {
    id: testId('key'),
    name: 'Test key',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
    scopes,
  });
  return key.id;
}
