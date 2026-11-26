/**
 * Workflow 8B Stage 1b, checkpoint (C) (orchestrator decision 5 after Workflow 8A; F35, V08): every
 * file outside the case owners' paths reaches cases only through a stub in an owner's file, so
 * behaviour moves only when that owner fills it. Each stub is replaced here by what an owner would
 * write, and the shared file must answer it:
 *
 * - the 8A joins: the trigger document and a manual run's case id, the case-holds rule, the generic
 *   actions' case row, the reference kinds and members, the contest route's case template, the
 *   recipes, `current_case` at publish and at a run's start, the transaction children's cascade and
 *   the copies of a run's redaction;
 * - the redaction service's case, the retention pass, the event subject of a case;
 * - `filterCaseVisibility` at `GET /events`, `GET /events/:id`, `GET /api-logs`, `GET /api-logs/:id`,
 *   `GET /workflow-runs` and the routes behind `requireRun`;
 * - an API key's `case-template-ids`, checked by `assertKeyTemplateRestrictionInTx` and kept by a clone.
 *
 * Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import type { WorkflowDefinition } from '@openverify/contracts';
import { createApiLog, createEvent } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedTransaction,
  seedTransactionType,
  seedWorkflowRun,
  testId,
} from '@openverify/db/testing';
import { analyzeAdverseSteps, checkDefinition } from '@openverify/workflow-engine';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventFilterSubjects } from './events/subject.js';
import { runRetention } from './services/retention.js';
import { createRedactionService } from './services/redaction.js';
import { createMemoryStorage } from './jobs/testing.js';
import { buildApp } from './app.js';
import { createDbApiKeyAuthenticator } from './auth/api-key-lookup.js';
import {
  bearer,
  createTestApi,
  TEST_PEPPER,
  type TestApi,
  type TestApp,
} from './test-support/harness.js';
import { createRecordingEventPublisher, fixedClock } from './test-support/fakes.js';
import { CASE_HOLDS_SUBJECT } from './workflows/actions/decisions/case-holds.js';
import { OBJECT_ROWS } from './workflows/actions/objects/table.js';
import { redactTransactionChildrenInTx } from './workflows/actions/transactions/children.js';
import { loadCheckContext } from './workflows/definitions/context.js';
import { WORKFLOW_ACTIONS, WORKFLOW_SINKS } from './workflows/definitions/registry.js';
import {
  chain,
  createEngineHarness,
  drain,
  output,
  outputsOf,
  publish,
  runOf,
  start,
  type EngineHarness,
} from './workflows/engine/testing.js';
import { placeholderReferencesIn, referencesIn } from './workflows/publish/references.js';
import { evaluatePublishRules, type PublishFacts } from './workflows/publish/rules.js';
import { decline } from './workflows/publish/testing.js';
import { WORKFLOW_RECIPE_ROWS } from './workflows/recipes/rows.js';
import { redactRunsForSubjectsInTx } from './workflows/runs/redaction.js';
import { triggerDocumentOf } from './workflows/triggers/objects.js';
import { objectIdFits } from './workflows/triggers/service.js';

const { CASE_ID, TEMPLATE_ID, DOCUMENT, ROW, SCOPE, RECIPE } = vi.hoisted(() => {
  const caseId = 'case_01M6FQZCV622MRCK2ZKC7F4HD9';
  return {
    CASE_ID: caseId,
    TEMPLATE_ID: 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN',
    DOCUMENT: { data: { type: 'case', id: caseId, attributes: { status: 'open' } } },
    ROW: { label: 'filled by api-case-workflows' },
    SCOPE: { kind: 'object', members: {} },
    RECIPE: {
      key: 'review-on-report-match',
      name: 'Review on report match',
      description: 'A synthetic recipe with a case.',
      needsConfiguration: [],
      definition: () => ({
        'schema-version': 1,
        trigger: { type: 'trigger-event', config: { events: ['case.resolved'] } },
        inputs: [],
        variables: [],
        steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
        edges: [{ id: 'start', from: 'trigger', 'from-port': 'next', to: 'output' }],
        outputs: [],
        layout: {},
      }),
    },
  };
});

/** A golden event's payload (`contracts/fixtures/api`), so the events route can serve it. */
const goldenPayload = (name: string): Record<string, unknown> =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../../../contracts/fixtures/api/event-${name}.json`, import.meta.url),
        'utf8',
      ),
    ) as { data: { attributes: { payload: Record<string, unknown> } } }
  ).data.attributes.payload;

const owners = vi.hoisted(() => ({
  redactCasesInTx: vi.fn(),
  redactCaseCopiesInTx: vi.fn(),
  runCaseRetention: vi.fn(),
  assertKeyTemplateRestrictionInTx: vi.fn(),
}));

vi.mock('./workflows/actions/cases/trigger.js', () => ({
  caseTriggerDocumentOf: () => Promise.resolve(DOCUMENT),
  caseObjectIdFits: (id: string) => id.startsWith('case_'),
}));
vi.mock('./workflows/actions/cases/holds.js', () => ({
  caseHoldsSubject: () => Promise.resolve(true),
}));
vi.mock('./workflows/actions/cases/object-rows.js', () => ({ CASE_OBJECT_ROWS: { case: ROW } }));
vi.mock('./workflows/actions/cases/references.js', () => ({
  CASE_KIND_OF_PREFIX: { ctmpl: 'list' },
  CASE_REFERENCE_MEMBERS: ['case-template-id'],
}));
vi.mock('./workflows/actions/cases/contest-route.js', () => ({
  caseTemplateContestRouteIssues: () => [],
}));
vi.mock('./workflows/actions/cases/recipes.js', () => ({ CASE_RECIPE_ROWS: [RECIPE] }));
vi.mock('./workflows/actions/cases/current-case.js', () => ({
  currentCaseScopeOf: () => SCOPE,
  currentCaseValueOf: () => Promise.resolve({ id: CASE_ID }),
}));
vi.mock('./services/cases/redaction.js', () => ({
  redactCasesInTx: owners.redactCasesInTx,
  redactCaseCopiesInTx: owners.redactCaseCopiesInTx,
}));
vi.mock('./services/cases/retention.js', () => ({ runCaseRetention: owners.runCaseRetention }));
vi.mock('./services/cases/filter-subjects.js', () => ({
  resolveCaseFilterSubjects: (_db: unknown, _env: unknown, payloads: readonly unknown[]) =>
    Promise.resolve(payloads.map(() => ({ caseTemplateId: TEMPLATE_ID }))),
}));
vi.mock('./services/cases/visibility.js', async (original) => ({
  ...(await original<typeof import('./services/cases/visibility.js')>()),
  filterCaseVisibility: <Item>(
    _db: unknown,
    _reader: unknown,
    items: readonly Item[],
    caseIdsOf: (item: Item) => readonly string[],
  ) => Promise.resolve(items.filter((item) => caseIdsOf(item).length === 0)),
}));
vi.mock('./services/cases/key-restriction.js', () => ({
  assertKeyTemplateRestrictionInTx: owners.assertKeyTemplateRestrictionInTx,
}));

describe('the 8A joins reach their owners’ stubs', () => {
  it('read a case as a trigger object, and take a case id in a manual run', async () => {
    expect(await triggerDocumentOf({} as never, testId('env'), 'case', CASE_ID)).toEqual(DOCUMENT);
    expect(objectIdFits('case', CASE_ID)).toBe(true);
    expect(objectIdFits('case', testId('inq'))).toBe(false);
  });

  it('ask the held objects whether a case holds the subject (C128.2)', async () => {
    expect(
      await CASE_HOLDS_SUBJECT({} as never, {
        environmentId: testId('env'),
        eventId: testId('evt'),
        subjectId: testId('inq'),
      }),
    ).toBe(true);
  });

  it('give the generic actions the case row', () => {
    expect(OBJECT_ROWS.case).toBe(ROW);
  });

  it('name the case references and members', () => {
    const definition = chain([
      {
        id: 'make',
        type: 'action',
        name: 'Make',
        'action-key': 'create_case',
        'action-version': 1,
        config: { 'case-template-id': TEMPLATE_ID },
      },
    ]);
    const placeholder = chain([
      {
        id: 'make',
        type: 'action',
        name: 'Make',
        'action-key': 'create_case',
        'action-version': 1,
        config: { 'case-template-id': 'change-me-template' },
      },
    ]);

    expect(referencesIn(definition)).toEqual([
      { pointer: '/steps/0/config/case-template-id', id: TEMPLATE_ID, kind: 'list' },
    ]);
    expect(placeholderReferencesIn(placeholder)).toEqual(['/steps/0/config/case-template-id']);
  });

  it('let the owner judge a contest route that names a case template (C128.7)', () => {
    const definition = chain([
      decline('no', {
        'decision-basis': 'contract',
        'contest-route': { contact: 'Write to the review desk.', 'case-template-id': TEMPLATE_ID },
        'biometric-basis': 'explicit-consent',
      }),
    ]);
    const check = checkDefinition(definition, {
      kind: 'workflow',
      mode: 'publish',
      registry: WORKFLOW_ACTIONS,
    });
    const facts: PublishFacts = {
      environmentKind: 'production',
      flowHost: 'flow.example.com',
      linkHosts: [],
      emailRecipients: [],
      smsRecipients: [],
      boundAdapters: new Set(['none']),
      listPurposes: new Map(),
      transactionAdverseStatuses: new Set(['declined']),
      transactionTypesContest: false,
      accountTypesContest: false,
      secrets: new Map(),
      knownReferences: new Set(),
      exposeSignals: true,
    };

    const report = evaluatePublishRules({
      definition,
      analyses: analyzeAdverseSteps(definition, { registry: WORKFLOW_ACTIONS }),
      egress: check.egress,
      registry: WORKFLOW_ACTIONS,
      facts,
    });

    expect(report.errors.map(({ code }) => code)).not.toContain(
      'contest_route_case_template_refused',
    );
  });

  it('list the case recipes', () => {
    expect(WORKFLOW_RECIPE_ROWS).toContain(RECIPE);
  });

  it('give the check the case sinks and the current case’s type', async () => {
    const definition: WorkflowDefinition = chain([]);

    const { context } = await loadCheckContext(
      {} as never,
      testId('env'),
      definition,
      'workflow',
      'publish',
    );

    expect(context.sinks).toBe(WORKFLOW_SINKS);
    expect(context.currentCase).toBe(SCOPE);
  });

  it('seed a run with the current case', async () => {
    const harness = await createEngineHarness([]);
    try {
      const id = await start(
        harness,
        chain([], {
          steps: [output({ case: '{{ current_case.id }}' })],
          outputs: [{ name: 'case', pii: false }],
        }),
      );
      await drain(harness);

      expect((await runOf(harness, id)).status).toBe('completed');
      expect(await outputsOf(harness, id)).toEqual({ case: CASE_ID });
    } finally {
      await harness.close();
    }
  }, 120_000);
});

describe('the redaction joins (C127.7, C139.1, C120.9)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let environmentId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    ({
      environment: { id: environmentId },
    } = await createTestTenant(database.db));
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it('take a transaction’s case child through redactCasesInTx', async () => {
    owners.redactCasesInTx.mockResolvedValueOnce({
      cases: [{ id: CASE_ID, redactedAt: new Date(), alreadyRedacted: false }],
      staged: [],
      storageKeys: ['synthetic-attachment-key'],
    });
    const type = await seedTransactionType(database.db, environmentId);
    const transaction = await seedTransaction(database.db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    await database.db.execute(sql`
      insert into transaction_children (environment_id, transaction_id, child_type, child_id,
        workflow_run_id)
      values (${environmentId}, ${transaction.id}, 'case', ${CASE_ID}, ${testId('wfr')})`);
    const at = new Date();

    const redacted = await database.db.transaction((tx) =>
      redactTransactionChildrenInTx(
        tx,
        { events: createRecordingEventPublisher(), clock: fixedClock() },
        { environmentId, transactionId: transaction.id, at },
      ),
    );

    expect(owners.redactCasesInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        environmentId,
        caseIds: [CASE_ID],
        at,
        actor: null,
        cause: { 'transaction-id': transaction.id },
      }),
    );
    expect(redacted.storageKeys).toEqual(['synthetic-attachment-key']);
  });

  it('redact a run’s case copies through their owner, and list only the others', async () => {
    const source = testId('inq');
    const other = testId('acc');
    owners.redactCaseCopiesInTx.mockResolvedValueOnce([CASE_ID]);
    const run = await seedWorkflowRun(database.db, environmentId);
    const stepId = testId('wfst');
    await database.db.execute(sql`
      insert into workflow_run_steps (id, environment_id, run_id, node_id, node_type)
      values (${stepId}, ${environmentId}, ${run.id}, 'copy', 'action')`);
    for (const target of [CASE_ID, other]) {
      await database.db.execute(sql`
        insert into workflow_step_effects (id, environment_id, run_id, step_id, effect_key, kind,
          status, copy_target_id, copy_source_subject_ids)
        values (${testId('wfef')}, ${environmentId}, ${run.id}, ${stepId},
          ${`${run.id}/copy/${target}`}, 'update_object', 'done', ${target},
          array[${source}]::text[])`);
    }
    const at = new Date();

    await database.db.transaction((tx) =>
      redactRunsForSubjectsInTx(tx, { environmentId, subjectIds: [source], at }),
    );

    expect(owners.redactCaseCopiesInTx).toHaveBeenCalledWith(expect.anything(), {
      environmentId,
      targetIds: expect.arrayContaining([CASE_ID, other]) as unknown,
      at,
    });
    const audit = await database.db.execute<{ metadata: { 'target-ids': string[] } }>(sql`
      select metadata from audit_logs
      where environment_id = ${environmentId} and action = 'workflow-run.redaction-copies-found'`);
    expect(audit.rows.map(({ metadata }) => metadata['target-ids'])).toEqual([[other]]);
  });

  it('redact a case through the redaction service, with its runs', async () => {
    owners.redactCasesInTx.mockResolvedValueOnce({
      cases: [{ id: CASE_ID, redactedAt: new Date(0), alreadyRedacted: true }],
      staged: [],
      storageKeys: [],
    });
    const service = createRedactionService({
      db: database.db,
      storage: createMemoryStorage(),
      events: createRecordingEventPublisher(),
      clock: fixedClock(),
    });

    expect(
      await service.redactCase({ environmentId, organizationId: testId('org') }, CASE_ID, null),
    ).toEqual({ redactedAt: new Date(0), alreadyRedacted: true });
  });

  it('answer 404 for a case its owner did not find', async () => {
    owners.redactCasesInTx.mockResolvedValueOnce({ cases: [], staged: [], storageKeys: [] });
    const service = createRedactionService({
      db: database.db,
      storage: createMemoryStorage(),
      events: createRecordingEventPublisher(),
      clock: fixedClock(),
    });

    await expect(
      service.redactCase({ environmentId, organizationId: testId('org') }, CASE_ID, null),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('add the case steps to the retention pass', async () => {
    owners.runCaseRetention.mockResolvedValueOnce({
      redactedCases: 2,
      failedCaseRedactions: 1,
      deletedUserNotifications: 3,
    });

    const report = await runRetention({
      db: database.db,
      storage: createMemoryStorage(),
      redaction: createRedactionService({
        db: database.db,
        storage: createMemoryStorage(),
        events: createRecordingEventPublisher(),
        clock: fixedClock(),
      }),
      clock: fixedClock(),
    });

    expect(report).toMatchObject({
      redactedCases: 2,
      failedCaseRedactions: 1,
      deletedUserNotifications: 3,
    });
  });

  it('resolve a case event’s subject through its owner, strictly (C143.4)', async () => {
    const subjects = await eventFilterSubjects(database.db, environmentId, [
      { data: { type: 'case', id: CASE_ID } },
    ]);

    expect(subjects).toEqual([{ caseTemplateId: TEMPLATE_ID, strict: true }]);
  });
});

/** `publish` reads only the database and the environment of a harness. */
const engineless = (api: TestApi) =>
  ({ db: api.database.db, environmentId: api.environmentId }) as unknown as EngineHarness;

describe('the exits that filter case visibility (C129.4, V08)', () => {
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

  const get = (url: string) =>
    api.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: bearer(api.token) });

  it('leave a case’s events out of GET /events, and answer 404 for one', async () => {
    const caseEvent = await createEvent(api.database.db, api.environmentId, {
      id: testId('evt'),
      name: 'case.created',
      payload: goldenPayload('case-created'),
    });
    const other = await createEvent(api.database.db, api.environmentId, {
      id: testId('evt'),
      name: 'inquiry.approved',
      payload: goldenPayload('inquiry-approved'),
    });

    const listed = (await get('/events')).json<{ data: { id: string }[] }>();

    expect(listed.data.map(({ id }) => id)).toContain(other.id);
    expect(listed.data.map(({ id }) => id)).not.toContain(caseEvent.id);
    expect((await get(`/events/${caseEvent.id}`)).statusCode).toBe(404);
    expect((await get(`/events/${other.id}`)).statusCode).toBe(200);
  });

  it('leave a log entry about a case out of GET /api-logs, and answer 404 for one', async () => {
    const about = await createApiLog(api.database.db, api.environmentId, {
      id: testId('alog'),
      method: 'GET',
      path: `/api/v1/cases/${CASE_ID}`,
      status: 200,
      durationMs: 1,
      requestId: 'synthetic-request',
      resourceId: CASE_ID,
    });

    const listed = (await get('/api-logs')).json<{ data: { id: string }[] }>();

    expect(listed.data.map(({ id }) => id)).not.toContain(about.id);
    expect((await get(`/api-logs/${about.id}`)).statusCode).toBe(404);
  });

  it('leave a run about a case out of GET /workflow-runs, and answer 404 for it', async () => {
    const { workflowId, workflowVersionId } = await publish(engineless(api), chain([]));
    const run = await seedWorkflowRun(api.database.db, api.environmentId, {
      workflowId,
      workflowVersionId,
    });
    await api.database.db.execute(sql`
      insert into workflow_run_subjects (environment_id, run_id, subject_id, source)
      values (${api.environmentId}, ${run.id}, ${CASE_ID}, 'trigger')`);
    const other = await seedWorkflowRun(api.database.db, api.environmentId, {
      workflowId,
      workflowVersionId,
    });

    const listed = (await get('/workflow-runs')).json<{ data: { id: string }[] }>();

    expect(listed.data.map(({ id }) => id)).toContain(other.id);
    expect(listed.data.map(({ id }) => id)).not.toContain(run.id);
    expect((await get(`/workflow-runs/${run.id}`)).statusCode).toBe(404);
    expect((await get(`/workflow-runs/${run.id}/steps`)).statusCode).toBe(404);
  });

  it('check a key’s case templates against its creator, and keep them in a clone', async () => {
    owners.assertKeyTemplateRestrictionInTx.mockResolvedValue(undefined);

    const created = await keys.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: bearer(api.token),
      payload: {
        data: {
          type: 'api-key',
          attributes: {
            name: 'Restricted',
            scopes: ['cases:read'],
            'case-template-ids': [TEMPLATE_ID],
          },
        },
      },
    });
    const key = created.json<{ data: { id: string; attributes: Record<string, unknown> } }>();
    const cloned = await keys.inject({
      method: 'POST',
      url: `/api/v1/api-keys/${key.data.id}/clone`,
      headers: bearer(api.token),
      payload: { meta: { name: 'Cloned' } },
    });

    expect(created.statusCode).toBe(201);
    expect(key.data.attributes['case-template-ids']).toEqual([TEMPLATE_ID]);
    expect(owners.assertKeyTemplateRestrictionInTx).toHaveBeenCalledWith(
      expect.anything(),
      api.environmentId,
      expect.objectContaining({ environmentId: api.environmentId }),
      [TEMPLATE_ID],
    );
    expect(
      cloned.json<{ data: { attributes: Record<string, unknown> } }>().data.attributes[
        'case-template-ids'
      ],
    ).toEqual([TEMPLATE_ID]);
    expect(owners.assertKeyTemplateRestrictionInTx).toHaveBeenCalledTimes(2);
  });
});
