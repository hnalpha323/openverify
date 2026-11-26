/**
 * C117, C119 (`api-engine`): the executor on a real schema. A step is claimed, fenced and completed;
 * control flow runs in the completing transaction; a failure follows its edge, its
 * `continue-on-error`, or ends the run; effects hold their delivery guarantee; limits hold with their
 * codes. Handlers are fakes and every value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { openWorkflowStepValues } from '@openverify/db';
import { processWorkflowStep } from '../../jobs/workflows/step.js';
import type { WorkflowStepJob } from '../../ports.js';
import { ActionStepError, type ActionHandler } from './action-port.js';
import {
  action,
  chain,
  createEngineHarness,
  definitionOf,
  drain,
  edge,
  effectsOf,
  eventNames,
  journalOf,
  output,
  outputsOf,
  publish,
  runOf,
  scripted,
  start,
  startOf,
  stepOf,
  stepsOf,
  type EngineHarness,
} from './testing.js';

const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';

const tag = scripted('tag_object', 'transaction', (_nodeId, call) => ({
  kind: 'succeeded',
  output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': call },
}));

let harness: EngineHarness;

const flaky = scripted('make_https_request', 'outside', (nodeId, call) =>
  nodeId === 'always_down' || call < 3
    ? { kind: 'failed', code: 'request_failed', retryable: true }
    : { kind: 'succeeded', output: { status: 200, headers: {}, body: null } },
);

let mailBehaviour: (nodeId: string) => unknown = () => ({
  kind: 'succeeded',
  output: { delivery: 'accepted', provider: 'x', sandbox: true, 'message-ref': null },
});
const mail = scripted('send_email', 'outside', (nodeId) => mailBehaviour(nodeId));

const failing = scripted('create_inquiry', 'transaction', () => {
  throw new ActionStepError('invalid_transition');
});

const throwing = scripted('find_or_create_account', 'transaction', () => {
  throw new Error('a host error, with a value in it');
});

const handlers: ActionHandler[] = [tag, flaky, mail, failing, throwing];

beforeAll(async () => {
  harness = await createEngineHarness(handlers);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

/** The next queued job, or the test's failure. */
function nextJob(from: EngineHarness): WorkflowStepJob {
  const next = from.steps.jobs.shift();
  if (next === undefined) {
    throw new Error('no job queued');
  }
  return next.job;
}

const tagStep = (id: string, more: Record<string, unknown> = {}) =>
  action(id, 'tag_object', { 'object-type': 'inquiry', tag: id }, more);

describe('what a step logs (C117.11)', () => {
  it('says how it ended and how long it took, in ids and codes', async () => {
    const lines: { fields: Record<string, unknown>; message: string }[] = [];
    const { logger } = harness.deps;
    harness.deps.logger = {
      ...logger,
      info: (fields: Record<string, unknown>, message: string) => {
        lines.push({ fields, message });
      },
    };
    onTestFinished(() => {
      harness.deps.logger = logger;
    });

    await start(harness, chain([tagStep('logged')]));
    await drain(harness);

    const finished = lines.find(({ message }) => message === 'workflow step finished');
    expect(finished?.fields).toMatchObject({
      nodeId: 'logged',
      actionKey: 'tag_object',
      status: 'succeeded',
      errorCode: null,
    });
    expect(finished?.fields.durationMs).toEqual(expect.any(Number));
  });
});

