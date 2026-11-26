/**
 * The API's settings, parsed from environment variables with zod at startup. Every problem is
 * reported at once, naming the variable but never echoing its value, which may be a secret.
 */
import { isIPv6 } from 'node:net';
import {
  CONSOLE_SESSION_TIMEOUTS,
  MIGRATE_LOCK,
  OTP_SMS_MAX_PER_HOUR,
  QUEUE_IN_FLIGHT_CAP,
  RATE_LIMIT_DEFAULTS_PER_MINUTE,
  WATCHLIST_UN_OPT_IN_SWITCH,
  WORKER_HEARTBEAT,
  safeUrl,
} from '@openverify/contracts';
import { EVM_CHAIN_ID_PATTERN } from '@openverify/core';
import {
  BLIND_INDEX_KEY_ENV,
  BlindIndexKeyError,
  blindIndexKeyFromEnv,
  KEK_ENV,
  KEK_PREVIOUS_ENV,
  keyringFromEnv,
  KeyringError,
  type Keyring,
} from '@openverify/db';
import { parseCodeRunnerTcpTarget } from '@openverify/workflow-engine/code-runner';
import { z } from 'zod';
import type { FlowServerTokens } from './auth/flow-server-token.js';
import type { StartupWarning } from './config/startup-warnings.js';
import { CONFIG_REGISTRY } from './config-registry.js';
import { resolveSecretFiles } from './config/secret-files.js';
import { readStoreTls, TLS_STORES, type StoreTlsSettings } from './config/store-tls.js';
import type { InternalListen } from './http/internal-listener.js';
import type { EvmRpcSettings } from './providers/evm-rpc/index.js';
import {
  PROCESS_PROVIDER_KINDS,
  readProviderSettings,
  type PHASE6_PROVIDER_KINDS,
  type ProviderProcess,
  type ProviderSettings,
} from './providers/index.js';
import type { TwilioSettings } from './providers/sms/index.js';
import type { PlayIntegritySettings } from './services/device-integrity/play-integrity.js';
import type {
  CompaniesHouseSettings,
  SecEdgarSettings,
} from './providers/business-registry/index.js';
// api-operators: begin
import {
  OPERATOR_SETTING_SCHEMAS,
  resolveOperatorSettings,
  trustProxySchema,
  type OperatorSettings,
  type TrustProxySetting,
} from './operator-auth/settings.js';
// api-operators: end

export const APP_MODES = ['production', 'development', 'test'] as const;
export type AppMode = (typeof APP_MODES)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** `development` or `test` from NODE_ENV; anything else is `production`. */
export function defaultAppMode(nodeEnv: string | undefined): AppMode {
  return nodeEnv === 'development' || nodeEnv === 'test' ? nodeEnv : 'production';
}

