/**
 * C42, C45.3: the same face on two accounts. Two inquiries with different reference ids (so
 * different accounts) are completed in the hosted flow by the same person (person A's still of
 * each prompted pose, held until the next prompt, so a loaded machine cannot photograph another
 * pose: Workflow 5C review K8), and both users tick the optional matching consent (C42.3), which
 * starts unticked. The first passed selfie with matching consent stores a sealed face template (C42.2);
 * the second selfie's 1:N scan finds it, so its `selfie_repeat_detection` fails with
 * `face_seen_on_other_account`. The check is advisory in the default template (C45.1), so the
 * second inquiry still completes. The recorded consent shows the optional key (C42.3, C47).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { giveConsent, takeSelfie, uploadId } from './support/flow.js';
import { recordingClient } from './support/platform.js';
import { usePromptedCamera } from './support/prompted-camera.js';
import { createServerApi } from './support/server-api.js';

/** The optional matching consent's text key (C42.3). */
const MATCHING_CONSENT_KEY = 'consent.biometric-matching';

/** One user completes an inquiry of the default template, ticking the matching consent. */
async function completeWithMatchingConsent(page: Page, stack: StackInfo, label: string) {
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const inquiry = await api.createInquiry(stack.defaultTemplateId, `e2e-${label}-${randomUUID()}`);
  const { flowUrl } = await api.resumeInquiry(inquiry.id);
  await page.goto(flowUrl);
  await giveConsent(page, { matching: true });
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
  const shots = await takeSelfie(page);
  expect(shots.map((shot) => shot.shutter)).toEqual(['auto', 'auto', 'auto']);
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 90_000 },
  );

  const document = await api.getInquiry(inquiry.id);
  expect(document.data.attributes.status).toBe('completed');
  const selfie = (document.included ?? []).find(
    (verification) => verification.type === 'verification/selfie',
  );
  expect(selfie?.attributes.status).toBe('passed');
  const checks = Object.fromEntries(
    (selfie?.attributes.checks ?? []).map((check) => [check.name, check]),
  );
  return {
    inquiryId: inquiry.id,
    accountId: document.data.relationships.account?.data?.id,
    checks,
  };
}

test('the same face on another account fails the advisory repeat check, with matching consent recorded (C42, C45.3)', async ({
  context,
}) => {
  await usePromptedCamera(context, 'a');
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);

  const first = await completeWithMatchingConsent(await context.newPage(), stack, 'repeat-first');
  // Matching consent: the history checks ran (C42.3), and the gallery held no other account.
  expect(first.checks.selfie_repeat_detection).toMatchObject({
    status: 'passed',
    requirement: 'not_required',
  });
  expect(first.checks.selfie_liveness_detection?.status).toBe('passed');
  expect(first.checks.selfie_id_comparison?.status).toBe('passed');

  const second = await completeWithMatchingConsent(await context.newPage(), stack, 'repeat-second');
  expect(second.accountId).not.toBe(first.accountId);
  const repeat = second.checks.selfie_repeat_detection;
  expect(repeat).toMatchObject({
    status: 'failed',
    reasons: ['face_seen_on_other_account'],
    requirement: 'not_required',
    stage: 'beta',
  });
  // The scan reports counts and scores only: never another inquiry's id (C39.4).
  expect(JSON.stringify(repeat)).not.toContain(first.inquiryId);
  expect(repeat?.metadata).toMatchObject({ truncated: false });

  // The recorded consent of each session shows the optional key beside the required ones.
  for (const { inquiryId } of [first, second]) {
    const { data: sessions } = await client.inquirySessions.list({
      filter: { 'inquiry-id': inquiryId },
    });
    expect(sessions.map((session) => session.attributes.consent)).toEqual([
      expect.objectContaining({
        'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
        'optional-text-keys': [MATCHING_CONSENT_KEY],
      }),
    ]);
  }
});
