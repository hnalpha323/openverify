/**
 * C157.2, C158.1 (Workflow 9A Stage 1a, (F); verification round V04): the one matcher of allowed
 * origins, the origin grammar, and the guard of the internal embed-policy answer. This module
 * imports nothing, so `apps/flow/server.ts` loads it from source with
 * `node --conditions=@openverify/source` through the subpath `@openverify/contracts/origin-pattern`;
 * the settings validator, the API's embed policy and the embed bridge import the same functions.
 * `contracts/fixtures/origin-pattern/vectors.json` holds their golden vectors.
 *
 * An entry is a CSP host-source: `https://host[:port]` or `https://*.host[:port]`, lowercase ASCII
 * (an IDN as `xn--`), with no path, query, fragment, userinfo, IP literal, bare `*` or `*` port. A
 * wildcard needs two labels after `*.`, never a shared-hosting suffix of our own short list (the
 * Public Suffix List is MPL-2.0 and cannot run in the API, so the list is documented as incomplete).
 * Production refuses `http:` and `localhost`; a sandbox also takes `http://localhost[:port]` and
 * `http://127.0.0.1[:port]`.
 */

/** C158.1: at most this many allowed origins per environment and per version. */
export const MAX_ORIGIN_ENTRIES = 50;

/**
 * C158.1 (review P08; ours, incomplete by design): suffixes under which every subdomain is a
 * different tenant, so a wildcard over one would allow strangers to frame a flow.
 */
export const SHARED_HOSTING_SUFFIXES: readonly string[] = Object.freeze([
  'vercel.app',
  'github.io',
  'netlify.app',
  'pages.dev',
  'herokuapp.com',
  'web.app',
  'firebaseapp.com',
  'azurewebsites.net',
  'cloudfront.net',
  'appspot.com',
  'onrender.com',
  'fly.dev',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.jp',
  'com.br',
  'com.cn',
  'co.in',
  'co.za',
  'com.mx',
  'com.tr',
  'com.sg',
  'co.kr',
]);

export type OriginEnvironmentKind = 'sandbox' | 'production';

/** Why an entry is refused; `null` when it is accepted. */
export type OriginEntryRefusal =
  | 'not_an_origin'
  | 'scheme'
  | 'userinfo'
  | 'path'
  | 'ip_literal'
  | 'bare_wildcard'
  | 'wildcard_port'
  | 'wildcard_too_short'
  | 'shared_hosting_suffix'
  | 'not_lowercase_ascii'
  | 'localhost_in_production';

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const ENTRY = new RegExp(`^(https?)://(\\*\\.)?(${LABEL}(?:\\.${LABEL})*)(?::([0-9]{1,5}))?$`);
const ORIGIN = new RegExp(`^(https?)://(${LABEL}(?:\\.${LABEL})*)(?::([0-9]{1,5}))?$`);
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const IPV4 = /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/;

interface ParsedHostSource {
  readonly scheme: 'http' | 'https';
  readonly wildcard: boolean;
  readonly host: string;
  readonly port: number;
}

const DEFAULT_PORT = { http: 80, https: 443 } as const;

function portOf(raw: string | undefined, scheme: 'http' | 'https'): number | null {
  if (raw === undefined) {
    return DEFAULT_PORT[scheme];
  }
  if (raw.startsWith('0')) {
    return null;
  }
  const port = Number(raw);
  return port >= 1 && port <= 65_535 ? port : null;
}

