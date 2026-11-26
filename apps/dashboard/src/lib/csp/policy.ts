/**
 * The console's script CSP (C170; K16, S17; decision 51): one nonce per request, the policy
 * `proxy.ts` sends, the enforce or report-only mode, and the flow origin the console reads from its
 * configuration (`dashboard-preview` imports it from here). The console reads no public origin of
 * its own: the preview compares the flow origin with the page's `window.location.origin` (K9-13).
 *
 * No import: `proxy.ts` runs this module outside the React server graph, where `server-only`
 * is not resolvable, and nothing here is secret.
 */

/** The request header that carries the nonce to the render (as Next.js's guide names it). */
export const CSP_NONCE_HEADER = 'x-nonce';

/** Where browsers send violation reports, served by `app/csp-reports/route.ts`. */
export const CSP_REPORT_PATH = '/csp-reports';

/** The `report-to` group name of `Reporting-Endpoints`. */
export const CSP_REPORT_GROUP = 'csp';

/** `Reporting-Endpoints`: the `report-to` group, resolved against the page's own origin. */
export const REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

export const CSP_MODE_ENV = 'OPENVERIFY_DASHBOARD_CSP_MODE';
export const FLOW_PUBLIC_URL_ENV = 'OPENVERIFY_FLOW_PUBLIC_URL';

export type CspMode = 'enforce' | 'report-only';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `OPENVERIFY_DASHBOARD_CSP_MODE`: `report-only` exactly (around whitespace) reports without
 * blocking; anything else, unset or unknown, enforces, so a typo never switches the policy off.
 */
export function cspMode(env: Env = process.env): CspMode {
  return env[CSP_MODE_ENV]?.trim() === 'report-only' ? 'report-only' : 'enforce';
}

/** The response (and render) header the mode sends the policy in. */
export function cspHeaderName(
  mode: CspMode,
): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  return mode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

/**
 * The origin of an http(s) URL setting, or `null` when it is unset or anything else: a URL with
 * credentials, a query or a fragment is a configuration error, never half-used. `URL.origin` is
 * lower case and holds no character that could end a CSP source or directive.
 */
function originOf(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  if (text === '' || !URL.canParse(text)) {
    return null;
  }
  const url = new URL(text);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return null;
  }
  return url.origin;
}

/** The flow's origin from `OPENVERIFY_FLOW_PUBLIC_URL` (the preview frame's `src`), or `null`. */
export function flowPublicOrigin(env: Env = process.env): string | null {
  return originOf(env[FLOW_PUBLIC_URL_ENV]);
}

/** 128 random bits in base64, the grammar Next.js reads a nonce from. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export interface ConsoleCspOptions {
  readonly nonce: string;
  /** `flowPublicOrigin()`; `null` frames nothing. */
  readonly flowOrigin: string | null;
  /** `next dev`: React needs `eval` for its debugging stacks there, and only there. */
  readonly development: boolean;
}

/** C170.1's policy, exactly, for one request. */
export function consoleCsp({ nonce, flowOrigin, development }: ConsoleCspOptions): string {
  const script = `'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`;
  return [
    "default-src 'self'",
    `script-src ${script}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${flowOrigin ?? "'none'"}`,
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${CSP_REPORT_GROUP}`,
  ].join('; ');
}
