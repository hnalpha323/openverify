/**
 * The phone destination rule of C55.8, a pure function the API calls before it sends a code:
 * `libphonenumber-js` with its `/max` metadata (the only set that validates the digits and knows
 * the number type), a number in international form only, `isValid()` required, the number's
 * region in the step's `allowedCountries`, the premium, shared-cost, toll-free, UAN, pager and
 * voicemail types refused, and VoIP refused unless the step sets `allowVoip`.
 *
 * "Valid" means a range numbers are assigned from, never that the number works or belongs to the
 * user: only the code proves that (libphonenumber FAQ). libphonenumber ships no carrier data, and
 * in North America it cannot tell a mobile from a landline (`FIXED_LINE_OR_MOBILE`), so neither
 * is refused.
 */
import { parsePhoneNumberFromString, type PhoneNumberType } from 'libphonenumber-js/max';

/** C55.8: the number types an SMS code is never sent to (toll fraud and undeliverable lines). */
export const REFUSED_PHONE_NUMBER_TYPES = Object.freeze([
  'PREMIUM_RATE',
  'SHARED_COST',
  'TOLL_FREE',
  'UAN',
  'PAGER',
  'VOICEMAIL',
] as const satisfies readonly PhoneNumberType[]);

/** The most digits an E.164 number has (ITU-T E.164 §6.1). */
export const E164_MAX_DIGITS = 15;

/** The longest entered value read (`flowOtpSendBodySchema` caps `phone-number` at 32). */
export const PHONE_DESTINATION_MAX_LENGTH = 32;

/** The step's rules for a phone destination (flow-spec `phone_otp`). */
export interface PhoneDestinationOptions {
  /** ISO 3166-1 alpha-2 regions the step allows (1 to 250). */
  allowedCountries: readonly string[];
  /** Send to a VoIP number too (the step's `allowVoip`, false by default). */
  allowVoip?: boolean | undefined;
}

/**
 * Why a phone destination was refused. `unparseable` and `invalid_number` answer
 * `otp_destination_invalid`; the others, which are valid numbers the step does not send to
 * (`no_region` is a non-geographic number, such as +800 or +882, which no allowed country
 * holds), answer `otp_destination_not_allowed`.
 */
export type PhoneDestinationRefusal =
  | 'unparseable'
  | 'invalid_number'
  | 'no_region'
  | 'country_not_allowed'
  | 'type_not_allowed'
  | 'voip_not_allowed';

/** A phone number the API may send a code to, or the problem to answer instead. */
export type PhoneDestinationResult =
  | {
      ok: true;
      /** The number in E.164 (`+` and digits): the HMAC input and the blind-index value (C55.3). */
      e164: string;
      /** Its ISO 3166-1 alpha-2 region, as libphonenumber reads it from the digits. */
      country: string;
      /** Its libphonenumber type, or `null` when the metadata gives none. */
      type: PhoneNumberType | null;
    }
  | {
      ok: false;
      problem: 'otp_destination_invalid' | 'otp_destination_not_allowed';
      refusal: PhoneDestinationRefusal;
    };

/**
 * Validates a phone number entered for an OTP (C55.8). The value must be in international form:
 * `+`, the country code and the number, with spaces, hyphens, dots and parentheses allowed between
 * digits, at most {@link E164_MAX_DIGITS} digits; letters, extensions and any other character are
 * refused. Surrounding whitespace is ignored.
 */
export function validatePhoneDestination(
  value: string,
  options: PhoneDestinationOptions,
): PhoneDestinationResult {
  const text = value.trim();
  if (
    text.length > PHONE_DESTINATION_MAX_LENGTH ||
    !INTERNATIONAL_FORM.test(text) ||
    digitCount(text) > E164_MAX_DIGITS
  ) {
    return invalid('unparseable');
  }
  const parsed = parsePhoneNumberFromString(text, { extract: false });
  if (parsed === undefined) {
    return invalid('unparseable');
  }
  if (!parsed.isValid()) {
    return invalid('invalid_number');
  }
  const country = parsed.country;
  if (country === undefined) {
    return notAllowed('no_region');
  }
  if (!options.allowedCountries.includes(country)) {
    return notAllowed('country_not_allowed');
  }
  const type = parsed.getType() ?? null;
  if (type !== null && (REFUSED_PHONE_NUMBER_TYPES as readonly string[]).includes(type)) {
    return notAllowed('type_not_allowed');
  }
  if (type === 'VOIP' && options.allowVoip !== true) {
    return notAllowed('voip_not_allowed');
  }
  return { ok: true, e164: parsed.number, country, type };
}

/**
 * The destination as the flow shows it back (`masked-destination`, C52.2): the international
 * format with the country calling code and the last four digits shown and every other digit
 * hidden (`+1 ••• ••• 0100`), so the user can spot a typo.
 */
export function maskPhoneDestination(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164, { extract: false });
  if (parsed === undefined) {
    return `+${maskDigits(e164.replace(NON_DIGITS, ''))}`;
  }
  const callingCode = `+${parsed.countryCallingCode}`;
  return `${callingCode}${maskDigits(parsed.formatInternational().slice(callingCode.length))}`;
}

/**
 * `+`, a digit, then digits and the separators people type (space, hyphen, dot, parentheses).
 * Linear: one character class, no nested quantifier.
 */
const INTERNATIONAL_FORM = /^\+\d[\d ().-]*$/u;
const NON_DIGITS = /\D/gu;
const MASK = '•';
const SHOWN_DIGITS = 4;

function digitCount(text: string): number {
  return text.replace(NON_DIGITS, '').length;
}

/** Every digit of `text` but the last four replaced by the mask; other characters kept. */
function maskDigits(text: string): string {
  let hidden = digitCount(text) - SHOWN_DIGITS;
  let masked = '';
  for (const character of text) {
    if (hidden > 0 && character >= '0' && character <= '9') {
      masked += MASK;
      hidden -= 1;
    } else {
      masked += character;
    }
  }
  return masked;
}

function invalid(refusal: 'unparseable' | 'invalid_number'): PhoneDestinationResult {
  return { ok: false, problem: 'otp_destination_invalid', refusal };
}

function notAllowed(
  refusal: Exclude<PhoneDestinationRefusal, 'unparseable' | 'invalid_number'>,
): PhoneDestinationResult {
  return { ok: false, problem: 'otp_destination_not_allowed', refusal };
}
