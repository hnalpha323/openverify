/**
 * C118.1, C118.8, C114.6: the worker's half of a delivery. It marks every delivery `run_created`,
 * `filtered`, `refused` or `expired`, never leaves one pending but when it defers, and it starts a run
 * from the event's own snapshot. The engine's start is faked here, and `start-run` tests prove it.
 * Every value is synthetic.
 */
import { buildInquiryResource, newId, type WorkflowDefinition } from '@openverify/contracts';
import {
  createEvent,
  createWorkflowDeliveries,
  listWorkflowDeliveries,
  replaceWorkflowTriggers,
  type Db,
  type EventCause,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedWorkflow,
  seedWorkflowRun,
  seedWorkflowVersion,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapturingLogger } from '../../jobs/testing.js';
import { createAllowAllRateLimiter } from '../../test-support/fakes.js';
import type { RateLimiter } from '../../ports.js';
import type { WorkflowServices } from '../services.js';
import type { WorkflowWorkerDeps } from '../worker.js';
import { triggerIndexRows } from '../publish/index-rows.js';
import { processWorkflowTrigger } from './deliver.js';

const engine = vi.hoisted(() => ({ start: vi.fn(), wake: vi.fn() }));
vi.mock('../engine/start-run.js', () => ({
  startWorkflowRunInTx: engine.start,
  wakeStartedRun: engine.wake,
}));
const links = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../../services/transactions/filter-subjects.js', () => ({
  resolveTransactionFilterSubjects: links.resolve,
}));

const at = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T13:00:00.000Z');

let database: TestDatabase;
let db: Db;
let environmentId: string;
let rateLimiter: RateLimiter;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  environmentId = (await createTestTenant(db)).environment.id;
  rateLimiter = createAllowAllRateLimiter();
  engine.start.mockReset();
  engine.wake.mockReset();
  engine.start.mockImplementation(() =>
    Promise.resolve({ run: { id: newId('wfr') }, created: true, staged: [], jobs: [] }),
  );
  engine.wake.mockResolvedValue(undefined);
});

const deps = (): WorkflowWorkerDeps => ({
  db,
  clock: { now: () => LATER },
  logger: createCapturingLogger(),
  services: { rateLimiter } as unknown as WorkflowServices,
  steps: { enqueueWorkflowStep: () => Promise.resolve() },
  triggers: { enqueueWorkflowTrigger: () => Promise.resolve() },
  waitMatches: { enqueueWorkflowWaitMatch: () => Promise.resolve() },
});

const trigger = (config: Record<string, unknown> = {}, options: Record<string, unknown> = {}) => ({
  type: 'trigger-event',
  config: { events: ['inquiry.completed'], ...config },
  ...options,
});

const definitionWith = (triggerValue: unknown): WorkflowDefinition =>
  ({
    'schema-version': 1,
    trigger: triggerValue,
    inputs: [],
    variables: [],
    steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
    edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
    outputs: [],
    layout: {},
  }) as unknown as WorkflowDefinition;

interface Published {
  workflowId: string;
  versionId: string;
}

async function published(
  definition: WorkflowDefinition = definitionWith(trigger()),
  options: { status?: string; publishedAt?: Date } = {},
): Promise<Published> {
  const workflow = await seedWorkflow(db, environmentId, { status: options.status ?? 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definition,
  });
  await database.client.query(`update workflow_versions set published_at = $1 where id = $2`, [
    (options.publishedAt ?? new Date('2026-10-01T00:00:00.000Z')).toISOString(),
    version.id,
  ]);
  await database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  await replaceWorkflowTriggers(db, environmentId, workflow.id, [
    { kind: 'trigger-event', eventName: 'inquiry.completed', workflowVersionId: version.id },
  ]);
  return { workflowId: workflow.id, versionId: version.id };
}

const inquiryPayload = (overrides: { fields?: Record<string, string> } = {}) => ({
  data: buildInquiryResource({
    id: newId('inq'),
    status: 'completed',
    referenceId: 'ref-synthetic-1',
    fields: overrides.fields ?? {},
    inquiryTemplateId: newId('itmpl'),
    verifications: [],
    createdAt: at,
    updatedAt: at,
  }),
});

