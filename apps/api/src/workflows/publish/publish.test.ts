/**
 * Workflow 8A Stage 3 (`api-workflows`; C112.2, C116, C118.1, C119.3, C121): publishing, rollout,
 * restore and promote through the routes, on real rows. Each refusal leaves the draft as it was.
 * Every value is synthetic.
 */
import { PERMISSIONS, type Permission } from '@openverify/core';
import {
  createEnvironment,
  createRole,
  createUser,
  getWorkflow,
  getWorkflowVersion,
  listEventWorkflowTriggers,
  listWorkflowsNamed,
  replaceWorkflowTriggers,
  scheduledRuns,
  setUserRoles,
  workflowSchedules,
  workflowWaitIndex,
  type Environment,
} from '@openverify/db';
import {
  seedList,
  seedScheduledRun,
  seedWorkflow,
  seedWorkflowVersion,
  testId,
} from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { AppError } from '../../errors.js';
import type { UserPrincipal } from '../../ports.js';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import type { WorkflowActing } from '../acting.js';
import { seedWorkflowSecret, seedWorkflowSecretValue } from '@openverify/db/testing';
import { promoteWorkflow } from './promote.js';
import { action, chain, decline, INQUIRY } from './testing.js';

let api: TestApi;
let admin: string;

beforeAll(async () => {
  api = await createTestApi();
  admin = api.newUserToken(api.environmentId);
});

afterAll(async () => {
  await api.close();
});

type Method = 'GET' | 'POST' | 'PUT';

const call = (method: Method, url: string, payload?: unknown, token = admin) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: { id: string } | null }>;
}

async function ok(pending: ReturnType<typeof call>, status = 200): Promise<Resource> {
  const response = await pending;
  expect(response.statusCode, response.body).toBe(status);
  return response.json<{ data: Resource }>().data;
}

const tag = (id = 'mark', value = 'checked') =>
  action(id, 'tag_object', { 'object-type': 'inquiry', 'object-id': INQUIRY, tag: value });

async function drafted(
  definition: unknown = chain([tag()]),
  token = admin,
  attributes: object = {},
): Promise<string> {
  const created = await ok(
    call(
      'POST',
      '/workflows',
      { data: { type: 'workflow', attributes: { name: 'Synthetic', ...attributes } } },
      token,
    ),
    201,
  );
  await ok(
    call(
      'PUT',
      `/workflows/${created.id}/draft`,
      { data: { type: 'workflow-version', attributes: { definition, 'lock-version': 1 } } },
      token,
    ),
  );
  return created.id;
}

const publish = (id: string, meta?: object, token = admin) =>
  call('POST', `/workflows/${id}/publish`, meta === undefined ? undefined : { meta }, token);

const workflowOf = async (id: string, token = admin) =>
  ok(call('GET', `/workflows/${id}`, undefined, token));

const problemOf = (response: Awaited<ReturnType<typeof call>>) =>
  response.json<{
    code: string;
    errors: { location: string; pointer: string; code?: string; detail: string }[];
    'missing-scopes'?: string[];
  }>();

interface EventOf {
  payload: { data: { id: string; attributes: Record<string, unknown> } };
}

const eventsNamed = (name: string) =>
  api.events.events.filter((event) => event.name === name) as unknown as EventOf[];