function parseEntry(entry: string): ParsedHostSource | null {
  const match = ENTRY.exec(entry);
  if (match === null) {
    return null;
  }
  const scheme = match[1] as 'http' | 'https';
  const port = portOf(match[4], scheme);
  return port === null
    ? null
    : { scheme, wildcard: match[2] !== undefined, host: match[3] ?? '', port };
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * Why `entry` is not an allowed origin in `environment`, or `null` when it is (C158.1).
 */
export function checkOriginEntry(
  entry: string,
  environment: OriginEnvironmentKind,
): OriginEntryRefusal | null {
  if (typeof entry !== 'string' || entry.length === 0 || entry.length > 300) {
    return 'not_an_origin';
  }
  if (entry === '*' || /^[a-z]+:\/\/\*$/.test(entry)) {
    return 'bare_wildcard';
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(entry)?.[1];
  if (scheme === undefined) {
    return 'not_an_origin';
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return /[A-Z]/.test(scheme) ? 'not_lowercase_ascii' : 'scheme';
  }
  const rest = entry.slice(scheme.length + 3);
  if (/[\s;,'"\\]/.test(rest)) {
    return 'not_an_origin';
  }
  if (rest.includes('@')) {
    return 'userinfo';
  }
  if (/[/?#]/.test(rest)) {
    return 'path';
  }
  if (rest.startsWith('[')) {
    return 'ip_literal';
  }
  if (rest.endsWith(':*')) {
    return 'wildcard_port';
  }
  if (/[^\x21-\x7e]/.test(rest) || /[A-Z]/.test(rest)) {
    return 'not_lowercase_ascii';
  }
  const parsed = parseEntry(entry);
  if (parsed === null) {
    return 'not_an_origin';
  }
  const local = !parsed.wildcard && isLocalHost(parsed.host);
  if (local) {
    if (environment === 'production') {
      return 'localhost_in_production';
    }
    return parsed.host === '127.0.0.1' && parsed.scheme === 'https' ? 'ip_literal' : null;
  }
  if (IPV4.test(parsed.host)) {
    return 'ip_literal';
  }
  if (parsed.scheme === 'http') {
    return 'scheme';
  }
  if (parsed.wildcard) {
    if (parsed.host.split('.').length < 2) {
      return 'wildcard_too_short';
    }
    if (SHARED_HOSTING_SUFFIXES.includes(parsed.host)) {
      return 'shared_hosting_suffix';
    }
  }
  return null;
}

/** Whether `entry` is an allowed origin in `environment`. */
export function isOriginEntry(entry: string, environment: OriginEnvironmentKind): boolean {
  return checkOriginEntry(entry, environment) === null;
}

/** Whether a grammatical entry is a wildcard (a production one needs its acknowledgement, V17). */
export function isWildcardOriginEntry(entry: string): boolean {
  return parseEntry(entry)?.wildcard === true;
}

/**
 * C158.1: whether the serialised `origin` (`scheme://host[:port]`, as `event.origin` and the
 * `Origin` header give it) matches `entry`, by CSP host-source matching: the scheme equal, the
 * port equal with the scheme's default filled in, the host equal or, for `*.host`, a subdomain at
 * any depth on a dot boundary (never the bare host). So `https://evilhost.com` never matches
 * `https://*.host.com`. A malformed origin or entry matches nothing.
 */
export function matchesOriginPattern(origin: string, entry: string): boolean {
  if (typeof origin !== 'string' || typeof entry !== 'string') {
    return false;
  }
  const parsed = parseEntry(entry);
  const match = ORIGIN.exec(origin);
  if (parsed === null || match === null) {
    return false;
  }
  const scheme = match[1] as 'http' | 'https';
  const host = match[2] ?? '';
  const port = portOf(match[3], scheme);
  if (scheme !== parsed.scheme || port !== parsed.port) {
    return false;
  }
  return parsed.wildcard ? host.endsWith(`.${parsed.host}`) : host === parsed.host;
}

/** The internal embed-policy answer (C157.2), read into its members. */
export interface EmbedPolicyAnswer {
  readonly inquiryId: string;
  readonly templateId: string;
  readonly environmentId: string;
  readonly frameAncestors: readonly string[];
}

/** The three ids of an answer, as `idSchema` reads them; fixed patterns, never built from input. */
const ID_PATTERNS = {
  inq: /^inq_[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
  itmpl: /^itmpl_[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
  env: /^env_[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
} as const;
const isPrefixedId = (value: unknown, prefix: keyof typeof ID_PATTERNS): value is string =>
  typeof value === 'string' && ID_PATTERNS[prefix].test(value);

const ANSWER_KEYS = ['inquiry-id', 'template-id', 'environment-id', 'frame-ancestors'];

/**
 * C157.2 (V04): the flow server's guard of the internal embed-policy answer, held to the frozen zod
 * schema (`embedPolicyAnswerSchema`) by a contracts test over the same golden vectors. Every
 * origin is re-checked against the grammar (as in a sandbox: the API has already applied the
 * environment's rules), so a stored value can never inject a directive or a header. `null` for
 * anything else, which the flow server answers with `frame-ancestors 'none'`.
 */
export function parseEmbedPolicyAnswer(value: unknown): EmbedPolicyAnswer | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record);
  if (keys.length !== ANSWER_KEYS.length || !ANSWER_KEYS.every((key) => keys.includes(key))) {
    return null;
  }
  const ancestors = record['frame-ancestors'];
  if (
    !isPrefixedId(record['inquiry-id'], 'inq') ||
    !isPrefixedId(record['template-id'], 'itmpl') ||
    !isPrefixedId(record['environment-id'], 'env') ||
    !Array.isArray(ancestors) ||
    ancestors.length > MAX_ORIGIN_ENTRIES ||
    !ancestors.every((entry) => typeof entry === 'string' && isOriginEntry(entry, 'sandbox'))
  ) {
    return null;
  }
  return {
    inquiryId: record['inquiry-id'],
    templateId: record['template-id'],
    environmentId: record['environment-id'],
    frameAncestors: ancestors as string[],
  };
}
