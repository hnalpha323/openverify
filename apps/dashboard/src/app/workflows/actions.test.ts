// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { serveRunAccountAction } from '../../testing/routes/workflows';
import {
  SECRET_ENVIRONMENT_ID as ENV,
  WORKFLOW_IDS as IDS,
  workflow,
  workflowDefinition,
  workflowDraft,
  workflowRun,
  workflowVersion,
} from '../../testing/workflow-fixtures';
import { serveDraftCheck } from '../../testing/routes/workflows';
import { PARAMETER_PREFIX, PARAMETER_TYPE_PREFIX } from '../../components/workflows/parameters';
import {
  cancelOlderRuns,
  changeRollout,
  controlRun,
  createWorkflow,
  publishWorkflow,
  restoreVersion,
  installRecipe,
  promoteWorkflow,
  saveWorkflowDraft,
  redactRun,
  runAccountAction,
  searchRecordedMessages,
  setWorkflowStatus,
  startManualRuns,
  startTestRun,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

const as = (...permissions: Permission[]) => api.me({ permissions });
const RUN = `/accounts/${IDS.account}/run-action`;

const form = (parameters: Record<string, [string, string]>) => {
  const data = new FormData();
  data.set('account-id', IDS.account);
  data.set('account-action-id', IDS.accountAction);
  for (const [name, [type, value]] of Object.entries(parameters)) {
    data.set(`${PARAMETER_TYPE_PREFIX}${name}`, type);
    data.set(`${PARAMETER_PREFIX}${name}`, value);
  }
  return data;
};

describe('runAccountAction (C118.7)', () => {
  it('runs the action with its typed parameters and answers the started run', async () => {
    as('accounts:read', 'workflows:trigger');
    serveRunAccountAction(api, IDS.account, IDS.run);

    const result = await runAccountAction(null, form({ priority: ['integer', '2'] }));

    expect(result).toEqual({ ok: true, data: { runId: IDS.run } });
    expect(api.find('POST', RUN)?.body).toEqual({
      data: { 'account-action-id': IDS.accountAction, parameters: { priority: 2 } },
    });
  });

  it('refuses a parameter that does not hold its type, by its pointer, without calling the API', async () => {
    as('accounts:read', 'workflows:trigger');

    const result = await runAccountAction(null, form({ priority: ['integer', 'x'] }));

    expect(result.ok ? null : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/parameters/priority',
    ]);
    expect(api.all('POST', RUN)).toHaveLength(0);
  });

  it('refuses without workflows:trigger, without calling the API', async () => {
    as('accounts:read');

    const result = await runAccountAction(null, form({}));

    expect(result.ok).toBe(false);
    expect(api.all('POST', RUN)).toHaveLength(0);
  });
});

describe('setWorkflowStatus (C112.6)', () => {
  it.each(['pause', 'activate', 'archive'])(
    'runs %s and refreshes the workflow page',
    async (action) => {
      as('workflows:read', 'workflows:write');
      api.on('POST', `/workflows/${IDS.workflow}/${action}`, 200, { data: workflow() });
      const data = new FormData();
      data.set('workflow-id', IDS.workflow);
      data.set('action', action);

      await setWorkflowStatus(null, data);

      expect(api.all('POST', `/workflows/${IDS.workflow}/${action}`)).toHaveLength(1);
      expect(revalidatePath).toHaveBeenCalledWith(`/workflows/${IDS.workflow}`);
    },
  );

  it('refuses without workflows:write, without calling the API', async () => {
    as('workflows:read');
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('action', 'pause');

    const result = await setWorkflowStatus(null, data);

    expect(result.ok).toBe(false);
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });
});

describe('installRecipe (C140.5)', () => {
  it('refuses a malformed recipe key, without calling the API', async () => {
    as('workflows:read', 'workflows:write');
    const data = new FormData();
    data.set('recipe-key', '../x');

    const result = await installRecipe(null, data);

    expect(result.ok).toBe(false);
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });
});