export interface S3Settings {
  /** S3-compatible endpoint such as RustFS; `undefined` means AWS. */
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** C123.3: where Evaluate Code runs: a pool of child processes, or the `code-runner` service. */
export type WorkflowCodeRunnerSetting =
  | { kind: 'pool' }
  | { kind: 'socket'; path: string }
  /**
   * C263.6 (Workflow 11C): the runner as its own service; `token` is OPENVERIFY_CODE_RUNNER_TOKEN,
   * required in the worker and `null` in the API, which never connects.
   */
  | { kind: 'tcp'; host: string; port: number; token: string | null };

/** C143.8 (Workflow 8A). */
export interface WorkflowSettings {
  /** `OPENVERIFY_WORKFLOW_CODE_ENABLED` (decision 30). */
  codeEnabled: boolean;
  /** `OPENVERIFY_WORKFLOW_CODE_RUNNER`: `pool`, `socket:<path>` or `tcp:<host>:<port>`. */
  codeRunner: WorkflowCodeRunnerSetting;
  /** `OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK` (C124.3): sandbox receivers, never production. */
  httpAllowLoopback: boolean;
  /** `OPENVERIFY_NAT64_PREFIXES` (C124.3). */
  nat64Prefixes: readonly string[];
  /** `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP` (C117.8): an environment's default, overridable by it. */
  inFlightCap: number;
  /**
   * C122.5: whether `OPENVERIFY_PROVIDER_SLACK_{SANDBOX,PRODUCTION}` name a sender, by name alone.
   * The worker binds and validates them; the API only says whether a Slack step can run.
   */
  slackBound: Readonly<Record<'sandbox' | 'production', boolean>>;
}

/**
 * C135.5 (Workflow 8B (F)): the attachment scanner each environment kind binds, by name alone. The
 * worker binds and runs it; the API sets an upload `pending` or `not_scanned` and applies the serving
 * rules from this fact (Stage 1b amendment 52's pattern).
 */
export interface CaseSettings {
  /** `OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_{SANDBOX,PRODUCTION}`; `none` and unset read `null`. */
  attachmentScanners: Readonly<Record<'sandbox' | 'production', 'sandbox' | 'clamd' | null>>;
}

const ATTACHMENT_SCANNER_ENV = {
  sandbox: 'OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX',
  production: 'OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION',
} as const;

/**
 * C135.5 (decision 66, ADR 0002 §3d): the scanner each environment kind binds, by name. `none` and
 * unset read `null`; a name no scanner takes, and the sandbox scanner for production, are refused
 * without quoting the value, as the worker's binding refuses them.
 */
function readAttachmentScanners(
  env: NodeJS.ProcessEnv,
  issues: string[],
): CaseSettings['attachmentScanners'] {
  const read = (kind: 'sandbox' | 'production'): 'sandbox' | 'clamd' | null => {
    const name = ATTACHMENT_SCANNER_ENV[kind];
    const value = env[name] ?? '';
    if (value === '' || value === 'none') {
      return null;
    }
    if (value !== 'sandbox' && value !== 'clamd') {
      issues.push(`${name}: must be clamd, sandbox or none`);
      return null;
    }
    if (kind === 'production' && value === 'sandbox') {
      issues.push(`${name}: a sandbox provider cannot be bound to production environments`);
      return null;
    }
    return value;
  };
  return { sandbox: read('sandbox'), production: read('production') };
}

export interface ApiConfig {
  mode: AppMode;
  host: string;
  port: number;
  logLevel: LogLevel;
  // api-operators: begin
  /**
   * Fastify `trustProxy` (C15): `false`, a hop count, or the addresses and CIDR ranges of
   * trusted proxies, so `request.ip` is the client's. `true` trusts every proxy.
   */
  trustProxy: TrustProxySetting;
  /** C15 operator settings: dashboard links, the BFF token, WebAuthn and email. */
  operators: OperatorSettings;
  // api-operators: end
  databaseUrl: string;
  /** BullMQ (Valkey) connection. */
  redisUrl: string;
  s3: S3Settings;
  /** KEKs for envelope encryption, from `OPENVERIFY_KEK` and `OPENVERIFY_KEK_PREVIOUS`. */
  keyring: Keyring;
  /** HMAC key of API key hashes (`OPENVERIFY_API_KEY_PEPPER`), as UTF-8 bytes. */
  apiKeyPepper: Uint8Array;
  /**
   * HMAC key of the identification-number blind index (`OPENVERIFY_BLIND_INDEX_KEY`, C31.8):
   * 32 bytes, a separate secret from the KEK.
   */
  blindIndexKey: Uint8Array;
  /** Base of the hosted-flow links returned by `POST /inquiries/:id/resume`. */
  flowPublicUrl: string;
  /** Browser origins allowed to call the flow API; nothing else gets CORS. */
  flowCorsOrigins: string[];
  /**
   * C157.2, C174.7 (Workflow 9A Stage 1b (F)): `OPENVERIFY_FLOW_SERVER_TOKEN` (at least 32 bytes)
   * and, during a rotation, `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS`; `null` when the flow server is
   * not configured, so the internal embed-policy route accepts nothing. Secret.
   */
  flowServerTokens: FlowServerTokens | null;
  vision: { url: string; serviceToken: string };
  /** C12 rate limits: `api` requests per minute per API key or user session. */
  rateLimits: { apiPerMinute: number };
  /** C143.8 (Workflow 8A): the engine's install settings. */
  workflows: WorkflowSettings;
  /** C135.5 (Workflow 8B): the case settings both processes read. */
  cases: CaseSettings;
  /** C72.5 (P09, V09): the per-environment report limits. */
  reports: ReportLimits;
  /** C83: the report providers' credentials, read by the worker when their kind is bound. */
  reportProviders: ReportProviderCredentials;
  /**
   * C211.4 (Workflow 10B): `play-integrity`'s settings (`OPENVERIFY_PLAY_INTEGRITY_*`), read by the
   * worker, which decodes, while either environment kind binds `deviceIntegrity` to it; `null`
   * otherwise. The service account's key is a secret, never logged.
   */
  playIntegrity: PlayIntegritySettings | null;
  /** C63: the process this configuration was read for; each reads only its own providers. */
  process: ProviderProcess;
  /**
   * C35, C44, C63: the provider bound to each A-tier kind this process reads, per environment
   * kind, from `OPENVERIFY_PROVIDER_<KIND>_<SANDBOX|PRODUCTION>`; `null` when none.
   */
  providers: ProviderSettings;
  /**
   * C55.10, C126.6: Twilio's credentials (`OPENVERIFY_TWILIO_*`), read by the API and the worker
   * (decision 76) when `sms` is bound to `twilio`; `null` otherwise. Secret.
   */
  twilio: TwilioSettings | null;
  /**
   * C135.5, C143.8: clamd's socket (`OPENVERIFY_CLAMD_SOCKET`), read by the worker when
   * `attachmentScanner` is bound to `clamd`; `null` otherwise. Workflow 8B reads it.
   */
  clamdSocket: string | null;
  /**
   * C57.5: the EVM node URLs (`OPENVERIFY_EVM_RPC_URLS`) and whether they may be on a private
   * network (`OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS`, decision 22), read by the worker when
   * `evmRpc` is bound to `json-rpc`; `null` otherwise. The URLs are secret.
   */
  evmRpc: EvmRpcSettings | null;
  /**
   * C55.7: the install ceiling of an environment's `otp-sms-max-per-hour`
   * (`OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`, default 1,000).
   */
  otpSmsMaxPerHourCeiling: number;
  /**
   * C61.1: the Companies House keys (`OPENVERIFY_COMPANIES_HOUSE_API_KEY`, `_SANDBOX_API_KEY`),
   * read by the worker when `businessRegistry` names `companies-house`; `null` otherwise. Secret.
   */
  companiesHouse: CompaniesHouseSettings | null;
  /**
   * C61.1: SEC EDGAR's User-Agent contact (`OPENVERIFY_SEC_EDGAR_USER_AGENT`), read by the worker
   * when `businessRegistry` names `sec-edgar`; `null` otherwise.
   */
  secEdgar: SecEdgarSettings | null;
  /** C62.7: the trust-store sync's settings. */
  nfc: NfcSettings;
  /** C76 (Phase 6): the watchlist settings every process reads. */
  watchlists: WatchlistSettings;
  /** C92, C93.5 (Phase 7, Workflow 7A): the network data settings. */
  network: NetworkSettings;
  /** C96.3, C107.8 (Workflow 7A): the device handoff settings the API reads. */
  handoff: HandoffSettings;
  /** C231.10 (Phase 11, Workflow 11A; decision 71): whether this install serves Connect. */
  connect: ConnectInstallSettings;
  // foundation-11b: begin (Workflow 11B Stage 1b common; C245-C255, Stage 1a amendment 25)
  /** C245.1: the console's idle and absolute session limits. */
  consoleSessions: ConsoleSessionSettings;
  /**
   * C247.1: `OPENVERIFY_API_KEY_PEPPER_PREVIOUS`, at most two earlier peppers (UTF-8 bytes, each at
   * least 32), tried after the current one; empty when unset. Secret.
   */
  apiKeyPepperPrevious: readonly Uint8Array[];
  /** C248.3: the SSO settings the install sets. */
  sso: SsoInstallSettings;
  /** C249.1: the data stores' TLS settings (`OPENVERIFY_*_CA_FILE`), from `config/store-tls.ts`. */
  storeTls: StoreTlsSettings;
  /** C250.2: the worker's heartbeat file (`OPENVERIFY_WORKER_HEARTBEAT_FILE`). */
  workerHeartbeatFile: string;
  /** C250.3: `OPENVERIFY_INTERNAL_LISTEN`, or `null` when the internal routes stay public. */
  internalListen: InternalListen | null;
  /** C251.2: `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`, the install ceiling of every queue cap. */
  queueInFlightCapMax: number;
  /**
   * C254.1 (Q10 granted 2026-11-21): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, `true` by default
   * (an environment admin may opt in with an audited acknowledgement); an install that sets it
   * `false` locks the list (every opt-in 409, `un-sc` disabled, as Phase 6 left it).
   */
  watchlistUnOptInAllowed: boolean;
  /** C255.1: `OPENVERIFY_HSTS_MAX_AGE` in seconds; 0 sends no HSTS header. */
  hstsMaxAge: number;
  /** C249.1, C249.2: what the process logs once at start (never a value). */
  startupWarnings: readonly StartupWarning[];
  // foundation-11b: end
}

/** C245.1 (decision 9): the console's session limits, in seconds. */
export interface ConsoleSessionSettings {
  /**
   * `OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS` (300-86,400, default 1,800; provisional: 30 minutes,
   * decision 9): a session expires after this long without an authenticated request.
   */
  idleTimeoutSeconds: number;
  /**
   * `OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS` (3,600-86,400, default 43,200, the former
   * `USER_SESSION_TOKEN_TTL_SECONDS`; at least the idle limit): a session's whole lifetime.
   */
  absoluteTimeoutSeconds: number;
}

/** C248.3 (review P19): the install's SSO settings. */
export interface SsoInstallSettings {
  /**
   * `OPENVERIFY_SSO_PRIVATE_ISSUERS`: exact issuer URLs (at most 20) the SSRF guard may reach on a
   * private address in production; an audited install setting no tenant can change. Empty when
   * unset.
   */
  privateIssuers: readonly string[];
}

/**
 * C231.10 (Phase 11, Workflow 11A; decision 71): Connect is off unless the install allows it.
 * `OPENVERIFY_CONNECT_ENABLED` (default `false`: the images and the chart; `true` in the development
 * `.env.example` and the e2e stack). While it is `false` every Connect route answers the generic 404
 * and a `share_consent` step fails publish (`share_consent_connect_disabled`). The API and the
 * worker read it the same way.
 */
export interface ConnectInstallSettings {
  enabled: boolean;
}

/** C96.3, C107.8 (Workflow 7A): the device handoff settings. */
export interface HandoffSettings {
  /**
   * The email and SMS handoff sends an environment may make per hour
   * (`OPENVERIFY_HANDOFF_SENDS_PER_HOUR`, default 200); the budget fails closed.
   */
  sendsPerHour: number;
}

/** C96.3: the default of `OPENVERIFY_HANDOFF_SENDS_PER_HOUR` (ours, provisional). */
export const DEFAULT_HANDOFF_SENDS_PER_HOUR = 200;
/** The most `OPENVERIFY_HANDOFF_SENDS_PER_HOUR` takes (ours). */
const MAX_HANDOFF_SENDS_PER_HOUR = 100_000;
const HANDOFF_SENDS_MESSAGE = `must be a whole number of sends from 1 to ${String(MAX_HANDOFF_SENDS_PER_HOUR)}`;

/** C92.2, C92.5, C93.5 (Workflow 7A): the network data settings. */
export interface NetworkSettings {
  /**
   * `OPENVERIFY_NETWORK_SOURCES_DISABLED`: manifest source ids turned off, each once, in the order
   * given; read the same way by every process (C92.5).
   */
  sourcesDisabled: readonly string[];
  /**
   * `OPENVERIFY_NETWORK_SOURCES_ENABLED`: sources the manifest leaves off that the operator turns on
   * (`dbip-city-lite`, `azure-service-tags`, `apple-private-relay`); read the same way.
   */
  sourcesEnabled: readonly string[];
  /** `OPENVERIFY_NETWORK_REFRESH` (false): the worker's 15-minute `network-refresh` tick runs. */
  refresh: boolean;
  /**
   * `OPENVERIFY_IP_REPUTATION_MMDB_PATH`: the operator-licensed MMDB of the `mmdb-file`
   * `ipReputation` binding (C93.5), read by the API and the worker; `null` when unset.
   */
  ipReputationMmdbPath: string | null;
}

/** No network setting: every source as the manifest says, no refresh, no MMDB file. */
export const NO_NETWORK_SETTINGS: NetworkSettings = Object.freeze({
  sourcesDisabled: [],
  sourcesEnabled: [],
  refresh: false,
  ipReputationMmdbPath: null,
});

/** C72.5 (P09, V09): the per-environment report limits every process enforces. */
export interface ReportLimits {
  /** `OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE` (600): creations and `run` calls per environment. */
  perMinute: number;
  /** `OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT` (250,000). */
  maxRecurringPerEnvironment: number;
  /** `OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY` (8,640): scheduled media runs per day. */
  maxMediaRunsPerDay: number;
}

/** C76, C80: the watchlist settings. */
export interface WatchlistSettings {
  /** `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`: source ids, each once, in the order given. */
  sourcesDisabled: readonly string[];
  /**
   * C254.1 (Q10 granted 2026-11-21; KP11-31): `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`, for the
   * reconcile and the screening path; absent, false (the UN list stays locked).
   */
  unOptInAllowed?: boolean | undefined;
  /** `OPENVERIFY_WATCHLIST_REFRESH` (false): the worker's 15-minute refresh tick runs (C76.2). */
  refresh: boolean;
  /** `OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS` (90): removed entries are purged after it. */
  removedRetentionDays: number;
  /** `OPENVERIFY_EU_FSF_TOKEN`: the EU catalogue's token (decision 11); secret, never logged. */
  euFsfToken: string | null;
  /**
   * `OPENVERIFY_WIKIDATA_USER_AGENT`: the operator's contact (C80.1); unset, `wikidata-pep` stays
   * unconfigured (C76.4).
   */
  wikidataUserAgent: string | null;
  /** `OPENVERIFY_WIKIDATA_SPARQL_URL` (the Wikidata Query Service). */
  wikidataSparqlUrl: string;
  pep: {
    /** `OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS` (20, C80.2). */
    openTenureMaxYears: number;
    /** `OPENVERIFY_PEP_INCLUDE_RELATIVES` (false, C80.3). */
    includeRelatives: boolean;
    /** `OPENVERIFY_PEP_RETENTION_MONTHS` (12, C80.4). */
    retentionMonths: number;
    /** `OPENVERIFY_PEP_HEAD_RETENTION_MONTHS` (60, C80.4). */
    headRetentionMonths: number;
  };
}

/** C83: the report providers' credentials, each `null` unless its kind is bound to it. */
export interface ReportProviderCredentials {
  /** `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`, required to bind `gdelt-doc` (decision 7). */
  gdeltAcknowledged: boolean;
  hibp: { apiKey: string } | null;
  twilioLookup: { accountSid: string; apiKeySid: string; apiKeySecret: string } | null;
  smarty: { authId: string; authToken: string } | null;
}

/** C72.5, C76.3, C80: the Phase 6 defaults (all provisional; the plan's values). */
export const PHASE6_DEFAULTS = Object.freeze({
  reportsPerMinute: 600,
  maxRecurringPerEnvironment: 250_000,
  maxMediaRunsPerDay: 8_640,
  removedRetentionDays: 90,
  wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
  pepOpenTenureMaxYears: 20,
  pepRetentionMonths: 12,
  pepHeadRetentionMonths: 60,
});

/** C62.7: how the trust store is kept. */
export interface NfcSettings {
  /** `OPENVERIFY_NFC_ALLOW_ICAO_CRLS` (default false): fetch CRLs from ICAO PKD hosts too. */
  allowIcaoCrls: boolean;
  /** `OPENVERIFY_TRUST_ANCHOR_REFRESH` (default false): the worker's repeatable refresh runs. */
  trustAnchorRefresh: boolean;
}

/** A manifest source id, as `watchlistSourceIdSchema` (contracts) takes it. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const SOURCE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * C76.4: `OPENVERIFY_WATCHLIST_SOURCES_DISABLED`, read the same way by every process (the API, the
 * worker, the CLIs and `seed:dev`): comma-separated source ids, trimmed, each once in the order
 * given; empty entries are ignored. A value that is not a source id is an issue naming the
 * variable only.
 */
export function parseWatchlistSourcesDisabled(env: NodeJS.ProcessEnv): {
  value: readonly string[];
  issues: string[];
} {
  return parseSourceIds(env, 'OPENVERIFY_WATCHLIST_SOURCES_DISABLED', 'un-sc');
}

/** Comma-separated source ids in `name`, trimmed, each once in order; an issue names `name` only. */
function parseSourceIds(
  env: NodeJS.ProcessEnv,
  name: string,
  example: string,
): { value: readonly string[]; issues: string[] } {
  const ids = (env[name] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (ids.some((id) => !SOURCE_ID.test(id) || id.length > 64)) {
    return {
      value: [],
      issues: [`${name}: must be comma-separated source ids such as ${example}`],
    };
  }
  return { value: [...new Set(ids)], issues: [] };
}

/**
 * C92.5 (Workflow 7A): `OPENVERIFY_NETWORK_SOURCES_DISABLED` and `OPENVERIFY_NETWORK_SOURCES_ENABLED`,
 * read the same way by every process (the API, the worker, the CLI and `seed:dev`), as the
 * watchlist list is.
 */
export function parseNetworkSourceLists(env: NodeJS.ProcessEnv): {
  value: Pick<NetworkSettings, 'sourcesDisabled' | 'sourcesEnabled'>;
  issues: string[];
} {
  const disabled = parseSourceIds(env, 'OPENVERIFY_NETWORK_SOURCES_DISABLED', 'gcp-cloud');
  const enabled = parseSourceIds(env, 'OPENVERIFY_NETWORK_SOURCES_ENABLED', 'gcp-cloud');
  return {
    value: { sourcesDisabled: disabled.value, sourcesEnabled: enabled.value },
    issues: [...disabled.issues, ...enabled.issues],
  };
}

/** Which process reads the configuration (C63); the API by default. */
export interface LoadConfigOptions {
  process?: ProviderProcess;
}

/** The environment cannot be turned into a valid configuration. */
export class ConfigError extends Error {
  override name = 'ConfigError';
  /** One `<VARIABLE>: <problem>` line per problem. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Invalid OpenVerify API configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.issues = issues;
  }
}

const DEFAULTS = {
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'info',
  s3Region: 'us-east-1',
  visionUrl: 'http://127.0.0.1:8000',
} as const;

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_PREFIX = 'change-me';

const hasProtocol = (value: string, protocols: readonly string[]): boolean => {
  const url = safeUrl(value);
  return url !== null && protocols.includes(url.protocol);
};

const urlSchema = (protocols: readonly string[], message: string) =>
  z.string().refine((value) => hasProtocol(value, protocols), message);

const HTTP = ['http:', 'https:'];

/** C117.8 (decision 10): an environment's steps in flight (ours, provisional). */
export const DEFAULT_WORKFLOW_IN_FLIGHT_CAP = 50;
const MAX_IN_FLIGHT_CAP = 10_000;
const IN_FLIGHT_CAP_MESSAGE = `must be a whole number from 1 to ${String(MAX_IN_FLIGHT_CAP)}`;

/**
 * `pool`, `socket:<absolute path>` or (C263.6, Workflow 11C) `tcp:<host>:<port>`, whose token is
 * read beside it; `null` for anything else.
 */
function parseWorkflowCodeRunner(value: string): WorkflowCodeRunnerSetting | null {
  if (value === 'pool') {
    return { kind: 'pool' };
  }
  if (value.startsWith('tcp:')) {
    const target = parseCodeRunnerTcpTarget(value.slice('tcp:'.length));
    return target === null ? null : { kind: 'tcp', ...target, token: null };
  }
  const path = value.startsWith('socket:') ? value.slice('socket:'.length) : '';
  return path.startsWith('/') ? { kind: 'socket', path } : null;
}

/** RFC 6052 section 2.2: the prefix lengths that embed an IPv4 address. */
const NAT64_PREFIX_LENGTHS: ReadonlySet<string> = new Set(['32', '40', '48', '56', '64', '96']);

function isNat64Prefix(prefix: string): boolean {
  const [address = '', length = ''] = prefix.split('/');
  return isIPv6(address) && NAT64_PREFIX_LENGTHS.has(length);
}

const booleanSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0'], 'must be true or false'))
  .transform((value) => value === 'true' || value === '1');

const portSchema = z
  .string()
  .regex(/^\d{1,5}$/, 'must be a port number (0-65535)')
  .transform(Number)
  .pipe(z.int().max(65_535, 'must be a port number (0-65535)'));

/** C211.4: what a refused service account key file is told, never its content. */
const SERVICE_ACCOUNT_KEY = 'must be a service account key file with client_email and private_key';

const secretSchema = z
  .string()
  .min(MIN_SECRET_LENGTH, `must be at least ${String(MIN_SECRET_LENGTH)} characters`);

/** C174.7 (review P31): a flow server token holds at least 32 bytes (a 64-character hex string is 32). */
const flowServerTokenSchema = z
  .string()
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') >= MIN_SECRET_LENGTH,
    `must be at least ${String(MIN_SECRET_LENGTH)} bytes`,
  );

const flowUrlSchema = z.string().refine((value) => {
  const url = safeUrl(value);
  return (
    url !== null &&
    HTTP.includes(url.protocol) &&
    url.search === '' &&
    url.hash === '' &&
    !value.includes('#') &&
    url.username === '' &&
    url.password === ''
  );
}, 'must be an absolute http(s) URL without a query, fragment or credentials');

/** `scheme://host[:port]`, without a path; returns the normalised origin. */
const originSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => {
    const url = safeUrl(value);
    return (
      url !== null &&
      HTTP.includes(url.protocol) &&
      url.origin === value.replace(/\/$/, '') &&
      url.username === ''
    );
  }, 'must be a comma-separated list of origins such as https://flow.example.com')
  .transform((value) => new URL(value).origin);

const MAX_RATE_LIMIT = 1_000_000;
const RATE_LIMIT_MESSAGE = `must be a whole number from 1 to ${String(MAX_RATE_LIMIT)}`;
const OTP_CEILING_MESSAGE = `must be a whole number from ${String(OTP_SMS_MAX_PER_HOUR.min)} to ${String(OTP_SMS_MAX_PER_HOUR.max)}`;

/** A Twilio SID: its two-letter prefix and 32 hex characters. */
const twilioSidSchema = (prefix: string, what: string) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^${prefix}[0-9a-fA-F]{32}$`),
      `must be a Twilio ${what} (${prefix} and 32 hex characters)`,
    );

/** C61.1: a Companies House REST API key (a key from its developer hub). */
const companiesHouseKeySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9-]{20,64}$/,
    'must be a Companies House API key (20 to 64 letters, digits and hyphens)',
  );

/** A whole number from `min` to `max`, as a variable spells it. */
function wholeNumber(min: number, max: number) {
  const message = `must be a whole number from ${String(min)} to ${String(max)}`;
  return z
    .string()
    .regex(/^\d{1,9}$/, message)
    .transform(Number)
    .pipe(z.int().min(min, message).max(max, message));
}

/** An absolute path without a NUL (C249.1's CA files, C250.2's heartbeat file). */
const absolutePathSchema = z
  .string()
  .trim()
  .refine((value) => value.startsWith('/') && !value.includes('\0'), 'must be an absolute path');

/** C255.1: two years, the most `OPENVERIFY_HSTS_MAX_AGE` takes. */
const HSTS_MAX_AGE_MAX = 63_072_000;

/** C248.3: the most `OPENVERIFY_SSO_PRIVATE_ISSUERS` holds. */
const MAX_SSO_PRIVATE_ISSUERS = 20;

/** C247.1: the most `OPENVERIFY_API_KEY_PEPPER_PREVIOUS` holds. */
const MAX_PREVIOUS_PEPPERS = 2;

/** `host:port` (an IPv6 host in brackets); `null` for anything else (C250.3). */
function parseHostPort(value: string): InternalListen | null {
  const match = /^(?:\[([0-9A-Fa-f:.]+)\]|([A-Za-z0-9.-]+)):(\d{1,5})$/.exec(value);
  const host = match?.[1] ?? match?.[2];
  const port = Number(match?.[3]);
  if (host === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }
  if (match?.[1] !== undefined && !isIPv6(host)) {
    return null;
  }
  return { host, port };
}

/** A third party's key or token: printable ASCII, no spaces (C76, C83). */
const credentialSchema = z
  .string()
  .regex(/^[\x21-\x7e]{8,512}$/, 'must be 8-512 printable characters without spaces');

const SCHEMAS = {
  OPENVERIFY_MODE: z.enum(APP_MODES, `must be one of ${APP_MODES.join(', ')}`),
  OPENVERIFY_API_HOST: z.string().min(1),
  OPENVERIFY_API_PORT: portSchema,
  OPENVERIFY_LOG_LEVEL: z.enum(LOG_LEVELS, `must be one of ${LOG_LEVELS.join(', ')}`),
  // api-operators: begin
  OPENVERIFY_TRUST_PROXY: trustProxySchema,
  ...OPERATOR_SETTING_SCHEMAS,
  // api-operators: end
  DATABASE_URL: urlSchema(['postgres:', 'postgresql:'], 'must be a postgres:// URL'),
  REDIS_URL: urlSchema(['redis:', 'rediss:'], 'must be a redis:// or rediss:// URL'),
  S3_ENDPOINT: urlSchema(HTTP, 'must be an http(s) URL'),
  S3_REGION: z.string().regex(/^[a-z0-9-]+$/, 'must be a region name such as us-east-1'),
  S3_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid S3 bucket name'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanSchema,
  OPENVERIFY_API_KEY_PEPPER: secretSchema,
  OPENVERIFY_FLOW_PUBLIC_URL: flowUrlSchema,
  OPENVERIFY_FLOW_CORS_ORIGINS: z
    .string()
    .transform((value) => value.split(',').filter((origin) => origin.trim() !== ''))
    .pipe(z.array(originSchema).min(1, 'must list at least one origin')),
  OPENVERIFY_VISION_URL: urlSchema(HTTP, 'must be an http(s) URL'),
  OPENVERIFY_VISION_SERVICE_TOKEN: secretSchema,
  // C157.2, C174.7 (Workflow 9A Stage 1b (F); review P31): the flow server's token on the internal
  // embed-policy route, and the previous one during a rotation; at least 32 bytes each.
  OPENVERIFY_FLOW_SERVER_TOKEN: flowServerTokenSchema,
  OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS: flowServerTokenSchema,
  OPENVERIFY_RATE_LIMIT_API_PER_MINUTE: z
    .string()
    .regex(/^\d{1,7}$/, RATE_LIMIT_MESSAGE)
    .transform(Number)
    .pipe(z.int().min(1, RATE_LIMIT_MESSAGE).max(MAX_RATE_LIMIT, RATE_LIMIT_MESSAGE)),
  // C96.3, C107.8 (Workflow 7A): the email and SMS handoff sends of an environment per hour.
  OPENVERIFY_HANDOFF_SENDS_PER_HOUR: z
    .string()
    .regex(/^\d{1,7}$/, HANDOFF_SENDS_MESSAGE)
    .transform(Number)
    .pipe(
      z.int().min(1, HANDOFF_SENDS_MESSAGE).max(MAX_HANDOFF_SENDS_PER_HOUR, HANDOFF_SENDS_MESSAGE),
    ),
  // C231.10 (Workflow 11A): the install switch for Connect.
  OPENVERIFY_CONNECT_ENABLED: booleanSchema,
  // C143.8 (Workflow 8A): the engine's install settings.
  OPENVERIFY_WORKFLOW_CODE_ENABLED: booleanSchema,
  OPENVERIFY_WORKFLOW_CODE_RUNNER: z.string().transform((value, context) => {
    const runner = parseWorkflowCodeRunner(value.trim());
    if (runner === null) {
      context.addIssue({
        code: 'custom',
        message: 'must be pool, socket:<absolute path> or tcp:<host>:<port>',
      });
      return z.NEVER;
    }
    return runner;
  }),
  // C263.6 (Workflow 11C): the tcp: transport's shared token, at least 32 bytes.
  OPENVERIFY_CODE_RUNNER_TOKEN: flowServerTokenSchema,
  OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK: booleanSchema,
  OPENVERIFY_NAT64_PREFIXES: z.string().transform((value, context) => {
    const prefixes = value
      .split(',')
      .map((prefix) => prefix.trim())
      .filter((prefix) => prefix !== '');
    if (!prefixes.every(isNat64Prefix)) {
      context.addIssue({
        code: 'custom',
        message: 'must be IPv6 prefixes of an RFC 6052 length (/32, /40, /48, /56, /64 or /96)',
      });
      return z.NEVER;
    }
    return prefixes;
  }),
  OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP: z
    .string()
    .regex(/^\d{1,7}$/, IN_FLIGHT_CAP_MESSAGE)
    .transform(Number)
    .pipe(z.int().min(1, IN_FLIGHT_CAP_MESSAGE).max(MAX_IN_FLIGHT_CAP, IN_FLIGHT_CAP_MESSAGE)),
  // C55.7, decision 14: the install ceiling of an environment's otp-sms-max-per-hour.
  OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING: z
    .string()
    .regex(/^\d{1,7}$/, OTP_CEILING_MESSAGE)
    .transform(Number)
    .pipe(
      z
        .int()
        .min(OTP_SMS_MAX_PER_HOUR.min, OTP_CEILING_MESSAGE)
        .max(OTP_SMS_MAX_PER_HOUR.max, OTP_CEILING_MESSAGE),
    ),
  // C55.10, C126.6: Twilio's credentials, read by the API and the worker while sms is bound to twilio.
  OPENVERIFY_TWILIO_ACCOUNT_SID: twilioSidSchema('AC', 'account SID'),
  OPENVERIFY_TWILIO_API_KEY_SID: twilioSidSchema('SK', 'API key SID'),
  OPENVERIFY_TWILIO_API_KEY_SECRET: secretSchema,
  OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID: twilioSidSchema('MG', 'messaging service SID'),
  OPENVERIFY_TWILIO_FROM: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{6,14}$/, 'must be an E.164 number such as +15555550100'),
  // C57.5, decision 22: the EVM RPC's own private-network setting, read by the worker.
  OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS: booleanSchema,
  // C61.1: the Companies House keys (live, and its sandbox host) and SEC EDGAR's required
  // User-Agent contact, read by the worker while businessRegistry names their register.
  OPENVERIFY_COMPANIES_HOUSE_API_KEY: companiesHouseKeySchema,
  OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY: companiesHouseKeySchema,
  OPENVERIFY_SEC_EDGAR_USER_AGENT: z
    .string()
    .trim()
    .regex(
      /^[\x20-\x7e]{3,200}$/,
      'must name the organization and a contact email address, such as "Example Ltd admin@example.com"',
    )
    .regex(
      // eslint-disable-next-line security/detect-unsafe-regex -- the operator's own setting, at most 200 characters (the pattern above), checked once at start
      /[^\s@]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
      'must name the organization and a contact email address, such as "Example Ltd admin@example.com"',
    ),
  // C62.7: the trust-store sync (ICAO PKD CRLs only when allowed) and the worker's refresh.
  OPENVERIFY_NFC_ALLOW_ICAO_CRLS: booleanSchema,
  OPENVERIFY_TRUST_ANCHOR_REFRESH: booleanSchema,
  // C72.5 (P09, V09): the per-environment report limits, read by the API and the worker.
  OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE: wholeNumber(1, MAX_RATE_LIMIT),
  OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT: wholeNumber(1, 10_000_000),
  // At most the whole GDELT install budget a day (C81.2: 17,280 requests).
  OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY: wholeNumber(1, 17_280),
  // C76, C80: the list sync, read by the worker (and the CLIs, which read as the worker).
  OPENVERIFY_WATCHLIST_REFRESH: booleanSchema,
  OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS: wholeNumber(1, 3650),
  OPENVERIFY_EU_FSF_TOKEN: credentialSchema,
  OPENVERIFY_WIKIDATA_USER_AGENT: z
    .string()
    .trim()
    .regex(
      /^[\x20-\x7e]{8,300}$/,
      'must be a User-Agent with your contact, 8-300 printable characters',
    ),
  OPENVERIFY_WIKIDATA_SPARQL_URL: urlSchema(['https:'], 'must be an https URL'),
  OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS: wholeNumber(1, 100),
  OPENVERIFY_PEP_INCLUDE_RELATIVES: booleanSchema,
  OPENVERIFY_PEP_RETENTION_MONTHS: wholeNumber(1, 600),
  OPENVERIFY_PEP_HEAD_RETENTION_MONTHS: wholeNumber(1, 600),
  // C81.1, C83: the report providers' acknowledgement and credentials, read by the worker while
  // their kind is bound to their adapter. The Lookup credentials are not the SMS sender's.
  OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: booleanSchema,
  OPENVERIFY_HIBP_API_KEY: credentialSchema,
  OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID: twilioSidSchema('AC', 'account SID'),
  OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID: twilioSidSchema('SK', 'API key SID'),
  OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET: credentialSchema,
  OPENVERIFY_SMARTY_AUTH_ID: credentialSchema,
  OPENVERIFY_SMARTY_AUTH_TOKEN: credentialSchema,
  // C211.4 (Workflow 10B): the play-integrity decode's settings, read by the worker while
  // deviceIntegrity is bound to play-integrity: the host app's package name, its signing certificate
  // digests (comma-separated, base64url SHA-256 as Play Integrity reports them) and the operator's
  // service account key file (its JSON; a secret).
  OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME: z
    .string()
    .trim()
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    .regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/, 'must be an Android package name')
    .max(255),
  OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((digest) => digest.trim())
        .filter((digest) => digest !== ''),
    )
    .pipe(
      z
        .array(z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'must be base64url SHA-256 digests'))
        .min(1, 'must name at least one digest')
        .max(10, 'must name at most 10 digests'),
    ),
  OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: z
    .string()
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({ code: 'custom', message: 'must be a service account key file (JSON)' });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .object({
          client_email: z
            .string({ error: SERVICE_ACCOUNT_KEY })
            .regex(/^[^@\s]+@[^@\s]+$/, SERVICE_ACCOUNT_KEY),
          private_key: z.string({ error: SERVICE_ACCOUNT_KEY }).includes('PRIVATE KEY', {
            message: SERVICE_ACCOUNT_KEY,
          }),
        })
        .transform((key) => ({ clientEmail: key.client_email, privateKey: key.private_key })),
    ),
  // C92.2, C93.5 (Workflow 7A): the worker's network refresh tick, and the MMDB file of the
  // mmdb-file ipReputation binding, read by the API and the worker.
  OPENVERIFY_NETWORK_REFRESH: booleanSchema,
  // C135.5, C143.8: clamd's socket, read by the worker while attachmentScanner is bound to clamd.
  OPENVERIFY_CLAMD_SOCKET: z.string().trim().min(1),
  OPENVERIFY_IP_REPUTATION_MMDB_PATH: z
    .string()
    .trim()
    .refine((value) => value.startsWith('/') && !value.includes('\0'), 'must be an absolute path'),
  // foundation-11b: begin (Workflow 11B Stage 1b common; Stage 1a amendment 25)
  // C245.1: the console's idle and absolute session limits.
  OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS: wholeNumber(
    CONSOLE_SESSION_TIMEOUTS.idleSeconds.min,
    CONSOLE_SESSION_TIMEOUTS.idleSeconds.max,
  ),
  OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS: wholeNumber(
    CONSOLE_SESSION_TIMEOUTS.absoluteSeconds.min,
    CONSOLE_SESSION_TIMEOUTS.absoluteSeconds.max,
  ),
  // C247.1: earlier peppers, read entry by entry by `readPreviousPeppers`.
  OPENVERIFY_API_KEY_PEPPER_PREVIOUS: z.string(),
  // C248.3: issuers the SSRF guard may reach on a private address, read by `readPrivateIssuers`.
  OPENVERIFY_SSO_PRIVATE_ISSUERS: z.string(),
  // C249.1: each store's CA file.
  OPENVERIFY_POSTGRES_CA_FILE: absolutePathSchema,
  OPENVERIFY_REDIS_CA_FILE: absolutePathSchema,
  OPENVERIFY_S3_CA_FILE: absolutePathSchema,
  OPENVERIFY_VISION_CA_FILE: absolutePathSchema,
  // C249.3, C249.4: db:migrate's role and its lock.
  OPENVERIFY_MIGRATION_DATABASE_URL: urlSchema(
    ['postgres:', 'postgresql:'],
    'must be a postgres:// URL',
  ),
  OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS: wholeNumber(1, MIGRATE_LOCK.timeoutSecondsMax),
  // C250.2, C250.3: the worker's heartbeat file and the internal listener.
  OPENVERIFY_WORKER_HEARTBEAT_FILE: absolutePathSchema,
  OPENVERIFY_INTERNAL_LISTEN: z.string().transform((value, context) => {
    const listen = parseHostPort(value.trim());
    if (listen === null) {
      context.addIssue({ code: 'custom', message: 'must be host:port' });
      return z.NEVER;
    }
    return listen;
  }),
  // C251.2: the install ceiling of every per-environment queue cap.
  OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX: wholeNumber(QUEUE_IN_FLIGHT_CAP.min, QUEUE_IN_FLIGHT_CAP.max),
  // C254.1 (Q10, rule 19): the UN list's opt-in switch, locked false by default.
  OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED: booleanSchema,
  // C255.1: the optional HSTS header's max-age; 0 sends none.
  OPENVERIFY_HSTS_MAX_AGE: wholeNumber(0, HSTS_MAX_AGE_MAX),
  // foundation-11b: end
} as const;

type Variable = keyof typeof SCHEMAS;

/** Variables whose values are secrets: placeholders are refused in production. */
const SECRETS: readonly Variable[] = [
  'OPENVERIFY_API_KEY_PEPPER',
  // C263.6 (Workflow 11C): the code runner's tcp: token.
  'OPENVERIFY_CODE_RUNNER_TOKEN',
  'OPENVERIFY_VISION_SERVICE_TOKEN',
  'S3_SECRET_ACCESS_KEY',
  // api-operators: begin
  'OPENVERIFY_DASHBOARD_BFF_TOKEN',
  // api-operators: end
  // C63 (P25), decision 76: the Twilio API key secret, which the API and the worker read.
  'OPENVERIFY_TWILIO_API_KEY_SECRET',
  // C63 (P25): the Companies House keys, which only the worker reads.
  'OPENVERIFY_COMPANIES_HOUSE_API_KEY',
  'OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY',
  // C76, C83 (Phase 6): the EU list token and the report providers' secrets, worker only.
  'OPENVERIFY_EU_FSF_TOKEN',
  'OPENVERIFY_HIBP_API_KEY',
  'OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET',
  'OPENVERIFY_SMARTY_AUTH_TOKEN',
  // C211.4 (Workflow 10B): the play-integrity service account key, worker only.
  'OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON',
  // C174.7 (Workflow 9A Stage 1b (F)): the flow server's token, which the API and the flow server read.
  'OPENVERIFY_FLOW_SERVER_TOKEN',
  'OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS',
  // C247.1, C249.3 (Workflow 11B): the previous peppers and the migration role's connection.
  'OPENVERIFY_API_KEY_PEPPER_PREVIOUS',
  'OPENVERIFY_MIGRATION_DATABASE_URL',
];

/** C277.2: the secrets above, for the configuration registry's test (Workflow 11B foundation). */
export const CONFIG_SECRETS: readonly string[] = SECRETS;

class Reader {
  readonly issues: string[] = [];

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly production: boolean,
  ) {}

  private raw(name: string): string | undefined {
    const value = this.env[name];
    return value === undefined || value.trim() === '' ? undefined : value;
  }

  /** The parsed value, or `fallback` when unset; records an issue and returns it on failure. */
  optional<N extends Variable, F>(name: N, fallback: F): z.output<(typeof SCHEMAS)[N]> | F {
    const value = this.raw(name);
    if (value === undefined) {
      return fallback;
    }
    const parsed = SCHEMAS[name].safeParse(value);
    if (!parsed.success) {
      this.issues.push(`${name}: ${parsed.error.issues[0]?.message ?? 'is invalid'}`);
      return fallback;
    }
    if (this.production && SECRETS.includes(name) && value.startsWith(PLACEHOLDER_PREFIX)) {
      this.issues.push(`${name}: still holds a change-me placeholder; set a real secret`);
    }
    return parsed.data as z.output<(typeof SCHEMAS)[N]>;
  }

  /** Like {@link optional}, but an unset variable is an issue (`why` says when it is needed). */
  required<N extends Variable>(name: N, why?: string): z.output<(typeof SCHEMAS)[N]> | undefined {
    if (this.raw(name) === undefined) {
      this.issues.push(`${name}: is required${why === undefined ? '' : ` ${why}`}`);
      return undefined;
    }
    return this.optional(name, undefined);
  }

  /** Whether the variable is set to anything but blanks. */
  isSet(name: string): boolean {
    return this.raw(name) !== undefined;
  }

  /**
   * C55.10: Twilio's credentials, while `sms` is bound to `twilio`. Exactly one sender is set: a
   * messaging service SID or an E.164 `from` number.
   */
  twilio(): TwilioSettings | null {
    const why = 'while sms is bound to twilio';
    const accountSid = this.required('OPENVERIFY_TWILIO_ACCOUNT_SID', why);
    const apiKeySid = this.required('OPENVERIFY_TWILIO_API_KEY_SID', why);
    const apiKeySecret = this.required('OPENVERIFY_TWILIO_API_KEY_SECRET', why);
    const messagingServiceSid = this.optional('OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID', null);
    const from = this.optional('OPENVERIFY_TWILIO_FROM', null);
    const service = this.isSet('OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID');
    const number = this.isSet('OPENVERIFY_TWILIO_FROM');
    if (!service && !number) {
      this.issues.push(
        `OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID: set it or OPENVERIFY_TWILIO_FROM ${why}`,
      );
    }
    if (service && number) {
      this.issues.push(
        'OPENVERIFY_TWILIO_FROM: set either it or OPENVERIFY_TWILIO_MESSAGING_SERVICE_SID, not both',
      );
    }
    return accountSid === undefined || apiKeySid === undefined || apiKeySecret === undefined
      ? null
      : { accountSid, apiKeySid, apiKeySecret, messagingServiceSid, from };
  }

  /**
   * C57.5: the node URL per chain (`OPENVERIFY_EVM_RPC_URLS`, comma-separated
   * `eip155:<chain>=<url>`), while `evmRpc` is bound to `json-rpc`. URLs are https, or http with
   * `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS` (an operator's node on a private network); none
   * carries credentials in its authority (an API key in the path or query is fine). Issues name
   * the entry, never its value: URLs often hold an API key.
   */
  evmRpc(): EvmRpcSettings | null {
    const allowPrivateNetworks = this.optional('OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS', false);
    const raw = this.raw('OPENVERIFY_EVM_RPC_URLS');
    if (raw === undefined) {
      this.issues.push('OPENVERIFY_EVM_RPC_URLS: is required while evmRpc is bound to json-rpc');
      return null;
    }
    const protocols = allowPrivateNetworks ? HTTP : ['https:'];
    const urls = new Map<string, string>();
    let valid = true;
    const entries = raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    for (const [index, entry] of entries.entries()) {
      const at = entry.indexOf('=');
      const chain = at === -1 ? '' : entry.slice(0, at).trim();
      const value = at === -1 ? '' : entry.slice(at + 1).trim();
      const url = safeUrl(value);
      const name = `OPENVERIFY_EVM_RPC_URLS: entry ${String(index + 1)}`;
      if (
        !EVM_CHAIN_ID_PATTERN.test(chain) ||
        url === null ||
        !protocols.includes(url.protocol) ||
        url.username !== '' ||
        url.password !== '' ||
        url.hash !== ''
      ) {
        this.issues.push(
          `${name} must be eip155:<chain>=https://… (http only with OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS)`,
        );
        valid = false;
      } else if (urls.has(chain)) {
        this.issues.push(`${name} repeats a chain`);
        valid = false;
      } else {
        urls.set(chain, value);
      }
    }
    return valid ? { urls, allowPrivateNetworks } : null;
  }

  /** The C31.8 blind index key; it must not be the KEK, so one leaked secret is not both. */
  blindIndexKey(): Uint8Array | undefined {
    let key: Uint8Array;
    try {
      key = blindIndexKeyFromEnv(this.env);
    } catch (error) {
      if (!(error instanceof BlindIndexKeyError)) {
        throw error;
      }
      // BlindIndexKeyError messages start with the variable name and never contain the key.
      this.issues.push(
        `${BLIND_INDEX_KEY_ENV}: ${error.message.slice(BLIND_INDEX_KEY_ENV.length).trim()}`,
      );
      return undefined;
    }
    const kek = this.raw(KEK_ENV)?.trim();
    if (kek !== undefined && Buffer.from(key).toString('base64') === kek) {
      this.issues.push(
        `${BLIND_INDEX_KEY_ENV}: must differ from ${KEK_ENV}; generate a separate key`,
      );
      return undefined;
    }
    return key;
  }

  keyring(): Keyring | undefined {
    try {
      return keyringFromEnv(this.env);
    } catch (error) {
      if (!(error instanceof KeyringError)) {
        throw error;
      }
      // KeyringError messages name the variable first and never contain key material.
      const name = error.message.startsWith(KEK_PREVIOUS_ENV) ? KEK_PREVIOUS_ENV : KEK_ENV;
      const detail = error.message.startsWith(name)
        ? error.message.slice(name.length).trim()
        : error.message;
      this.issues.push(`${name}: ${detail}`);
      return undefined;
    }
  }
}

