/**
 * Phase 1 walking skeleton, positive case, on the C45.1 default template. A customer backend
 * creates a webhook and an inquiry, the end user completes the hosted flow (consent, the
 * synthetic Utopia card, then the C40 selfie capture: a fake camera plays person A's head-turn
 * clip, and the in-browser guidance takes the centre, left and right photos by itself), the
 * worker runs the real vision models (faces, OCR, MRZ, forensics, head pose, passive liveness)
 * and every check the template enables, a signed `inquiry.completed` webhook arrives, the
 * customer reads the extraction and the selfie capture, and an operator sees the result in the
 * dashboard.
 */
import { randomUUID } from 'node:crypto';
import {
  PHASE1_CHECKS,
  defaultInquiryTemplateAttributes,
  selfieVerificationResourceSchema,
} from '@openverify/contracts';
import { extractionOf, isGovernmentIdVerification } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { checkRow, inquiryRow, signIn } from './support/dashboard.js';
import {
  collectConsoleErrors,
  fakeCameraArgs,
  giveConsent,
  takeSelfie,
  uploadId,
} from './support/flow.js';
import { recordSelfieMeasurements } from './support/measurements.js';
import { recordingClient } from './support/platform.js';
import { createServerApi } from './support/server-api.js';
import { eventNamesFor, verifyDelivery, waitForEvent } from './support/webhooks.js';

test.use({ launchOptions: { args: fakeCameraArgs(FIXTURES.headTurnMatching) } });

/** The H-tier group of the C36 default template: enabled, advisory, beta. */
const HEURISTIC_CHECKS = [
  'id_color_inconsistency_detection',
  'id_electronic_replica_detection',
  'id_tamper_detection',
  'id_fabrication_detection',
  'id_handwriting_detection',
  'id_entity_detection',
];

/** The fictional holder of the happy-path card (C36; plan, Workflow 3A Stage 2 amendment 21). */
const SYNTHETIC_HOLDER = {
  'name-first': 'NORA',
  'name-middle': null,
  'name-last': 'CALDERWOOD',
  birthdate: '1988-03-21',
  sex: 'F',
  nationality: 'UTO',
  'identification-number': 'UT4829163',
  'personal-number': null,
  'issue-date': '2024-05-06',
  'expiration-date': '2034-05-05',
  'issuing-authority-code': 'UTO',
  'address-street-1': '27 HARBOUR ROAD, UTOPIA CITY',
  'address-street-2': null,
  'address-city': null,
  'address-subdivision': null,
  'address-postal-code': null,
  'address-country-code': null,
  endorsements: null,
  restrictions: null,
  'vehicle-class': null,
} as const;