describe('a run', () => {
  it('runs its steps, records them, and completes with its outputs', async () => {
    const id = await start(
      harness,
      chain([tagStep('first'), tagStep('second')], {
        steps: [
          tagStep('first'),
          tagStep('second'),
          output({ name: '{{ steps.second.output.outcome }}' }),
        ],
        outputs: [{ name: 'name', pii: false }],
      }),
    );
    await drain(harness);

    const run = await runOf(harness, id);
    expect(run.status).toBe('completed');
    expect(run.stepOutcomes.succeeded).toBeGreaterThanOrEqual(2);
    expect(await outputsOf(harness, id)).toEqual({ name: 'applied' });
    const second = await stepOf(harness, id, 'second');
    expect(second.status).toBe('succeeded');
    expect(openWorkflowStepValues(second).output).toEqual(
      expect.objectContaining({ outcome: 'applied', 'object-id': SUBJECT }),
    );
    expect(openWorkflowStepValues(second).input).toEqual({
      'object-type': 'inquiry',
      tag: 'second',
    });
    expect(await journalOf(harness, id)).toEqual([
      'run_created',
      'step_ready:first',
      'step_started:first',
      'step_succeeded:first',
      'step_ready:second',
      'step_started:second',
      'step_succeeded:second',
      'step_succeeded:output',
      'run_completed',
    ]);
    expect(await eventNames(harness, id)).toEqual(
      expect.arrayContaining(['workflow-run.created', 'workflow-run.completed']),
    );
  });

  it('runs control flow in the transaction that completed the step before it (C117.3)', async () => {
    const definition = definitionOf(
      [
        tagStep('first'),
        {
          id: 'choose',
          type: 'conditional',
          name: 'Choose',
          routes: [{ key: 'tagged', label: 'Tagged', condition: { '===': [1, 1] } }],
        },
        action('count', 'calculate', { operator: 'add', operands: [1, 2] }),
        tagStep('other'),
        output(),
      ],
      [
        edge('trigger', 'first'),
        edge('first', 'choose'),
        edge('choose', 'count', 'route:tagged'),
        edge('choose', 'other', 'else'),
        edge('count', 'output'),
        edge('other', 'output'),
      ],
    );
    const id = await start(harness, definition);
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    const steps = await stepsOf(harness, id);
    expect(steps.map(({ nodeId }) => nodeId).sort()).toEqual([
      'choose',
      'count',
      'first',
      'output',
    ]);
    const choose = await stepOf(harness, id, 'choose');
    expect(choose.claims).toBe(0);
    expect(openWorkflowStepValues(choose).output).toEqual({ route: 'tagged' });
    expect(openWorkflowStepValues(await stepOf(harness, id, 'count')).output).toEqual({
      value: 3,
      defaulted: false,
      'default-reason': null,
    });
  });

  it('keeps variables across steps, sealed', async () => {
    const definition = chain(
      [action('set', 'update_variable', { name: 'risk', operator: 'set', value: 7 }), tagStep('t')],
      {
        variables: [{ name: 'risk', type: 'number', default: 0 }],
      },
    );
    const id = await start(harness, definition);
    await drain(harness);

    const raw = await harness.database.client.query<{ variables: string }>(
      'select variables from workflow_runs where id = $1',
      [id],
    );
    expect(raw.rows[0]?.variables).not.toContain('risk');
    expect((await runOf(harness, id)).status).toBe('completed');
  });

  it('counts each step against the run', async () => {
    const id = await start(harness, chain([tagStep('one')]));
    await drain(harness);

    expect((await runOf(harness, id)).stepExecutions).toBe(2);
  });
});

describe('failures (C119.7)', () => {
  it('ends the run errored with the step’s code and type', async () => {
    const id = await start(harness, chain([action('create', 'create_inquiry')]));
    await drain(harness);

    const run = await runOf(harness, id);
    expect(run.status).toBe('errored');
    expect(run.errorCode).toBe('invalid_transition');
    expect(run.errorType).toBe('resource-error');
    expect(run.errorNodeId).toBe('create');
    expect(await eventNames(harness, id)).toContain('workflow-run.errored');
    expect((await journalOf(harness, id)).slice(-2)).toEqual([
      'step_failed:create',
      'run_errored:create',
    ]);
  });

  it('follows an error edge instead', async () => {
    const definition = definitionOf(
      [action('create', 'create_inquiry'), tagStep('recover'), output()],
      [
        edge('trigger', 'create'),
        edge('create', 'recover', 'error'),
        edge('create', 'output'),
        edge('recover', 'output'),
      ],
    );
    const id = await start(harness, definition);
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    expect((await stepOf(harness, id, 'create')).status).toBe('failed');
    expect((await stepOf(harness, id, 'recover')).status).toBe('succeeded');
  });

  it('continues past a step that may, and says so in its outcomes (H32)', async () => {
    const id = await start(
      harness,
      chain([action('create', 'create_inquiry', {}, { 'continue-on-error': true }), tagStep('t')]),
    );
    await drain(harness);

    const run = await runOf(harness, id);
    expect(run.status).toBe('completed');
    expect(run.stepOutcomes['failed-continued']).toBe(1);
    expect(run.hasStepErrors).toBe(true);
  });

  it('reads a host error as execution_error, keeping its text out of every column', async () => {
    const id = await start(harness, chain([action('find', 'find_or_create_account')]));
    await drain(harness);

    const run = await runOf(harness, id);
    expect(run.errorCode).toBe('execution_error');
    expect(run.errorType).toBe('unknown-error');
    expect(JSON.stringify(await stepsOf(harness, id))).not.toContain('a value in it');
  });

  it('holds a step’s output to its schema and its cap (C115.5, C117.7)', async () => {
    const big = scripted('fetch_object', 'outside', () => ({
      kind: 'succeeded',
      output: {
        'object-type': 'inquiry',
        'object-id': SUBJECT,
        object: { blob: 'x'.repeat(70_000) },
      },
    }));
    const local = await createEngineHarness([big]);
    try {
      const id = await start(
        local,
        chain([action('f', 'fetch_object', { 'object-type': 'inquiry', 'object-id': SUBJECT })]),
        { grant: { scopes: ['inquiries:read'], pii: true } },
      );
      await drain(local);

      const run = await runOf(local, id);
      expect(run.status).toBe('errored');
      expect(run.errorCode).toBe('payload_too_large');
    } finally {
      await local.close();
    }
  });
});

