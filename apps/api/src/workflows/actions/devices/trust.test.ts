/**
 * Workflow 8A Stage 3 (`api-actions`; C127.9): `POST /devices/:id/trust`: the mark is set and cleared
 * whole, audit-logged, a device of another environment is 404, and no signal reads it. Synthetic.
 */
import { seedDevice } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../../services/inquiries.test-support.js';
import { bearer } from '../../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const trust = (id: string, meta: Record<string, unknown>, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/devices/${id}/trust`,
    headers: bearer(token),
    payload: { meta },
  });

describe('POST /devices/:id/trust (C127.9)', () => {
  it('sets the mark with its reason, and audits it', async () => {
    const { id } = await seedDevice(api.database.db, api.environmentId);
    const response = await trust(id, { 'trust-reason': 'manual_review' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        id,
        attributes: { 'trust-reason': 'manual_review', 'trusted-by': { type: 'api-key' } },
      },
    });
    expect(api.audit.entries.map(({ action }) => action)).toContain('device.trusted');
  });

  it('clears the whole mark, and audits that', async () => {
    const { id } = await seedDevice(api.database.db, api.environmentId);
    await trust(id, { 'trust-reason': 'manual_review' });
    const response = await trust(id, { untrust: true });
    expect(response.json()).toMatchObject({
      data: { attributes: { 'trusted-at': null, 'trusted-by': null, 'trust-reason': null } },
    });
    expect(api.audit.entries.map(({ action }) => action)).toContain('device.untrusted');
  });

  it('answers 404 for a device of another environment', async () => {
    const other = await api.newTenant();
    const { id } = await seedDevice(api.database.db, other.environmentId);
    expect((await trust(id, { 'trust-reason': 'manual_review' })).statusCode).toBe(404);
  });
});
