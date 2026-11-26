/**
 * C178.4, C157-C159 (Workflow 9A): embedding and the preview frame on the full stack, through the
 * flow server the stack runs (`apps/flow/server.ts`, C157.3). Budget: 90 s per test.
 *
 * 1. The sandbox allows the e2e embed page's origin (`allowed-embed-origins`, restored after):
 *    the page embeds a new inquiry with `@openverify/js`, the flow server's `/embed/<inquiry>`
 *    names that origin in `frame-ancestors`, the flow runs in the frame and answers the page's
 *    hello (ready, start), and no message carries the session token; with `style-variant=dark` in
 *    its fragment the page embeds the flow dark. The same page served from
 *    another origin (`localhost` instead of `127.0.0.1`) is refused by `frame-ancestors`: the flow
 *    never renders there.
 * 2. The preview (`/preview`) is framed by the console's origin only, with its own policy
 *    (`connect-src 'none'`, the console as its only frame-ancestor, no camera): framed from the
 *    console's origin it answers `ready`, renders a posted preview document (the golden
 *    `template-preview.json`, synthetic) and says where it navigated; framed from another origin
 *    it never renders.
 * Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { REPO_ROOT } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { dashboardRequest, recordingClient } from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';

const CONSENT_HEADING = 'Consent to use your biometric data';

/** `http://localhost:<port>`: the embed page's server under an origin no setting allows. */
const otherOriginOf = (url: string): string => url.replace('://127.0.0.1:', '://localhost:');

/** The CSP of a GET of `url`, and its other headers. */
async function headersOf(url: string): Promise<Headers> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.headers;
}

/** Records every message the page receives, with its origin. */
async function recordMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    const messages: { origin: string; data: unknown }[] = [];
    (window as unknown as { recorded: typeof messages }).recorded = messages;
    window.addEventListener('message', (event) => {
      messages.push({ origin: event.origin, data: event.data });
    });
  });
}

const recorded = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { recorded: { origin: string; data: unknown }[] }).recorded,
  );

test('an embedded flow runs on an allowed origin and frame-ancestors refuses another (C157.1, C158, C159)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const token = await sessionTokenAs(stack, 'admin');
  const settings = (await dashboardRequest(stack, 'GET', '/settings', { token })).body as Record<
    string,
    unknown
  >;
  const original = settings['allowed-embed-origins'] ?? [];
  const allowed = await dashboardRequest(stack, 'PATCH', '/settings', {
    token,
    body: { 'allowed-embed-origins': [stack.embedPageUrl] },
  });
  expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  const context = await browser.newContext();
  try {
    const { client } = recordingClient(stack.apiUrl, stack.apiKey);
    const { data: inquiry } = await client.inquiries.create({
      'inquiry-template-id': stack.defaultTemplateId,
      'reference-id': `e2e-embed-${randomUUID()}`,
    });
    const resumed = await client.inquiries.resume(inquiry.id);
    const sessionToken = resumed.meta['session-token'];

    // C157.1: a header computed for this request, naming the page's origin and nothing else.
    const embedCsp =
      (await headersOf(`${stack.flowUrl}/embed/${inquiry.id}`)).get('content-security-policy') ??
      '';
    expect(embedCsp).toContain(`frame-ancestors ${stack.embedPageUrl}`);
    expect(embedCsp).not.toContain("frame-ancestors 'none'");

    const fragment = new URLSearchParams({
      'flow-url': stack.flowUrl,
      'inquiry-id': inquiry.id,
      'session-token': sessionToken,
    }).toString();
    const page = await context.newPage();
    await page.goto(`${stack.embedPageUrl}/#${fragment}`);
    const frame = page.frameLocator('iframe[title="Identity verification"]');
    await expect(frame.getByRole('heading', { level: 1, name: CONSENT_HEADING })).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (window as unknown as { openverifyEvents: { name: string }[] }).openverifyEvents.map(
            ({ name }) => name,
          ),
        ),
      )
      .toEqual(expect.arrayContaining(['load', 'ready', 'event']));
    const messages = JSON.stringify(
      await page.evaluate(
        () => (window as unknown as { openverifyMessages: unknown[] }).openverifyMessages,
      ),
    );
    // C159.4: from the flow origin only, and never a credential.
    expect(messages).toContain(stack.flowUrl);
    expect(messages).not.toContain(sessionToken);

    // Workflow 9D Stage 1 amendment 12: the page forwards `style-variant`, so an embedded flow can
    // be drawn dark on the full stack too (D1: a dark run sets the variant, never only the media).
    const dark = await context.newPage();
    await dark.goto(`${stack.embedPageUrl}/#${fragment}&style-variant=dark`);
    await expect(
      dark.frameLocator('iframe[title="Identity verification"]').locator('html'),
    ).toHaveAttribute('data-openverify-variant', 'dark', { timeout: 30_000 });
    await dark.close();

    // The same page under another origin: the browser refuses the frame (C157.1, fail closed).
    const other = await context.newPage();
    const refusals: string[] = [];
    other.on('console', (message) => {
      if (message.text().includes('frame-ancestors')) refusals.push(message.text());
    });
    await other.goto(`${otherOriginOf(stack.embedPageUrl)}/#${fragment}`);
    await expect.poll(() => refusals.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(
      other
        .frameLocator('iframe[title="Identity verification"]')
        .getByRole('heading', { level: 1, name: CONSENT_HEADING }),
    ).toHaveCount(0);
  } finally {
    await context.close();
    await dashboardRequest(stack, 'PATCH', '/settings', {
      token,
      body: { 'allowed-embed-origins': original },
    });
  }
});

