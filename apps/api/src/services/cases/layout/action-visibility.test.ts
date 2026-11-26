/**
 * C172.5 (Workflow 9B, `api-cases-reports`; contracts B37, foundation-9b C5, C6; review P28): case
 * action placements and `visible-when`.
 *
 * - An action is placed in the `header`, the `status-switcher` or a layout module (`module:<key>`, a
 *   module of the closed list); another module key is 422 at its pointer. `visible-when` names the
 *   statuses and the roles that see it (an empty list restricts nothing; `null` none); a role of
 *   another organisation is 422. Both are stored, changed, cleared and served.
 * - `GET /cases/:id/available-actions` leaves out an action the case's status or the caller's roles
 *   in this environment do not reach, and `POST /cases/:id/run-action` applies the same function,
 *   answering 403 `case_action_not_available`, so a restriction the console shows is the API's.
 *   An API key holds no role, so an action restricted to roles is never available to one.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createUser, type Db } from '@openverify/db';
import {
  seedCase,
  seedCaseTemplate,
  seedWorkflow,
  seedWorkflowVersion,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../../inquiries.test-support.js';
import { bearer } from '../../../test-support/harness.js';

let api: InquiryTestApi;
let db: Db;

beforeAll(async () => {
  api = await createInquiryTestApi();
  db = api.database.db;
}, 120_000);

afterAll(async () => {
  await api.close();
});

const definition = {
  'schema-version': 1,
  trigger: { type: 'trigger-case', config: {} },
  inputs: [{ name: 'note', type: 'string', required: false }],
  variables: [],
  steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
  edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
  outputs: [],
  layout: {},
};

async function runningWorkflow() {
  const { environmentId } = api;
  const workflow = await seedWorkflow(db, environmentId, { status: 'running' });
  const version = await seedWorkflowVersion(db, environmentId, {
    workflowId: workflow.id,
    status: 'published',
    definition,
  });
  await api.database.client.query(
    `update workflow_versions set "grant" = '{"scopes":[],"pii":false}'::jsonb where id = $1`,
    [version.id],
  );
  await api.database.client.query(
    `update workflows set latest_published_version_id = $1 where id = $2`,
    [version.id, workflow.id],
  );
  return workflow.id;
}

let keys = 0;
async function caseIn(status: string) {
  keys += 1;
  const template = await seedCaseTemplate(db, api.environmentId, { key: `AV${String(keys)}` });
  const made = await seedCase(db, api.environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
  });
  await api.database.client.query('update cases set status = $1 where id = $2', [status, made.id]);
  return { templateId: template.id, caseId: made.id };
}

/** A user of this organisation holding `roleId` in this environment, and its session token. */
async function userWithRole(roleId: string | null) {
  const id = newId('usr');
  await createUser(db, {
    id,
    organizationId: api.organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
  if (roleId !== null) {
    await db.execute(sql`insert into user_roles (organization_id, user_id, role_id, environment_ids)
      values (${api.organizationId}, ${id}, ${roleId}, ${`{${api.environmentId}}`}::text[])`);
  }
  return api.newUserToken(api.environmentId, { userId: id });
}

async function role() {
  const id = newId('role');
  await db.execute(sql`insert into roles (id, organization_id, name, permissions)
    values (${id}, ${api.organizationId}, ${`Synthetic ${id}`}, '{cases:read}'::text[])`);
  return id;
}

let calls = 0;
const request = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  as = api.token,
) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `action-visibility-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

async function action(templateId: string, attributes: Record<string, unknown>) {
  const workflowId = await runningWorkflow();
  const response = await request('POST', '/case-actions', {
    data: {
      type: 'case-action',
      attributes: {
        'workflow-id': workflowId,
        'case-template-ids': [templateId],
        label: 'Escalate',
        ...attributes,
      },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (
    JSON.parse(response.body) as { data: { id: string; attributes: Record<string, unknown> } }
  ).data;
}

const available = async (caseId: string, as = api.token) => {
  const response = await request('GET', `/cases/${caseId}/available-actions`, undefined, as);
  expect(response.statusCode, response.body).toBe(200);
  return (
    JSON.parse(response.body) as { data: { id: string; attributes: { placement: string } }[] }
  ).data;
};

const run = (caseId: string, actionId: string, as = api.token) =>
  request('POST', `/cases/${caseId}/run-action`, { data: { 'case-action-id': actionId } }, as);

describe('placements and visible-when, stored and served (C172.5)', () => {
  it('stores a module placement and visible-when, changes them and clears visible-when', async () => {
    const { templateId } = await caseIn('open');
    const roleId = await role();

    const created = await action(templateId, {
      placement: 'module:timeline',
      'visible-when': { statuses: ['open'], 'role-ids': [roleId] },
    });
    expect(created.attributes).toMatchObject({
      placement: 'module:timeline',
      'visible-when': { statuses: ['open'], 'role-ids': [roleId] },
    });

    const changed = await request('PATCH', `/case-actions/${created.id}`, {
      data: { attributes: { placement: 'status-switcher', 'visible-when': null } },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(
      (JSON.parse(changed.body) as { data: { attributes: Record<string, unknown> } }).data
        .attributes,
    ).toMatchObject({ placement: 'status-switcher', 'visible-when': null });
  });

  it('refuses a module the layout does not know and a role of no organisation, by pointer', async () => {
    const { templateId } = await caseIn('open');
    const workflowId = await runningWorkflow();
    const create = (attributes: Record<string, unknown>) =>
      request('POST', '/case-actions', {
        data: {
          attributes: {
            'workflow-id': workflowId,
            'case-template-ids': [templateId],
            label: 'Escalate',
            ...attributes,
          },
        },
      });

    const module = await create({ placement: 'module:unknown-module' });
    const role = await create({
      'visible-when': { statuses: [], 'role-ids': ['role_00000000000000000000000000'] },
    });

    expect([module.statusCode, role.statusCode]).toEqual([422, 422]);
    const pointerOf = (response: { body: string }) =>
      (JSON.parse(response.body) as { errors?: { pointer?: string }[] }).errors?.[0]?.pointer;
    expect([pointerOf(module), pointerOf(role)]).toEqual([
      '/data/attributes/placement',
      '/data/attributes/visible-when/role-ids/0',
    ]);
  });
});

describe('the one visibility rule in available-actions and run-action (C172.5, P28)', () => {
  it('leaves out and refuses an action the case’s status does not reach', async () => {
    const { templateId, caseId } = await caseIn('open');
    const pending = await action(templateId, {
      placement: 'module:case-actions',
      'visible-when': { statuses: ['pending'], 'role-ids': [] },
    });
    const everywhere = await action(templateId, {
      'visible-when': { statuses: [], 'role-ids': [] },
    });

    const listed = await available(caseId);
    const refused = await run(caseId, pending.id);

    expect(listed.map(({ id }) => id)).toEqual([everywhere.id]);
    expect(refused.statusCode, refused.body).toBe(403);
    expect((JSON.parse(refused.body) as { code?: string }).code).toBe('case_action_not_available');

    await api.database.client.query(`update cases set status = 'pending' where id = $1`, [caseId]);
    const now = await available(caseId);
    expect(now.map(({ id }) => id).sort()).toEqual([pending.id, everywhere.id].sort());
    expect(now.find(({ id }) => id === pending.id)?.attributes.placement).toBe(
      'module:case-actions',
    );
    expect((await run(caseId, pending.id)).statusCode).toBe(200);
  });

  it('serves an action restricted to roles to a user holding one here, and to no one else', async () => {
    const { templateId, caseId } = await caseIn('open');
    const roleId = await role();
    const restricted = await action(templateId, {
      'visible-when': { statuses: [], 'role-ids': [roleId] },
    });
    const holder = await userWithRole(roleId);
    const other = await userWithRole(null);

    expect((await available(caseId, holder)).map(({ id }) => id)).toEqual([restricted.id]);
    expect(await available(caseId, other)).toEqual([]);
    expect(await available(caseId)).toEqual([]);
    const outcomes = [
      await run(caseId, restricted.id, other),
      await run(caseId, restricted.id),
      await run(caseId, restricted.id, holder),
    ];
    expect(outcomes.map(({ statusCode }) => statusCode)).toEqual([403, 403, 200]);
  });
});
