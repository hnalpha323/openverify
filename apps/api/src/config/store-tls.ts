/**
 * C249.1 (G-TLS; decision 13): the data stores' TLS settings. `DATABASE_URL` honours
 * `sslmode=verify-full` with `OPENVERIFY_POSTGRES_CA_FILE`; `REDIS_URL` accepts `rediss://` with
 * `OPENVERIFY_REDIS_CA_FILE` (and a username for a Valkey ACL user, which the Redis clients read
 * from the URL); the S3 endpoint `https` with `OPENVERIFY_S3_CA_FILE`; the vision URL `https` with
 * `OPENVERIFY_VISION_CA_FILE`; SMTP keeps STARTTLS. In production mode a store whose transport an
 * interceptor could read or replace is one `insecure_transport` warning (its name and the reason,
 * never the URL); nothing turns certificate verification off, and nothing refuses to start for a
 * plain-text store (in-cluster setups vary; the self-hosting guide requires TLS across hosts).
 *
 * `loadConfig` and `loadMigrateConfig` call `readStoreTls` with the parsed CA paths
 * (foundation-11b's hook; built by platform-ops, Phase 11, Workflow 11B); the container, the worker
 * and migrate call `applyStoreTls` once before they connect, which adds the named CAs to the
 * process's default trust store (`tls.setDefaultCACertificates`), the store every one of the four
 * clients (node-postgres, ioredis, the AWS SDK's HTTPS agent, undici) verifies against: one place,
 * whichever client opens the connection.
 *
 * Verification stays on: node-postgres treats `sslmode=prefer`, `require` and `verify-ca` as
 * `verify-full` (each still warned in production, so the URL says what happens), and the two
 * settings that would turn it off, `sslmode=no-verify` and `uselibpqcompat=true` with a mode below
 * `verify-full`, are refused at start. A loopback host is never warned: no network carries it.
 */
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import tls from 'node:tls';
import type { StartupWarning } from './startup-warnings.js';

/** The stores C249.1 names. */
export const TLS_STORES = ['postgres', 'redis', 's3', 'vision'] as const;
export type TlsStore = (typeof TLS_STORES)[number];

/** What the configuration hands `readStoreTls`: each store's URL (never logged) and CA path. */
export interface StoreTlsInput {
  readonly production: boolean;
  /** The stores this process connects to (migrate: postgres and redis). */
  readonly stores: readonly TlsStore[];
  /** Each store's URL as configured; `undefined` when the process does not read it. */
  readonly urls: Readonly<Record<TlsStore, string | undefined>>;
  /** `OPENVERIFY_<STORE>_CA_FILE`, an absolute path, or `null` when unset. */
  readonly caFiles: Readonly<Record<TlsStore, string | null>>;
}

/** The settings the processes apply before they connect. */
export interface StoreTlsSettings {
  readonly caFiles: Readonly<Record<TlsStore, string | null>>;
}

export interface StoreTlsResult {
  readonly settings: StoreTlsSettings;
  /** `<VARIABLE>: <problem>` lines (an unreadable CA file, say); never a URL. */
  readonly issues: readonly string[];
  readonly warnings: readonly StartupWarning[];
}

/** No CA file for any store: the settings of a configuration that names none. */
export const NO_STORE_TLS: StoreTlsSettings = Object.freeze({
  caFiles: Object.freeze({ postgres: null, redis: null, s3: null, vision: null }),
});

/** Reads a CA file's text; tests pass a fake. */
export type CaFileReader = (path: string) => string;

const readCaFile: CaFileReader = (path) => readFileSync(path, 'utf8');

/** Each store's variables and its name in a sentence. */
const STORE_INFO: Readonly<
  Record<TlsStore, { readonly url: string; readonly ca: string; readonly label: string }>
> = Object.freeze({
  postgres: { url: 'DATABASE_URL', ca: 'OPENVERIFY_POSTGRES_CA_FILE', label: 'Postgres' },
  redis: { url: 'REDIS_URL', ca: 'OPENVERIFY_REDIS_CA_FILE', label: 'Valkey' },
  s3: { url: 'S3_ENDPOINT', ca: 'OPENVERIFY_S3_CA_FILE', label: 'The S3 store' },
  vision: {
    url: 'OPENVERIFY_VISION_URL',
    ca: 'OPENVERIFY_VISION_CA_FILE',
    label: 'The vision service',
  },
});

/**
 * The certificates of a PEM text, one block each: Node's trust store takes one certificate per
 * entry, and a CA file often holds a chain.
 */
