/**
 * Workflow 8A Stage 1b (A) (C127.9, C128): the frozen routes of the decision family, registered with
 * their contract schemas and scopes, and in the OpenAPI document. Each reaches its handler after its
 * authentication, scope and schema: `501` until `api-actions` builds it, and its own suite covers the
 * answers. Synthetic values.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const ULID = '01M5CK16P0D13FXHZSS4TCFBVH';
const INQUIRY = `inq_${ULID}`;
const DEVICE = `dev_${ULID}`;

const call = (method: 'GET' | 'POST', url: string, payload?: unknown, token = api.token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const scopedKey = (scopes: readonly string[]) => api.newApiKey(api.environmentId, { scopes });

describe('POST /inquiries/:id/reopen (C128.6)', () => {
  const reopen = { meta: { comment: 'Reviewed by a person' } };

  it('needs inquiries:write', async () => {
    const token = await scopedKey(['inquiries:read']);

    expect((await call('POST', `/inquiries/${INQUIRY}/reopen`, reopen, token)).statusCode).toBe(
      403,
    );
  });

  it('needs its comment', async () => {
    expect((await call('POST', `/inquiries/${INQUIRY}/reopen`, { meta: {} })).statusCode).toBe(400);
  });

  it('reaches its handler', async () => {
    expect((await call('POST', `/inquiries/${INQUIRY}/reopen`, reopen)).statusCode).toBe(404);
  });
});

describe('GET /decisions (C128.1)', () => {
  it('reaches its handler, whose subject scope is its own (V10)', async () => {
    expect((await call('GET', `/decisions?filter[subject-id]=${INQUIRY}`)).statusCode).toBe(200);
  });

  it('refuses another kind of id', async () => {
    expect((await call('GET', `/decisions?filter[subject-id]=rep_${ULID}`)).statusCode).toBe(400);
  });
});

describe('POST /devices/:id/trust (C127.9)', () => {
  const trust = { meta: { 'trust-reason': 'manual_review' } };

  it('needs devices:write', async () => {
    const token = await scopedKey(['inquiry-sessions:read']);

    expect((await call('POST', `/devices/${DEVICE}/trust`, trust, token)).statusCode).toBe(403);
  });

  it('takes a reason or an untrust, never both', async () => {
    const both = { meta: { 'trust-reason': 'manual_review', untrust: true } };

    expect((await call('POST', `/devices/${DEVICE}/trust`, both)).statusCode).toBe(400);
  });

  it('reaches its handler', async () => {
    expect((await call('POST', `/devices/${DEVICE}/trust`, trust)).statusCode).toBe(404);
  });
});

describe('the OpenAPI document', () => {
  it.each(['/api/v1/inquiries/{id}/reopen', '/api/v1/decisions', '/api/v1/devices/{id}/trust'])(
    'holds %s',
    async (path) => {
      const response = await api.app.inject({ url: '/openapi.json' });

      expect(Object.keys(response.json<{ paths: object }>().paths)).toContain(path);
    },
  );
});
