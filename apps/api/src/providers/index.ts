/**
 * Provider binding (C35, C44, C63; ADR 0002 §3d, §3e): each A-tier check asks the provider bound
 * for the environment's kind. Configuration names it per kind,
 * `OPENVERIFY_PROVIDER_<KIND>_<SANDBOX|PRODUCTION>`:
 *
 * | Kind | Checks | Values | Read by |
 * |---|---|---|---|
 * | `aamva` | `id_aamva_database_lookup`, the AAMVA type | `sandbox` | API and worker |
 * | `publicFigure` | `id_public_figure_detection` | `sandbox` | worker |
 * | `ageEstimate` | `id_age_inconsistency_detection` | `sandbox` | worker |
 * | `selfieAgeEstimate` | `selfie_age_comparison` | `sandbox` | worker |
 * | `selfiePublicFigure` | `selfie_public_figure_detection` | `sandbox` | worker |
 * | `suspiciousEntity` | `selfie_suspicious_entity_detection` | `sandbox` | worker |
 * | `sms` | phone OTP delivery (C55.10), workflow messages (C126.2) | `twilio`, `sandbox` | API and worker |
 * | `database` | the database comparisons (C59.1) | `sandbox` | API and worker |
 * | `evmRpc` | contract wallets (C57.5) | `json-rpc`, `sandbox` | worker |
 * | `businessRegistry` | the KYB registry checks (C61.1) | a list of `gleif`, `companies-house`, `sec-edgar`; `sandbox`; `none` | worker |
 * | `domainAge` | `business_website_domain_age_detection` (C61.4) | `rdap`, `sandbox`, `none` | worker |
 * | `maliciousWebsite` | `business_website_malicious_website_detection` (C61.5) | `feed-list`, `sandbox` | worker |
 * | `backlink` | `business_website_backlink_detection` (C61.5) | `sandbox` | worker |
 * | `adverseMedia` | the `adverse-media` and `business-adverse-media` reports (C81) | `gdelt-doc`, `sandbox` | worker |
 * | `emailIntelligence` | the `email-address` report's breach fields (C82.1) | `hibp`, `sandbox` | worker |
 * | `phoneIntelligence` | the `phone-number` report's carrier, line type and SIM swap (C82.2) | `twilio-lookup`, `sandbox` | worker |
 * | `addressVerification` | the `address-lookup` report's postal fields (C82.3) | `smarty`, `sandbox` | worker |
 * | `cryptoExposure` | the `crypto-address-watchlist` exposure block (C83) | `sandbox` | worker |
 * | `ipReputation` | the session's `is-proxy` and the `ip-address` report's proxy flag (C93.5) | `mmdb-file`, `sandbox` | API and worker |
 * | `slack` | Send Slack Message (C126.3) | `incoming-webhook`, `sandbox` | worker |
 * | `attachmentScanner` | a case attachment's scan (C135.5; the API reads the name alone, `config.cases`) | `clamd`, `sandbox`, `none` | worker |
 * | `deviceIntegrity` | the session's `integrity` member and the `integrity-decode` job (C211.3, C211.4) | `play-integrity`, `sandbox` | API and worker |
 *
 * C63 (V10): each process reads only the kinds it uses, with their credentials, so a process
 * never needs another's secrets. A `sandbox` value on a `_PRODUCTION` variable, an unknown name
 * or (in `config.ts`) a missing credential stops the process that reads it, without echoing a
 * value. An unset or empty variable leaves the kind unbound: its checks answer
 * `provider_not_configured`. Two kinds are on by default (C61.1, F11, decision 29): unset or empty
 * `businessRegistry` means `gleif`, plus `companies-house` when the Companies House key for that
 * environment kind is set and `sec-edgar` when the EDGAR contact is set; unset or empty
 * `domainAge` means `rdap`. Each takes `none` to be unbound.
 */
