/**
 * C61.4, C63: the domain age provider, bound by `OPENVERIFY_PROVIDER_DOMAIN_AGE_{SANDBOX,
 * PRODUCTION}` in the worker: `rdap` (our client over the IANA bootstrap, through the outbound
 * HTTP client), `sandbox` (sandbox environments, C61.6) or `none`; unset or empty means `rdap`.
 *
 * The factory constructs at once; the RDAP client makes its outbound clients on its first call and
 * paces each RDAP host through the shared cache (C61.4). `api-kyb` (Workflow 5B Stage 3) built it
 * over `contracts-5b`'s stub.
 */
import type { Clock, DomainAgeProvider, KeyValueCache, RateLimiter } from '../../ports.js';
import type { OutboundHttp } from '../../http/index.js';
import { createProviderPacer } from '../business-registry/pacing.js';
import { createRdapDomainAgeProvider } from './rdap.js';
import { createSandboxDomainAgeProvider } from './sandbox.js';

export interface DomainAgeOptions {
  outboundHttp?: OutboundHttp | undefined;
  /** C61.4: the bootstrap and the 24 h registration-date cache, and the per-host rate limit. */
  cache?: KeyValueCache | undefined;
  /** Workflow 5C review K4: the worker's GCRA limiter, which paces each RDAP host when bound. */
  rateLimiter?: RateLimiter | undefined;
  clock?: Clock | undefined;
}

/** The provider `name` binds. */
export function createDomainAgeProvider(
  name: 'rdap' | 'sandbox',
  options: DomainAgeOptions = {},
): DomainAgeProvider {
  if (name === 'sandbox') {
    return createSandboxDomainAgeProvider(options.clock);
  }
  return createRdapDomainAgeProvider({
    outboundHttp: options.outboundHttp,
    cache: options.cache,
    clock: options.clock,
    pacer: createProviderPacer({
      rateLimiter: options.rateLimiter,
      cache: options.cache,
      clock: options.clock,
    }),
  });
}
