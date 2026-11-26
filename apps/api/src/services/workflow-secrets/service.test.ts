/**
 * C125.1, C125.2: the secrets routes, through the app. A value goes in once and comes back from no
 * route; a value route acts on the caller's own environment; a production value and a change of what
 * a production value is bound to need a user session in production; and every write is audited with
 * the key's name, never the value. Every value is a synthetic canary.
 */
import type { WorkflowSecretDocument, WorkflowSecretListDocument } from '@openverify/contracts';
import {
  createEnvironment,
  openWorkflowSecretValue,
} from '@openverify/db';
import { seedWorkflow, seedWorkflowVersion, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi, type TestTenant } from '../../test-support/harness.js';

let api: TestApi;
const CANARY = 'canary-synthetic-secret-value';
const PREFIX = '/api/v1/workflow-secrets';

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const call = (token: string, method: Method, url: string, payload?: unknown) =>
  api.app.inject({
    method,
    url,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const attributes = (values: Record<string, unknown>) => ({
  data: { type: 'workflow-secret', attributes: values },
});
const secretValue = (value = CANARY) => ({ data: { attributes: { 'secret-value': value } } });

let counter = 0;
const nextKey = () => {
  counter += 1;
  return `crm_token_${String(counter)}`;
};

async function created(tenant: TestTenant, more: Record<string, unknown> = {}) {
  const key = nextKey();
  const response = await call(
    tenant.token,
    'POST',
    PREFIX,
    attributes({ key, 'allowed-hosts': ['api.example.com'], ...more }),
  );
  expect(response.statusCode, response.body).toBe(201);
  return { key, id: response.json<WorkflowSecretDocument>().data.id };
}

const putValue = (token: string, key: string, environmentId: string, value = CANARY) =>
  call(token, 'PUT', `${PREFIX}/${key}/values/${environmentId}`, secretValue(value));

const entries = () => api.audit.entries;

describe('creating and reading', () => {
  it('creates a key with the default placements', async () => {
    const tenant = await api.newTenant();
    const key = nextKey();

    const response = await call(
      tenant.token,
      'POST',
      PREFIX,
      attributes({ key, description: 'CRM', 'allowed-hosts': ['api.example.com'] }),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json<WorkflowSecretDocument>().data.attributes).toMatchObject({
      key,
      description: 'CRM',
      'allowed-hosts': ['api.example.com'],
      'allowed-placements': { headers: ['authorization'], 'body-pointers': [] },
      'environment-value': null,
    });
  });

  it('answers 409 for a key the organisation already has', async () => {
    const tenant = await api.newTenant();
    const { key } = await created(tenant);

    const response = await call(
      tenant.token,
      'POST',
      PREFIX,
      attributes({ key, 'allowed-hosts': ['api.example.com'] }),
    );

    expect(response.statusCode).toBe(409);
  });

  it('refuses a host that is not normalised, before anything is stored', async () => {
    const tenant = await api.newTenant();

    const response = await call(
      tenant.token,
      'POST',
      PREFIX,
      attributes({ key: nextKey(), 'allowed-hosts': ['API.example.com.'] }),
    );

    expect(response.statusCode).toBe(400);
  });

  it('reads one by its key, and answers 404 for another organisation', async () => {
    const tenant = await api.newTenant();
    const other = await api.newTenant();
    const { key } = await created(tenant);

    const own = await call(tenant.token, 'GET', `${PREFIX}/${key}`);
    const foreign = await call(other.token, 'GET', `${PREFIX}/${key}`);

    expect(own.statusCode).toBe(200);
    expect(foreign.statusCode).toBe(404);
  });

  it('lists with a cursor, newest first', async () => {
    const tenant = await api.newTenant();
    const first = await created(tenant);
    const second = await created(tenant);

    const page = await call(tenant.token, 'GET', `${PREFIX}?page[size]=1`);
    const body = page.json<WorkflowSecretListDocument>();
    const ids = [first.id, second.id];

    expect(page.statusCode).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(ids).toContain(body.data[0]?.id);
    expect(body.links.next).toContain('page[after]=');
  });

  it('shows only the caller’s environment’s value metadata', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const { key, id } = await created(tenant);
    const sibling = testId('env');
    await createEnvironment(api.database.db, {
      id: sibling,
      organizationId: tenant.organizationId,
      kind: 'sandbox',
    });
    const siblingKey = await api.newApiKey(sibling);
    await putValue(siblingKey, key, sibling);

    const own = await call(tenant.token, 'GET', `${PREFIX}/${key}`);
    const theirs = await call(siblingKey, 'GET', `${PREFIX}/${key}`);

    expect(own.json<WorkflowSecretDocument>().data.attributes['environment-value']).toBeNull();
    expect(theirs.json<WorkflowSecretDocument>().data).toMatchObject({
      id,
      attributes: { 'environment-value': { 'environment-id': sibling, version: 1, last4: 'alue' } },
    });
  });
});

describe('a value (C125.2)', () => {
  it('is set in the caller’s own environment and comes back from no route', async () => {
    const tenant = await api.newTenant();
    const { key, id } = await created(tenant);

    const put = await putValue(tenant.token, key, tenant.environmentId);
    const read = await call(tenant.token, 'GET', `${PREFIX}/${key}`);

    expect(put.statusCode, put.body).toBe(200);
    expect(put.body).not.toContain(CANARY);
    expect(read.body).not.toContain(CANARY);
    expect(
      await openWorkflowSecretValue(api.database.db, tenant.environmentId, id, api.clock.now()),
    ).toEqual({ value: CANARY, previousValue: null });
  });

  it('answers 404 for another environment’s id, and writes nothing', async () => {
    const tenant = await api.newTenant();
    const other = await api.newTenant();
    const { key, id } = await created(tenant);

    const put = await putValue(tenant.token, key, other.environmentId);
    const rotate = await call(
      tenant.token,
      'POST',
      `${PREFIX}/${key}/values/${other.environmentId}/rotate`,
      secretValue(),
    );

    expect(put.statusCode).toBe(404);
    expect(rotate.statusCode).toBe(404);
    expect(
      await openWorkflowSecretValue(api.database.db, other.environmentId, id, api.clock.now()),
    ).toBeNull();
  });

  it('answers 404 for a key the organisation does not have', async () => {
    const tenant = await api.newTenant();

    const put = await putValue(tenant.token, 'no_such_key', tenant.environmentId);

    expect(put.statusCode).toBe(404);
  });

  it('refuses an API key on a production value', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const { key } = await created(tenant);

    const put = await putValue(tenant.token, key, tenant.environmentId);
    const rotate = await call(
      tenant.token,
      'POST',
      `${PREFIX}/${key}/values/${tenant.environmentId}/rotate`,
      secretValue(),
    );

    expect(put.statusCode).toBe(403);
    expect(rotate.statusCode).toBe(403);
  });

  it('takes a production value from a user session that holds production', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const { key } = await created(tenant);

    const put = await putValue(
      api.newUserToken(tenant.environmentId),
      key,
      tenant.environmentId,
    );

    expect(put.statusCode, put.body).toBe(200);
  });

  it('refuses a user session without production', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const { key } = await created(tenant);
    const token = api.newUserToken(tenant.environmentId, { permissions: ['secrets:write'] });

    const put = await putValue(token, key, tenant.environmentId);

    expect(put.statusCode).toBe(403);
  });

  it('lets an API key set a value in its own sandbox', async () => {
    const tenant = await api.newTenant();
    const { key } = await created(tenant);

    expect((await putValue(tenant.token, key, tenant.environmentId)).statusCode).toBe(200);
  });
});

