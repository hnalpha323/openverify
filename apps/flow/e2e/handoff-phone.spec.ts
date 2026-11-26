/**
 * C96.3, C96.5 (Workflow 7A; P01, P15): the phone's side of a handoff link in the built flow,
 * against the mocked flow API (`MockFlowApi.handoffAnswers`).
 *
 * - The link leaves the address bar at once; the context screen comes from the preview, and
 *   nothing is redeemed before Continue.
 * - Continue redeems once, and the flow runs on the new session from its own consent; the token
 *   travels only in the preview and redeem bodies, never in a URL, and nothing secret is stored.
 * - Decline declines and redeems nothing.
 */
import { expect, test } from '@playwright/test';
import { heading, storedInTab } from './support/flow-steps';
import { INQUIRY_ID, MockFlowApi, SESSION_TOKEN, defaultFlow } from './support/mock-flow-api';

/** Synthetic and obviously fake: `ovh_` plus 43 base64url characters. */
const HANDOFF_TOKEN = `ovh_${'E2eSyntheticHandoffToken'.padEnd(43, 'x')}`;
const HANDOFF_LINK = `/#inquiry-id=${INQUIRY_ID}&handoff-token=${HANDOFF_TOKEN}`;

function phoneApi(): MockFlowApi {
  const api = new MockFlowApi();
  const flow = defaultFlow();
  const [consent, ...rest] = flow.steps;
  flow.steps = [consent ?? {}, { id: 'device_handoff', type: 'device_handoff' }, ...rest];
  api.flow = flow;
  api.inquiryStatus = 'pending';
  api.handoff = { 'step-id': 'device_handoff', state: 'redeemed' };
  api.handoffAnswers.preview = {
    status: 200,
    body: {
      'organization-display-name': 'Example Verification Ltd',
      method: 'qr',
      'confirmation-code-required': false,
      context: {
        steps: ['government_id', 'selfie'],
        'started-at': '2026-10-20T12:00:00.000Z',
        'issuing-country-code': null,
        attribution: null,
      },
    },
  };
  api.handoffAnswers.redeem = {
    status: 200,
    body: { 'session-token': SESSION_TOKEN, 'expires-at': '2026-10-21T12:00:00.000Z' },
  };
  api.handoffAnswers.decline = { status: 200, body: null };
  return api;
}

test('previews the handoff, redeems it on Continue only, and asks for the phone’s own consent', async ({
  page,
}) => {
  const api = phoneApi();
  await api.install(page);

  await page.goto(HANDOFF_LINK);

  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  await expect(heading(page, 'Continue your verification')).toBeVisible();
  await expect(
    page.getByText('Example Verification Ltd asked to verify your identity.'),
  ).toBeVisible();
  await expect(page.getByText('a photo of your ID document')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible();
  expect(api.handoffCalls.map((call) => call.route)).toEqual(['preview']);

  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();
  expect(api.handoffCalls.map((call) => call.route)).toEqual(['preview', 'redeem']);
  expect(api.handoffCalls[1]?.body).toEqual({
    'inquiry-id': INQUIRY_ID,
    'handoff-token': HANDOFF_TOKEN,
  });
  for (const request of api.requests) {
    expect(request.url).not.toContain(HANDOFF_TOKEN);
  }
  const stored = await storedInTab(page);
  expect(stored).not.toContain(HANDOFF_TOKEN);
  expect(stored).not.toContain(SESSION_TOKEN);
});

test('declines on the context screen and redeems nothing', async ({ page }) => {
  const api = phoneApi();
  await api.install(page);
  await page.goto(HANDOFF_LINK);

  await page.getByRole('button', { name: 'Decline' }).click();

  await expect(heading(page, 'You declined')).toBeVisible();
  expect(api.handoffCalls.map((call) => call.route)).toEqual(['preview', 'decline']);
});

test('shows a refused link as not valid, expired or used', async ({ page }) => {
  const api = phoneApi();
  api.handoffAnswers.preview = {
    status: 410,
    body: {
      type: 'about:blank',
      title: 'Gone',
      status: 410,
      detail: 'The handoff link is not valid or has expired.',
      instance: '/api/v1/flow/handoffs/preview',
      requestId: 'e2e',
      code: 'handoff_token_invalid',
    },
  };
  await api.install(page);
  await page.goto(HANDOFF_LINK);

  await expect(page.getByRole('alert')).toContainText('This link is not valid, has expired');
  expect(api.handoffCalls.map((call) => call.route)).toEqual(['preview']);
});