describe('retries (C117.6)', () => {
  it('records a retry with a new due time, and succeeds on a later attempt', async () => {
    const id = await start(
      harness,
      chain([
        action(
          'call',
          'make_https_request',
          { url: 'https://example.com/x', method: 'GET' },
          {
            retry: { 'intervals-seconds': [1, 1] },
          },
        ),
      ]),
    );
    await drain(harness);

    let step = await stepOf(harness, id, 'call');
    expect(step.status).toBe('ready');
    expect(step.attempt).toBe(1);
    expect(step.dueAt).not.toBeNull();
    await harness.database.client.query(
      'update workflow_run_steps set due_at = now() where id = $1',
      [step.id],
    );
    harness.steps.jobs.push({
      job: { environmentId: harness.environmentId, runId: id, stepId: step.id, attempt: 1 },
      options: {},
    });
    await drain(harness);
    step = await stepOf(harness, id, 'call');
    await harness.database.client.query(
      'update workflow_run_steps set due_at = now() where id = $1',
      [step.id],
    );
    harness.steps.jobs.push({
      job: { environmentId: harness.environmentId, runId: id, stepId: step.id, attempt: 2 },
      options: {},
    });
    await drain(harness);

    expect(await runOf(harness, id)).toEqual(
      expect.objectContaining({ errorCode: null, status: 'completed' }),
    );
    expect((await stepOf(harness, id, 'call')).attempt).toBe(3);
    expect((await journalOf(harness, id)).filter((kind) => kind.startsWith('retry_'))).toEqual([
      'retry_scheduled:call',
      'retry_scheduled:call',
    ]);
    expect((await runOf(harness, id)).stepExecutions).toBeGreaterThanOrEqual(4);
  });

  it('fails after the last interval', async () => {
    const id = await start(
      harness,
      chain([
        action('always_down', 'make_https_request', {
          url: 'https://example.com/x',
          method: 'GET',
        }),
      ]),
    );
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('request_failed');
  });
});

describe('fencing and leases (C117.3, C117.4)', () => {
  it('rolls an effect back when the claim was lost before completion', async () => {
    const lost: ActionHandler = {
      key: 'remove_tag',
      version: 1,
      shape: 'transaction',
      execute: async (tx, context) => {
        await tx.execute(
          sql`update workflow_run_steps set status = 'ready', claimed_by = null,
                claimed_until = null where id = ${context.stepId}`,
        );
        return {
          kind: 'succeeded',
          output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 0 },
        };
      },
    };
    const local = await createEngineHarness([lost]);
    try {
      const id = await start(
        local,
        chain([action('r', 'remove_tag', { 'object-type': 'inquiry', tag: 'x' })]),
      );
      await drain(local);

      expect((await stepOf(local, id, 'r')).status).toBe('running');
      expect(await effectsOf(local, id)).toEqual([]);
      expect((await runOf(local, id)).status).toBe('in_progress');
    } finally {
      await local.close();
    }
  });

  it('fails a step claimed past the crash-loop cap with execution_error', async () => {
    const id = await start(harness, chain([tagStep('looped')]));
    const job = nextJob(harness);
    await harness.database.client.query(
      'update workflow_run_steps set claims = 10 where run_id = $1',
      [id],
    );
    await processWorkflowStep(job, harness.deps);

    const run = await runOf(harness, id);
    expect(run.status).toBe('errored');
    expect(run.errorCode).toBe('execution_error');
    expect(tag.calls).not.toContain('looped');
  });

  it('ignores a job for a step that is no longer ready', async () => {
    const id = await start(harness, chain([tagStep('twice')]));
    const job = nextJob(harness);
    await processWorkflowStep(job, harness.deps);
    await drain(harness);
    const calls = tag.calls.filter((node) => node === 'twice').length;

    await processWorkflowStep(job, harness.deps);

    expect(tag.calls.filter((node) => node === 'twice').length).toBe(calls);
    expect((await runOf(harness, id)).status).toBe('completed');
  });
});