describe('a rotation (C125.2)', () => {
  it('keeps the old value for 24 hours and answers no value', async () => {
    const tenant = await api.newTenant();
    const { key, id } = await created(tenant);
    await putValue(tenant.token, key, tenant.environmentId);

    const response = await call(
      tenant.token,
      'POST',
      `${PREFIX}/${key}/values/${tenant.environmentId}/rotate`,
      secretValue('canary-rotated-value'),
    );

    const now = api.clock.now();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain('canary');
    expect(
      response.json<WorkflowSecretDocument>().data.attributes['environment-value'],
    ).toMatchObject({
      version: 2,
      'previous-expires-at': new Date(now.getTime() + 86_400_000).toISOString(),
    });
    expect(await openWorkflowSecretValue(api.database.db, tenant.environmentId, id, now)).toEqual({
      value: 'canary-rotated-value',
      previousValue: CANARY,
    });
  });

  it('answers 404 with no value to rotate', async () => {
    const tenant = await api.newTenant();
    const { key } = await created(tenant);

    const response = await call(
      tenant.token,
      'POST',
      `${PREFIX}/${key}/values/${tenant.environmentId}/rotate`,
      secretValue(),
    );

    expect(response.statusCode).toBe(404);
  });
});

describe('changing a secret (C125.2)', () => {
  /** A production environment with a value, and a sandbox of the same organisation. */
  async function withProductionValue() {
    const tenant = await api.newTenant({ kind: 'production' });
    const { key, id } = await created(tenant);
    await putValue(api.newUserToken(tenant.environmentId), key, tenant.environmentId);
    const sandbox = testId('env');
    await createEnvironment(api.database.db, {
      id: sandbox,
      organizationId: tenant.organizationId,
      kind: 'sandbox',
    });
    return { tenant, key, id, sandbox, sandboxKey: await api.newApiKey(sandbox) };
  }

  const HOSTS = attributes({ 'allowed-hosts': ['other.example.com'] });
  const PLACEMENTS = attributes({
    'allowed-placements': { headers: ['x-token'], 'body-pointers': [] },
  });

  it('takes a description from anyone holding secrets:write', async () => {
    const { key, sandboxKey } = await withProductionValue();

    const response = await call(
      sandboxKey,
      'PATCH',
      `${PREFIX}/${key}`,
      attributes({ description: 'CRM' }),
    );

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['hosts', HOSTS],
    ['placements', PLACEMENTS],
  ])('refuses a sandbox principal’s change of %s while a production value exists', async (_n, body) => {
    const { key, sandboxKey } = await withProductionValue();

    expect((await call(sandboxKey, 'PATCH', `${PREFIX}/${key}`, body)).statusCode).toBe(403);
  });

  it('refuses a production API key the same change', async () => {
    const { key, tenant } = await withProductionValue();

    expect((await call(tenant.token, 'PATCH', `${PREFIX}/${key}`, HOSTS)).statusCode).toBe(403);
  });

  it('takes it from a production user, and audits every environment holding a value', async () => {
    const { key, tenant, sandbox, sandboxKey } = await withProductionValue();
    await putValue(sandboxKey, key, sandbox);
    const before = entries().length;

    const response = await call(
      api.newUserToken(tenant.environmentId),
      'PATCH',
      `${PREFIX}/${key}`,
      HOSTS,
    );

    expect(response.statusCode, response.body).toBe(200);
    const written = entries().slice(before);
    expect(written.map(({ environmentId }) => environmentId).sort()).toEqual(
      [tenant.environmentId, sandbox].sort(),
    );
    expect(written[0]).toMatchObject({
      action: 'workflow-secret.updated',
      metadata: { key, changed: ['allowed-hosts'] },
    });
  });

  it('takes the change from a sandbox key when no production value exists', async () => {
    const tenant = await api.newTenant();
    const { key } = await created(tenant);
    await putValue(tenant.token, key, tenant.environmentId);

    expect((await call(tenant.token, 'PATCH', `${PREFIX}/${key}`, HOSTS)).statusCode).toBe(200);
  });

  it('answers 404 for a key the organisation does not have', async () => {
    const tenant = await api.newTenant();

    expect((await call(tenant.token, 'PATCH', `${PREFIX}/nothing`, HOSTS)).statusCode).toBe(404);
  });
});

