/**
 * C46.1 and C40 in the built flow, against the mocked API, with the default template's three
 * poses and active liveness (C45.1) and Chromium's fake camera, whose test pattern shows no face.
 * The guidance (onnxruntime-web with the pinned YuNet, single-threaded WASM from the flow's own
 * origin) runs under the production CSP; with no face it offers the manual shutter after 10 s.
 * Auto-capture on a head-turn clip is the full-stack suite's job (Stage 4).
 */
import { expect, test, type Page } from '@playwright/test';
import { POSE_TEXTS, announcement, heading, takeSelfie, uploadSelfie } from './support/flow-steps';
import { API_ORIGIN, MockFlowApi, flowLink, selfieFlow } from './support/mock-flow-api';

const CONSENTED = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };

/** Console errors and page errors, Content-Security-Policy violations included. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Every `securitypolicyviolation` the page reports. */
async function collectCspViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations);
}

/** Counts the page's camera requests, to show the camera stays open for the whole capture. */
async function countCameraRequests(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counter = { calls: 0 };
    (window as unknown as { cameraRequests: typeof counter }).cameraRequests = counter;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      counter.calls += 1;
      return original(constraints);
    };
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { cameraRequests: { calls: number } }).cameraRequests.calls,
    );
}

/** Consent given and the ID passed: the session puts the user on the selfie step. */
function seedAtSelfie(api: MockFlowApi): void {
  api.flow = selfieFlow();
  api.consent = CONSENTED;
  api.verifications.push({
    type: 'verification/government-id',
    id: 'ver_01M5CK16P0D13FXHZSS4TCFBZZ',
    status: 'passed',
    hints: [],
  });
}

async function openAtSelfie(page: Page, api: MockFlowApi): Promise<void> {
  seedAtSelfie(api);
  await api.install(page);
  await page.goto(flowLink());
  await expect(heading(page, 'Take a selfie')).toBeVisible();
}

test('takes the three poses in the server’s order, each uploaded before the next prompt, then submits the capture', async ({
  page,
}) => {
  await page.clock.install();
  const errors = collectConsoleErrors(page);
  const api = new MockFlowApi();
  api.capturePrompts = ['center', 'right', 'left'];
  await openAtSelfie(page, api);

  await page.getByRole('button', { name: 'Start the camera' }).click();
  const shutter = page.getByRole('button', { name: 'Capture' });
  const poses = ['center', 'right', 'left'] as const;
  for (const [index, pose] of poses.entries()) {
    await expect(announcement(page)).toHaveText(
      `Photo ${String(index + 1)} of 3: ${POSE_TEXTS[pose].title}`,
    );
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(POSE_TEXTS[pose].title);
    // The previous pose reached the server before this prompt appeared (C40.3).
    expect(api.uploads.filter(({ kind }) => kind.startsWith('selfie-'))).toHaveLength(index);
    await page.clock.fastForward(10_000);
    await expect(shutter).not.toHaveAttribute('aria-disabled', 'true');
    await shutter.click();
  }

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  const [capture] = api.captures;
  expect(capture).toMatchObject({ method: 'camera', prompts: ['center', 'right', 'left'] });
  const selfies = api.uploads.filter(({ kind }) => kind.startsWith('selfie-'));
  expect(selfies.map(({ kind }) => kind)).toEqual(['selfie-center', 'selfie-right', 'selfie-left']);
  for (const upload of selfies) {
    expect(upload).toMatchObject({
      captureId: capture?.id,
      nonce: capture?.nonce,
      // C153.2 (Workflow 9A): the capture method after the capture fields.
      fields: ['kind', 'capture-id', 'nonce', 'client-elapsed-ms', 'capture-method', 'file'],
    });
  }
  const elapsed = selfies.map(({ clientElapsedMs }) => clientElapsedMs ?? -1);
  expect(elapsed).toEqual([...elapsed].sort((a, b) => a - b));
  const device = api.submits.at(-1)?.body?.capture?.device;
  expect(api.submits.at(-1)?.body?.capture).toMatchObject({
    id: capture?.id,
    nonce: capture?.nonce,
  });
  // Chromium's file-free fake camera, under Playwright: webdriver is true; captures are never
  // mirrored.
  expect(device).toMatchObject({ webdriver: true, 'image-mirrored': false });
  expect(device?.label).toEqual(expect.any(String));
  expect(device?.settings?.width).toEqual(expect.any(Number));
  expect(errors).toEqual([]);
});

test('runs the guidance from the flow’s own origin under the CSP, with nothing fetched elsewhere', async ({
  page,
  baseURL,
}) => {
  const errors = collectConsoleErrors(page);
  const violations = await collectCspViolations(page);
  const origins = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      origins.add(url.origin);
    }
  });
  const wasm = page.waitForResponse((response) =>
    response.url().endsWith('/guidance/ort-wasm-simd-threaded.wasm'),
  );
  const api = new MockFlowApi();
  await openAtSelfie(page, api);

  await page.getByRole('button', { name: 'Start the camera' }).click();

  // The detector ran on the fake camera's frames: it finds no face there.
  await expect(page.getByTestId('guidance-message')).toHaveText(
    'We cannot see your face. Fit your face inside the oval.',
  );
  expect((await wasm).headers()['content-type']).toBe('application/wasm');
  expect([...origins].sort()).toEqual([API_ORIGIN, new URL(baseURL ?? '').origin].sort());
  expect(await violations()).toEqual([]);
  expect(errors).toEqual([]);
});

