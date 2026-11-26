/**
 * C55.9 and C57.2: the organization name as a code message or a wallet challenge may carry it.
 * The name is the operator's, but a message that reaches a phone or a wallet must not carry a
 * link, a second code-like number or a mention. After NFKC normalisation, control and line
 * separator characters become spaces, format, private-use and unassigned characters (bidi
 * overrides, zero-width characters) are removed, every word that is a URL (`scheme://…`,
 * `www.…`) or a host name (`acme.example`) is dropped, `@` and `#` are removed, and so is every
 * run of four or more digits; whitespace is collapsed and the result cut to
 * {@link ORGANIZATION_NAME_MAX_LENGTH} characters.
 */
/** C55.9: the longest organization name a message carries. */
export const ORGANIZATION_NAME_MAX_LENGTH = 40;

/** The organization name for a code message or a challenge statement; may be empty. */
export function sanitizeOrganizationName(name: string): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(SEPARATING_CHARACTERS, ' ')
    .replace(INVISIBLE_CHARACTERS, '');
  const words = cleaned
    .split(WHITESPACE)
    .filter((word) => !isLink(word))
    .map((word) => word.replace(MENTION_CHARACTERS, '').replace(DIGIT_RUNS, ''))
    .filter((word) => word !== '');
  const cut = Array.from(words.join(' ')).slice(0, ORGANIZATION_NAME_MAX_LENGTH).join('');
  return cut.trimEnd();
}

/** Control characters and line or paragraph separators: they separate words. */
const SEPARATING_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
/** Format (bidi overrides, zero-width), surrogate, private-use and unassigned characters. */
const INVISIBLE_CHARACTERS = /[\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu;
const WHITESPACE = /\s+/u;
const MENTION_CHARACTERS = /[@#]/gu;
const DIGIT_RUNS = /\p{Nd}{4,}/gu;
/** Punctuation a word may carry before or after a host name (`(acme.example),`). */
const EDGE_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '"', "'"]);
/** A host label: letters, digits and hyphens of any script. */
const HOST_LABEL = /^[\p{L}\p{N}-]+$/u;
const TOP_LEVEL_LABEL = /^\p{L}{2,}$/u;

/** A URL (`scheme://…`, `www.…`) or a host name (`acme.example`), once `@` and `#` are gone. */
function isLink(word: string): boolean {
  const bare = trimPunctuation(word.replace(MENTION_CHARACTERS, ''));
  if (bare.includes('://') || bare.toLowerCase().startsWith('www.')) {
    return true;
  }
  const labels = bare.split('.');
  return (
    labels.length >= 2 &&
    labels.every((label) => HOST_LABEL.test(label)) &&
    TOP_LEVEL_LABEL.test(labels.at(-1) ?? '')
  );
}

function trimPunctuation(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && EDGE_PUNCTUATION.has(word.charAt(start))) {
    start += 1;
  }
  while (end > start && EDGE_PUNCTUATION.has(word.charAt(end - 1))) {
    end -= 1;
  }
  return word.slice(start, end);
}
