/**
 * C94.1-C94.4, C94.6 (Workflow 7A; P14, F19): the browser collector in the built flow, under the
 * production CSP, against the mocked flow API.
 *
 * - Before consent, and with a session that may not collect, nothing is read, listened to or
 *   posted: the page's own `addEventListener`, `navigator.webdriver` and canvas reads are recorded
 *   from an init script.
 * - After consent, under the tiers `GET /flow/session` reports, each screen the person leaves is
 *   posted to `POST /api/v1/flow/signals` as one body; the consent screen never is.
 * - No CSP violation, and no request to any origin but the flow's own and the API's.
 *
 * The mocked API's `signalTiers` are its `GET /flow/session` answers' `signals` member once the
 * session has consented, as the API does.
 */
import { expect, test, type Page } from '@playwright/test';
import type { FlowSignals } from '@openverify/contracts';
import { giveConsent, heading, uploadId } from './support/flow-steps';
import { API_ORIGIN, MockFlowApi, flowLink } from './support/mock-flow-api';

interface Probe {
  /** The collector's event types listened to on the document or the window. */
  listeners: string[];
  webdriverReads: number;
  canvasReads: number;
  violations: string[];
}

/**
 * Records, from before the flow's first script, what the collector would touch: listeners of its
 * event types on the document (capture phase) and the window, reads of `navigator.webdriver`, and
 * 2D or WebGL canvas contexts; and every CSP violation.
 */
async function installProbe(page: Page): Promise<() => Promise<Probe>> {
  await page.addInitScript(() => {
    const probe = { listeners: [], webdriverReads: 0, canvasReads: 0, violations: [] } as {
      listeners: string[];
      webdriverReads: number;
      canvasReads: number;
      violations: string[];
    };
    (window as unknown as { signalsProbe: typeof probe }).signalsProbe = probe;
    const types = new Set([
      'keydown',
      'input',
      'pointerdown',
      'pointermove',
      'click',
      'visibilitychange',
      'blur',
    ]);
    // The original methods, read from their descriptors to call them on any target.
    const add = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener')
      ?.value as (this: EventTarget, ...args: Parameters<EventTarget['addEventListener']>) => void;
    EventTarget.prototype.addEventListener = function (this: EventTarget, type, listener, options) {
      if ((this === document || this === window) && types.has(type)) {
        probe.listeners.push(type);
      }
      add.call(this, type, listener, options);
    };
    const webdriver = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
    Object.defineProperty(Navigator.prototype, 'webdriver', {
      configurable: true,
      get(this: Navigator) {
        probe.webdriverReads += 1;
        return webdriver?.get?.call(this) as boolean;
      },
    });
    const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')
      ?.value as (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement['getContext']>
    ) => unknown;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<HTMLCanvasElement['getContext']>
    ) {
      probe.canvasReads += 1;
      return getContext.apply(this, args);
    } as HTMLCanvasElement['getContext'];
    // The test's own listener, added through the original method so it is not recorded.
    add.call(document, 'securitypolicyviolation', (event) => {
      const violation = event as SecurityPolicyViolationEvent;
      probe.violations.push(`${violation.violatedDirective} ${violation.blockedURI}`);
    });
  });
  return () =>
    page.evaluate(() => {
      const probe = (window as unknown as { signalsProbe: Probe }).signalsProbe;
      return { ...probe, listeners: [...probe.listeners] };
    });
}

const bodies = (api: MockFlowApi) => api.signalBodies as unknown as FlowSignals[];