describe('publish (C116.1, C116.4)', () => {
  it('freezes the draft with its hash and grant, and makes it live', async () => {
    const id = await drafted();
    const version = await ok(publish(id, { description: 'First.' }));
    expect(version.attributes).toMatchObject({
      status: 'published',
      live: true,
      'rollout-label': null,
      'rollout-percentage': null,
      description: 'First.',
      grant: { scopes: ['inquiries:write'], pii: false },
    });
    expect(version.attributes['definition-sha256']).toMatch(/^[0-9a-f]{64}$/);
    const workflow = await workflowOf(id);
    expect(workflow.relationships['latest-published-version']?.data?.id).toBe(version.id);
    expect(workflow.relationships['draft-version']?.data).toBeNull();
    expect(workflow.attributes.status).toBe('paused');
    const draft = await call('GET', `/workflows/${id}/draft`);
    expect(draft.statusCode).toBe(409);
    expect(problemOf(draft).code).toBe('draft_missing');
  });

  it('publishes a step that names a secret of this environment (C125.3)', async () => {
    const organizationId = api.organizationId;
    const secret = await seedWorkflowSecret(api.database.db, organizationId, {
      key: 'published_token',
      allowedHosts: ['api.example.com'],
    });
    await seedWorkflowSecretValue(api.database.db, {
      organizationId,
      secretId: secret.id,
      environmentId: api.environmentId,
      value: 'change-me-synthetic-secret-value-canary',
    });
    const request = action('call', 'make_https_request', {
      method: 'GET',
      url: 'https://API.example.com/ping',
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.published_token}}' }],
    });

    await ok(publish(await drafted(chain([request]))));
  });

  it('rebuilds the trigger index, the wait index and both events in its transaction', async () => {
    const wait = {
      id: 'hold',
      type: 'wait',
      name: 'hold',
      mode: 'events',
      subject: 'trigger.id',
      events: ['inquiry.approved'],
      'timeout-seconds': 60,
      'on-timeout': 'continue',
    };
    const id = await drafted(chain([wait]));
    const version = await ok(publish(id));
    const rows = await listEventWorkflowTriggers(
      api.database.db,
      api.environmentId,
      'inquiry.completed',
    );
    expect(rows.filter((row) => row.workflowId === id)).toEqual([
      expect.objectContaining({ workflowVersionId: version.id, workflowDeploymentId: null }),
    ]);
    const waits = await api.database.db
      .select()
      .from(workflowWaitIndex)
      .where(eq(workflowWaitIndex.workflowVersionId, version.id));
    expect(waits.map(({ eventName }) => eventName)).toEqual(['inquiry.approved']);
    expect(
      eventsNamed('workflow.published').filter(({ payload }) => payload.data.id === id),
    ).toHaveLength(1);
    const [published] = eventsNamed('workflow-version.published').filter(
      ({ payload }) => payload.data.id === version.id,
    );
    expect(published?.payload.data.attributes.definition).toBeNull();
    const entry = api.audit.entries.find(
      ({ action: name, resourceId }) =>
        name === 'workflow-version.published' && resourceId === version.id,
    );
    expect(entry?.metadata).toMatchObject({ 'rollout-percentage': 100, 'workflow-id': id });
  });

  it('archives the version it replaces, and keeps listing what stays', async () => {
    const id = await drafted();
    const first = await ok(publish(id));
    await ok(
      call('PUT', `/workflows/${id}/draft`, {
        data: {
          type: 'workflow-version',
          attributes: { definition: chain([tag('mark', 'second')]), 'lock-version': 0 },
        },
      }),
    );
    const second = await ok(publish(id));
    const replaced = await ok(call('GET', `/workflow-versions/${first.id}`));
    expect(replaced.attributes).toMatchObject({ status: 'archived', live: false });
    const list = await call('GET', `/workflow-versions?filter[workflow-id]=${id}`);
    expect(list.json<{ data: Resource[] }>().data.map(({ id: row }) => row)).toEqual([second.id]);
    expect(second.attributes['version-number']).toBe(2);
  });

  it('answers 409 draft_missing with no draft', async () => {
    const id = await drafted();
    await ok(publish(id));
    const response = await publish(id);
    expect(response.statusCode).toBe(409);
    expect(problemOf(response).code).toBe('draft_missing');
  });

  it('refuses an API key (C121.2)', async () => {
    const id = await drafted();
    expect((await publish(id, undefined, api.token)).statusCode).toBe(403);
  });

  it('refuses a definition by its pointers, under the publish mode', async () => {
    const id = await drafted();
    await ok(
      call('PUT', `/workflows/${id}/draft`, {
        data: {
          type: 'workflow-version',
          attributes: {
            definition: chain([
              action('mark', 'tag_object', {
                'object-type': 'inquiry',
                'object-id': INQUIRY,
                tag: '{{ trigger.fields.name }}',
              }),
            ]),
            'lock-version': 2,
          },
        },
      }),
    );
    const response = await publish(id);
    expect(response.statusCode).toBe(422);
    const problem = problemOf(response);
    expect(problem.code).toBe('definition_invalid');
    expect(problem.errors[0]).toMatchObject({
      location: 'definition',
      code: 'pii_into_plain_sink',
    });
    expect(JSON.stringify(problem)).not.toContain('trigger.fields.name');
  });

  it('asks the publisher for the grant, naming what is missing (C121.2)', async () => {
    const id = await drafted();
    const weak = api.newUserToken(api.environmentId, {
      permissions: ['workflows:publish', 'workflows:read', 'workflows:write'] as Permission[],
    });
    const response = await publish(id, undefined, weak);
    expect(response.statusCode).toBe(403);
    expect(problemOf(response)).toMatchObject({
      code: 'publish_grant_missing',
      'missing-scopes': ['inquiries:write'],
    });
    expect((await call('GET', `/workflows/${id}/draft`)).statusCode).toBe(200);
  });

  it('asks for pii:view when the grant reads PII', async () => {
    const { id: listId } = await seedList(api.database.db, api.environmentId, {
      kind: 'email-address',
    });
    const match = action('match', 'get_list_match', {
      'list-ids': [listId],
      probe: { kind: 'email-address', value: 'alerts@example.com' },
    });
    const id = await drafted(chain([match]));
    const weak = api.newUserToken(api.environmentId, {
      permissions: ['workflows:publish', 'workflows:read', 'lists:read'] as Permission[],
    });
    const response = await publish(id, undefined, weak);
    expect(problemOf(response)['missing-scopes']).toEqual(['pii:view']);
  });

  it('stores each acknowledgement it needed, with who and when (C116.4)', async () => {
    const redact = action('wipe', 'redact_object', {
      'object-type': 'report',
      'object-id': INQUIRY,
    });
    const id = await drafted(chain([redact]));
    const refused = await publish(id);
    expect(refused.statusCode).toBe(422);
    expect(problemOf(refused)).toMatchObject({
      code: 'publish_acknowledgement_missing',
      errors: [
        { location: 'body', pointer: '/meta/acknowledgements', detail: 'irreversible:wipe' },
      ],
    });
    const version = await ok(
      publish(id, { acknowledgements: ['irreversible:wipe', 'egress:wipe'] }),
    );
    expect(version.attributes.acknowledgements).toEqual([
      {
        key: 'irreversible:wipe',
        'acknowledged-by': expect.stringMatching(/^usr_/) as string,
        'acknowledged-at': expect.any(String) as string,
      },
    ]);
    const entry = api.audit.entries.find(
      ({ action: name, resourceId }) =>
        name === 'workflow-version.published' && resourceId === version.id,
    );
    expect(entry?.metadata?.acknowledgements).toEqual(['irreversible:wipe']);
  });

  it('warns in a sandbox and keeps the warnings on the version (C128.3)', async () => {
    const id = await drafted(chain([decline('no')]));
    const version = await ok(publish(id));
    const warnings = version.attributes.warnings as { code: string }[];
    expect(warnings.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['decision_basis_missing', 'contest_route_missing']),
    );
  });

  it('refuses a secret reference that resolves to nothing (C125.3)', async () => {
    const request = action('call', 'make_https_request', {
      method: 'GET',
      url: 'https://api.example.com/v1/check',
      headers: [{ name: 'Authorization', value: 'Bearer {{secrets.partner_token}}' }],
    });
    const id = await drafted(chain([request]));
    const response = await publish(id);
    expect(response.statusCode).toBe(422);
    expect(problemOf(response)).toMatchObject({ code: 'secret_reference_invalid' });
  });

  it('refuses an event already listened to by 50 published workflows (H18)', async () => {
    const tenant = await api.newTenant();
    const token = api.newUserToken(tenant.environmentId);
    const definition = chain([], {
      trigger: { type: 'trigger-event', config: { events: ['account.created'] } },
    });
    const { db } = api.database;
    for (let index = 0; index < 50; index += 1) {
      const { id: workflowId } = await seedWorkflow(db, tenant.environmentId);
      const { id: workflowVersionId } = await seedWorkflowVersion(db, tenant.environmentId, {
        workflowId,
      });
      await replaceWorkflowTriggers(db, tenant.environmentId, workflowId, [
        { kind: 'trigger-event', eventName: 'account.created', workflowVersionId },
      ]);
    }
    const response = await publish(await drafted(definition, token), undefined, token);
    expect(response.statusCode).toBe(422);
    expect(problemOf(response)).toMatchObject({
      code: 'publish_trigger_fanout_exceeded',
      errors: [{ pointer: '/trigger/config/events/0' }],
    });
  });

  it("writes a recurring trigger's schedule, and removes it with the next version", async () => {
    const recurring = {
      type: 'trigger-recurring',
      config: { cron: '0 13 * * *', 'time-zone': 'Europe/London', 'object-type': 'account' },
    };
    const start = chain([], { trigger: recurring });
    const id = await drafted(start);
    await ok(publish(id));
    const schedules = () =>
      api.database.db.select().from(workflowSchedules).where(eq(workflowSchedules.workflowId, id));
    expect(await schedules()).toEqual([
      expect.objectContaining({ cron: '0 13 * * *', objectType: 'account', batchCap: 100 }),
    ]);
    await ok(
      call('PUT', `/workflows/${id}/draft`, {
        data: {
          type: 'workflow-version',
          attributes: {
            definition: chain([], { trigger: { type: 'trigger-api', config: {} } }),
            'lock-version': 0,
          },
        },
      }),
    );
    await ok(publish(id));
    expect(await schedules()).toEqual([]);
  });

  it('adds what a module and a child workflow need to the grant (C121.3)', async () => {
    const child = await drafted(
      chain([action('wipe', 'redact_object', { 'object-type': 'report', 'object-id': INQUIRY })]),
    );
    const childVersion = await ok(publish(child, { acknowledgements: ['irreversible:wipe'] }));
    const start = action('child', 'run_workflow', {
      'workflow-id': child,
      version: 'latest-published',
    });
    const parent = await drafted(chain([start]));
    const version = await ok(publish(parent));
    expect(version.attributes.grant).toEqual({
      scopes: expect.arrayContaining(['workflows:trigger', 'reports:redact']) as string[],
      pii: false,
    });
    expect(childVersion.attributes.grant).toEqual({ scopes: ['reports:redact'], pii: false });
  });

  it('refuses a reference this environment does not hold (C121.6)', async () => {
    const add = action('add', 'add_list_item', {
      'list-id': 'lst_01M5CK3190XEVBM5ZXA76E1JSP',
      item: { kind: 'string', value: INQUIRY },
    });
    const id = await drafted(chain([add]));
    const response = await publish(id);
    expect(problemOf(response)).toMatchObject({
      code: 'definition_invalid',
      errors: [{ code: 'reference_unknown', pointer: '/steps/0/config/list-id' }],
    });
  });
});

