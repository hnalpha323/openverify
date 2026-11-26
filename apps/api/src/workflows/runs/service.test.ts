/**
 * C120, C112.6, C122.4 (`api-engine`): the run routes. Values are masked fail closed by the registry's
 * marks (C120.6), resume never repeats a `done` effect and stops at an `unknown` one, cancel fences
 * out what is running, test runs hold their rules. Handlers are fakes; every value is synthetic.
 */
import { listWorkflowRunEffects, markWorkflowEffectUnknown } from '@openverify/db';
import { seedWorkflow, seedWorkflowVersion, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandboxMailer } from '../../mail/sandbox.js';
import { bearer } from '../../test-support/harness.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { createActionHandlerTable, type ActionHandler } from '../engine/action-port.js';
import type { EngineDeps } from '../engine/deps.js';
import { dispatchReadySteps } from '../engine/dispatcher.js';
import { runStepJob } from '../engine/executor.js';
import { sweepWorkflowSteps } from '../engine/sweep.js';
import { RUN_WORKFLOW_HANDLER } from '../engine/run-workflow.js';
import { startWorkflowRunInTx, wakeStartedRun } from '../engine/start-run.js';
import { action, chain, output } from '../engine/testing.js';
import { createRecordingWorkflowStepQueue } from '../../test-support/fakes.js';

const SUBJECT = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';

const tag: ActionHandler & { calls: string[] } = {
  key: 'tag_object',
  version: 1,
  shape: 'transaction',
  calls: [],
  execute(_tx, context) {
    tag.calls.push(context.nodeId);
    return Promise.resolve({
      kind: 'succeeded',
      output: { 'object-id': SUBJECT, outcome: 'applied', 'tag-count': 1 },
    });
  },
};

let failNext = false;
const flaky: ActionHandler = {
  key: 'update_object',
  version: 1,
  shape: 'transaction',
  execute() {
    if (failNext) {
      failNext = false;
      return Promise.resolve({ kind: 'failed', code: 'invalid_transition' });
    }
    return Promise.resolve({
      kind: 'succeeded',
      output: { 'object-id': SUBJECT, outcome: 'applied', 'decision-id': null },
    });
  },
};

const mail: ActionHandler = {
  key: 'send_email',
  version: 1,
  shape: 'outside',
  execute: () => Promise.reject(new Error('the process died')),
};

const fetchObject: ActionHandler = {
  key: 'fetch_object',
  version: 1,
  shape: 'outside',
  execute: () =>
    Promise.resolve({
      kind: 'succeeded',
      output: {
        'object-type': 'inquiry',
        'object-id': SUBJECT,
        object: { name: 'a synthetic name' },
      },
    }),
};

const https: ActionHandler & { calls: string[] } = {
  key: 'make_https_request',
  version: 1,
  shape: 'outside',
  calls: [],
  execute(context) {
    https.calls.push(context.nodeId);
    return Promise.resolve({
      kind: 'succeeded',
      output: { status: 200, headers: {}, body: null },
    });
  },
};

const redactObject: ActionHandler & { calls: string[] } = {
  key: 'redact_object',
  version: 1,
  shape: 'outside',
  calls: [],
  execute(context) {
    redactObject.calls.push(context.nodeId);
    return Promise.resolve({
      kind: 'succeeded',
      output: { 'object-id': SUBJECT, outcome: 'applied' },
    });
  },
};

let api: InquiryTestApi;
let engine: EngineDeps;
const steps = createRecordingWorkflowStepQueue();

const GRANT = {
  scopes: ['inquiries:read', 'inquiries:write', 'inquiries:redact', 'workflows:trigger'],
  pii: true,
} as const;

beforeAll(async () => {
  api = await createInquiryTestApi();
  engine = {
    db: api.deps.db,
    clock: api.deps.clock,
    ids: api.deps.ids,
    events: api.deps.events,
    steps,
    services: {
      ...api.deps,
      // No step here sends a message (C126.8).
      messenger: { send: () => Promise.reject(new Error('no message in this suite')) },
      mail: { sandbox: createSandboxMailer(), production: api.deps.mailer },
      egress: { httpAllowLoopback: false, nat64Prefixes: [], codeEnabled: true, codeRunner: null },
    },
    actions: {
      registry: WORKFLOW_ACTIONS,
      handlers: createActionHandlerTable([
        RUN_WORKFLOW_HANDLER,
        tag,
        flaky,
        mail,
        fetchObject,
        https,
        redactObject,
      ]),
    },
  };
}, 120_000);

