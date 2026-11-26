/**
 * Owner decision 20 after Workflow 7B, built in Workflow 9B (`api-cases-reports`; contracts B42,
 * foundation-9b C11): `POST /api/v1/graph-queries/:id/nodes/:nodeId/expand` starts a new graph query
 * from a stored property node of a query's result.
 *
 * - It reads the node's `{ kind, valueKey, keyId }` from the source query's `node_map`, never opens a
 *   sealed value and never sends a value key, and searches one hop: the accounts holding the value,
 *   under the source's pinned template version, the fan-out cap and its hub rule and the node limit.
 *   The start node keeps the expanded node's id, so the console merges it onto that node.
 * - A key made under a blind-index key that is no longer current answers the honest empty state:
 *   the node's kind is listed in `kinds-not-indexed` (`index-complete: false`), never "no accounts"
 *   read as complete.
 * - Refusals: an unknown query or node 404, a redacted source 410, an account node 422, a
 *   person-identifying kind without `pii:view` 403, past the `graph-queries` policy 429.
 * - Audited and evented as a run; the new query is redacted by `graph-query-retention-days` like
 *   any query.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import { graphKindCode, type GraphKind } from '@openverify/core';
import {
  createAccount,
  identifierKey,
  redactExpiredGraphQueries,
  type IdentifierKeyKind,
} from '@openverify/db';
import { seedGraphAttribute } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import {
  createAllowAllRateLimiter,
  createRecordingEventPublisher,
  createRecordingGraphQueryQueue,
  type RecordingGraphQueryQueue,
} from '../../test-support/fakes.js';
import { bearer } from '../../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { processGraphQuery } from '../../jobs/graph/query.js';
import { createCapturingLogger } from '../../jobs/testing.js';
import { isExpansionStart } from './expand.js';
import { useGraphIndexKey } from './keys.js';

let api: InquiryTestApi;
let queries: RecordingGraphQueryQueue;
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
  api = await createInquiryTestApi({ graphQueries: queries, rateLimiter: limiter });
  useGraphIndexKey(api.deps.blindIndexKey);
}, 120_000);

afterAll(async () => {
  useGraphIndexKey(undefined);
  await api.close();
});

beforeEach(() => {
  denied.clear();
});

const call = (method: 'GET' | 'POST', url: string, payload?: unknown, token = api.token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

interface Document {
  data: {
    id: string;
    attributes: {
      status: string;
      nodes: { type: string; value: string }[];
      links: { from: string; to: string; kind: string }[];
      'kinds-not-indexed': string[];
      'index-complete': boolean;
      'template-version-id': string;
      'redacted-at': string | null;
    };
    relationships?: Record<string, { data: unknown }>;
  };
}

const ACCOUNT_CONFIG = {
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address', 'phone_number'],
};

async function publishedTemplate(): Promise<string> {
  const created = await call('POST', '/graph-query-templates', {
    data: { attributes: { name: 'Expand', config: ACCOUNT_CONFIG } },
  });
  expect(created.statusCode, created.body).toBe(201);
  const templateId = created.json<Document>().data.id;
  const versions = (await api.database.db.execute(
    sql`select id from graph_query_template_versions where graph_query_template_id = ${templateId}`,
  )) as unknown as { rows: { id: string }[] };
  const versionId = versions.rows[0]?.id ?? '';
  expect(
    (await call('POST', `/graph-query-template-versions/${versionId}/publish`)).statusCode,
  ).toBe(200);
  return templateId;
}

const keyOf = (kind: IdentifierKeyKind, input: string) =>
  identifierKey(api.deps.blindIndexKey, { environmentId: api.environmentId, kind, input });

/** Two accounts sharing an email, and a third holding a phone number of the second. */
async function sharedEmailGraph() {
  const { db } = api.database;
  const [a, b, c] = await Promise.all(
    [0, 1, 2].map(() => createAccount(db, api.environmentId, { id: newId('acc') })),
  );
  const email = `shared-${randomBytes(4).toString('hex')}@example.com`;
  const seed = (accountId: string, kind: GraphKind, valueKey: string) =>
    seedGraphAttribute(db, api.environmentId, { accountId, kind: graphKindCode(kind), valueKey });
  await seed(a?.id ?? '', 'email_address', keyOf('identifier-email', email));
  await seed(b?.id ?? '', 'email_address', keyOf('identifier-email', email));
  const phoneKey = randomBytes(32).toString('hex');
  await seed(b?.id ?? '', 'phone_number', phoneKey);
  await seed(c?.id ?? '', 'phone_number', phoneKey);
  return {
    a: a?.id ?? '',
    b: b?.id ?? '',
    c: c?.id ?? '',
    emailKey: keyOf('identifier-email', email),
  };
}

