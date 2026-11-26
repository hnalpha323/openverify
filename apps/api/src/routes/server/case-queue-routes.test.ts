/**
 * Workflow 8B Stage 1b, checkpoint (Q) (C129.5, C132, C133): every route of the (Q) family is
 * registered in its implementer's file with its schema and scope, and answered 501 until
 * `api-queues-sla` built it (Stage 3): now none answers 501 or any server error. A key without the route's scope gets 403
 * before anything is read, and a body that does not fit the frozen schema gets 400.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

const CASE = 'case_01M6FQZCV622MRCK2ZKC7F4HD9';
const QUEUE = 'cqueue_01M5CK3190XEVBM5ZXA76E1JSN';
const POLICY = 'cap_01M5CK3190XEVBM5ZXA76E1JSN';
const SLA_POLICY = 'cslap_01M5CK3190XEVBM5ZXA76E1JSN';
const CALENDAR = 'ccal_01M5CK3190XEVBM5ZXA76E1JSN';
const TEMPLATE = 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN';
const USER = 'usr_01M5CK3190XEVBM5ZXA76E1JSN';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

interface Frozen {
  method: Method;
  url: string;
  scope: string;
  body?: Record<string, unknown>;
}

const DAY = [{ start: '09:00', end: '17:00' }];
const WEEK = {
  monday: DAY,
  tuesday: DAY,
  wednesday: DAY,
  thursday: DAY,
  friday: DAY,
  saturday: [],
  sunday: [],
};

const ASSIGN: Frozen = {
  method: 'POST',
  url: `/cases/${CASE}/assign`,
  scope: 'cases:write',
  body: { meta: { 'user-id': USER } },
};

/** One valid request per frozen route, with the scope it needs. */
const ROUTES: readonly Frozen[] = [
  { method: 'GET', url: '/case-queues', scope: 'case-queues:read' },
  {
    method: 'POST',
    url: '/case-queues',
    scope: 'case-queues:write',
    body: { data: { type: 'case-queue', attributes: { name: 'Synthetic queue' } } },
  },
  { method: 'GET', url: `/case-queues/${QUEUE}`, scope: 'case-queues:read' },
  {
    method: 'PATCH',
    url: `/case-queues/${QUEUE}`,
    scope: 'case-queues:write',
    body: { data: { type: 'case-queue', attributes: { status: 'archived' } } },
  },
  {
    method: 'PUT',
    url: `/case-queues/${QUEUE}/members`,
    scope: 'case-queues:write',
    body: { data: { type: 'case-queue', attributes: { members: [{ 'user-id': USER }] } } },
  },
  ASSIGN,
  { method: 'POST', url: '/cases/next', scope: 'cases:write', body: { meta: {} } },
  { method: 'GET', url: '/case-assignment-policies', scope: 'case-queues:read' },
  {
    method: 'POST',
    url: '/case-assignment-policies',
    scope: 'case-queues:write',
    body: {
      data: {
        type: 'case-assignment-policy',
        attributes: {
          name: 'Synthetic policy',
          distribution: 'round-robin',
          sources: [{ type: 'case-template', id: TEMPLATE }],
        },
      },
    },
  },
  { method: 'GET', url: `/case-assignment-policies/${POLICY}`, scope: 'case-queues:read' },
  {
    method: 'PATCH',
    url: `/case-assignment-policies/${POLICY}`,
    scope: 'case-queues:write',
    body: { data: { type: 'case-assignment-policy', attributes: { sort: 'sla-expires-at' } } },
  },
  { method: 'GET', url: '/case-sla-policies', scope: 'case-queues:read' },
  {
    method: 'POST',
    url: '/case-sla-policies',
    scope: 'case-queues:write',
    body: {
      data: {
        type: 'case-sla-policy',
        attributes: { name: 'Synthetic SLA', 'target-minutes': 240 },
      },
    },
  },
  { method: 'GET', url: `/case-sla-policies/${SLA_POLICY}`, scope: 'case-queues:read' },
  {
    method: 'PATCH',
    url: `/case-sla-policies/${SLA_POLICY}`,
    scope: 'case-queues:write',
    body: { data: { type: 'case-sla-policy', attributes: { 'on-reopen': 'restart' } } },
  },
  { method: 'GET', url: '/case-calendars', scope: 'case-queues:read' },
  {
    method: 'POST',
    url: '/case-calendars',
    scope: 'case-queues:write',
    body: {
      data: {
        type: 'case-calendar',
        attributes: { name: 'Synthetic hours', 'time-zone': 'Europe/London', week: WEEK },
      },
    },
  },
  { method: 'GET', url: `/case-calendars/${CALENDAR}`, scope: 'case-queues:read' },
  {
    method: 'PATCH',
    url: `/case-calendars/${CALENDAR}`,
    scope: 'case-queues:write',
    body: { data: { type: 'case-calendar', attributes: { name: 'Synthetic hours again' } } },
  },
  {
    method: 'POST',
    url: `/case-calendars/${CALENDAR}/holidays/import`,
    scope: 'case-queues:write',
    body: {
      data: { type: 'case-calendar', attributes: { csv: 'date,label\r\n2026-12-25,Closed\r\n' } },
    },
  },
];

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

const call = (route: Frozen, token: string, body = route.body) =>
  api.app.inject({
    method: route.method,
    url: `/api/v1${route.url}`,
    headers: { ...bearer(token), 'idempotency-key': `synthetic-${route.method}-${route.url}` },
    ...(body === undefined ? {} : { payload: body }),
  });

describe('the frozen (Q) routes (C129.5)', () => {
  it.each(ROUTES.map((route) => [`${route.method} ${route.url}`, route] as const))(
    '%s is built by its owner: no longer 501, and no server error',
    async (_name, route) => {
      const user = api.newUserToken(api.environmentId);

      const response = await call(route, user);

      expect(response.statusCode, response.body).toBeLessThan(500);
    },
  );

  it.each(ROUTES.map((route) => [`${route.method} ${route.url}`, route] as const))(
    '%s refuses a key without its scope',
    async (_name, route) => {
      const token = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });

      const response = await call(route, token);

      expect(response.statusCode, response.body).toBe(403);
      expect(response.headers['www-authenticate']).toContain(route.scope);
    },
  );

  it.each(
    ROUTES.filter(({ body }) => body !== undefined && !('meta' in body)).map(
      (route) => [`${route.method} ${route.url}`, route] as const,
    ),
  )('%s refuses a body outside its frozen schema', async (_name, route) => {
    const user = api.newUserToken(api.environmentId);

    const response = await call(route, user, { data: { type: 'case', attributes: {} } });

    expect(response.statusCode, response.body).toBe(400);
  });

  it('refuses an assignment naming both a user and an address', async () => {
    const user = api.newUserToken(api.environmentId);

    const response = await call(ASSIGN, user, {
      meta: { 'user-id': USER, 'user-email-address': 'reviewer@example.com' },
    });

    expect(response.statusCode, response.body).toBe(400);
  });
});