afterAll(async () => {
  await api.close();
});

const tagStep = (id: string) => action(id, 'tag_object', { 'object-type': 'inquiry', tag: id });

interface Published {
  workflowId: string;
  workflowVersionId: string;
}

async function publishIn(
  environmentId: string,
  definition: unknown,
  options: { status?: 'draft' | 'published' } = {},
): Promise<Published> {
  const workflow = await seedWorkflow(api.deps.db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(api.deps.db, environmentId, {
    workflowId: workflow.id,
    status: options.status ?? 'published',
    definition: definition as never,
  });
  await api.database.client.query(
    `update workflow_versions set "grant" = $2::jsonb where id = $1`,
    [version.id, JSON.stringify(GRANT)],
  );
  return { workflowId: workflow.id, workflowVersionId: version.id };
}

async function startIn(
  environmentId: string,
  published: Published,
  more: Record<string, unknown> = {},
): Promise<string> {
  const started = await api.deps.db.transaction((tx) =>
    startWorkflowRunInTx(tx, engine, {
      environmentId,
      ...published,
      triggerType: 'trigger-api',
      creator: { type: 'api-key', id: testId('key') },
      trigger: { id: SUBJECT, status: 'completed' },
      inputs: { code: 'a synthetic value' },
      subjectIds: [SUBJECT],
      grant: GRANT,
      ...more,
    }),
  );
  await wakeStartedRun(engine, started);
  return started.run.id;
}

/** The API holds no step producer, so the sweep is what picks a route's run up. */
async function drain(): Promise<void> {
  await dispatchReadySteps(engine);
  for (let next = steps.jobs.shift(); next !== undefined; next = steps.jobs.shift()) {
    await runStepJob(engine, next.job).catch(() => undefined);
  }
}

const start = async (definition: unknown, more: Record<string, unknown> = {}) =>
  startIn(api.environmentId, await publishIn(api.environmentId, definition), more);

const call = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  token = api.token,
  payload?: unknown,
) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

interface Served {
  id: string;
  attributes: Record<string, unknown>;
}

const data = (response: { body: string }) => (JSON.parse(response.body) as { data: Served }).data;

