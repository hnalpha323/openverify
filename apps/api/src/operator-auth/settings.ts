/**
 * Operator settings (contract C15), read from the environment by `loadConfig`:
 *
 * | Variable | Purpose | Default outside production |
 * |---|---|---|
 * | `OPENVERIFY_TRUST_PROXY` | `false`, a hop count, or a comma-separated CIDR list, passed to Fastify `trustProxy` | `false` |
 * | `OPENVERIFY_DASHBOARD_PUBLIC_URL` | Base of invitation links | `http://localhost:3001` |
 * | `OPENVERIFY_DASHBOARD_BFF_TOKEN` | Proves a request comes from the dashboard BFF (client address) | none |
 * | `OPENVERIFY_WEBAUTHN_RP_ID`, `_RP_NAME`, `_ORIGIN` | WebAuthn relying party | the dashboard's host, `OpenVerify`, the dashboard's origin |
 * | `OPENVERIFY_SMTP_URL` | `smtp://` or `smtps://` server for invitations | Mailpit, `smtp://127.0.0.1:1025` |
 * | `OPENVERIFY_MAIL_FROM` | Sender of invitations | `OpenVerify <no-reply@localhost>` |
 *
 * Production assumes nothing about the deployment: without the dashboard URL there are no
 * invitation links, without an RP there is no WebAuthn, and without SMTP no email; the
 * routes that need them answer 503 naming the variable.
 */
import { isIP } from 'node:net';
import { safeUrl } from '@openverify/contracts';
import { z } from 'zod';

export type TrustProxySetting = boolean | number | string[];

export interface WebauthnSettings {
  /** The relying party ID: the dashboard's domain or a parent of it. */
  rpId: string;
  /** Shown by authenticators. */
  rpName: string;
  /** The dashboard origin the browser reports in `clientDataJSON`. */
  origin: string;
}

export interface OperatorSettings {
  dashboardPublicUrl: string | undefined;
  bffToken: string | undefined;
  webauthn: WebauthnSettings | undefined;
  smtpUrl: string | undefined;
  mailFrom: string;
}

export const DEFAULT_DEVELOPMENT_DASHBOARD_URL = 'http://localhost:3001';
export const DEFAULT_DEVELOPMENT_SMTP_URL = 'smtp://127.0.0.1:1025';
export const DEFAULT_MAIL_FROM = 'OpenVerify <no-reply@localhost>';
export const DEFAULT_RP_NAME = 'OpenVerify';

/** Names `proxy-addr` (used by Fastify) understands for well-known ranges. */
const PROXY_RANGE_NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const MAX_HOPS = 100;

function isAddressOrRange(entry: string): boolean {
  if (PROXY_RANGE_NAMES.has(entry)) {
    return true;
  }
  const [address = '', bits, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) {
    return false;
  }
  if (bits === undefined) {
    return true;
  }
  const max = family === 4 ? 32 : 128;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= max;
}

/**
 * `OPENVERIFY_TRUST_PROXY`: `false` (or `0`) trusts no proxy, so `request.ip` is the socket
 * peer; a hop count trusts that many proxies; a comma-separated list of addresses and CIDR
 * ranges trusts proxies inside them. `true` (trust every proxy) stays accepted from Phase 1.
 */
export const trustProxySchema = z.string().transform((value, context): TrustProxySetting => {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'false') return false;
  if (lower === 'true') return true;
  if (/^\d+$/.test(trimmed)) {
    const hops = Number(trimmed);
    if (hops <= MAX_HOPS) {
      return hops === 0 ? false : hops;
    }
  } else {
    const entries = trimmed.split(',').map((entry) => entry.trim());
    if (entries.every(isAddressOrRange)) {
      return entries;
    }
  }
  context.addIssue({
    code: 'custom',
    message: 'must be false, a hop count, or a comma-separated list of addresses and CIDR ranges',
  });
  return z.NEVER;
});

/** Fastify's `trustProxy` option: what `proxy-addr` decides `request.ip` with. */
export type FastifyTrustProxy = boolean | string[] | ((address: string, hop: number) => boolean);

/**
 * The Fastify form of a trust setting. Fastify 5 ignores a numeric `trustProxy` (it fails
 * closed), so a hop count becomes the equivalent function: trust the first `hops` addresses,
 * counting from the socket peer. Hop counts suit an API reachable only through its proxies;
 * prefer the proxies' CIDR ranges otherwise.
 */