test('the preview frame answers the console origin only, with its own headers (C156.2, C156.3, C157.1)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const headers = await headersOf(`${stack.flowUrl}/preview`);
  const csp = headers.get('content-security-policy') ?? '';
  expect(csp).toContain("connect-src 'none'");
  expect(csp).toContain(`frame-ancestors ${stack.dashboardUrl}`);
  expect(csp).toContain("default-src 'none'");
  expect(headers.get('permissions-policy')).toContain('camera=()');
  expect(headers.get('x-frame-options')).toBeNull();

  const previewDocument = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'contracts/fixtures/api/template-preview.json'), 'utf8'),
  ) as unknown;
  const frameFrom = async (page: Page) => {
    await recordMessages(page);
    await page.evaluate((src) => {
      const frame = document.createElement('iframe');
      frame.title = 'Flow preview';
      frame.src = src;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      document.body.append(frame);
    }, `${stack.flowUrl}/preview`);
  };
  const context = await browser.newContext();
  try {
    // The console's origin: the dashboard's own sign-in page, with the frame added to it.
    const consolePage = await context.newPage();
    await consolePage.goto(`${stack.dashboardUrl}/login`);
    await frameFrom(consolePage);
    await expect
      .poll(async () =>
        (await recorded(consolePage)).map(({ data }) => (data as { type?: string }).type),
      )
      .toContain('ready');
    expect((await recorded(consolePage)).every(({ origin }) => origin === stack.flowUrl)).toBe(
      true,
    );
    await consolePage.evaluate(
      ({ message, flowOrigin }) => {
        document
          .querySelector<HTMLIFrameElement>('iframe[title="Flow preview"]')
          ?.contentWindow?.postMessage(message, flowOrigin);
      },
      {
        message: {
          source: 'openverify-console',
          version: 1,
          type: 'preview-document',
          document: previewDocument,
        },
        flowOrigin: stack.flowUrl,
      },
    );
    await consolePage.evaluate(
      ({ message, flowOrigin }) => {
        document
          .querySelector<HTMLIFrameElement>('iframe[title="Flow preview"]')
          ?.contentWindow?.postMessage(message, flowOrigin);
      },
      {
        message: {
          source: 'openverify-console',
          version: 1,
          type: 'select-step',
          'step-id': 'extra_details',
        },
        flowOrigin: stack.flowUrl,
      },
    );
    await expect(
      consolePage.frameLocator('iframe[title="Flow preview"]').getByText('[Á ƒéŵ ɱöŕé ðéţåîļš]'),
    ).toBeVisible();
    await expect
      .poll(async () => (await recorded(consolePage)).at(-1)?.data)
      .toMatchObject({
        source: 'openverify-preview',
        type: 'navigated',
        'step-id': 'extra_details',
      });

    // Another origin (the embed page's server): the frame is refused and never says ready.
    const stranger = await context.newPage();
    const refusals: string[] = [];
    stranger.on('console', (message) => {
      if (message.text().includes('frame-ancestors')) refusals.push(message.text());
    });
    await stranger.goto(`${stack.embedPageUrl}/`);
    await frameFrom(stranger);
    await expect.poll(() => refusals.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await recorded(stranger)).toEqual([]);
  } finally {
    await context.close();
  }
});