/**
 * C157.2, C174.7: `OPENVERIFY_FLOW_SERVER_TOKEN` and `_PREVIOUS`, or `null` when the flow server is
 * not configured. A previous token without a current one is an issue: a rotation keeps both.
 */
function readFlowServerTokens(read: Reader): FlowServerTokens | null {
  const current = read.optional('OPENVERIFY_FLOW_SERVER_TOKEN', null);
  const previous = read.optional('OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS', null);
  if (current === null) {
    if (
      read.isSet('OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS') &&
      !read.isSet('OPENVERIFY_FLOW_SERVER_TOKEN')
    ) {
      read.issues.push(
        'OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS: is set without OPENVERIFY_FLOW_SERVER_TOKEN; a rotation keeps both',
      );
    }
    return null;
  }
  return { current, previous };
}

/** A required value; only called once no issue was found, so it is always present. */
function present<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('A required setting is missing although no issue was recorded');
  }
  return value;
}

/**
 * C76, C80: the list sync settings. The worker reads them (the CLIs read as the worker); the API
 * neither reads nor checks them, so it never holds the EU token.
 */
function readWatchlistSettings(
  read: Reader,
  readFor: ProviderProcess,
  sourcesDisabled: readonly string[],
): WatchlistSettings {
  const worker = readFor === 'worker';
  const optional = <N extends Variable, F>(name: N, fallback: F) =>
    worker ? read.optional(name, fallback) : fallback;
  return {
    sourcesDisabled,
    refresh: optional('OPENVERIFY_WATCHLIST_REFRESH', false),
    removedRetentionDays: optional(
      'OPENVERIFY_WATCHLIST_REMOVED_RETENTION_DAYS',
      PHASE6_DEFAULTS.removedRetentionDays,
    ),
    euFsfToken: optional('OPENVERIFY_EU_FSF_TOKEN', null),
    wikidataUserAgent: optional('OPENVERIFY_WIKIDATA_USER_AGENT', null),
    wikidataSparqlUrl: optional(
      'OPENVERIFY_WIKIDATA_SPARQL_URL',
      PHASE6_DEFAULTS.wikidataSparqlUrl,
    ),
    pep: {
      openTenureMaxYears: optional(
        'OPENVERIFY_PEP_OPEN_TENURE_MAX_YEARS',
        PHASE6_DEFAULTS.pepOpenTenureMaxYears,
      ),
      includeRelatives: optional('OPENVERIFY_PEP_INCLUDE_RELATIVES', false),
      retentionMonths: optional(
        'OPENVERIFY_PEP_RETENTION_MONTHS',
        PHASE6_DEFAULTS.pepRetentionMonths,
      ),
      headRetentionMonths: optional(
        'OPENVERIFY_PEP_HEAD_RETENTION_MONTHS',
        PHASE6_DEFAULTS.pepHeadRetentionMonths,
      ),
    },
  };
}

