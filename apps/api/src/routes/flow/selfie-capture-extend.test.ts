/**
 * C171.4 (WCAG 2.2.1; Workflow 9A, api-flow-engine, checkpoint "screens"): a person can extend an
 * open selfie capture: `POST /flow/selfie-captures/:id/extend` moves its expiry by 180 s, at least
 * ten times per capture, outside the cap of 10 captures, and is refused once the selfie is
 * submitted (409 `selfie_capture_not_extendable`). Every image is synthetic.
 */
import { SELFIE_CAPTURE_TTL_SECONDS, selfieCaptureDocumentSchema } from '@openverify/contracts';
import { countSelfieCaptures } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
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
  uploadAllPoses,
  uploadPose,
  type SelfieFlow,
} from './selfie.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const extend = (flow: Pick<SelfieFlow, 'sessionToken'>, captureId: string) =>
  api.app.inject({
    method: 'POST',
    url: `${FLOW}/selfie-captures/${captureId}/extend`,
    headers: bearer(flow.sessionToken),
  });

/** Keeps the shared test clock where it was once the test ends. */
function restoreClock(): void {
  const start = api.clock.now();
  onTestFinished(() => {
    api.clock.set(start);
  });
}

describe('POST /api/v1/flow/selfie-captures/:id/extend (C171.4)', () => {
  it('moves the expiry by 180 s ten times, outside the cap, and the capture still takes its upload', async () => {
    restoreClock();
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    let expiresAt = new Date(capture.expiresAt).getTime();
    for (let round = 1; round <= 10; round += 1) {
      // Each round waits until 10 s before the expiry, past the capture's own lifetime.
      api.clock.set(new Date(expiresAt - 10_000));
      const response = await extend(flow, capture.id);
      const body = selfieCaptureDocumentSchema.parse(expectStatus(response, 200));
      expect(body.data.id).toBe(capture.id);
      const moved = new Date(body.data.attributes['expires-at']).getTime();
      expect(moved - expiresAt, `round ${String(round)}`).toBe(SELFIE_CAPTURE_TTL_SECONDS * 1000);
      expect(response.body).not.toContain('nonce');
      expiresAt = moved;
    }
    expect(await countSelfieCaptures(api.database.db, api.environmentId, flow.verificationId)).toBe(
      1,
    );
    expectStatus(await uploadPose(api, flow, capture, 'center'), 201);
  });

  it('refuses an eleventh extension, and an expired capture, with selfie_capture_not_extendable', async () => {
    restoreClock();
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    for (let round = 1; round <= 10; round += 1) {
      expectStatus(await extend(flow, capture.id), 200);
    }
    const eleventh = await extend(flow, capture.id);
    expect(eleventh.statusCode).toBe(409);
    expect(eleventh.json()).toMatchObject({ code: 'selfie_capture_not_extendable' });

    const other = await selfieFlow(api);
    const late = await createCapture(api, other);
    api.clock.set(new Date(new Date(late.expiresAt).getTime() + 1_000));
    expect((await extend(other, late.id)).json()).toMatchObject({
      code: 'selfie_capture_not_extendable',
    });
  });

  it('refuses a submitted capture with 409, and another inquiry’s capture with 404', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    await uploadAllPoses(api, flow, capture);
    expectStatus(await submitCapture(api, flow, capture), 202);
    const submitted = await extend(flow, capture.id);
    expect(submitted.statusCode).toBe(409);
    expect(submitted.json()).toMatchObject({ code: 'selfie_capture_not_extendable' });

    const stranger = await selfieFlow(api);
    const theirs = await createCapture(api, stranger);
    expect((await extend(flow, theirs.id)).statusCode).toBe(404);
  });
});
