/**
 * Workflow 4A Stage 1: the C40 routes answer 501 until `api-flow` builds them (Stage 3), so the
 * OpenAPI snapshot is complete; the upload takes the three capture fields (C40.3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, openFlowSession } from '../test-support/harness.js';
import { UPLOAD_LIMITS } from './flow/index.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

describe('the C40 route stubs', () => {
  // Workflow 4A Stage 3 built the create route: selfie-capture-create.test.ts covers it.

  it('refuse a create body that is not the contract', async () => {
    const { sessionToken } = await openFlowSession(api);
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/verifications/ver_01M5CJXHG07XPHF3HRM6NREDH8/selfies',
      headers: bearer(sessionToken),
      payload: { method: 'video' },
    });
    expect(response.statusCode).toBe(400);
  });

  // Workflow 4A Stage 3 built GET /api/v1/selfies/:id: server/selfies.test.ts covers it.

  it('list both routes in the OpenAPI document', async () => {
    const response = await api.app.inject({ method: 'GET', url: '/openapi.json' });
    const paths = Object.keys(response.json<{ paths: Record<string, unknown> }>().paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/api/v1/flow/verifications/{id}/selfies', '/api/v1/selfies/{id}']),
    );
  });
});

describe('the upload limits (C40.3, C153.2, C206.2)', () => {
  // Workflow 10B Stage 1b: capture-trigger is the sixth field, so the limits move by one each.
  it('take seven fields (kind, the three capture fields, capture-method and capture-trigger, with one spare) and eight parts', () => {
    expect(UPLOAD_LIMITS).toMatchObject({ files: 1, fields: 7, parts: 8 });
  });
});