/**
 * C92, C93.5 (Workflow 7A): the network settings. The source lists are read alike by every process;
 * the refresh tick by the worker only; the MMDB file by both processes, required while either
 * environment kind binds `ipReputation` to `mmdb-file`. No value is ever echoed.
 */
function readNetworkSettings(
  read: Reader,
  env: NodeJS.ProcessEnv,
  readFor: ProviderProcess,
  settings: ProviderSettings,
): NetworkSettings {
  const lists = parseNetworkSourceLists(env);
  read.issues.push(...lists.issues);
  const binds = (name: string) =>
    settings.sandbox.ipReputation === name || settings.production.ipReputation === name;
  const ipReputationMmdbPath = binds('mmdb-file')
    ? read.required(
        'OPENVERIFY_IP_REPUTATION_MMDB_PATH',
        'while ipReputation is bound to mmdb-file',
      )
    : read.optional('OPENVERIFY_IP_REPUTATION_MMDB_PATH', undefined);
  return {
    ...lists.value,
    refresh: readFor === 'worker' ? read.optional('OPENVERIFY_NETWORK_REFRESH', false) : false,
    ipReputationMmdbPath: ipReputationMmdbPath ?? null,
  };
}

/**
 * C81.1, C83: the report providers' acknowledgement and credentials, in the worker only, each
 * credential only while its kind is bound to its adapter in either environment kind. Binding
 * `gdelt-doc` without `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true` stops the worker (decision 7).
 */