test('an inquiry on the default template completes with every required check passed', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['*']);
  try {
    const referenceId = `e2e-completes-${randomUUID()}`;
    const inquiry = await api.createInquiry(stack.defaultTemplateId, referenceId);
    expect(inquiry.attributes.status).toBe('created');
    const { flowUrl, sessionToken } = await api.resumeInquiry(inquiry.id);
    expect(flowUrl.startsWith(`${stack.flowUrl}/#`)).toBe(true);

    // The end user.
    const errors = collectConsoleErrors(page);
    await page.goto(flowUrl);
    await expect(page).toHaveURL(`${stack.flowUrl}/`);
    expect(page.url()).not.toContain(sessionToken);
    await giveConsent(page);
    await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
    // C40.11, C46.1: the guidance takes every photo of the head-turn clip itself, the centre
    // first, then both sides in the server's order; the shutter is never pressed.
    const shots = await takeSelfie(page);
    expect(shots.map((shot) => shot.shutter)).toEqual(['auto', 'auto', 'auto']);
    expect(shots[0]?.pose).toBe('center');
    expect(shots.map((shot) => shot.pose).sort()).toEqual(['center', 'left', 'right']);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible({ timeout: 90_000 });
    expect(errors).toEqual([]);

    // The customer's webhook endpoint.
    const completed = await waitForEvent(receiver, 'inquiry.completed', inquiry.id);
    expect(verifyDelivery(completed, webhook.attributes.secret)).toBeGreaterThan(0);
    expect(completed.request.headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'OpenVerify-Webhooks/1',
      'openverify-event-id': completed.event.id,
    });
    expect(completed.event.attributes.payload.data).toMatchObject({
      id: inquiry.id,
      attributes: { status: 'completed', 'reference-id': referenceId },
    });
    expect(eventNamesFor(receiver, inquiry.id)).toEqual(
      expect.arrayContaining(['inquiry.started', 'inquiry.completed']),
    );

    // The customer's backend reads the result.
    const document = await api.getInquiry(inquiry.id);
    expect(document.data.attributes.status).toBe('completed');
    const verifications = document.included ?? [];
    expect(
      verifications.map((verification) => [verification.type, verification.attributes.status]),
    ).toEqual([
      ['verification/government-id', 'passed'],
      ['verification/selfie', 'passed'],
    ]);
    const checks = verifications.flatMap((verification) => verification.attributes.checks);
    // C36: every check the default template enables ran; each required one passed, or is not
    // applicable for a reason that never blocks (C30.1). Advisory checks never decide.
    const config = defaultInquiryTemplateAttributes()['verification-config'];
    const enabled = [config['government-id'], config.selfie].flatMap((typeConfig) =>
      Object.entries(typeConfig?.checks ?? {})
        .filter(([, { enabled: isEnabled }]) => isEnabled)
        .map(([id]) => id),
    );
    expect(checks.map((check) => check.name).sort()).toEqual(enabled.sort());
    for (const check of checks.filter((candidate) => candidate.requirement === 'required')) {
      const nonBlocking =
        check.status === 'not_applicable' &&
        check.reasons.every((reason) => ['feature_absent', 'not_requested'].includes(reason));
      expect(check.status === 'passed' || nonBlocking, `${check.name} ${check.status}`).toBe(true);
    }
    for (const name of [...PHASE1_CHECKS.government_id, ...PHASE1_CHECKS.selfie]) {
      expect(
        checks.find((check) => check.name === name),
        name,
      ).toMatchObject({ status: 'passed', reasons: [], requirement: 'required' });
    }
    const comparison = checks.find((check) => check.name === 'selfie_id_comparison');
    expect(comparison?.metadata).toMatchObject({ confidence_stage: 'beta' });
    // C39.4: no embedding, landmark set or background layout reaches the API.
    expect(JSON.stringify(document)).not.toMatch(
      /"(?:embedding|landmarks|layout|template)"\s*:\s*\[/i,
    );
    recordSelfieMeasurements('head-turn-a (completes)', checks);
    // C43: every selfie check the template requires passed, liveness with all of its evidence.
    // The sandbox test-capture rule waives the file-path camera label and webdriver that
    // Chromium's fake camera and Playwright show, and records them (C43, decision 7).
    const liveness = checks.find((check) => check.name === 'selfie_liveness_detection');
    expect(liveness).toMatchObject({ status: 'passed', requirement: 'required', stage: 'beta' });
    expect(liveness?.metadata).toMatchObject({
      components: { passive: 'passed', active: 'passed', integrity: 'not_executed' },
      'test-capture-device': true,
      'capture-method': 'camera',
      'judged-poses': expect.arrayContaining(['left', 'right']),
    });
    expect(liveness?.metadata['integrity-flags']).toEqual(
      expect.arrayContaining(['file-path-label', 'webdriver']),
    );
    expect(liveness?.confidence).toBeGreaterThan(0);
    expect(liveness?.confidence).toBeLessThanOrEqual(0.6);
    expect(checks.find((check) => check.name === 'selfie_pose_detection')).toMatchObject({
      status: 'passed',
      requirement: 'required',
    });
    // C40.10: the selfie verification states its capture and scores, never a face or a device.
    const selfie = selfieVerificationResourceSchema.parse(
      verifications.find((verification) => verification.type === 'verification/selfie'),
    );
    expect(selfie.attributes).toMatchObject({
      'capture-method': 'camera',
      liveness: 'active',
      poses: shots.map((shot) => shot.pose),
    });
    for (const score of [
      'document-similarity-score',
      'selfie-similarity-score-left',
      'selfie-similarity-score-right',
      'liveness-score',
    ] as const) {
      expect(selfie.attributes[score], score).toEqual(expect.any(Number));
    }
    expect(selfie.attributes['center-photo-face-coordinates']).toHaveLength(4);
    // C40.1, C40.8: the capture is a resource with its prompt timings, announced by its events.
    const { client } = recordingClient(stack.apiUrl, stack.apiKey);
    const captureIds = (selfie.relationships.selfies?.data ?? []).map((capture) => capture.id);
    expect(captureIds).toHaveLength(1);
    const { data: capture } = await client.selfies.retrieve(captureIds[0] ?? '');
    expect(capture.attributes).toMatchObject({
      status: 'processed',
      'capture-method': 'camera',
      liveness: 'active',
      prompts: shots.map((shot) => shot.pose),
      'error-code': null,
    });
    expect(capture.attributes['prompt-timings'].map((timing) => timing.pose).sort()).toEqual([
      'center',
      'left',
      'right',
    ]);
    await waitForEvent(receiver, 'selfie.processed', capture.id);
    expect(eventNamesFor(receiver, capture.id)).toEqual(
      expect.arrayContaining(['selfie.created', 'selfie.submitted', 'selfie.processed']),
    );
    // ADR 0002 §3c: the advisory heuristic checks are labelled beta, carry a confidence and the
    // threshold they were judged against, and never decide (C36).
    for (const name of HEURISTIC_CHECKS) {
      const check = checks.find((candidate) => candidate.name === name);
      expect(check, name).toMatchObject({ requirement: 'not_required', stage: 'beta' });
      expect(check?.confidence, name).toEqual(expect.any(Number));
      expect(Object.keys(check?.provenance?.thresholds ?? {}), name).toHaveLength(1);
    }
    // C31.5: the extraction is the synthetic holder's, read from the MRZ and the visual zone;
    // the country stays null for the test issuer (C30.7). The seeded key sees PII (C31.6).
    const governmentId = verifications.find(isGovernmentIdVerification);
    if (governmentId === undefined) {
      throw new Error('The inquiry has no government ID verification');
    }
    expect(governmentId.attributes).toMatchObject({ country: null, 'id-class': 'national_id' });
    const extraction = extractionOf(governmentId);
    expect(extraction.fields).toEqual(SYNTHETIC_HOLDER);
    for (const field of ['name-last', 'birthdate', 'identification-number', 'expiration-date']) {
      expect(extraction.sources[field as keyof typeof SYNTHETIC_HOLDER], field).toEqual([
        'mrz',
        'viz',
      ]);
    }

    // The operator, in a fresh browser context.
    const operator = await browser.newContext();
    try {
      const dashboard = await operator.newPage();
      await signIn(dashboard, stack.dashboardUrl, stack.admin);
      await expect(inquiryRow(dashboard, inquiry.id)).toContainText('Completed');
      await inquiryRow(dashboard, inquiry.id).getByRole('link', { name: inquiry.id }).click();
      await expect(dashboard.getByRole('heading', { level: 1 })).toContainText(inquiry.id);
      await expect(dashboard.getByRole('main')).toContainText(referenceId);
      await expect(dashboard.getByRole('main')).toContainText('Completed');
      // C37: each card keeps what needs the operator in view and folds the rest; open them.
      for (const card of ['Government ID', 'Selfie']) {
        await dashboard
          .getByRole('region', { name: card, exact: true })
          .locator('summary')
          .filter({ hasText: /^(Other|All) checks: / })
          .click();
      }
      for (const name of [
        'id_blur_detection',
        'id_glare_detection',
        'id_portrait_detection',
        'id_double_side_detection',
      ]) {
        await expect(checkRow(dashboard, 'Government ID', name)).toContainText('Passed');
      }
      for (const name of [
        'selfie_image_quality_detection',
        'selfie_pose_detection',
        'selfie_multiple_faces_detection',
        'selfie_liveness_detection',
        'selfie_id_comparison',
      ]) {
        await expect(checkRow(dashboard, 'Selfie', name)).toContainText('Passed');
      }
      // The five images (both ID sides, three poses) decrypt and load through the dashboard's
      // authenticated proxy.
      const images = dashboard.getByRole('img');
      await expect(images).toHaveCount(5);
      for (const image of await images.all()) {
        // The images load lazily, and the C36 check list puts them below the fold.
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
          .toBeGreaterThan(0);
      }
    } finally {
      await operator.close();
    }
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});
