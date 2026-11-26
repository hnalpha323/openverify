/**
 * The checks the browser makes before a code is sent (C55.8). The server decides: it validates
 * with libphonenumber's full metadata and refuses premium, shared-cost and other number types,
 * and it normalises the email domain. These checks are deliberately looser, so the browser never
 * refuses a destination the server would take; they only spare the user a round trip for a typo.
 */
import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

/** What the user must fix in a destination before it is sent. */
export type DestinationProblem = 'required' | 'invalid' | 'notAllowed';

export type PhoneParse =
  | { readonly ok: true; readonly e164: string }
  | { readonly ok: false; readonly problem: DestinationProblem };

/**
 * The number typed for `country`, in E.164, when libphonenumber finds it valid and in one of the
 * `allowed` countries. A number typed with its `+` country code may belong to another country.
 */
export function parsePhoneEntry(
  input: string,
  country: string,
  allowed: readonly string[],
): PhoneParse {
  const text = input.trim();
  if (text === '') {
    return { ok: false, problem: 'required' };
  }
  const parsed = parsePhoneNumberFromString(
    text,
    isSupportedCountry(country) ? country : undefined,
  );
  if (parsed?.isValid() !== true) {
    return { ok: false, problem: 'invalid' };
  }
  if (parsed.country === undefined || !allowed.includes(parsed.country)) {
    return { ok: false, problem: 'notAllowed' };
  }
  return { ok: true, e164: parsed.number };
}

/** A country of a phone step: its code, its name in `language` and its calling code. */
export interface PhoneCountry {
  readonly code: string;
  readonly name: string;
  /** `+44`, or `null` for a country libphonenumber has no metadata for. */
  readonly callingCode: string | null;
}

/** The allowed countries, sorted by their name in `language`. */
export function phoneCountries(allowed: readonly string[], language: string): PhoneCountry[] {
  const names = new Intl.DisplayNames([language], { type: 'region', fallback: 'code' });
  const collator = new Intl.Collator(language);
  return allowed
    .map((code) => ({
      code,
      name: names.of(code) ?? code,
      callingCode: isSupportedCountry(code) ? `+${getCountryCallingCode(code)}` : null,
    }))
    .sort((left, right) => collator.compare(left.name, right.name));
}

/** RFC 5321's limits on a whole address and its local part. */
const MAX_ADDRESS = 254;
const MAX_LOCAL_PART = 64;

/**
 * Whether `input` is shaped like an email address: one `@` with a local part of at most 64
 * characters, a domain with a dot between labels, no space, 254 characters in all. Non-ASCII
 * characters are left to the server.
 */
export function emailProblem(input: string): DestinationProblem | null {
  const address = input.trim();
  if (address === '') {
    return 'required';
  }
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const labels = domain.split('.');
  const shaped =
    address.length <= MAX_ADDRESS &&
    at > 0 &&
    local.length <= MAX_LOCAL_PART &&
    !local.includes('@') &&
    !/\s/u.test(address) &&
    labels.length >= 2 &&
    labels.every((label) => label !== '');
  return shaped ? null : 'invalid';
}
