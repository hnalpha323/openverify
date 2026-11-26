/**
 * Exact identifiers (C58.1, C59.3): phone numbers, email addresses and identification or
 * registration numbers. Each is `full` when equal after its normalisation, `none` otherwise, and
 * `missing` without a value on either side; a phone number written nationally against its
 * international form (the same last seven digits or more) is `partial`. Values never leave.
 */
import { presentText } from '../result.js';
import { fieldMatch, type FieldMatch } from './levels.js';
import { capText } from './limits.js';

/** No identifier compared here is longer (an email address is at most 254 characters). */
const MAX_IDENTIFIER_LENGTH = 254;
/** The fewest trailing digits a national number shares with its international form. */
const MIN_NATIONAL_DIGITS = 7;

const normal = (value: string | null | undefined, form: (text: string) => string) => {
  const text = presentText(value);
  return text === null ? '' : form(capText(text, MAX_IDENTIFIER_LENGTH));
};

const equalOrNone = (x: string, y: string): FieldMatch =>
  x === '' || y === '' ? fieldMatch('missing') : fieldMatch(x === y ? 'full' : 'none');

/** Two phone numbers, by their digits. */
export function matchPhoneNumbers(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const digits = (text: string) => text.replace(/\D/g, '');
  const x = normal(a, digits);
  const y = normal(b, digits);
  if (x !== '' && y !== '' && x !== y) {
    const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
    if (shorter.length >= MIN_NATIONAL_DIGITS && longer.endsWith(shorter)) {
      return fieldMatch('partial', ['substring']);
    }
  }
  return equalOrNone(x, y);
}

/** Two email addresses, trimmed and lower-cased. */
export function matchEmailAddresses(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const lower = (text: string) => text.toLowerCase();
  return equalOrNone(normal(a, lower), normal(b, lower));
}

/** Two identification or registration numbers, by their letters and digits, upper-cased. */
export function matchIdentificationNumbers(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const compact = (text: string) => text.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return equalOrNone(normal(a, compact), normal(b, compact));
}
