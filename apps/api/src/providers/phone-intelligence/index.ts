/**
 * C82.2, C83: the `phoneIntelligence` providers, bound by
 * `OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_{SANDBOX,PRODUCTION}` in the worker only:
 * `twilio-lookup` (Twilio Lookup v2, with `OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID`, `_API_KEY_SID`
 * and `_API_KEY_SECRET`) or `sandbox` (`+1 NPA 555 01xx`); unset means unbound, and the phone
 * report's provider fields are then `null` with `provider_not_configured`. Each answers a
 * {@link PhoneIntelligenceAnswer}: the port's answer plus what was checked (`answer.ts`).
 */
import type { PhoneIntelligenceProvider } from '../../ports.js';
import type { ReportProviderOptions } from '../report-options.js';
import { createSandboxPhoneIntelligenceProvider } from './sandbox.js';
import { createTwilioLookupProvider } from './twilio-lookup.js';

export { phoneIntelligenceLookupOf, type PhoneIntelligenceAnswer } from './answer.js';
export { SANDBOX_PHONE_CARRIER, SANDBOX_PHONE_EVENTS } from './sandbox.js';
export { TWILIO_LOOKUP_ORIGIN } from './twilio-lookup.js';

/**
 * The provider `name` binds.
 * @throws {Error} for `twilio-lookup` without its credentials, naming the variables only.
 */
export function createPhoneIntelligenceProvider(
  name: 'twilio-lookup' | 'sandbox',
  options: ReportProviderOptions = {},
): PhoneIntelligenceProvider {
  if (name === 'sandbox') {
    return createSandboxPhoneIntelligenceProvider(options.clock);
  }
  const credentials = options.credentials?.twilioLookup;
  if (credentials == null) {
    throw new Error(
      'twilio-lookup needs its credentials (OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID, _API_KEY_SID, _API_KEY_SECRET)',
    );
  }
  return createTwilioLookupProvider({
    apiKeySid: credentials.apiKeySid,
    apiKeySecret: credentials.apiKeySecret,
    outboundHttp: options.outboundHttp,
  });
}
