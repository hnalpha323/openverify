/**
 * C92.1 (ADR 0006): the committed network source manifest, `network/sources.json` at the
 * repository (or image) root. One entry per source: its publisher and role, the parser of its
 * format (`NETWORK_PARSERS` of `@openverify/signals/network`), the files the sync downloads (fixed
 * URLs, or DB-IP's `{yyyy-mm}` template: the current UTC month, then the previous one, since the
 * publisher keeps two months online), the one host a redirect may go to, the content types
 * (`none` accepts TorDNSEL's untyped answer), the byte caps (compressed and inflated), the deadline,
 * gunzip, the publisher's digest page (DB-IP's SHA-1 covers the decompressed file), the shortest
 * prefixes a range source may publish (the mass-addition guard, P27), the refresh and staleness
 * intervals, whether it is enabled by default or sandbox-only, its terms note, its attribution line
 * and the link-back its terms ask for. Live network data never comes from git: the manifest says
 * where the operator's sync fetches it, and nothing is downloaded by a test.
 *
 * The schema is strict: it names no change signal (owner decision 10 after Workflow 6B, which C92.1
 * inherits) and refuses one; it refuses plain HTTP and the hosts whose terms fail rule 4 (IPinfo's
 * data, IP2Location's downloads, MaxMind, Nominatim, iptoasn, Route Views). Owner: `api-network`
 * (Workflow 7A Stage 3).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NETWORK_PARSERS,
  NETWORK_SOURCE_ROLES,
  type NetworkParserName,
  type NetworkSourceRole,
} from '@openverify/signals/network';
import { z } from 'zod';

/** The manifest's format name. */
export const NETWORK_MANIFEST_FORMAT = 'openverify/network-sources/v1';

/** A `content_types` entry that accepts an answer without a `Content-Type` (TorDNSEL's). */
export const NETWORK_CONTENT_TYPE_NONE = 'none';

/** One network source (C92.1). */
export interface NetworkManifestSource {
  id: string;
  publisher: string;
  role: NetworkSourceRole;
  parser: NetworkParserName;
  /** The provider label of a `prefix-list` or `rfc8805-geofeed` source's ranges. */
  provider: string | null;
  /** The files downloaded, or none for an import-only source. */
  urls: string[];
  /** A URL with `{yyyy-mm}`: the current UTC month, then the previous one. */
  url_template: string | null;
  redirect_host: string | null;
  content_types: string[];
  max_bytes: { compressed: number; inflated: number };
  timeout_seconds: number | null;
  decompress: 'gzip' | null;
  /** The publisher's digest page, whose digest covers the decompressed file. */
  digest: { page_url: string; algorithm: 'sha1' } | null;
  /** The shortest prefixes a range source may publish (C92.2, P27). */
  min_prefix: { ipv4: number; ipv6: number } | null;
  refresh_interval_hours: number | null;
  stale_after_hours: number | null;
  enabled_by_default: boolean;
  sandbox_only: boolean;
  terms: { note: string; url: string | null };
  attribution: string;
  link_back: string | null;
}

/** The mass-change guards' thresholds (C92.2), with their basis. */
export interface NetworkManifestGuards {
  mass_removal_share: number;
  mass_addition_share: number;
  mmdb_min_size_share: number;
  basis: string;
}

export interface NetworkManifest {
  $comment?: string | undefined;
  format: typeof NETWORK_MANIFEST_FORMAT;
  guards: NetworkManifestGuards;
  sources: NetworkManifestSource[];
}

/** C92.1: the hosts (and paths) whose terms fail rule 4; no source URL may name one. */
export const REFUSED_NETWORK_HOSTS: readonly { host: RegExp; path: RegExp }[] = Object.freeze([
  { host: /(^|\.)ipinfo\.io$/i, path: /^\/data(\/|$)/i },
  { host: /(^|\.)ip2location\.com$/i, path: /^\/download/i },
  { host: /(^|\.)maxmind\.com$/i, path: /^/ },
  { host: /(^|\.)nominatim\.openstreetmap\.org$/i, path: /^/ },
  { host: /(^|\.)iptoasn\.com$/i, path: /^/ },
  { host: /(^|\.)routeviews\.org$/i, path: /^/ },
]);

function allowedHost(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.replace('{yyyy-mm}', '2000-01'));
  } catch {
    return false;
  }
  return !REFUSED_NETWORK_HOSTS.some(
    (refused) => refused.host.test(url.hostname) && refused.path.test(url.pathname),
  );
}

const REFUSED_HOST = 'a host whose terms fail rule 4 is never a network source (C92.1)';
const httpsUrl = z.url({ protocol: /^https$/ }).refine(allowedHost, REFUSED_HOST);
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const host = z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/);
const sourceId = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  .max(64);

/** The parsers each role reads (`@openverify/signals/network`'s lookups take them by role). */
const ROLE_PARSERS: Readonly<Record<NetworkSourceRole, readonly NetworkParserName[]>> = {
  'geo-country': ['mmdb-country'],
  'geo-city': ['mmdb-city'],
  asn: ['mmdb-asn'],
  tor: ['tordnsel-exit-addresses'],
  'cloud-ranges': [
    'aws-ip-ranges',
    'gcp-cloud-json',
    'oracle-public-ip-ranges',
    'cloudflare-ips-api',
    'prefix-list',
    'rfc8805-geofeed',
    'azure-service-tags',
  ],
  relay: ['rfc8805-geofeed', 'prefix-list'],
  sandbox: ['openverify-sandbox-network'],
};
/** The parsers that need the source's provider label. */
const LABELLED_PARSERS: ReadonlySet<NetworkParserName> = new Set([
  'prefix-list',
  'rfc8805-geofeed',
]);

