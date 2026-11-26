/**
 * Workflow 8A Stage 3 (`api-workflows`; C112.3, C112.6, C113.5, C113.6, C116.1, C116.6): workflows,
 * their one draft and their versions through the routes. Order is asserted only on what the code
 * orders by. Every value is synthetic.
 */
import { createdAtClock, wallClockStepsBack } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import { action, chain, INQUIRY } from '../publish/testing.js';

let api: TestApi;
let admin: string;

beforeAll(async () => {
  api = await createTestApi();
  admin = api.newUserToken(api.environmentId);
});

afterAll(async () => {
  await api.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

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

async function ok<T = Resource>(pending: ReturnType<typeof call>, status = 200): Promise<T> {
  const response = await pending;
  expect(response.statusCode, response.body).toBe(status);
  return response.json<{ data: T }>().data;
}

const create = async (attributes: object = { name: 'Synthetic workflow' }) =>
  ok(call('POST', '/workflows', { data: { type: 'workflow', attributes } }), 201);

const tag = (value = 'checked') =>
  action('mark', 'tag_object', { 'object-type': 'inquiry', 'object-id': INQUIRY, tag: value });

const save = (id: string, definition: unknown, lockVersion: number) =>
  call('PUT', `/workflows/${id}/draft`, {
    data: { type: 'workflow-version', attributes: { definition, 'lock-version': lockVersion } },
  });

const draftOf = async (id: string) => ok(call('GET', `/workflows/${id}/draft`));

describe('workflows (C112.3)', () => {
  it('creates a paused workflow with an empty draft, and audits it', async () => {
    const workflow = await create({ name: 'First', description: 'A note.', kind: 'module' });
    expect(workflow.attributes).toMatchObject({
      name: 'First',
      description: 'A note.',
      status: 'paused',
      kind: 'module',
      'paused-reason': 'operator',
      'archived-at': null,
    });
    const draft = await draftOf(workflow.id);
    expect(workflow.relationships['draft-version']?.data?.id).toBe(draft.id);
    expect(draft.attributes).toMatchObject({
      status: 'draft',
      'version-number': 1,
      'schema-version': 1,
      'lock-version': 1,
      'trigger-type': null,
      live: false,
      'rollout-label': null,
      'rollout-percentage': null,
      'published-at': null,
      grant: null,
      egress: [],
    });
    expect(draft.attributes.definition).toMatchObject({ steps: [], edges: [], trigger: null });
    const entry = api.audit.entries.find(
      ({ action: name, resourceId }) => name === 'workflow.created' && resourceId === workflow.id,
    );
    expect(entry?.metadata).toEqual({ kind: 'module' });
  });

  it('reads and renames only in its environment, and changes the name alone', async () => {
    const workflow = await create();
    const renamed = await ok(
      call('PATCH', `/workflows/${workflow.id}`, {
        data: { type: 'workflow', attributes: { name: 'Renamed', description: null } },
      }),
    );
    expect(renamed.attributes).toMatchObject({ name: 'Renamed', description: null });
    const fetched = await ok(call('GET', `/workflows/${workflow.id}`));
    expect(fetched.attributes.name).toBe('Renamed');

    const tenant = await api.newTenant();
    const other = api.newUserToken(tenant.environmentId);
    expect((await call('GET', `/workflows/${workflow.id}`, undefined, other)).statusCode).toBe(404);
    expect(
      (
        await call(
          'PATCH',
          `/workflows/${workflow.id}`,
          { data: { type: 'workflow', attributes: { name: 'No' } } },
          other,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/workflows/${workflow.id}/draft`, undefined, other)).statusCode,
    ).toBe(404);
  });

  it('lists newest first, filters, and pages with a next link', async () => {
    onTestFinished(wallClockStepsBack());
    const clock = createdAtClock(api.database.db);
    const tenant = await api.newTenant();
    const token = api.newUserToken(tenant.environmentId);
    const add = async (kind: string) => {
      const created = await ok(
        call(
          'POST',
          '/workflows',
          { data: { type: 'workflow', attributes: { name: 'Listed', kind } } },
          token,
        ),
        201,
      );
      await clock.at('workflows', created.id);
      return created.id;
    };
    const first = await add('workflow');
    const second = await add('module');
    const third = await add('workflow');
    const list = async (query: string) => {
      const response = await call('GET', `/workflows${query}`, undefined, token);
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ data: Resource[]; links: { next: string | null } }>();
    };
    expect((await list('')).data.map(({ id }) => id)).toEqual([third, second, first]);
    expect((await list('?filter[kind]=module')).data.map(({ id }) => id)).toEqual([second]);
    expect((await list('?filter[status]=running')).data).toEqual([]);
    const page = await list('?page[size]=1');
    expect(page.data.map(({ id }) => id)).toEqual([third]);
    expect(page.links.next).toContain(`page[after]=${third}`);
    expect(
      (await call('GET', '/workflows?page[after]=wfl_00000000000000000000000000')).statusCode,
    ).toBe(400);
  });
});

describe('the draft (C116.1)', () => {
  it('saves at its lock version, stores the trigger and the warnings, and bumps it', async () => {
    const workflow = await create();
    const definition = chain([tag()], { variables: [{ name: 'unused', type: 'string' }] });
    const saved = await ok(save(workflow.id, definition, 1));
    expect(saved.attributes).toMatchObject({
      'lock-version': 2,
      'trigger-type': 'trigger-event',
    });
    expect(saved.attributes.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'variable_unused' })]),
    );
    expect(saved.attributes.definition).toEqual(definition);
    expect(saved.attributes['last-updater']).toMatch(/^usr_/);
  });

  it('answers 409 version_locked to a stale lock version', async () => {
    const workflow = await create();
    const response = await save(workflow.id, chain([tag()]), 7);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'version_locked' });
  });

  it('refuses a graph the check refuses, by pointer, without echoing a value', async () => {
    const workflow = await create();
    const broken = chain([tag()]);
    broken.edges = broken.edges.slice(1);
    const response = await save(workflow.id, broken, 1);
    expect(response.statusCode).toBe(422);
    const problem = response.json<{
      code: string;
      errors: { location: string; pointer: string; code: string }[];
    }>();
    expect(problem.code).toBe('definition_invalid');
    expect(problem.errors[0]).toMatchObject({ location: 'definition', code: 'port_unconnected' });
    expect((await draftOf(workflow.id)).attributes['lock-version']).toBe(1);
  });

  it('takes a draft with no trigger yet', async () => {
    const workflow = await create();
    const literal = action('mark', 'tag_object', {
      'object-type': 'inquiry',
      'object-id': 'inq_01M5CK3190XEVBM5ZXA76E1JSN',
      tag: 'checked',
    });
    const unstarted = chain([literal], { trigger: null });
    unstarted.edges = unstarted.edges.slice(1);
    const saved = await ok(save(workflow.id, unstarted, 1));
    expect(saved.attributes['trigger-type']).toBeNull();
  });

  it('answers 409 to an archived workflow', async () => {
    const workflow = await create();
    await ok(call('POST', `/workflows/${workflow.id}/archive`));
    const response = await save(workflow.id, chain([tag()]), 1);
    expect(response.statusCode).toBe(409);
  });
});

describe('validate (C113.6)', () => {
  it('answers problems of a given definition and saves nothing', async () => {
    const workflow = await create();
    const broken = chain([tag()]);
    broken.edges = broken.edges.slice(1);
    const response = await call('POST', `/workflows/${workflow.id}/draft/validate`, {
      data: { attributes: { definition: broken } },
    });
    expect(response.statusCode).toBe(200);
    const { meta } = response.json<{ meta: { valid: boolean; errors: { code: string }[] } }>();
    expect(meta.valid).toBe(false);
    expect(meta.errors[0]?.code).toBe('port_unconnected');
    expect((await draftOf(workflow.id)).attributes['lock-version']).toBe(1);
  });

  it('answers a bad shape with its pointers rather than a 400', async () => {
    const workflow = await create();
    const response = await call('POST', `/workflows/${workflow.id}/draft/validate`, {
      data: { attributes: { definition: { steps: 'nothing' } } },
    });
    expect(response.statusCode).toBe(200);
    const { meta } = response.json<{ meta: { errors: { code: string }[] } }>();
    expect(meta.errors.map(({ code }) => code)).toContain('definition_shape_invalid');
  });

  it('reads the saved draft with no body, and holds it to what publish holds', async () => {
    const workflow = await create();
    const empty = await call('POST', `/workflows/${workflow.id}/draft/validate`);
    expect(empty.json<{ meta: { valid: boolean } }>().meta.valid).toBe(false);
    await ok(save(workflow.id, chain([tag()]), 1));
    const response = await call('POST', `/workflows/${workflow.id}/draft/validate`);
    expect(response.json()).toMatchObject({ meta: { valid: true, errors: [] } });
  });
});

describe('versions (C112.6)', () => {
  it('reads a version, only in its environment, and lists the draft', async () => {
    const workflow = await create();
    const draft = await draftOf(workflow.id);
    const fetched = await ok(call('GET', `/workflow-versions/${draft.id}`));
    expect(fetched.relationships.workflow?.data?.id).toBe(workflow.id);
    const list = await call('GET', `/workflow-versions?filter[workflow-id]=${workflow.id}`);
    expect(list.json<{ data: Resource[] }>().data.map(({ id }) => id)).toEqual([draft.id]);
    const tenant = await api.newTenant();
    const other = api.newUserToken(tenant.environmentId);
    expect((await call('GET', `/workflow-versions/${draft.id}`, undefined, other)).statusCode).toBe(
      404,
    );
    const elsewhere = await call(
      'GET',
      `/workflow-versions?filter[workflow-id]=${workflow.id}`,
      undefined,
      other,
    );
    expect(elsewhere.statusCode).toBe(404);
  });
});

describe('pause, activate and archive (C112.6)', () => {
  it('refuses to activate a workflow with nothing published', async () => {
    const workflow = await create();
    expect((await call('POST', `/workflows/${workflow.id}/activate`)).statusCode).toBe(409);
  });

  it('archives once, from paused, and stays archived', async () => {
    const workflow = await create();
    const archived = await ok(call('POST', `/workflows/${workflow.id}/archive`));
    expect(archived.attributes).toMatchObject({ status: 'archived', 'paused-reason': null });
    expect(archived.attributes['archived-at']).not.toBeNull();
    expect((await call('POST', `/workflows/${workflow.id}/archive`)).statusCode).toBe(409);
    expect((await call('POST', `/workflows/${workflow.id}/activate`)).statusCode).toBe(409);
    expect((await call('POST', `/workflows/${workflow.id}/pause`)).statusCode).toBe(409);
    expect(
      (
        await call('PATCH', `/workflows/${workflow.id}`, {
          data: { type: 'workflow', attributes: { name: 'No' } },
        })
      ).statusCode,
    ).toBe(409);
  });
});
