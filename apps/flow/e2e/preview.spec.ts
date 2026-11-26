/**
 * C156.2, C156.3, C178.3 (Workflow 9A, flow-server-embed): the console's preview, framed by the
 * console origin and served by the flow server with `connect-src 'none'`. It renders a posted
 * document through the live step components; it ignores a message from another origin, from
 * another window, over 1 MiB or malformed; it shows a posted logo from a `blob:` URL, hands a posted
 * font to `FontFace` and refuses a buffer of the wrong type, with no `securitypolicyviolation` at
 * all. Every value is synthetic; origins are reserved names.
 */
import { expect, test, type Page } from '@playwright/test';
import { startMockFlowServer, type RunningFlowServer } from './support/mock-flow-server';
import {
  postAssets,
  postToPreview,
  previewDocument,
  previewMessages,
  startConsolePages,
  type ConsolePages,
} from './support/mock-preview';
import { syntheticCardPng } from './support/synthetic-png';

const LOGO_ID = 'tsa_01M5CJXHG07XPHF3HRM6NREDH7';
const FONT_ID = 'tsa_01M5CK16P0D13FXHZSS4TCFBVH';
const PSEUDO_TITLE = '[Á ƒéŵ ɱöŕé ðéţåîļš]';

let flowServer: RunningFlowServer;
let pages: ConsolePages;

test.beforeAll(async () => {
  pages = await startConsolePages();
  flowServer = await startMockFlowServer(pages.console.origin);
  pages.setFlowOrigin(flowServer.origin);
});

test.afterAll(async () => {
  await flowServer.close();
  await pages.close();
});

/** Opens the console page, framing the preview (and, with `hostile`, the two hostile pages). */
async function openConsole(page: Page, hostile: Record<string, unknown> | null = null) {
  pages.setHostile(hostile);
  await page.goto(`${pages.console.origin}/`);
}

