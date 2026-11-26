/**
 * C126.1, C126.2: links in a message, checked on the rendered text, so a URL or a host a value carried
 * in is refused as surely as one the operator wrote. A link is `https:` to a host on the list, or an
 * exact link the caller names (the inquiry's own flow link). Nothing here knows the public suffix
 * list, so any name that ends in a dotted run of letters reads as a host: a false refusal is an
 * operator's message to reword, and a false pass is a link in a person's inbox.
 */
import { hostIsListed, normalizeHostOf } from '../https/hosts.js';

export interface MessageLinkRules {
  /** C126.1: `workflow-link-hosts`, and the flow's own host for an email. */
  hosts: readonly string[];
  /** C126.2: the links allowed whole, whatever their host. */
  exact: readonly string[];
}

const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/gu;
/** A scheme with its slashes. */
const SCHEMED = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s<>"']*/giu;
/** Schemes with no slashes that open something. */
const OPENING_SCHEME = /\b(?:javascript|data|vbscript|mailto|sms|tel|file|blob|ftp):/iu;
const PROTOCOL_RELATIVE = /(?<![\w:/])\/\/[^\s/<>"']/u;
/** Labels and a last label of two letters or more, not the tail of an address or of a longer word. */
const BARE_HOST =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,}(?![\p{L}\p{N}])/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const BARE_ADDRESS = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/u;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  colon: ':',
  sol: '/',
  period: '.',
  lt: '<',
  gt: '>',
  quot: '"',
};

/** What a browser would read: an entity can spell a scheme as well as a letter can. */
function decodeEntities(text: string): string {
  return text.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});?/giu, (entity, body: string) => {
    if (!body.startsWith('#')) {
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    }
    const hex = body[1]?.toLowerCase() === 'x';
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** Sentence punctuation that follows a link in text. */
const TRAILING_PUNCTUATION = '.,;:!?)';

function withoutTrailingPunctuation(written: string): string {
  let end = written.length;
  while (end > 0 && TRAILING_PUNCTUATION.includes(written.charAt(end - 1))) {
    end -= 1;
  }
  return written.slice(0, end);
}

function schemedAllowed(written: string, rules: MessageLinkRules): boolean {
  const link = withoutTrailingPunctuation(written);
  if (rules.exact.includes(link)) {
    return true;
  }
  if (!URL.canParse(link)) {
    return false;
  }
  const url = new URL(link);
  const host = normalizeHostOf(url);
  return url.protocol === 'https:' && host !== null && hostIsListed(host, rules.hosts);
}

/** Whether every link in `text` is one `rules` allow. */
export function messageLinksAllowed(text: string, rules: MessageLinkRules): boolean {
  const readable = decodeEntities(text).normalize('NFKC').replace(INVISIBLE, '');
  const schemed = readable.match(SCHEMED) ?? [];
  if (!schemed.every((link) => schemedAllowed(link, rules))) {
    return false;
  }
  const bare = readable.replace(SCHEMED, ' ');
  return (
    !OPENING_SCHEME.test(bare) &&
    !PROTOCOL_RELATIVE.test(bare) &&
    !BARE_HOST.test(bare) &&
    !BARE_ADDRESS.test(bare)
  );
}
