/**
 * C140.1 (H14, P38), C121.3, C128.7 (P40) through the app (Workflow 8B, `api-case-workflows`): case
 * actions bind a running `trigger-case` workflow to case templates; the available actions are the
 * ones the caller may run, each prefill under the caller's mask; running one starts a run on the
 * case under the version's grant; a review request opens a case on the contest route's template,
 * holding the inquiry, with the person's statement as a comment. Case creation is `api-cases`'
 * `createCaseInTx`, replaced here by a fake that writes the case by SQL. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  getWorkflowRun,
  listCaseCommentRows,
  openWorkflowRunValues,
  type Db,
} from '@openverify/db';
import {
  createTestInquiry,
  seedCase,
  seedCaseTemplate,
  seedInquiryDecision,
  seedWorkflow,
  seedWorkflowVersion,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../../inquiries.test-support.js';
import { bearer } from '../../../test-support/harness.js';
import type { ApiDependencies } from '../../context.js';
import type { CaseCreationInput } from '../create.js';

const creation = vi.hoisted(() => ({ inputs: [] as CaseCreationInput[] }));

vi.mock('../create.js', async (original) => {
  const actual = await original<typeof import('../create.js')>();
  return {
    ...actual,
    /** `api-cases`' one creation path, each input recorded. */
    createCaseInTx: (tx: Db, deps: ApiDependencies, input: CaseCreationInput) => {
      creation.inputs.push(input);
      return actual.createCaseInTx(tx, deps, input);
    },
  };
});

let api: InquiryTestApi;
let db: Db;

beforeAll(async () => {
  api = await createInquiryTestApi();
  db = api.database.db;
}, 120_000);

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  creation.inputs.length = 0;
});

const CASE_TRIGGER = { type: 'trigger-case', config: {} };
const INPUTS = [
  { name: 'reference', type: 'string', required: true },
  { name: 'note', type: 'string', required: false },
];

const definitionOf = (trigger: unknown) => ({
  'schema-version': 1,
  trigger,
  inputs: INPUTS,
  variables: [],
  steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
  edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
  outputs: [],
  layout: {},
});

