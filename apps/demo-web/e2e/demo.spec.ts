/**
 * C266.3: the sample site end to end against a fake installation. Its server creates the inquiry
 * with the API key it holds, the page embeds the flow with `@openverify/js` (through
 * `@openverify/react`), the flow's completion is only a hint, and the result the page shows is the
 * one its server took from a webhook it verified with `@openverify/node`. The API key never
 * reaches the browser.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { signWebhookPayload } from '@openverify/node';
import {
  FAKE_API_KEY,
  FAKE_TEMPLATE_ID,
  FAKE_WEBHOOK_SECRET,
  startFakeOpenVerify,
  type FakeOpenVerify,
} from './fake-openverify.ts';

const APP_DIR = join(import.meta.dirname, '..');

let fake: FakeOpenVerify;
let demo: ChildProcess;
let demoUrl: string;
let demoOutput = '';

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });

test.beforeAll(async () => {
  fake = await startFakeOpenVerify();
  const port = await freePort();
  demoUrl = `http://127.0.0.1:${String(port)}`;
  demo = spawn(process.execPath, [join(APP_DIR, 'src/server/main.ts')], {
    cwd: APP_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      OPENVERIFY_DEMO_API_URL: fake.apiUrl,
      OPENVERIFY_DEMO_API_KEY: FAKE_API_KEY,
      OPENVERIFY_DEMO_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
      OPENVERIFY_DEMO_FLOW_URL: fake.flowUrl,
      OPENVERIFY_DEMO_TEMPLATE_ID: FAKE_TEMPLATE_ID,
      OPENVERIFY_DEMO_LISTEN: `127.0.0.1:${String(port)}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`the sample server did not start:\n${demoOutput}`));
    }, 20_000);
    const read = (chunk: Buffer): void => {
      demoOutput += chunk.toString();
      if (demoOutput.includes('listening on')) {
        clearTimeout(timer);
        resolve();
      }
    };
    demo.stdout?.on('data', read);
    demo.stderr?.on('data', read);
    demo.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the sample server exited (${String(code)}):\n${demoOutput}`));
    });
  });
});

test.afterAll(async () => {
  demo.kill('SIGTERM');
  await fake.close();
  expect(demoOutput).not.toContain(FAKE_API_KEY);
  expect(demoOutput).not.toContain(FAKE_WEBHOOK_SECRET);
});

test('verifies through the embedded flow and shows the result its server verified', async ({
  page,
}) => {
  const bodies: string[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(demoUrl)) {
      void response.text().then(
        (text) => bodies.push(text),
        () => undefined,
      );
    }
  });
  await page.goto(demoUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample customer site');
  await page.getByRole('button', { name: 'Verify your identity' }).click();

  const flow = page.frameLocator('iframe[title="Identity verification"]');
  await flow.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText(/waiting for your server/i)).toBeVisible();

  // The installation decides and delivers its signed webhook to the sample's server. The fake
  // API's own answer changes only after the delivery, so the page's result is the webhook's.
  const event = JSON.stringify({
    data: {
      type: 'event',
      id: 'evt_01M5CKFVE0A1DPCWBWGY99VA5K',
      attributes: {
        name: 'inquiry.approved',
        payload: {
          data: { type: 'inquiry', id: fake.inquiryId, attributes: { status: 'approved' } },
        },
        simulated: false,
        'created-at': new Date().toISOString(),
      },
    },
  });
  const delivered = await fetch(`${demoUrl}/webhooks/openverify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'openverify-signature': signWebhookPayload(
        event,
        FAKE_WEBHOOK_SECRET,
        Math.floor(Date.now() / 1000),
      ),
    },
    body: event,
  });
  expect(delivered.status).toBe(204);
  fake.decide('approved');

  const result = page.getByRole('status');
  await expect(result).toContainText('approved');
  await expect(result).toContainText('inquiry.approved');
  expect(fake.calls.every(({ keyPresented }) => keyPresented)).toBe(true);
  expect(fake.calls.map(({ call }) => call)).toEqual(
    expect.arrayContaining([
      'POST /api/v1/inquiries',
      `POST /api/v1/inquiries/${fake.inquiryId}/resume`,
    ]),
  );
  expect(bodies.join('\n')).not.toContain(FAKE_API_KEY);
  expect(bodies.join('\n')).not.toContain(FAKE_WEBHOOK_SECRET);
});