describe('effects (C117.5)', () => {
  it('writes an internal effect with its row, done, in one transaction', async () => {
    const id = await start(harness, chain([tagStep('once')]));
    await drain(harness);

    const [effect] = await effectsOf(harness, id);
    expect(effect?.status).toBe('done');
    expect(effect?.effectKey).toBe(`${id}/once/`);
    expect(effect?.kind).toBe('tag_object');
  });

  it('leaves an at-most-once effect unknown after a crash, and never resends', async () => {
    const sendConfig = { recipient: '{{ trigger.id }}', subject: 's', text: 't' };
    let crash = true;
    mailBehaviour = () => {
      if (crash) {
        crash = false;
        throw new Error('the process died between the claim and the send');
      }
      return { kind: 'succeeded', output: {} };
    };
    const id = await start(harness, chain([action('notify', 'send_email', sendConfig)]));
    const job = nextJob(harness);
    await expect(processWorkflowStep(job, harness.deps)).rejects.toThrow();
    const before = mail.calls.length;
    const step = await stepOf(harness, id, 'notify');
    await harness.database.client.query(
      `update workflow_run_steps set status = 'ready', claimed_by = null, claimed_until = null
         where id = $1`,
      [step.id],
    );

    await processWorkflowStep({ ...job, attempt: 2 }, harness.deps);

    expect(mail.calls.length).toBe(before);
    expect((await effectsOf(harness, id))[0]?.status).toBe('unknown');
    const run = await runOf(harness, id);
    expect(run.status).toBe('errored');
    expect(run.errorCode).toBe('unknown_effect');
    expect(run.stepOutcomes['unknown-effect']).toBe(1);
  });

  it('reads a handler’s own unknown the same way (C126.5)', async () => {
    mailBehaviour = () => ({
      kind: 'unknown',
      output: { delivery: 'unknown', provider: 'x', sandbox: true, 'message-ref': null },
    });
    const id = await start(
      harness,
      chain([action('notify', 'send_email', { recipient: 'a', subject: 's', text: 't' })]),
    );
    await drain(harness);

    expect((await effectsOf(harness, id))[0]?.status).toBe('unknown');
    expect((await runOf(harness, id)).errorCode).toBe('unknown_effect');
  });

  it('lets a message retry only on proof of non-delivery', async () => {
    mailBehaviour = () => ({ kind: 'failed', code: 'rate_limited', retryable: true });
    const id = await start(
      harness,
      chain([
        action(
          'notify',
          'send_email',
          { recipient: 'a', subject: 's', text: 't' },
          {
            retry: { 'intervals-seconds': [1] },
          },
        ),
      ]),
    );
    await drain(harness);

    expect(await effectsOf(harness, id)).toEqual([]);
    expect((await stepOf(harness, id, 'notify')).status).toBe('ready');
  });
});

describe('the catalogue at run time', () => {
  it('errors a step with no handler as provider_not_configured, never a skip (C122.5)', async () => {
    const id = await start(harness, chain([action('s', 'send_slack_message', { text: 'x' })]));
    await drain(harness);

    const run = await runOf(harness, id);
    expect(run.errorCode).toBe('provider_not_configured');
    expect(run.errorType).toBe('configuration-error');
  });

  it('checks every step against the grant, so a derivation bug fails closed (C121.2)', async () => {
    const id = await start(harness, chain([action('c', 'create_inquiry')]), {
      grant: { scopes: ['accounts:write'], pii: false },
    });
    await drain(harness);

    const run = await runOf(harness, id);
    expect(run.status).toBe('errored');
    expect(run.errorCode).toBe('run_grant_insufficient');
    expect(failing.calls).not.toContain('c');
  });

  it('errors a template that reads what is not there (C115.2)', async () => {
    const id = await start(
      harness,
      chain([
        action('t', 'tag_object', { 'object-type': 'inquiry', tag: '{{ trigger.nothing }}' }),
      ]),
    );
    await drain(harness);

    expect((await runOf(harness, id)).errorCode).toBe('template_variable_missing');
  });
});

