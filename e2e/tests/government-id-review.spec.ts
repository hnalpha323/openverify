/**
 * C30, C35 and C36: a template that requires an A-tier check whose provider the e2e stack leaves
 * unbound (`id_public_figure_detection`, see `e2e/src/env.ts`). The check has no evidence, so it
 * answers `not_applicable`/`provider_not_configured`, which blocks a required check (ADR 0002
 * §3b, §3e): the government ID goes to `needs_review` instead of passing. The user's part is done
 * all the same (C30.6): the flow moves on to the selfie, which is still compared with the ID
 * portrait (C30.4), and ends on the normal completion screen. The inquiry is completed, then
 * marked for review in the same transaction (C30.5); it is never approved automatically.
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

test('a required A-tier check without a provider sends the inquiry to review, and the selfie is still compared (C30, C35)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['*']);
  try {
    const attributes = await defaultTemplateAttributes(`E2E A-tier required ${randomUUID()}`);
    const config = attributes['verification-config'];
    const governmentId = config['government-id'];
    if (governmentId === undefined) {
      throw new Error('The default template has no government ID verification config');
    }
    const template = await api.createInquiryTemplate({
      ...attributes,
      'verification-config': {
        ...config,
        'government-id': {
          ...governmentId,
          checks: {
            ...governmentId.checks,
            id_public_figure_detection: { enabled: true, required: true },
          },
        },
      },
    });
    const inquiry = await api.createInquiry(template.id, `e2e-review-${randomUUID()}`);
    const { flowUrl } = await api.resumeInquiry(inquiry.id);

    const errors = collectConsoleErrors(page);
    await page.goto(flowUrl);
    await giveConsent(page);
    await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
    // The government ID needs review, which counts as done: the flow goes on to the selfie,
    // which the guidance takes from person A's head-turn clip (C45.2).
    const shots = await takeSelfie(page);
    expect(shots.map((shot) => shot.shutter)).toEqual(['auto', 'auto', 'auto']);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible({ timeout: 90_000 });
    expect(errors).toEqual([]);

    // Completed, then marked for review: both events reach the customer (C30.5).
    await waitForEvent(receiver, 'inquiry.completed', inquiry.id);
    await waitForEvent(receiver, 'inquiry.marked-for-review', inquiry.id);
    expect(eventNamesFor(receiver, inquiry.id)).not.toContain('inquiry.approved');

    const document = await api.getInquiry(inquiry.id);
    expect(document.data.attributes.status).toBe('needs_review');
    const verifications = document.included ?? [];
    expect(
      verifications.map((verification) => [verification.type, verification.attributes.status]),
    ).toEqual([
      ['verification/government-id', 'needs_review'],
      ['verification/selfie', 'passed'],
    ]);
    const checksOf = (type: string) =>
      Object.fromEntries(
        (
          verifications.find((verification) => verification.type === type)?.attributes.checks ?? []
        ).map((check) => [check.name, check]),
      );
    const idChecks = checksOf('verification/government-id');
    expect(idChecks.id_public_figure_detection).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
      requirement: 'required',
      stage: 'beta',
      confidence: null,
    });
    // Nothing else holds the ID back: every other required check passed or does not block.
    for (const check of Object.values(idChecks)) {
      if (check.requirement !== 'required' || check.name === 'id_public_figure_detection') {
        continue;
      }
      const nonBlocking =
        check.status === 'not_applicable' &&
        check.reasons.every((reason) => ['feature_absent', 'not_requested'].includes(reason));
      expect(check.status === 'passed' || nonBlocking, `${check.name} ${check.status}`).toBe(true);
    }
    // The selfie was compared with the portrait of the ID under review (C30.4).
    expect(checksOf('verification/selfie').selfie_id_comparison).toMatchObject({
      status: 'passed',
      reasons: [],
      requirement: 'required',
    });
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});
