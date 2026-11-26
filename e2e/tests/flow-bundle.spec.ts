/**
 * C46.1 and the Phase 4 acceptance item "the flow loads nothing from outside its own and the
 * API's origins". The built flow bundle (`vite build`, served by `vite preview` as a static
 * host would) runs a whole verification under its own Content-Security-Policy, the selfie with
 * the in-browser guidance: the pinned YuNet model in onnxruntime-web's single-threaded
 * WebAssembly, which needs `script-src 'self' 'wasm-unsafe-eval'` and nothing more. The spec
 * fails on any `securitypolicyviolation` event and on any request to an origin other than the
 * flow's and the API's; the WASM is served as `application/wasm`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import {
  collectConsoleErrors,
  fakeCameraArgs,
  giveConsent,
  takeSelfie,
  uploadId,
} from './support/flow.js';
import { createServerApi } from './support/server-api.js';

test.use({ launchOptions: { args: fakeCameraArgs(FIXTURES.headTurnMatching) } });

interface Violation {
  directive: string;
  blocked: string;
  source: string;
}

test('the built flow runs a whole verification without a CSP violation or a request outside its own and the API origins (C46.1)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const inquiry = await api.createInquiry(stack.defaultTemplateId, `e2e-bundle-${randomUUID()}`);
  const { flowUrl } = await api.resumeInquiry(inquiry.id);

  // Every violation the document reports, from its first script on.
  await page.addInitScript(() => {
    const violations: Violation[] = [];
    Object.assign(window, { __cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
        source: event.sourceFile,
      });
    });
  });
  const allowed = new Set([new URL(stack.flowUrl).origin, new URL(stack.apiUrl).origin]);
  const requested: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    // Inline images are part of the page; a blob URL's origin is the page that made it.
    if (url.protocol !== 'data:') {
      requested.push(`${url.origin} ${request.method()} ${url.pathname}`);
    }
  });
  const wasm = page.waitForResponse((response) =>
    response.url().endsWith('/guidance/ort-wasm-simd-threaded.wasm'),
  );
  const model = page.waitForResponse((response) =>
    response.url().endsWith('/guidance/face_detection_yunet_2026may.onnx'),
  );
  const errors = collectConsoleErrors(page);

  await page.goto(flowUrl);
  await giveConsent(page);
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
  // The guidance ran: it took every photo itself.
  const shots = await takeSelfie(page);
  expect(shots.map((shot) => shot.shutter)).toEqual(['auto', 'auto', 'auto']);
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 90_000 },
  );

  // The guidance files came from the flow's own origin, with the right types.
  for (const response of [await wasm, await model]) {
    expect(new URL(response.url()).origin, response.url()).toBe(new URL(stack.flowUrl).origin);
    expect(response.status(), response.url()).toBe(200);
  }
  expect((await wasm).headers()['content-type']).toBe('application/wasm');

  // The policy the bundle ships: WebAssembly compilation is the only script exception.
  const policy =
    (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ??
    '';
  const scriptSrc = policy
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('script-src '));
  expect(scriptSrc).toBe("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy.split(/[\s;]+/)).not.toContain("'unsafe-eval'");
  expect(policy.split(/[\s;]+/)).not.toContain("'unsafe-inline'");

  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: Violation[] }).__cspViolations,
  );
  expect(violations).toEqual([]);
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.filter((line) => !allowed.has(line.split(' ')[0] ?? ''))).toEqual([]);
  expect(errors).toEqual([]);
});