describe('controlRun (C120.3 to C120.5)', () => {
  const RUNS = `/workflow-runs/${IDS.run}`;
  const formOf = (values: Record<string, string>) => {
    const data = new FormData();
    data.set('run-id', IDS.run);
    for (const [name, value] of Object.entries(values)) {
      data.set(name, value);
    }
    return data;
  };

  it('resumes without skipping an unknown effect unless the operator acknowledged it', async () => {
    as('workflow-runs:read', 'workflow-runs:write');
    api.on('POST', `${RUNS}/resume`, 200, {
      data: workflowRun({ status: 'in_progress', 'completed-at': null }),
    });

    expect(await controlRun(null, formOf({ control: 'resume' }))).toEqual({
      ok: true,
      data: { runId: IDS.run },
    });
    expect(api.find('POST', `${RUNS}/resume`)?.body).toEqual({});

    await controlRun(null, formOf({ control: 'resume', 'skip-unknown-effects': 'acknowledged' }));
    expect(api.all('POST', `${RUNS}/resume`)[1]?.body).toEqual({
      meta: { 'skip-unknown-effects': true },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/workflows/runs/${IDS.run}`);
  });

  it('reruns and answers the new run', async () => {
    as('workflow-runs:read', 'workflow-runs:write');
    api.on('POST', `${RUNS}/rerun`, 201, { data: workflowRun({}, IDS.otherRun) });

    expect(await controlRun(null, formOf({ control: 'rerun' }))).toEqual({
      ok: true,
      data: { runId: IDS.otherRun },
    });
  });

  it('cancels', async () => {
    as('workflow-runs:read', 'workflow-runs:write');
    api.on('POST', `${RUNS}/cancel`, 200, { data: workflowRun({ status: 'canceled' }) });

    expect(await controlRun(null, formOf({ control: 'cancel' }))).toEqual({
      ok: true,
      data: { runId: IDS.run },
    });
    expect(api.all('POST', `${RUNS}/cancel`)).toHaveLength(1);
  });

  it('refuses without workflow-runs:write, without calling the API', async () => {
    as('workflow-runs:read');

    const result = await controlRun(null, formOf({ control: 'cancel' }));

    expect(result.ok).toBe(false);
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });
});

describe('redactRun (C120.9)', () => {
  it('redacts the run under workflow-runs:redact', async () => {
    as('workflow-runs:read', 'workflow-runs:redact');
    api.on('DELETE', `/workflow-runs/${IDS.run}`, 200, {
      data: workflowRun({ 'redacted-at': '2026-11-01T09:05:00.000Z', outputs: null }),
    });
    const data = new FormData();
    data.set('run-id', IDS.run);

    expect(await redactRun(null, data)).toEqual({ ok: true, data: undefined });
    expect(api.all('DELETE', `/workflow-runs/${IDS.run}`)).toHaveLength(1);
  });

  it('refuses without workflow-runs:redact, without calling the API', async () => {
    as('workflow-runs:read', 'workflow-runs:write');
    const data = new FormData();
    data.set('run-id', IDS.run);

    expect((await redactRun(null, data)).ok).toBe(false);
    expect(api.all('DELETE', `/workflow-runs/${IDS.run}`)).toHaveLength(0);
  });
});

describe('createWorkflow (C112.6)', () => {
  it('creates the workflow with its empty draft and answers its id', async () => {
    as('workflows:read', 'workflows:write');
    api.on('POST', '/workflows', 201, {
      data: workflow({ status: 'paused', 'paused-reason': 'operator' }),
    });
    const data = new FormData();
    data.set('environment-id', ENV);
    data.set('name', 'Synthetic workflow');
    data.set('description', '');

    const result = await createWorkflow(null, data);

    expect(result).toEqual({ ok: true, data: { workflowId: IDS.workflow } });
    expect(api.find('POST', '/workflows')?.body).toEqual({
      data: { type: 'workflow', attributes: { name: 'Synthetic workflow' } },
    });
  });

  it('refuses an empty name at its pointer, without calling the API', async () => {
    as('workflows:read', 'workflows:write');
    const data = new FormData();
    data.set('environment-id', ENV);
    data.set('name', ' ');

    const result = await createWorkflow(null, data);

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/name',
    ]);
    expect(api.all('POST', '/workflows')).toHaveLength(0);
  });
});

describe('saveWorkflowDraft (C113.6, C116.1)', () => {
  const DRAFT = `/workflows/${IDS.workflow}/draft`;
  const formOf = (intent: string, definition: string, lockVersion = '3') => {
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('lock-version', lockVersion);
    data.set('definition', definition);
    data.set('intent', intent);
    return data;
  };
  const text = JSON.stringify(workflowDefinition());

  it('checks the definition without saving it', async () => {
    as('workflows:read', 'workflows:write');
    serveDraftCheck(api, IDS.workflow, [
      { pointer: '/steps/0/config/text', code: 'config_invalid', detail: 'is required' },
    ]);

    const result = await saveWorkflowDraft(null, formOf('check', text));

    expect(result).toEqual({
      ok: true,
      data: {
        saved: false,
        lockVersion: null,
        errors: [
          { pointer: '/steps/0/config/text', code: 'config_invalid', detail: 'is required' },
        ],
        warnings: [],
      },
    });
    expect(api.find('POST', `${DRAFT}/validate`)?.body).toEqual({
      data: { type: 'workflow-version', attributes: { definition: workflowDefinition() } },
    });
    expect(api.all('PUT', DRAFT)).toHaveLength(0);
  });

  it('saves a definition that passes its check at the lock version, answering the new one', async () => {
    as('workflows:read', 'workflows:write');
    serveDraftCheck(
      api,
      IDS.workflow,
      [],
      [{ pointer: '/steps/0', code: 'step_unused_output', detail: 'nothing reads it' }],
    );
    api.on('PUT', DRAFT, 200, { data: workflowDraft({ 'lock-version': 4 }) });

    const result = await saveWorkflowDraft(null, formOf('save', text));

    expect(result).toMatchObject({ ok: true, data: { saved: true, lockVersion: 4, errors: [] } });
    expect(api.find('PUT', DRAFT)?.body).toEqual({
      data: {
        type: 'workflow-version',
        attributes: { definition: workflowDefinition(), 'lock-version': 3 },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/workflows/${IDS.workflow}`);
  });

  it('does not save a definition with errors, answering them by pointer', async () => {
    as('workflows:read', 'workflows:write');
    serveDraftCheck(api, IDS.workflow, [{ pointer: '/edges/0/to', code: 'edge_target_missing' }]);

    const result = await saveWorkflowDraft(null, formOf('save', text));

    expect(result).toMatchObject({
      ok: true,
      data: { saved: false, errors: [{ pointer: '/edges/0/to', code: 'edge_target_missing' }] },
    });
    expect(api.all('PUT', DRAFT)).toHaveLength(0);
  });

  it('refuses text that is not JSON at /definition, without calling the API', async () => {
    as('workflows:read', 'workflows:write');

    const result = await saveWorkflowDraft(null, formOf('save', '{ "steps": '));

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/definition',
    ]);
    expect(api.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });

  it('needs workflows:write', async () => {
    as('workflows:read');

    expect((await saveWorkflowDraft(null, formOf('check', text))).ok).toBe(false);
    expect(api.all('POST', `${DRAFT}/validate`)).toHaveLength(0);
  });
});