test('offers the manual shutter at once, logging nothing, when the model does not match its pin', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await page.route('**/guidance/face_detection_yunet_2026may.onnx', (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'not the model' }),
  );
  const api = new MockFlowApi();
  await openAtSelfie(page, api);

  await page.getByRole('button', { name: 'Start the camera' }).click();

  await expect(announcement(page)).toHaveText('Photo 1 of 3: Look straight ahead');
  await expect(page.getByRole('button', { name: 'Capture' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByTestId('guidance-message')).toHaveText(
    'Hold the pose, then select Capture.',
  );
  expect(errors).toEqual([]);
});

test('starts again with a new capture after 409 selfie_capture_invalid, the camera still open', async ({
  page,
}) => {
  await page.clock.install();
  const cameraRequests = await countCameraRequests(page);
  const api = new MockFlowApi();
  api.invalidSubmits = 1;
  await openAtSelfie(page, api);

  await takeSelfie(page, ['center', 'left', 'right']);

  await expect(announcement(page)).toContainText(
    'Your selfie session ended before all the photos were sent, so we started again.',
  );
  await expect(announcement(page)).toContainText('Photo 1 of 3: Look straight ahead');
  const shutter = page.getByRole('button', { name: 'Capture' });
  for (const index of [1, 2, 3]) {
    await expect(announcement(page)).toContainText(`Photo ${String(index)} of 3`);
    await page.clock.fastForward(10_000);
    await expect(shutter).not.toHaveAttribute('aria-disabled', 'true');
    await shutter.click();
  }

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.captures.map(({ status }) => status)).toEqual(['errored', 'submitted']);
  expect(await cameraRequests()).toBe(1);
});

test('retries a failed upload for that pose before moving on', async ({ page }) => {
  await page.clock.install();
  const api = new MockFlowApi();
  api.failingUploads = 1;
  await openAtSelfie(page, api);
  await page.getByRole('button', { name: 'Start the camera' }).click();
  await expect(announcement(page)).toHaveText('Photo 1 of 3: Look straight ahead');
  await page.clock.fastForward(10_000);
  await page.getByRole('button', { name: 'Capture' }).click();

  await expect(page.getByRole('alert')).toContainText(
    'The verification service is having trouble.',
  );
  const retry = page.getByRole('button', { name: 'Try again' });
  await retry.click();

  await expect(announcement(page)).toHaveText('Photo 2 of 3: Turn your head to the left');
  // Focus stayed on the button the user pressed (WCAG 2.4.3).
  await expect(page.getByRole('button', { name: 'Capture' })).toBeFocused();
  expect(
    api.uploads.filter(({ kind }) => kind.startsWith('selfie-')).map(({ kind }) => kind),
  ).toEqual(['selfie-center']);
});

test('the sandbox upload fallback uploads every prompted pose with a capture of method upload', async ({
  page,
}) => {
  const api = new MockFlowApi();
  api.environmentKind = 'sandbox';
  api.capturePrompts = ['center', 'right', 'left'];
  await openAtSelfie(page, api);

  await uploadSelfie(page, ['center', 'right', 'left']);

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.captures.map(({ method }) => method)).toEqual(['upload']);
  expect(
    api.uploads.filter(({ kind }) => kind.startsWith('selfie-')).map(({ kind }) => kind),
  ).toEqual(['selfie-center', 'selfie-right', 'selfie-left']);
  expect(api.submits.at(-1)?.body).toEqual({
    capture: { id: api.captures[0]?.id, nonce: api.captures[0]?.nonce },
  });
});

test('serves ONNX Runtime’s licence and third-party notices with the flow (C48)', async ({
  request,
}) => {
  const notices = await request.get('/licenses/onnxruntime-web/ThirdPartyNotices.txt');
  const licence = await request.get('/licenses/onnxruntime-web/LICENSE.txt');

  expect(notices.status()).toBe(200);
  expect(await notices.text()).toContain('Mozilla Public License Version 2.0');
  expect(licence.status()).toBe(200);
  expect(await licence.text()).toContain('MIT License');
  // Phase 10 P2: where the source of the Eigen inside the WASM is (MPL-2.0 section 3.2(a)).
  const eigen = await request.get('/licenses/onnxruntime-web/EIGEN-SOURCE.txt');
  expect(eigen.status()).toBe(200);
  expect(await eigen.text()).toContain('1d8b82b0740839c0de7f1242a3585e3390ff5f33');
});

test('announces the prompts in Spanish', async ({ page }) => {
  const api = new MockFlowApi();
  seedAtSelfie(api);
  await api.install(page);
  await page.goto(`/?lang=es${flowLink()}`.replace('/#', '#'));

  await page.getByRole('button', { name: 'Abrir la cámara' }).click();

  await expect(announcement(page)).toHaveText('Foto 1 de 3: Mira al frente');
});
