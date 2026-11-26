/**
 * C81, C83: the `adverseMedia` providers, bound by
 * `OPENVERIFY_PROVIDER_ADVERSE_MEDIA_{SANDBOX,PRODUCTION}` in the worker only: `gdelt-doc` (GDELT
 * DOC 2.0, which needs `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`, decision 7) or `sandbox`
 * (names holding `sandbox-media`); unset means unbound, and the media reports error with
 * `provider_not_configured`. The adapter takes the shared GDELT budget (`budget.ts`) through the
 * worker's GCRA limiter and cache, which hold environment ids and times only; no article is ever
 * cached (P03).
 */
import type { AdverseMediaProvider } from '../../ports.js';
import type { ReportProviderOptions } from '../report-options.js';
import { createGdeltBudget } from './budget.js';
import { createGdeltDocProvider, GDELT_CITATION } from './gdelt.js';
import { createSandboxAdverseMediaProvider, SANDBOX_MEDIA_CITATION } from './sandbox.js';

export { GDELT_BUDGET, createGdeltBudget, type GdeltBudget } from './budget.js';
export {
  GDELT_CITATION,
  GDELT_DOC_ORIGIN,
  GDELT_MAX_RESPONSE_BYTES,
  countryCodeOf,
  languageCodeOf,
} from './gdelt.js';
export { GDELT_MAX_RECORDS, gdeltNameTokens, gdeltQuery, gdeltSourceCountry } from './query.js';
export { searchNamesOf } from './request.js';
export { SANDBOX_MEDIA_CITATION, SANDBOX_MEDIA_DOMAIN, SANDBOX_MEDIA_TOKEN } from './sandbox.js';

/** C81.4: the citation a provider's results carry, or `null` for one this version does not know. */
export function mediaCitationOf(providerId: string): string | null {
  return providerId === 'gdelt-doc'
    ? GDELT_CITATION
    : providerId === 'sandbox'
      ? SANDBOX_MEDIA_CITATION
      : null;
}

/**
 * The provider `name` binds.
 * @throws {Error} for `gdelt-doc` without the disclosure acknowledgement, naming the variable.
 */
export function createAdverseMediaProvider(
  name: 'gdelt-doc' | 'sandbox',
  options: ReportProviderOptions = {},
): AdverseMediaProvider {
  if (name === 'sandbox') {
    return createSandboxAdverseMediaProvider(options.clock);
  }
  if (options.credentials?.gdeltAcknowledged !== true) {
    throw new Error('gdelt-doc needs OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true (decision 7)');
  }
  return createGdeltDocProvider({
    outboundHttp: options.outboundHttp,
    budget: createGdeltBudget({
      rateLimiter: options.rateLimiter,
      cache: options.cache,
      clock: options.clock,
    }),
  });
}
