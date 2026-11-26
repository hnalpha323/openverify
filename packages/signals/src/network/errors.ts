/**
 * C92.2 step 5: why a network publication was refused. Every parser of this folder fails closed
 * with a {@link NetworkParseError}. Its message names the rule and a position (a line, an entry's
 * ordinal, a member path), never a value read from the publication, so a refusal can be logged
 * and stored: exit addresses can belong to people who run relays at home (research §7.1).
 */

/** What refused a publication. */
export const NETWORK_PARSE_ERROR_CODES = [
  /** Not UTF-8. */
  'encoding',
  /** Not well-formed JSON. */
  'malformed',
  /** Well-formed, but not the publisher's format: a missing or mistyped member, an unknown line. */
  'format',
  /** An address or prefix that does not parse, has host bits set, or crosses the IPv4 space. */
  'address',
  /** An AS number outside 1 to 4,294,967,295. */
  'asn',
  /** A timestamp that does not parse or names no real instant. */
  'time',
  /** An MMDB file whose metadata, search tree or data section is inconsistent. */
  'mmdb',
  /** Sandbox data outside the documentation ranges and ASNs (C93.6). */
  'sandbox',
] as const;
export type NetworkParseErrorCode = (typeof NETWORK_PARSE_ERROR_CODES)[number];

/** A publication refused by a parser; no value from the publication in the message. */
export class NetworkParseError extends Error {
  readonly code: NetworkParseErrorCode;

  constructor(code: NetworkParseErrorCode, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'NetworkParseError';
    this.code = code;
  }
}