function readReportProviderCredentials(
  read: Reader,
  readFor: ProviderProcess,
  settings: ProviderSettings,
): ReportProviderCredentials {
  if (readFor !== 'worker') {
    return { gdeltAcknowledged: false, hibp: null, twilioLookup: null, smarty: null };
  }
  const binds = (kind: (typeof PHASE6_PROVIDER_KINDS)[number], name: string) =>
    settings.sandbox[kind] === name || settings.production[kind] === name;
  const gdeltAcknowledged = read.optional('OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE', false);
  if (binds('adverseMedia', 'gdelt-doc') && !gdeltAcknowledged) {
    read.issues.push(
      'OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE: must be true to bind adverseMedia to gdelt-doc, ' +
        'which sends every screened name to GDELT (decision 7)',
    );
  }
  const hibp = (() => {
    if (!binds('emailIntelligence', 'hibp')) {
      return null;
    }
    const apiKey = read.required(
      'OPENVERIFY_HIBP_API_KEY',
      'while emailIntelligence is bound to hibp',
    );
    return apiKey === undefined ? null : { apiKey };
  })();
  const twilioLookup = (() => {
    if (!binds('phoneIntelligence', 'twilio-lookup')) {
      return null;
    }
    const why = 'while phoneIntelligence is bound to twilio-lookup';
    const accountSid = read.required('OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID', why);
    const apiKeySid = read.required('OPENVERIFY_TWILIO_LOOKUP_API_KEY_SID', why);
    const apiKeySecret = read.required('OPENVERIFY_TWILIO_LOOKUP_API_KEY_SECRET', why);
    return accountSid === undefined || apiKeySid === undefined || apiKeySecret === undefined
      ? null
      : { accountSid, apiKeySid, apiKeySecret };
  })();
  const smarty = (() => {
    if (!binds('addressVerification', 'smarty')) {
      return null;
    }
    const why = 'while addressVerification is bound to smarty';
    const authId = read.required('OPENVERIFY_SMARTY_AUTH_ID', why);
    const authToken = read.required('OPENVERIFY_SMARTY_AUTH_TOKEN', why);
    return authId === undefined || authToken === undefined ? null : { authId, authToken };
  })();
  return { gdeltAcknowledged, hibp, twilioLookup, smarty };
}

