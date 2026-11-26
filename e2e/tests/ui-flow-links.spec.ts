/**
 * Phase 2, C24 spec 10 (C19 in the browser, full stack). A customer backend generates a one-time
 * link with `@openverify/node`; the end user opens it in Chromium:
 * - the flow redeems it, clears it from the address bar and runs to the end, with the sandbox
 *   banner on screen and the three selfie poses uploaded through the sandbox fallback (an
 *   `upload` capture, C46.1). Uploaded photos are not a live capture, so the required
 *   `selfie_liveness_detection` answers `not_applicable`/`capture_not_live` and the inquiry goes
 *   to review (C43, ADR 0002 §3b);
 * - opening the same link again shows the used-link screen;
 * - a session the server API expires ends on the inactive-session screen, without a retry,
 *   whether the flow writes (consent) or reads (a reload of a session link);
 * - an inquiry the server API expires cancels its session (C10), and the flow's next call ends
 *   on the link-expired screen its `reason` names (C25.8, Workflow 2E).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FIXTURES, selfieStill } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent, uploadId } from './support/flow.js';
import {
  heading,
  inquiryWithOneTimeLink,
  storedInTab,
  uploadSelfie,
} from './support/flow-links.js';
import { recordSelfieMeasurements } from './support/measurements.js';
import { recordingClient } from './support/platform.js';

const SANDBOX = { name: 'Sandbox' } as const;

test('a one-time link opens the flow once, in the sandbox, and the user finishes it', async ({
  page,
  context,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { inquiryId, link } = await inquiryWithOneTimeLink(client, stack, 'ui-link');
  const errors = collectConsoleErrors(page);

  await page.goto(link);

  // Redeemed: the link leaves the address bar at once and the flow starts, in the sandbox.
  await expect(page).toHaveURL(`${stack.flowUrl}/`);
  await expect(page.getByRole('note', SANDBOX)).toContainText('This is a test verification.');
  await giveConsent(page);
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
  const poses = await uploadSelfie(page, (pose) => selfieStill('a', pose));
  expect(poses[0]).toBe('center');
  expect([...poses].sort()).toEqual(['center', 'left', 'right']);
  // Review counts as done for the user (C30.6): the normal completion screen.
  await expect(heading(page, 'Verification submitted')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('note', SANDBOX)).toBeVisible();
  expect(errors).toEqual([]);
  // The session lived in memory only: nothing secret is kept in the tab.
  const stored = await storedInTab(page);
  expect(stored).not.toMatch(/ov[so]_/);

  const { data: inquiry, included = [] } = await client.inquiries.retrieve(inquiryId, {
    include: 'verifications',
  });
  expect(inquiry.attributes.status).toBe('needs_review');
  const selfie = included.find((resource) => resource.type === 'verification/selfie');
  expect(selfie?.attributes.status).toBe('needs_review');
  const checks = Object.fromEntries(
    (selfie?.type === 'verification/selfie' ? selfie.attributes.checks : []).map((check) => [
      check.name,
      check,
    ]),
  );
  recordSelfieMeasurements('head-turn-a stills (upload)', Object.values(checks));
  expect(checks.selfie_liveness_detection).toMatchObject({
    status: 'not_applicable',
    reasons: ['capture_not_live'],
    requirement: 'required',
    metadata: { 'capture-method': 'upload' },
  });
  // Nothing else holds the selfie back: the stills are person A, turning as prompted.
  for (const name of [
    'selfie_image_quality_detection',
    'selfie_pose_detection',
    'selfie_multiple_faces_detection',
    'selfie_id_comparison',
  ]) {
    expect(checks[name], name).toMatchObject({ status: 'passed', requirement: 'required' });
  }
  const { data: sessions } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiryId },
  });
  expect(sessions).toHaveLength(1);

  // The same link, opened again (say, from the email once more): it was used.
  const again = await context.newPage();
  await again.goto(link);
  await expect(heading(again, 'We could not open your verification')).toBeVisible();
  await expect(again.getByRole('alert')).toContainText('This link has already been used');
  await expect(again.getByRole('button')).toHaveCount(0);
  await expect(again).toHaveURL(`${stack.flowUrl}/`);
  const { data: after } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiryId },
  });
  expect(after).toHaveLength(1);
});

test('a session expired through the server API ends the flow on its own screen', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { inquiryId, link } = await inquiryWithOneTimeLink(client, stack, 'ui-expire');
  await page.goto(link);
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();

  const { meta } = await client.inquirySessions.expireAll({ 'inquiry-id': inquiryId });
  expect(meta['expired-count']).toBe(1);
  await giveConsent(page);

  await expect(heading(page, 'Your verification session has expired')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('note', SANDBOX)).toBeVisible();
  const { data: sessions } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiryId },
  });
  expect(sessions.map((session) => session.attributes.status)).toEqual(['expired']);
});

test('a session link reloaded after its session expired shows the inactive-session screen', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-ui-reload-expired-${randomUUID()}`,
  });
  const { meta } = await client.inquiries.resume(inquiry.id);
  await page.goto(meta['flow-url']);
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();

  await client.inquirySessions.expireAll({ 'inquiry-id': inquiry.id });
  await page.reload();

  await expect(heading(page, 'Your verification session has expired')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('an inquiry expired through the server API while its link is open ends the flow on the link-expired screen (C25.8)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { inquiryId, link } = await inquiryWithOneTimeLink(client, stack, 'ui-inquiry-expired');
  await page.goto(link);
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();

  const { data: expired } = await client.inquiries.expire(inquiryId);
  expect(expired.attributes.status).toBe('expired');
  await giveConsent(page);

  await expect(heading(page, 'This verification link has expired')).toBeFocused();
  await expect(page.getByText('Ask the organization that sent it for a new link.')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  const { data: sessions } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiryId },
  });
  expect(sessions.map((session) => session.attributes.status)).toEqual(['canceled']);
});
