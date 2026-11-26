/**
 * Workflow 11A Stage 1b (C) (`foundation-11a`): `POST /api/v1/dashboard/connect/connections/:id/activate`,
 * the destination's activation, a BFF route that takes a user session only (an API key never reaches
 * a dashboard route), frozen with its contract schema at 501 until `api-connect` builds it (the
 * permission `connect-connections:activate`, the step-up of C231.3, the policy version check), and
 * behind the install switch: while Connect is off it answers the one generic 404 (C231.10).
 */
import { CONNECT_NOT_FOUND_PROBLEM } from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

const ACTIVATE = '/connect/connections/cxn_01M5CN0000000000000011A100/activate';
const body = {
  data: {
    attributes: {
      'policy-version': 1,
      'agreement-reference': 'Example data-sharing agreement 2026-11 (synthetic)',
      acknowledged: true,
    },
  },
};

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);
afterAll(async () => {
  await database.close();
});

async function signedInAdmin(api: DashboardHarness) {
  const organization = await api.organization();
  const { email } = await api.operator(organization, { roles: ['admin'] });
  return api.signIn(email);
}

describe('the activate route (C231.3, C231.10)', () => {
  it('answers the one generic 404 while Connect is off', async () => {
    const api = await createDashboardHarness(database);
    try {
      const response = await api.call('POST', ACTIVATE, {
        token: await signedInAdmin(api),
        payload: body,
      });
      expect(response.statusCode).toBe(404);
      const problem = Object.fromEntries(
        Object.entries(response.json<Record<string, unknown>>()).filter(
          ([member]) => member !== 'instance' && member !== 'requestId',
        ),
      );
      expect(problem).toEqual(CONNECT_NOT_FOUND_PROBLEM);
    } finally {
      await api.close();
    }
  });

  it('answers the one 404 for an unknown connection while Connect is on, and 401 without a session', async () => {
    const api = await createDashboardHarness(database, { connect: { enabled: true } });
    try {
      const response = await api.call('POST', ACTIVATE, {
        token: await signedInAdmin(api),
        payload: body,
      });
      // Built by api-connect (connect-activate.test.ts): no connection with this id is the caller's.
      expect(response.statusCode, response.body).toBe(404);
      expect((await api.call('POST', ACTIVATE, { payload: body })).statusCode).toBe(401);
    } finally {
      await api.close();
    }
  });

  it('refuses a body without the acknowledgement (400), before anything else', async () => {
    const api = await createDashboardHarness(database, { connect: { enabled: true } });
    try {
      const response = await api.call('POST', ACTIVATE, {
        token: await signedInAdmin(api),
        payload: { data: { attributes: { 'policy-version': 1 } } },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await api.close();
    }
  });
});
