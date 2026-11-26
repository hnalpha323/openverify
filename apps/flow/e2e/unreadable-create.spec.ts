/**
 * A create the server made but answered with a body the contract does not describe (the 2E
 * follow-up), in the browser against the mocked API: the flow takes the verification as created
 * but unreadable, reads the session, and carries on with that verification. The flow API has no
 * idempotency key, so a second create would use up another attempt.
 */
import { expect, test } from '@playwright/test';
import { heading, uploadId } from './support/flow-steps';
import { MockFlowApi, flowLink } from './support/mock-flow-api';

test('a create answered with an unexpected body is never made twice', async ({ page }) => {
  const api = new MockFlowApi();
  api.consent = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };
  api.garble.push('POST /verifications');
  await api.install(page);
  await page.goto(flowLink());

  await uploadId(page);

  await expect(heading(page, 'Take a selfie')).toBeVisible();
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/government-id', 'passed'],
  ]);
  expect(
    api.requests.filter(({ method, path }) => method === 'POST' && path.endsWith('/verifications')),
  ).toHaveLength(1);
});
