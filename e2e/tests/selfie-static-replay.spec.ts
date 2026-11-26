/**
 * C45.3: the static-replay clip gets a pose retry hint. The fake camera plays person A's centre
 * still, drifting but never turning (C45.2). The guidance never sees a turn held, so the flow
 * offers its shutter after 10 s (C40.11) and the user presses it for the side poses. The server
 * re-measures every photo: `selfie_pose_detection` (user behaviour) fails for the sides that
 * did not turn, and the C43 cascade keeps that failure retryable. Liveness and pose repeat
 * judge only the sides whose pose passed, so neither fails; the face still matches the ID. The
 * flow shows the next attempt with the hint saying which turn was missing.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { fakeCameraArgs, giveConsent, takeSelfie, uploadId } from './support/flow.js';
import { recordSelfieMeasurements } from './support/measurements.js';
import { createServerApi } from './support/server-api.js';

test.use({ launchOptions: { args: fakeCameraArgs(FIXTURES.staticReplay) } });

/** The C39.2 retry hints of the two side poses (`retry.reasons.pose_not_left/right`). */
const SIDE_HINTS = {
  pose_not_left: 'Your head was not turned far enough to the left.',
  pose_not_right: 'Your head was not turned far enough to the right.',
} as const;

test('a static replay that never turns gets the pose retry hint, and nothing else fails (C43, C45.3)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const inquiry = await api.createInquiry(
    stack.defaultTemplateId,
    `e2e-static-replay-${randomUUID()}`,
  );
  const { flowUrl } = await api.resumeInquiry(inquiry.id);

  await page.goto(flowUrl);
  await giveConsent(page);
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
  const shots = await takeSelfie(page, { shutter: 'manual-when-offered' });
  // The guidance never saw a side pose held: the user took them with the offered shutter.
  expect(shots.filter((shot) => shot.pose !== 'center').map((shot) => shot.shutter)).toEqual([
    'manual',
    'manual',
  ]);

  // The next attempt, with the hint.
  await expect(page.getByRole('heading', { level: 1, name: 'Take a selfie' })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText('Attempt 2 of 3')).toBeVisible();
  const hints = page.getByRole('alert').filter({ hasText: 'We could not use your last photos' });
  await expect(hints).toBeVisible();

  const document = await api.getInquiry(inquiry.id);
  expect(document.data.attributes.status).toBe('pending');
  const selfie = (document.included ?? []).find(
    (verification) => verification.type === 'verification/selfie',
  );
  expect(selfie?.attributes.status).toBe('failed');
  const checks = Object.fromEntries(
    (selfie?.attributes.checks ?? []).map((check) => [check.name, check]),
  );
  recordSelfieMeasurements('static-replay-a', selfie?.attributes.checks ?? []);
  const pose = checks.selfie_pose_detection;
  expect(pose).toMatchObject({ status: 'failed', requirement: 'required' });
  const sideReasons = (pose?.reasons ?? []).filter(
    (reason): reason is keyof typeof SIDE_HINTS => reason in SIDE_HINTS,
  );
  expect(sideReasons.length, `pose reasons ${String(pose?.reasons)}`).toBeGreaterThan(0);
  for (const reason of sideReasons) {
    await expect(hints).toContainText(SIDE_HINTS[reason]);
  }
  // Every failed check is a user-behaviour one with a hint (C43): nothing fraud-typed failed.
  for (const name of [
    'selfie_liveness_detection',
    'selfie_pose_repeat_detection',
    'selfie_multiple_faces_detection',
  ]) {
    expect(checks[name]?.status, name).not.toBe('failed');
  }
  expect(checks.selfie_liveness_detection).toMatchObject({
    status: 'not_applicable',
    reasons: ['input_missing'],
  });
  expect(checks.selfie_id_comparison).toMatchObject({ status: 'passed' });
});