import type { OutboundHttp } from '../http/index.js';
import {
  GOVERNMENT_ID_PROVIDER_KINDS,
  SELFIE_PROVIDER_KINDS,
  type BoundProviders,
  type BusinessRegistrySource,
  type Clock,
  type EnvironmentKind,
  type KeyValueCache,
  type RateLimiter,
  type ProviderBindings,
} from '../ports.js';
import { createDatabaseProvider } from './database/index.js';
import { createEvmRpcProvider, type EvmRpcSettings } from './evm-rpc/index.js';
import {
  createSandboxAamvaProvider,
  createSandboxAgeEstimateProvider,
  createSandboxPublicFigureProvider,
  createSandboxSelfieAgeEstimateProvider,
  createSandboxSelfiePublicFigureProvider,
  createSandboxSuspiciousEntityProvider,
} from './sandbox.js';
import { createAttachmentScanner } from './attachment-scanner/index.js';
import { createSlackSender } from './slack/index.js';
import { createSmsSender, type TwilioSettings } from './sms/index.js';
import { createBacklinkProvider } from './backlink/index.js';
import {
  createBusinessRegistryProviders,
  createSandboxBusinessRegistryProvider,
  type CompaniesHouseSettings,
  type SecEdgarSettings,
} from './business-registry/index.js';
import { createDomainAgeProvider } from './domain-age/index.js';
import {
  createMaliciousWebsiteProvider,
  type MaliciousFeedList,
} from './malicious-website/index.js';
import type { ReportProviderCredentials } from '../config.js';
import { createAddressVerificationProvider } from './address-verification/index.js';
import { createAdverseMediaProvider } from './adverse-media/index.js';
import { createCryptoExposureProvider } from './crypto-exposure/index.js';
import { createEmailIntelligenceProvider } from './email-intelligence/index.js';
import { createPhoneIntelligenceProvider } from './phone-intelligence/index.js';
import type { ReportProviderOptions } from './report-options.js';
import {
  createIpReputationProvider,
  type IpReputationProviderOptions,
} from './ip-reputation/index.js';
import {
  createDeviceIntegrityProvider,
  type PlayIntegritySettings,
} from '../services/device-integrity/index.js';

/** C63: the Workflow 5A provider kinds. */
export const PHASE5A_PROVIDER_KINDS = ['sms', 'database', 'evmRpc'] as const;

/** C61, C63: the Workflow 5B provider kinds, all read by the worker. */
export const PHASE5B_PROVIDER_KINDS = [
  'businessRegistry',
  'domainAge',
  'maliciousWebsite',
  'backlink',
] as const;

/** C83: the Phase 6 report provider kinds, all read by the worker. */
export const PHASE6_PROVIDER_KINDS = [
  'adverseMedia',
  'emailIntelligence',
  'phoneIntelligence',
  'addressVerification',
  'cryptoExposure',
] as const;

/**
 * C93.5 (Phase 7, Workflow 7A): `ipReputation`, the one report-era kind read by both the API
 * (session evaluation) and the worker (the `ip-address` report).
 */
export const PHASE7_PROVIDER_KINDS = ['ipReputation'] as const;

/**
 * C126.3, C135.5 (Phase 8): `slack`, read by the worker, where steps run; and `attachmentScanner`,
 * a kind reserved in Workflow 8A, whose port and providers land with Workflow 8B.
 */
export const PHASE8_PROVIDER_KINDS = ['slack', 'attachmentScanner'] as const;

/**
 * C211.4 (Phase 10, Workflow 10B): `deviceIntegrity`, read by both the API (whether the session asks
 * for a token, C211.3) and the worker (the `integrity-decode` job). Unbound by default: no request.
 */
export const PHASE10_PROVIDER_KINDS = ['deviceIntegrity'] as const;

/** Every provider kind: the C35 government ID ports, the C44 selfie ports, then C63's and C83's. */
export const PROVIDER_KINDS = Object.freeze([
  ...GOVERNMENT_ID_PROVIDER_KINDS,
  ...SELFIE_PROVIDER_KINDS,
  ...PHASE5A_PROVIDER_KINDS,
  ...PHASE5B_PROVIDER_KINDS,
  ...PHASE6_PROVIDER_KINDS,
  ...PHASE7_PROVIDER_KINDS,
  ...PHASE8_PROVIDER_KINDS,
  ...PHASE10_PROVIDER_KINDS,
] as const);
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The variable prefix of each provider kind; `_SANDBOX` or `_PRODUCTION` follows. */
export const PROVIDER_ENV_PREFIXES: Readonly<Record<ProviderKind, string>> = Object.freeze({
  aamva: 'OPENVERIFY_PROVIDER_AAMVA',
  publicFigure: 'OPENVERIFY_PROVIDER_PUBLIC_FIGURE',
  ageEstimate: 'OPENVERIFY_PROVIDER_AGE_ESTIMATE',
  selfieAgeEstimate: 'OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE',
  selfiePublicFigure: 'OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE',
  suspiciousEntity: 'OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY',
  sms: 'OPENVERIFY_PROVIDER_SMS',
  database: 'OPENVERIFY_PROVIDER_DATABASE',
  evmRpc: 'OPENVERIFY_PROVIDER_EVM_RPC',
  businessRegistry: 'OPENVERIFY_PROVIDER_BUSINESS_REGISTRY',
  domainAge: 'OPENVERIFY_PROVIDER_DOMAIN_AGE',
  maliciousWebsite: 'OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE',
  backlink: 'OPENVERIFY_PROVIDER_BACKLINK',
  adverseMedia: 'OPENVERIFY_PROVIDER_ADVERSE_MEDIA',
  emailIntelligence: 'OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE',
  phoneIntelligence: 'OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE',
  addressVerification: 'OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION',
  cryptoExposure: 'OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE',
  ipReputation: 'OPENVERIFY_PROVIDER_IP_REPUTATION',
  slack: 'OPENVERIFY_PROVIDER_SLACK',
  attachmentScanner: 'OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER',
  deviceIntegrity: 'OPENVERIFY_PROVIDER_DEVICE_INTEGRITY',
});

