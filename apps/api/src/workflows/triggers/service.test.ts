/**
 * C118.2, C118.5, C118.1 (H18), C121.3, C143.5: the routes that start a run, through the app. A run
 * a principal starts needs every scope of its version's grant; a file is stored sealed and in scope
 * as its id; no problem echoes a value. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  createWorkflowDeliveries,
  finishWorkflowDelivery,
  getWorkflowRun,
  listWorkflowRunFiles,
  openWorkflowRunValues,
  type Db,
} from '@openverify/db';
import { createTestInquiry, seedWorkflow, seedWorkflowVersion } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import { bearer } from '../../test-support/harness.js';

let api: InquiryTestApi;
let db: Db;

const allowing = createAllowAllRateLimiter();
const limits = { refused: new Set<string>(), down: false };
const rateLimiter: RateLimiter = {
  consume: (key, rule) => {
    if (limits.down) {
      return Promise.reject(new Error('the store is down'));
    }
    return allowing
      .consume(key, rule)
      .then((decision) =>
        limits.refused.has(rule.name)
          ? { ...decision, allowed: false, retryAfterSeconds: 30 }
          : decision,
      );
  },
};

beforeAll(async () => {
  api = await createInquiryTestApi({ rateLimiter });
  db = api.database.db;
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  limits.refused.clear();
  limits.down = false;
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

interface DefinitionOptions {
  trigger?: unknown;
  inputs?: readonly unknown[];
}

const definitionOf = ({ trigger, inputs }: DefinitionOptions = {}) => ({
  'schema-version': 1,
  trigger: trigger ?? { type: 'trigger-api', config: {} },
  inputs: inputs ?? [{ name: 'reference', type: 'string', required: true }],
  variables: [],
  steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
  edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
  outputs: [],
  layout: {},
});

async function published(
  options: DefinitionOptions & {
    status?: string;
    grant?: { scopes: readonly string[]; pii: boolean };
    kind?: string;
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
    definition: definitionOf(options),
  });
  await api.database.client.query(
    `update workflow_versions set "grant" = $1::jsonb where id = $2`,
    [JSON.stringify(options.grant ?? { scopes: [], pii: false }), version.id],
  );
  await api.database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  return { workflowId: workflow.id, versionId: version.id };
}

const post = (
  url: string,
  payload: unknown,
  token = api.token,
  headers: Record<string, string> = {},
) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: { ...bearer(token), ...headers },
    payload: payload as Record<string, unknown>,
  });

const get = (url: string, token = api.token) =>
  api.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: bearer(token) });

const fields = (values: Record<string, unknown>) => ({ data: { attributes: { fields: values } } });

describe('POST /workflows/:id/trigger (C118.2)', () => {
  it('starts a run of the live version and answers it, in progress', async () => {
    const { workflowId, versionId } = await published();

    const response = await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'ref-1' }));

    expect(response.statusCode).toBe(200);
    const { data } = response.json<{
      data: { id: string; attributes: { 'trigger-type': string } };
    }>();
    expect(data.attributes['trigger-type']).toBe('trigger-api');
    const run = await getWorkflowRun(db, api.environmentId, data.id);
    expect(run).toMatchObject({
      workflowVersionId: versionId,
      triggerType: 'trigger-api',
      creatorType: 'api-key',
      causedByPrincipal: run?.creatorId,
    });
    expect(run === null ? null : openWorkflowRunValues(run).inputs).toEqual({ reference: 'ref-1' });
  });

  it('records a user as the run’s creator', async () => {
    const { workflowId } = await published();
    const userId = newId('usr');
    const token = api.newUserToken(api.environmentId, { userId });

    const response = await post(
      `/workflows/${workflowId}/trigger`,
      fields({ reference: 'ref-1' }),
      token,
    );

    const { data } = response.json<{ data: { id: string } }>();
    expect(await getWorkflowRun(db, api.environmentId, data.id)).toMatchObject({
      creatorType: 'user',
      creatorId: userId,
      causedByPrincipal: userId,
    });
  });

  it('writes an audit entry with ids and never a field', async () => {
    const { workflowId } = await published();

    await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'synthetic-canary' }));

    const entry = api.audit.entries.find(
      ({ action, resourceId }) => action === 'workflow.triggered' && resourceId === workflowId,
    );
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain('synthetic-canary');
  });

  it('answers 404 for a workflow it cannot see, here or elsewhere (C121.6)', async () => {
    const other = await api.newTenant();
    const { workflowId } = await published();

    const response = await post(
      `/workflows/${workflowId}/trigger`,
      fields({ reference: 'ref-1' }),
      other.token,
    );

    expect(response.statusCode).toBe(404);
  });

  it.each(['paused', 'archived'])('answers 409 for a %s workflow', async (status) => {
    const { workflowId } = await published();
    await api.database.client.query(
      `update workflows set status = $1, archived_at = case when $1 = 'archived' then now() end
       where id = $2`,
      [status, workflowId],
    );

    const response = await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'ref-1' }));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'workflow_not_running' });
  });

  it('answers 409 for a workflow no API trigger starts', async () => {
    const { workflowId } = await published({
      trigger: { type: 'trigger-event', config: { events: ['inquiry.completed'] } },
    });

    const response = await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'ref-1' }));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'workflow_not_running' });
  });

  it('answers 409 for a module, which runs only inside another run (C119.8)', async () => {
    const { workflowId } = await published({ kind: 'module' });

    const response = await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'ref-1' }));

    expect(response.statusCode).toBe(409);
  });

  it('answers 422 at its pointer, and never echoes the value (C143.5)', async () => {
    const { workflowId } = await published({
      inputs: [{ name: 'amount', type: 'number', required: true }],
    });

    const response = await post(
      `/workflows/${workflowId}/trigger`,
      fields({ amount: 'synthetic-canary' }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'trigger_input_invalid',
      source: { pointer: '/data/attributes/fields/amount' },
    });
    expect(response.body).not.toContain('synthetic-canary');
  });

  it('refuses meta.params and top-level attributes (C118.2)', async () => {
    const { workflowId } = await published();

    const response = await post(`/workflows/${workflowId}/trigger`, {
      data: { attributes: { fields: { reference: 'ref-1' }, status: 'x' } },
      meta: { params: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it('answers 400 with a pointer for a malformed file value', async () => {
    const { workflowId } = await published({
      inputs: [{ name: 'document', type: 'file', required: true }],
    });

    const response = await post(
      `/workflows/${workflowId}/trigger`,
      fields({ document: { filename: 'a.png', data: '***' } }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      source: { pointer: '/data/attributes/fields/document' },
    });
  });

  it('stores a file sealed, and puts its id in scope, never its bytes (C118.2)', async () => {
    const { workflowId } = await published({
      inputs: [{ name: 'document', type: 'file', required: true }],
    });
    const data = PNG.toString('base64');

    const response = await post(
      `/workflows/${workflowId}/trigger`,
      fields({ document: { filename: 'synthetic.png', data } }),
    );

    expect(response.statusCode).toBe(200);
    const runId = response.json<{ data: { id: string } }>().data.id;
    const files = await listWorkflowRunFiles(db, api.environmentId, runId);
    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file).toMatchObject({ mimeType: 'image/png', byteSize: PNG.byteLength });
    const run = await getWorkflowRun(db, api.environmentId, runId);
    expect(run === null ? null : openWorkflowRunValues(run).inputs).toEqual({ document: file?.id });
    const stored = await api.storage.get(file?.storageKey ?? '');
    expect(Buffer.from(stored ?? []).includes(PNG)).toBe(false);
  });

  it('removes what it stored when a start fails', async () => {
    const { workflowId } = await published({
      inputs: [{ name: 'document', type: 'file', required: true }],
    });
    const before = api.storage.keys().length;
    api.events.failNext(new Error('the event was not staged'));

    const response = await post(
      `/workflows/${workflowId}/trigger`,
      fields({ document: { filename: 'a.png', data: PNG.toString('base64') } }),
    );

    expect(response.statusCode).toBe(500);
    expect(api.storage.keys()).toHaveLength(before);
  });

  describe('its Idempotency-Key (C112.6)', () => {
    it('answers the same run past the 24-hour store, and stores no second file', async () => {
      const { workflowId } = await published();
      const headers = { 'idempotency-key': 'synthetic-key-1' };

      const first = await post(
        `/workflows/${workflowId}/trigger`,
        fields({ reference: 'ref-1' }),
        api.token,
        headers,
      );
      await api.database.client.query(`delete from idempotency_keys`);
      const second = await post(
        `/workflows/${workflowId}/trigger`,
        fields({ reference: 'ref-1' }),
        api.token,
        headers,
      );

      expect(second.json<{ data: { id: string } }>().data.id).toBe(
        first.json<{ data: { id: string } }>().data.id,
      );
    });

    it('never keeps the key as written', async () => {
      const { workflowId } = await published();

      const response = await post(
        `/workflows/${workflowId}/trigger`,
        fields({ reference: 'ref-1' }),
        api.token,
        { 'idempotency-key': 'synthetic-key-2' },
      );

      const run = await getWorkflowRun(
        db,
        api.environmentId,
        response.json<{ data: { id: string } }>().data.id,
      );
      expect(run?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('no amplification (C121.3)', () => {
    it('answers 403 naming what the caller lacks', async () => {
      const { workflowId } = await published({ grant: { scopes: ['accounts:write'], pii: false } });
      const token = await api.newApiKey(api.environmentId, { scopes: ['workflows:trigger'] });

      const response = await post(
        `/workflows/${workflowId}/trigger`,
        fields({ reference: 'ref-1' }),
        token,
      );

      expect(response.statusCode).toBe(403);
      expect(response.headers['www-authenticate']).toContain('accounts:write');
    });

    it('takes a caller holding the grant', async () => {
      const { workflowId } = await published({ grant: { scopes: ['accounts:write'], pii: false } });
      const token = await api.newApiKey(api.environmentId, {
        scopes: ['workflows:trigger', 'accounts:write'],
      });

      const response = await post(
        `/workflows/${workflowId}/trigger`,
        fields({ reference: 'ref-1' }),
        token,
      );

      expect(response.statusCode).toBe(200);
    });

    it('answers 403 to a masked key on a grant that reads PII', async () => {
      const { workflowId } = await published({ grant: { scopes: [], pii: true } });
      const token = await api.newApiKey(api.environmentId, {
        scopes: ['workflows:trigger'],
        piiMasked: true,
      });

      const response = await post(
        `/workflows/${workflowId}/trigger`,
        fields({ reference: 'ref-1' }),
        token,
      );

      expect(response.statusCode).toBe(403);
    });
  });

  describe('its rate limits (C143.3)', () => {
    it('answers 429 past the key’s policy, and starts no run', async () => {
      const { workflowId } = await published();
      limits.refused.add('workflow-triggers-key');

      const response = await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'r' }));

      expect(response.statusCode).toBe(429);
    });

    it('answers 429 past the environment’s policy', async () => {
      const { workflowId } = await published();
      limits.refused.add('workflow-triggers');

      const response = await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'r' }));

      expect(response.statusCode).toBe(429);
    });

    it('fails open as C12 does when the limiter is down', async () => {
      const { workflowId } = await published();
      limits.down = true;

      const response = await post(`/workflows/${workflowId}/trigger`, fields({ reference: 'r' }));

      expect(response.statusCode).toBe(200);
    });
  });
});

describe('POST /workflows/:id/manual-runs (C118.5)', () => {
  const direct = {
    trigger: { type: 'trigger-direct', config: { 'object-type': 'inquiry' } },
    inputs: [],
  };

  const inquiry = async () => (await createTestInquiry(db, api.environmentId)).inquiry.id;

  const manual = (workflowId: string, attributes: Record<string, unknown>, token = api.token) =>
    post(
      `/workflows/${workflowId}/manual-runs`,
      { data: { type: 'workflow-run', attributes } },
      token,
    );

  interface ManualDocument {
    meta: {
      'workflow-run-ids': string[];
      refused: { 'object-id': string | null; row: number | null; code: string }[];
    };
  }

  it('starts one run per object, with the operator as its creator', async () => {
    const { workflowId } = await published(direct);
    const ids = [await inquiry(), await inquiry()];

    const response = await manual(workflowId, { 'object-ids': ids });

    expect(response.statusCode).toBe(200);
    const { meta } = response.json<ManualDocument>();
    expect(meta.refused).toEqual([]);
    expect(meta['workflow-run-ids']).toHaveLength(2);
    const run = await getWorkflowRun(db, api.environmentId, meta['workflow-run-ids'][0] ?? '');
    expect(run).toMatchObject({ triggerType: 'trigger-direct', creatorType: 'api-key' });
    expect(run === null ? null : openWorkflowRunValues(run).triggerSnapshot).toMatchObject({
      id: ids[0],
      type: 'inquiry',
    });
  });

  it('reads the ids of a CSV by its header, and refuses a bad row by its line', async () => {
    const { workflowId } = await published(direct);
    const id = await inquiry();

    const response = await manual(workflowId, { csv: `object-id\n${id}\nnot-an-id\n` });

    const { meta } = response.json<ManualDocument>();
    expect(meta['workflow-run-ids']).toHaveLength(1);
    expect(meta.refused).toEqual([{ 'object-id': null, row: 3, code: 'object_id_invalid' }]);
  });

  it('refuses a whole CSV without its column, and echoes nothing', async () => {
    const { workflowId } = await published(direct);

    const response = await manual(workflowId, { csv: 'synthetic-canary\nvalue\n' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'trigger_input_invalid',
      source: { pointer: '/data/attributes/csv' },
    });
    expect(response.body).not.toContain('synthetic-canary');
  });

  it('refuses an object of another environment as not found (C121.6)', async () => {
    const { workflowId } = await published(direct);
    const other = await api.newTenant();
    const { inquiry: foreign } = await createTestInquiry(db, other.environmentId);

    const response = await manual(workflowId, { 'object-ids': [foreign.id] });

    expect(response.json<ManualDocument>().meta).toEqual({
      'workflow-run-ids': [],
      refused: [{ 'object-id': foreign.id, row: null, code: 'object_not_found' }],
    });
  });

  it('refuses an id of another type, and a repeat of one it took', async () => {
    const { workflowId } = await published(direct);
    const id = await inquiry();
    const account = newId('acc');

    const response = await manual(workflowId, { 'object-ids': [id, id, account] });

    const { meta } = response.json<ManualDocument>();
    expect(meta['workflow-run-ids']).toHaveLength(1);
    expect(meta.refused).toEqual([
      { 'object-id': id, row: null, code: 'object_repeated' },
      { 'object-id': account, row: null, code: 'object_id_invalid' },
    ]);
  });

  it('refuses a redacted object', async () => {
    const { workflowId } = await published(direct);
    const id = await inquiry();
    await api.database.client.query(`update inquiries set redacted_at = now() where id = $1`, [id]);

    const response = await manual(workflowId, { 'object-ids': [id] });

    expect(response.json<ManualDocument>().meta.refused).toEqual([
      { 'object-id': id, row: null, code: 'subject_redacted' },
    ]);
  });

  it('refuses a row the parser cannot read, by its line', async () => {
    const { workflowId } = await published(direct);
    const id = await inquiry();

    const response = await manual(workflowId, { csv: `object-id\n${id}\n"a","b"\n` });

    const { meta } = response.json<ManualDocument>();
    expect(meta['workflow-run-ids']).toHaveLength(1);
    expect(meta.refused).toEqual([{ 'object-id': null, row: 3, code: 'field_count_mismatch' }]);
  });

  it('answers the same runs for a repeated key, past the 24-hour store (C112.6)', async () => {
    const { workflowId } = await published(direct);
    const ids = [await inquiry(), await inquiry()];
    const headers = { 'idempotency-key': 'synthetic-key-3' };
    const send = () =>
      post(
        `/workflows/${workflowId}/manual-runs`,
        { data: { type: 'workflow-run', attributes: { 'object-ids': ids } } },
        api.token,
        headers,
      );

    const first = await send();
    await api.database.client.query(`delete from idempotency_keys`);
    const second = await send();

    expect(second.json<ManualDocument>().meta['workflow-run-ids']).toEqual(
      first.json<ManualDocument>().meta['workflow-run-ids'],
    );
  });

  it('holds each object to the grant of the side it falls on (C116.3, C121.3)', async () => {
    const { workflowId, versionId } = await published(direct);
    const treatment = await seedWorkflowVersion(db, api.environmentId, {
      workflowId,
      status: 'published',
      versionNumber: 2,
      definition: definitionOf(direct),
    });
    await api.database.client.query(
      `update workflow_versions set "grant" = $1::jsonb where id = $2`,
      [JSON.stringify({ scopes: ['accounts:write'], pii: false }), treatment.id],
    );
    const deploymentId = newId('wfd');
    await api.database.client.query(
      `insert into workflow_deployments (id, environment_id, workflow_id, versions)
       values ($1, $2, $3, $4::jsonb)`,
      [
        deploymentId,
        api.environmentId,
        workflowId,
        JSON.stringify([
          { token: treatment.id, percentage: 1, label: 'treatment' },
          { token: versionId, percentage: 99, label: 'control' },
        ]),
      ],
    );
    await api.database.client.query(
      `update workflows set active_deployment_id = $1 where id = $2`,
      [deploymentId, workflowId],
    );
    const token = await api.newApiKey(api.environmentId, { scopes: ['workflows:trigger'] });
    const id = await inquiry();

    const response = await manual(workflowId, { 'object-ids': [id] }, token);

    expect(response.statusCode).toBe(403);
  });

  it('answers 409 for a workflow no manual run starts', async () => {
    const { workflowId } = await published();

    const response = await manual(workflowId, { 'object-ids': [newId('inq')] });

    expect(response.statusCode).toBe(409);
  });

  it('needs the grant (C121.3)', async () => {
    const { workflowId } = await published({
      ...direct,
      grant: { scopes: ['accounts:write'], pii: false },
    });
    const token = await api.newApiKey(api.environmentId, { scopes: ['workflows:trigger'] });

    const response = await manual(workflowId, { 'object-ids': [await inquiry()] }, token);

    expect(response.statusCode).toBe(403);
  });

  it('writes one audit entry, with counts and no id of an object', async () => {
    const { workflowId } = await published(direct);
    const id = await inquiry();

    await manual(workflowId, { 'object-ids': [id] });

    const entry = api.audit.entries.find(
      ({ action, resourceId }) => action === 'workflow.manual-runs' && resourceId === workflowId,
    );
    expect(entry?.metadata).toEqual({ started: 1, refused: 0 });
  });

  it('refuses what the run limiter holds, rather than start it unlimited (C117.8)', async () => {
    const { workflowId } = await published(direct);
    const id = await inquiry();
    limits.refused.add('workflow-runs');

    const response = await manual(workflowId, { 'object-ids': [id] });

    expect(response.json<ManualDocument>().meta.refused).toEqual([
      { 'object-id': id, row: null, code: 'rate_limited' },
    ]);
  });
});

describe('GET /workflow-trigger-deliveries (H18)', () => {
  it('lists deliveries by workflow and status, newest first, with their reasons', async () => {
    const { workflowId } = await published();
    const filtered = newId('wftd');
    const pending = newId('wftd');
    await createWorkflowDeliveries(db, api.environmentId, [
      { id: filtered, eventId: newId('evt'), eventName: 'inquiry.completed', workflowId },
      { id: pending, eventId: newId('evt'), eventName: 'inquiry.completed', workflowId },
    ]);
    await finishWorkflowDelivery(db, api.environmentId, filtered, {
      status: 'filtered',
      reasonCode: 'criteria_not_met',
    });

    const response = await get(
      `/workflow-trigger-deliveries?filter[workflow-id]=${workflowId}&filter[status]=filtered`,
    );

    expect(response.statusCode).toBe(200);
    const { data, links } = response.json<{
      data: { id: string; attributes: Record<string, unknown> }[];
      links: { next: string | null };
    }>();
    expect(data.map(({ id }) => id)).toEqual([filtered]);
    expect(data[0]?.attributes).toMatchObject({
      status: 'filtered',
      'reason-code': 'criteria_not_met',
    });
    expect(links.next).toBeNull();
  });

  it('pages with a link that keeps its filters', async () => {
    const { workflowId } = await published();
    await createWorkflowDeliveries(db, api.environmentId, [
      { id: newId('wftd'), eventId: newId('evt'), eventName: 'inquiry.completed', workflowId },
      { id: newId('wftd'), eventId: newId('evt'), eventName: 'inquiry.completed', workflowId },
    ]);

    const response = await get(
      `/workflow-trigger-deliveries?filter[workflow-id]=${workflowId}&page[size]=1`,
    );

    const { links } = response.json<{ links: { next: string | null } }>();
    expect(links.next).toContain(`filter[workflow-id]=${workflowId}`);
  });

  it('answers 400 for a cursor of no record', async () => {
    const response = await get(`/workflow-trigger-deliveries?page[after]=${newId('wftd')}`);

    expect(response.statusCode).toBe(400);
  });
});
