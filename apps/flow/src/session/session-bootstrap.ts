/**
 * Reads the hosted-flow credentials from the URL fragment, which never reaches servers or
 * `Referer`, then removes the fragment from the address bar and history at once:
 * - a session link (contract C2 `flow-url`): `#inquiry-id=<inq_...>&session-token=<ovs_...>`.
 *   The credentials are kept in this tab's sessionStorage, so a reload resumes;
 * - a one-time link (C10, C19): `#inquiry-id=<inq_...>&one-time-token=<ovo_...>`. The flow
 *   redeems it for a session token that lives in memory only, so nothing secret is stored and
 *   a reload cannot resume it. A marker without secrets remembers that the tab used one, so a
 *   reload is explained instead of being reported as a missing link.
 */
import {
  idSchema,
  parseFlowLinkFragment,
  sessionTokenSchema,
  type OneTimeLinkCredentials,
} from '@openverify/contracts';
import { z } from 'zod';
import { readHandoffFragment, type HandoffFragment } from '../handoff/handoff';
import { carryParameters } from './flow-parameters';

/** sessionStorage key holding the credentials, scoped to this tab by the browser. */
export const SESSION_STORAGE_KEY = 'openverify.flow.session';

/** sessionStorage key set (to `"1"`) once this tab opened a one-time link. It holds no secret. */
export const ONE_TIME_LINK_MARKER_KEY = 'openverify.flow.one-time-link';

const INQUIRY_ID_PARAM = 'inquiry-id';
const SESSION_TOKEN_PARAM = 'session-token';
const ONE_TIME_TOKEN_PARAM = 'one-time-token';
/** C96.3 (Workflow 7A): a handoff link's token (`#inquiry-id=<inq_...>&handoff-token=ovh_...`). */
const HANDOFF_TOKEN_PARAM = 'handoff-token';

export const flowCredentialsSchema = z.strictObject({
  inquiryId: idSchema('inq'),
  sessionToken: sessionTokenSchema,
});
export type FlowCredentials = z.infer<typeof flowCredentialsSchema>;

export type BootstrapErrorReason = 'missing' | 'invalid' | 'reloaded';

export type BootstrapResult =
  | { readonly status: 'ready'; readonly credentials: FlowCredentials }
  /** A one-time link, still to be redeemed (see `redeemOneTimeLink`). */
  | { readonly status: 'one-time-link'; readonly link: OneTimeLinkCredentials }
  /**
   * C96.3 (Workflow 7A): a handoff link on the phone, redeemed only on Continue after the
   * context screen (`HandoffRedeemFlow`); its token lives in memory only.
   */
  | { readonly status: 'handoff'; readonly handoff: HandoffFragment }
  | { readonly status: 'error'; readonly reason: BootstrapErrorReason };

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface BootstrapEnvironment {
  readonly location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  readonly history: Pick<History, 'replaceState' | 'state'>;
  /** `null` when the browser blocks sessionStorage; the session then lives only in memory. */
  readonly storage: StorageLike | null;
}

/** The only value of a parameter, or `undefined` when it is absent or repeated. */
function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function readStored(storage: StorageLike | null): FlowCredentials | null {
  let raw: string | null;
  try {
    raw = storage?.getItem(SESSION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  const parsed = flowCredentialsSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  forget(storage);
  return null;
}

function remember(storage: StorageLike | null, credentials: FlowCredentials): void {
  try {
    storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    // Storage is full or blocked: the session still works until this page is reloaded.
  }
}

function forget(storage: StorageLike | null, key = SESSION_STORAGE_KEY): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing stored that we could reach.
  }
}

function usedOneTimeLink(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(ONE_TIME_LINK_MARKER_KEY) === '1';
  } catch {
    return false;
  }
}

function markOneTimeLink(storage: StorageLike | null): void {
  try {
    storage?.setItem(ONE_TIME_LINK_MARKER_KEY, '1');
  } catch {
    // Without the marker, a reload is reported as a missing link: still safe.
  }
}

/**
 * A one-time link: its session lives in memory only, so an older stored session is dropped and
 * only a marker without secrets is kept.
 */
function oneTimeLink(hash: string, storage: StorageLike | null): BootstrapResult {
  forget(storage);
  const link = parseFlowLinkFragment(hash);
  if (link?.kind !== 'one-time-link') {
    // Malformed, or ambiguous (a session token as well).
    forget(storage, ONE_TIME_LINK_MARKER_KEY);
    return { status: 'error', reason: 'invalid' };
  }
  markOneTimeLink(storage);
  return {
    status: 'one-time-link',
    link: { inquiryId: link.inquiryId, oneTimeToken: link.oneTimeToken },
  };
}

/**
 * C96.3 (Workflow 7A): a handoff link on the phone. Like a one-time link, its token lives in
 * memory only (it is redeemed on Continue, never at boot), an older stored session is dropped, and
 * only the marker without secrets is kept, so a reload is explained.
 */
function handoffLink(hash: string, storage: StorageLike | null): BootstrapResult {
  forget(storage);
  const handoff = readHandoffFragment(hash);
  if (handoff === null) {
    forget(storage, ONE_TIME_LINK_MARKER_KEY);
    return { status: 'error', reason: 'invalid' };
  }
  markOneTimeLink(storage);
  return { status: 'handoff', handoff };
}

/**
 * Takes the credentials from the URL fragment, or from this tab's sessionStorage after a
 * reload. Never throws and never logs the token.
 */
export function bootstrapSession({
  location,
  history,
  storage,
}: BootstrapEnvironment): BootstrapResult {
  // Read before replaceState: in a browser, `location` is live and loses its hash at once.
  const { hash } = location;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const isFlowLink =
    params.has(INQUIRY_ID_PARAM) ||
    params.has(SESSION_TOKEN_PARAM) ||
    params.has(ONE_TIME_TOKEN_PARAM) ||
    params.has(HANDOFF_TOKEN_PARAM);

  if (!isFlowLink) {
    const stored = readStored(storage);
    if (stored !== null) {
      return { status: 'ready', credentials: stored };
    }
    return { status: 'error', reason: usedOneTimeLink(storage) ? 'reloaded' : 'missing' };
  }

  // Clear the credentials from the address bar and this history entry before anything else
  // can read them, whether or not they turn out to be valid. The fragment's public `language`
  // and `style-variant` (never a credential) move into the query (C161.2, C160.9).
  history.replaceState(
    history.state,
    '',
    `${location.pathname}${carryParameters(location.search, hash)}`,
  );

  if (params.has(ONE_TIME_TOKEN_PARAM)) {
    return oneTimeLink(hash, storage);
  }
  if (params.has(HANDOFF_TOKEN_PARAM)) {
    return handoffLink(hash.startsWith('#') ? hash : `#${hash}`, storage);
  }

  const parsed = flowCredentialsSchema.safeParse({
    inquiryId: single(params, INQUIRY_ID_PARAM),
    sessionToken: single(params, SESSION_TOKEN_PARAM),
  });
  if (!parsed.success) {
    // The latest link is broken: do not silently resume an older session in its place.
    forget(storage);
    return { status: 'error', reason: 'invalid' };
  }
  remember(storage, parsed.data);
  forget(storage, ONE_TIME_LINK_MARKER_KEY);
  return { status: 'ready', credentials: parsed.data };
}

/** This tab's sessionStorage, or `null` when the browser refuses access to it. */
export function browserSessionStorage(scope: {
  readonly sessionStorage: Storage;
}): StorageLike | null {
  try {
    return scope.sessionStorage;
  } catch {
    return null;
  }
}
