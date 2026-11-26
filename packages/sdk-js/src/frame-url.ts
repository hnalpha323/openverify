/**
 * C159.2, C159.3: the iframe's URL: `{flowUrl}/embed/{inquiryId}`, the credentials only in the
 * fragment (as the hosted link carries them, so they never reach a server, a log or a referrer),
 * and only `language` and `style-variant`, which are not secrets, in the query. Nothing else is
 * offered: no template, fields, reference or account (the customer's server creates the inquiry).
 */

export interface FrameUrlInput {
  /** Where the flow is served, for example `https://verify.example.com`. */
  readonly flowUrl: string;
  readonly inquiryId: string;
  /** A session token (`ovs_...`); give this or `oneTimeLink`. */
  readonly sessionToken?: string;
  /** A one-time link's token (`ovo_...`); give this or `sessionToken`. */
  readonly oneTimeLink?: string;
  /** A language tag, such as `ar` or `fr-CA`. */
  readonly language?: string;
  readonly styleVariant?: 'light' | 'dark';
}

const INQUIRY_ID = /^inq_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TOKEN_BODY = '[A-Za-z0-9_-]{43}';
const SESSION_TOKEN = new RegExp(`^ovs_${TOKEN_BODY}$`);
const ONE_TIME_TOKEN = new RegExp(`^ovo_${TOKEN_BODY}$`);
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** The frame's URL and the flow's origin, or which option is not valid (never its value). */
export function frameUrlOf(
  input: FrameUrlInput,
): { readonly url: string; readonly origin: string } | { readonly invalid: string } {
  let flow: URL;
  try {
    flow = new URL(input.flowUrl);
  } catch {
    return { invalid: 'flowUrl must be an absolute URL' };
  }
  const secure =
    flow.protocol === 'https:' || (flow.protocol === 'http:' && LOOPBACK.includes(flow.hostname));
  if (
    !secure ||
    flow.search !== '' ||
    flow.hash !== '' ||
    flow.username !== '' ||
    flow.password !== ''
  ) {
    return { invalid: 'flowUrl must be an https URL without a query, fragment or credentials' };
  }
  if (!INQUIRY_ID.test(input.inquiryId)) {
    return { invalid: 'inquiryId must be an inquiry id (inq_...)' };
  }
  const { sessionToken, oneTimeLink } = input;
  let credential: string;
  if (sessionToken !== undefined && oneTimeLink === undefined && SESSION_TOKEN.test(sessionToken)) {
    credential = `session-token=${sessionToken}`;
  } else if (
    oneTimeLink !== undefined &&
    sessionToken === undefined &&
    ONE_TIME_TOKEN.test(oneTimeLink)
  ) {
    credential = `one-time-token=${oneTimeLink}`;
  } else {
    return {
      invalid: 'give exactly one of sessionToken and oneTimeLink, each a token of its kind',
    };
  }
  const query = new URLSearchParams();
  if (input.language !== undefined) {
    if (!LANGUAGE.test(input.language)) {
      return { invalid: 'language must be a language tag such as ar or fr-CA' };
    }
    query.set('language', input.language);
  }
  if (input.styleVariant !== undefined) {
    // JavaScript callers are not held to the type, so the value is checked at run time.
    if (!(['light', 'dark'] as readonly string[]).includes(input.styleVariant)) {
      return { invalid: 'styleVariant must be light or dark' };
    }
    query.set('style-variant', input.styleVariant);
  }
  const path = flow.pathname.replace(/\/+$/, '');
  const search = query.size === 0 ? '' : `?${query.toString()}`;
  return {
    url: `${flow.origin}${path}/embed/${input.inquiryId}${search}#inquiry-id=${input.inquiryId}&${credential}`,
    origin: flow.origin,
  };
}
