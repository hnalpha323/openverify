/**
 * C40.1 and C40.10 on the server API (Workflow 4A Stage 3, api-flow):
 * - `GET /api/v1/selfies/:id` (scope `verifications:read`) serves the capture resource, never the
 *   nonce or device data;
 * - selfie verifications and inquiries carry a `selfies` relationship, newest first, and
 *   `?include=selfies` adds the captures to `included`;
 * - a selfie verification's C40.10 attributes come from the consumed capture and from named check
 *   metadata keys at read time, so redaction nulls the scores.
 */
import {
  selfieCaptureDocumentSchema,
  selfieCaptureResourceSchema,
  verificationResourceSchema,
  type SelfieDeviceSnapshot,
} from '@openverify/contracts';
import { redactInquiryRecords, replaceVerificationChecks } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus } from '../../test-support/harness.js';
import {
  createCapture,
  selfieFlow,
  submitCapture,
  uploadAllPoses,
  type HeldCapture,
  type SelfieFlow,
} from '../flow/selfie.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const DEVICE: SelfieDeviceSnapshot = { label: 'Synthetic Camera (0000:0001)', webdriver: false };

/** A selfie with a superseded capture and a second one, submitted. */
async function submittedSelfie(): Promise<{
  flow: SelfieFlow;
  superseded: HeldCapture;
  capture: HeldCapture;
}> {
  const flow = await selfieFlow(api);
  const superseded = await createCapture(api, flow);
  const capture = await createCapture(api, flow);
  await uploadAllPoses(api, flow, capture);
  expectStatus(await submitCapture(api, flow, capture, DEVICE), 202);
  return { flow, superseded, capture };
}

/** The checks the worker would store, with the C40.10 metadata keys (synthetic values). */
async function storeScores(verificationId: string): Promise<void> {
  await replaceVerificationChecks(api.database.db, api.environmentId, verificationId, [
    {
      name: 'selfie_id_comparison',
      status: 'passed',
      type: 'fraud',
      requirement: 'required',
      metadata: { similarity: 0.712345, threshold: 0.363 },
    },
    {
      name: 'selfie_liveness_detection',
      status: 'passed',
      type: 'fraud',
      requirement: 'required',
      metadata: { 'liveness-score': 0.934567, 'face-cosines': { left: 0.85, right: 0.79949 } },
    },
    {
      name: 'selfie_image_quality_detection',
      status: 'passed',
      type: 'user_behavior',
      requirement: 'required',
      metadata: { 'face-box': [0.25, 0.2, 0.5, 0.6] },
    },
  ]);
}

const getJson = (url: string, token = api.token) => api.app.inject({ url, headers: bearer(token) });

describe('GET /api/v1/selfies/:id (C40.1)', () => {
  it('serves the capture with its prompt timings, never the nonce or the device', async () => {
    const { flow, capture } = await submittedSelfie();

    const response = await getJson(`/api/v1/selfies/${capture.id}`);

    const { data } = selfieCaptureDocumentSchema.parse(expectStatus(response, 200));
    expect(data).toMatchObject({
      type: 'selfie',
      id: capture.id,
      attributes: { status: 'submitted', 'capture-method': 'camera', liveness: 'active' },
      relationships: {
        verification: { data: { type: 'verification/selfie', id: flow.verificationId } },
        inquiry: { data: { type: 'inquiry', id: flow.inquiryId } },
      },
    });
    expect(data.attributes['prompt-timings'].map((timing) => timing.pose)).toEqual(capture.prompts);
    expect(response.body).not.toContain(capture.nonce);
    expect(response.body).not.toContain('Synthetic Camera');
  });

  it('answers 404 for a capture of another environment', async () => {
    const { capture } = await submittedSelfie();
    const other = await api.newTenant();

    expect((await getJson(`/api/v1/selfies/${capture.id}`, other.token)).statusCode).toBe(404);
  });

  it('needs verifications:read', async () => {
    const { capture } = await submittedSelfie();
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expect((await getJson(`/api/v1/selfies/${capture.id}`, reader)).statusCode).toBe(403);
  });
});

