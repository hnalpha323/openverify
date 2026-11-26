/**
 * Test support for `api-queues-sla`'s suites (Workflow 8B Stage 3): people with roles in the
 * database, route calls, and templates published with a queue, a policy or an SLA. Synthetic only.
 */
import { newId } from '@openverify/contracts';
import { createUser } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { bearer, type TestApi } from '../../../test-support/harness.js';

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: unknown }>;
}

export interface Answer {
  status: number;
  body: {
    data: Resource & Resource[];
    meta?: Record<string, unknown>;
    links?: { next: string | null };
    code?: string;
    detail?: string;
    dates?: string[];
    errors?: { pointer?: string; detail?: string }[];
  };
  raw: string;
  headers: Record<string, unknown>;
}

let calls = 0;

/** One request to `/api/v1`, with an idempotency key of its own. */
export async function call(
  api: TestApi,
  token: string,
  method: Method,
  url: string,
  payload?: unknown,
): Promise<Answer> {
  calls += 1;
  const response = await api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(token), 'idempotency-key': `queues-sla-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return {
    status: response.statusCode,
    body: (response.body === '' ? {} : JSON.parse(response.body)) as Answer['body'],
    raw: response.body,
    headers: response.headers,
  };
}

/** The answer's body, failing with it when the status is not `status`. */
export function expectAnswer(answer: Answer, status: number): Answer['body'] {
  expect(answer.status, answer.raw).toBe(status);
  return answer.body;
}

export interface Person {
  id: string;
  roleId: string;
  /** A session of this user, holding `permissions` (every permission by default). */
  token: string;
}

/**
 * A user of the harness's organisation in the database, holding `permissions` through a role of its
 * own, with a session; `status` deactivates it.
 */
export async function person(
  api: TestApi,
  options: {
    permissions?: readonly string[];
    sessionPermissions?: readonly string[];
    status?: 'active' | 'deactivated';
    environmentId?: string;
    organizationId?: string;
  } = {},
): Promise<Person> {
  const environmentId = options.environmentId ?? api.environmentId;
  const organizationId = options.organizationId ?? api.organizationId;
  const id = newId('usr');
  await createUser(api.database.db, {
    id,
    organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
  const permissions = options.permissions ?? ['cases:read', 'cases:write'];
  const roleId = newId('role');
  await api.database.db.execute(sql`insert into roles (id, organization_id, name, permissions)
    values (${roleId}, ${organizationId}, ${`Synthetic ${roleId}`},
      ${`{${permissions.join(',')}}`}::text[])`);
  await api.database.db.execute(sql`insert into user_roles (organization_id, user_id, role_id)
    values (${organizationId}, ${id}, ${roleId})`);
  if (options.status === 'deactivated') {
    await api.database.db.execute(sql`update users set status = 'deactivated' where id = ${id}`);
  }
  const token = api.newUserToken(environmentId, {
    userId: id,
    ...(options.sessionPermissions === undefined
      ? {}
      : { permissions: options.sessionPermissions as never }),
  });
  return { id, roleId, token };
}

let keys = 0;

/**
 * A template published with `attributes` (a queue, a policy, an SLA policy, statuses), through the
 * template routes: its id, key and the published version's id.
 */
export async function publishedTemplate(
  api: TestApi,
  attributes: Record<string, unknown> = {},
  token = api.token,
): Promise<{ id: string; key: string; versionId: string }> {
  keys += 1;
  const created = expectAnswer(
    await call(api, token, 'POST', '/case-templates', {
      data: { attributes: { name: 'Synthetic review', key: `QS${String(keys)}`, ...attributes } },
    }),
    201,
  );
  const draft = (created.data.relationships?.['draft-version']?.data as { id: string }).id;
  expectAnswer(
    await call(api, token, 'POST', `/case-template-versions/${draft}/publish`, { meta: {} }),
    200,
  );
  return { id: created.data.id, key: String(created.data.attributes.key), versionId: draft };
}

/** A case created through `POST /cases`. */
export async function newCase(
  api: TestApi,
  templateId: string,
  attributes: Record<string, unknown> = {},
  meta?: Record<string, unknown>,
  token = api.token,
): Promise<Resource> {
  return expectAnswer(
    await call(api, token, 'POST', '/cases', {
      data: { attributes: { 'case-template-id': templateId, ...attributes } },
      ...(meta === undefined ? {} : { meta }),
    }),
    201,
  ).data;
}

/** A case as `GET /cases/:id` reads it. */
export async function readCase(api: TestApi, id: string): Promise<Resource> {
  return expectAnswer(await call(api, api.token, 'GET', `/cases/${id}`), 200).data;
}

/** The kinds of a case's timeline, oldest first. */
export async function historyOf(
  api: TestApi,
  id: string,
): Promise<{ kind: string; actorType: string; from: unknown; to: unknown }[]> {
  const result = await api.database.db.execute(sql`select kind, actor_type, "from", "to"
    from case_history where case_id = ${id} order by id`);
  return (
    result as unknown as {
      rows: { kind: string; actor_type: string; from: unknown; to: unknown }[];
    }
  ).rows.map((row) => ({ kind: row.kind, actorType: row.actor_type, from: row.from, to: row.to }));
}

/** A week of the same `[start, end)` on weekdays and nothing at the weekend. */
export function weekdays(start = '09:00', end = '17:00') {
  const day = [{ start, end }];
  return {
    monday: day,
    tuesday: day,
    wednesday: day,
    thursday: day,
    friday: day,
    saturday: [],
    sunday: [],
  };
}

/** Every day of the week, around the clock. */
export const ALL_WEEK = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => [
    day,
    [{ start: '00:00', end: '24:00' }],
  ]),
);
