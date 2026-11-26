/**
 * C55.10, C54.6: the Twilio sender against a local stub of the Messaging API (no network): the
 * one form-encoded POST with HTTP Basic under an API key, the message id read back, and every
 * failure an `SmsSendError` with a code and `retryable` only, never Twilio's body, the number or
 * the URL. Through the real outbound client, the host is resolved by the vetted lookup and a
 * private answer is refused; a redirect is returned by status and never followed. Every
 * credential and number is synthetic.
 */
import { describe, expect, it } from 'vitest';
import {
  createOutboundHttp,
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpClientOptions,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
} from '../../http/index.js';
import { SmsSendError } from '../../ports.js';
import type { TwilioSettings } from './index.js';
import { createTwilioSmsSender, TWILIO_API_BASE_URL } from './twilio.js';

const SETTINGS: TwilioSettings = {
  accountSid: `AC${'0'.repeat(32)}`,
  apiKeySid: `SK${'1'.repeat(32)}`,
  apiKeySecret: 'change-me-synthetic-twilio-secret-0123456789',
  messagingServiceSid: `MG${'2'.repeat(32)}`,
  from: null,
};
const NUMBER = '+12025550100';
const BODY = 'Synthetic: 123456 is your verification code. Do not share it.';
const MESSAGE_SID = `SM${'a'.repeat(32)}`;

interface StubHttp extends OutboundHttp {
  clients: OutboundHttpClientOptions[];
  requests: OutboundHttpRequest[];
}

const json = (status: number, value: unknown): OutboundHttpResponse => ({
  status,
  contentType: 'application/json',
  body: new TextEncoder().encode(JSON.stringify(value)),
});

/** A local stub of the outbound client: answers each request with `answer`. */
function stubHttp(
  answer: (request: OutboundHttpRequest) => OutboundHttpResponse | Error,
): StubHttp {
  const clients: OutboundHttpClientOptions[] = [];
  const requests: OutboundHttpRequest[] = [];
  return {
    clients,
    requests,
    client(options) {
      clients.push(options);
      return {
        request(request) {
          requests.push(request);
          const response = answer(request);
          return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
        },
      };
    },
    close: () => Promise.resolve(),
  };
}

const sendError = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (error: unknown) => error as SmsSendError,
  );

describe('the Twilio sender (C55.10)', () => {
  it('posts one form-encoded message under the API key and reads the message id back', async () => {
    const http = stubHttp(() => json(201, { sid: MESSAGE_SID, status: 'queued' }));
    const sender = createTwilioSmsSender({ settings: SETTINGS, outboundHttp: http });

    const result = await sender.send({ to: NUMBER, body: BODY });

    expect({ id: sender.id, sandbox: sender.sandbox }).toEqual({ id: 'twilio', sandbox: false });
    expect(result).toEqual({ providerMessageId: MESSAGE_SID });
    expect(http.clients).toEqual([
      expect.objectContaining({ name: 'twilio', contentTypes: ['application/json'] }),
    ]);
    expect(http.clients[0]?.allowPrivateNetworks).not.toBe(true);
    expect(http.requests).toHaveLength(1);
    const [request] = http.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(
      `${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${SETTINGS.accountSid}/Messages.json`,
    );
    expect(request?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from(`${SETTINGS.apiKeySid}:${SETTINGS.apiKeySecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    });
    expect(Object.fromEntries(new URLSearchParams(String(request?.body)))).toEqual({
      To: NUMBER,
      Body: BODY,
      MessagingServiceSid: SETTINGS.messagingServiceSid,
    });
  });

  it('sends from the number when no messaging service is set, and keeps no odd message id', async () => {
    const http = stubHttp(() => json(201, { sid: 'not-a-message-sid' }));
    const sender = createTwilioSmsSender({
      settings: { ...SETTINGS, messagingServiceSid: null, from: '+12025550199' },
      outboundHttp: http,
    });

    expect(await sender.send({ to: NUMBER, body: BODY })).toEqual({});
    expect(Object.fromEntries(new URLSearchParams(String(http.requests[0]?.body)))).toEqual({
      To: NUMBER,
      Body: BODY,
      From: '+12025550199',
    });
  });

  it.each([
    [302, 'twilio_redirect', false],
    [400, 'twilio_rejected', false],
    [401, 'twilio_rejected', false],
    [429, 'twilio_rate_limited', true],
    [500, 'twilio_unavailable', true],
    [503, 'twilio_unavailable', true],
  ] as const)(
    'answers %i as %s (retryable %s), following nothing',
    async (status, code, retryable) => {
      const http = stubHttp(() => ({ status, contentType: null, body: new Uint8Array() }));
      const sender = createTwilioSmsSender({ settings: SETTINGS, outboundHttp: http });

      const error = await sendError(sender.send({ to: NUMBER, body: BODY }));

      expect(error).toBeInstanceOf(SmsSendError);
      expect(error).toMatchObject({ code, retryable });
      expect(http.requests).toHaveLength(1);
    },
  );

  it.each([
    ['timeout', 'twilio_timeout', true],
    ['network', 'twilio_network', true],
    ['blocked', 'twilio_blocked', false],
    ['too_large', 'twilio_too_large', false],
    ['content_type', 'twilio_content_type', false],
  ] as const)('answers an outbound %s as %s', async (failure, code, retryable) => {
    const http = stubHttp(() => new OutboundHttpError('twilio', failure));
    const sender = createTwilioSmsSender({ settings: SETTINGS, outboundHttp: http });

    expect(await sendError(sender.send({ to: NUMBER, body: BODY }))).toMatchObject({
      code,
      retryable,
    });
  });

  it('a body it cannot read is no message id, never a failure of the accepted send', async () => {
    const http = stubHttp(() => ({
      status: 201,
      contentType: 'application/json',
      body: new TextEncoder().encode('{not json'),
    }));
    const sender = createTwilioSmsSender({ settings: SETTINGS, outboundHttp: http });

    expect(await sender.send({ to: NUMBER, body: BODY })).toEqual({});
  });

  it('puts no number, body, secret or URL in a failure', async () => {
    const http = stubHttp(() => json(400, { message: `The number ${NUMBER} is unverified` }));
    const sender = createTwilioSmsSender({ settings: SETTINGS, outboundHttp: http });

    const error = await sendError(sender.send({ to: NUMBER, body: BODY }));

    const text = `${error.message} ${String(error.stack)} ${JSON.stringify(error)}`;
    for (const secret of [NUMBER.slice(1), '123456', SETTINGS.apiKeySecret, 'api.twilio.com']) {
      expect(text).not.toContain(secret);
    }
  });

  it('refuses to send without an outbound client', async () => {
    const sender = createTwilioSmsSender({ settings: SETTINGS });

    expect(await sendError(sender.send({ to: NUMBER, body: BODY }))).toMatchObject({
      code: 'twilio_not_configured',
      retryable: false,
    });
  });

  it('resolves the API host through the vetted lookup and refuses a private answer (C54.6)', async () => {
    const resolved: string[] = [];
    const http = createOutboundHttp({
      resolve: (hostname) => {
        resolved.push(hostname);
        return Promise.resolve([{ address: '10.0.0.7', family: 4 }]);
      },
    });
    const sender = createTwilioSmsSender({ settings: SETTINGS, outboundHttp: http });

    const error = await sendError(sender.send({ to: NUMBER, body: BODY }));

    expect(resolved).toEqual(['api.twilio.com']);
    expect(error).toMatchObject({ code: 'twilio_blocked', retryable: false });
    await http.close();
  });
});