export function certificatesOf(text: string): string[] {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

/** Whether every block parses as an X.509 certificate. */
function parses(blocks: readonly string[]): boolean {
  try {
    for (const block of blocks) {
      new X509Certificate(block);
    }
    return true;
  } catch {
    return false;
  }
}
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** node-postgres' modes below `verify-full` that it still verifies as `verify-full`. */
const WEAKER_SSLMODES = new Set(['allow', 'prefer', 'require', 'verify-ca']);

const isLoopback = (url: URL): boolean =>
  LOOPBACK_HOSTS.has(url.hostname) || url.hostname.startsWith('127.');

interface Assessment {
  /** A start-up error: a setting that would turn verification off. */
  issue?: string;
  /** Why an interceptor could read or replace the transport (production only). */
  insecure?: string;
}

function assessPostgres(url: URL): Assessment {
  const sslmode = url.searchParams.get('sslmode');
  const libpq = url.searchParams.get('uselibpqcompat') === 'true';
  if (
    sslmode === 'no-verify' ||
    (libpq && sslmode !== null && sslmode !== 'verify-full' && sslmode !== 'disable')
  ) {
    return {
      issue:
        'DATABASE_URL: turns certificate verification off (sslmode=no-verify, or uselibpqcompat ' +
        'with a mode below verify-full); use sslmode=verify-full with OPENVERIFY_POSTGRES_CA_FILE',
    };
  }
  const ssl = url.searchParams.get('ssl');
  if (sslmode === null && (ssl === 'true' || ssl === '1')) {
    return {};
  }
  if (sslmode === null || sslmode === 'disable') {
    return {
      insecure:
        'Postgres connects in plain text; set sslmode=verify-full in DATABASE_URL, with ' +
        'OPENVERIFY_POSTGRES_CA_FILE for a private CA',
    };
  }
  if (WEAKER_SSLMODES.has(sslmode)) {
    return {
      insecure:
        `Postgres' sslmode=${sslmode} is below verify-full; set sslmode=verify-full, with ` +
        'OPENVERIFY_POSTGRES_CA_FILE for a private CA',
    };
  }
  return {};
}

function assessByProtocol(store: TlsStore, url: URL, secure: string): Assessment {
  const { label, url: variable, ca } = STORE_INFO[store];
  return url.protocol === secure
    ? {}
    : {
        insecure: `${label} connects in plain text; use ${secure.slice(0, -1)}:// in ${variable}, with ${ca} for a private CA`,
      };
}

function assess(store: TlsStore, text: string): Assessment {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // The configuration refuses an unparsable URL under its own name.
    return {};
  }
  if (isLoopback(url)) {
    const refusal = store === 'postgres' ? assessPostgres(url).issue : undefined;
    return refusal === undefined ? {} : { issue: refusal };
  }
  switch (store) {
    case 'postgres':
      return assessPostgres(url);
    case 'redis':
      return assessByProtocol(store, url, 'rediss:');
    case 's3':
    case 'vision':
      return assessByProtocol(store, url, 'https:');
  }
}

/** Reads the stores' TLS settings and the production warnings. */
export function readStoreTls(
  input: StoreTlsInput,
  read: CaFileReader = readCaFile,
): StoreTlsResult {
  const issues: string[] = [];
  const warnings: StartupWarning[] = [];
  for (const store of input.stores) {
    const caFile = input.caFiles[store];
    if (caFile !== null) {
      let text = '';
      try {
        text = read(caFile);
      } catch {
        issues.push(`${STORE_INFO[store].ca}: cannot be read`);
      }
      const blocks = certificatesOf(text);
      if (text !== '' && (blocks.length === 0 || !parses(blocks))) {
        issues.push(`${STORE_INFO[store].ca}: holds no PEM certificate`);
      }
    }
    const url = input.urls[store];
    if (url === undefined || url === '') {
      continue;
    }
    const assessment = assess(store, url);
    if (assessment.issue !== undefined) {
      issues.push(assessment.issue);
    }
    if (input.production && assessment.insecure !== undefined) {
      warnings.push({ code: 'insecure_transport', store, reason: assessment.insecure });
    }
  }
  return { settings: { caFiles: input.caFiles }, issues, warnings };
}

/** The part of `node:tls` `applyStoreTls` uses; tests pass a fake. */
export interface DefaultCaStore {
  getCACertificates(type: 'default'): string[];
  setDefaultCACertificates(certificates: string[]): void;
}

/**
 * Applies the settings to this process's clients, once, before the first connection: the named
 * CA files join the process's default trust store, beside the bundled roots.
 */
export function applyStoreTls(
  settings: StoreTlsSettings,
  read: CaFileReader = readCaFile,
  store: DefaultCaStore = tls,
): void {
  const pems = TLS_STORES.map((name) => settings.caFiles[name])
    .filter((path): path is string => path !== null)
    .flatMap((path) => certificatesOf(read(path)));
  if (pems.length === 0) {
    return;
  }
  if (typeof store.setDefaultCACertificates !== 'function') {
    throw new Error(
      'OPENVERIFY_*_CA_FILE: needs Node.js 22.19 or later (tls.setDefaultCACertificates)',
    );
  }
  const certificates = new Set([...store.getCACertificates('default'), ...pems]);
  store.setDefaultCACertificates([...certificates]);
}
