/**
 * Phase 1 walking skeleton, negative case. The ID shows person A, but the fake camera plays
 * person B's head-turn clip (C45.2), so `selfie_id_comparison` fails with `face_mismatch`; the
 * capture itself is sound (person B throughout, turning as prompted). The template (created
 * through the API) allows a single selfie attempt, so the inquiry fails at once, the flow shows
 * its failure step, and a signed `inquiry.failed` webhook arrives.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createInquiryTemplateAttributesSchema,
  type CreateInquiryTemplateAttributes,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { fakeCameraArgs, giveConsent, takeSelfie, uploadId } from './support/flow.js';
import { recordSelfieMeasurements } from './support/measurements.js';
import { createServerApi } from './support/server-api.js';
import { verifyDelivery, waitForEvent } from './support/webhooks.js';

test.use({ launchOptions: { args: fakeCameraArgs(FIXTURES.headTurnDifferent) } });

/** The default template with one selfie attempt, so the failure is final at once. */
async function singleSelfieAttemptTemplate(): Promise<CreateInquiryTemplateAttributes> {
  // The default template is flow-spec 1 (Workflow 9A: a version's flow is either version).
  const template = createInquiryTemplateAttributesSchema.parse(
    JSON.parse(await readFile(FIXTURES.defaultTemplate, 'utf8')),
  ) as DefaultInquiryTemplateAttributes;
  return {
    ...template,
    name: `E2E single selfie attempt ${randomUUID()}`,
    flow: {
      ...template.flow,
      steps: template.flow.steps.map((step) =>
        step.type === 'selfie' ? { ...step, maxAttempts: 1 } : step,
      ),
    },
  };
}

test('a selfie of a different person fails the face match and the inquiry', async ({ page }) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['inquiry.failed', 'verification.failed']);
  try {
    const template = await api.createInquiryTemplate(await singleSelfieAttemptTemplate());
    const inquiry = await api.createInquiry(template.id, `e2e-fails-${randomUUID()}`);
    const { flowUrl } = await api.resumeInquiry(inquiry.id);

    await page.goto(flowUrl);
    await giveConsent(page);
    await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
    const shots = await takeSelfie(page);
    expect(shots.map((shot) => shot.shutter)).toEqual(['auto', 'auto', 'auto']);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification not completed' }),
    ).toBeVisible({ timeout: 90_000 });

    const failed = await waitForEvent(receiver, 'inquiry.failed', inquiry.id);
    expect(verifyDelivery(failed, webhook.attributes.secret)).toBeGreaterThan(0);
    expect(failed.event.attributes.payload.data).toMatchObject({
      id: inquiry.id,
      attributes: { status: 'failed' },
    });

    const document = await api.getInquiry(inquiry.id);
    expect(document.data.attributes.status).toBe('failed');
    const verifications = document.included ?? [];
    expect(
      verifications.map((verification) => [verification.type, verification.attributes.status]),
    ).toEqual([
      ['verification/government-id', 'passed'],
      ['verification/selfie', 'failed'],
    ]);
    const selfie = verifications.find(
      (verification) => verification.type === 'verification/selfie',
    );
    const checks = Object.fromEntries(
      (selfie?.attributes.checks ?? []).map((check) => [check.name, check]),
    );
    expect(checks.selfie_id_comparison).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
      requirement: 'required',
    });
    recordSelfieMeasurements('head-turn-b (fails)', selfie?.attributes.checks ?? []);
    // The selfie itself was usable and live: only the comparison failed (C43).
    for (const name of [
      'selfie_image_quality_detection',
      'selfie_pose_detection',
      'selfie_multiple_faces_detection',
      'selfie_liveness_detection',
    ]) {
      expect(checks[name], name).toMatchObject({ status: 'passed', requirement: 'required' });
    }

    const selfieFailed = await waitForEvent(receiver, 'verification.failed', selfie?.id ?? '');
    expect(verifyDelivery(selfieFailed, webhook.attributes.secret)).toBeGreaterThan(0);
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});