test.beforeEach(async ({ page }) => {
  // Every frame records its CSP violations from its first script on.
  await page.addInitScript(() => {
    const record = window as unknown as { cspViolations: string[] };
    record.cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      record.cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
});

const preview = (page: Page) => page.frameLocator('iframe[title="Flow preview"]');

/** The preview frame's CSP violations. */
async function violations(page: Page): Promise<string[]> {
  const frame = page.frames().find((candidate) => candidate.url().startsWith(flowServer.origin));
  return (
    (await frame?.evaluate(
      () => (window as unknown as { cspViolations: string[] }).cspViolations,
    )) ?? ['no preview frame']
  );
}

const messageTypes = async (page: Page) =>
  (await previewMessages(page)).map((message) => message.type);

test('renders a posted document, answering ready and navigated to the console only (C156.2, C156.3)', async ({
  page,
}) => {
  await openConsole(page);
  await expect.poll(() => messageTypes(page)).toEqual(['ready']);

  await postToPreview(page, flowServer.origin, {
    type: 'preview-document',
    document: previewDocument(),
  });
  await postToPreview(page, flowServer.origin, { type: 'select-step', 'step-id': 'extra_details' });

  await expect(preview(page).getByText(PSEUDO_TITLE)).toBeVisible();
  await expect
    .poll(async () => (await previewMessages(page)).at(-1))
    .toEqual({
      source: 'openverify-preview',
      version: 1,
      type: 'navigated',
      'step-id': 'extra_details',
    });

  await postToPreview(page, flowServer.origin, { type: 'select-step', 'step-id': 'id_card' });
  await expect(preview(page).getByText(/still placeholder/)).toBeVisible();
  await postToPreview(page, flowServer.origin, { type: 'set-viewport', width: 320 });
  await expect(preview(page).getByTestId('preview-viewport')).toHaveCSS('max-width', '320px');
  expect(await violations(page)).toEqual([]);
});

test('ignores a message from another origin, from another window, over 1 MiB or malformed (C156.2)', async ({
  page,
}) => {
  const hostile = {
    source: 'openverify-console',
    version: 1,
    type: 'preview-document',
    document: previewDocument((attributes) => {
      attributes.steps = [{ id: 'hostile', type: 'completion' }];
    }),
  };
  await openConsole(page, hostile);
  await expect.poll(() => messageTypes(page)).toEqual(['ready']);
  // Both hostile pages (a stranger origin, and the console origin from another window) posted.
  for (const title of ['Sibling', 'Stranger']) {
    const frame = page.frame({ url: new RegExp(title.toLowerCase()) });
    await expect
      .poll(() => frame?.evaluate(() => (window as unknown as { posted?: boolean }).posted))
      .toBe(true);
  }
  const oversized = previewDocument((attributes) => {
    attributes.steps = [{ id: 'hostile', type: 'completion' }];
    attributes.copy = { padding: 'x'.repeat(1024 * 1024) };
  });
  await postToPreview(page, flowServer.origin, { type: 'preview-document', document: oversized });
  await postToPreview(page, flowServer.origin, { type: 'preview-document', version: 2 });
  await postToPreview(page, flowServer.origin, { type: 'select-step', 'step-id': 'hostile' });
  // A valid message after them: once it is answered, every earlier one has been read.
  await postToPreview(page, flowServer.origin, {
    type: 'preview-document',
    document: previewDocument(),
  });
  await expect.poll(async () => (await previewMessages(page)).at(-1)?.['step-id']).toBe('consent');

  const messages = await previewMessages(page);
  expect(messages.some((message) => message['step-id'] === 'hostile')).toBe(false);

  // A message in the frozen envelope whose document is not one answers malformed-document.
  await postToPreview(page, flowServer.origin, {
    type: 'preview-document',
    document: { data: { type: 'not-a-preview' } },
  });
  await expect
    .poll(async () => (await previewMessages(page)).at(-1))
    .toEqual({
      source: 'openverify-preview',
      version: 1,
      type: 'error',
      code: 'malformed-document',
    });
});

test('shows a posted logo, hands a posted font to FontFace, refuses a buffer of the wrong type, with no CSP violation (C156.2, C178.3)', async ({
  page,
}) => {
  await openConsole(page);
  await expect.poll(() => messageTypes(page)).toEqual(['ready']);
  await postToPreview(page, flowServer.origin, {
    type: 'preview-document',
    document: previewDocument((attributes) => {
      const screen = attributes.steps.find((step) => step.id === 'extra_details');
      (screen?.components as Record<string, unknown>[]).unshift({
        id: 'logo',
        kind: 'image',
        assetId: LOGO_ID,
        decorative: true,
      });
    }),
  });
  await postToPreview(page, flowServer.origin, { type: 'select-step', 'step-id': 'extra_details' });
  await expect(preview(page).getByText(PSEUDO_TITLE)).toBeVisible();

  await postAssets(page, flowServer.origin, [
    { id: LOGO_ID, kind: 'logo', bytes: [...syntheticCardPng({ width: 64, height: 40 })] },
  ]);
  const logo = preview(page).locator('img');
  await expect(logo).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(64);

  // A buffer that sniffs as WOFF2 is handed to FontFace from bytes, with no request; this synthetic
  // one does not decode (no font is committed), so the preview says the asset was refused.
  await postAssets(page, flowServer.origin, [
    { id: FONT_ID, kind: 'font', bytes: [0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0, 0, 0] },
  ]);
  await expect.poll(async () => (await previewMessages(page)).at(-1)?.code).toBe('asset-refused');

  // An SVG posted as a logo is refused before any blob: URL is made.
  const before = (await previewMessages(page)).length;
  await postAssets(page, flowServer.origin, [
    {
      id: LOGO_ID,
      kind: 'logo',
      bytes: [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    },
  ]);
  await expect.poll(async () => (await previewMessages(page)).length).toBe(before + 1);
  expect((await previewMessages(page)).at(-1)?.code).toBe('asset-refused');
  await expect(logo).toHaveAttribute('src', /^blob:/);

  expect(await violations(page)).toEqual([]);
});
