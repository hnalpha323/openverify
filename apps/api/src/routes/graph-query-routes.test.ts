/**
 * C102, C103 (Workflow 7B, `api-graph`): the graph routes built, on PGlite through the HTTP API.
 *
 * - Templates and versions as C71: a draft comes with a template, drafts change, publish refuses a
 *   weak kind without the flag and an unbound parameter with pointers, and supersedes.
 * - Queries: a person-identifying parameter needs `pii:view` (P11); an asynchronous run answers
 *   `submitted` and is enqueued, the job stores the result; `meta.run-sync` answers it; property
 *   node ids are random and local (P17); `params` are masked member-wise without `pii:view`;
 *   cancel, rerun; events carry no parameter or node (C107.5); the C12 policies.
 * - The audited unmask (C102.6), and the bulk actions of C103 with their scopes, selection,
 *   idempotent replay, per-account outcomes and the export's neutraliser.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { graphKindCode, type GraphKind } from '@openverify/core';
import {
  createAccount,
  createList,
  getAccount,
  identifierKey,
  type IdentifierKeyKind,
} from '@openverify/db';
import { seedGraphAttribute, seedGraphQuery, seedGraphQueryTemplate } from '@openverify/db/testing';
import { newId } from '@openverify/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { processGraphQuery } from '../jobs/graph/query.js';
import { createCapturingLogger } from '../jobs/testing.js';
import type { RateLimiter } from '../ports.js';
import { useGraphIndexKey } from '../services/graph/keys.js';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import {
  createAllowAllRateLimiter,
  createRecordingGraphQueryQueue,
  createFakeListService,
  type FakeListService,
  type RecordingGraphQueryQueue,
} from '../test-support/fakes.js';
import { bearer } from '../test-support/harness.js';

let api: InquiryTestApi;
let queries: RecordingGraphQueryQueue;
let lists: FakeListService;
const denied = new Set<string>();

beforeAll(async () => {
  queries = createRecordingGraphQueryQueue();
  const allow = createAllowAllRateLimiter();
  const limiter: RateLimiter = {
    consume: async (key, policy) => {
      const decision = await allow.consume(key, policy);
      return denied.has(policy.name)
        ? { ...decision, allowed: false, retryAfterSeconds: 9 }
        : decision;
    },
  };
  lists = createFakeListService();
  api = await createInquiryTestApi({
    graphQueries: queries,
    rateLimiter: limiter,
    listService: lists,
  });
  useGraphIndexKey(api.deps.blindIndexKey);
}, 120_000);

afterAll(async () => {
  useGraphIndexKey(undefined);
  await api.close();
});

beforeEach(() => {
  denied.clear();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const call = (
  method: Method,
  url: string,
  payload?: unknown,
  token = api.token,
  headers: Record<string, string> = {},
) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(token), ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const body = (attributes: Record<string, unknown>, meta?: Record<string, unknown>) => ({
  data: { attributes },
  ...(meta === undefined ? {} : { meta }),
});

const EMAIL_CONFIG = {
  parameters: [{ name: 'email', kind: 'email_address' }],
  start: [{ kind: 'email_address', value: '{{email}}' }],
  'connect-kinds': ['email_address', 'phone_number'],
};

const ACCOUNT_CONFIG = {
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address', 'phone_number'],
};

interface Document {
  data: {
    id: string;
    attributes: Record<string, unknown>;
    relationships?: Record<string, { data: unknown }>;
  };
}

async function publishedTemplate(config: Record<string, unknown> = EMAIL_CONFIG): Promise<string> {
  const created = await call('POST', '/graph-query-templates', body({ name: 'Shared', config }));
  expect(created.statusCode).toBe(201);
  const template = created.json<Document>().data;
  const draft = (template.relationships?.['published-version']?.data as { id: string } | null)?.id;
  expect(draft).toBeUndefined();
  const versions = (await api.database.db.execute(
    sql`select id from graph_query_template_versions where graph_query_template_id = ${template.id}`,
  )) as unknown as { rows: { id: string }[] };
  const versionId = versions.rows[0]?.id ?? '';
  expect(
    (await call('POST', `/graph-query-template-versions/${versionId}/publish`)).statusCode,
  ).toBe(200);
  return template.id;
}

const keyOf = (kind: IdentifierKeyKind, input: string) =>
  identifierKey(api.deps.blindIndexKey, { environmentId: api.environmentId, kind, input });

/** Two accounts sharing a confirmed email, and a third sharing a phone number key with the second. */
async function sharedEmailGraph() {
  const db = api.database.db;
  const environmentId = api.environmentId;
  const [a, b, c] = await Promise.all(
    [0, 1, 2].map(() => createAccount(db, environmentId, { id: newId('acc') })),
  );
  const email = `shared-${randomBytes(4).toString('hex')}@example.com`;
  const seed = (accountId: string, kind: GraphKind, valueKey: string) =>
    seedGraphAttribute(db, environmentId, { accountId, kind: graphKindCode(kind), valueKey });
  await seed(a?.id ?? '', 'email_address', keyOf('identifier-email', email));
  await seed(b?.id ?? '', 'email_address', keyOf('identifier-email', email));
  const phoneKey = randomBytes(32).toString('hex');
  await seed(b?.id ?? '', 'phone_number', phoneKey);
  await seed(c?.id ?? '', 'phone_number', phoneKey);
  return { a: a?.id ?? '', b: b?.id ?? '', c: c?.id ?? '', email };
}

