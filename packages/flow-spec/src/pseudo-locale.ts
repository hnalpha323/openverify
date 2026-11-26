/**
 * C161.7 (decision 35; owner `flow-i18n`; review H26): the pseudo-locales, generated from `en` by
 * our own transform in tests and in the preview's resolve (`api-templates` calls it, so the copy
 * arrives already transformed), and absent from the hosted flow's bundle (a build test in
 * `apps/flow`). As Android defines them: `en-XA` accents every letter, lengthens the message with
 * unaccented words and brackets it; `ar-XB` reverses it, to be shown right to left. What they catch:
 * text that is not in a catalog (unbracketed), text cut or overflowing at 320 CSS px (longer
 * messages), sentences built by concatenation (several brackets), and layouts that do not mirror.
 * Placeholders stay whole in both syntaxes, `{{name}}` of the built-in catalogs and `{name}` of
 * operator copy. No bidi control is added, since operator copy refuses them (C162.3). This module
 * imports nothing.
 */

/** `en-XA`: accented, lengthened, bracketed; `ar-XB`: reversed, right to left. */
export const PSEUDO_LOCALES = ['en-XA', 'ar-XB'] as const;
export type PseudoLocale = (typeof PSEUDO_LOCALES)[number];

/** The direction each pseudo-locale is shown in. */
export const PSEUDO_LOCALE_DIRECTION: Readonly<Record<PseudoLocale, 'ltr' | 'rtl'>> = Object.freeze(
  { 'en-XA': 'ltr', 'ar-XB': 'rtl' },
);

export function isPseudoLocale(value: unknown): value is PseudoLocale {
  return value === 'en-XA' || value === 'ar-XB';
}

/** A-Z and a-z, each with one accented look-alike in the Basic Multilingual Plane, in order. */
const ACCENTED_UPPER = 'ȦƁƇḒḖƑƓĤĪĴĶĿḾȠǾƤɊŘŞŦŬṼẆẊẎẐ';
const ACCENTED_LOWER = 'åƀçđéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýž';

/** The unaccented words `en-XA` pads with, as Android's pseudo-locale does. */
const PADDING = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** A message grows by at least this share, about what a translation adds to English. */
const LENGTHENING = 0.4;

/** `{{name}}` (built-in catalogs, spaces allowed) or `{name}` (operator copy, C162.3). */
const PLACEHOLDER = /\{\{\s*[A-Za-z0-9_]+\s*\}\}|\{[a-z][a-z0-9_]{0,39}\}/g;

interface Segment {
  readonly text: string;
  readonly placeholder: boolean;
}

function segmentsOf(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (match.index > last) {
      segments.push({ text: text.slice(last, match.index), placeholder: false });
    }
    segments.push({ text: match[0], placeholder: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), placeholder: false });
  }
  return segments;
}

function accent(text: string): string {
  let accented = '';
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      accented += ACCENTED_UPPER.charAt(code - 65);
    } else if (code >= 97 && code <= 122) {
      accented += ACCENTED_LOWER.charAt(code - 97);
    } else {
      accented += character;
    }
  }
  return accented;
}

/** Unaccented words, at least `LENGTHENING` of the message's length, after a space. */
function padding(length: number): string {
  const needed = Math.ceil(length * LENGTHENING);
  let pad = '';
  for (let index = 0; pad.length < needed; index += 1) {
    pad += ` ${PADDING[index % PADDING.length] ?? ''}`;
  }
  return pad;
}

function reverse(text: string): string {
  return Array.from(text).reverse().join('');
}

/** `text` in the pseudo-locale: bracketed, its placeholders whole. */
export function pseudoLocalize(locale: PseudoLocale, text: string): string {
  const segments = segmentsOf(text);
  if (locale === 'en-XA') {
    const accented = segments
      .map((segment) => (segment.placeholder ? segment.text : accent(segment.text)))
      .join('');
    return `[${accented}${padding(text.length)}]`;
  }
  const reversed = segments
    .reverse()
    .map((segment) => (segment.placeholder ? segment.text : reverse(segment.text)))
    .join('');
  return `[${reversed}]`;
}

export interface PseudoMessageTree {
  readonly [key: string]: string | PseudoMessageTree;
}

/** Every message of a catalog in the pseudo-locale, in a new tree of the same shape. */
export function pseudoLocalizeTree<T extends PseudoMessageTree>(locale: PseudoLocale, tree: T): T {
  return Object.fromEntries(
    Object.entries(tree).map(([key, value]) => [
      key,
      typeof value === 'string' ? pseudoLocalize(locale, value) : pseudoLocalizeTree(locale, value),
    ]),
  ) as T;
}