test.describe('the browser collector in the flow (C94.3, C94.6, P14)', () => {
  test('reads, listens to and posts nothing on the consent screen, and reads no recognition API after a declined tick', async ({
    page,
  }) => {
    const probe = await installProbe(page);
    const api = new MockFlowApi();
    api.signalTiers = { integrity: true, recognition: false };
    await api.install(page);
    await page.goto(flowLink());

    await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();
    await page.getByRole('checkbox', { name: /^I agree/ }).check();
    const before = await probe();
    expect(before.listeners).toEqual([]);
    expect(before.webdriverReads).toBe(0);
    expect(before.canvasReads).toBe(0);
    expect(api.signalBodies).toEqual([]);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(heading(page, 'Photograph your ID')).toBeVisible();
    await expect.poll(async () => (await probe()).listeners.length).toBeGreaterThan(0);
    const after = await probe();
    expect(after.canvasReads).toBe(0);
    expect(after.violations).toEqual([]);
  });

  test('after consent, posts each screen the person leaves as one body, never the consent screen', async ({
    page,
  }) => {
    const api = new MockFlowApi();
    api.signalTiers = { integrity: true, recognition: false };
    await api.install(page);
    await page.goto(flowLink());

    await giveConsent(page);
    await uploadId(page);
    await expect(heading(page, 'Take a selfie')).toBeVisible();

    await expect.poll(() => api.signalBodies.length).toBe(1);
    const [body] = bodies(api);
    expect(body).toMatchObject({
      platform: 'web',
      'collector-version': 1,
      screen: 'government_id',
      sequence: 0,
    });
    expect(body?.recognition).toBeUndefined();
    // Playwright drives Chromium through WebDriver BiDi or CDP: the browser says so.
    expect(body?.integrity?.webdriver).toBe(true);
    expect(body?.integrity?.['ua-headless-marker']).toEqual(expect.any(Boolean));
    expect(body?.behaviour?.['pointer-types']).toContain('mouse');
    expect(body?.behaviour?.['input-event-count']).toBeGreaterThan(0);
    expect(body?.behaviour?.['dwell-seconds']).toBeGreaterThanOrEqual(0);
    expect(bodies(api).map((sent) => sent.screen)).not.toContain('consent');
  });

  test('posts nothing, and listens to nothing, for a session that may not collect', async ({
    page,
  }) => {
    const probe = await installProbe(page);
    const api = new MockFlowApi();
    await api.install(page);
    await page.goto(flowLink());

    await giveConsent(page);
    await uploadId(page);
    await expect(heading(page, 'Take a selfie')).toBeVisible();

    const seen = await probe();
    expect(seen.listeners).toEqual([]);
    expect(seen.webdriverReads).toBe(0);
    expect(api.signalBodies).toEqual([]);
  });

  test('under device recognition alone, posts the components once, in their own body', async ({
    page,
  }) => {
    const api = new MockFlowApi();
    api.signalTiers = { integrity: false, recognition: true };
    await api.install(page);
    await page.goto(flowLink());

    await giveConsent(page);
    await expect(heading(page, 'Photograph your ID')).toBeVisible();

    await expect.poll(() => api.signalBodies.length).toBe(1);
    const [body] = bodies(api);
    expect(body).toMatchObject({ platform: 'web', screen: 'government_id', sequence: 0 });
    expect(body?.integrity).toBeUndefined();
    expect(body?.behaviour).toBeUndefined();
    const recognition = body?.recognition;
    expect(recognition?.['canvas-noise']).toEqual(expect.any(Boolean));
    // A digest only when two readbacks agree (C94.4); Chromium adds no noise of its own.
    expect(recognition?.['canvas-digest']).toMatch(/^[0-9a-f]{64}$/);
  });

  test('runs under the production CSP with no violation and no request but the flow’s and the API’s', async ({
    page,
    baseURL,
  }) => {
    const probe = await installProbe(page);
    const origins = new Set<string>();
    page.on('request', (request) => {
      origins.add(new URL(request.url()).origin);
    });
    const api = new MockFlowApi();
    api.signalTiers = { integrity: true, recognition: true };
    await api.install(page);
    await page.goto(flowLink());

    await giveConsent(page);
    await uploadId(page);
    await expect(heading(page, 'Take a selfie')).toBeVisible();
    await expect.poll(() => api.signalBodies.length).toBe(2);

    expect((await probe()).violations).toEqual([]);
    expect([...origins].sort()).toEqual([API_ORIGIN, new URL(String(baseURL)).origin].sort());
  });
});