/** A completed source query from account a, and the id of its shared email node. */
async function sourceQuery() {
  const templateId = await publishedTemplate();
  const graph = await sharedEmailGraph();
  const ran = await call('POST', '/graph-queries', {
    data: {
      attributes: {
        'graph-query-template-id': templateId,
        'parameter-map': { account_id: graph.a },
      },
    },
    meta: { 'run-sync': true },
  });
  expect(ran.statusCode, ran.body).toBe(201);
  const source = ran.json<Document>().data;
  const emailNode = source.attributes.nodes.find(({ type }) => type === 'email_address');
  expect(emailNode).toBeDefined();
  return { graph, source, emailNodeId: emailNode?.value ?? '' };
}

const expand = (id: string, nodeId: string, meta?: Record<string, unknown>, token = api.token) =>
  call(
    'POST',
    `/graph-queries/${id}/nodes/${nodeId}/expand`,
    meta === undefined ? {} : { meta },
    token,
  );

describe('expanding a property node (owner decision 20 after 7B; B42)', () => {
  it('runs one hop from the stored key: both accounts holding the shared email, the start node kept', async () => {
    const { graph, source, emailNodeId } = await sourceQuery();
    const submittedBefore = api.events.named('graph-query.submitted').length;

    const response = await expand(source.id, emailNodeId, { 'run-sync': true });

    expect(response.statusCode, response.body).toBe(201);
    const expanded = response.json<Document>().data;
    expect(expanded.id).not.toBe(source.id);
    expect(expanded.attributes).toMatchObject({
      status: 'completed',
      'template-version-id': source.attributes['template-version-id'],
      'index-complete': true,
    });
    expect(expanded.attributes.nodes).toEqual(
      expect.arrayContaining([
        { type: 'email_address', value: emailNodeId },
        { type: 'account', value: graph.a },
        { type: 'account', value: graph.b },
      ]),
    );
    expect(expanded.attributes.nodes).toHaveLength(3);
    expect(expanded.attributes.nodes.map(({ value }) => value)).not.toContain(graph.c);
    expect(response.body).not.toContain(graph.emailKey);
    expect(response.body).not.toContain('valueKey');
    expect(api.events.named('graph-query.submitted').length).toBe(submittedBefore + 1);
    expect(
      api.audit
        .withAction('graph-query.submitted')
        .filter(({ resourceId }) => resourceId === expanded.id)
        .map(({ metadata }) => metadata),
    ).toEqual([
      {
        'graph-query-template-version-id': source.attributes['template-version-id'],
        'run-sync': true,
        'expanded-from': source.id,
      },
    ]);
  });

  it('is submitted and enqueued without run-sync, starting from the stored key', async () => {
    const { source, emailNodeId } = await sourceQuery();
    const enqueued = queries.jobs.length;

    const response = await expand(source.id, emailNodeId);

    expect(response.statusCode, response.body).toBe(201);
    const expanded = response.json<Document>().data;
    expect(expanded.attributes.status).toBe('submitted');
    expect(queries.jobs.slice(enqueued).map(({ graphQueryId }) => graphQueryId)).toEqual([
      expanded.id,
    ]);
    const stored = (await api.database.db.execute(
      sql`select node_map from graph_queries where id = ${expanded.id}`,
    )) as unknown as { rows: { node_map: Record<string, { start?: boolean; kind?: number }> }[] };
    expect(stored.rows[0]?.node_map[emailNodeId]).toMatchObject({
      start: true,
      kind: graphKindCode('email_address'),
    });
    // The job and the rerun know an expansion by its start: a value no parameter bound.
    const sourceMap = (await api.database.db.execute(
      sql`select node_map from graph_queries where id = ${source.id}`,
    )) as unknown as { rows: { node_map: Record<string, unknown> }[] };
    expect(isExpansionStart(stored.rows[0]?.node_map ?? {})).toBe(true);
    expect(isExpansionStart(sourceMap.rows[0]?.node_map ?? {})).toBe(false);
  });

  it('runs one hop when the job runs it asynchronously, as the synchronous run does (integration-9b)', async () => {
    const { graph, source, emailNodeId } = await sourceQuery();
    const expanded = (await expand(source.id, emailNodeId)).json<Document>().data;

    const outcome = await processGraphQuery(
      { environmentId: api.environmentId, graphQueryId: expanded.id },
      {
        db: api.database.db,
        clock: api.clock,
        logger: createCapturingLogger(),
        events: createRecordingEventPublisher(),
      },
    );

    expect(outcome.status).toBe('completed');
    const read = (await call('GET', `/graph-queries/${expanded.id}`)).json<Document>().data;
    expect(read.attributes.nodes.map(({ value }) => value)).toEqual(
      expect.arrayContaining([graph.a, graph.b, emailNodeId]),
    );
    expect(read.attributes.nodes.map(({ value }) => value)).not.toContain(graph.c);
  });

  it('reruns an expansion from its stored start, one hop, rather than binding parameters it never had (integration-9b)', async () => {
    const { graph, source, emailNodeId } = await sourceQuery();
    const expanded = (await expand(source.id, emailNodeId, { 'run-sync': true })).json<Document>()
      .data;

    const rerun = await call('POST', `/graph-queries/${expanded.id}/rerun`, { meta: {} });

    expect(rerun.statusCode, rerun.body).toBe(200);
    const values = rerun.json<Document>().data.attributes.nodes.map(({ value }) => value);
    expect(values).toEqual(expect.arrayContaining([graph.a, graph.b, emailNodeId]));
    expect(values).not.toContain(graph.c);
  });

  it('lists a retired key’s kind not indexed when the job runs an expansion (integration-9b)', async () => {
    const { source, emailNodeId } = await sourceQuery();
    await api.database.db.execute(sql`update graph_queries
      set node_map = jsonb_set(node_map, ${`{${emailNodeId},keyId}`}::text[], '"retired-key"'::jsonb)
      where id = ${source.id}`);
    const expanded = (await expand(source.id, emailNodeId)).json<Document>().data;

    await processGraphQuery(
      { environmentId: api.environmentId, graphQueryId: expanded.id },
      {
        db: api.database.db,
        clock: api.clock,
        logger: createCapturingLogger(),
        events: createRecordingEventPublisher(),
      },
    );

    const read = (await call('GET', `/graph-queries/${expanded.id}`)).json<Document>().data;
    expect(read.attributes['index-complete']).toBe(false);
    expect(read.attributes['kinds-not-indexed']).toContain('email_address');
  });

  it('answers the honest empty state for a key made under a blind-index key no longer current', async () => {
    const { source, emailNodeId } = await sourceQuery();
    await api.database.db.execute(sql`update graph_queries
      set node_map = jsonb_set(node_map, ${`{${emailNodeId},keyId}`}::text[], '"retired-key"'::jsonb)
      where id = ${source.id}`);

    const response = await expand(source.id, emailNodeId, { 'run-sync': true });

    expect(response.statusCode, response.body).toBe(201);
    const expanded = response.json<Document>().data;
    expect(expanded.attributes['index-complete']).toBe(false);
    expect(expanded.attributes['kinds-not-indexed']).toContain('email_address');
    expect(expanded.attributes.nodes).toEqual([{ type: 'email_address', value: emailNodeId }]);
  });

  it('refuses an unknown query or node, a redacted source, an account node, a person kind without pii:view, and past the policy', async () => {
    const { source, emailNodeId } = await sourceQuery();
    const accountNode = `gn_${randomBytes(16).toString('base64url')}`;
    const withAccount = await sourceQuery();
    await api.database.db.execute(sql`update graph_queries
      set node_map = node_map || ${JSON.stringify({ [accountNode]: { start: true, account: true } })}::jsonb
      where id = ${withAccount.source.id}`);
    const masked = api.newUserToken(api.environmentId, { permissions: ['graph:write'] });

    const outcomes = [
      await expand(newId('grphq'), emailNodeId),
      await expand(source.id, `gn_${randomBytes(16).toString('base64url')}`),
      await expand(withAccount.source.id, accountNode),
      await expand(source.id, emailNodeId, undefined, masked),
    ];
    denied.add('graph-queries');
    outcomes.push(await expand(source.id, emailNodeId));
    denied.clear();
    await api.database.client.query(
      `update graph_queries set redacted_at = now(), nodes = '[]', links = '[]', node_map = '{}',
        account_ids = '{}', params = null where id = $1`,
      [source.id],
    );
    outcomes.push(await expand(source.id, emailNodeId));

    expect(outcomes.map(({ statusCode }) => statusCode)).toEqual([404, 404, 422, 403, 429, 410]);
  });

  it('is redacted by graph-query-retention-days like any query', async () => {
    const { source, emailNodeId } = await sourceQuery();
    const expanded = (await expand(source.id, emailNodeId, { 'run-sync': true })).json<Document>()
      .data;

    await redactExpiredGraphQueries(api.database.db, {
      now: new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
    });

    const read = (await call('GET', `/graph-queries/${expanded.id}`)).json<Document>().data;
    expect(read.attributes['redacted-at']).not.toBeNull();
    expect(read.attributes.nodes).toEqual([]);
  });
});
