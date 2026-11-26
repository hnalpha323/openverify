/**
 * C77.2, C76.2: why a list was refused. The XML reader, the ZIP reader, every publisher parser and
 * the Wikidata SPARQL reader fail closed with a {@link WatchlistParseError}. Its message names the
 * rule and a position (a line and column, a byte count, an entry's ordinal, a field path), never a
 * value read from the list, so a refusal can be logged and stored (C76.5).
 */

/** What refused a list. */
export const WATCHLIST_PARSE_ERROR_CODES = [
  /** A byte cap: the manifest's `max_bytes`, a ZIP member's declared or inflated size, a page. */
  'too_large',
  /** Element or JSON nesting deeper than the cap. */
  'too_deep',
  /** A text node, tag, attribute, element count or captured element over its cap. */
  'too_long',
  /** A DOCTYPE declaration: the only way to define an entity or reach an external one. */
  'doctype',
  /** Not well-formed XML or JSON: truncated, an undefined entity, text outside the root. */
  'malformed',
  /** Not UTF-8, or a declaration naming another encoding. */
  'encoding',
  /** Well-formed, but not the publisher's format: the root, namespace or a required element. */
  'format',
  /** A record the normalised schema refuses (C77.1), or an entry id given twice. */
  'schema',
  /** A ZIP that is not exactly one expected, unencrypted and self-consistent member. */
  'zip',
] as const;
export type WatchlistParseErrorCode = (typeof WATCHLIST_PARSE_ERROR_CODES)[number];

/** The `watchlist_syncs.outcome` a refusal records (C73.3, C76.2). */
export type WatchlistParseRefusal = 'refused_size' | 'refused_schema';

/** C76.2: a byte cap refuses with `refused_size`; every other parse failure with `refused_schema`. */
export const WATCHLIST_PARSE_REFUSALS: Readonly<
  Record<WatchlistParseErrorCode, WatchlistParseRefusal>
> = Object.freeze({
  too_large: 'refused_size',
  too_deep: 'refused_schema',
  too_long: 'refused_schema',
  doctype: 'refused_schema',
  malformed: 'refused_schema',
  encoding: 'refused_schema',
  format: 'refused_schema',
  schema: 'refused_schema',
  zip: 'refused_schema',
});

/** A list refused by a parser guard or by the normalised schema; no list value in the message. */
export class WatchlistParseError extends Error {
  readonly code: WatchlistParseErrorCode;

  constructor(code: WatchlistParseErrorCode, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options);
    this.name = 'WatchlistParseError';
    this.code = code;
  }

  /** The sync outcome this refusal records. */
  get refusal(): WatchlistParseRefusal {
    return WATCHLIST_PARSE_REFUSALS[this.code];
  }
}