export const networkManifestSourceSchema = z
  .strictObject({
    id: sourceId,
    publisher: z.string().min(1).max(200),
    role: z.enum(NETWORK_SOURCE_ROLES),
    parser: z.enum(NETWORK_PARSERS),
    provider: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .nullable(),
    urls: z.array(httpsUrl).max(4),
    url_template: httpsUrl
      .refine((value) => value.includes('{yyyy-mm}'), 'a URL template names {yyyy-mm}')
      .nullable(),
    redirect_host: host.nullable(),
    content_types: z
      .array(
        z.union([z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/), z.literal(NETWORK_CONTENT_TYPE_NONE)]),
      )
      .max(8),
    max_bytes: z.strictObject({ compressed: z.int().min(1), inflated: z.int().min(1) }),
    timeout_seconds: z.int().min(1).max(3600).nullable(),
    decompress: z.literal('gzip').nullable(),
    digest: z.strictObject({ page_url: httpsUrl, algorithm: z.literal('sha1') }).nullable(),
    min_prefix: z
      .strictObject({ ipv4: z.int().min(1).max(32), ipv6: z.int().min(1).max(128) })
      .nullable(),
    refresh_interval_hours: z.int().min(1).max(8760).nullable(),
    stale_after_hours: z.int().min(1).max(8760).nullable(),
    enabled_by_default: z.boolean(),
    sandbox_only: z.boolean(),
    terms: z.strictObject({ note: z.string().min(1).max(1000), url: httpsUrl.nullable() }),
    attribution: z.string().min(1).max(500),
    link_back: httpsUrl.nullable(),
  })
  .superRefine((source, context) => {
    const issue = (message: string) => {
      context.addIssue({ code: 'custom', message });
    };
    if ((source.role === 'sandbox') !== source.sandbox_only) {
      issue('only the sandbox role is sandbox-only, and it always is');
    }
    if (!ROLE_PARSERS[source.role].includes(source.parser)) {
      issue('the parser does not read this role');
    }
    if (LABELLED_PARSERS.has(source.parser) && source.provider === null) {
      issue('a prefix list or geofeed needs its provider label');
    }
    if ((source.role === 'cloud-ranges' || source.role === 'relay') && source.min_prefix === null) {
      issue('a range source states its shortest prefixes (the mass-addition guard)');
    }
    if (source.url_template !== null && source.urls.length > 0) {
      issue('a source has fixed URLs or a URL template, not both');
    }
    const downloads = source.urls.length > 0 || source.url_template !== null;
    if (downloads && source.content_types.length === 0) {
      issue('a downloaded source names its content types');
    }
    if (downloads && source.refresh_interval_hours === null) {
      issue('a downloaded source names its refresh interval');
    }
    if (!source.sandbox_only && source.stale_after_hours === null) {
      issue('only the sandbox source is never stale');
    }
    if (source.max_bytes.inflated < source.max_bytes.compressed) {
      issue('the inflated cap is at least the compressed cap');
    }
  });
export type NetworkManifestSourceDocument = z.infer<typeof networkManifestSourceSchema>;

export const networkManifestSchema = z.strictObject({
  $comment: z.string().optional(),
  format: z.literal(NETWORK_MANIFEST_FORMAT),
  guards: z.strictObject({
    mass_removal_share: z.number().gt(0).lt(1),
    mass_addition_share: z.number().gt(0),
    mmdb_min_size_share: z.number().gt(0).lt(1),
    basis: z.string().min(1).max(1000),
  }),
  sources: z
    .array(networkManifestSourceSchema)
    .max(64)
    .refine((sources) => new Set(sources.map(({ id }) => id)).size === sources.length, {
      message: 'a source id occurs twice',
    }),
});

/** The manifest's path: `network/sources.json` at the repository (or image) root. */
export function defaultNetworkManifestPath(): string {
  return join(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
    'network',
    'sources.json',
  );
}

/**
 * Validates a parsed manifest document.
 * @throws {z.ZodError} naming the failing field, never a value.
 */
export function parseNetworkManifest(value: unknown): NetworkManifest {
  return networkManifestSchema.parse(value);
}

/**
 * Reads and validates the manifest at `path`.
 * @throws {Error} when the file is missing or does not validate.
 */
export function loadNetworkManifest(path: string = defaultNetworkManifestPath()): NetworkManifest {
  return parseNetworkManifest(JSON.parse(readFileSync(path, 'utf8')));
}

let committed: NetworkManifest | undefined;

/** The committed manifest, read once per process. */
export function networkManifest(): NetworkManifest {
  committed ??= loadNetworkManifest();
  return committed;
}

/** A manifest source by id, or `undefined` for an id the manifest does not know. */
export function networkManifestSource(
  id: string,
  manifest: NetworkManifest = networkManifest(),
): NetworkManifestSource | undefined {
  return manifest.sources.find((source) => source.id === id);
}
