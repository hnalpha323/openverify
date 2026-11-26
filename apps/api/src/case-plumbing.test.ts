/**
 * Workflow 8B Stage 1b, checkpoint (C): the plumbing `foundation-8b` builds in the API.
 *
 * - every PII name of a case and a comment is masked at each exit's list: the resources, the stored
 *   API log (with `message`, `statement` and `query` at any depth) and a run's trigger view (C143.5);
 * - the case actions join 8A's catalogue, object types, sinks and handlers, each handler the case
 *   steps' own (C140.3, Stage 1a amendment 27);
 * - the `case-bulk` producer: ids only, one job per bulk action (C137.4, C143.2), and the worker runs
 *   it with `api-cases`' processor;
 * - the case events are strict subjects (C143.4); the webhook filters keep `case-template-ids`.
 *
 * Every value is synthetic.
 */
import { PII_CASE_ATTRIBUTES, PII_CASE_COMMENT_ATTRIBUTES } from '@openverify/contracts';
import { matchesWebhookFilters } from '@openverify/core';
import {
  createTestDatabase,
  createTestTenant,
  seedCaseTemplate,
  testId,
} from '@openverify/db/testing';
import { MASKED_ATTRIBUTE_NAMES } from '@openverify/workflow-engine';
import {
  CASE_ACTION_CONTRACTS,
  CASE_ACTION_SINK_ROWS,
  type CaseActionKey,
} from '@openverify/workflow-engine/actions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASKED_ATTRIBUTES } from './auth/pii.js';
import { CASE_ACTION_HANDLERS } from './workflows/actions/cases/index.js';
import { eventFilterSubjects } from './events/subject.js';
import { CASE_BULK_QUEUE, createCaseBulkQueue } from './jobs/case-bulk-queue.js';
import { createRecordingQueue } from './jobs/testing.js';
import type { CaseBulkJob } from './ports.js';
import { maskPersonalData } from './services/api-logs.js';
import { buildApp } from './app.js';
import { createDbApiKeyAuthenticator } from './auth/api-key-lookup.js';
import {
  bearer,
  createTestApi,
  TEST_PEPPER,
  type TestApi,
  type TestApp,
} from './test-support/harness.js';
import {
  WORKFLOW_ACTIONS,
  WORKFLOW_OBJECT_TYPES,
  WORKFLOW_SINKS,
} from './workflows/definitions/registry.js';
import { processActions } from './workflows/engine/actions.js';

const CASE_PII = [...PII_CASE_ATTRIBUTES, ...PII_CASE_COMMENT_ATTRIBUTES];
const KEYS = Object.keys(CASE_ACTION_CONTRACTS) as CaseActionKey[];

describe('C143.5: the case PII names', () => {
  it('join every masked list: resources, the stored log and the trigger view', () => {
    expect(MASKED_ATTRIBUTES).toEqual(expect.arrayContaining(CASE_PII));
    expect([...MASKED_ATTRIBUTE_NAMES]).toEqual(expect.arrayContaining(CASE_PII));
  });

  it('are masked in a stored log, and a message, a statement or a query at any depth', () => {
    const masked = maskPersonalData({
      data: {
        attributes: { fields: { tax_id: 'synthetic' }, 'creator-email-address': 'a@example.com' },
      },
      meta: { message: 'synthetic comment', statement: 'synthetic statement' },
      query: { attribute: 'fields.tax_id', operator: 'eq', value: 'synthetic' },
    }) as {
      data: { attributes: Record<string, unknown> };
      meta: Record<string, unknown>;
      query: unknown;
    };

    expect(masked.data.attributes['creator-email-address']).toBeNull();
    expect(masked.meta).toEqual({ message: null, statement: null });
    expect(masked.query).toBeNull();
  });
});

describe('C140.3: the case actions in 8A’s tables', () => {
  it('are in the catalogue, each at version 1 under cases:write or cases:assign', () => {
    for (const key of KEYS) {
      const entry = WORKFLOW_ACTIONS.get(key, 1);
      expect(entry?.key, key).toBe(key);
    }
  });

  it('give the generic actions a case object type', () => {
    expect(WORKFLOW_OBJECT_TYPES.get('case')).toBeDefined();
  });

  it('give the taint pass the case sinks', () => {
    for (const row of CASE_ACTION_SINK_ROWS) {
      const pointer = row.member.replace('*', '0');
      expect(WORKFLOW_SINKS.sinkOf(row.key, pointer).plain, `${row.key}${pointer}`).toBe(
        row.plain === true,
      );
      expect(WORKFLOW_SINKS.sinkOf(row.key, pointer).sink).toBe(row.sink);
    }
  });

  it('each have a transaction handler, the case steps’ own (api-case-workflows)', () => {
    const { handlers } = processActions();

    for (const key of KEYS) {
      const handler = handlers.get(key, 1);
      expect(handler?.shape, key).toBe('transaction');
      expect(CASE_ACTION_HANDLERS, key).toContain(handler);
    }
  });
});