async function delivered(
  workflowId: string,
  options: { payload?: unknown; cause?: EventCause; name?: string; eventAt?: Date } = {},
) {
  const eventId = newId('evt');
  await createEvent(db, environmentId, {
    id: eventId,
    name: options.name ?? 'inquiry.completed',
    payload: (options.payload ?? inquiryPayload()) as never,
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
  await database.client.query(`update events set created_at = $1 where id = $2`, [
    (options.eventAt ?? at).toISOString(),
    eventId,
  ]);
  const id = newId('wftd');
  await createWorkflowDeliveries(db, environmentId, [
    { id, eventId, eventName: options.name ?? 'inquiry.completed', workflowId },
  ]);
  return { id, eventId };
}

const job = (deliveryId: string) => ({ environmentId, deliveryId });

async function rowOf(id: string) {
  const { items } = await listWorkflowDeliveries(db, environmentId, {}, { size: 100 });
  return items.find((row) => row.id === id);
}

const startInput = () =>
  engine.start.mock.calls[0]?.[2] as Record<string, unknown> & { trigger: Record<string, unknown> };

describe('a delivery that starts a run (C118.1)', () => {
  it('starts one run from the event, marks the delivery, and wakes it after the commit', async () => {
    const { workflowId, versionId } = await published();
    const { id, eventId } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(startInput()).toMatchObject({
      environmentId,
      workflowId,
      workflowVersionId: versionId,
      triggerType: 'trigger-event',
      triggerDeliveryId: id,
      creator: { type: 'event', id: eventId },
      causedByPrincipal: null,
      grant: { scopes: [], pii: false },
    });
    expect(startInput().trigger).toMatchObject({ type: 'inquiry', status: 'completed' });
    expect(await rowOf(id)).toMatchObject({ status: 'run_created', reasonCode: null });
    expect(engine.wake).toHaveBeenCalledTimes(1);
  });

  it('records the object the run was started for', async () => {
    const { workflowId } = await published();
    const payload = inquiryPayload();
    const { id } = await delivered(workflowId, { payload });

    await processWorkflowTrigger(job(id), deps());

    expect(startInput().subjectIds).toContain(payload.data.id);
  });

  it('does nothing for a job repeated after the delivery finished (C118.1)', async () => {
    const { workflowId } = await published();
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());
    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a delivery that does not exist', async () => {
    await processWorkflowTrigger(job(newId('wftd')), deps());

    expect(engine.start).not.toHaveBeenCalled();
  });

  it('never wakes what a start did not create', async () => {
    engine.start.mockResolvedValue({
      run: { id: newId('wfr') },
      created: false,
      staged: [],
      jobs: [],
    });
    const { workflowId } = await published();
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({ status: 'run_created' });
    expect(engine.wake).not.toHaveBeenCalled();
  });

  it('waits for a delivery deferred past now', async () => {
    const { workflowId } = await published();
    const { id } = await delivered(workflowId);
    await database.client.query(
      `update workflow_trigger_deliveries set not_before = $1 where id = $2`,
      [new Date(LATER.getTime() + 60_000).toISOString(), id],
    );

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).not.toHaveBeenCalled();
    expect(await rowOf(id)).toMatchObject({ status: 'pending' });
  });

  it('passes the subject of a one-run-per-subject workflow (C118.9)', async () => {
    const { workflowId } = await published(
      definitionWith(trigger({}, { 'one-run-per-subject': true })),
    );
    const payload = inquiryPayload();
    const { id } = await delivered(workflowId, { payload });

    await processWorkflowTrigger(job(id), deps());

    expect(startInput().oneRunPerSubject).toBe(payload.data.id);
  });

  it('takes the side of a rollout its subject falls on (C116.3)', async () => {
    const { workflowId, versionId } = await published();
    const treatment = await seedWorkflowVersion(db, environmentId, {
      workflowId,
      status: 'published',
      versionNumber: 2,
      definition: definitionWith(trigger()),
    });
    await database.client.query(`update workflow_versions set published_at = $1 where id = $2`, [
      '2026-10-02T00:00:00.000Z',
      treatment.id,
    ]);
    const deploymentId = newId('wfd');
    await database.client.query(
      `insert into workflow_deployments (id, environment_id, workflow_id, versions)
       values ($1, $2, $3, $4::jsonb)`,
      [
        deploymentId,
        environmentId,
        workflowId,
        JSON.stringify([
          { token: treatment.id, percentage: 100, label: 'treatment' },
          { token: versionId, percentage: 0, label: 'control' },
        ]),
      ],
    );
    await database.client.query(`update workflows set active_deployment_id = $1 where id = $2`, [
      deploymentId,
      workflowId,
    ]);
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(startInput()).toMatchObject({
      workflowVersionId: treatment.id,
      deploymentId,
      rolloutLabel: 'treatment',
    });
  });
});

