/**
 * C36, Phase 3: C36 variants of the synthetic Utopia card through the real stack (the hosted
 * flow or the flow API, the worker, the vision service with the real models, and the default
 * template), each failing the check it is built to trip:
 *
 * - an expired card fails `id_expired_detection`, a fraud check, so the flow offers no retry;
 * - a blurred card fails `id_blur_detection`, a user-behaviour check, so the flow shows the
 *   retry hint, and a sharp photo then passes;
 * - a specimen card fails `id_compromised_detection` on the marker its visual zone prints.
 *
 * The e2e stack runs in the sandbox environment, where the test issuer Utopia is accepted (C30.7).
 */
import { randomUUID } from 'node:crypto';
import type { InquiryDocument, VerificationCheck } from '@openverify/contracts';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, variantImage } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent, uploadId } from './support/flow.js';
import {
  flowApi,
  giveFlowConsent,
  recordingClient,
  settledFlowVerification,
  submitGovernmentId,
} from './support/platform.js';
import { createServerApi } from './support/server-api.js';

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

/** The title of the flow's retry hint (`retry.title`). */
const RETRY_HINT_TITLE = 'We could not use your last photos';

/** The checks of the inquiry's one government ID verification, by name. */
function governmentIdChecks(document: InquiryDocument): Record<string, VerificationCheck> {
  const verifications = (document.included ?? []).filter(
    (verification) => verification.type === 'verification/government-id',
  );
  expect(verifications).toHaveLength(1);
  return Object.fromEntries(
    (verifications[0]?.attributes.checks ?? []).map((check) => [check.name, check]),
  );
}

/** The required checks that failed, or that did not pass for a reason that blocks (C30.1). */
function blockingRequired(checks: Record<string, VerificationCheck>): string[] {
  return Object.values(checks)
    .filter((check) => check.requirement === 'required')
    .filter(
      (check) =>
        check.status !== 'passed' &&
        !(
          check.status === 'not_applicable' &&
          check.reasons.every((reason) => ['feature_absent', 'not_requested'].includes(reason))
        ),
    )
    .map((check) => check.name);
}

test('an expired card fails id_expired_detection, and the flow offers no retry (C36)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const inquiry = await api.createInquiry(stack.defaultTemplateId, `e2e-expired-${randomUUID()}`);
  const { flowUrl } = await api.resumeInquiry(inquiry.id);

  const errors = collectConsoleErrors(page);
  await page.goto(flowUrl);
  await giveConsent(page);
  await uploadId(page, variantImage('expired', 'front'), variantImage('expired', 'back'));
  await expect(heading(page, 'Verification not completed')).toBeVisible({ timeout: 90_000 });
  // A fraud check never becomes a retry hint: no hint, and nothing to photograph again.
  await expect(page.getByText(RETRY_HINT_TITLE)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload a photo' })).toHaveCount(0);
  expect(errors).toEqual([]);

  const document = await api.getInquiry(inquiry.id);
  expect(document.data.attributes.status).toBe('failed');
  // The selfie step never started.
  expect(
    (document.included ?? []).map((verification) => [
      verification.type,
      verification.attributes.status,
    ]),
  ).toEqual([['verification/government-id', 'failed']]);
  const checks = governmentIdChecks(document);
  expect(checks.id_expired_detection).toMatchObject({
    status: 'failed',
    reasons: ['expired'],
    requirement: 'required',
    stage: 'ga',
    provenance: { 'implementation-version': 1, thresholds: { 'grace-days': 0 } },
  });
  // The expiry is the only reason: every other required check passed, or does not block.
  expect(blockingRequired(checks)).toEqual(['id_expired_detection']);
});

test('a blurred card gets the blur retry hint, and a sharp photo then passes (C36)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const inquiry = await api.createInquiry(stack.defaultTemplateId, `e2e-blurred-${randomUUID()}`);
  const { flowUrl } = await api.resumeInquiry(inquiry.id);

  const errors = collectConsoleErrors(page);
  await page.goto(flowUrl);
  await giveConsent(page);
  await uploadId(page, variantImage('blurred', 'front'), variantImage('blurred', 'back'));
  // The capture step comes back for the next attempt, with the hint as an alert above it.
  const hint = page.getByRole('alert').filter({ hasText: RETRY_HINT_TITLE });
  await expect(hint).toBeVisible({ timeout: 90_000 });
  await expect(hint.getByRole('listitem')).toHaveText([
    'The photo was blurry. Hold your device steady and wait for the image to come into focus.',
  ]);
  await expect(heading(page, 'Photograph your ID')).toBeVisible();
  await expect(page.getByText('Attempt 2 of 3')).toBeVisible();

  // The customer's backend sees the failed attempt and the check behind the hint.
  const first = await api.getInquiry(inquiry.id);
  expect(first.data.attributes.status).toBe('pending');
  const checks = governmentIdChecks(first);
  expect(checks.id_blur_detection).toMatchObject({
    status: 'failed',
    reasons: ['image_blurry'],
    requirement: 'required',
    stage: 'ga',
  });
  expect(blockingRequired(checks)).toEqual(['id_blur_detection']);

  // The user photographs the card again: the sharp card passes, and the flow moves on to the
  // selfie.
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
  await expect(heading(page, 'Take a selfie')).toBeVisible({ timeout: 90_000 });
  expect(errors).toEqual([]);
  const retried = await api.getInquiry(inquiry.id);
  expect(
    (retried.included ?? []).map((verification) => [
      verification.type,
      verification.attributes.status,
    ]),
  ).toEqual([
    ['verification/government-id', 'failed'],
    ['verification/government-id', 'passed'],
  ]);
});

test('a specimen card fails id_compromised_detection on the marker it prints (C33, C36)', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-specimen-${randomUUID()}`,
  });
  const flow = flowApi(
    stack.apiUrl,
    (await client.inquiries.resume(inquiry.id)).meta['session-token'],
  );
  await giveFlowConsent(flow);
  const verificationId = await submitGovernmentId(flow, {
    front: variantImage('specimen-stamped', 'front'),
    back: variantImage('specimen-stamped', 'back'),
  });

  // The flow sees a failure without a hint: a fraud check is never shown to the user.
  const settled = await settledFlowVerification(flow, verificationId);
  expect(settled.attributes).toMatchObject({ status: 'failed', 'retry-hints': [] });

  const { data: verification } = await client.verifications.retrieve(verificationId);
  const checks = Object.fromEntries(
    verification.attributes.checks.map((check) => [check.name, check]),
  );
  expect(checks.id_compromised_detection).toMatchObject({
    status: 'failed',
    reasons: ['specimen_marker_found'],
    requirement: 'required',
    stage: 'ga',
  });
  // Metadata names the marker words, never a value read from the card (C29.3).
  expect(checks.id_compromised_detection?.metadata.markers).toEqual(
    expect.arrayContaining(['SPECIMEN']),
  );
  expect(JSON.stringify(checks.id_compromised_detection?.metadata)).not.toMatch(/CALDERWOOD/);
});