describe('reading runs (C120.1, C120.6)', () => {
  it('serves a run with its outcomes, subjects and values to a reader who may see them', async () => {
    const id = await start(
      chain([tagStep('one')], {
        steps: [tagStep('one'), output({ decision: 'approve' })],
        outputs: [{ name: 'decision', pii: false }],
      }),
    );
    await drain();

    const response = await call('GET', `/workflow-runs/${id}`);

    expect(response.statusCode).toBe(200);
    const { attributes } = data(response);
    expect(attributes.status).toBe('completed');
    expect(attributes['subject-ids']).toContain(SUBJECT);
    expect(attributes.inputs).toEqual({ code: 'a synthetic value' });
    expect(attributes.outputs).toEqual({ decision: 'approve' });
    expect(attributes['trigger-snapshot']).toEqual({ id: SUBJECT, status: 'completed' });
    const { meta } = response.json<{ data: { meta: Record<string, number> } }>().data;
    expect(meta['processing-time-seconds']).toBeGreaterThanOrEqual(0);
  });

  it('masks every value without PII visibility, keeping only what is declared plain', async () => {
    const id = await start(
      chain(
        [
          tagStep('one'),
          action('read', 'fetch_object', { 'object-type': 'inquiry', 'object-id': SUBJECT }),
        ],
        {
          inputs: [{ name: 'code', type: 'string', required: true }],
        },
      ),
    );
    await drain();
    const masked = api.newUserToken(api.environmentId, { permissions: ['workflow-runs:read'] });

    const run = data(await call('GET', `/workflow-runs/${id}`, masked)).attributes;
    expect(run.inputs).toEqual({ code: null });
    expect(run['trigger-snapshot']).toEqual({ id: null, status: null });

    const steps = (await call('GET', `/workflow-runs/${id}/steps`, masked)).json<{
      data: { attributes: { 'node-id': string; output: unknown; input: unknown } }[];
    }>();
    const byNode = new Map(steps.data.map(({ attributes }) => [attributes['node-id'], attributes]));
    expect(byNode.get('one')?.output).toEqual({
      'object-id': SUBJECT,
      outcome: 'applied',
      'tag-count': 1,
    });
    expect(byNode.get('one')?.input).toBeNull();
    expect(byNode.get('read')?.output).toEqual({
      'object-type': 'inquiry',
      'object-id': SUBJECT,
      object: null,
    });
    expect(JSON.stringify(steps)).not.toContain('a synthetic name');
  });

  it('shows the same steps whole to a reader who may see them', async () => {
    const id = await start(
      chain([action('read', 'fetch_object', { 'object-type': 'inquiry', 'object-id': SUBJECT })]),
    );
    await drain();

    const response = await call('GET', `/workflow-runs/${id}/steps`);

    expect(JSON.stringify(response.json())).toContain('a synthetic name');
  });

  it('is not for viewers, and is a 404 across environments', async () => {
    const id = await start(chain([tagStep('one')]));
    await drain();
    const other = await api.newTenant();

    expect(
      (
        await call(
          'GET',
          `/workflow-runs/${id}`,
          api.newUserToken(api.environmentId, { permissions: ['workflows:read'] }),
        )
      ).statusCode,
    ).toBe(403);
    expect((await call('GET', `/workflow-runs/${id}`, other.token)).statusCode).toBe(404);
  });

  it('filters the list, newest first', async () => {
    const published = await publishIn(api.environmentId, chain([tagStep('one')]));
    const id = await startIn(api.environmentId, published);
    await drain();

    const response = await call(
      'GET',
      `/workflow-runs?filter[workflow-id]=${published.workflowId}&filter[status]=completed`,
    );

    expect(response.json<{ data: { id: string }[] }>().data.map((run) => run.id)).toEqual([id]);
  });

  it('includes the workflow and its version only for a reader of definitions', async () => {
    const id = await start(chain([tagStep('one')]));
    await drain();
    const runsOnly = api.newUserToken(api.environmentId, { permissions: ['workflow-runs:read'] });

    const included = await call('GET', `/workflow-runs/${id}?include=workflow,workflow-version`);
    const refused = await call('GET', `/workflow-runs/${id}?include=workflow`, runsOnly);

    expect(
      included
        .json<{ included: { type: string }[] }>()
        .included.map(({ type }) => type)
        .sort(),
    ).toEqual(['workflow', 'workflow-version']);
    expect(refused.statusCode).toBe(403);
  });
});