describe('pause, activate and archive (C112.6, C116.1, C118.3)', () => {
  const lifecycle = (id: string, action_: 'pause' | 'activate' | 'archive') =>
    call('POST', `/workflows/${id}/${action_}`);

  it('activates a published workflow, and pauses it with an event, each once', async () => {
    const id = await drafted();
    await ok(publish(id));
    const running = await ok(lifecycle(id, 'activate'));
    expect(running.attributes).toMatchObject({ status: 'running', 'paused-reason': null });
    await ok(lifecycle(id, 'activate'));
    expect(
      api.audit.entries.filter(
        ({ action: name, resourceId }) => name === 'workflow.activated' && resourceId === id,
      ),
    ).toHaveLength(1);
    const paused = await ok(lifecycle(id, 'pause'));
    expect(paused.attributes).toMatchObject({ status: 'paused', 'paused-reason': 'operator' });
    await ok(lifecycle(id, 'pause'));
    expect(
      eventsNamed('workflow.paused').filter(({ payload }) => payload.data.id === id),
    ).toHaveLength(1);
  });

  it('refuses to archive a running workflow', async () => {
    const id = await drafted();
    await ok(publish(id));
    await ok(lifecycle(id, 'activate'));
    expect((await lifecycle(id, 'archive')).statusCode).toBe(409);
  });

  it('archives what can start a run, and leaves nothing live (C116.1, C118.3)', async () => {
    const id = await drafted();
    const control = await ok(publish(id));
    await ok(
      call('PUT', `/workflows/${id}/draft`, {
        data: {
          type: 'workflow-version',
          attributes: { definition: chain([tag('mark', 'next')]), 'lock-version': 0 },
        },
      }),
    );
    const treatment = await ok(publish(id, { 'rollout-percentage': 10 }));
    const { db } = api.database;
    const { id: scheduled } = await seedScheduledRun(db, api.environmentId, {
      targetWorkflowId: id,
    });
    await ok(lifecycle(id, 'archive'));
    const workflow = await workflowOf(id);
    expect(workflow.relationships['active-deployment']?.data).toBeNull();
    const rows = await listEventWorkflowTriggers(db, api.environmentId, 'inquiry.completed');
    expect(rows.filter((row) => row.workflowId === id)).toEqual([]);
    for (const version of [control, treatment]) {
      const row = await getWorkflowVersion(db, api.environmentId, version.id);
      expect(row?.status).toBe('archived');
    }
    const [run] = await db.select().from(scheduledRuns).where(eq(scheduledRuns.id, scheduled));
    expect(run?.status).toBe('canceled');
  });
});