describe('the selfie verification with its captures (C40.1, C40.10)', () => {
  it('lists its captures newest first and takes method, liveness and poses from the consumed one', async () => {
    const { flow, superseded, capture } = await submittedSelfie();

    const response = await getJson(`/api/v1/verifications/${flow.verificationId}`);

    const document = expectStatus(response, 200);
    const resource = verificationResourceSchema.parse(document.data);
    expect(resource.relationships.selfies?.data).toEqual([
      { type: 'selfie', id: capture.id },
      { type: 'selfie', id: superseded.id },
    ]);
    expect(resource.attributes).toMatchObject({
      'capture-method': 'camera',
      liveness: 'active',
      poses: capture.prompts,
      'document-similarity-score': null,
      'liveness-score': null,
      'center-photo-face-coordinates': null,
    });
  });

  it('derives the scores from the check metadata at read time', async () => {
    const { flow } = await submittedSelfie();
    await storeScores(flow.verificationId);

    const response = await getJson(`/api/v1/verifications/${flow.verificationId}`);

    expect(
      verificationResourceSchema.parse(expectStatus(response, 200).data).attributes,
    ).toMatchObject({
      'document-similarity-score': 0.7123,
      'selfie-similarity-score-left': 0.85,
      'selfie-similarity-score-right': 0.7995,
      'liveness-score': 0.9346,
      'center-photo-face-coordinates': [
        [0.25, 0.2],
        [0.75, 0.2],
        [0.75, 0.8],
        [0.25, 0.8],
      ],
    });
  });

  it('nulls the scores once the inquiry is redacted', async () => {
    const { flow } = await submittedSelfie();
    await storeScores(flow.verificationId);
    await redactInquiryRecords(api.database.db, api.environmentId, flow.inquiryId);

    const response = await getJson(`/api/v1/verifications/${flow.verificationId}`);

    expect(
      verificationResourceSchema.parse(expectStatus(response, 200).data).attributes,
    ).toMatchObject({
      'document-similarity-score': null,
      'selfie-similarity-score-left': null,
      'selfie-similarity-score-right': null,
      'liveness-score': null,
      'center-photo-face-coordinates': null,
    });
  });

  it('includes the captures with ?include=selfies', async () => {
    const { flow, superseded, capture } = await submittedSelfie();

    const response = await getJson(`/api/v1/verifications/${flow.verificationId}?include=selfies`);

    const included = (expectStatus(response, 200).included ?? []).map((resource) =>
      selfieCaptureResourceSchema.parse(resource),
    );
    expect(included.map((resource) => [resource.id, resource.attributes.status])).toEqual([
      [capture.id, 'submitted'],
      [superseded.id, 'errored'],
    ]);
  });

  it('answers 400 for an unknown include', async () => {
    const { flow } = await submittedSelfie();

    expect(
      (await getJson(`/api/v1/verifications/${flow.verificationId}?include=files,nope`)).statusCode,
    ).toBe(400);
  });
});

describe('the inquiry with its captures (C40.1)', () => {
  it('lists the captures newest first and includes them with ?include=selfies', async () => {
    const { flow, superseded, capture } = await submittedSelfie();

    const response = await getJson(`/api/v1/inquiries/${flow.inquiryId}?include=selfies`);

    const document = expectStatus(response, 200) as unknown as {
      data: { relationships: { selfies?: { data: { id: string }[] } } };
      included: { type: string; id: string }[];
    };
    expect(document.data.relationships.selfies?.data.map((link) => link.id)).toEqual([
      capture.id,
      superseded.id,
    ]);
    expect(document.included.map((resource) => [resource.type, resource.id])).toEqual([
      ['selfie', capture.id],
      ['selfie', superseded.id],
    ]);
  });

  it('includes the verifications and the captures together', async () => {
    const { flow, capture } = await submittedSelfie();

    const response = await getJson(
      `/api/v1/inquiries/${flow.inquiryId}?include=verifications,selfies`,
    );

    const included = (expectStatus(response, 200).included ?? []).map((resource) => [
      resource.type,
      resource.id,
    ]);
    expect(included).toContainEqual(['verification/selfie', flow.verificationId]);
    expect(included).toContainEqual(['selfie', capture.id]);
  });

  it('needs verifications:read to include the captures', async () => {
    const { flow } = await submittedSelfie();
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expect(
      (await getJson(`/api/v1/inquiries/${flow.inquiryId}?include=selfies`, reader)).statusCode,
    ).toBe(403);
  });
});
