/**
 * C55.10: the Twilio sender, one call to the Messaging API (`POST /2010-04-01/Accounts/{sid}/
 * Messages.json`, form-encoded `To`, `Body` and `MessagingServiceSid` or `From`, HTTP Basic with
 * an API key) through the C54.6 outbound client: the vetted lookup, private networks refused, no
 * redirect followed, a response cap. A failure is an `SmsSendError` with a code and `retryable`
 * only, never Twilio's body, the number or the URL (C53.8).
 */
import { OutboundHttpError, type OutboundHttp, type OutboundHttpClient } from '../../http/index.js';
import { SmsSendError, type SmsSender } from '../../ports.js';
import type { TwilioSettings } from './index.js';

/** Where the Messaging API lives. */
export const TWILIO_API_BASE_URL = 'https://api.twilio.com';

/** A message resource answers in a few hundred bytes; anything far larger is not one. */
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;
/** Twilio's id of an SMS or MMS message. */
const MESSAGE_SID = /^(?:SM|MM)[0-9a-f]{32}$/u;

export interface TwilioSmsSenderOptions {
  settings: TwilioSettings;
  outboundHttp?: OutboundHttp | undefined;
  /** Tests point it at a local stub; production uses {@link TWILIO_API_BASE_URL}. */
  baseUrl?: string | undefined;
}

/** The failure of a status other than 2xx: a redirect is never followed (C54.6). */
function statusFailure(status: number): SmsSendError {
  if (status >= 300 && status < 400) {
    return new SmsSendError('twilio_redirect', { retryable: false });
  }
  if (status === 429) {
    return new SmsSendError('twilio_rate_limited', { retryable: true });
  }
  if (status >= 500) {
    return new SmsSendError('twilio_unavailable', { retryable: true });
  }
  return new SmsSendError('twilio_rejected', { retryable: false });
}

/** The message id of an accepted send, or `undefined` when the body does not hold one. */
function messageSidOf(body: Uint8Array): string | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    const sid = (parsed as { sid?: unknown } | null)?.sid;
    return typeof sid === 'string' && MESSAGE_SID.test(sid) ? sid : undefined;
  } catch {
    return undefined;
  }
}

/** The Twilio sender. Its outbound client is made once, on the first send. */
export function createTwilioSmsSender(options: TwilioSmsSenderOptions): SmsSender {
  const { settings, outboundHttp } = options;
  const baseUrl = options.baseUrl ?? TWILIO_API_BASE_URL;
  const url = `${baseUrl}/2010-04-01/Accounts/${encodeURIComponent(settings.accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(
    `${settings.apiKeySid}:${settings.apiKeySecret}`,
  ).toString('base64')}`;
  let client: OutboundHttpClient | undefined;
  return {
    id: 'twilio',
    sandbox: false,
    async send({ to, body }) {
      if (outboundHttp === undefined) {
        throw new SmsSendError('twilio_not_configured', { retryable: false });
      }
      client ??= outboundHttp.client({
        name: 'twilio',
        contentTypes: ['application/json'],
        maxResponseBytes: MAX_RESPONSE_BYTES,
        timeoutMs: TIMEOUT_MS,
      });
      const form = new URLSearchParams({ To: to, Body: body });
      if (settings.messagingServiceSid === null) {
        form.set('From', settings.from ?? '');
      } else {
        form.set('MessagingServiceSid', settings.messagingServiceSid);
      }
      let response;
      try {
        response = await client.request({
          method: 'POST',
          url,
          headers: {
            authorization,
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body: form.toString(),
        });
      } catch (error) {
        if (error instanceof OutboundHttpError) {
          throw new SmsSendError(`twilio_${error.code}`, { retryable: error.retryable });
        }
        throw new SmsSendError('twilio_network', { retryable: true });
      }
      if (response.status < 200 || response.status > 299) {
        throw statusFailure(response.status);
      }
      const providerMessageId = messageSidOf(response.body);
      return providerMessageId === undefined ? {} : { providerMessageId };
    },
  };
}
