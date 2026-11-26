/**
 * C40.10 contract (Workflow 4A Stage 3, api-flow): the flow API never shows the selfie
 * verification attributes, the scores behind them, device data, or the nonce beyond the create
 * response; the `selfie.*` payloads carry neither the nonce nor device data.
 */
import { listApiLogs, replaceVerificationChecks, setVerificationStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus } from '../../test-support/harness.js';
import {
  createCapture,
  FLOW,
  selfieFlow,
  submitCapture,
  uploadPose,
} from './selfie.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

/** Names and values that must never reach the flow (the step's own `poses` and `liveness` may). */
const NEVER_ON_THE_FLOW = [
  'capture-method',
  'document-similarity-score',
  'selfie-similarity-score',
  'liveness-score',
  'center-photo-face-coordinates',
  'face-cosines',
  'face-box',
  'similarity',
  'device',
  'Synthetic Contract Camera',
];

describe('the flow API and the C40.10 attributes', () => {
  it('shows none of them, nor the nonce after the create response, at any step', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    const bodies: string[] = [];
    for (const pose of capture.prompts) {
      const response = await uploadPose(api, flow, capture, pose);
      expectStatus(response, 201);
      bodies.push(response.body);
    }
    const submitted = await submitCapture(api, flow, capture, {
      label: 'Synthetic Contract Camera',
      'image-mirrored': false,
    });
    expectStatus(submitted, 202);
    bodies.push(submitted.body);
    await replaceVerificationChecks(api.database.db, api.environmentId, flow.verificationId, [
      {
        name: 'selfie_id_comparison',
        status: 'passed',
        type: 'fraud',
        requirement: 'required',
        metadata: { similarity: 0.71 },
      },
      {
        name: 'selfie_liveness_detection',
        status: 'passed',
        type: 'fraud',
        requirement: 'required',
        metadata: { 'liveness-score': 0.93, 'face-cosines': { left: 0.85, right: 0.8 } },
      },
      {
        name: 'selfie_image_quality_detection',
        status: 'passed',
        type: 'user_behavior',
        requirement: 'required',
        metadata: { 'face-box': [0.25, 0.2, 0.5, 0.6] },
      },
    ]);
    await setVerificationStatus(api.database.db, api.environmentId, flow.verificationId, {
      to: 'passed',
    });
    for (const url of [`${FLOW}/verifications/${flow.verificationId}`, `${FLOW}/session`]) {
      const response = await api.app.inject({ url, headers: bearer(flow.sessionToken) });
      expectStatus(response, 200);
      bodies.push(response.body);
    }

    for (const body of bodies) {
      for (const word of [...NEVER_ON_THE_FLOW, capture.nonce]) {
        expect(body).not.toContain(word);
      }
    }
  });

  it('keeps the nonce and device data out of every selfie.* payload', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    for (const pose of capture.prompts) {
      expectStatus(await uploadPose(api, flow, capture, pose), 201);
    }
    expectStatus(
      await submitCapture(api, flow, capture, {
        label: 'Synthetic Contract Camera',
        webdriver: true,
      }),
      202,
    );

    const payloads = api.events.events
      .filter((event) => event.name.startsWith('selfie.'))
      .map((event) => JSON.stringify(event.payload));
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    for (const payload of payloads) {
      expect(payload).not.toContain(capture.nonce);
      expect(payload).not.toContain('Synthetic Contract Camera');
      expect(payload).not.toContain('webdriver');
      expect(payload).not.toContain('device');
    }
  });

  it('keeps the nonce and the device label out of the API logs', async () => {
    const tenant = await api.newTenant();
    const flow = await selfieFlow(api, { token: tenant.token });
    const capture = await createCapture(api, flow);
    for (const pose of capture.prompts) {
      expectStatus(await uploadPose(api, flow, capture, pose), 201);
    }
    expectStatus(
      await submitCapture(api, flow, capture, { label: 'Synthetic Contract Camera' }),
      202,
    );
    // A server API call of the same environment is logged: the control that logging ran.
    await api.app.inject({ url: '/api/v1/inquiry-templates', headers: bearer(tenant.token) });

    await vi.waitFor(async () => {
      const page = await listApiLogs(api.database.db, tenant.environmentId, {
        route: '/api/v1/inquiry-templates',
      });
      expect(page.items.map((log) => log.method)).toContain('GET');
    });
    const logs = await listApiLogs(api.database.db, tenant.environmentId, { size: 100 });
    expect(logs.items.length).toBeGreaterThan(0);
    for (const log of logs.items) {
      expect(log.route ?? '').not.toMatch(/^\/api\/v1\/flow/);
      expect(JSON.stringify(log)).not.toContain(capture.nonce);
      expect(JSON.stringify(log)).not.toContain('Synthetic Contract Camera');
    }
  });
});