/**
 * Every single provider name this version can bind (every kind but `businessRegistry`, which
 * binds a list of registers); which kind takes which is below.
 */
export const PROVIDER_NAMES = [
  'sandbox',
  'twilio',
  'json-rpc',
  'rdap',
  'feed-list',
  // C83 (Phase 6).
  'gdelt-doc',
  'hibp',
  'twilio-lookup',
  'smarty',
  // C93.5 (Phase 7).
  'mmdb-file',
  // C126.3, C135.5 (Phase 8).
  'incoming-webhook',
  'clamd',
  // C211.4 (Phase 10).
  'play-integrity',
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

/** C61.1: the real registers a `businessRegistry` binding may list, in this order. */
export const BUSINESS_REGISTRY_SOURCES: readonly BusinessRegistrySource[] = Object.freeze([
  'gleif',
  'companies-house',
  'sec-edgar',
]);

/**
 * C61.1: a `businessRegistry` binding: the real registers bound (the job asks the national one
 * for the business's country first, then GLEIF), or the sandbox register alone.
 */
export type BusinessRegistryBinding = readonly BusinessRegistrySource[] | 'sandbox';

/** The value that unbinds a kind that is on by default (C61.1). */
export const NONE_PROVIDER = 'none';

/** C61.1: the Companies House key of each environment kind, and the EDGAR contact. */
export const COMPANIES_HOUSE_KEY_ENV: Readonly<Record<EnvironmentKind, string>> = Object.freeze({
  production: 'OPENVERIFY_COMPANIES_HOUSE_API_KEY',
  sandbox: 'OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY',
});
export const SEC_EDGAR_USER_AGENT_ENV = 'OPENVERIFY_SEC_EDGAR_USER_AGENT';

/** The deterministic provider of every kind, which configuration never binds to production. */
export const SANDBOX_PROVIDER = 'sandbox';

/** C63: the names each kind takes; `sandbox` only for sandbox environments. */
export const PROVIDER_NAMES_BY_KIND: Readonly<
  Record<ProviderKind, readonly (ProviderName | BusinessRegistrySource)[]>
> = Object.freeze({
  aamva: ['sandbox'],
  publicFigure: ['sandbox'],
  ageEstimate: ['sandbox'],
  selfieAgeEstimate: ['sandbox'],
  selfiePublicFigure: ['sandbox'],
  suspiciousEntity: ['sandbox'],
  sms: ['twilio', 'sandbox'],
  database: ['sandbox'],
  evmRpc: ['json-rpc', 'sandbox'],
  businessRegistry: [...BUSINESS_REGISTRY_SOURCES, 'sandbox'],
  domainAge: ['rdap', 'sandbox'],
  maliciousWebsite: ['feed-list', 'sandbox'],
  backlink: ['sandbox'],
  adverseMedia: ['gdelt-doc', 'sandbox'],
  emailIntelligence: ['hibp', 'sandbox'],
  phoneIntelligence: ['twilio-lookup', 'sandbox'],
  addressVerification: ['smarty', 'sandbox'],
  cryptoExposure: ['sandbox'],
  ipReputation: ['mmdb-file', 'sandbox'],
  slack: ['incoming-webhook', 'sandbox'],
  attachmentScanner: ['clamd', 'sandbox'],
  deviceIntegrity: ['play-integrity', 'sandbox'],
});

/**
 * The kinds that take {@link NONE_PROVIDER} as a value: unset means the same for the scanner
 * (decision 66), so an operator can write the default down.
 */
const TAKES_NONE: ReadonlySet<ProviderKind> = new Set(['domainAge', 'attachmentScanner']);

/** The two processes that read provider bindings (C63, V10). */
export type ProviderProcess = 'api' | 'worker';

/**
 * C63: the kinds each process reads. The API sends the codes (`sms`), runs the publish rules
 * (`database`, `aamva`), evaluates each session's network (`ipReputation`, C93.5) and asks for a
 * device's integrity token (`deviceIntegrity`, C211.3); the worker
 * runs every check, report and workflow step, so it reads every kind (C126.6, decision 76: `sms` and
 * `slack` for workflow messages, a C63 amendment that holds for those alone).
 */
export const PROCESS_PROVIDER_KINDS: Readonly<Record<ProviderProcess, readonly ProviderKind[]>> =
  Object.freeze({
    api: ['sms', 'database', 'aamva', 'ipReputation', 'deviceIntegrity'],
    worker: PROVIDER_KINDS,
  });

/**
 * Which provider is bound to each kind of check, per environment kind; `null` (or a kind left
 * out: settings written before a phase, or a kind this process does not read) is unbound.
 */
export type KindSettings = Readonly<
  Partial<Record<Exclude<ProviderKind, 'businessRegistry'> | Phase5BKind, ProviderName | null>> & {
    businessRegistry?: BusinessRegistryBinding | null;
  }
>;
type Phase5BKind = Exclude<(typeof PHASE5B_PROVIDER_KINDS)[number], 'businessRegistry'>;
export type ProviderSettings = Readonly<Record<EnvironmentKind, KindSettings>>;

const UNBOUND: KindSettings = Object.freeze(
  Object.fromEntries(PROVIDER_KINDS.map((kind) => [kind, null])) as Record<ProviderKind, null>,
);

/** No provider bound anywhere. */
export const NO_PROVIDERS: ProviderSettings = Object.freeze({
  sandbox: UNBOUND,
  production: UNBOUND,
});

/** The variable that binds `kind` in environments of `environment` kind. */
export function providerVariable(kind: ProviderKind, environment: EnvironmentKind) {
  return `${PROVIDER_ENV_PREFIXES[kind]}_${environment.toUpperCase()}`;
}

export { ProviderError } from './errors.js';

const SANDBOX_IN_PRODUCTION = 'a sandbox provider cannot be bound to production environments';

/** The issue of a value `kind` does not take, naming the names it does. */
function unknownProvider(kind: ProviderKind): string {
  if (kind === 'businessRegistry') {
    return 'must be sandbox alone, none, or a list of gleif, companies-house and sec-edgar';
  }
  const names = PROVIDER_NAMES_BY_KIND[kind];
  const none = TAKES_NONE.has(kind) ? ', none,' : ',';
  if (names.length === 1) {
    return `must be ${names[0] ?? SANDBOX_PROVIDER}, the only provider this version ships${none} or unset`;
  }
  return `must be ${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? SANDBOX_PROVIDER}${none} or unset`;
}

/** Whether `kind` takes the single provider `value`. */
const takes = (kind: ProviderKind, value: string): boolean =>
  kind !== 'businessRegistry' &&
  (PROVIDER_NAMES_BY_KIND[kind] as readonly string[]).includes(value);

/** Whether the variable holds anything but blanks (a credential's presence, never its value). */
const present = (env: NodeJS.ProcessEnv, name: string): boolean => (env[name] ?? '').trim() !== '';

/**
 * C61.1: the `businessRegistry` binding a value names, or the default when unset or empty:
 * `gleif`, plus `companies-house` with the key of `environment`, plus `sec-edgar` with its
 * contact. An issue (and `null`) for anything else.
 */
function readBusinessRegistry(
  env: NodeJS.ProcessEnv,
  environment: EnvironmentKind,
  value: string,
  issue: (problem: string) => void,
): BusinessRegistryBinding | null {
  if (value === '') {
    return BUSINESS_REGISTRY_SOURCES.filter(
      (source) =>
        source === 'gleif' ||
        (source === 'companies-house' && present(env, COMPANIES_HOUSE_KEY_ENV[environment])) ||
        (source === 'sec-edgar' && present(env, SEC_EDGAR_USER_AGENT_ENV)),
    );
  }
  if (value === NONE_PROVIDER) {
    return null;
  }
  if (value === SANDBOX_PROVIDER) {
    if (environment === 'production') {
      issue(SANDBOX_IN_PRODUCTION);
      return null;
    }
    return SANDBOX_PROVIDER;
  }
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (names.some((name) => !(BUSINESS_REGISTRY_SOURCES as readonly string[]).includes(name))) {
    issue(unknownProvider('businessRegistry'));
    return null;
  }
  return BUSINESS_REGISTRY_SOURCES.filter((source) => names.includes(source));
}

/** C61.1: the kinds that are on by default, with what unset or empty binds. */
const DEFAULT_ON: Readonly<Partial<Record<ProviderKind, ProviderName>>> = Object.freeze({
  domainAge: 'rdap',
});

/**
 * Reads the provider bindings of `process`'s kinds (every kind when omitted) from the
 * environment: one `<variable>: <problem>` issue per invalid value, a sandbox provider bound to
 * production among them (ADR 0002 §3d). A value is never echoed: a mistyped one could be a
 * credential.
 */
export function readProviderSettings(
  env: NodeJS.ProcessEnv,
  process?: ProviderProcess,
): {
  settings: ProviderSettings;
  issues: string[];
} {
  const kinds = process === undefined ? PROVIDER_KINDS : PROCESS_PROVIDER_KINDS[process];
  const issues: string[] = [];
  const read = (environment: EnvironmentKind) =>
    Object.fromEntries(
      kinds.map((kind) => {
        const variable = providerVariable(kind, environment);
        const value = env[variable]?.trim().toLowerCase() ?? '';
        const issue = (problem: string) => {
          issues.push(`${variable}: ${problem}`);
        };
        if (kind === 'businessRegistry') {
          return [kind, readBusinessRegistry(env, environment, value, issue)];
        }
        const defaulted = DEFAULT_ON[kind];
        if (value === '') {
          return [kind, defaulted ?? null];
        }
        if (TAKES_NONE.has(kind) && value === NONE_PROVIDER) {
          return [kind, null];
        }
        if (!takes(kind, value)) {
          issue(unknownProvider(kind));
          return [kind, null];
        }
        if (environment === 'production' && value === SANDBOX_PROVIDER) {
          issue(SANDBOX_IN_PRODUCTION);
          return [kind, null];
        }
        return [kind, value as ProviderName];
      }),
    ) as KindSettings;
  const sandbox = read('sandbox');
  const production = read('production');
  return { settings: { sandbox, production }, issues };
}

/** What the real providers need: their credentials, the outbound client and the sandbox sink. */
export interface ProviderBindingOptions {
  clock?: Clock | undefined;
  /** C55.10, C126.6: Twilio's credentials, read by the API and by the worker. */
  twilio?: TwilioSettings | null | undefined;
  /** C57.5: the EVM node URLs, read by the worker only. */
  evmRpc?: EvmRpcSettings | null | undefined;
  outboundHttp?: OutboundHttp | undefined;
  /** The sandbox SMS sink (C55.11); the KYB caches and limits (C61.2, C61.4, C61.5). */
  cache?: KeyValueCache | undefined;
  /**
   * Workflow 5C review K4: the worker's GCRA limiter, which paces the registers and RDAP
   * install-wide when bound (the cache slots otherwise).
   */
  rateLimiter?: RateLimiter | undefined;
  /** C61.1: the Companies House keys, read by the worker only. */
  companiesHouse?: CompaniesHouseSettings | null | undefined;
  /** C61.1: SEC EDGAR's User-Agent contact, read by the worker only. */
  secEdgar?: SecEdgarSettings | null | undefined;
  /** C61.5: the operator's feeds (`data/malicious-feeds.json`), for `feed-list`. */
  maliciousFeeds?: MaliciousFeedList | undefined;
  /** C83: the report providers' credentials (`ApiConfig.reportProviders`), worker only. */
  reportProviders?: ReportProviderCredentials | undefined;
  /** C93.5: the `mmdb-file` adapter's file (`OPENVERIFY_IP_REPUTATION_MMDB_PATH`), both processes. */
  ipReputation?: IpReputationProviderOptions | undefined;
  /** C211.4 (Workflow 10B): `play-integrity`'s settings, for the worker's decode (`config.ts`). */
  playIntegrity?: PlayIntegritySettings | null | undefined;
  /** C135.5 (Workflow 8B): clamd's socket (`OPENVERIFY_CLAMD_SOCKET`), read by the worker only. */
  clamdSocket?: string | null | undefined;
}

/**
 * C61.5: whether either environment kind binds `maliciousWebsite` to `feed-list`, so the worker
 * loads the feed list (and schedules its refresh when it holds a feed).
 */
export function bindsMaliciousFeedList(settings: ProviderSettings): boolean {
  return (
    settings.sandbox.maliciousWebsite === 'feed-list' ||
    settings.production.maliciousWebsite === 'feed-list'
  );
}

/**
 * The provider instances of `settings`, per environment kind.
 * @throws {Error} when a sandbox provider is bound to production (ADR 0002 §3d), a kind is bound
 *   to a name it does not take, or a real provider lacks its credentials (C63).
 */
export function createProviderBindings(
  settings: ProviderSettings,
  options: ProviderBindingOptions = {},
): ProviderBindings {
  const { clock } = options;
  const smsSender = (name: ProviderName) => {
    if (name === 'twilio' && options.twilio == null) {
      throw new Error('twilio needs its credentials (OPENVERIFY_TWILIO_*)');
    }
    return createSmsSender(name === 'twilio' ? 'twilio' : 'sandbox', {
      twilio: options.twilio,
      outboundHttp: options.outboundHttp,
      cache: options.cache,
      clock,
    });
  };
  const evmRpc = (name: ProviderName) => {
    if (name === 'json-rpc' && options.evmRpc == null) {
      throw new Error('json-rpc needs its node URLs (OPENVERIFY_EVM_RPC_URLS)');
    }
    return createEvmRpcProvider(name === 'json-rpc' ? 'json-rpc' : 'sandbox', {
      settings: options.evmRpc,
      outboundHttp: options.outboundHttp,
    });
  };
  /** C61.1: the registers a binding names, each with its credential for `environment`. */
  const registers = (environment: EnvironmentKind, binding: BusinessRegistryBinding) => {
    if (binding === SANDBOX_PROVIDER) {
      if (environment === 'production') {
        throw new Error(SANDBOX_IN_PRODUCTION);
      }
      return createSandboxBusinessRegistryProvider();
    }
    const key =
      environment === 'production'
        ? options.companiesHouse?.apiKey
        : options.companiesHouse?.sandboxApiKey;
    if (binding.includes('companies-house') && key == null) {
      throw new Error(`companies-house needs its key (${COMPANIES_HOUSE_KEY_ENV[environment]})`);
    }
    if (binding.includes('sec-edgar') && options.secEdgar == null) {
      throw new Error(`sec-edgar needs its contact (${SEC_EDGAR_USER_AGENT_ENV})`);
    }
    return createBusinessRegistryProviders(binding, {
      environment,
      companiesHouse: options.companiesHouse,
      secEdgar: options.secEdgar,
      outboundHttp: options.outboundHttp,
      cache: options.cache,
      rateLimiter: options.rateLimiter,
      clock,
    });
  };
  const reportOptions: ReportProviderOptions = {
    credentials: options.reportProviders,
    outboundHttp: options.outboundHttp,
    cache: options.cache,
    rateLimiter: options.rateLimiter,
    clock,
  };
  const bind = (environment: EnvironmentKind): BoundProviders => {
    const { businessRegistry, ...single } = settings[environment];
    const bound = settings[environment];
    for (const [kind, name] of Object.entries(single) as [ProviderKind, ProviderName | null][]) {
      if (name == null) {
        continue;
      }
      if (!takes(kind, name)) {
        throw new Error(`${kind} cannot be bound to ${name}`);
      }
      if (environment === 'production' && name === SANDBOX_PROVIDER) {
        throw new Error(SANDBOX_IN_PRODUCTION);
      }
    }
    return {
      ...(bound.aamva == null ? {} : { aamva: createSandboxAamvaProvider() }),
      ...(bound.publicFigure == null ? {} : { publicFigure: createSandboxPublicFigureProvider() }),
      ...(bound.ageEstimate == null
        ? {}
        : { ageEstimate: createSandboxAgeEstimateProvider({ clock }) }),
      ...(bound.selfieAgeEstimate == null
        ? {}
        : { selfieAgeEstimate: createSandboxSelfieAgeEstimateProvider({ clock }) }),
      ...(bound.selfiePublicFigure == null
        ? {}
        : { selfiePublicFigure: createSandboxSelfiePublicFigureProvider() }),
      ...(bound.suspiciousEntity == null
        ? {}
        : { suspiciousEntity: createSandboxSuspiciousEntityProvider() }),
      ...(bound.sms == null ? {} : { sms: smsSender(bound.sms) }),
      ...(bound.database == null ? {} : { database: createDatabaseProvider('sandbox') }),
      ...(bound.evmRpc == null ? {} : { evmRpc: evmRpc(bound.evmRpc) }),
      ...(businessRegistry == null
        ? {}
        : { businessRegistry: registers(environment, businessRegistry) }),
      ...(bound.domainAge == null
        ? {}
        : {
            domainAge: createDomainAgeProvider(bound.domainAge === 'rdap' ? 'rdap' : 'sandbox', {
              outboundHttp: options.outboundHttp,
              cache: options.cache,
              rateLimiter: options.rateLimiter,
              clock,
            }),
          }),
      ...(bound.maliciousWebsite == null
        ? {}
        : {
            maliciousWebsite: createMaliciousWebsiteProvider(
              bound.maliciousWebsite === 'feed-list' ? 'feed-list' : 'sandbox',
              { feeds: options.maliciousFeeds, cache: options.cache, clock },
            ),
          }),
      ...(bound.backlink == null ? {} : { backlink: createBacklinkProvider('sandbox') }),
      // C83 (Phase 6): the report providers, built by `api-providers` behind their factories.
      ...(bound.adverseMedia == null
        ? {}
        : {
            adverseMedia: createAdverseMediaProvider(
              bound.adverseMedia === 'gdelt-doc' ? 'gdelt-doc' : 'sandbox',
              reportOptions,
            ),
          }),
      ...(bound.emailIntelligence == null
        ? {}
        : {
            emailIntelligence: createEmailIntelligenceProvider(
              bound.emailIntelligence === 'hibp' ? 'hibp' : 'sandbox',
              reportOptions,
            ),
          }),
      ...(bound.phoneIntelligence == null
        ? {}
        : {
            phoneIntelligence: createPhoneIntelligenceProvider(
              bound.phoneIntelligence === 'twilio-lookup' ? 'twilio-lookup' : 'sandbox',
              reportOptions,
            ),
          }),
      ...(bound.addressVerification == null
        ? {}
        : {
            addressVerification: createAddressVerificationProvider(
              bound.addressVerification === 'smarty' ? 'smarty' : 'sandbox',
              reportOptions,
            ),
          }),
      ...(bound.cryptoExposure == null
        ? {}
        : { cryptoExposure: createCryptoExposureProvider('sandbox', reportOptions) }),
      // C126.3 (Phase 8): the worker's, built by `api-egress`.
      ...(bound.slack == null
        ? {}
        : {
            slack: createSlackSender(
              bound.slack === 'incoming-webhook' ? 'incoming-webhook' : 'sandbox',
              { outboundHttp: options.outboundHttp, cache: options.cache, clock },
            ),
          }),
      // C135.5 (Workflow 8B): the worker's scanner, built by `api-case-files`; `none` binds nothing,
      // and the checks above refuse a sandbox one for production.
      ...(bound.attachmentScanner == null
        ? {}
        : {
            attachmentScanner: createAttachmentScanner(
              bound.attachmentScanner === 'clamd' ? 'clamd' : 'sandbox',
              { clamdSocket: options.clamdSocket ?? null },
            ),
          }),
      // C93.5 (Phase 7): the session evaluation's and the report's provider, built by `api-network`.
      ...(bound.ipReputation == null
        ? {}
        : {
            ipReputation: createIpReputationProvider(
              bound.ipReputation === 'mmdb-file' ? 'mmdb-file' : 'sandbox',
              { mmdbPath: options.ipReputation?.mmdbPath ?? null },
            ),
          }),
      // C211.4 (Workflow 10B): the session member's and the decode's provider, built by
      // `api-integrity`; unbound means no request (C211.1).
      ...(bound.deviceIntegrity == null
        ? {}
        : {
            deviceIntegrity: createDeviceIntegrityProvider(
              bound.deviceIntegrity === 'play-integrity' ? 'play-integrity' : 'sandbox',
              { outboundHttp: options.outboundHttp, clock, playIntegrity: options.playIntegrity },
            ),
          }),
    };
  };
  return { sandbox: bind('sandbox'), production: bind('production') };
}