describe('C137.4, C143.2: the case-bulk producer', () => {
  it('adds one job per bulk action, carrying ids alone', async () => {
    const queue = createRecordingQueue<CaseBulkJob>();
    const producer = createCaseBulkQueue({ queue });
    const environmentId = testId('env');
    const bulkActionId = testId('cblk');

    await producer.enqueueCaseBulkAction({ environmentId, bulkActionId });

    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({
      name: CASE_BULK_QUEUE,
      data: { environmentId, bulkActionId },
      options: { jobId: bulkActionId, removeOnComplete: true, removeOnFail: true },
    });
  });

  it('refuses anything but an env_ and a cblk_ id', async () => {
    const producer = createCaseBulkQueue({ queue: createRecordingQueue<CaseBulkJob>() });

    await expect(
      producer.enqueueCaseBulkAction({ environmentId: testId('env'), bulkActionId: 'cblk-1' }),
    ).rejects.toThrow(TypeError);
  });
});

describe('C143.4: a case event’s filter subject', () => {
  it('is strict, so a case nobody resolved fails a present filter', async () => {
    const database = await createTestDatabase();
    try {
      const { environment } = await createTestTenant(database.db);
      const payloads = [
        { data: { type: 'case', id: testId('case') } },
        { data: { type: 'case-comment', id: testId('cscm') } },
      ];

      const subjects = await eventFilterSubjects(database.db, environment.id, payloads);

      expect(subjects.map((subject) => subject.strict)).toEqual([true, true]);
      expect(
        matchesWebhookFilters(
          { payload: payloads[0], subject: subjects[0] ?? {} },
          { 'case-template-ids': [testId('ctmpl')] },
        ),
      ).toBe(false);
    } finally {
      await database.close();
    }
  }, 120_000);
});

describe('C129.4, C143.4: a key’s case templates and a webhook’s case filter', () => {
  let api: TestApi;
  /** The API with the pepper new keys are hashed with, as the API key routes' own test builds it. */
  let keys: TestApp;

  beforeAll(async () => {
    api = await createTestApi();
    const authenticator = createDbApiKeyAuthenticator({
      db: api.database.db,
      pepper: TEST_PEPPER,
      clock: api.clock,
    });
    keys = buildApp({
      lookupApiKey: authenticator.lookup,
      onAuthenticated: authenticator.touch,
      now: () => api.clock.now(),
      logger: false,
      mode: 'test',
      api: api.deps,
      apiKeyPepper: TEST_PEPPER,
    });
  }, 120_000);

  afterAll(async () => {
    await keys.close();
    await api.close();
  });

  const post = (url: string, payload: Record<string, unknown>) =>
    (url === '/api-keys' ? keys : api.app).inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: bearer(api.token),
      payload,
    });

  it('hold a key’s case templates to those its creator may see, now that api-cases checks it', async () => {
    const template = await seedCaseTemplate(api.database.db, api.environmentId);
    const restricted = await post('/api-keys', {
      data: {
        type: 'api-key',
        attributes: {
          name: 'Restricted',
          scopes: ['cases:read'],
          'case-template-ids': [testId('ctmpl')],
        },
      },
    });
    const visible = await post('/api-keys', {
      data: {
        type: 'api-key',
        attributes: { name: 'Visible', scopes: ['cases:read'], 'case-template-ids': [template.id] },
      },
    });
    const plain = await post('/api-keys', {
      data: { type: 'api-key', attributes: { name: 'Plain', scopes: ['cases:read'] } },
    });

    expect(restricted.statusCode).toBe(422);
    expect(visible.statusCode, visible.body).toBe(201);
    expect(
      visible.json<{ data: { attributes: Record<string, unknown> } }>().data.attributes[
        'case-template-ids'
      ],
    ).toEqual([template.id]);
    expect(plain.statusCode).toBe(201);
    expect(
      plain.json<{ data: { attributes: Record<string, unknown> } }>().data.attributes,
    ).not.toHaveProperty('case-template-ids');
  });

  it('keep a webhook’s case-template-ids filter', async () => {
    const template = testId('ctmpl');
    const created = await post('/webhooks', {
      data: {
        type: 'webhook',
        attributes: {
          url: 'https://hooks.example.com/openverify',
          'enabled-events': ['case.created'],
          filters: { 'case-template-ids': [template] },
        },
      },
    });

    expect(created.statusCode).toBe(201);
    expect(
      created.json<{ data: { attributes: { filters: Record<string, unknown> } } }>().data.attributes
        .filters,
    ).toEqual({ 'case-template-ids': [template] });
  });
});
