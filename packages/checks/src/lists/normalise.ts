/**
 * C98.2: the normaliser of each kind, the rules of the table, one function per rule. Each takes a
 * value as an item or a probe carries it and answers its canonical text, or refuses it with a code
 * and the member it read, never the value. `list-keys.ts` and `graph-keys.ts` turn the text into
 * labelled key inputs.
 */
import { domainToASCII } from 'node:url';
import {
  ID_CLASSES,
  LIST_EMAIL_MATCH_TYPES,
  LIST_LIMITS,
  normalizeIdentificationNumber,
} from '@openverify/core';
import type { IdClass, ImportErrorCode, ListEmailMatchType } from '@openverify/core';
import { formatKey, parseAddress, parseNetwork } from '@openverify/signals/address';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { LIST_VALUE_LIMITS, ListKeyInputError, type ListValue } from './key-input.js';

/** The value of a member that must be text. */
export function textMember(
  value: ListValue,
  member: string,
  code: ImportErrorCode = 'invalid_value',
): string {
  const text = value[member];
  if (typeof text !== 'string') {
    throw new ListKeyInputError(code, member);
  }
  return text;
}

/** The value of a member under the contract's cap, in UTF-16 units as zod counts them. */
function cappedText(value: ListValue, member: string, max: number): string {
  const text = textMember(value, member);
  if (text.length > max) {
    throw new ListKeyInputError('out_of_range', member);
  }
  return text;
}

/** A lone surrogate cannot be encoded: two of them would key alike. */
const LONE_SURROGATE = /\p{Cs}/u;

/** C98.2, the string rule: NFKC, trim, collapse inner whitespace, then lower case. */
export function normaliseText(value: string, member: string, caseSensitive: boolean): string {
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (text === '' || LONE_SURROGATE.test(text)) {
    throw new ListKeyInputError('invalid_value', member);
  }
  return caseSensitive ? text : text.toLowerCase();
}

export function canonicalString(value: ListValue, caseSensitive: boolean): string {
  return normaliseText(
    cappedText(value, 'value', LIST_VALUE_LIMITS.string),
    'value',
    caseSensitive,
  );
}

/** ASCII letters, digits, hyphens and dots, or any non-ASCII character (an IDN), as C55.8 reads. */
const DOMAIN_CHARACTERS = /^(?:[a-z\d.-]|[^\0-\x7f])+$/iu;
/** An RFC 1123 label: letters, digits and inner hyphens, 1 to 63 characters. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LDH_LABEL = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u;
const NUMERIC_LABEL = /^\d+$/u;

/**
 * C98.2: a domain lower-cased and through `domainToASCII`, without the root's trailing dot.
 * `domainToASCII` is the URL host parser, so an address in disguise (`0x7f.1`) comes back as one
 * and is refused by its last label, as C55.8 does.
 */
function canonicalDomain(text: string, member: string): string {
  const entered = text.endsWith('.') ? text.slice(0, -1) : text;
  const domain = DOMAIN_CHARACTERS.test(entered) ? domainToASCII(entered.toLowerCase()) : '';
  const labels = domain.split('.');
  if (!labels.every((label) => LDH_LABEL.test(label)) || NUMERIC_LABEL.test(labels.at(-1) ?? '')) {
    throw new ListKeyInputError('invalid_value', member);
  }
  return domain;
}

/** An address, split at its last `@`. */
export interface CanonicalEmail {
  /** `local@domain`: the local part lower-cased, the domain as {@link canonicalDomain}. */
  readonly address: string;
  readonly domain: string;
}