const runJob = (id: string) =>
  processGraphQuery(
    { environmentId: api.environmentId, graphQueryId: id },
    { db: api.database.db, clock: api.clock, logger: createCapturingLogger(), events: api.events },
  );

describe('graph query templates and versions (C102.1, C102.2)', () => {
  it('creates a template with a draft, renames, archives, and lists newest first', async () => {
    const created = await call(
      'POST',
      '/graph-query-templates',
      body({ name: 'One', config: EMAIL_CONFIG }),
    );
    expect(created.statusCode).toBe(201);
    const template = created.json<Document>().data;
    expect(template.attributes).toMatchObject({
      name: 'One',
      status: 'active',
      'latest-version': 1,
      'published-version': null,
    });

    const renamed = await call(
      'PATCH',
      `/graph-query-templates/${template.id}`,
      body({ name: 'Two' }),
    );
    expect(renamed.json<Document>().data.attributes.name).toBe('Two');
    expect((await call('GET', `/graph-query-templates/${template.id}`)).statusCode).toBe(200);
    const listed = await call('GET', '/graph-query-templates?filter[status]=active');
    expect(listed.json<{ data: { id: string }[] }>().data.map(({ id }) => id)).toContain(
      template.id,
    );

    const archived = await call('DELETE', `/graph-query-templates/${template.id}`);
    expect(archived.json<Document>().data.attributes.status).toBe('archived');
    expect(
      (await call('GET', '/graph-query-templates/grqt_01M5CK16P0D13FXHZSS4TCFBVH')).statusCode,
    ).toBe(404);
  });

  it('changes a draft, refuses what publish refuses with pointers, publishes and supersedes', async () => {
    const templateId = await publishedTemplate();
    const draft = await call(
      'POST',
      '/graph-query-template-versions',
      body({ 'graph-query-template-id': templateId, config: EMAIL_CONFIG }),
    );
    expect(draft.statusCode).toBe(201);
    const version = draft.json<Document>().data;
    expect(version.attributes).toMatchObject({ 'version-number': 2, status: 'draft' });

    const weak = await call(
      'PATCH',
      `/graph-query-template-versions/${version.id}`,
      body({ config: { ...EMAIL_CONFIG, 'connect-kinds': ['email_address', 'ip_address'] } }),
    );
    expect(weak.statusCode).toBe(200);
    const refused = await call('POST', `/graph-query-template-versions/${version.id}/publish`);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({
      code: 'weak_kind_not_allowed',
      errors: [expect.objectContaining({ pointer: '/data/attributes/config/connect-kinds/1' })],
    });

    await call(
      'PATCH',
      `/graph-query-template-versions/${version.id}`,
      body({ config: { ...EMAIL_CONFIG, start: [{ kind: 'email_address', value: '{{other}}' }] } }),
    );
    expect(
      (await call('POST', `/graph-query-template-versions/${version.id}/publish`)).json(),
    ).toMatchObject({
      code: 'graph_parameter_unbound',
    });

    await call(
      'PATCH',
      `/graph-query-template-versions/${version.id}`,
      body({ config: EMAIL_CONFIG }),
    );
    const published = await call('POST', `/graph-query-template-versions/${version.id}/publish`);
    expect(published.json<Document>().data.attributes.status).toBe('published');
    expect(
      (
        await call(
          'PATCH',
          `/graph-query-template-versions/${version.id}`,
          body({ config: EMAIL_CONFIG }),
        )
      ).json(),
    ).toMatchObject({ code: 'graph_template_version_not_draft' });
    const template = await call('GET', `/graph-query-templates/${templateId}`);
    expect(template.json<Document>().data.attributes).toMatchObject({
      'latest-version': 2,
      'published-version': 2,
    });
  });
});