async function published(
  options: {
    trigger?: unknown;
    status?: string;
    grant?: { scopes: readonly string[]; pii: boolean };
  } = {},
) {
  const { environmentId } = api;
  const workflow = await seedWorkflow(db, environmentId, { status: options.status ?? 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition: definitionOf(options.trigger ?? CASE_TRIGGER),
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

let keys = 0;

async function template() {
  keys += 1;
  return seedCaseTemplate(db, api.environmentId, { key: `SA${String(keys)}` });
}

async function caseOn(
  templateId: { id: string; versionId: string; key: string },
  fields: Record<string, unknown> = {},
) {
  return seedCase(db, api.environmentId, {
    caseTemplateId: templateId.id,
    caseTemplateVersionId: templateId.versionId,
    key: templateId.key,
    number: 1,
    fields,
  });
}

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
  data: { type: 'case-action', attributes },
});

async function action(workflowId: string, templateIds: readonly string[], prefill = {}) {
  const response = await request(
    'POST',
    '/case-actions',
    newAction({
      'workflow-id': workflowId,
      'case-template-ids': templateIds,
      label: 'Escalate',
      prefill,
    }),
  );
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

describe('case actions (C140.1)', () => {
  it('creates, reads, lists and updates one, with its templates', async () => {
    const workflowId = await published();
    const [one, two] = [await template(), await template()];
    const id = await action(workflowId, [one.id], { reference: 'case.fields.reference' });

    const read = await request('GET', `/case-actions/${id}`);
    const list = await request('GET', `/case-actions?filter[case-template-id]=${one.id}`);
    const updated = await request(
      'PATCH',
      `/case-actions/${id}`,
      newAction({ label: 'Review', status: 'archived', 'case-template-ids': [two.id] }),
    );

    expect(read.json()).toMatchObject({
      data: {
        id,
        attributes: { label: 'Escalate', status: 'active', placement: 'header' },
        relationships: {
          workflow: { data: { id: workflowId } },
          'case-templates': { data: [{ type: 'case-template', id: one.id }] },
        },
      },
    });
    expect(list.json<{ data: { id: string }[] }>().data.map((item) => item.id)).toEqual([id]);
    expect(updated.json()).toMatchObject({
      data: {
        attributes: { label: 'Review', status: 'archived' },
        relationships: { 'case-templates': { data: [{ id: two.id }] } },
      },
    });
    expect(api.audit.entries.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['case-action.created', 'case-action.updated']),
    );
  });

  it('answers 404 for an action, a workflow or a template it cannot find', async () => {
    const workflowId = await published();
    const held = await template();
    expect((await request('GET', `/case-actions/${newId('cact')}`)).statusCode).toBe(404);
    expect(
      (await request('PATCH', `/case-actions/${newId('cact')}`, newAction({ label: 'x' })))
        .statusCode,
    ).toBe(404);
    const noWorkflow = await request(
      'POST',
      '/case-actions',
      newAction({ 'workflow-id': newId('wfl'), 'case-template-ids': [held.id], label: 'x' }),
    );
    const noTemplate = await request(
      'POST',
      '/case-actions',
      newAction({ 'workflow-id': workflowId, 'case-template-ids': [newId('ctmpl')], label: 'x' }),
    );
    expect([noWorkflow.statusCode, noTemplate.statusCode]).toEqual([404, 404]);
  });

  it('binds no workflow whose live version is not a case action’s', async () => {
    const workflowId = await published({ trigger: { type: 'trigger-api', config: {} } });
    const response = await request(
      'POST',
      '/case-actions',
      newAction({
        'workflow-id': workflowId,
        'case-template-ids': [(await template()).id],
        label: 'x',
      }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'workflow_not_running' });
  });

  it('refuses a prefill of an undeclared input at its pointer', async () => {
    const workflowId = await published();
    const response = await request(
      'POST',
      '/case-actions',
      newAction({
        'workflow-id': workflowId,
        'case-template-ids': [(await template()).id],
        label: 'x',
        prefill: { unknown: 'case.fields.reference' },
      }),
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'trigger_input_invalid',
      source: { pointer: '/data/attributes/prefill/unknown' },
    });
  });
});

describe('GET /cases/:id/available-actions (H14, P38)', () => {
  const FIELDS = { reference: { type: 'string', value: 'synthetic-case-ref' } };

  it('lists the actions of the case’s template, each prefilled as the caller may see it', async () => {
    const workflowId = await published();
    const held = await template();
    const created = await caseOn(held, FIELDS);
    const id = await action(workflowId, [held.id], { reference: 'case.fields.reference' });
    await action(workflowId, [(await template()).id]);

    const seen = await request('GET', `/cases/${created.id}/available-actions`);
    expect(seen.statusCode, seen.body).toBe(200);
    expect(seen.json()).toEqual({
      data: [
        {
          type: 'case-action',
          id,
          attributes: {
            label: 'Escalate',
            placement: 'header',
            form: [
              {
                name: 'reference',
                type: 'string',
                required: true,
                'prefilled-value': 'synthetic-case-ref',
              },
              { name: 'note', type: 'string', required: false, 'prefilled-value': null },
            ],
          },
          relationships: { workflow: { data: { type: 'workflow', id: workflowId } } },
        },
      ],
      links: { next: null },
    });

    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['cases:read', 'workflows:trigger'],
      piiMasked: true,
    });
    const unseen = await request(
      'GET',
      `/cases/${created.id}/available-actions`,
      undefined,
      masked,
    );
    expect(unseen.json()).toMatchObject({
      data: [{ attributes: { form: [{ 'prefilled-value': null }, { 'prefilled-value': null }] } }],
    });
  });

  it('leaves out an action whose grant the caller does not hold, and needs cases:read', async () => {
    const workflowId = await published({ grant: { scopes: ['inquiries:write'], pii: false } });
    const held = await template();
    const created = await caseOn(held);
    await action(workflowId, [held.id]);
    const narrow = await api.newApiKey(api.environmentId, {
      scopes: ['cases:read', 'workflows:trigger'],
    });
    const listed = await request(
      'GET',
      `/cases/${created.id}/available-actions`,
      undefined,
      narrow,
    );
    expect(listed.json()).toEqual({ data: [], links: { next: null } });

    const blind = await api.newApiKey(api.environmentId, { scopes: ['workflows:trigger'] });
    const refused = await request(
      'GET',
      `/cases/${created.id}/available-actions`,
      undefined,
      blind,
    );
    expect(refused.statusCode).toBe(403);
    expect((await request('GET', `/cases/${newId('case')}/available-actions`)).statusCode).toBe(
      404,
    );
  });

  it('lists nothing on a redacted case', async () => {
    const held = await template();
    const created = await caseOn(held);
    await action(await published(), [held.id]);
    await api.database.client.query(
      `update cases set fields = null, redacted_at = now() where id = $1`,
      [created.id],
    );
    const listed = await request('GET', `/cases/${created.id}/available-actions`);
    expect(listed.json()).toEqual({ data: [], links: { next: null } });
  });
});

