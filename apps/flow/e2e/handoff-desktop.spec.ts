/**
 * C96.1, C96.3, C96.5 (Workflow 7A): the desktop's `device_handoff` step in the built flow, under
 * the production CSP, against the mocked flow API (`MockFlowApi.handoffAnswers`).
 *
 * - The QR is drawn locally (an inline SVG image) with its link as the text alternative; no CSP
 *   violation, and no request to any origin but the flow's own and the API's.
 * - Once the phone redeemed, the desktop waits with "this was not me", which shows the step again.
 * - "Continue on this device" moves on to the next step.
 */
import { expect, test, type Page } from '@playwright/test';
import { giveConsent, heading } from './support/flow-steps';
import {
  API_ORIGIN,
  INQUIRY_ID,
  MockFlowApi,
  defaultFlow,
  flowLink,
} from './support/mock-flow-api';

/** Synthetic and obviously fake: `ovh_` plus 43 base64url characters. */
const HANDOFF_TOKEN = `ovh_${'E2eSyntheticHandoffToken'.padEnd(43, 'x')}`;
const FRAGMENT = `#inquiry-id=${INQUIRY_ID}&handoff-token=${HANDOFF_TOKEN}`;

function handoffApi(): MockFlowApi {
  const api = new MockFlowApi();
  const flow = defaultFlow();
  const [consent, ...rest] = flow.steps;
  flow.steps = [consent ?? {}, { id: 'device_handoff', type: 'device_handoff' }, ...rest];
  api.flow = flow;
  api.handoff = { 'step-id': 'device_handoff', state: 'pending' };
  api.handoffAnswers.issue = {
    status: 201,
    body: {
      id: 'hnd_01M5CK16P0D13FXHZSS4TCFBVH',
      method: 'qr',
      'expires-at': new Date(Date.now() + 300_000).toISOString(),
      'url-fragment': FRAGMENT,
    },
  };
  api.handoffAnswers.current = {
    status: 200,
    body: { status: 'issued', 'redeemed-at': null, 'os-name': null, 'browser-name': null },
  };
  return api;
}

/** Every `securitypolicyviolation` and every request to another origin. */
async function watch(
  page: Page,
): Promise<() => Promise<{ violations: string[]; foreign: string[] }>> {
  const foreign: string[] = [];
  const flowOrigin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1').origin;
  page.on('request', (request) => {
    const { origin } = new URL(request.url());
    if (origin !== flowOrigin && origin !== API_ORIGIN && !request.url().startsWith('data:')) {
      foreign.push(origin);
    }
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return async () => ({
    violations: await page.evaluate(
      () => (window as unknown as { cspViolations: string[] }).cspViolations,
    ),
    foreign,
  });
}

test('shows a locally drawn QR with its link, waits once the phone redeemed, and "this was not me" shows the step again', async ({
  page,
}) => {
  const api = handoffApi();
  await api.install(page);
  const report = await watch(page);
  await page.goto(flowLink());
  await giveConsent(page);

  await expect(heading(page, 'Continue on your phone')).toBeVisible();
  const qr = page.getByRole('img', { name: 'QR code that opens this verification on your phone' });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((element) => element.tagName.toLowerCase())).toBe('svg');
  await expect(page.getByRole('textbox', { name: 'Or open this link on your phone' })).toHaveValue(
    new RegExp(`${FRAGMENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  );
  await expect(page.getByText(/This code expires in [45]:\d\d\./)).toBeVisible();

  api.handoffAnswers.current = {
    status: 200,
    body: {
      status: 'redeemed',
      'redeemed-at': new Date().toISOString(),
      'os-name': 'iOS',
      'browser-name': 'Safari',
    },
  };
  await expect(heading(page, 'Continuing on your phone')).toBeVisible();
  await expect(page.getByText('Your phone: iOS, Safari')).toBeVisible();

  api.handoffAnswers.reject = {
    status: 200,
    body: { status: 'rejected', 'redeemed-at': null, 'os-name': null, 'browser-name': null },
  };
  await page.getByRole('button', { name: 'This was not me' }).click();

  await expect(page.getByText(/We ended the session on the other device/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get a new code' })).toBeVisible();
  expect(api.handoffCalls.map((call) => call.route)).toEqual(
    expect.arrayContaining(['issue', 'current', 'reject']),
  );
  expect(api.handoffCalls.find((call) => call.route === 'issue')?.body).toEqual({ method: 'qr' });
  expect(await report()).toEqual({ violations: [], foreign: [] });
});

test('continues on this device, then moves on to the next step', async ({ page }) => {
  const api = handoffApi();
  await api.install(page);
  await page.goto(flowLink());
  await giveConsent(page);
  await expect(heading(page, 'Continue on your phone')).toBeVisible();

  api.handoffAnswers['continue-here'] = {
    status: 200,
    body: { status: 'continued_here', 'redeemed-at': null, 'os-name': null, 'browser-name': null },
  };
  api.handoff = { 'step-id': 'device_handoff', state: 'continued_here' };
  await page.getByRole('button', { name: 'Continue on this device' }).click();

  await expect(heading(page, 'Photograph your ID')).toBeVisible();
  expect(api.handoffCalls.map((call) => call.route)).toContain('continue-here');
});