describe('a delivery that is refused (C118.1)', () => {
  it.each(['paused', 'archived'])('refuses a %s workflow', async (status) => {
    const { workflowId } = await published();
    await database.client.query(
      `update workflows set status = $1, archived_at = case when $1 = 'archived' then now() end
       where id = $2`,
      [status, workflowId],
    );
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).not.toHaveBeenCalled();
    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'workflow_not_running',
    });
  });

  it('refuses a workflow with no live version', async () => {
    const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
    const { id } = await delivered(workflow.id);

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'workflow_not_running',
    });
  });

  it('never starts a version newer than the event (C118.1)', async () => {
    const { workflowId } = await published(definitionWith(trigger()), {
      publishedAt: new Date(at.getTime() + 1_000),
    });
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).not.toHaveBeenCalled();
    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'event_before_activation',
    });
  });

  it('runs the version that was live at the event, not a newer one', async () => {
    const { workflowId, versionId } = await published();
    const newer = await seedWorkflowVersion(db, environmentId, {
      workflowId,
      status: 'published',
      versionNumber: 2,
      definition: definitionWith(trigger()),
    });
    await database.client.query(`update workflow_versions set published_at = $1 where id = $2`, [
      new Date(at.getTime() + 1_000).toISOString(),
      newer.id,
    ]);
    await database.client.query(
      `update workflows set latest_published_version_id = $1 where id = $2`,
      [newer.id, workflowId],
    );
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(startInput().workflowVersionId).toBe(versionId);
  });

  it('refuses an event the version no longer listens to', async () => {
    const { workflowId } = await published(
      definitionWith(trigger({ events: ['inquiry.approved'] })),
    );
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'event_not_listened',
    });
  });

  it('refuses an event whose subject was redacted (C120.9)', async () => {
    const { workflowId } = await published();
    const { id } = await delivered(workflowId, {
      payload: {
        data: {
          type: 'inquiry',
          id: newId('inq'),
          attributes: { 'redacted-at': '2026-10-20T12:00:00.000Z' },
        },
      },
    });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({ status: 'refused', reasonCode: 'subject_redacted' });
  });

  it('refuses a definition it cannot read, and never retries it', async () => {
    const { workflowId, versionId } = await published();
    await database.client.query(
      `update workflow_versions set definition = '{}'::jsonb where id = $1`,
      [versionId],
    );
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'definition_unreadable',
    });
  });

  it('refuses a snapshot past the cap (C117.7)', async () => {
    const { workflowId } = await published();
    const { id } = await delivered(workflowId, {
      payload: {
        data: {
          type: 'inquiry',
          id: newId('inq'),
          attributes: { status: 'completed', note: 'x'.repeat(300 * 1024) },
        },
      },
    });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({ status: 'refused', reasonCode: 'payload_too_large' });
  });

  it('expires a delivery whose event is gone, and holds nothing', async () => {
    const { workflowId } = await published();
    const id = newId('wftd');
    await createWorkflowDeliveries(db, environmentId, [
      { id, eventId: newId('evt'), eventName: 'inquiry.completed', workflowId },
    ]);

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({ status: 'expired', reasonCode: 'event_missing' });
  });
});

