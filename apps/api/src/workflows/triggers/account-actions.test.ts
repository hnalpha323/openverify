/**
 * C118.7 (H14, P38), C121.3: account actions through the app. An action binds a running workflow to
 * an account type; a prefill is rendered under the viewer's mask, and the run reads the live value
 * under its grant. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  createAccount,
  createAccountType,
  getWorkflowRun,
  openWorkflowRunValues,
  type Db,
} from '@openverify/db';
import { seedWorkflow, seedWorkflowVersion } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer } from '../../test-support/harness.js';

let api: InquiryTestApi;
let db: Db;

beforeAll(async () => {
  api = await createInquiryTestApi();
  db = api.database.db;
});

afterAll(async () => {
  await api.close();
});

const definitionOf = (trigger: unknown, inputs: readonly unknown[]) => ({
  'schema-version': 1,
  trigger,
  inputs,
  variables: [],
  steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
  edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
  outputs: [],
  layout: {},
});

const ACCOUNT_TRIGGER = { type: 'trigger-account', config: {} };
const INPUTS = [
  { name: 'reference', type: 'string', required: true },
  { name: 'note', type: 'string', required: false },
];

async function published(
  options: {
    trigger?: unknown;
    status?: string;
    kind?: string;
    grant?: { scopes: readonly string[]; pii: boolean };
    inputs?: readonly unknown[];
  } = {},
) {
  const { environmentId } = api;
  const workflow = await seedWorkflow(db, environmentId, {
    status: options.status ?? 'running',
    kind: options.kind ?? 'workflow',
  });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definitionOf(options.trigger ?? ACCOUNT_TRIGGER, options.inputs ?? INPUTS),
  });
  await api.database.client.query(
    `update workflow_versions set "grant" = $1::jsonb where id = $2`,
    [JSON.stringify(options.grant ?? { scopes: [], pii: false }), version.id],
  );
  await api.database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  return workflow.id;
}

const accountType = () =>
  createAccountType(db, api.environmentId, { id: newId('acctp'), name: `Type ${newId('acctp')}` });

const account = (accountTypeId: string, fields: Record<string, string> = {}) =>
  createAccount(db, api.environmentId, {
    id: newId('acc'),
    accountTypeId,
    referenceId: null,
    fields,
  });

const request = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  token = api.token,
) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const newAction = (attributes: Record<string, unknown>) => ({
  data: { type: 'account-action', attributes },
});

async function action(workflowId: string, accountTypeId: string, prefill = {}) {
  const response = await request(
    'POST',
    '/account-actions',
    newAction({
      'workflow-id': workflowId,
      'account-type-id': accountTypeId,
      label: 'Re-check',
      prefill,
    }),
  );
  expect(response.statusCode).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

describe('account actions (C118.7)', () => {
  it('creates, reads, lists and updates one', async () => {
    const workflowId = await published();
    const type = await accountType();
    const id = await action(workflowId, type.id, { reference: 'account.fields.reference' });

    const read = await request('GET', `/account-actions/${id}`);
    const list = await request('GET', `/account-actions?filter[account-type-id]=${type.id}`);
    const updated = await request(
      'PATCH',
      `/account-actions/${id}`,
      newAction({ label: 'Review', status: 'archived' }),
    );

    expect(read.json()).toMatchObject({
      data: {
        id,
        attributes: { label: 'Re-check', status: 'active' },
        relationships: { workflow: { data: { id: workflowId } } },
      },
    });
    expect(list.json<{ data: { id: string }[] }>().data.map((item) => item.id)).toEqual([id]);
    expect(updated.json()).toMatchObject({
      data: { attributes: { label: 'Review', status: 'archived' } },
    });
    expect(api.audit.entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['account-action.created', 'account-action.updated']),
    );
  });

  it('answers 404 for an action it cannot find', async () => {
    const id = newId('accac');

    expect((await request('GET', `/account-actions/${id}`)).statusCode).toBe(404);
    expect(
      (await request('PATCH', `/account-actions/${id}`, newAction({ label: 'x' }))).statusCode,
    ).toBe(404);
  });

  it('answers 404 for a workflow or an account type it cannot find', async () => {
    const workflowId = await published();
    const type = await accountType();

    const noWorkflow = await request(
      'POST',
      '/account-actions',
      newAction({ 'workflow-id': newId('wfl'), 'account-type-id': type.id, label: 'x' }),
    );
    const noType = await request(
      'POST',
      '/account-actions',
      newAction({ 'workflow-id': workflowId, 'account-type-id': newId('acctp'), label: 'x' }),
    );

    expect([noWorkflow.statusCode, noType.statusCode]).toEqual([404, 404]);
  });

  it.each([
    ['a paused workflow', { status: 'paused' }],
    ['a module (C119.8)', { kind: 'module' }],
    ['another trigger', { trigger: { type: 'trigger-api', config: {} } }],
  ])('binds no %s', async (_, options) => {
    const workflowId = await published(options);
    const type = await accountType();

    const response = await request(
      'POST',
      '/account-actions',
      newAction({ 'workflow-id': workflowId, 'account-type-id': type.id, label: 'x' }),
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'workflow_not_running' });
  });

  it.each([
    ['an undeclared input', { unknown: 'account.fields.reference' }, 'unknown'],
    ['a path outside account.fields', { reference: 'trigger.status' }, 'reference'],
  ])('refuses a prefill of %s at its pointer', async (_, prefill, name) => {
    const workflowId = await published();
    const type = await accountType();

    const response = await request(
      'POST',
      '/account-actions',
      newAction({ 'workflow-id': workflowId, 'account-type-id': type.id, label: 'x', prefill }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'trigger_input_invalid',
      source: { pointer: `/data/attributes/prefill/${name}` },
    });
  });

  it('holds an update’s prefill to the same rules', async () => {
    const id = await action(await published(), (await accountType()).id);

    const response = await request(
      'PATCH',
      `/account-actions/${id}`,
      newAction({ prefill: { reference: 'trigger.status' } }),
    );

    expect(response.statusCode).toBe(422);
  });
});

describe('POST /accounts/:id/run-action (C118.7)', () => {
  const run = (accountId: string, actionId: string, parameters?: unknown, token = api.token) =>
    request(
      'POST',
      `/accounts/${accountId}/run-action`,
      {
        data: {
          'account-action-id': actionId,
          ...(parameters === undefined ? {} : { parameters }),
        },
      },
      token,
    );

  const runIdOf = (response: Awaited<ReturnType<typeof run>>) =>
    response.json<{ data: { 'workflow-run-id': string } }>().data['workflow-run-id'];

  it('starts a run on the account, and answers as the public path does', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id);
    const id = await action(workflowId, type.id);

    const response = await run(target.id, id, { reference: 'ref-1' });

    expect(response.statusCode).toBe(200);
    const stored = await getWorkflowRun(db, api.environmentId, runIdOf(response));
    expect(stored).toMatchObject({
      triggerType: 'trigger-account',
      creatorType: 'account-action',
      creatorId: id,
    });
    expect(stored === null ? null : openWorkflowRunValues(stored)).toMatchObject({
      inputs: { reference: 'ref-1' },
      triggerSnapshot: { id: target.id, type: 'account' },
    });
  });

  it('reads the live value of a prefill the caller left out', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id, { reference: 'synthetic-live-value' });
    const id = await action(workflowId, type.id, { reference: 'account.fields.reference' });

    const response = await run(target.id, id);

    const stored = await getWorkflowRun(db, api.environmentId, runIdOf(response));
    expect(stored === null ? null : openWorkflowRunValues(stored).inputs).toEqual({
      reference: 'synthetic-live-value',
    });
  });

  it('lets a parameter stand over a prefill', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id, { reference: 'stored' });
    const id = await action(workflowId, type.id, { reference: 'account.fields.reference' });

    const response = await run(target.id, id, { reference: 'given' });

    const stored = await getWorkflowRun(db, api.environmentId, runIdOf(response));
    expect(stored === null ? null : openWorkflowRunValues(stored).inputs).toEqual({
      reference: 'given',
    });
  });

  it('validates the parameters against the inputs', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id);
    const id = await action(workflowId, type.id);

    const response = await run(target.id, id, { note: 'no reference' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'trigger_input_invalid' });
  });

  it('answers 404 for an account of another type, and an archived action', async () => {
    const workflowId = await published();
    const type = await accountType();
    const other = await accountType();
    const target = await account(other.id);
    const id = await action(workflowId, type.id);
    const onOwn = await account(type.id);
    await request('PATCH', `/account-actions/${id}`, newAction({ status: 'archived' }));

    expect((await run(target.id, id, { reference: 'r' })).statusCode).toBe(404);
    expect((await run(onOwn.id, id, { reference: 'r' })).statusCode).toBe(404);
    expect((await run(newId('acc'), id, { reference: 'r' })).statusCode).toBe(404);
  });

  it('answers 410 for a redacted account', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id);
    const id = await action(workflowId, type.id);
    await api.database.client.query(`update accounts set redacted_at = now() where id = $1`, [
      target.id,
    ]);

    expect((await run(target.id, id, { reference: 'r' })).statusCode).toBe(410);
  });

  it('answers 409 when the workflow stopped running', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id);
    const id = await action(workflowId, type.id);
    await api.database.client.query(`update workflows set status = 'paused' where id = $1`, [
      workflowId,
    ]);

    expect((await run(target.id, id, { reference: 'r' })).statusCode).toBe(409);
  });

  it('answers the same run for a repeated key, past the 24-hour store (C112.6)', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id);
    const id = await action(workflowId, type.id);
    const send = () =>
      api.app.inject({
        method: 'POST',
        url: `/api/v1/accounts/${target.id}/run-action`,
        headers: { ...bearer(api.token), 'idempotency-key': 'synthetic-key-4' },
        payload: { data: { 'account-action-id': id, parameters: { reference: 'r' } } },
      });

    const first = await send();
    await api.database.client.query(`delete from idempotency_keys`);
    const second = await send();

    expect(runIdOf(second)).toBe(runIdOf(first));
  });

  it('needs the version’s grant (C121.3)', async () => {
    const workflowId = await published({ grant: { scopes: ['transactions:write'], pii: false } });
    const type = await accountType();
    const target = await account(type.id);
    const id = await action(workflowId, type.id);
    const token = await api.newApiKey(api.environmentId, {
      scopes: ['workflows:trigger', 'accounts:read'],
    });

    const response = await run(target.id, id, { reference: 'r' }, token);

    expect(response.statusCode).toBe(403);
    expect(response.headers['www-authenticate']).toContain('transactions:write');
  });
});

describe('GET /accounts/:id/available-actions (H14, P38)', () => {
  interface Available {
    data: {
      id: string;
      attributes: {
        label: string;
        form: { name: string; required: boolean; 'prefilled-value': unknown }[];
      };
    }[];
    links: { next: string | null };
  }

  const available = (accountId: string, token = api.token) =>
    request('GET', `/accounts/${accountId}/available-actions`, undefined, token);

  it('lists the type’s actions with their forms, prefilled', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id, { reference: 'synthetic-value' });
    const id = await action(workflowId, type.id, { reference: 'account.fields.reference' });

    const response = await available(target.id);

    expect(response.statusCode).toBe(200);
    const body = response.json<Available>();
    expect(body.links.next).toBeNull();
    expect(body.data.map((item) => item.id)).toEqual([id]);
    expect(body.data[0]?.attributes.form).toEqual([
      {
        name: 'reference',
        type: 'string',
        required: true,
        'prefilled-value': 'synthetic-value',
      },
      { name: 'note', type: 'string', required: false, 'prefilled-value': null },
    ]);
  });

  it('leaves a masked field empty for a viewer without PII (P38)', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id, { reference: 'synthetic-canary' });
    await action(workflowId, type.id, { reference: 'account.fields.reference' });
    const token = await api.newApiKey(api.environmentId, {
      scopes: ['workflows:trigger', 'accounts:read'],
      piiMasked: true,
    });

    const response = await available(target.id, token);

    expect(response.body).not.toContain('synthetic-canary');
    expect(response.json<Available>().data[0]?.attributes.form[0]?.['prefilled-value']).toBeNull();
  });

  it('leaves out what the caller’s grant cannot run, and what is not running (C121.3)', async () => {
    const type = await accountType();
    const target = await account(type.id);
    const open = await action(await published(), type.id);
    await action(
      await published({ grant: { scopes: ['transactions:write'], pii: false } }),
      type.id,
    );
    await action(await published({ grant: { scopes: [], pii: true } }), type.id);
    const stopped = await published();
    await action(stopped, type.id);
    await api.database.client.query(`update workflows set status = 'paused' where id = $1`, [
      stopped,
    ]);
    const token = await api.newApiKey(api.environmentId, {
      scopes: ['workflows:trigger', 'accounts:read'],
      piiMasked: true,
    });

    const response = await available(target.id, token);

    expect(response.json<Available>().data.map((item) => item.id)).toEqual([open]);
  });

  it('offers nothing on a redacted account (C120.9)', async () => {
    const workflowId = await published();
    const type = await accountType();
    const target = await account(type.id);
    await action(workflowId, type.id);
    await api.database.client.query(`update accounts set redacted_at = now() where id = $1`, [
      target.id,
    ]);

    const response = await available(target.id);

    expect(response.json<Available>().data).toEqual([]);
  });

  it('answers 404 for an account it cannot find', async () => {
    expect((await available(newId('acc'))).statusCode).toBe(404);
  });
});