describe('production (C116.4, C128.3)', () => {
  it('refuses a decline without a basis, and passes one with it', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const token = api.newUserToken(tenant.environmentId);
    const id = await drafted(chain([decline('no')]), token);
    const response = await publish(id, undefined, token);
    expect(response.statusCode).toBe(422);
    expect(problemOf(response).errors.map(({ code }) => code)).toEqual([
      'decision_basis_missing',
      'contest_route_missing',
      'biometric_basis_missing',
    ]);
    const filled = chain([
      decline('no', {
        'decision-basis': 'contract',
        'contest-route': { contact: 'Write to the review desk.' },
        'biometric-basis': 'explicit-consent',
      }),
    ]);
    const fixed = await drafted(filled, token);
    await ok(publish(fixed, undefined, token));
  });

  it('asks the publisher for production', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const token = api.newUserToken(tenant.environmentId);
    const id = await drafted(chain([tag()]), token);
    const weak = api.newUserToken(tenant.environmentId, {
      permissions: ['workflows:publish', 'inquiries:write'] as Permission[],
    });
    const response = await publish(id, undefined, weak);
    expect(problemOf(response)['missing-scopes']).toEqual(['environments:production']);
  });
});

describe('rollout (C116.3)', () => {
  async function rollingOut(percentage = 10) {
    const id = await drafted();
    const control = await ok(publish(id));
    await ok(
      call('PUT', `/workflows/${id}/draft`, {
        data: {
          type: 'workflow-version',
          attributes: { definition: chain([tag('mark', 'second')]), 'lock-version': 0 },
        },
      }),
    );
    const treatment = await ok(publish(id, { 'rollout-percentage': percentage }));
    return { id, control, treatment };
  }

  const roll = (id: string, percentage: number, token = admin) =>
    call('POST', `/workflows/${id}/rollout`, { meta: { 'rollout-percentage': percentage } }, token);

  it('splits two live versions by a deployment, and keeps the live pointer on control', async () => {
    const { id, control, treatment } = await rollingOut();
    expect(treatment.attributes).toMatchObject({
      live: true,
      'rollout-label': 'treatment',
      'rollout-percentage': 10,
    });
    const refreshed = await ok(call('GET', `/workflow-versions/${control.id}`));
    expect(refreshed.attributes).toMatchObject({
      status: 'published',
      live: true,
      'rollout-label': 'control',
      'rollout-percentage': 90,
    });
    const workflow = await ok(
      call('GET', `/workflows/${id}?include=latest-published-version,active-deployment`),
    );
    expect(workflow.relationships['latest-published-version']?.data?.id).toBe(control.id);
    const deployment = workflow.relationships['active-deployment']?.data?.id;
    expect(deployment).toMatch(/^wfd_/);
    const included = (await call('GET', `/workflows/${id}?include=active-deployment`)).json<{
      included: Resource[];
    }>().included;
    expect(included[0]?.attributes.configuration).toEqual({
      versions: [
        { token: treatment.id, percentage: 10, label: 'treatment' },
        { token: control.id, percentage: 90, label: 'control' },
      ],
    });
    const rows = await listEventWorkflowTriggers(
      api.database.db,
      api.environmentId,
      'inquiry.completed',
    );
    expect(rows.filter((row) => row.workflowId === id)).toEqual([
      expect.objectContaining({ workflowVersionId: null, workflowDeploymentId: deployment }),
    ]);
    expect(
      eventsNamed('workflow.published').filter(({ payload }) => payload.data.id === id),
    ).toHaveLength(1);
  });

  it('locks the draft while it runs', async () => {
    const { id } = await rollingOut();
    const saved = await call('PUT', `/workflows/${id}/draft`, {
      data: {
        type: 'workflow-version',
        attributes: { definition: chain([tag()]), 'lock-version': 0 },
      },
    });
    expect(saved.statusCode).toBe(409);
    expect(problemOf(saved).code).toBe('rollout_in_progress');
    expect(problemOf(await publish(id)).code).toBe('rollout_in_progress');
  });

  it('moves the percentages', async () => {
    const { id, treatment } = await rollingOut();
    const moved = await ok(roll(id, 40));
    expect(moved.attributes).toMatchObject({ 'rollout-percentage': 40 });
    expect(moved.id).toBe(treatment.id);
  });

  it('finishes at 100: the treatment serves everyone and the control is archived', async () => {
    const { id, control, treatment } = await rollingOut();
    const finished = await ok(roll(id, 100));
    expect(finished.attributes).toMatchObject({
      status: 'published',
      live: true,
      'rollout-label': null,
    });
    const workflow = await workflowOf(id);
    expect(workflow.relationships['latest-published-version']?.data?.id).toBe(treatment.id);
    expect(workflow.relationships['active-deployment']?.data).toBeNull();
    const old = await ok(call('GET', `/workflow-versions/${control.id}`));
    expect(old.attributes.status).toBe('archived');
    const rows = await listEventWorkflowTriggers(
      api.database.db,
      api.environmentId,
      'inquiry.completed',
    );
    expect(rows.filter((row) => row.workflowId === id)).toEqual([
      expect.objectContaining({ workflowVersionId: treatment.id, workflowDeploymentId: null }),
    ]);
    expect(
      eventsNamed('workflow.published').filter(({ payload }) => payload.data.id === id),
    ).toHaveLength(2);
  });

  it('undoes at 0: the control serves everyone and the treatment is archived', async () => {
    const { id, control, treatment } = await rollingOut();
    const undone = await ok(roll(id, 0));
    expect(undone.attributes).toMatchObject({ status: 'archived', live: false });
    const workflow = await workflowOf(id);
    expect(workflow.relationships['latest-published-version']?.data?.id).toBe(control.id);
    expect(workflow.relationships['active-deployment']?.data).toBeNull();
    const rows = await listEventWorkflowTriggers(
      api.database.db,
      api.environmentId,
      'inquiry.completed',
    );
    expect(rows.filter((row) => row.workflowId === id)).toEqual([
      expect.objectContaining({ workflowVersionId: control.id }),
    ]);
    expect(treatment.attributes.status).toBe('published');
  });

  it('refuses an API key, and answers 409 with no rollout', async () => {
    const { id } = await rollingOut();
    expect((await roll(id, 50, api.token)).statusCode).toBe(403);
    const other = await drafted();
    expect((await roll(other, 50)).statusCode).toBe(409);
  });

  it('refuses a user who could not publish what goes live', async () => {
    const { id } = await rollingOut();
    const weak = api.newUserToken(api.environmentId, {
      permissions: ['workflows:publish', 'workflows:read'] as Permission[],
    });
    const response = await roll(id, 100, weak);
    expect(problemOf(response).code).toBe('publish_grant_missing');
  });

  it('refuses a staged first publish, a staged module and a changed trigger', async () => {
    const first = await drafted();
    expect(problemOf(await publish(first, { 'rollout-percentage': 10 })).errors[0]?.code).toBe(
      'rollout_without_control',
    );

    const module = await ok(
      call('POST', '/workflows', {
        data: { type: 'workflow', attributes: { name: 'Shared', kind: 'module' } },
      }),
      201,
    );
    expect(problemOf(await publish(module.id, { 'rollout-percentage': 10 })).errors[0]?.code).toBe(
      'rollout_refused_for_module',
    );

    const id = await drafted();
    await ok(publish(id));
    await ok(
      call('PUT', `/workflows/${id}/draft`, {
        data: {
          type: 'workflow-version',
          attributes: {
            definition: chain([tag()], {
              trigger: { type: 'trigger-event', config: { events: ['inquiry.failed'] } },
            }),
            'lock-version': 0,
          },
        },
      }),
    );
    expect(problemOf(await publish(id, { 'rollout-percentage': 10 })).errors[0]?.code).toBe(
      'rollout_trigger_changed',
    );
  });
});

