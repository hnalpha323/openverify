/**
 * C55.10, C63, C126.6: the SMS senders, bound by `OPENVERIFY_PROVIDER_SMS_{SANDBOX,PRODUCTION}` in
 * the API and the worker: `twilio` (the Messaging API through the outbound client, `twilio.ts`) or `sandbox`
 * (sandbox kind only: sends nothing and keeps the code in the sandbox sink, `sandbox.ts`).
 */
import type { OutboundHttp } from '../../http/index.js';
import type { Clock, KeyValueCache, SandboxSmsSender, SmsSender } from '../../ports.js';
import { createSandboxSmsSender } from './sandbox.js';
import { createTwilioSmsSender } from './twilio.js';

/** C55.10, C126.6: Twilio's credentials (`OPENVERIFY_TWILIO_*`), read by the API and the worker. */
export interface TwilioSettings {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  /** One of the two is set. */
  messagingServiceSid: string | null;
  from: string | null;
}

export interface SmsSenderOptions {
  /** Required for `twilio`; `loadConfig` refuses to start without it. */
  twilio?: TwilioSettings | null | undefined;
  outboundHttp?: OutboundHttp | undefined;
  /** The sandbox sink (C55.11). */
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
}

/**
 * The sender `name` binds.
 * @throws {Error} for `twilio` without its credentials.
 */
export function createSmsSender(
  name: 'twilio' | 'sandbox',
  options: SmsSenderOptions = {},
): SmsSender | SandboxSmsSender {
  if (name === 'sandbox') {
    return createSandboxSmsSender({ cache: options.cache, clock: options.clock });
  }
  if (options.twilio == null) {
    throw new Error('twilio needs its credentials (OPENVERIFY_TWILIO_*)');
  }
  return createTwilioSmsSender({ settings: options.twilio, outboundHttp: options.outboundHttp });
}
