/**
 * C77.2: the guarded JSON reader for the GOV.UK content API answer and the Wikidata SPARQL pages.
 * The body is bounded by bytes before anything else, must be UTF-8, and its nesting is scanned
 * before `JSON.parse` runs. A refusal never quotes the body (V8's syntax errors do, so they are
 * not passed on).
 */
import { WatchlistParseError } from './errors.js';

/** The JSON reader's nesting cap (ours, provisional): no answer we read nests past about six. */
export const JSON_GUARD_LIMITS = Object.freeze({ maxDepth: 64 });

/**
 * Parses a JSON body.
 * @throws {WatchlistParseError} `too_large` over `maxBytes`, `encoding` for bytes that are not
 * UTF-8, `too_deep` past the nesting cap, `malformed` for anything that is not JSON.
 */
export function parseGuardedJson(
  body: string | Uint8Array,
  options: { readonly maxBytes: number; readonly maxDepth?: number },
): unknown {
  const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length;
  if (size > options.maxBytes) {
    throw new WatchlistParseError(
      'too_large',
      `the body is over ${String(options.maxBytes)} bytes`,
    );
  }
  let text: string;
  try {
    text = typeof body === 'string' ? body : new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch (error) {
    throw new WatchlistParseError('encoding', 'the body is not UTF-8', { cause: error });
  }
  checkDepth(text, options.maxDepth ?? JSON_GUARD_LIMITS.maxDepth);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WatchlistParseError('malformed', 'the body is not JSON');
  }
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPENERS = new Set([0x5b, 0x7b]);
const CLOSERS = new Set([0x5d, 0x7d]);

/** Counts `[` and `{` nesting outside strings, before `JSON.parse` recurses into it. */
function checkDepth(text: string, maxDepth: number): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (code === BACKSLASH) {
        escaped = true;
      } else if (code === QUOTE) {
        inString = false;
      }
    } else if (code === QUOTE) {
      inString = true;
    } else if (OPENERS.has(code)) {
      depth += 1;
      if (depth > maxDepth) {
        throw new WatchlistParseError('too_deep', `the body nests deeper than ${String(maxDepth)}`);
      }
    } else if (CLOSERS.has(code)) {
      depth -= 1;
    }
  }
}