/**
 * C211.4 (Workflow 10B): `play-integrity`'s settings, in the worker only (the decode runs in the
 * `integrity-decode` job), and only while either environment kind binds `deviceIntegrity` to it.
 * Never echoed: an issue names the variable, never its value.
 */
function readPlayIntegritySettings(
  read: Reader,
  readFor: ProviderProcess,
  settings: ProviderSettings,
): PlayIntegritySettings | null {
  const bound =
    settings.sandbox.deviceIntegrity === 'play-integrity' ||
    settings.production.deviceIntegrity === 'play-integrity';
  if (readFor !== 'worker' || !bound) {
    return null;
  }
  const why = 'while deviceIntegrity is bound to play-integrity';
  const packageName = read.required('OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME', why);
  const certificateDigests = read.required('OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS', why);
  const serviceAccount = read.required('OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON', why);
  return packageName === undefined ||
    certificateDigests === undefined ||
    serviceAccount === undefined
    ? null
    : { packageName, certificateDigests, serviceAccount };
}

/**
 * C263.6 (Workflow 11C): a `tcp:` runner's token. The worker, which connects, requires it; the API
 * reads it if set (its schema still holds it to 32 bytes) and otherwise keeps `null`.
 */
function withCodeRunnerToken(
  runner: WorkflowCodeRunnerSetting,
  read: Reader,
  readFor: ProviderProcess,
): WorkflowCodeRunnerSetting {
  if (runner.kind !== 'tcp') {
    return runner;
  }
  const token =
    readFor === 'worker'
      ? read.required(
          'OPENVERIFY_CODE_RUNNER_TOKEN',
          'while OPENVERIFY_WORKFLOW_CODE_RUNNER is tcp:',
        )
      : read.optional('OPENVERIFY_CODE_RUNNER_TOKEN', undefined);
  return { ...runner, token: token ?? null };
}