describe('running a graph query (C102.3, C102.4)', () => {
  it('answers submitted, enqueues the run, and the job stores a result with random node ids', async () => {
    const graph = await sharedEmailGraph();
    const templateId = await publishedTemplate();

    const created = await call(
      'POST',
      '/graph-queries',
      body({ 'graph-query-template-id': templateId, 'parameter-map': { email: graph.email } }),
    );

    expect(created.statusCode).toBe(201);
    const query = created.json<Document>().data;
    expect(query.attributes).toMatchObject({
      status: 'submitted',
      nodes: [],
      params: { email: graph.email },
    });
    expect(queries.jobs).toContainEqual({
      environmentId: api.environmentId,
      graphQueryId: query.id,
    });
    expect(api.events.named('graph-query.submitted').at(-1)?.payload).toMatchObject({
      data: { id: query.id, attributes: { params: null, nodes: [], links: [] } },
    });

    expect(await runJob(query.id)).toEqual({ status: 'completed' });

    const read = (await call('GET', `/graph-queries/${query.id}`)).json<Document>().data;
    const nodes = read.attributes.nodes as { type: string; value: string }[];
    expect(
      nodes
        .filter((node) => node.type === 'account')
        .map((node) => node.value)
        .sort(),
    ).toEqual([graph.a, graph.b, graph.c].sort());
    const properties = nodes.filter((node) => node.type !== 'account');
    expect(properties.length).toBeGreaterThanOrEqual(2);
    for (const node of properties) {
      expect(node.value).toMatch(/^gn_[A-Za-z0-9_-]{22}$/);
    }
    expect(JSON.stringify(read)).not.toContain(keyOf('identifier-email', graph.email));
    expect(read.attributes).toMatchObject({
      status: 'completed',
      'index-complete': true,
      'node-limit-reached': false,
      'skipped-hub-values': 0,
    });
    expect(
      (read.relationships?.accounts?.data as { id: string }[]).map(({ id }) => id).sort(),
    ).toEqual([graph.a, graph.b, graph.c].sort());
    const completed = api.events.named('graph-query.completed').at(-1);
    expect(completed?.payload).toMatchObject({ data: { attributes: { params: null, nodes: [] } } });
  });

  it('answers the result at once with meta.run-sync, two hops counted the public way', async () => {
    const graph = await sharedEmailGraph();
    const templateId = await publishedTemplate({ ...ACCOUNT_CONFIG, 'max-hops': 2 });

    const created = await call(
      'POST',
      '/graph-queries',
      body(
        { 'graph-query-template-id': templateId, 'parameter-map': { account_id: graph.a } },
        {
          'run-sync': true,
        },
      ),
    );

    expect(created.statusCode).toBe(201);
    const query = created.json<Document>().data;
    expect(query.attributes.status).toBe('completed');
    const accounts = (query.attributes.nodes as { type: string; value: string }[])
      .filter((node) => node.type === 'account')
      .map((node) => node.value);
    expect(accounts.sort()).toEqual([graph.a, graph.b].sort());
  });

  it('needs pii:view for a person-identifying parameter, and masks params member-wise without it', async () => {
    const graph = await sharedEmailGraph();
    const emailTemplate = await publishedTemplate();
    const accountTemplate = await publishedTemplate(ACCOUNT_CONFIG);
    const writer = api.newUserToken(api.environmentId, {
      permissions: ['graph:write', 'graph:read'],
    });

    const refused = await call(
      'POST',
      '/graph-queries',
      body({ 'graph-query-template-id': emailTemplate, 'parameter-map': { email: graph.email } }),
      writer,
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'graph_parameter_not_allowed' });

    const allowed = await call(
      'POST',
      '/graph-queries',
      body({
        'graph-query-template-id': accountTemplate,
        'parameter-map': { account_id: graph.a },
      }),
      writer,
    );
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json<Document>().data.attributes.params).toEqual({ account_id: null });
  });

  it('refuses a missing parameter, an archived template and one never published', async () => {
    const templateId = await publishedTemplate();
    expect(
      (
        await call(
          'POST',
          '/graph-queries',
          body({ 'graph-query-template-id': templateId, 'parameter-map': {} }),
        )
      ).json(),
    ).toMatchObject({ code: 'graph_parameter_missing' });

    const draftOnly = (
      await call('POST', '/graph-query-templates', body({ name: 'Draft', config: EMAIL_CONFIG }))
    ).json<Document>().data.id;
    const run = (id: string) =>
      call(
        'POST',
        '/graph-queries',
        body({ 'graph-query-template-id': id, 'parameter-map': { email: 'x@example.com' } }),
      );
    expect((await run(draftOnly)).json()).toMatchObject({ code: 'graph_template_not_published' });
    await call('DELETE', `/graph-query-templates/${templateId}`);
    expect((await run(templateId)).json()).toMatchObject({ code: 'graph_template_archived' });
  });

  it('cancels a submitted query once, and a rerun goes back to submitted with its event', async () => {
    const graph = await sharedEmailGraph();
    const templateId = await publishedTemplate();
    const submit = async () =>
      (
        await call(
          'POST',
          '/graph-queries',
          body({ 'graph-query-template-id': templateId, 'parameter-map': { email: graph.email } }),
        )
      ).json<Document>().data.id;

    const cancelled = await submit();
    expect(
      (await call('POST', `/graph-queries/${cancelled}/cancel`)).json<Document>().data.attributes
        .status,
    ).toBe('cancelled');
    expect((await call('POST', `/graph-queries/${cancelled}/cancel`)).json()).toMatchObject({
      code: 'graph_query_not_cancellable',
    });
    expect(await runJob(cancelled)).toEqual({ status: 'cancelled' });

    const done = await submit();
    await runJob(done);
    const rerun = await call('POST', `/graph-queries/${done}/rerun`);
    expect(rerun.json<Document>().data.attributes).toMatchObject({
      status: 'submitted',
      nodes: [],
    });
    expect(api.events.named('graph-query.reran').at(-1)?.payload).toMatchObject({
      data: { id: done },
    });
    expect(await runJob(done)).toEqual({ status: 'completed' });
  });

  it('applies the graph-queries policy per environment (C107.3)', async () => {
    const templateId = await publishedTemplate();
    denied.add('graph-queries');

    const limited = await call(
      'POST',
      '/graph-queries',
      body({ 'graph-query-template-id': templateId, 'parameter-map': { email: 'x@example.com' } }),
    );

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('9');
  });

  it('lists newest first and filters by template', async () => {
    const graph = await sharedEmailGraph();
    const templateId = await publishedTemplate();
    const id = (
      await call(
        'POST',
        '/graph-queries',
        body({ 'graph-query-template-id': templateId, 'parameter-map': { email: graph.email } }),
      )
    ).json<Document>().data.id;

    const listed = await call(
      'GET',
      `/graph-queries?filter[graph-query-template-id]=${templateId}`,
    );
    expect(listed.json<{ data: { id: string }[] }>().data.map((query) => query.id)).toEqual([id]);
  });
});

