/**
 * C61.1, C63: the business registers, bound by
 * `OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_{SANDBOX,PRODUCTION}` in the worker. The value is a
 * comma-separated list of `gleif`, `companies-house` and `sec-edgar`, or `sandbox` alone (sandbox
 * environments), or `none`; unset or empty means `gleif`, plus `companies-house` when its key for
 * the environment kind is set and `sec-edgar` when its User-Agent contact is set (F11).
 *
 * Each factory constructs at once, so the worker starts with them bound; the clients make their
 * outbound HTTP clients (C54.6) on their first lookup. The registers of one binding share one
 * pacer and one query cache over the Valkey cache, so their limits and the cache are install-wide
 * (C61.2). `api-kyb` (Workflow 5B Stage 3) built them over `contracts-5b`'s stubs.
 */
import type {
  BusinessRegistryProvider,
  BusinessRegistrySource,
  Clock,
  EnvironmentKind,
  KeyValueCache,
  RateLimiter,
  SandboxBusinessRegistryProvider,
} from '../../ports.js';
import type { OutboundHttp } from '../../http/index.js';
import { ProviderError } from '../errors.js';
import { createCompaniesHouseRegister } from './companies-house.js';
import { createGleifRegister } from './gleif.js';
import { createProviderPacer } from './pacing.js';
import { createRegistryQueryCache } from './query-cache.js';
import { createSandboxRegister } from './sandbox.js';
import { createSecEdgarRegister } from './sec-edgar.js';

/** C61.1: the Companies House keys, read by the worker while a binding names it. Secret. */
export interface CompaniesHouseSettings {
  /** `OPENVERIFY_COMPANIES_HOUSE_API_KEY`: the live register, for production environments. */
  apiKey: string | null;
  /** `OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY`: the Companies House sandbox host. */
  sandboxApiKey: string | null;
}

/** C61.1: SEC EDGAR's required contact (`OPENVERIFY_SEC_EDGAR_USER_AGENT`). */
export interface SecEdgarSettings {
  userAgent: string;
}

export interface BusinessRegistryOptions {
  /** Which environment kind the providers serve (Companies House picks its host and key). */
  environment: EnvironmentKind;
  companiesHouse?: CompaniesHouseSettings | null | undefined;
  secEdgar?: SecEdgarSettings | null | undefined;
  outboundHttp?: OutboundHttp | undefined;
  /** C61.2: the non-personal record cache and the install-wide rate limits. */
  cache?: KeyValueCache | undefined;
  /** Workflow 5C review K4: the worker's GCRA limiter, which paces the registers when bound. */
  rateLimiter?: RateLimiter | undefined;
  clock?: Clock | undefined;
}

/** A register the binding names without the credential it needs (`providers/index.ts` checks first). */
const missingCredential = (source: BusinessRegistrySource): BusinessRegistryProvider => ({
  id: source,
  sandbox: false,
  source,
  lookup: () =>
    Promise.reject(
      new ProviderError(`${source}: its credential is not set`, {
        retryable: false,
        code: `${source.replaceAll('-', '_')}_not_configured`,
      }),
    ),
});

/** The real registers `sources` names, in that order, over one pacer and query cache. */
export function createBusinessRegistryProviders(
  sources: readonly BusinessRegistrySource[],
  options: BusinessRegistryOptions,
): BusinessRegistryProvider[] {
  const { outboundHttp, clock, environment } = options;
  const pacer = createProviderPacer({
    rateLimiter: options.rateLimiter,
    cache: options.cache,
    clock,
  });
  const queryCache = createRegistryQueryCache(options.cache);
  return sources.map((source) => {
    switch (source) {
      case 'gleif':
        return createGleifRegister({ outboundHttp, pacer, queryCache });
      case 'companies-house': {
        const key =
          environment === 'production'
            ? options.companiesHouse?.apiKey
            : options.companiesHouse?.sandboxApiKey;
        return key == null
          ? missingCredential(source)
          : createCompaniesHouseRegister({
              apiKey: key,
              environment,
              outboundHttp,
              pacer,
              queryCache,
            });
      }
      case 'sec-edgar':
        return options.secEdgar == null
          ? missingCredential(source)
          : createSecEdgarRegister({
              userAgent: options.secEdgar.userAgent,
              outboundHttp,
              pacer,
              queryCache,
              clock,
            });
    }
  });
}

/** C61.6: the sandbox register (sandbox environments only). */
export function createSandboxBusinessRegistryProvider(): SandboxBusinessRegistryProvider {
  return createSandboxRegister();
}
