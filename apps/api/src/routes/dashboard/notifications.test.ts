/**
 * Workflow 8B Stage 1b, checkpoint (C) (C134.4): the notification routes are frozen on the dashboard
 * API behind the operator's session, with `cases:read`; `api-cases` built them
 * (`services/cases/notifications.test.ts` holds their behaviour).
 * Every value is synthetic.
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

const NOTIFICATION = 'unot_01M5CK3190XEVBM5ZXA76E1JSN';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function signedIn(roles: ('reviewer' | 'viewer')[]) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const token = await api.signIn((await api.operator(organization, { roles })).email);
  return { api, token };
}

describe('the notification routes (C134.4)', () => {
  it('answer a reviewer: an empty list, and 404 for a notification that is not theirs', async () => {
    const { api, token } = await signedIn(['reviewer']);

    const listed = await api.call('GET', '/notifications', { token });
    const read = await api.call('POST', `/notifications/${NOTIFICATION}/read`, {
      token,
      payload: { meta: {} },
    });

    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ data: unknown[] }>().data).toEqual([]);
    expect(read.statusCode).toBe(404);
  });

  it('refuse a request without a session', async () => {
    const { api } = await signedIn(['reviewer']);

    expect((await api.call('GET', '/notifications')).statusCode).toBe(401);
  });
});