describe('criteria (C118.1, C114.6)', () => {
  const COMPLETED = { '===': [{ var: 'trigger.status' }, 'completed'] };
  const APPROVED = { '===': [{ var: 'trigger.status' }, 'approved'] };
  const NULLABLE = { '===': [{ var: 'trigger.reference-id' }, 'other'] };

  it('starts a run when the criteria hold', async () => {
    const { workflowId } = await published(definitionWith(trigger({ criteria: COMPLETED })));
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('marks the delivery filtered when they do not', async () => {
    const { workflowId } = await published(definitionWith(trigger({ criteria: APPROVED })));
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).not.toHaveBeenCalled();
    expect(await rowOf(id)).toMatchObject({ status: 'filtered', reasonCode: 'criteria_not_met' });
  });

  const nullPayload = () => {
    const payload = inquiryPayload();
    (payload.data.attributes as Record<string, unknown>)['reference-id'] = null;
    return payload;
  };

  it('follows on-null: skip reads as filtered', async () => {
    const { workflowId } = await published(
      definitionWith(trigger({ criteria: NULLABLE, 'on-null': 'skip' })),
    );
    const { id } = await delivered(workflowId, { payload: nullPayload() });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({ status: 'filtered', reasonCode: 'criteria_null' });
  });

  it('follows on-null: admit starts the run', async () => {
    const { workflowId } = await published(
      definitionWith(trigger({ criteria: NULLABLE, 'on-null': 'admit' })),
    );
    const { id } = await delivered(workflowId, { payload: nullPayload() });

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('follows on-null: error refuses with its code, and never reads as false', async () => {
    const { workflowId } = await published(
      definitionWith(trigger({ criteria: NULLABLE, 'on-null': 'error' })),
    );
    const { id } = await delivered(workflowId, { payload: nullPayload() });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'condition_input_null',
    });
  });

  it('refuses criteria it cannot parse', async () => {
    const { workflowId } = await published(
      definitionWith(trigger({ criteria: { eval: ['anything'] } })),
    );
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({ status: 'refused', reasonCode: 'criteria_invalid' });
  });
});

describe('the verification trigger (C118.6)', () => {
  const verificationDefinition = (types?: string[]) =>
    definitionWith({
      type: 'trigger-verification',
      config: {
        events: ['verification.passed'],
        ...(types === undefined ? {} : { 'verification-types': types }),
      },
    });

  const verificationPayload = (type: string) => ({
    data: {
      type,
      id: newId('ver'),
      attributes: { status: 'passed' },
      relationships: { inquiry: { data: { type: 'inquiry', id: newId('inq') } } },
    },
  });

  it('takes a listed type', async () => {
    const { workflowId } = await published(verificationDefinition(['verification/government-id']));
    const { id } = await delivered(workflowId, {
      name: 'verification.passed',
      payload: verificationPayload('verification/government-id'),
    });

    await processWorkflowTrigger(job(id), deps());

    expect(startInput()).toMatchObject({ triggerType: 'trigger-verification' });
  });

  it('filters a type it does not list', async () => {
    const { workflowId } = await published(verificationDefinition(['verification/government-id']));
    const { id } = await delivered(workflowId, {
      name: 'verification.passed',
      payload: verificationPayload('verification/selfie'),
    });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'filtered',
      reasonCode: 'verification_type_not_listed',
    });
  });

  it('takes every type without a filter', async () => {
    const { workflowId } = await published(verificationDefinition());
    const { id } = await delivered(workflowId, {
      name: 'verification.passed',
      payload: verificationPayload('verification/selfie'),
    });

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });
});

