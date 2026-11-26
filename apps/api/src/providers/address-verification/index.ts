/**
 * C82.3, C83: the `addressVerification` providers, bound by
 * `OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_{SANDBOX,PRODUCTION}` in the worker only: `smarty`
 * (Smarty's US Street API, with `OPENVERIFY_SMARTY_AUTH_ID` and `OPENVERIFY_SMARTY_AUTH_TOKEN`)
 * or `sandbox` (house numbers 1000-1006); unset means unbound, and the address report's provider
 * fields are then `null` with `provider_not_configured`. A provider receives the normalised
 * components of a US address only, and the addressee only with `send-addressee` (P16). No USPS
 * adapter (decision 21).
 */
import type { AddressVerificationProvider } from '../../ports.js';
import type { ReportProviderOptions } from '../report-options.js';
import { createSandboxAddressVerificationProvider } from './sandbox.js';
import { createSmartyProvider } from './smarty.js';

export { SANDBOX_ADDRESS_SCENARIOS } from './sandbox.js';
export { SMARTY_US_STREET_ORIGIN } from './smarty.js';
export { emptyAddressFields, type AddressVerificationFields } from './fields.js';

/**
 * The provider `name` binds.
 * @throws {Error} for `smarty` without its credentials, naming the variables only.
 */
export function createAddressVerificationProvider(
  name: 'smarty' | 'sandbox',
  options: ReportProviderOptions = {},
): AddressVerificationProvider {
  if (name === 'sandbox') {
    return createSandboxAddressVerificationProvider();
  }
  const credentials = options.credentials?.smarty;
  if (credentials == null) {
    throw new Error('smarty needs its credentials (OPENVERIFY_SMARTY_AUTH_ID, _AUTH_TOKEN)');
  }
  return createSmartyProvider({
    authId: credentials.authId,
    authToken: credentials.authToken,
    outboundHttp: options.outboundHttp,
  });
}