async function completedQuery() {
  const graph = await sharedEmailGraph();
  const templateId = await publishedTemplate();
  const id = (
    await call(
      'POST',
      '/graph-queries',
      body({ 'graph-query-template-id': templateId, 'parameter-map': { email: graph.email } }),
    )
  ).json<Document>().data.id;
  await runJob(id);
  const nodes = (await call('GET', `/graph-queries/${id}`)).json<Document>().data.attributes
    .nodes as { type: string; value: string }[];
  return { graph, id, nodes };
}

describe('the audited unmask (C102.6, P17)', () => {
  it('answers the start value with pii:view and audits it; needs pii:view; 404 for a node not in the result', async () => {
    const { graph, id, nodes } = await completedQuery();
    const start = nodes.find((node) => node.type === 'email_address');

    const unmasked = await call('GET', `/graph-queries/${id}/nodes/${start?.value ?? ''}/value`);

    expect(unmasked.statusCode).toBe(200);
    expect(unmasked.json()).toEqual({
      data: {
        type: 'graph-node-value',
        id: start?.value,
        attributes: { kind: 'email_address', value: graph.email },
      },
    });
    expect(api.audit.withAction('graph-query.node-unmasked').at(-1)).toMatchObject({
      resourceId: id,
      metadata: { 'node-id': start?.value, kind: 'email_address' },
    });
    expect(JSON.stringify(api.audit.entries)).not.toContain(graph.email);
    const reader = api.newUserToken(api.environmentId, { permissions: ['graph:read'] });
    expect(
      (
        await call(
          'GET',
          `/graph-queries/${id}/nodes/${start?.value ?? ''}/value`,
          undefined,
          reader,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('GET', `/graph-queries/${id}/nodes/gn_AAAAAAAAAAAAAAAAAAAAAA/value`)).json(),
    ).toMatchObject({ code: 'graph_node_not_found' });
  });

  it('applies the graph-unmask policy per principal, and answers 410 once redacted', async () => {
    const { id, nodes } = await completedQuery();
    const node = nodes.find((candidate) => candidate.type !== 'account')?.value ?? '';
    denied.add('graph-unmask');
    expect((await call('GET', `/graph-queries/${id}/nodes/${node}/value`)).statusCode).toBe(429);
    denied.clear();

    await api.database.db.execute(sql`update graph_queries set params = null, nodes = '[]',
      links = '[]', node_map = '{}', account_ids = '{}', redacted_at = now() where id = ${id}`);
    expect((await call('GET', `/graph-queries/${id}/nodes/${node}/value`)).json()).toMatchObject({
      code: 'graph_query_redacted',
    });
  });
});

const action = (id: string, attributes: Record<string, unknown>, key?: string, token = api.token) =>
  call(
    'POST',
    `/graph-queries/${id}/actions`,
    body(attributes),
    token,
    key === undefined ? {} : { 'idempotency-key': key },
  );

describe('bulk actions (C103)', () => {
  it('previews counts over the intersection with the result, and needs an Idempotency-Key to act', async () => {
    const { graph, id } = await completedQuery();
    const outside = (await createAccount(api.database.db, api.environmentId, { id: newId('acc') }))
      .id;

    const preview = await action(id, {
      action: 'add-tag',
      tag: 'linked',
      'account-ids': [graph.a, outside],
      preview: true,
    });
    expect(preview.json()).toEqual({
      data: {
        type: 'graph-query-action',
        attributes: { action: 'add-tag', preview: true, 'selected-count': 1, outcomes: [] },
      },
    });
    expect((await action(id, { action: 'add-tag', tag: 'linked', all: true })).statusCode).toBe(
      400,
    );
  });

  it('previews a case holding the selection under cases:write, and makes none on a template this environment does not hold (C140.6)', async () => {
    const { graph, id } = await completedQuery();
    const template = newId('ctmpl');
    const create = { action: 'create-case', 'case-template-id': template, all: true };

    const preview = await action(id, { ...create, preview: true });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      data: { attributes: { action: 'create-case', preview: true, 'selected-count': 3 } },
    });
    expect((await action(id, create, `case-${randomBytes(4).toString('hex')}`)).statusCode).toBe(
      404,
    );
    expect((await getAccount(api.database.db, api.environmentId, graph.a))?.tags).toEqual([]);

    const reader = api.newUserToken(api.environmentId, { permissions: ['graph:read'] });
    expect((await action(id, { ...create, preview: true }, undefined, reader)).statusCode).toBe(
      403,
    );
  });

  it('tags each selected account with its own scope, replays idempotently, and skips the redacted and consolidated', async () => {
    const { graph, id } = await completedQuery();
    await api.database.db.execute(
      sql`update accounts set redacted_at = now() where id = ${graph.c}`,
    );
    await api.database.db.execute(
      sql`update accounts set status = 'archived', consolidated_into = ${graph.a} where id = ${graph.b}`,
    );
    const key = `bulk-${randomBytes(4).toString('hex')}`;

    const done = await action(id, { action: 'add-tag', tag: 'linked', all: true }, key);
    expect(done.statusCode).toBe(200);
    const outcomes = done.json<{ data: { attributes: { outcomes: unknown[] } } }>().data.attributes
      .outcomes;
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { 'account-id': graph.a, outcome: 'done' },
        { 'account-id': graph.b, outcome: 'skipped_consolidated' },
        { 'account-id': graph.c, outcome: 'skipped_redacted' },
      ]),
    );
    expect((await getAccount(api.database.db, api.environmentId, graph.a))?.tags).toEqual([
      'linked',
    ]);
    const replay = await action(id, { action: 'add-tag', tag: 'linked', all: true }, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(api.audit.withAction('graph-query.action').at(-1)).toMatchObject({
      resourceType: 'graph-query',
      resourceId: id,
      metadata: { action: 'add-tag', 'selected-count': 3 },
    });

    const reader = api.newUserToken(api.environmentId, { permissions: ['graph:read'] });
    expect(
      (
        await action(
          id,
          { action: 'set-account-status', status: 'archived', all: true },
          'other',
          reader,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('refuses all: true over 500 accounts, and a biometric list', async () => {
    const template = await seedGraphQueryTemplate(api.database.db, api.environmentId);
    const many = await seedGraphQuery(api.database.db, api.environmentId, {
      graphQueryTemplateId: template.id,
      graphQueryTemplateVersionId: template.versionId,
      accountIds: Array.from({ length: 501 }, () => newId('acc')),
    });
    expect(
      (await action(many.id, { action: 'export', all: true, preview: true })).json(),
    ).toMatchObject({
      code: 'selection_too_large',
    });

    const { id } = await completedQuery();
    const faces = await createList(api.database.db, api.environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });
    expect(
      (
        await action(
          id,
          { action: 'add-to-list', 'list-id': faces.id, kind: 'email_address', all: true },
          'faces',
        )
      ).json(),
    ).toMatchObject({ code: 'biometric_list_not_bulk' });
  });

  it('exports a CSV of the selection with the neutraliser, under accounts:read and pii:view', async () => {
    const { graph, id } = await completedQuery();
    await api.database.db.execute(
      sql`update accounts set reference_id = '=HYPERLINK(1)' where id = ${graph.a}`,
    );

    const exported = await action(id, { action: 'export', 'account-ids': [graph.a] }, 'export-a');

    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toBe('text/csv; charset=utf-8');
    const lines = exported.body.split('\r\n');
    expect(lines[0]).toBe(
      '"account-id","reference-id","status","tags","hop-distance","linking-kinds"',
    );
    expect(lines[1]).toContain(`"${graph.a}","'=HYPERLINK(1)","active"`);
    const masked = api.newUserToken(api.environmentId, {
      permissions: ['graph:read', 'accounts:read'],
    });
    expect((await action(id, { action: 'export', all: true }, 'export-b', masked)).statusCode).toBe(
      403,
    );
  });
});

describe('values opened from their sources (C102.6, C103.2)', () => {
  /** Two accounts whose typed emails the indexer keyed at POST /accounts, in one result. */
  async function indexedPair() {
    const email = `typed-${randomBytes(4).toString('hex')}@example.org`;
    const create = async () =>
      (await call('POST', '/accounts', body({ fields: { email_address: email } }))).json<Document>()
        .data.id;
    const [a, b] = [await create(), await create()];
    const templateId = await publishedTemplate({
      ...ACCOUNT_CONFIG,
      'connect-kinds': ['email_address_unconfirmed'],
    });
    const id = (
      await call(
        'POST',
        '/graph-queries',
        body(
          { 'graph-query-template-id': templateId, 'parameter-map': { account_id: a } },
          {
            'run-sync': true,
          },
        ),
      )
    ).json<Document>().data.id;
    const nodes = (await call('GET', `/graph-queries/${id}`)).json<Document>().data.attributes
      .nodes as { type: string; value: string }[];
    return { email, a, b, id, nodes };
  }

  it('unmasks a linking value from an account that holds it', async () => {
    const { email, a, b, id, nodes } = await indexedPair();
    expect(
      nodes
        .filter((node) => node.type === 'account')
        .map((node) => node.value)
        .sort(),
    ).toEqual([a, b].sort());
    const shared = nodes.find((node) => node.type === 'email_address_unconfirmed')?.value ?? '';

    const unmasked = await call('GET', `/graph-queries/${id}/nodes/${shared}/value`);

    expect(unmasked.json()).toMatchObject({
      data: { attributes: { kind: 'email_address_unconfirmed', value: email } },
    });
  });

  it('adds the selected accounts’ values of a kind to a list, and sets their status', async () => {
    const { email, a, b, id } = await indexedPair();
    const list = await createList(api.database.db, api.environmentId, {
      id: newId('lst'),
      type: 'email-address',
      name: 'Linked',
    });

    const added = await action(
      id,
      { action: 'add-to-list', 'list-id': list.id, kind: 'email_address_unconfirmed', all: true },
      `list-${id}`,
    );
    expect(added.statusCode).toBe(200);
    expect(lists.created.filter((created) => created.listId === list.id)).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({
          attributes: { value: email, 'match-type': 'email_address' },
        }) as unknown,
      }),
      expect.objectContaining({ listId: list.id }),
    ]);
    expect(
      (
        await action(
          id,
          { action: 'add-to-list', 'list-id': list.id, kind: 'phone_number', all: true },
          `phone-${id}`,
        )
      ).statusCode,
    ).toBe(422);

    const archived = await action(
      id,
      { action: 'set-account-status', status: 'archived', all: true },
      `status-${id}`,
    );
    expect(
      archived.json<{ data: { attributes: { outcomes: unknown[] } } }>().data.attributes.outcomes,
    ).toEqual(
      expect.arrayContaining([
        { 'account-id': a, outcome: 'done' },
        { 'account-id': b, outcome: 'done' },
      ]),
    );
    expect((await getAccount(api.database.db, api.environmentId, a))?.status).toBe('archived');
    const removed = await action(id, { action: 'remove-tag', tag: 'none', all: true }, `tag-${id}`);
    expect(removed.statusCode).toBe(200);
  });
});
