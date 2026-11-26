/**
 * Hosted-flow links:
 * - `POST /inquiries/:id/resume` (C2): `${OPENVERIFY_FLOW_PUBLIC_URL}/#inquiry-id=<id>&session-token=<token>`;
 * - one-time links (C10): `${OPENVERIFY_FLOW_PUBLIC_URL}/#inquiry-id=<id>&one-time-token=ovo_...`.
 *
 * The credentials travel in the fragment, which browsers never send to servers or in
 * `Referer`; the flow reads them once and then clears the fragment.
 */
import { isId } from './ids.js';
import { oneTimeLinkTokenSchema, sessionTokenSchema } from './tokens.js';

export interface FlowUrlCredentials {
  inquiryId: string;
  sessionToken: string;
}

/** The credentials of a one-time link (C10), which the flow redeems for a session token. */
export interface OneTimeLinkCredentials {
  inquiryId: string;
  oneTimeToken: string;
}

/** What a flow fragment carries: a session, or a one-time link to redeem first (C19). */
export type FlowLinkCredentials =
  ({ kind: 'session' } & FlowUrlCredentials) | ({ kind: 'one-time-link' } & OneTimeLinkCredentials);

const INQUIRY_ID_PARAM = 'inquiry-id';
const SESSION_TOKEN_PARAM = 'session-token';
const ONE_TIME_TOKEN_PARAM = 'one-time-token';

/**
 * Parses an absolute URL, or returns `null`. zod runs object refinements even after a
 * field's format check failed, so refinements use this instead of `new URL()`.
 */
export function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function assertBaseUrl(baseUrl: string): void {
  const url = safeUrl(baseUrl);
  if (url === null) {
    throw new TypeError('The flow base URL must be an absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('The flow base URL must use http or https');
  }
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new TypeError('The flow base URL must not carry a query, fragment or credentials');
  }
}

/**
 * Builds the hosted-flow link for an inquiry session. IDs and tokens use URL-safe alphabets,
 * so no escaping is needed.
 * @throws {TypeError} for a malformed base URL, inquiry ID or session token.
 */
export function buildFlowUrl(baseUrl: string, inquiryId: string, sessionToken: string): string {
  assertBaseUrl(baseUrl);
  if (!isId('inq', inquiryId)) {
    throw new TypeError('Malformed inquiry ID');
  }
  if (!sessionTokenSchema.safeParse(sessionToken).success) {
    throw new TypeError('Malformed session token');
  }
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/#${INQUIRY_ID_PARAM}=${inquiryId}&${SESSION_TOKEN_PARAM}=${sessionToken}`;
}

/**
 * Builds a one-time link (C10). The flow redeems the token once for a session token.
 * @throws {TypeError} for a malformed base URL, inquiry ID or one-time token.
 */
export function buildOneTimeLinkUrl(
  baseUrl: string,
  inquiryId: string,
  oneTimeToken: string,
): string {
  assertBaseUrl(baseUrl);
  if (!isId('inq', inquiryId)) {
    throw new TypeError('Malformed inquiry ID');
  }
  if (!oneTimeLinkTokenSchema.safeParse(oneTimeToken).success) {
    throw new TypeError('Malformed one-time link token');
  }
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/#${INQUIRY_ID_PARAM}=${inquiryId}&${ONE_TIME_TOKEN_PARAM}=${oneTimeToken}`;
}

function single(params: URLSearchParams, name: string): string | null {
  const [value, ...duplicates] = params.getAll(name);
  return value !== undefined && duplicates.length === 0 ? value : null;
}

/**
 * Reads the credentials from `location.hash` (with or without the leading `#`). Returns
 * `null` unless both are present exactly once and well-formed.
 */
export function parseFlowUrlFragment(hash: string): FlowUrlCredentials | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const inquiryId = single(params, INQUIRY_ID_PARAM);
  const sessionToken = single(params, SESSION_TOKEN_PARAM);
  if (
    inquiryId === null ||
    sessionToken === null ||
    !isId('inq', inquiryId) ||
    !sessionTokenSchema.safeParse(sessionToken).success
  ) {
    return null;
  }
  return { inquiryId, sessionToken };
}

/**
 * Reads a one-time link's credentials from `location.hash`. Returns `null` unless both are
 * present exactly once and well-formed.
 */
export function parseOneTimeLinkFragment(hash: string): OneTimeLinkCredentials | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const inquiryId = single(params, INQUIRY_ID_PARAM);
  const oneTimeToken = single(params, ONE_TIME_TOKEN_PARAM);
  if (
    inquiryId === null ||
    oneTimeToken === null ||
    !isId('inq', inquiryId) ||
    !oneTimeLinkTokenSchema.safeParse(oneTimeToken).success
  ) {
    return null;
  }
  return { inquiryId, oneTimeToken };
}

/**
 * Reads either kind of flow link from `location.hash` (C19). A fragment that carries both a
 * session token and a one-time token is ambiguous and returns `null`.
 */
export function parseFlowLinkFragment(hash: string): FlowLinkCredentials | null {
  const session = parseFlowUrlFragment(hash);
  const oneTimeLink = parseOneTimeLinkFragment(hash);
  if (session !== null && oneTimeLink === null) {
    return { kind: 'session', ...session };
  }
  if (oneTimeLink !== null && session === null) {
    return { kind: 'one-time-link', ...oneTimeLink };
  }
  return null;
}