/**
 * Reads the API's configuration from `env`.
 * @throws {ConfigError} listing every invalid or missing variable.
 */
export function loadConfig(
  rawEnv: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): ApiConfig {
  const readFor = options.process ?? 'api';
  // C249.2 (Workflow 11B Stage 1b common): every `<NAME>_FILE` is resolved before anything is read.
  const secretFiles = resolveSecretFiles(rawEnv, CONFIG_REGISTRY);
  const env = secretFiles.env;
  const { mode, read } = readerFor(env, secretFiles.issues);
  const startupWarnings: StartupWarning[] = [...secretFiles.warnings];

  const flowPublicUrl = read.required('OPENVERIFY_FLOW_PUBLIC_URL');
  const flowServerTokens = readFlowServerTokens(read);
  const defaultOrigins = flowPublicUrl === undefined ? [] : [new URL(flowPublicUrl).origin];
  const visionUrl =
    mode === 'production'
      ? read.required('OPENVERIFY_VISION_URL')
      : read.optional('OPENVERIFY_VISION_URL', DEFAULTS.visionUrl);

  const databaseUrl = read.required('DATABASE_URL');
  const redisUrl = read.required('REDIS_URL');
  const bucket = read.required('S3_BUCKET');
  const accessKeyId = read.required('S3_ACCESS_KEY_ID');
  const secretAccessKey = read.required('S3_SECRET_ACCESS_KEY');
  const keyring = read.keyring();
  const blindIndexKey = read.blindIndexKey();
  // C63: each process reads its own provider kinds, and only their credentials.
  const providers = readProviderSettings(env, readFor);
  read.issues.push(...providers.issues);
  const bound = (kind: 'sms' | 'evmRpc' | 'attachmentScanner', name: string) =>
    providers.settings.sandbox[kind] === name || providers.settings.production[kind] === name;
  // C126.6, decision 76: the worker sends workflow messages, so `bound` is the whole test here.
  const twilio = bound('sms', 'twilio') ? read.twilio() : null;
  // C135.5: the worker's alone, because `.api` never reads this kind.
  const clamdSocket =
    readFor === 'worker' && bound('attachmentScanner', 'clamd')
      ? (read.required('OPENVERIFY_CLAMD_SOCKET', 'while attachmentScanner is bound to clamd') ??
        null)
      : null;
  const evmRpc = readFor === 'worker' && bound('evmRpc', 'json-rpc') ? read.evmRpc() : null;
  // C61.1: the registers' credentials, in the worker, while a binding names their register.
  const names = (
    source: 'companies-house' | 'sec-edgar',
    environment: 'sandbox' | 'production',
  ) => {
    const binding = providers.settings[environment].businessRegistry;
    return Array.isArray(binding) && binding.includes(source);
  };
  const companiesHouse = (() => {
    const live = names('companies-house', 'production');
    const sandbox = names('companies-house', 'sandbox');
    if (readFor !== 'worker' || (!live && !sandbox)) {
      return null;
    }
    const why = (environment: string) =>
      `while businessRegistry names companies-house for ${environment} environments`;
    const apiKey = live
      ? read.required('OPENVERIFY_COMPANIES_HOUSE_API_KEY', why('production'))
      : read.optional('OPENVERIFY_COMPANIES_HOUSE_API_KEY', null);
    const sandboxApiKey = sandbox
      ? read.required('OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY', why('sandbox'))
      : read.optional('OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY', null);
    return { apiKey: apiKey ?? null, sandboxApiKey: sandboxApiKey ?? null };
  })();
  const edgarNamed = names('sec-edgar', 'production') || names('sec-edgar', 'sandbox');
  const edgarUserAgent =
    readFor === 'worker' && edgarNamed
      ? read.required('OPENVERIFY_SEC_EDGAR_USER_AGENT', 'while businessRegistry names sec-edgar')
      : undefined;
  const nfc = {
    allowIcaoCrls: read.optional('OPENVERIFY_NFC_ALLOW_ICAO_CRLS', false),
    trustAnchorRefresh: read.optional('OPENVERIFY_TRUST_ANCHOR_REFRESH', false),
  };
  // C96.3, C107.8 (Workflow 7A): the handoff send budget.
  const workflows: WorkflowSettings = {
    codeEnabled: read.optional('OPENVERIFY_WORKFLOW_CODE_ENABLED', true),
    codeRunner: withCodeRunnerToken(
      read.optional('OPENVERIFY_WORKFLOW_CODE_RUNNER', { kind: 'pool' }),
      read,
      readFor,
    ),
    httpAllowLoopback: read.optional('OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK', false),
    nat64Prefixes: read.optional('OPENVERIFY_NAT64_PREFIXES', []),
    inFlightCap: read.optional('OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP', DEFAULT_WORKFLOW_IN_FLIGHT_CAP),
    slackBound: {
      sandbox: (env.OPENVERIFY_PROVIDER_SLACK_SANDBOX ?? '') !== '',
      production: (env.OPENVERIFY_PROVIDER_SLACK_PRODUCTION ?? '') !== '',
    },
  };
  // C135.5 (Workflow 8B (F)): the scanner each kind binds, by name. The worker's provider settings
  // refuse a bad name already; the API refuses it here.
  const cases: CaseSettings = {
    attachmentScanners: readAttachmentScanners(
      env,
      PROCESS_PROVIDER_KINDS[readFor].includes('attachmentScanner') ? [] : read.issues,
    ),
  };
  // C124.3: test receivers on loopback are for sandbox environments outside production installs.
  if (mode === 'production' && workflows.httpAllowLoopback) {
    read.issues.push('OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK: is refused in production');
  }
  const connect: ConnectInstallSettings = {
    enabled: read.optional('OPENVERIFY_CONNECT_ENABLED', false),
  };
  const handoff: HandoffSettings = {
    sendsPerHour: read.optional(
      'OPENVERIFY_HANDOFF_SENDS_PER_HOUR',
      DEFAULT_HANDOFF_SENDS_PER_HOUR,
    ),
  };
  const otpSmsMaxPerHourCeiling = read.optional(
    'OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING',
    OTP_SMS_MAX_PER_HOUR.ceilingDefault,
  );
  const sourcesDisabled = parseWatchlistSourcesDisabled(env);
  read.issues.push(...sourcesDisabled.issues);
  // C72.5: the report limits, which both processes enforce (creation in the API, completion
  // reports and the media cap in the worker).
  const reports: ReportLimits = {
    perMinute: read.optional(
      'OPENVERIFY_RATE_LIMIT_REPORTS_PER_MINUTE',
      PHASE6_DEFAULTS.reportsPerMinute,
    ),
    maxRecurringPerEnvironment: read.optional(
      'OPENVERIFY_REPORTS_MAX_RECURRING_PER_ENVIRONMENT',
      PHASE6_DEFAULTS.maxRecurringPerEnvironment,
    ),
    maxMediaRunsPerDay: read.optional(
      'OPENVERIFY_REPORTS_MAX_MEDIA_RUNS_PER_DAY',
      PHASE6_DEFAULTS.maxMediaRunsPerDay,
    ),
  };
  const watchlists = readWatchlistSettings(read, readFor, sourcesDisabled.value);
  const network = readNetworkSettings(read, env, readFor, providers.settings);
  const reportProviders = readReportProviderCredentials(read, readFor, providers.settings);
  const playIntegrity = readPlayIntegritySettings(read, readFor, providers.settings);
  const pepper = read.required('OPENVERIFY_API_KEY_PEPPER');
  const serviceToken = read.required('OPENVERIFY_VISION_SERVICE_TOKEN');
  const settings = {
    host: read.optional('OPENVERIFY_API_HOST', DEFAULTS.host),
    port: read.optional('OPENVERIFY_API_PORT', DEFAULTS.port),
    logLevel: read.optional('OPENVERIFY_LOG_LEVEL', DEFAULTS.logLevel),
    trustProxy: read.optional('OPENVERIFY_TRUST_PROXY', false),
    endpoint: read.optional('S3_ENDPOINT', undefined),
    region: read.optional('S3_REGION', DEFAULTS.s3Region),
    forcePathStyle: read.optional('S3_FORCE_PATH_STYLE', true),
    corsOrigins: read.optional('OPENVERIFY_FLOW_CORS_ORIGINS', defaultOrigins),
    apiPerMinute: read.optional(
      'OPENVERIFY_RATE_LIMIT_API_PER_MINUTE',
      RATE_LIMIT_DEFAULTS_PER_MINUTE.api,
    ),
  };

  // api-operators: begin
  const operators = resolveOperatorSettings(
    {
      dashboardPublicUrl: read.optional('OPENVERIFY_DASHBOARD_PUBLIC_URL', undefined),
      bffToken: read.optional('OPENVERIFY_DASHBOARD_BFF_TOKEN', undefined),
      rpId: read.optional('OPENVERIFY_WEBAUTHN_RP_ID', undefined),
      rpName: read.optional('OPENVERIFY_WEBAUTHN_RP_NAME', undefined),
      origin: read.optional('OPENVERIFY_WEBAUTHN_ORIGIN', undefined),
      smtpUrl: read.optional('OPENVERIFY_SMTP_URL', undefined),
      mailFrom: read.optional('OPENVERIFY_MAIL_FROM', undefined),
    },
    mode,
  );
  read.issues.push(...operators.issues);
  // api-operators: end

  // foundation-11b: begin (Workflow 11B Stage 1b common; Stage 1a amendment 25)
  const consoleSessions = readConsoleSessions(read);
  const apiKeyPepperPrevious = readPreviousPeppers(read, pepper);
  const sso: SsoInstallSettings = { privateIssuers: readPrivateIssuers(read) };
  // C249.1: the stores' TLS settings and production warnings, from platform-ops' store-tls.ts.
  const storeTls = readStoreTls({
    production: mode === 'production',
    stores: TLS_STORES,
    urls: { postgres: databaseUrl, redis: redisUrl, s3: settings.endpoint, vision: visionUrl },
    caFiles: {
      postgres: read.optional('OPENVERIFY_POSTGRES_CA_FILE', null),
      redis: read.optional('OPENVERIFY_REDIS_CA_FILE', null),
      s3: read.optional('OPENVERIFY_S3_CA_FILE', null),
      vision: read.optional('OPENVERIFY_VISION_CA_FILE', null),
    },
  });
  read.issues.push(...storeTls.issues);
  startupWarnings.push(...storeTls.warnings);
  const workerHeartbeatFile = read.optional(
    'OPENVERIFY_WORKER_HEARTBEAT_FILE',
    WORKER_HEARTBEAT.defaultFile,
  );
  const internalListen = read.optional('OPENVERIFY_INTERNAL_LISTEN', null);
  const queueInFlightCapMax = read.optional(
    'OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX',
    QUEUE_IN_FLIGHT_CAP.ceilingDefault,
  );
  const watchlistUnOptInAllowed = read.optional(
    'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED',
    WATCHLIST_UN_OPT_IN_SWITCH.default,
  );
  const hstsMaxAge = read.optional('OPENVERIFY_HSTS_MAX_AGE', 0);
  // foundation-11b: end

  if (read.issues.length > 0) {
    throw new ConfigError(read.issues);
  }
  return {
    mode,
    host: settings.host,
    port: settings.port,
    logLevel: settings.logLevel,
    trustProxy: settings.trustProxy,
    databaseUrl: present(databaseUrl),
    redisUrl: present(redisUrl),
    s3: {
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: present(bucket),
      accessKeyId: present(accessKeyId),
      secretAccessKey: present(secretAccessKey),
      forcePathStyle: settings.forcePathStyle,
    },
    keyring: present(keyring),
    apiKeyPepper: new TextEncoder().encode(present(pepper)),
    blindIndexKey: present(blindIndexKey),
    flowPublicUrl: present(flowPublicUrl),
    flowCorsOrigins: [...new Set(settings.corsOrigins)],
    flowServerTokens,
    vision: { url: present(visionUrl), serviceToken: present(serviceToken) },
    rateLimits: { apiPerMinute: settings.apiPerMinute },
    reports,
    reportProviders,
    playIntegrity,
    process: readFor,
    providers: providers.settings,
    workflows,
    cases,
    twilio,
    clamdSocket,
    evmRpc,
    otpSmsMaxPerHourCeiling,
    companiesHouse,
    secEdgar: edgarUserAgent === undefined ? null : { userAgent: edgarUserAgent },
    nfc,
    watchlists,
    network,
    handoff,
    connect,
    // api-operators: begin
    operators: operators.settings,
    // api-operators: end
    // foundation-11b: begin
    consoleSessions,
    apiKeyPepperPrevious,
    sso,
    storeTls: storeTls.settings,
    workerHeartbeatFile,
    internalListen,
    queueInFlightCapMax,
    watchlistUnOptInAllowed,
    hstsMaxAge,
    startupWarnings,
    // foundation-11b: end
  };
}