describe('parallel and loops (C119.4, C119.6)', () => {
  it('joins every branch, once', async () => {
    const definition = definitionOf(
      [
        {
          id: 'fork',
          type: 'parallel',
          name: 'Fork',
          branches: [{ key: 'a' }, { key: 'b' }],
        },
        tagStep('left'),
        tagStep('right'),
        { id: 'meet', type: 'join', name: 'Meet', 'join-of': 'fork' },
        output(),
      ],
      [
        edge('trigger', 'fork'),
        edge('fork', 'left', 'branch:a'),
        edge('fork', 'right', 'branch:b'),
        edge('left', 'meet'),
        edge('right', 'meet'),
        edge('meet', 'output'),
      ],
    );
    const id = await start(harness, definition);
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    expect((await stepOf(harness, id, 'meet')).status).toBe('succeeded');
    expect((await stepsOf(harness, id)).filter(({ nodeId }) => nodeId === 'meet').length).toBe(1);
  });

  it('gives each iteration its own rows', async () => {
    const definition = definitionOf(
      [
        action('list', 'calculate', { operator: 'add', operands: [1] }),
        {
          id: 'each',
          type: 'loop',
          name: 'Each',
          mode: 'for-each',
          items: 'inputs.items',
        },
        tagStep('inner'),
        output(),
      ],
      [
        edge('trigger', 'list'),
        edge('list', 'each'),
        edge('each', 'inner', 'body'),
        { ...edge('inner', 'each'), 'to-port': 'continue' },
        edge('each', 'output', 'done'),
      ],
      { inputs: [{ name: 'items', type: 'list<string>', required: true }] },
    );
    const id = await start(harness, definition, { inputs: { items: ['x', 'y', 'z'] } });
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('completed');
    const rows = (await stepsOf(harness, id)).filter(({ nodeId }) => nodeId === 'inner');
    expect(rows.map(({ iterationPath }) => iterationPath).sort()).toEqual([
      'each[0]/',
      'each[1]/',
      'each[2]/',
    ]);
    expect(openWorkflowStepValues(await stepOf(harness, id, 'each')).output).toEqual({
      iterations: 3,
    });
  });
});

describe('modules (C119.8)', () => {
  it('runs a module’s steps inside the parent run, pinned, and carries its output back', async () => {
    const module = definitionOf(
      [
        { id: 'in', type: 'module-input', name: 'In' },
        tagStep('inside'),
        output({ outcome: '{{ steps.inside.output.outcome }}' }),
      ],
      [edge('in', 'inside'), edge('inside', 'output')],
      { trigger: null, inputs: [{ name: 'code', type: 'string', required: true }] },
    );
    const { workflowId } = await publish(harness, module, { kind: 'module' });
    const parent = chain([
      {
        id: 'checks',
        type: 'module',
        name: 'Checks',
        'module-workflow-id': workflowId,
        version: 'latest-published',
        inputs: { code: 'x' },
      },
    ]);
    const id = await start(harness, parent);
    await drain(harness);

    expect(await runOf(harness, id)).toEqual(
      expect.objectContaining({ errorCode: null, status: 'completed' }),
    );
    expect((await stepOf(harness, id, 'inside', 'module:checks/')).status).toBe('succeeded');
    expect((await stepOf(harness, id, 'checks')).status).toBe('succeeded');
    expect(openWorkflowStepValues(await stepOf(harness, id, 'checks')).output).toEqual({
      outcome: 'applied',
    });
  });

  it('errors a module with no published version', async () => {
    const parent = chain([
      {
        id: 'checks',
        type: 'module',
        name: 'Checks',
        'module-workflow-id': 'wfl_01M5CK16P0D13FXHZSS4TCFBVH',
        version: 'latest-published',
        inputs: {},
      },
    ]);
    const id = await start(harness, parent);
    await drain(harness);

    expect((await runOf(harness, id)).status).toBe('errored');
    expect((await runOf(harness, id)).errorCode).toBe('execution_error');
  });
});

describe('one run per subject (C118.9)', () => {
  it('holds a later run until the earlier one ends', async () => {
    const definition = chain([tagStep('t')]);
    const published = await publish(harness, definition);
    const subject = 'inq_01M5CK16P0D13FXHZSS4TCFBVM';
    const first = await startOf(harness, published, {
      subjectIds: [subject],
      oneRunPerSubject: subject,
    });
    const second = await startOf(harness, published, {
      subjectIds: [subject],
      oneRunPerSubject: subject,
    });

    const held = await runOf(harness, second);
    expect(held.waitingOn).toBe('earlier-run');
    expect(held.waitingOnRunId).toBe(first);
    expect(await stepsOf(harness, second)).toEqual([]);

    await drain(harness);

    expect((await runOf(harness, first)).status).toBe('completed');
    expect((await runOf(harness, second)).status).toBe('completed');
  });
});