describe('a trigger’s subject filter through a published version (K8-10)', () => {
  /** A version whose trigger names `filter`, indexed as publishing indexes it. */
  async function publishedWith(filter: Record<string, unknown>) {
    const definition = definitionWith(trigger({ filter }));
    const version = await published(definition);
    await replaceWorkflowTriggers(
      db,
      environmentId,
      version.workflowId,
      triggerIndexRows(definition, { versionId: version.versionId }),
    );
    return version;
  }

  it('starts a run for a subject the filter allows, and filters one it does not', async () => {
    const payload = inquiryPayload();
    const templateId = (
      payload.data.relationships as { 'inquiry-template': { data: { id: string } } }
    )['inquiry-template'].data.id;
    const allowing = await publishedWith({ 'inquiry-template-ids': [templateId] });
    const refusing = await publishedWith({ 'inquiry-template-ids': [newId('itmpl')] });
    const allowed = await delivered(allowing.workflowId, { payload });
    const refused = await delivered(refusing.workflowId, { payload });

    await processWorkflowTrigger(job(allowed.id), deps());
    await processWorkflowTrigger(job(refused.id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(await rowOf(refused.id)).toMatchObject({
      status: 'filtered',
      reasonCode: 'subject_filter_not_met',
    });
  });
});

describe('a trigger’s subject filter (outcome 29)', () => {
  async function filtered(filter: Record<string, unknown>) {
    const published_ = await published();
    await replaceWorkflowTriggers(db, environmentId, published_.workflowId, [
      {
        kind: 'trigger-event',
        eventName: 'inquiry.completed',
        workflowVersionId: published_.versionId,
        filter,
      },
    ]);
    return published_;
  }

  it('passes a subject the filter allows', async () => {
    const payload = inquiryPayload();
    const templateId = (
      payload.data.relationships as { 'inquiry-template': { data: { id: string } } }
    )['inquiry-template'].data.id;
    const { workflowId } = await filtered({ 'inquiry-template-ids': [templateId] });
    const { id } = await delivered(workflowId, { payload });

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('filters a subject it does not allow', async () => {
    const { workflowId } = await filtered({ 'inquiry-template-ids': [newId('itmpl')] });
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'filtered',
      reasonCode: 'subject_filter_not_met',
    });
  });

  it('holds a graph query to any present filter, because it has no template', async () => {
    const { workflowId } = await filtered({ 'inquiry-template-ids': [newId('itmpl')] });
    const { id } = await delivered(workflowId, {
      payload: { data: { type: 'graph-query', id: newId('grphq'), attributes: {} } },
    });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'filtered',
      reasonCode: 'subject_filter_not_met',
    });
  });

  const transactionPayload = () => ({
    data: { type: 'transaction', id: newId('txn'), attributes: { status: 'created' } },
  });

  it('passes a transaction on any one of its links (C107.4)', async () => {
    const allowed = newId('acctp');
    links.resolve.mockResolvedValue([
      { inquiryTemplateIds: [], accountTypeIds: [newId('acctp'), allowed] },
    ]);
    const { workflowId } = await filtered({ 'account-type-ids': [allowed] });
    const { id } = await delivered(workflowId, { payload: transactionPayload() });

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('holds a transaction with no such link to the filter', async () => {
    links.resolve.mockResolvedValue([{ inquiryTemplateIds: [], accountTypeIds: [] }]);
    const { workflowId } = await filtered({ 'account-type-ids': [newId('acctp')] });
    const { id } = await delivered(workflowId, { payload: transactionPayload() });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'filtered',
      reasonCode: 'subject_filter_not_met',
    });
  });

  it('holds a transaction type to any present filter, because it has no link', async () => {
    const { workflowId } = await filtered({ 'account-type-ids': [newId('acctp')] });
    const { id } = await delivered(workflowId, {
      payload: { data: { type: 'transaction-type', id: newId('txntp'), attributes: {} } },
    });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'filtered',
      reasonCode: 'subject_filter_not_met',
    });
  });

  it('reads no subject when the filter is the criteria’s', async () => {
    const { workflowId } = await filtered({ criteria: { '===': [1, 1] }, 'on-null': 'skip' });
    const { id } = await delivered(workflowId);

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });
});