/**
 * The mode (`OPENVERIFY_MODE`, else from `NODE_ENV`) and a reader for it, holding `issues` first
 * (the secret files' problems, which come before anything else is read).
 */
function readerFor(
  env: NodeJS.ProcessEnv,
  issues: readonly string[],
): { mode: AppMode; read: Reader } {
  const modeValue = env.OPENVERIFY_MODE;
  const modeParsed =
    modeValue === undefined || modeValue === ''
      ? null
      : SCHEMAS.OPENVERIFY_MODE.safeParse(modeValue);
  const mode = modeParsed?.success === true ? modeParsed.data : defaultAppMode(env.NODE_ENV);
  const read = new Reader(env, mode === 'production');
  read.issues.push(...issues);
  if (modeParsed?.success === false) {
    read.issues.push(`OPENVERIFY_MODE: must be one of ${APP_MODES.join(', ')}`);
  }
  return { mode, read };
}

/** C245.1: both limits, the absolute one never below the idle one. */
function readConsoleSessions(read: Reader): ConsoleSessionSettings {
  const idleTimeoutSeconds = read.optional(
    'OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS',
    CONSOLE_SESSION_TIMEOUTS.idleSeconds.default,
  );
  const absoluteTimeoutSeconds = read.optional(
    'OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS',
    CONSOLE_SESSION_TIMEOUTS.absoluteSeconds.default,
  );
  if (absoluteTimeoutSeconds < idleTimeoutSeconds) {
    read.issues.push(
      'OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS: must be at least OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS',
    );
  }
  return { idleTimeoutSeconds, absoluteTimeoutSeconds };
}

/**
 * C247.1: `OPENVERIFY_API_KEY_PEPPER_PREVIOUS`, comma-separated, at most two, each at least 32
 * characters and none the current pepper. Issues name the entry, never its value.
 */
function readPreviousPeppers(read: Reader, current: string | undefined): Uint8Array[] {
  const raw = read.optional('OPENVERIFY_API_KEY_PEPPER_PREVIOUS', null);
  if (raw === null) {
    return [];
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length > MAX_PREVIOUS_PEPPERS) {
    read.issues.push(
      `OPENVERIFY_API_KEY_PEPPER_PREVIOUS: holds at most ${String(MAX_PREVIOUS_PEPPERS)} peppers`,
    );
    return [];
  }
  const peppers: Uint8Array[] = [];
  for (const [index, entry] of entries.entries()) {
    const name = `OPENVERIFY_API_KEY_PEPPER_PREVIOUS: entry ${String(index + 1)}`;
    if (entry.length < MIN_SECRET_LENGTH) {
      read.issues.push(`${name} must be at least ${String(MIN_SECRET_LENGTH)} characters`);
    } else if (entry === current) {
      read.issues.push(`${name} must differ from OPENVERIFY_API_KEY_PEPPER`);
    } else {
      peppers.push(new TextEncoder().encode(entry));
    }
  }
  return peppers;
}

/** C248.3: `OPENVERIFY_SSO_PRIVATE_ISSUERS`, comma-separated http(s) URLs, at most 20. */
function readPrivateIssuers(read: Reader): string[] {
  const raw = read.optional('OPENVERIFY_SSO_PRIVATE_ISSUERS', null);
  if (raw === null) {
    return [];
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length > MAX_SSO_PRIVATE_ISSUERS) {
    read.issues.push(
      `OPENVERIFY_SSO_PRIVATE_ISSUERS: holds at most ${String(MAX_SSO_PRIVATE_ISSUERS)} issuers`,
    );
    return [];
  }
  const issuers: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const url = safeUrl(entry);
    if (
      url === null ||
      !HTTP.includes(url.protocol) ||
      url.username !== '' ||
      url.password !== ''
    ) {
      read.issues.push(
        `OPENVERIFY_SSO_PRIVATE_ISSUERS: entry ${String(index + 1)} must be an http(s) issuer URL`,
      );
    } else {
      issuers.push(entry);
    }
  }
  return issuers;
}

/** C249.3, C249.4 (Workflow 11B Stage 1b common): what `db:migrate` reads. */
export interface MigrateConfig {
  mode: AppMode;
  /** The runtime role's `DATABASE_URL`. Secret. */
  databaseUrl: string;
  /**
   * `OPENVERIFY_MIGRATION_DATABASE_URL`, the migration role's connection (C249.3), or `null`: then
   * `db:migrate` uses `databaseUrl` and warns in production (platform-ops). Secret.
   */
  migrationDatabaseUrl: string | null;
  /** `OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS` (1-3,600, default 600; C249.4). */
  lockTimeoutSeconds: number;
  storeTls: StoreTlsSettings;
  startupWarnings: readonly StartupWarning[];
}

/**
 * Reads `db:migrate`'s settings (C249.3, C249.4): every problem at once, as `loadConfig` does.
 * @throws {ConfigError} naming each invalid variable, never its value.
 */
export function loadMigrateConfig(rawEnv: NodeJS.ProcessEnv = process.env): MigrateConfig {
  const secretFiles = resolveSecretFiles(rawEnv, CONFIG_REGISTRY);
  const env = secretFiles.env;
  const { mode, read } = readerFor(env, secretFiles.issues);
  const databaseUrl = read.required('DATABASE_URL');
  const migrationDatabaseUrl = read.optional('OPENVERIFY_MIGRATION_DATABASE_URL', null);
  const lockTimeoutSeconds = read.optional(
    'OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS',
    MIGRATE_LOCK.timeoutSecondsDefault,
  );
  const storeTls = readStoreTls({
    production: mode === 'production',
    stores: ['postgres', 'redis'],
    urls: {
      postgres: migrationDatabaseUrl ?? databaseUrl,
      redis: env.REDIS_URL,
      s3: undefined,
      vision: undefined,
    },
    caFiles: {
      postgres: read.optional('OPENVERIFY_POSTGRES_CA_FILE', null),
      redis: read.optional('OPENVERIFY_REDIS_CA_FILE', null),
      s3: null,
      vision: null,
    },
  });
  read.issues.push(...storeTls.issues);
  if (read.issues.length > 0) {
    throw new ConfigError(read.issues);
  }
  return {
    mode,
    databaseUrl: present(databaseUrl),
    migrationDatabaseUrl,
    lockTimeoutSeconds,
    storeTls: storeTls.settings,
    startupWarnings: [...secretFiles.warnings, ...storeTls.warnings],
  };
}
