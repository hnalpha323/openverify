/**
 * K7B-2 (owner decision 6 after Workflow 7B, C101.6): `GET /accounts/:id/graph-component`
 * (`graph:read`). A separate route rather than an attribute on the account, so a viewer, who never
 * holds `graph:read`, receives no graph data on the account read. The run-local `component-id` is
 * never served, and nothing here is PII. Every value is synthetic.
 */
import { replaceGraphComponents, updateEnvironmentSettings } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;
const COMPUTED_AT = new Date('2026-10-20T03:00:00.000Z');

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

async function account(): Promise<string> {
  const created = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: bearer(api.token),
      payload: { data: { type: 'account', attributes: {} } },
    }),
    201,
  );
  return created.data.id;
}

const read = (id: string, token = api.token) =>
  api.app.inject({ url: `/api/v1/accounts/${id}/graph-component`, headers: bearer(token) });

const setComponents = (on: boolean) =>
  updateEnvironmentSettings(api.database.db, api.environmentId, { 'graph-components': on });

describe('GET /accounts/:id/graph-component (C101.6)', () => {
  it('answers disabled while the setting is off, whatever a past run left', async () => {
    await setComponents(false);
    const id = await account();
    await replaceGraphComponents(
      api.database.db,
      api.environmentId,
      [{ accountId: id, componentId: 'run-local', size: 3 }],
      COMPUTED_AT,
    );

    expect(expectStatus(await read(id), 200)).toEqual({
      data: {
        type: 'account-graph-component',
        id,
        attributes: { state: 'disabled', size: null, 'computed-at': null },
      },
    });
  });

  it('answers not-computed for an account newer than the last run', async () => {
    await setComponents(true);

    const document = expectStatus(await read(await account()), 200);

    expect(document.data.attributes).toEqual({
      state: 'not-computed',
      size: null,
      'computed-at': null,
    });
  });

  it('answers computed with its size and time, never the run-local component id', async () => {
    await setComponents(true);
    const id = await account();
    await replaceGraphComponents(
      api.database.db,
      api.environmentId,
      [{ accountId: id, componentId: 'run-local', size: 7 }],
      COMPUTED_AT,
    );

    const response = await read(id);

    expect(expectStatus(response, 200).data.attributes).toEqual({
      state: 'computed',
      size: 7,
      'computed-at': COMPUTED_AT.toISOString(),
    });
    expect(response.body).not.toContain('run-local');
  });

  it('answers 404 for an account this environment does not hold', async () => {
    const tenant = await api.newTenant();
    const id = await account();

    expect((await read(id, tenant.token)).statusCode).toBe(404);
  });

  it('needs graph:read; accounts:read alone is refused', async () => {
    const id = await account();
    const viewer = api.newUserToken(api.environmentId, { permissions: ['accounts:read'] });
    const reader = api.newUserToken(api.environmentId, { permissions: ['graph:read'] });

    expect((await read(id, viewer)).statusCode).toBe(403);
    expect((await read(id, reader)).statusCode).toBe(200);
  });

  it('answers a redacted account as GET /accounts/:id does', async () => {
    await setComponents(true);
    const id = await account();
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/accounts/${id}/redact`,
        headers: bearer(api.token),
        payload: {},
      }),
      200,
    );
    const plain = await api.app.inject({
      url: `/api/v1/accounts/${id}`,
      headers: bearer(api.token),
    });

    expect((await read(id)).statusCode).toBe(plain.statusCode);
  });
});
