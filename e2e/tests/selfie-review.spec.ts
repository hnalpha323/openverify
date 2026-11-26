/**
 * C44, C45.3: a template that requires an A-tier selfie check whose provider the e2e stack leaves
 * unbound (`selfie_public_figure_detection`, see `e2e/src/env.ts`). The check has no evidence,
 * so it answers `not_applicable`/`provider_not_configured`, which blocks a required check
 * (ADR 0002 §3b, §3e): the selfie goes to `needs_review` instead of passing, though every other
 * selfie check passed. The user's part is done all the same (C30.6): the flow ends on the
 * normal completion screen. The inquiry is completed, then marked for review in the same
 * transaction (C30.5); it is never approved automatically.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import {
  collectConsoleErrors,
  fakeCameraArgs,
  giveConsent,
  takeSelfie,
  uploadId,
} from './support/flow.js';
import { defaultTemplateAttributes } from './support/platform.js';
import { createServerApi } from './support/server-api.js';
import { eventNamesFor, waitForEvent } from './support/webhooks.js';

test.use({ launchOptions: { args: fakeCameraArgs(FIXTURES.headTurnMatching) } });

test('a required A-tier selfie check without a provider sends the selfie to review (C44)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['*']);
  try {
    const attributes = await defaultTemplateAttributes(`E2E A-tier selfie ${randomUUID()}`);
    const config = attributes['verification-config'];
    const selfieConfig = config.selfie;
    if (selfieConfig === undefined) {
      throw new Error('The default template has no selfie verification config');
    }
    const template = await api.createInquiryTemplate({
      ...attributes,
      'verification-config': {
        ...config,
        selfie: {
          ...selfieConfig,
          checks: {
            ...selfieConfig.checks,
            selfie_public_figure_detection: { enabled: true, required: true },
          },
        },
      },
    });
    const inquiry = await api.createInquiry(template.id, `e2e-selfie-review-${randomUUID()}`);
    const { flowUrl } = await api.resumeInquiry(inquiry.id);

    const errors = collectConsoleErrors(page);
    await page.goto(flowUrl);
    await giveConsent(page);
    await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
    const shots = await takeSelfie(page);
    expect(shots.map((shot) => shot.shutter)).toEqual(['auto', 'auto', 'auto']);
    // Review counts as done for the user (C30.6).
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible({ timeout: 90_000 });
    expect(errors).toEqual([]);

    await waitForEvent(receiver, 'inquiry.completed', inquiry.id);
    await waitForEvent(receiver, 'inquiry.marked-for-review', inquiry.id);
    expect(eventNamesFor(receiver, inquiry.id)).not.toContain('inquiry.approved');

    const document = await api.getInquiry(inquiry.id);
    expect(document.data.attributes.status).toBe('needs_review');
    const verifications = document.included ?? [];
    expect(
      verifications.map((verification) => [verification.type, verification.attributes.status]),
    ).toEqual([
      ['verification/government-id', 'passed'],
      ['verification/selfie', 'needs_review'],
    ]);
    const checks = Object.fromEntries(
      (
        verifications.find((verification) => verification.type === 'verification/selfie')
          ?.attributes.checks ?? []
      ).map((check) => [check.name, check]),
    );
    expect(checks.selfie_public_figure_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
      requirement: 'required',
      stage: 'beta',
      confidence: null,
    });
    // Nothing else holds the selfie back: every other required check passed.
    for (const check of Object.values(checks)) {
      if (check.requirement === 'required' && check.name !== 'selfie_public_figure_detection') {
        expect(check.status, check.name).toBe('passed');
      }
    }
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});
