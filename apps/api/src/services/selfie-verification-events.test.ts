/**
 * C40.10 in the `verification.*` events (Workflow 4A Stage 3, api-flow): the worker stages them
 * through `stageVerificationEvent`, which gives a selfie verification its `selfies` relationship
 * and the attributes derived from the consumed capture and the check metadata.
 */
import { eventPayloadSchema, verificationResourceSchema } from '@openverify/contracts';
import { getVerification, replaceVerificationChecks } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCapture,
  selfieFlow,
  submitCapture,
  uploadAllPoses,
} from '../routes/flow/selfie.test-support.js';
import { expectStatus } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { stageVerificationEvent } from './verifications.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

describe('stageVerificationEvent for a selfie (C40.10)', () => {
  it('carries the captures and the derived attributes', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    await uploadAllPoses(api, flow, capture);
    expectStatus(await submitCapture(api, flow, capture), 202);
    await replaceVerificationChecks(api.database.db, api.environmentId, flow.verificationId, [
      {
        name: 'selfie_liveness_detection',
        status: 'passed',
        type: 'fraud',
        requirement: 'required',
        metadata: { 'liveness-score': 0.95, 'face-cosines': { left: 0.84, right: 0.81 } },
      },
    ]);
    const verification = await getVerification(
      api.database.db,
      api.environmentId,
      flow.verificationId,
    );
    if (verification === null) {
      throw new Error('the verification exists');
    }

    const staged = await stageVerificationEvent(
      api.database.db,
      api.events,
      'verification.passed',
      verification,
      [],
    );
    await api.events.dispatch([staged]);

    const event = api.events.events.find((candidate) => candidate.id === staged.eventId);
    const resource = verificationResourceSchema.parse(eventPayloadSchema.parse(event?.payload).data);
    expect(resource.relationships.selfies?.data).toEqual([{ type: 'selfie', id: capture.id }]);
    expect(resource.attributes).toMatchObject({
      'capture-method': 'camera',
      liveness: 'active',
      poses: capture.prompts,
      'liveness-score': 0.95,
      'selfie-similarity-score-left': 0.84,
      'selfie-similarity-score-right': 0.81,
      'document-similarity-score': null,
    });
  });
});