describe('POST /cases/:id/run-action (C140.1, C121.3)', () => {
  const run = (caseId: string, actionId: string, parameters?: unknown, token = api.token) =>
    request(
      'POST',
      `/cases/${caseId}/run-action`,
      {
        data: {
          'case-action-id': actionId,
          ...(parameters === undefined ? {} : { parameters }),
        },
      },
      token,
    );

  it('starts a run on the case, its trigger the case, a prefill read live', async () => {
    const workflowId = await published();
    const held = await template();
    const created = await caseOn(held, { reference: { type: 'string', value: 'live-ref' } });
    const id = await action(workflowId, [held.id], { reference: 'case.fields.reference' });

    const response = await run(created.id, id);
    expect(response.statusCode, response.body).toBe(200);
    const runId = response.json<{ data: { 'workflow-run-id': string } }>().data['workflow-run-id'];
    const stored = await getWorkflowRun(db, api.environmentId, runId);
    expect(stored).toMatchObject({
      triggerType: 'trigger-case',
      creatorType: 'case-action',
      creatorId: id,
    });
    const values = stored === null ? null : openWorkflowRunValues(stored);
    expect(values?.inputs).toEqual({ reference: 'live-ref' });
    expect(values?.triggerSnapshot).toMatchObject({ type: 'case', id: created.id, status: 'open' });
    expect(api.audit.entries.map((entry) => entry.action)).toContain('case-action.run');
  });

  it('names every scope the caller lacks', async () => {
    const workflowId = await published({ grant: { scopes: ['inquiries:write'], pii: false } });
    const held = await template();
    const created = await caseOn(held);
    const id = await action(workflowId, [held.id]);
    const narrow = await api.newApiKey(api.environmentId, { scopes: ['workflows:trigger'] });
    const response = await run(created.id, id, { reference: 'r' }, narrow);
    expect(response.statusCode).toBe(403);
    expect(response.headers['www-authenticate']).toContain('cases:read');
    expect(response.headers['www-authenticate']).toContain('inquiries:write');
  });

  it('answers 404 for an action not offered on the case’s template, and 410 for a redacted case', async () => {
    const workflowId = await published();
    const held = await template();
    const created = await caseOn(held);
    const elsewhere = await action(workflowId, [(await template()).id]);
    expect((await run(created.id, elsewhere, { reference: 'r' })).statusCode).toBe(404);

    const id = await action(workflowId, [held.id]);
    await api.database.client.query(
      `update cases set fields = null, redacted_at = now() where id = $1`,
      [created.id],
    );
    expect((await run(created.id, id, { reference: 'r' })).statusCode).toBe(410);
  });

  it('refuses parameters the inputs do not take', async () => {
    const workflowId = await published();
    const held = await template();
    const created = await caseOn(held);
    const id = await action(workflowId, [held.id]);
    const response = await run(created.id, id, {});
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'trigger_input_invalid' });
  });
});