/** C98.2: trim, split at the last `@`, lower-case the local part. */
export function canonicalEmail(value: ListValue): CanonicalEmail {
  const text = cappedText(value, 'value', LIST_VALUE_LIMITS.email).trim();
  const at = text.lastIndexOf('@');
  if (at <= 0) {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  const domain = canonicalDomain(text.slice(at + 1), 'value');
  return { address: `${text.slice(0, at).toLowerCase()}@${domain}`, domain };
}

/**
 * C98.2: a domain item, without a leading `@`. A whole address is refused: as a domain item it
 * would list every mailbox of its domain.
 */
export function canonicalEmailDomain(value: ListValue): string {
  const text = cappedText(value, 'value', LIST_VALUE_LIMITS.email).trim();
  const domain = text.startsWith('@') ? text.slice(1) : text;
  if (domain.includes('@')) {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  return canonicalDomain(domain, 'value');
}

/** The domain of an address or of a bare domain (the graph's `email_domain`). */
export function domainOf(value: ListValue): string {
  const text = cappedText(value, 'value', LIST_VALUE_LIMITS.email).trim();
  return canonicalDomain(text.slice(text.lastIndexOf('@') + 1), 'value');
}

/** C97.1: what an email item matches; the whole address by default. */
export function emailMatchType(value: ListValue): ListEmailMatchType {
  const matchType = value['match-type'] ?? 'email_address';
  const known = LIST_EMAIL_MATCH_TYPES.find((type) => type === matchType);
  if (known === undefined) {
    throw new ListKeyInputError('invalid_value', 'match-type');
  }
  return known;
}

/**
 * C98.2: E.164 through `libphonenumber-js` with its `/max` metadata, as C55.8 reads a destination.
 * The list's region reads a national number; an international one needs none, and a region the
 * metadata does not hold (a territory with no numbering plan) must not refuse it. Only the form is
 * read, not `isValid()`: a list holds numbers the metadata may not have ranges for yet.
 */
export function canonicalPhone(value: ListValue, region: string | null | undefined): string {
  const text = textMember(value, 'value', 'unparseable_phone');
  const international = text.trim().startsWith('+');
  const parsed =
    text.length > LIST_VALUE_LIMITS.phone
      ? undefined
      : parsePhoneNumberFromString(text, {
          extract: false,
          ...(international || region == null ? {} : { defaultCountry: region as CountryCode }),
        });
  if (parsed?.isPossible() !== true) {
    throw new ListKeyInputError('unparseable_phone', 'value');
  }
  return parsed.number;
}

/** The class of an ID item or probe, or `null` for any class; `unsupported_class` outside C31. */
export function idClassOf(value: ListValue): IdClass | null {
  const raw = value['id-class'];
  const text = typeof raw === 'string' ? raw.trim() : raw;
  if (text === undefined || text === null || text === '') {
    return null;
  }
  const known = ID_CLASSES.find((idClass) => idClass === text);
  if (known === undefined) {
    throw new ListKeyInputError('unsupported_class', 'id-class');
  }
  return known;
}

/** C98.2: `normalizeIdentificationNumber`; a number with nothing left to key is refused. */
export function canonicalIdNumber(value: ListValue): string {
  const number = normalizeIdentificationNumber(
    cappedText(value, 'id-number', LIST_VALUE_LIMITS.idNumber),
  );
  if (number === '') {
    throw new ListKeyInputError('invalid_value', 'id-number');
  }
  return number;
}

/** A canonical address, or a canonical range wider than one host. */
export type CanonicalIp =
  | { readonly form: 'address'; readonly text: string }
  | { readonly form: 'range'; readonly text: string };

const isHostBitsRefusal = (error: unknown) =>
  error instanceof Error && error.message.endsWith('host bits set');

/**
 * C98.2: an address, IPv4-mapped folded to IPv4, or a range. A prefix as long as the address (/32,
 * /128) is that address (decision 28). One canonical form with the session's address: both read
 * `@openverify/signals/address`.
 */
export function canonicalIp(value: ListValue): CanonicalIp {
  const text = cappedText(value, 'value', LIST_VALUE_LIMITS.ip).trim();
  const address = parseAddress(text);
  if (address !== null) {
    return { form: 'address', text: address.text };
  }
  try {
    const { family, start, prefixLength } = parseNetwork(text);
    const first = formatKey(start);
    return prefixLength === (family === 4 ? 32 : 128)
      ? { form: 'address', text: first }
      : { form: 'range', text: `${first}/${String(prefixLength)}` };
  } catch (error) {
    throw new ListKeyInputError(
      isHostBitsRefusal(error) ? 'host_bits_set' : 'invalid_value',
      'value',
    );
  }
}

/** A session's address: a range is no probe. */
export function canonicalProbeAddress(value: ListValue): string {
  const address = parseAddress(cappedText(value, 'value', LIST_VALUE_LIMITS.ip).trim());
  if (address === null) {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  return address.text;
}

/** C98.2: ISO alpha-2, upper case, by its form: IP data and the contract read `XK` too. */
export function canonicalCountry(value: ListValue): string {
  const code = textMember(value, 'country-code').trim().toUpperCase();
  if (!/^[A-Z]{2}$/u.test(code)) {
    throw new ListKeyInputError('invalid_value', 'country-code');
  }
  return code;
}

/** The plain decimals a CSV cell may hold: no exponent, no sign but `-`. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/u;

/** A number from a JSON number or a CSV cell. */
export function numberMember(value: ListValue, member: string): number {
  const raw = value[member];
  const text = typeof raw === 'string' ? raw.trim() : '';
  const number =
    typeof raw === 'number' ? raw : PLAIN_DECIMAL.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(number)) {
    throw new ListKeyInputError('invalid_value', member);
  }
  return number;
}

function inRange(value: ListValue, member: string, min: number, max: number): number {
  const number = numberMember(value, member);
  if (number < min || number > max) {
    throw new ListKeyInputError('out_of_range', member);
  }
  return number;
}

/** A coordinate at 10⁻⁶°, the sign of a rounded zero dropped. */
const coordinateText = (coordinate: number) => {
  const text = coordinate.toFixed(6);
  return Number(text) === 0 ? '0.000000' : text;
};

/** A point checked against C97.1. */
export function checkedPoint(value: ListValue): { latitude: number; longitude: number } {
  return {
    latitude: inRange(value, 'latitude', -90, 90),
    longitude: inRange(value, 'longitude', -180, 180),
  };
}

/**
 * C98.2: ranges checked, then `lat,lon,radius` at 10⁻⁶°. The meridian ±180 is one line, so it is
 * written -180.
 */
export function canonicalGeolocation(value: ListValue): string {
  const { latitude, longitude } = checkedPoint(value);
  const radius = inRange(value, 'radius-meters', 1, LIST_LIMITS.radiusMeters);
  const meridian = Number(longitude.toFixed(6)) === 180 ? -180 : longitude;
  return `${coordinateText(latitude)},${coordinateText(meridian)},${String(radius)}`;
}

/** C98.2, Stage 1a amendment 3: the 64-hex HMAC a device resource serves, lower-cased. */
export function canonicalFingerprint(value: ListValue): string {
  const text = textMember(value, 'value').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw new ListKeyInputError('invalid_value', 'value');
  }
  return text;
}

/** A decimal with no leading zero: the text a number can be written as. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const CANONICAL_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

/** The digits of a finite number, with no exponent. */
function plainDecimal(number: number): string {
  const [mantissa = '', exponent] = String(number).split('e');
  if (exponent === undefined) {
    return mantissa;
  }
  const sign = mantissa.startsWith('-') ? '-' : '';
  const [whole = '', fraction = ''] = mantissa.slice(sign.length).split('.');
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  return `${sign}${point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : digits.padEnd(point, '0')}`;
}

/** A decimal without trailing zeros, and without the sign of a zero. */
function canonicalDecimal(text: string): string {
  let end = text.length;
  if (text.includes('.')) {
    while (text[end - 1] === '0') {
      end -= 1;
    }
    end -= text[end - 1] === '.' ? 1 : 0;
  }
  const trimmed = text.slice(0, end);
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * C98.2, "by the field's type". A list knows its `field-key` and no type, an item's `field-value`
 * is text, and an inquiry's field is a string, a number or a boolean, so the form of the value
 * decides, the same way for an item and a probe: a number and a text that reads as a canonical
 * decimal meet on the decimal (`42.50`, `42.5`), a boolean and its word meet by the string rule,
 * and an ISO date is already canonical under it. A text with a leading zero or an exponent stays
 * text, so `007` is never `7`.
 */
export function canonicalFieldValue(value: ListValue): string {
  const raw = value['field-value'];
  if (typeof raw === 'boolean') {
    return String(raw);
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new ListKeyInputError('invalid_value', 'field-value');
    }
    return canonicalDecimal(plainDecimal(raw));
  }
  const text = normaliseText(
    cappedText(value, 'field-value', LIST_VALUE_LIMITS.fieldValue),
    'field-value',
    false,
  );
  return CANONICAL_DECIMAL.test(text) ? canonicalDecimal(text) : text;
}