export function fastifyTrustProxy(setting: TrustProxySetting): FastifyTrustProxy {
  if (typeof setting === 'number') {
    return (_address, hop) => hop < setting;
  }
  return setting;
}

const HTTP = ['http:', 'https:'];

const dashboardUrlSchema = z
  .string()
  .transform((value) => value.trim().replace(/\/+$/, ''))
  .refine((value) => {
    const url = safeUrl(value);
    return (
      url !== null &&
      HTTP.includes(url.protocol) &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    );
  }, 'must be an absolute http(s) URL without a query, fragment or credentials');

/** A WebAuthn RP ID is a domain (no scheme, port or path), never an IP address. */
const rpIdSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine(
    (value) =>
      isIP(value) === 0 &&
      value.length <= 253 &&
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
        value,
      ),
    'must be a domain name such as example.com',
  );

const originSchema = z
  .string()
  .transform((value) => value.trim().replace(/\/$/, ''))
  .refine((value) => {
    const url = safeUrl(value);
    return url !== null && HTTP.includes(url.protocol) && url.origin === value;
  }, 'must be an origin such as https://dashboard.example.com');

const smtpUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    const url = safeUrl(value);
    return url !== null && ['smtp:', 'smtps:'].includes(url.protocol) && url.hostname !== '';
  }, 'must be an smtp:// or smtps:// URL');

const mailFromSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .refine((value) => !/[\r\n]/.test(value), 'must be one line, such as Name <address@example.com>');

/** The schemas `loadConfig` reads the C15 variables with. */
export const OPERATOR_SETTING_SCHEMAS = {
  OPENVERIFY_DASHBOARD_PUBLIC_URL: dashboardUrlSchema,
  OPENVERIFY_DASHBOARD_BFF_TOKEN: z.string().min(32, 'must be at least 32 characters'),
  OPENVERIFY_WEBAUTHN_RP_ID: rpIdSchema,
  OPENVERIFY_WEBAUTHN_RP_NAME: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !/\p{Cc}/u.test(value), 'must not contain control characters'),
  OPENVERIFY_WEBAUTHN_ORIGIN: originSchema,
  OPENVERIFY_SMTP_URL: smtpUrlSchema,
  OPENVERIFY_MAIL_FROM: mailFromSchema,
} as const;

/** The variables read, already validated; `undefined` when unset. */
export interface OperatorSettingValues {
  dashboardPublicUrl?: string | undefined;
  bffToken?: string | undefined;
  rpId?: string | undefined;
  rpName?: string | undefined;
  origin?: string | undefined;
  smtpUrl?: string | undefined;
  mailFrom?: string | undefined;
}

/** Whether `host` is `rpId` or one of its subdomains (WebAuthn §5.1.3 RP ID check). */
function isOnRpId(host: string, rpId: string): boolean {
  return host === rpId || host.endsWith(`.${rpId}`);
}

/**
 * The operator settings with the defaults of `mode` applied, and any problem of the
 * combination, as `<VARIABLE>: <problem>` lines.
 */
export function resolveOperatorSettings(
  values: OperatorSettingValues,
  mode: 'production' | 'development' | 'test',
): { settings: OperatorSettings; issues: string[] } {
  const production = mode === 'production';
  const issues: string[] = [];
  const dashboardPublicUrl =
    values.dashboardPublicUrl ?? (production ? undefined : DEFAULT_DEVELOPMENT_DASHBOARD_URL);
  const dashboard = dashboardPublicUrl === undefined ? null : safeUrl(dashboardPublicUrl);
  const rpId = values.rpId ?? dashboard?.hostname;
  const origin = values.origin ?? dashboard?.origin;
  let webauthn: WebauthnSettings | undefined;
  if (rpId !== undefined && origin !== undefined) {
    if (isOnRpId(new URL(origin).hostname, rpId)) {
      webauthn = { rpId, rpName: values.rpName ?? DEFAULT_RP_NAME, origin };
    } else {
      issues.push(
        'OPENVERIFY_WEBAUTHN_ORIGIN: must be on OPENVERIFY_WEBAUTHN_RP_ID or one of its subdomains',
      );
    }
  }
  return {
    settings: {
      dashboardPublicUrl,
      bffToken: values.bffToken,
      webauthn,
      smtpUrl: values.smtpUrl ?? (production ? undefined : DEFAULT_DEVELOPMENT_SMTP_URL),
      mailFrom: values.mailFrom ?? DEFAULT_MAIL_FROM,
    },
    issues,
  };
}
