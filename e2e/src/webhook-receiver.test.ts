import { request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as secureRequest } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signWebhookPayload, verifyWebhookSignature } from '@openverify/node';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { writeReceiverCertificate } from './receiver-certificate.js';
import { startWebhookReceiver, type WebhookReceiver } from './webhook-receiver.js';

let receiver: WebhookReceiver | undefined;

afterEach(async () => {
  await receiver?.close();
  receiver = undefined;
});

interface Sent {
  status: number;
  body: string;
}

/** POSTs exactly these bytes, as the API's dispatcher does. */
function post(
  url: string,
  body: string,
  headers: Record<string, string> = {},
  host?: string,
): Promise<Sent> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: host ?? target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: text });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('startWebhookReceiver', () => {
  it('listens on localhost, answers 200 and records the raw body and headers', async () => {
    receiver = await startWebhookReceiver();
    const body = '{ "data" : { "name": "inquiry.completed", "note": "café ✓" } }';

    const sent = await post(receiver.url, body, { 'openverify-event-id': 'evt_1' });

    expect(receiver.url).toMatch(/^http:\/\/localhost:\d+\/webhooks$/);
    expect(sent.status).toBe(200);
    expect(receiver.requests).toHaveLength(1);
    expect(receiver.requests[0]).toMatchObject({
      method: 'POST',
      path: '/webhooks',
      body,
      headers: { 'openverify-event-id': 'evt_1', 'content-type': 'application/json' },
    });
  });

  it('keeps the bytes exactly, so a signature over the raw body verifies', async () => {
    receiver = await startWebhookReceiver();
    const secret = 'wbhsec_receiver_test_only_not_a_real_secret_x';
    const body = '{"data":{"type":"event","id":"evt_x","attributes":{"name":"inquiry.failed"}}}';
    const header = signWebhookPayload(body, secret, 1_792_497_600);

    await post(receiver.url, body, { 'openverify-signature': header });
    const [recorded] = receiver.requests;

    expect(
      verifyWebhookSignature({
        body: recorded?.body ?? '',
        header: recorded?.headers['openverify-signature'],
        secrets: secret,
        now: new Date(1_792_497_600_000),
      }).timestamp,
    ).toBe(1_792_497_600);
  });

  it('answers with the status it was given', async () => {
    receiver = await startWebhookReceiver({ status: 503 });

    expect((await post(receiver.url, '{}')).status).toBe(503);
  });

  it('accepts connections on the IPv4 loopback the webhook guard may resolve localhost to', async () => {
    receiver = await startWebhookReceiver();

    expect((await post(receiver.url, '{}', {}, '127.0.0.1')).status).toBe(200);
  });

  it('waits for a request that arrives later', async () => {
    receiver = await startWebhookReceiver();
    const url = receiver.url;
    const waiting = receiver.waitFor((recorded) => recorded.body.includes('second'), {
      timeoutMs: 5_000,
    });

    await post(url, '{"n":"first"}');
    setTimeout(() => void post(url, '{"n":"second"}'), 50);

    await expect(waiting).resolves.toMatchObject({ body: '{"n":"second"}' });
  });

  it('finds a request that already arrived', async () => {
    receiver = await startWebhookReceiver();
    await post(receiver.url, '{"n":"early"}');

    await expect(
      receiver.waitFor((recorded) => recorded.body.includes('early'), { timeoutMs: 100 }),
    ).resolves.toMatchObject({ body: '{"n":"early"}' });
  });

  it('times out with a count of what did arrive', async () => {
    receiver = await startWebhookReceiver();
    await post(receiver.url, '{}');

    await expect(
      receiver.waitFor(() => false, { timeoutMs: 100, description: 'inquiry.completed' }),
    ).rejects.toThrow('No webhook matching inquiry.completed within 100 ms (1 received)');
  });

  it('stops listening when closed', async () => {
    receiver = await startWebhookReceiver();
    const url = receiver.url;
    await receiver.close();
    receiver = undefined;

    await expect(post(url, '{}', {}, '127.0.0.1')).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('over TLS (C146.3: the HTTPS action reaches `https:` alone)', () => {
  it('serves its own certificate for localhost, and records the raw body', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openverify-receiver-'));
    onTestFinished(() => {
      rmSync(directory, { recursive: true });
    });
    const files = {
      certificate: path.join(directory, 'certificate.pem'),
      key: path.join(directory, 'key.pem'),
    };
    await writeReceiverCertificate(files);
    const certificate = readFileSync(files.certificate);
    receiver = await startWebhookReceiver({
      tls: { certificate, key: readFileSync(files.key) },
    });
    const { url } = receiver;
    expect(url).toMatch(/^https:\/\/localhost:\d+\/webhooks$/);

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const target = new URL(url);
      const sent = secureRequest(
        {
          host: 'localhost',
          port: target.port,
          path: target.pathname,
          method: 'POST',
          ca: certificate,
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode);
          });
        },
      );
      sent.on('error', reject);
      sent.end('synthetic body');
    });

    expect(status).toBe(200);
    expect(receiver.requests[0]?.body).toBe('synthetic body');
  });
});
