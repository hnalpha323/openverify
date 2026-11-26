/**
 * The email destination rule of C55.8, a pure function the API calls before it sends a code: the
 * WHATWG "valid email address" syntax (no quoted local parts, comments, groups or angle brackets),
 * an RFC 5321 dot-string local part, the RFC 5321 §4.5.3.1 lengths, a domain with a dot that is
 * not an IP literal, internationalised domains converted with `url.domainToASCII`, and
 * internationalised (SMTPUTF8) local parts refused. Only an address that passed reaches the
 * mailer, as an `{ address }` object, so none of the 2026-10-19 nodemailer address-parser
 * payloads (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h) can.
 *
 * Syntax is not deliverability: `email_address_mx_detection` asks DNS, and only the code proves
 * the mailbox.
 */
import { domainToASCII } from 'node:url';

/** RFC 5321 §4.5.3.1: octet limits of the local part, the domain and the forward path. */
export const EMAIL_ADDRESS_LIMITS = Object.freeze({
  localPartMaxOctets: 64,
  domainMaxOctets: 255,
  /** The path is at most 256 octets with its angle brackets. */
  addressMaxOctets: 254,
});

/** Why an email destination was refused; every refusal answers `otp_destination_invalid`. */
export type EmailDestinationRefusal =
  | 'syntax'
  | 'local_part_not_ascii'
  | 'local_part_too_long'
  | 'domain_invalid'
  | 'domain_without_dot'
  | 'domain_ip_literal'
  | 'domain_too_long'
  | 'address_too_long';

/** An email address the API may send a code to, or the problem to answer instead. */
export type EmailDestinationResult =
  | {
      ok: true;
      /** The local part as entered and the domain in its ASCII form: what the mailer gets. */
      address: string;
      /** The domain in its lower-case ASCII (punycode) form. */
      domain: string;
      /** The address lower-cased: the HMAC input and the blind-index value (C55.3, C55.8). */
      normalized: string;
    }
  | { ok: false; problem: 'otp_destination_invalid'; refusal: EmailDestinationRefusal };

/**
 * Validates an email address entered for an OTP (C55.8). Leading and trailing ASCII whitespace is
 * ignored, as the WHATWG email input's value sanitization does.
 */
export function validateEmailDestination(value: string): EmailDestinationResult {
  const text = trimAsciiWhitespace(value);
  const at = text.indexOf('@');
  if (at <= 0 || at !== text.lastIndexOf('@') || at === text.length - 1) {
    return refuse('syntax');
  }
  const local = text.slice(0, at);
  const entered = text.slice(at + 1);
  if (NON_ASCII.test(local)) {
    return refuse('local_part_not_ascii');
  }
  if (local.length > EMAIL_ADDRESS_LIMITS.localPartMaxOctets) {
    return refuse('local_part_too_long');
  }
  if (!DOT_STRING.test(local)) {
    return refuse('syntax');
  }
  if (entered.startsWith('[')) {
    return refuse('domain_ip_literal');
  }
  // Only letters, digits, hyphens and dots in ASCII: the URL host parser would otherwise decode
  // `%2e`, read `0x7f.1` as an address, or keep an underscore. Other scripts go to IDNA.
  if (!DOMAIN_ASCII_CHARACTERS.test(entered)) {
    return refuse('syntax');
  }
  const domain = domainToASCII(entered);
  if (domain === '') {
    return refuse('domain_invalid');
  }
  const labels = domain.split('.');
  if (labels.length === 1) {
    return refuse('domain_without_dot');
  }
  if (NUMERIC_LABEL.test(labels.at(-1) ?? '')) {
    return refuse('domain_ip_literal');
  }
  if (!labels.every((label) => LDH_LABEL.test(label))) {
    return refuse('domain_invalid');
  }
  if (domain.length > EMAIL_ADDRESS_LIMITS.domainMaxOctets) {
    return refuse('domain_too_long');
  }
  const address = `${local}@${domain}`;
  if (address.length > EMAIL_ADDRESS_LIMITS.addressMaxOctets) {
    return refuse('address_too_long');
  }
  return { ok: true, address, domain, normalized: address.toLowerCase() };
}

/**
 * The destination as the flow shows it back (`masked-destination`, C52.2): the first character
 * of the local part, `•••` for the rest, and the domain (shortened from the left to fit 64
 * characters), so the user can spot a typo.
 */
export function maskEmailDestination(address: string): string {
  const at = address.lastIndexOf('@');
  const first = Array.from(address.slice(0, Math.max(at, 0)))[0] ?? '';
  const prefix = `${first}•••@`;
  const domain = address.slice(at + 1);
  const room = MASKED_MAX_LENGTH - prefix.length;
  return domain.length <= room ? `${prefix}${domain}` : `${prefix}…${domain.slice(-(room - 1))}`;
}

/** The longest `masked-destination` the flow schema takes. */
const MASKED_MAX_LENGTH = 64;
/** WHATWG ASCII whitespace: tab, LF, FF, CR and space. */
const ASCII_WHITESPACE = new Set(['\t', '\n', '\f', '\r', ' ']);
const NON_ASCII = /[^\0-\x7f]/u;
/** RFC 5321 dot-string over the WHATWG atext set: atoms joined by single dots. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const DOT_STRING = /^[\w!#$%&'*+/=?^`{|}~-]+(?:\.[\w!#$%&'*+/=?^`{|}~-]+)*$/u;
/** ASCII letters, digits, hyphens and dots, or any non-ASCII character (an IDN). */
const DOMAIN_ASCII_CHARACTERS = /^(?:[a-z\d.-]|[^\0-\x7f])+$/iu;
/** An RFC 1123 label: letters, digits and inner hyphens, 1 to 63 characters. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LDH_LABEL = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/u;
const NUMERIC_LABEL = /^\d+$/u;

/** WHATWG "strip leading and trailing ASCII whitespace", in one linear pass from each end. */
function trimAsciiWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && ASCII_WHITESPACE.has(value.charAt(start))) {
    start += 1;
  }
  while (end > start && ASCII_WHITESPACE.has(value.charAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

function refuse(refusal: EmailDestinationRefusal): EmailDestinationResult {
  return { ok: false, problem: 'otp_destination_invalid', refusal };
}