describe('resume (C120.3)', () => {
  it('re-readies the failed step and never repeats a done effect', async () => {
    failNext = true;
    const id = await start(
      chain([
        tagStep('first'),
        action('second', 'update_object', {
          'object-type': 'inquiry',
          field: 'tags',
          operator: 'set',
          value: 'x',
        }),
      ]),
    );
    await drain();
    expect(data(await call('GET', `/workflow-runs/${id}`)).attributes.status).toBe('errored');
    const before = tag.calls.filter((node) => node === 'first').length;

    const response = await call('POST', `/workflow-runs/${id}/resume`);
    await drain();

    expect(response.statusCode).toBe(200);
    expect(data(await call('GET', `/workflow-runs/${id}`)).attributes.status).toBe('completed');
    expect(tag.calls.filter((node) => node === 'first').length).toBe(before);
  });

  it('refuses a run that has not errored', async () => {
    const id = await start(chain([tagStep('one')]));
    await drain();

    const response = await call('POST', `/workflow-runs/${id}/resume`);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('run_not_resumable');
  });

  it('stops at an unknown effect, naming the step, until it is acknowledged', async () => {
    const id = await start(
      chain([
        action('notify', 'send_email', { recipient: 'a', subject: 's', text: 't' }),
        tagStep('after'),
      ]),
    );
    await drain();
    const [claimed] = await api.database.client
      .query<{ id: string; status: string }>(
        'select id, status from workflow_run_steps where run_id = $1',
        [id],
      )
      .then(({ rows }) => rows);
    await markWorkflowEffectUnknown(api.deps.db, api.environmentId, `${id}/notify/`);
    await api.database.client.query(
      `update workflow_run_steps set status = 'ready', claimed_by = null, claimed_until = null where id = $1`,
      [claimed?.id],
    );
    steps.jobs.push({
      job: { environmentId: api.environmentId, runId: id, stepId: claimed?.id ?? '', attempt: 2 },
      options: {},
    });
    await drain();
    expect((await listWorkflowRunEffects(api.deps.db, api.environmentId, id))[0]?.status).toBe(
      'unknown',
    );

    const blocked = await call('POST', `/workflow-runs/${id}/resume`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual(
      expect.objectContaining({
        code: 'run_not_resumable',
        'blocked-by': 'unknown_effect',
        'step-id': claimed?.id,
      }),
    );

    const acknowledged = await call('POST', `/workflow-runs/${id}/resume`, api.token, {
      meta: { 'skip-unknown-effects': true },
    });
    await drain();

    expect(acknowledged.statusCode).toBe(200);
    const run = data(await call('GET', `/workflow-runs/${id}`)).attributes;
    expect(run.status).toBe('completed');
    const rows = await api.database.client.query<{ output: string }>(
      `select node_id from workflow_run_steps where run_id = $1 and node_id = 'after'`,
      [id],
    );
    expect(rows.rows.length).toBe(1);
  });

  it('never resumes a run stopped by publisher_revoked (C121.5)', async () => {
    const id = await start(
      chain([
        action('call', 'make_https_request', { url: 'https://example.com/x', method: 'GET' }),
      ]),
    );
    await api.database.client.query(
      `update workflows set status = 'paused', paused_reason = 'publisher_revoked'
         where id = (select workflow_id from workflow_runs where id = $1)`,
      [id],
    );
    await drain();
    expect(https.calls).not.toContain('call');
    expect(data(await call('GET', `/workflow-runs/${id}`)).attributes.error).toEqual(
      expect.objectContaining({ type: 'configuration-error' }),
    );

    const response = await call('POST', `/workflow-runs/${id}/resume`);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual(expect.objectContaining({ 'blocked-by': 'publisher_revoked' }));
  });
});

describe('rerun (C120.4)', () => {
  it('starts the latest published version with the same snapshot, linked to the first', async () => {
    const published = await publishIn(api.environmentId, chain([tagStep('one')]));
    const id = await startIn(api.environmentId, published);
    await drain();

    const response = await call('POST', `/workflow-runs/${id}/rerun`);

    expect(response.statusCode).toBe(201);
    const rerun = response.json<{
      data: {
        id: string;
        attributes: Record<string, unknown>;
        relationships: Record<string, { data: unknown }>;
      };
    }>().data;
    expect(rerun.id).not.toBe(id);
    expect(rerun.relationships['rerun-of']?.data).toEqual({ type: 'workflow-run', id });
    expect(rerun.relationships.creator?.data).toEqual(expect.objectContaining({ type: 'api-key' }));
    expect(rerun.attributes.inputs).toEqual({ code: 'a synthetic value' });
  });

  it('needs every scope of the grant from whoever asks (C121.3)', async () => {
    const id = await start(chain([tagStep('one')]));
    await drain();
    const weak = api.newUserToken(api.environmentId, { permissions: ['workflow-runs:write'] });

    const response = await call('POST', `/workflow-runs/${id}/rerun`, weak);

    expect(response.statusCode).toBe(403);
  });
});

describe('cancel (C120.5)', () => {
  it('cancels what is pending and waiting, and fences out what is running', async () => {
    const id = await start(chain([tagStep('one')]));

    const response = await call('POST', `/workflow-runs/${id}/cancel`);
    await drain();

    expect(response.statusCode).toBe(200);
    expect(data(response).attributes.status).toBe('canceled');
    expect(tag.calls.filter((node) => node === 'never')).toEqual([]);
    expect(data(await call('GET', `/workflow-runs/${id}`)).attributes.status).toBe('canceled');
  });

  it('refuses a run that has ended', async () => {
    const id = await start(chain([tagStep('one')]));
    await drain();

    const response = await call('POST', `/workflow-runs/${id}/cancel`);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('run_not_cancelable');
  });

  it('cancels the unfinished runs of older versions (C116.2)', async () => {
    const workflow = await seedWorkflow(api.deps.db, api.environmentId, { status: 'running' });
    const definition = chain([tagStep('one')]);
    const old = await seedWorkflowVersion(api.deps.db, api.environmentId, {
      workflowId: workflow.id,
      status: 'published',
      versionNumber: 1,
      definition: definition,
    });
    const current = await seedWorkflowVersion(api.deps.db, api.environmentId, {
      workflowId: workflow.id,
      status: 'published',
      versionNumber: 2,
      definition: definition,
    });
    const older = await startIn(api.environmentId, {
      workflowId: workflow.id,
      workflowVersionId: old.id,
    });
    const newer = await startIn(api.environmentId, {
      workflowId: workflow.id,
      workflowVersionId: current.id,
    });

    const response = await call('POST', `/workflows/${workflow.id}/cancel-runs`, api.token, {
      meta: { 'before-version-id': current.id },
    });

    expect(response.json()).toEqual({ meta: { 'canceled-count': 1 } });
    expect(data(await call('GET', `/workflow-runs/${older}`)).attributes.status).toBe('canceled');
    expect(data(await call('GET', `/workflow-runs/${newer}`)).attributes.status).toBe(
      'in_progress',
    );
    steps.jobs.splice(0);
  });
});

describe('what resume, rerun and cancel refuse or carry with them (K8-13)', () => {
  const problem = (response: { body: string }) =>
    JSON.parse(response.body) as { code?: string; 'blocked-by'?: string };
  const statusOf = async (id: string) =>
    data(await call('GET', `/workflow-runs/${id}`)).attributes.status;

  /** A run that errored at its second step, the first's effect done. */
  async function erroredRun(): Promise<string> {
    failNext = true;
    const id = await start(
      chain([
        tagStep('first'),
        action('second', 'update_object', {
          'object-type': 'inquiry',
          field: 'tags',
          operator: 'set',
          value: 'x',
        }),
      ]),
    );
    await drain();
    expect(await statusOf(id)).toBe('errored');
    return id;
  }

  it('answers 404 for a run this environment does not hold, to resume, rerun and cancel alike', async () => {
    const unknown = testId('wfr');

    for (const verb of ['resume', 'rerun', 'cancel']) {
      expect((await call('POST', `/workflow-runs/${unknown}/${verb}`)).statusCode).toBe(404);
    }
  });

  it('neither resumes nor reruns a run whose values were redacted', async () => {
    const id = await erroredRun();
    expect((await call('DELETE', `/workflow-runs/${id}`)).statusCode).toBe(200);

    const resumed = await call('POST', `/workflow-runs/${id}/resume`);
    const rerun = await call('POST', `/workflow-runs/${id}/rerun`);

    for (const response of [resumed, rerun]) {
      expect(response.statusCode).toBe(409);
      expect(problem(response)).toMatchObject({
        code: 'run_not_resumable',
        'blocked-by': 'values_gone',
      });
    }
    expect(await statusOf(id)).toBe('errored');
  });

  it('never resumes a run that stopped as a whole at its deadline, naming the limit', async () => {
    const id = await start(chain([tagStep('late')]));
    await api.database.client.query(
      `update workflow_runs set deadline_at = now() - interval '1 minute' where id = $1`,
      [id],
    );
    await sweepWorkflowSteps(engine);
    steps.jobs.splice(0);
    expect(await statusOf(id)).toBe('errored');

    const response = await call('POST', `/workflow-runs/${id}/resume`);

    expect(response.statusCode).toBe(409);
    expect(problem(response)).toMatchObject({
      code: 'run_not_resumable',
      'blocked-by': 'run_deadline_exceeded',
    });
    expect(await statusOf(id)).toBe('errored');
  });

  it('reruns nothing once the workflow has no published version', async () => {
    const published = await publishIn(api.environmentId, chain([tagStep('one')]));
    const id = await startIn(api.environmentId, published);
    await drain();
    await api.database.client.query(
      `update workflow_versions set status = 'archived' where id = $1`,
      [published.workflowVersionId],
    );

    const response = await call('POST', `/workflow-runs/${id}/rerun`);

    expect(response.statusCode).toBe(409);
    expect(problem(response).code).toBe('workflow_not_running');
  });

  it('cancels a child run still in progress with its parent', async () => {
    const published = await publishIn(api.environmentId, chain([tagStep('parent')]));
    const parent = await startIn(api.environmentId, published);
    const child = await startIn(
      api.environmentId,
      await publishIn(api.environmentId, chain([tagStep('child')])),
      { parentRunId: parent, rootRunId: parent, depth: 1 },
    );
    steps.jobs.splice(0);

    const response = await call('POST', `/workflow-runs/${parent}/cancel`);

    expect(response.statusCode).toBe(200);
    expect([await statusOf(parent), await statusOf(child)]).toEqual(['canceled', 'canceled']);
  });

  it('answers 404 when cancelling the runs before a version the workflow does not hold', async () => {
    const workflow = await seedWorkflow(api.deps.db, api.environmentId, { status: 'running' });

    const response = await call('POST', `/workflows/${workflow.id}/cancel-runs`, api.token, {
      meta: { 'before-version-id': testId('wfv') },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('redaction of one run (C120.9, P35)', () => {
  it('nulls its values, with the admin’s scope alone', async () => {
    const id = await start(chain([tagStep('one')]));
    await drain();
    const weak = api.newUserToken(api.environmentId, { permissions: ['workflow-runs:read'] });

    expect((await call('DELETE', `/workflow-runs/${id}`, weak)).statusCode).toBe(403);
    const response = await call('DELETE', `/workflow-runs/${id}`);

    expect(response.statusCode).toBe(200);
    const { attributes } = data(response);
    expect(attributes['redacted-at']).not.toBeNull();
    expect(attributes.inputs).toBeNull();
    const rows = await api.database.client.query<{ inputs: string | null; output: string | null }>(
      `select r.inputs, s.output from workflow_runs r join workflow_run_steps s on s.run_id = r.id
         where r.id = $1`,
      [id],
    );
    expect(
      rows.rows.every(({ inputs, output: stepOutput }) => inputs === null && stepOutput === null),
    ).toBe(true);
  });
});

describe('test runs (C120.7)', () => {
  const body = (attributes: Record<string, unknown>, acknowledgements?: readonly string[]) => ({
    data: { attributes: { 'trigger-payload': {}, ...attributes } },
    ...(acknowledgements === undefined ? {} : { meta: { acknowledgements } }),
  });

  it('is refused outside a sandbox', async () => {
    const production = await api.newTenant({ kind: 'production' });
    const { workflowId } = await publishIn(production.environmentId, chain([tagStep('one')]));

    const response = await call(
      'POST',
      `/workflows/${workflowId}/test-runs`,
      production.token,
      body({}),
    );

    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe('test_runs_sandbox_only');
  });

  it('runs the draft, marked, with an override standing in for a step', async () => {
    const definition = chain([tagStep('one'), tagStep('two')]);
    const { workflowId } = await publishIn(api.environmentId, definition, { status: 'draft' });
    await api.database.client.query(
      `update workflows set draft_version_id = (select id from workflow_versions where workflow_id = $1) where id = $1`,
      [workflowId],
    );

    const response = await call(
      'POST',
      `/workflows/${workflowId}/test-runs`,
      api.token,
      body({
        overrides: { two: { 'object-id': SUBJECT, outcome: 'no_change', 'tag-count': 0 } },
      }),
    );
    await drain();

    expect(response.statusCode).toBe(201);
    const { id } = data(response);
    const run = data(await call('GET', `/workflow-runs/${id}`)).attributes;
    expect(run['test-run-id']).toBe(id);
    expect(run['overridden-steps']).toEqual(['two']);
    expect(run.status).toBe('completed');
    const rows = await api.database.client.query<{ overridden: boolean }>(
      `select overridden from workflow_run_steps where run_id = $1 and node_id = 'two'`,
      [id],
    );
    expect(rows.rows[0]?.overridden).toBe(true);
  });

  it('simulates an irreversible step unless it is acknowledged', async () => {
    const definition = chain([
      action('wipe', 'redact_object', { 'object-type': 'inquiry', 'object-id': SUBJECT }),
    ]);
    const { workflowId } = await publishIn(api.environmentId, definition);

    const simulated = await call(
      'POST',
      `/workflows/${workflowId}/test-runs`,
      api.token,
      body({ 'workflow-version-id': undefined }),
    );
    await drain();

    expect(redactObject.calls).toEqual([]);
    const rows = await api.database.client.query<{ simulated: boolean }>(
      `select simulated from workflow_run_steps where run_id = $1 and node_id = 'wipe'`,
      [data(simulated).id],
    );
    expect(rows.rows[0]?.simulated).toBe(true);

    await call(
      'POST',
      `/workflows/${workflowId}/test-runs`,
      api.token,
      body({}, ['irreversible:wipe']),
    );
    await drain();

    expect(redactObject.calls).toEqual(['wipe']);
  });

  it('makes no HTTPS call unless a user with PII visibility allows the host', async () => {
    const definition = chain([
      action('call', 'make_https_request', { url: 'https://example.com/x', method: 'GET' }),
    ]);
    const { workflowId } = await publishIn(api.environmentId, definition);
    const before = https.calls.length;

    const refused = await call('POST', `/workflows/${workflowId}/test-runs`, api.token, body({}));
    await drain();

    expect(data(await call('GET', `/workflow-runs/${data(refused).id}`)).attributes.status).toBe(
      'errored',
    );
    expect(https.calls.length).toBe(before);

    const user = api.newUserToken(api.environmentId);
    await call(
      'POST',
      `/workflows/${workflowId}/test-runs`,
      user,
      body({ 'allow-hosts': ['example.com'] }, ['egress:call']),
    );
    await drain();

    expect(https.calls.length).toBe(before + 1);
  });

  it('compares an allowed host through the one normaliser, never as text (C124.3)', async () => {
    const definition = chain([
      action('call', 'make_https_request', { url: 'https://EXAMPLE.com/x', method: 'GET' }),
    ]);
    const { workflowId } = await publishIn(api.environmentId, definition);
    const before = https.calls.length;

    await call(
      'POST',
      `/workflows/${workflowId}/test-runs`,
      api.newUserToken(api.environmentId),
      body({ 'allow-hosts': ['example.com'] }, ['egress:call']),
    );
    await drain();

    expect(https.calls.length).toBe(before + 1);
  });

  it('starts from an existing object, or 404s for one this environment does not hold', async () => {
    const { workflowId } = await publishIn(api.environmentId, chain([tagStep('one')]));

    const response = await call('POST', `/workflows/${workflowId}/test-runs`, api.token, {
      data: { attributes: { 'object-id': SUBJECT } },
    });

    expect(response.statusCode).toBe(404);
  });

  it('tests only a version of its own workflow, and 404s for a workflow with none (K8-13)', async () => {
    const own = await publishIn(api.environmentId, chain([tagStep('one')]));
    const other = await publishIn(api.environmentId, chain([tagStep('one')]));
    const bare = await seedWorkflow(api.deps.db, api.environmentId, { status: 'running' });

    const foreign = await call('POST', `/workflows/${own.workflowId}/test-runs`, api.token, {
      data: {
        attributes: { 'workflow-version-id': other.workflowVersionId, 'trigger-payload': {} },
      },
    });
    const none = await call('POST', `/workflows/${bare.id}/test-runs`, api.token, body({}));

    expect([foreign.statusCode, none.statusCode]).toEqual([404, 404]);
    expect(steps.jobs).toEqual([]);
  });

  it('starts from no object of a kind a run never starts from, nor from nothing at all (K8-13)', async () => {
    const { workflowId } = await publishIn(api.environmentId, chain([tagStep('one')]));

    const verification = await call('POST', `/workflows/${workflowId}/test-runs`, api.token, {
      data: { attributes: { 'object-id': testId('ver') } },
    });
    const nothing = await call('POST', `/workflows/${workflowId}/test-runs`, api.token, {
      data: { attributes: {} },
    });

    expect(verification.statusCode).toBe(404);
    // The body itself names one start or the other (C120.7), so neither is refused before a run.
    expect(nothing.statusCode).toBe(400);
    expect(steps.jobs).toEqual([]);
  });

  it('refuses a payload that is no object, echoing nothing', async () => {
    const { workflowId } = await publishIn(api.environmentId, chain([tagStep('one')]));

    const response = await call('POST', `/workflows/${workflowId}/test-runs`, api.token, {
      data: { attributes: { 'trigger-payload': 'a synthetic value' } },
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain('a synthetic value');
  });

  describe('a synthetic payload is held to its event’s view (K8-12, C119)', () => {
    const onCompleted = () =>
      chain([tagStep('one')], {
        trigger: { type: 'trigger-event', config: { events: ['inquiry.completed'] } },
      });
    const testRun = async (payload: unknown) => {
      const { workflowId } = await publishIn(api.environmentId, onCompleted());
      return call('POST', `/workflows/${workflowId}/test-runs`, api.token, {
        data: { attributes: { 'trigger-payload': payload } },
      });
    };
    const pointerOf = (response: { json: () => unknown }) =>
      (response.json() as { source?: { pointer?: string } }).source?.pointer;

    it('takes a partial payload: what it leaves out reads as null in the run', async () => {
      expect((await testRun({})).statusCode).toBe(201);
      expect((await testRun({ id: SUBJECT, status: 'completed' })).statusCode).toBe(201);
    });

    it('refuses a member of the wrong type at its pointer, echoing nothing', async () => {
      const response = await testRun({ id: SUBJECT, status: 7031 });

      expect(response.statusCode, response.body).toBe(422);
      expect(response.json<{ code: string }>().code).toBe('trigger_input_invalid');
      expect(pointerOf(response)).toBe('/data/attributes/trigger-payload/status');
      expect(response.body).not.toContain('7031');
    });

    it('refuses a member the view does not hold, and an explicit null where none may be', async () => {
      const unknown = await testRun({ 'not-a-member': 'a synthetic value' });
      expect(unknown.statusCode, unknown.body).toBe(422);
      expect(pointerOf(unknown)).toBe('/data/attributes/trigger-payload/not-a-member');
      expect(unknown.body).not.toContain('a synthetic value');

      const nulled = await testRun({ id: null });
      expect(nulled.statusCode, nulled.body).toBe(422);
      expect(pointerOf(nulled)).toBe('/data/attributes/trigger-payload/id');

      const listed = await testRun({ tags: ['synthetic', null] });
      expect(listed.statusCode, listed.body).toBe(422);
      expect(pointerOf(listed)).toBe('/data/attributes/trigger-payload/tags/1');
    });
  });

  it('needs the caller to hold the version’s grant', async () => {
    const { workflowId } = await publishIn(api.environmentId, chain([tagStep('one')]));
    const weak = api.newUserToken(api.environmentId, { permissions: ['workflows:trigger'] });

    expect(
      (await call('POST', `/workflows/${workflowId}/test-runs`, weak, body({}))).statusCode,
    ).toBe(403);
  });
});

describe('the action catalogue (C122.4)', () => {
  it('lists every action version with its schemas and whether it is available', async () => {
    const response = await call('GET', '/workflow-actions');

    expect(response.statusCode).toBe(200);
    const { data: actions } = response.json<{
      data: { id: string; attributes: Record<string, unknown> }[];
    }>();
    expect(actions.length).toBe(WORKFLOW_ACTIONS.list().length);
    const decline = actions.find(({ id }) => id === 'decline_inquiry@1');
    expect(decline?.attributes.adverse).toBe('always');
    expect(decline?.attributes['config-schema']).toEqual(
      expect.objectContaining({ type: 'object' }),
    );
  });
});

describe('what the API process knows of the worker’s adapters (C122.5, Stage 1b amendment 52)', () => {
  const availability = async (key: string) => {
    const { data: actions } = (await call('GET', '/workflow-actions')).json<{
      data: { id: string; attributes: { available: boolean; reason: string | null } }[];
    }>();
    return actions.find(({ id }) => id === `${key}@1`)?.attributes;
  };

  it('reads mail in a sandbox as available, because it goes to the sandbox list', async () => {
    expect(await availability('send_email')).toEqual(
      expect.objectContaining({ available: true, reason: null }),
    );
  });
});
