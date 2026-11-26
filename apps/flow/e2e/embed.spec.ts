/**
 * C157.1, C158, C159, C171.2 (Workflow 9A, flow-server-embed): the flow embedded by `@openverify/js`
 * from a customer page, served by the flow server with `frame-ancestors` from the (stubbed)
 * internal embed policy. The handshake: the client's hello answered with `ready` and `start` only on
 * an allowed origin, messages with no token, no step id and no field value; on another origin the
 * browser refuses to frame the flow at all. Every value is synthetic; origins are reserved names.
 * C171.2's embedded runs through axe (one per client step type, all 16) are `step-matrix.spec.ts`'s
 * (Workflow 9D), with the rest of the matrix.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  embedEvents,
  embedMessages,
  embedPageUrl,
  installForEmbedding,
  serveEmbedOrigins,
  startEmbedPage,
} from './support/mock-embed';
import { INQUIRY_ID, MockFlowApi, SESSION_TOKEN } from './support/mock-flow-api';
import {
  startMockFlowServer,
  type RunningFlowServer,
  type RunningPageServer,
} from './support/mock-flow-server';

let flowServer: RunningFlowServer;
/** The customer's page, allowed to embed; another page, never allowed (both loopback origins). */
let embedder: RunningPageServer;
let other: RunningPageServer;

test.beforeAll(async () => {
  embedder = await startEmbedPage();
  other = await startEmbedPage();
  flowServer = await startMockFlowServer('http://localhost:9');
  flowServer.setPolicy(INQUIRY_ID, [embedder.origin]);
});

test.afterAll(async () => {
  await flowServer.close();
  await embedder.close();
  await other.close();
});

let removeOrigins: (() => void) | undefined;

test.beforeEach(() => {
  removeOrigins = serveEmbedOrigins([embedder.origin]);
});

test.afterEach(() => {
  removeOrigins?.();
});

const flowFrame = (page: Page) => page.frameLocator('iframe[title="Identity verification"]');

test('embeds the flow on an allowed origin: the hello answered with ready and start, and the flow runs (C159.4)', async ({
  page,
}) => {
  const api = new MockFlowApi();
  await installForEmbedding(api, page, flowServer.origin);

  await page.goto(embedPageUrl(embedder.origin, flowServer.origin, INQUIRY_ID, SESSION_TOKEN));

  await expect(
    flowFrame(page).getByRole('heading', { level: 1, name: 'Consent to use your biometric data' }),
  ).toBeVisible();
  await expect
    .poll(async () => (await embedEvents(page)).map((event) => event.name))
    .toEqual(['load', 'ready', 'event']);
  expect((await embedEvents(page))[2]?.payload).toEqual({ name: 'start', metadata: {} });

  const messages = await embedMessages(page);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.every((message) => message.origin === flowServer.origin)).toBe(true);
  const text = JSON.stringify(messages);
  expect(text).not.toContain(SESSION_TOKEN);
  expect(text).not.toContain('ovs_');
  // The frame's own URL keeps the credentials out of the server's path and query.
  const frameUrl = new URL(
    page
      .frames()
      .find((frame) => frame !== page.mainFrame())
      ?.url() ?? '',
  );
  expect(frameUrl.pathname).toBe(`/embed/${INQUIRY_ID}`);
  expect(frameUrl.search).toBe('');
});

test('is never framed by another origin: frame-ancestors refuses it, so nothing answers (C157.1, C158.1)', async ({
  page,
}) => {
  const api = new MockFlowApi();
  await installForEmbedding(api, page, flowServer.origin);

  await page.goto(embedPageUrl(other.origin, flowServer.origin, INQUIRY_ID, SESSION_TOKEN));

  await expect
    .poll(async () => (await embedEvents(page)).map((event) => event.name))
    .toContain('load');
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  expect(frame?.url()).toMatch(/^chrome-error:/);
  expect((await embedEvents(page)).map((event) => event.name)).toEqual(['load']);
  expect(api.requests.filter((request) => request.path === '/api/v1/flow/session')).toEqual([]);
});