describe('POST /inquiries/:id/review-requests (C128.7, P40)', () => {
  const STATEMENT = 'Synthetic statement: please look again.';
  const ask = (inquiryId: string, token?: string) =>
    request(
      'POST',
      `/inquiries/${inquiryId}/review-requests`,
      { meta: { statement: STATEMENT } },
      token ?? api.newUserToken(api.environmentId),
    );

  async function declined(contestRoute: Record<string, unknown> | null) {
    const { inquiry } = await createTestInquiry(db, api.environmentId);
    const decision = await seedInquiryDecision(db, api.environmentId, {
      subjectId: inquiry.id,
      kind: 'decline',
    });
    await api.database.client.query(
      `update inquiry_decisions set contest_route = $1::jsonb where id = $2`,
      [contestRoute === null ? null : JSON.stringify(contestRoute), decision.id],
    );
    return inquiry.id;
  }

  it('opens a case on the route’s template, holding the inquiry, the statement its comment', async () => {
    const held = await template();
    const inquiryId = await declined({
      contact: 'Write to the review desk.',
      'case-template-id': held.id,
    });

    const response = await ask(inquiryId);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = response.json<{ data: { id: string; attributes: { name: string } } }>();
    expect(data.attributes.name).toBe(`${held.key}-1`);
    expect(creation.inputs).toEqual([
      expect.objectContaining({
        environmentId: api.environmentId,
        caseTemplateId: held.id,
        objectIds: [inquiryId],
        creator: { type: 'user', id: expect.stringMatching(/^usr_/) as unknown },
        origin: { 'inquiry-id': inquiryId },
      }),
    ]);
    const comments = await listCaseCommentRows(db, api.environmentId, data.id, { size: 10 });
    expect(comments.items).toEqual([
      expect.objectContaining({ message: STATEMENT, commenterType: 'user' }),
    ]);
    const history = await api.database.client.query<{ kind: string }>(
      'select kind from case_history where case_id = $1 order by id',
      [data.id],
    );
    expect(history.rows.map(({ kind }) => kind)).toEqual(['created', 'object-attached', 'comment-added']);
    const audit = api.audit.entries.find((entry) => entry.action === 'inquiry.review-requested');
    expect(audit).toMatchObject({ resourceId: inquiryId, metadata: { 'case-id': data.id } });
    expect(JSON.stringify(audit)).not.toContain('Synthetic statement');
  });

  it('holds case-create: 429 past it, and lets a request by when the limiter cannot answer', async () => {
    const held = await template();
    const inquiryId = await declined({ contact: 'Write.', 'case-template-id': held.id });
    const decision = (allowed: boolean) => ({
      allowed,
      limit: 600,
      remaining: allowed ? 1 : 0,
      resetAt: new Date(),
      retryAfterSeconds: allowed ? 0 : 60,
    });
    const refusing = vi
      .spyOn(api.deps.rateLimiter, 'consume')
      .mockImplementation((key) => Promise.resolve(decision(!key.startsWith('case-create:'))));
    try {
      expect((await ask(inquiryId)).statusCode).toBe(429);
      expect(creation.inputs).toEqual([]);
    } finally {
      refusing.mockRestore();
    }
    const failing = vi
      .spyOn(api.deps.rateLimiter, 'consume')
      .mockImplementation((key) =>
        key.startsWith('case-create:')
          ? Promise.reject(new Error('synthetic limiter outage'))
          : Promise.resolve(decision(true)),
      );
    try {
      const passed = await ask(inquiryId);
      expect(passed.statusCode, passed.body).toBe(201);
    } finally {
      failing.mockRestore();
    }
  });

  it('refuses an inquiry whose decline names no case template, an API key and a redacted inquiry', async () => {
    const plain = await declined({ contact: 'Write to the review desk.' });
    expect((await ask(plain)).statusCode).toBe(409);
    expect((await ask(await declined(null))).statusCode).toBe(409);
    expect((await ask(newId('inq'))).statusCode).toBe(404);

    const held = await template();
    const routed = await declined({ contact: 'Write.', 'case-template-id': held.id });
    expect((await ask(routed, api.token)).statusCode).toBe(403);
    await api.database.client.query(`update inquiries set redacted_at = now() where id = $1`, [
      routed,
    ]);
    expect((await ask(routed)).statusCode).toBe(410);
    expect(creation.inputs).toEqual([]);
  });
});