describe('restore (C116.5)', () => {
  it('makes a draft of an old version, which publishes like any draft', async () => {
    const id = await drafted();
    const first = await ok(publish(id));
    const draft = await ok(
      call('POST', `/workflows/${id}/restore`, { meta: { 'version-id': first.id } }),
      201,
    );
    expect(draft.attributes).toMatchObject({ status: 'draft', 'version-number': 2 });
    expect(draft.attributes.definition).toEqual(first.attributes.definition);
    expect((await workflowOf(id)).relationships['draft-version']?.data?.id).toBe(draft.id);
    await ok(publish(id));
  });

  it("answers 409 draft_exists with a draft, and 404 for another workflow's version", async () => {
    const id = await drafted();
    const first = await ok(publish(id));
    await ok(call('POST', `/workflows/${id}/restore`, { meta: { 'version-id': first.id } }), 201);
    const twice = await call('POST', `/workflows/${id}/restore`, {
      meta: { 'version-id': first.id },
    });
    expect(problemOf(twice).code).toBe('draft_exists');
    const other = await drafted();
    await ok(publish(other));
    const foreign = await call('POST', `/workflows/${other}/restore`, {
      meta: { 'version-id': first.id },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('refuses an API key', async () => {
    const id = await drafted();
    const first = await ok(publish(id));
    const response = await call(
      'POST',
      `/workflows/${id}/restore`,
      { meta: { 'version-id': first.id } },
      api.token,
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('promote (C112.2)', () => {
  let productionEnvironment: Environment | undefined;

  /** A user of `api`'s organisation, working in its sandbox, with a production beside it. */
  async function production(permissions?: readonly Permission[]) {
    productionEnvironment ??= await createEnvironment(api.database.db, {
      id: testId('env'),
      organizationId: api.organizationId,
      kind: 'production',
    });
    const target = productionEnvironment;
    // C167.2 (Workflow 9B, api-access): a promote reads the user's stored assignments for the
    // target, so the principal is a stored user holding its permissions organisation-wide.
    const userId = testId('usr');
    await createUser(api.database.db, {
      id: userId,
      organizationId: api.organizationId,
      email: `${userId.toLowerCase()}@example.test`,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
    });
    const role = await createRole(api.database.db, api.organizationId, {
      id: testId('role'),
      name: `Synthetic promoter ${testId('role')}`,
      permissions: [...(permissions ?? PERMISSIONS)],
    });
    await setUserRoles(api.database.db, api.organizationId, userId, [role.id]);
    const principal: UserPrincipal = {
      kind: 'user',
      userId,
      userSessionId: testId('uss'),
      organizationId: api.organizationId,
      environmentId: api.environmentId,
      environmentKind: 'sandbox',
      permissions: new Set(permissions ?? PERMISSIONS),
      mfaSatisfied: true,
    };
    const acting: WorkflowActing = {
      ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
      actor: { type: 'user', id: principal.userId },
      mask: UNMASKED,
      environmentKind: 'sandbox',
      principal,
    };
    const promote = (id: string) =>
      promoteWorkflow(api.deps, acting, id, { meta: { 'environment-id': target.id } });
    return { target, acting, promote };
  }

  const unique = (name: string) => `${name} ${testId('wfl')}`.slice(0, 60);

  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  };

  it('copies the latest published version as a draft, audited in both, never published', async () => {
    const { target, promote } = await production();
    const name = unique('Promoted');
    const source = await drafted(chain([tag()]), admin, { name });
    const version = await ok(publish(source));
    const { data } = await promote(source);
    expect(data.attributes).toMatchObject({
      status: 'draft',
      'promoted-from': version.id,
      live: false,
      grant: null,
      'version-number': 1,
    });
    const landed = await getWorkflowVersion(api.database.db, target.id, data.id);
    const workflow = await getWorkflow(api.database.db, target.id, landed?.workflowId ?? '');
    expect(workflow).toMatchObject({ name, status: 'paused', draftVersionId: data.id });
    const entries = api.audit.entries.filter(
      ({ action: name2, resourceId }) =>
        name2 === 'workflow-version.promoted' && resourceId === data.id,
    );
    expect(entries.map(({ environmentId }) => environmentId).sort()).toEqual(
      [api.environmentId, target.id].sort(),
    );
    expect(await getWorkflow(api.database.db, target.id, source)).toBeNull();
  });

  it('re-resolves each reference by name, in conditions too', async () => {
    const { target, promote } = await production();
    const listName = unique('Blocked');
    const { id: sourceList } = await seedList(api.database.db, api.environmentId, {
      name: listName,
      kind: 'email-address',
    });
    const { id: targetList } = await seedList(api.database.db, target.id, {
      name: listName,
      kind: 'email-address',
    });
    const add = action('add', 'add_list_item', {
      'list-id': sourceList,
      item: { kind: 'string', value: INQUIRY },
    });
    const source = await drafted(chain([add]), admin, { name: unique('Resolved') });
    await ok(publish(source));
    const { data } = await promote(source);
    expect(JSON.stringify(data.attributes.definition)).toContain(targetList);
    expect(JSON.stringify(data.attributes.definition)).not.toContain(sourceList);
  });

  it('refuses a reference with none or several matches, by pointer alone', async () => {
    const { target, promote } = await production();
    const missing = unique('Missing');
    const { id: list } = await seedList(api.database.db, api.environmentId, {
      name: missing,
      kind: 'email-address',
    });
    const add = action('add', 'add_list_item', {
      'list-id': list,
      item: { kind: 'string', value: INQUIRY },
    });
    const source = await drafted(chain([add]), admin, { name: unique('Refused') });
    await ok(publish(source));
    const refused = await refusal(promote(source));
    expect(refused).toMatchObject({ code: 'promote_unresolved' });
    expect(refused.errors).toEqual([
      expect.objectContaining({ pointer: '/steps/0/config/list-id', code: 'reference_unresolved' }),
    ]);
    expect(JSON.stringify(refused.errors)).not.toContain(missing);
    await seedList(api.database.db, target.id, { name: missing, kind: 'email-address' });
    await seedList(api.database.db, target.id, { name: missing, kind: 'email-address' });
    expect(await refusal(promote(source))).toMatchObject({ code: 'promote_unresolved' });
  });

  it('never replaces a draft, and lands in the workflow of that name', async () => {
    const { target, promote } = await production();
    const name = unique('Twice');
    const source = await drafted(chain([tag()]), admin, { name });
    await ok(publish(source));
    const first = await promote(source);
    expect(await refusal(promote(source))).toMatchObject({ code: 'draft_exists' });
    expect(await getWorkflowVersion(api.database.db, target.id, first.data.id)).not.toBeNull();
    expect((await listWorkflowsNamed(api.database.db, target.id, name, 'workflow')).length).toBe(1);
  });

  it('refuses during a rollout, and with nothing published', async () => {
    const { promote } = await production();
    const empty = await drafted(chain([tag()]), admin, { name: unique('Empty') });
    expect(await refusal(promote(empty))).toMatchObject({ code: 'draft_missing' });
    const id = await drafted(chain([tag()]), admin, { name: unique('Rolling') });
    await ok(publish(id));
    await ok(
      call('PUT', `/workflows/${id}/draft`, {
        data: {
          type: 'workflow-version',
          attributes: { definition: chain([tag('mark', 'next')]), 'lock-version': 0 },
        },
      }),
    );
    await ok(publish(id, { 'rollout-percentage': 10 }));
    expect(await refusal(promote(id))).toMatchObject({ code: 'rollout_in_progress' });
  });

  it('needs workflows:write and production, and a user', async () => {
    const { promote, acting } = await production(['workflows:publish', 'workflows:write']);
    const id = await drafted();
    await ok(publish(id));
    expect((await refusal(promote(id))).status).toBe(403);
    const key = await production();
    const refused = await refusal(
      promoteWorkflow(
        api.deps,
        {
          ...key.acting,
          principal: {
            kind: 'api-key',
            apiKeyId: testId('key'),
            organizationId: api.organizationId,
            environmentId: api.environmentId,
            environmentKind: 'sandbox',
            permissions: new Set(PERMISSIONS),
          },
        },
        id,
        { meta: { 'environment-id': key.target.id } },
      ),
    );
    expect(refused.status).toBe(403);
    expect(acting.principal.kind).toBe('user');
    expect(
      (
        await call(
          'POST',
          `/workflows/${id}/promote`,
          { meta: { 'environment-id': key.target.id } },
          api.token,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('answers 404 for an environment of another organisation, and 409 for its own', async () => {
    const { acting } = await production();
    const id = await drafted();
    await ok(publish(id));
    const other = await api.newTenant();
    const foreign = await refusal(
      promoteWorkflow(api.deps, acting, id, { meta: { 'environment-id': other.environmentId } }),
    );
    expect(foreign.status).toBe(404);
    const own = await refusal(
      promoteWorkflow(api.deps, acting, id, { meta: { 'environment-id': api.environmentId } }),
    );
    expect(own.status).toBe(409);
  });
});
