/**
 * C82.1, C83: the `emailIntelligence` providers, bound by
 * `OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_{SANDBOX,PRODUCTION}` in the worker only: `hibp` (Have I
 * Been Pwned, with `OPENVERIFY_HIBP_API_KEY`) or `sandbox` (local-part token `sandbox-breached`);
 * unset means unbound, and the email report's breach fields are then `null` with
 * `provider_not_configured`. A real adapter receives only the address (P16).
 */
import type { EmailIntelligenceProvider } from '../../ports.js';
import type { ReportProviderOptions } from '../report-options.js';
import { createHibpProvider } from './hibp.js';
import { createSandboxEmailIntelligenceProvider } from './sandbox.js';

export { HIBP_API_ORIGIN, HIBP_MAX_RESPONSE_BYTES, HIBP_USER_AGENT } from './hibp.js';
export { SANDBOX_BREACHED_TOKEN, SANDBOX_BREACH_DAYS_AGO } from './sandbox.js';

/**
 * The provider `name` binds.
 * @throws {Error} for `hibp` without its key, naming the variable only.
 */
export function createEmailIntelligenceProvider(
  name: 'hibp' | 'sandbox',
  options: ReportProviderOptions = {},
): EmailIntelligenceProvider {
  if (name === 'sandbox') {
    return createSandboxEmailIntelligenceProvider(options.clock);
  }
  const apiKey = options.credentials?.hibp?.apiKey;
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (apiKey === undefined) {
    throw new Error('hibp needs its key (OPENVERIFY_HIBP_API_KEY)');
  }
  return createHibpProvider({ apiKey, outboundHttp: options.outboundHttp });
}