describe('publishWorkflow (C116.4)', () => {
  const PUBLISH = `/workflows/${IDS.workflow}/publish`;
  const formOf = (values: Record<string, string>, acknowledgements: string[] = []) => {
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    for (const [name, value] of Object.entries(values)) {
      data.set(name, value);
    }
    for (const key of acknowledgements) {
      data.append('acknowledgement', key);
    }
    return data;
  };

  it('publishes with the rollout, the change note and each ticked acknowledgement', async () => {
    as('workflows:read', 'workflows:publish');
    api.on('POST', PUBLISH, 200, { data: workflowVersion() });

    const result = await publishWorkflow(
      null,
      formOf({ 'rollout-percentage': '25', description: 'Synthetic change' }, [
        'egress:send_slack',
      ]),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', PUBLISH)?.body).toEqual({
      meta: {
        'rollout-percentage': 25,
        description: 'Synthetic change',
        acknowledgements: ['egress:send_slack'],
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/workflows/${IDS.workflow}`);
  });

  it('sends no rollout or note left empty, so the API applies its own default', async () => {
    as('workflows:read', 'workflows:publish');
    api.on('POST', PUBLISH, 200, { data: workflowVersion() });

    await publishWorkflow(null, formOf({ 'rollout-percentage': '', description: '' }));

    expect(api.find('POST', PUBLISH)?.body).toEqual({ meta: {} });
  });

  it('passes on which acknowledgements the publish still needs, by key', async () => {
    as('workflows:read', 'workflows:publish');
    api.onProblem('POST', PUBLISH, 422, undefined, {
      code: 'publish_acknowledgement_missing',
      detail: 'A step needs an acknowledgement this publish does not carry.',
      errors: [
        { location: 'body', pointer: '/meta/acknowledgements', detail: 'egress:send_slack' },
      ],
    });

    const result = await publishWorkflow(null, formOf({}));

    expect(result).toMatchObject({
      ok: false,
      problem: {
        code: 'publish_acknowledgement_missing',
        errors: [{ pointer: '/meta/acknowledgements', detail: 'egress:send_slack' }],
      },
    });
  });

  it('refuses a rollout outside 1 to 100 and an acknowledgement that is not a kind and a step', async () => {
    as('workflows:read', 'workflows:publish');

    const result = await publishWorkflow(
      null,
      formOf({ 'rollout-percentage': '150' }, ['anything:send_slack']),
    );

    expect(result.ok).toBe(false);
    expect(api.all('POST', PUBLISH)).toHaveLength(0);
  });

  it('needs workflows:publish', async () => {
    as('workflows:read', 'workflows:write');

    expect((await publishWorkflow(null, formOf({}))).ok).toBe(false);
    expect(api.all('POST', PUBLISH)).toHaveLength(0);
  });
});

describe('changeRollout (C116.3)', () => {
  it.each([
    ['100', 100],
    ['0', 0],
  ])('sends %s and refreshes the workflow page', async (value, percentage) => {
    as('workflows:read', 'workflows:publish');
    api.on('POST', `/workflows/${IDS.workflow}/rollout`, 200, { data: workflowVersion() });
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('rollout-percentage', value);

    expect(await changeRollout(null, data)).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `/workflows/${IDS.workflow}/rollout`)?.body).toEqual({
      meta: { 'rollout-percentage': percentage },
    });
  });

  it('refuses any other step, without calling the API', async () => {
    as('workflows:read', 'workflows:publish');
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('rollout-percentage', '50');

    expect((await changeRollout(null, data)).ok).toBe(false);
    expect(api.all('POST', `/workflows/${IDS.workflow}/rollout`)).toHaveLength(0);
  });
});

describe('restoreVersion (C116.5)', () => {
  it('makes a draft from the version and answers the workflow to open', async () => {
    as('workflows:read', 'workflows:publish');
    api.on('POST', `/workflows/${IDS.workflow}/restore`, 201, { data: workflowDraft() });
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('version-id', IDS.previousVersion);

    expect(await restoreVersion(null, data)).toEqual({
      ok: true,
      data: { workflowId: IDS.workflow },
    });
    expect(api.find('POST', `/workflows/${IDS.workflow}/restore`)?.body).toEqual({
      meta: { 'version-id': IDS.previousVersion },
    });
  });

  it('needs workflows:publish', async () => {
    as('workflows:read', 'workflows:write');
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('version-id', IDS.previousVersion);

    expect((await restoreVersion(null, data)).ok).toBe(false);
    expect(api.all('POST', `/workflows/${IDS.workflow}/restore`)).toHaveLength(0);
  });
});

describe('promoteWorkflow (C112.2)', () => {
  const PRODUCTION = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y52';
  const promoteForm = (environmentId: string) => {
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('environment-id', environmentId);
    return data;
  };

  it('copies the live version into the target environment as a draft, under workflows:publish', async () => {
    as('workflows:read', 'workflows:publish');
    api.on('POST', `/workflows/${IDS.workflow}/promote`, 201, { data: workflowDraft() });

    expect(await promoteWorkflow(null, promoteForm(PRODUCTION))).toEqual({
      ok: true,
      data: { environmentId: PRODUCTION },
    });
    expect(api.find('POST', `/workflows/${IDS.workflow}/promote`)?.body).toEqual({
      meta: { 'environment-id': PRODUCTION },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/workflows/${IDS.workflow}`);
  });

  it('passes on the refusal of a target that already has a draft (never a replace)', async () => {
    as('workflows:read', 'workflows:publish');
    api.onProblem('POST', `/workflows/${IDS.workflow}/promote`, 409);

    const result = await promoteWorkflow(null, promoteForm(PRODUCTION));

    expect(result.ok).toBe(false);
  });

  it('refuses a malformed environment, and needs workflows:publish, without calling the API', async () => {
    as('workflows:read', 'workflows:publish');
    expect((await promoteWorkflow(null, promoteForm('production'))).ok).toBe(false);
    as('workflows:read', 'workflows:write');
    expect((await promoteWorkflow(null, promoteForm(PRODUCTION))).ok).toBe(false);
    expect(api.all('POST', `/workflows/${IDS.workflow}/promote`)).toHaveLength(0);
  });
});

describe('cancelOlderRuns (C116.2)', () => {
  const cancelForm = (versionId: string) => {
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('before-version-id', versionId);
    return data;
  };

  it('cancels the unfinished runs of versions older than the one named, answering the count', async () => {
    as('workflows:read', 'workflow-runs:write');
    api.on('POST', `/workflows/${IDS.workflow}/cancel-runs`, 200, {
      meta: { 'canceled-count': 4 },
    });

    expect(await cancelOlderRuns(null, cancelForm(IDS.version))).toEqual({
      ok: true,
      data: { canceledCount: 4 },
    });
    expect(api.find('POST', `/workflows/${IDS.workflow}/cancel-runs`)?.body).toEqual({
      meta: { 'before-version-id': IDS.version },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/workflows/${IDS.workflow}`);
  });

  it('refuses a malformed version, and needs workflow-runs:write, without calling the API', async () => {
    as('workflows:read', 'workflow-runs:write');
    expect((await cancelOlderRuns(null, cancelForm('wfr_01MB0000000000000000000001'))).ok).toBe(
      false,
    );
    as('workflows:read', 'workflows:write');
    expect((await cancelOlderRuns(null, cancelForm(IDS.version))).ok).toBe(false);
    expect(api.all('POST', `/workflows/${IDS.workflow}/cancel-runs`)).toHaveLength(0);
  });
});

describe('startTestRun (C120.7)', () => {
  const TEST_RUN = 'wfr_01MB0000000000000000000007';
  const PATH = `/workflows/${IDS.workflow}/test-runs`;
  const testForm = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    for (const [name, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        data.append(name, item);
      }
    }
    return data;
  };

  it('starts a test run on an object with its step range, overrides, hosts and acknowledgements', async () => {
    as('workflows:read', 'workflows:trigger');
    api.on('POST', PATH, 201, { data: workflowRun({}, TEST_RUN) });

    const result = await startTestRun(
      null,
      testForm({
        'version-id': IDS.version,
        'trigger-source': 'object',
        'object-id': IDS.inquiry,
        'trigger-payload': '{"ignored": true}',
        'start-step': 'score',
        'end-step': 'send_slack',
        overrides: '{"score": {"value": 3}}',
        'allow-hosts': 'hooks.example.com\n\nreceiver.example.com',
        acknowledgement: ['irreversible:decline', 'egress:send_slack'],
        'allow-triggers': 'true',
      }),
    );

    expect(result).toEqual({ ok: true, data: { runId: TEST_RUN } });
    expect(api.find('POST', PATH)?.body).toEqual({
      data: {
        type: 'workflow-run',
        attributes: {
          'workflow-version-id': IDS.version,
          'object-id': IDS.inquiry,
          'start-step': 'score',
          'end-step': 'send_slack',
          overrides: { score: { value: 3 } },
          'allow-hosts': ['hooks.example.com', 'receiver.example.com'],
          'allow-triggers': true,
        },
      },
      meta: { acknowledgements: ['irreversible:decline', 'egress:send_slack'] },
    });
  });

  it('starts one on the draft from a synthetic payload, sending nothing left empty', async () => {
    as('workflows:read', 'workflows:trigger');
    api.on('POST', PATH, 201, { data: workflowRun({}, TEST_RUN) });

    await startTestRun(
      null,
      testForm({
        'version-id': '',
        'trigger-source': 'payload',
        'object-id': IDS.inquiry,
        'trigger-payload': '{"status": "completed"}',
        'start-step': '',
        'end-step': '',
        overrides: '',
        'allow-hosts': '',
      }),
    );

    expect(api.find('POST', PATH)?.body).toEqual({
      data: { type: 'workflow-run', attributes: { 'trigger-payload': { status: 'completed' } } },
    });
  });

  it('refuses a payload or overrides that are not JSON at their pointers, without calling the API', async () => {
    as('workflows:read', 'workflows:trigger');

    const result = await startTestRun(
      null,
      testForm({ 'trigger-source': 'payload', 'trigger-payload': '{', overrides: '[' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/trigger-payload',
      '/data/attributes/overrides',
    ]);
    expect(api.all('POST', PATH)).toHaveLength(0);
  });

  it('says in words that a production environment runs no test run', async () => {
    as('workflows:read', 'workflows:trigger');
    api.onProblem('POST', PATH, 403, undefined, {
      code: 'test_runs_sandbox_only',
      title: 'Test runs are sandbox only',
    });

    const result = await startTestRun(
      null,
      testForm({ 'trigger-source': 'object', 'object-id': IDS.inquiry }),
    );

    expect(result.ok ? null : result.problem.title).toBe(
      'Test runs run only in a sandbox environment',
    );
  });

  it('needs workflows:trigger', async () => {
    as('workflows:read');

    const result = await startTestRun(
      null,
      testForm({ 'trigger-source': 'object', 'object-id': IDS.inquiry }),
    );

    expect(result.ok).toBe(false);
    expect(api.all('POST', PATH)).toHaveLength(0);
  });
});

describe('searchRecordedMessages (C126.4)', () => {
  const TEST_RUN = 'wfr_01MB0000000000000000000007';
  const searchForm = (kind: string, recipient: string) => {
    const data = new FormData();
    data.set('run-id', TEST_RUN);
    data.set('kind', kind);
    data.set('recipient', recipient);
    return data;
  };
  const record = (runId: string, text: string) => ({
    'message-ref': `ref-${runId}`,
    'workflow-run-id': runId,
    'step-id': 'send_email',
    'recorded-at': '2026-11-01T09:05:00.000Z',
    'message-subject': 'Synthetic subject',
    'message-text': text,
    'message-html': null,
  });

  it('searches by the recipient in the body and answers only this run’s records, bodies with pii:view', async () => {
    as('sandbox:read', 'pii:view');
    api.on('POST', '/sandbox/email-messages/search', 200, {
      data: [record(TEST_RUN, 'Synthetic body'), record(IDS.otherRun, 'Another body')],
    });

    const result = await searchRecordedMessages(null, searchForm('email', 'person@example.com'));

    expect(api.find('POST', '/sandbox/email-messages/search')?.body).toEqual({
      'email-address': 'person@example.com',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        records: [
          {
            messageRef: `ref-${TEST_RUN}`,
            stepId: 'send_email',
            recordedAt: '2026-11-01T09:05:00.000Z',
            subject: 'Synthetic subject',
            text: 'Synthetic body',
          },
        ],
      },
    });
  });

  it('withholds every body without pii:view, keeping the origin', async () => {
    as('sandbox:read');
    api.on('POST', '/sandbox/workflow-sms-messages/search', 200, {
      data: [
        {
          'message-ref': 'ref-sms',
          'workflow-run-id': TEST_RUN,
          'step-id': 'send_sms',
          'recorded-at': '2026-11-01T09:05:00.000Z',
          'message-text': 'Synthetic body',
        },
      ],
    });

    const result = await searchRecordedMessages(null, searchForm('workflow-sms', '+15555550100'));

    expect(api.find('POST', '/sandbox/workflow-sms-messages/search')?.body).toEqual({
      'phone-number': '+15555550100',
    });
    expect(JSON.stringify(result)).not.toContain('Synthetic body');
    expect(result.ok ? result.data.records[0] : null).toMatchObject({
      stepId: 'send_sms',
      subject: null,
      text: null,
    });
  });

  it('searches Slack records by the secret id, and refuses a malformed one without calling the API', async () => {
    as('sandbox:read', 'pii:view');
    api.on('POST', '/sandbox/slack-messages/search', 200, { data: [] });

    await searchRecordedMessages(null, searchForm('slack', IDS.secret));
    expect(api.find('POST', '/sandbox/slack-messages/search')?.body).toEqual({
      'secret-id': IDS.secret,
    });
    expect((await searchRecordedMessages(null, searchForm('slack', 'hooks'))).ok).toBe(false);
    expect(api.all('POST', '/sandbox/slack-messages/search')).toHaveLength(1);
  });

  it('needs sandbox:read', async () => {
    as('workflows:read', 'pii:view');

    expect((await searchRecordedMessages(null, searchForm('email', 'a@example.com'))).ok).toBe(
      false,
    );
    expect(api.all('POST', '/sandbox/email-messages/search')).toHaveLength(0);
  });
});

describe('startManualRuns (C118.5)', () => {
  const PATH = `/workflows/${IDS.workflow}/manual-runs`;
  const OTHER = 'inq_01MB0000000000000000000009';
  const idsForm = (text: string) => {
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('source', 'ids');
    data.set('object-ids', text);
    return data;
  };

  it('starts one run per id, read from lines, spaces or commas, and answers runs and refusals', async () => {
    as('workflows:read', 'workflows:trigger');
    api.on('POST', PATH, 200, {
      meta: {
        'workflow-run-ids': [IDS.run],
        refused: [{ 'object-id': OTHER, row: null, code: 'object_not_found' }],
      },
    });

    const result = await startManualRuns(null, idsForm(`${IDS.inquiry},\n ${OTHER}\n`));

    expect(api.find('POST', PATH)?.body).toEqual({
      data: { type: 'workflow-run', attributes: { 'object-ids': [IDS.inquiry, OTHER] } },
    });
    expect(result).toEqual({
      ok: true,
      data: {
        runIds: [IDS.run],
        refused: [{ objectId: OTHER, row: null, code: 'object_not_found' }],
      },
    });
  });

  it('sends a CSV file as text', async () => {
    as('workflows:read', 'workflows:trigger');
    api.on('POST', PATH, 200, { meta: { 'workflow-run-ids': [], refused: [] } });
    const data = new FormData();
    data.set('workflow-id', IDS.workflow);
    data.set('source', 'csv');
    data.set('csv', new File([`object-id\n${IDS.inquiry}\n`], 'ids.csv', { type: 'text/csv' }));

    await startManualRuns(null, data);

    expect(api.find('POST', PATH)?.body).toEqual({
      data: { type: 'workflow-run', attributes: { csv: `object-id\n${IDS.inquiry}\n` } },
    });
  });

  it('refuses a token that is not an id by its position, never echoing it, without calling the API', async () => {
    as('workflows:read', 'workflows:trigger');

    const result = await startManualRuns(null, idsForm(`${IDS.inquiry} jane.doe@example.com`));

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('jane.doe');
    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/object-ids/1',
    ]);
    expect(api.all('POST', PATH)).toHaveLength(0);
  });

  it('refuses an empty list and needs workflows:trigger', async () => {
    as('workflows:read', 'workflows:trigger');
    expect((await startManualRuns(null, idsForm('  '))).ok).toBe(false);
    as('workflows:read');
    expect((await startManualRuns(null, idsForm(IDS.inquiry))).ok).toBe(false);
    expect(api.all('POST', PATH)).toHaveLength(0);
  });
});

describe('createWorkflow from a decision template (C128.5)', () => {
  const templateForm = (values: Record<string, string>) => {
    const data = new FormData();
    data.set('environment-id', ENV);
    data.set('name', 'Synthetic review');
    data.set('description', '');
    for (const [name, value] of Object.entries(values)) {
      data.set(name, value);
    }
    return data;
  };

  it('saves the template as the new workflow’s draft, with the basis and route given, and never publishes', async () => {
    as('workflows:read', 'workflows:write');
    api.on('POST', '/workflows', 201, {
      data: workflow({ status: 'paused', 'paused-reason': 'operator' }),
    });
    api.on('GET', `/workflows/${IDS.workflow}/draft`, 200, {
      data: workflowDraft({ 'lock-version': 1, definition: null }),
    });
    api.on('PUT', `/workflows/${IDS.workflow}/draft`, 200, { data: workflowDraft() });

    const result = await createWorkflow(
      null,
      templateForm({
        template: 'review-completed-inquiry',
        'case-template-id': IDS.caseTemplate,
        'decision-basis': 'contract',
        'contest-url': 'https://help.example.com/contest',
        'contest-contact': '',
        'biometric-basis': '',
      }),
    );

    expect(result).toEqual({ ok: true, data: { workflowId: IDS.workflow } });
    const body = api.find('PUT', `/workflows/${IDS.workflow}/draft`)?.body as {
      data: { attributes: { definition: { steps: { id: string; config?: unknown }[] } } };
      meta?: unknown;
    };
    expect(JSON.stringify(body)).toContain('"lock-version":1');
    const decline = body.data.attributes.definition.steps.find((step) => step.id === 'decline');
    expect(decline?.config).toEqual({
      'inquiry-id': '{{ trigger.id }}',
      'decision-basis': 'contract',
      'contest-route': { url: 'https://help.example.com/contest' },
    });
    expect(api.all('POST', `/workflows/${IDS.workflow}/publish`)).toHaveLength(0);
  });

  it('refuses an unknown template, basis or a contest URL that is not https, without creating anything', async () => {
    as('workflows:read', 'workflows:write');

    const result = await createWorkflow(
      null,
      templateForm({
        template: 'review-completed-inquiry',
        'decision-basis': 'because',
        'contest-url': 'http://help.example.com',
      }),
    );

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/decision-basis',
      '/contest-route/url',
    ]);
    expect(api.all('POST', '/workflows')).toHaveLength(0);
  });
});
