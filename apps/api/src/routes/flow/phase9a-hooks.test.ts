/**
 * Workflow 9A Stage 4 (integration-9a): the shared-file hooks the Stage 3 builders reported
 * missing in `routes/flow/index.ts`.
 * - C151.7: `GET /flow/session` reads `OpenVerify-Flow-Spec` and names the version it served in
 *   the response header, as the screen route already does, so the web flow receives `step` and
 *   `values`.
 * - C151.7: the flow CORS allows and exposes that header, so a cross-origin flow's preflight passes.
 * - C153.2: an upload's `capture-method` field reaches `files.capture_method`; any other value is
 *   a 400, never stored.
 * Every value is synthetic.
 */
import { listInquirySessions, listVerificationFiles } from '@openverify/db';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reachStep, storeFlowPosition } from '../../flow-engine/testing.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  FLOW_ORIGIN,
  IMAGES,
  multipart,
  resumeInquiry,
  seedVerification,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const SESSION = '/api/v1/flow/session';

const FLOW = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'negotiated-read', version: 1, name: 'Negotiated read' },
  entry: 'about',
  steps: [
    {
      id: 'about',
      type: 'screen',
      name: 'Internal name',
      components: [
        { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
      ],
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [{ id: 'e1', from: 'about', port: 'next', to: 'done' }],
});

describe('GET /flow/session negotiates the flow-spec version (C151.7)', () => {
  it('sends the step and its values to a client that declared spec 2, and names version 2', async () => {
    const inquiryId = await storeFlowPosition(api, FLOW, { current: 'about', exited: [] });
    const token = await resumeInquiry(api, inquiryId);
    const response = await api.app.inject({
      url: SESSION,
      headers: { ...bearer(token), 'openverify-flow-spec': '1, 2' },
    });
    const body = expectStatus(response, 200) as unknown as Record<string, unknown>;
    expect(response.headers['openverify-flow-spec']).toBe('2');
    expect(body).toMatchObject({
      'spec-version': 2,
      step: { id: 'about', type: 'screen' },
      values: { nickname: null },
    });
    expect(JSON.stringify(body)).not.toContain('Internal name');
  });

  it('serves spec 1 with no step to a client that declared none, and names version 1', async () => {
    const inquiryId = await storeFlowPosition(api, FLOW, { current: 'about', exited: [] });
    const token = await resumeInquiry(api, inquiryId);
    const response = await api.app.inject({ url: SESSION, headers: bearer(token) });
    const body = expectStatus(response, 200) as unknown as Record<string, unknown>;
    expect(response.headers['openverify-flow-spec']).toBe('1');
    expect(body).not.toHaveProperty('step');
    expect(body).not.toHaveProperty('values');
  });
});

describe('the flow CORS carries OpenVerify-Flow-Spec (C151.7)', () => {
  it('allows the header in a preflight from the flow origin', async () => {
    const response = await api.app.inject({
      method: 'OPTIONS',
      url: SESSION,
      headers: {
        origin: FLOW_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization, openverify-flow-spec',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-headers']).toBe(
      'authorization, content-type, x-request-id, openverify-flow-spec',
    );
  });

  it('exposes the served version to the flow origin', async () => {
    const inquiryId = await createInquiry(api);
    const token = await resumeInquiry(api, inquiryId);
    const response = await api.app.inject({
      url: SESSION,
      headers: { ...bearer(token), origin: FLOW_ORIGIN },
    });
    expect(response.headers['access-control-expose-headers']).toBe(
      'x-request-id, openverify-flow-spec',
    );
  });
});

describe('an upload names its capture method (C153.2)', () => {
  async function atIdStep() {
    const inquiryId = await createInquiry(api);
    const token = await resumeInquiry(api, inquiryId);
    await reachStep(api, inquiryId, token, 'government_id');
    const { id } = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'government_id',
    });
    const sessions = await listInquirySessions(api.database.db, api.environmentId, { inquiryId });
    expect(sessions.items).toHaveLength(1);
    return { token, verificationId: id };
  }

  const send = async (token: string, verificationId: string, fields: Record<string, string>) => {
    const body = await multipart({ ...fields, file: { bytes: IMAGES.jpeg } });
    return api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${verificationId}/files`,
      headers: { ...bearer(token), ...body.headers },
      payload: body.payload,
    });
  };

  it('stores the method the client reports', async () => {
    const at = await atIdStep();
    expectStatus(
      await send(at.token, at.verificationId, { kind: 'front', 'capture-method': 'camera' }),
      201,
    );
    const files = await listVerificationFiles(api.database.db, api.environmentId, [
      at.verificationId,
    ]);
    expect(files.map((file) => file.captureMethod)).toEqual(['camera']);
  });

  it('refuses a method outside the list with 400 and stores nothing', async () => {
    const at = await atIdStep();
    expectStatus(
      await send(at.token, at.verificationId, { kind: 'front', 'capture-method': 'scanner' }),
      400,
    );
    const files = await listVerificationFiles(api.database.db, api.environmentId, [
      at.verificationId,
    ]);
    expect(files).toEqual([]);
  });
});