describe('loop guards (C118.8)', () => {
  async function causedBy(workflowId: string, overrides: { triggerDepth?: number } = {}) {
    const cause = await published();
    const run = await seedWorkflowRun(db, environmentId, {
      workflowId: workflowId === '' ? cause.workflowId : workflowId,
      workflowVersionId: workflowId === '' ? cause.versionId : await versionOf(workflowId),
    });
    await database.client.query(
      `update workflow_runs set trigger_depth = $1, caused_by_principal = $2 where id = $3`,
      [overrides.triggerDepth ?? 0, PRINCIPAL, run.id],
    );
    return run.id;
  }

  const PRINCIPAL = newId('usr');

  const versionOf = async (workflowId: string): Promise<string> => {
    const { rows } = await database.client.query<{ id: string }>(
      `select id from workflow_versions where workflow_id = $1 limit 1`,
      [workflowId],
    );
    return rows[0]?.id ?? '';
  };

  it('starts a run one deeper than its cause, on the cause’s root and principal', async () => {
    const { workflowId } = await published();
    const causeRunId = await causedBy('', { triggerDepth: 3 });
    const { id } = await delivered(workflowId, { cause: { runId: causeRunId } });

    await processWorkflowTrigger(job(id), deps());

    expect(startInput()).toMatchObject({
      triggerDepth: 4,
      rootRunId: causeRunId,
      causedByPrincipal: PRINCIPAL,
    });
  });

  it('reads the principal off an event a request staged (C121.3)', async () => {
    const { workflowId } = await published();
    const principal = newId('key');
    const { id } = await delivered(workflowId, { cause: { principal } });

    await processWorkflowTrigger(job(id), deps());

    expect(startInput()).toMatchObject({ causedByPrincipal: principal, triggerDepth: 0 });
  });

  it('refuses past a causal depth of 8', async () => {
    const { workflowId } = await published();
    const causeRunId = await causedBy('', { triggerDepth: 8 });
    const { id } = await delivered(workflowId, { cause: { runId: causeRunId } });

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).not.toHaveBeenCalled();
    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'trigger_depth_exceeded',
    });
  });

  it('takes a depth of exactly 8', async () => {
    const { workflowId } = await published();
    const causeRunId = await causedBy('', { triggerDepth: 7 });
    const { id } = await delivered(workflowId, { cause: { runId: causeRunId } });

    await processWorkflowTrigger(job(id), deps());

    expect(startInput()).toMatchObject({ triggerDepth: 8 });
  });

  it('refuses a workflow already in the causal chain', async () => {
    const { workflowId } = await published();
    const causeRunId = await causedBy(workflowId);
    const { id } = await delivered(workflowId, { cause: { runId: causeRunId } });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({ status: 'refused', reasonCode: 'trigger_cycle' });
  });

  it('lets a workflow that opted in trigger itself', async () => {
    const { workflowId } = await published(
      definitionWith(trigger({}, { 'allow-self-trigger': true })),
    );
    const causeRunId = await causedBy(workflowId);
    const { id } = await delivered(workflowId, { cause: { runId: causeRunId } });

    await processWorkflowTrigger(job(id), deps());

    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  it('refuses a cause it cannot find, and never reads it as no cause', async () => {
    const { workflowId } = await published();
    const { id } = await delivered(workflowId, { cause: { runId: newId('wfr') } });

    await processWorkflowTrigger(job(id), deps());

    expect(await rowOf(id)).toMatchObject({
      status: 'refused',
      reasonCode: 'trigger_cause_missing',
    });
  });

  describe('the rate guards (C117.8, C118.8)', () => {
    const refusing = (policy: string): RateLimiter => ({
      consume: (key, rule) =>
        Promise.resolve(
          rule.name === policy
            ? { allowed: false, limit: 1, remaining: 0, resetAt: LATER, retryAfterSeconds: 30 }
            : { allowed: true, limit: 1, remaining: 1, resetAt: LATER, retryAfterSeconds: 0 },
        ),
    });

    it.each(['workflow-subject', 'workflow-runs'])(
      'defers past %s, and never drops the delivery',
      async (policy) => {
        rateLimiter = refusing(policy);
        const { workflowId } = await published();
        const { id } = await delivered(workflowId);

        await processWorkflowTrigger(job(id), deps());

        expect(engine.start).not.toHaveBeenCalled();
        const row = await rowOf(id);
        expect(row?.status).toBe('pending');
        expect(row?.notBefore).toEqual(new Date(LATER.getTime() + 30_000));
      },
    );

    it('defers, and never fails open, when the limiter is down (P31)', async () => {
      rateLimiter = { consume: () => Promise.reject(new Error('the store is down')) };
      const { workflowId } = await published();
      const { id } = await delivered(workflowId);

      await processWorkflowTrigger(job(id), deps());

      expect(engine.start).not.toHaveBeenCalled();
      const row = await rowOf(id);
      expect(row?.status).toBe('pending');
      expect(row?.notBefore?.getTime()).toBeGreaterThan(LATER.getTime());
    });

    it('keys the subject guard on the workflow and the subject', async () => {
      const allowing = createAllowAllRateLimiter();
      const consume = vi.fn((key: string, rule: Parameters<RateLimiter['consume']>[1]) =>
        allowing.consume(key, rule),
      );
      rateLimiter = { consume };
      const { workflowId } = await published();
      const payload = inquiryPayload();
      const { id } = await delivered(workflowId, { payload });

      await processWorkflowTrigger(job(id), deps());

      expect(consume.mock.calls.map(([key]) => key)).toContain(
        `workflow-subject:${workflowId}:${payload.data.id}`,
      );
      expect(consume.mock.calls.map(([key]) => key)).toContain(`workflow-runs:${environmentId}`);
    });
  });
});

describe('the logs (C117.11)', () => {
  it('holds ids and codes, never a value', async () => {
    const logger = createCapturingLogger();
    const { workflowId } = await published();
    const { id } = await delivered(workflowId, {
      payload: inquiryPayload({ fields: { name_first: 'synthetic-canary-name' } }),
    });

    await processWorkflowTrigger(job(id), { ...deps(), logger });

    expect(JSON.stringify(logger)).not.toContain('synthetic-canary-name');
  });
});