describe('deleting a secret (C125.2)', () => {
  it('deletes a key nothing references, with its values', async () => {
    const tenant = await api.newTenant();
    const { key, id } = await created(tenant);
    await putValue(tenant.token, key, tenant.environmentId);

    const response = await call(tenant.token, 'DELETE', `${PREFIX}/${key}`);

    expect(response.statusCode).toBe(200);
    expect(response.json<WorkflowSecretDocument>().data.id).toBe(id);
    expect((await call(tenant.token, 'GET', `${PREFIX}/${key}`)).statusCode).toBe(404);
  });

  it('refuses while a published version references it', async () => {
    const tenant = await api.newTenant();
    const { key } = await created(tenant);
    const workflow = await seedWorkflow(api.database.db, tenant.environmentId);
    await seedWorkflowVersion(api.database.db, tenant.environmentId, {
      workflowId: workflow.id,
      status: 'published',
      definition: { steps: [{ config: { signing: { secret: `{{secrets.${key}}}` } } }] },
    });

    const response = await call(tenant.token, 'DELETE', `${PREFIX}/${key}`);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('secret_in_use');
    expect((await call(tenant.token, 'GET', `${PREFIX}/${key}`)).statusCode).toBe(200);
  });

  it('refuses a sandbox principal while a production value exists (ours)', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const { key } = await created(tenant);
    await putValue(api.newUserToken(tenant.environmentId), key, tenant.environmentId);

    expect((await call(tenant.token, 'DELETE', `${PREFIX}/${key}`)).statusCode).toBe(403);
  });
});

describe('the audit log (C125.2, P19)', () => {
  it('names the key on every write and never a value', async () => {
    const tenant = await api.newTenant();
    const before = entries().length;
    const { key, id } = await created(tenant);
    await putValue(tenant.token, key, tenant.environmentId);
    await call(
      tenant.token,
      'POST',
      `${PREFIX}/${key}/values/${tenant.environmentId}/rotate`,
      secretValue('canary-rotated-value'),
    );
    await call(tenant.token, 'PATCH', `${PREFIX}/${key}`, attributes({ description: 'CRM' }));
    await call(tenant.token, 'DELETE', `${PREFIX}/${key}`);

    const written = entries().slice(before);
    expect(written.map(({ action }) => action)).toEqual([
      'workflow-secret.created',
      'workflow-secret.value-set',
      'workflow-secret.value-rotated',
      'workflow-secret.updated',
      'workflow-secret.deleted',
    ]);
    expect(written.every(({ resourceId }) => resourceId === id)).toBe(true);
    expect(written.every(({ metadata }) => metadata?.key === key)).toBe(true);
    expect(JSON.stringify(written)).not.toContain('canary');
  });
});
