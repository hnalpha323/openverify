/**
 * C78.1: name analysis on top of C58. A name becomes tokens in both folds and their original
 * script; titles and honorifics are dropped from the front of a person's name (keeping one that is
 * also a listed given name), generational suffixes are tagged (C58's, and roman II to IV),
 * particles and generic business words are tagged (they weigh 0.5, C78.4), legal forms are read at
 * either end of a business name and compare by their generic tag, `&` reads as "and", a leading
 * "The" is dropped, a run of single letters in a business name is one word (`I.B.M.`), and roles
 * come from structured fields, a record's name parts or a `FAMILY, Given` comma.
 */
import { capText, isListedName, phraseEndingAt } from '@openverify/checks';
import type { WatchlistEntryKind, WatchlistRecord } from '../record/index.js';
import { legalFormAt, legalFormEndingAt } from './legal-forms.js';
import {
  nameToken,
  phraseText,
  splitNameText,
  type NameToken,
  type NameTokenRole,
} from './tokens.js';

/** Persons are compared with individuals; businesses with entities, vessels and aircraft. */
export type NameKind = 'person' | 'business';

/** Input hygiene (as C58.7): a name is read up to 300 code points and 32 tokens. */
export const MAX_NAME_LENGTH = 300;
export const MAX_NAME_TOKENS = 32;

/**
 * Titles and honorifics dropped from the front of a person's name (ours, provisional; the
 * research's list of honorifics, `docs/research/phase6-matching.md` §1.4). C58's libpostal titles
 * are not used here: they hold professional abbreviations (`abd`, `bar`) that are also name parts.
 */
export const NAME_TITLES: readonly string[] = Object.freeze([
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'sir',
  'dame',
  'lord',
  'lady',
  'madame',
  'mme',
  'mlle',
  'monsieur',
  'herr',
  'frau',
  'senor',
  'senora',
  'sheikh',
  'shaikh',
  'sheik',
  'haji',
  'hajji',
  'mullah',
  'imam',
  'maulana',
  'maulvi',
  'gen',
  'general',
  'col',
  'colonel',
  'capt',
  'captain',
  'lt',
]);

/** Particles of person names (ours, provisional): they weigh 0.5 and give no token key. */
export const NAME_PARTICLES: readonly string[] = Object.freeze([
  'al',
  'el',
  'ul',
  'bin',
  'ibn',
  'ben',
  'bint',
  'binti',
  'abu',
  'da',
  'das',
  'de',
  'del',
  'della',
  'der',
  'des',
  'di',
  'do',
  'dos',
  'du',
  'la',
  'le',
  'van',
  'von',
  'ter',
  'ten',
  'zu',
  'y',
]);

/** Generic business words (ours, provisional): they weigh 0.5 and give no token key. */
export const BUSINESS_GENERIC_WORDS: readonly string[] = Object.freeze([
  'and',
  'of',
  'for',
  'group',
  'holding',
  'holdings',
  'international',
  'intl',
  'trading',
  'trade',
  'services',
  'service',
  'industries',
  'industry',
  'enterprises',
  'enterprise',
  'general',
  'global',
  'national',
  'investment',
  'investments',
  'management',
  'technology',
  'technologies',
  'solutions',
  'partners',
  'resources',
  'development',
]);

const TITLES = new Set(NAME_TITLES);
const PARTICLES = new Set(NAME_PARTICLES);
const GENERIC = new Set(BUSINESS_GENERIC_WORDS);
const ROMAN_SUFFIXES = new Set(['ii', 'iii', 'iv']);

export interface AnalysedName {
  readonly kind: NameKind;
  /** The name as given (capped; structured fields joined by spaces): PII, for sealed components. */
  readonly text: string;
  /** The comparable tokens, titles dropped, in the name's order. */
  readonly tokens: readonly NameToken[];
  /**
   * The tokens' simplified forms (the original for a token without one; a legal form as its key),
   * sorted and spaced: what `watchlist_names.normalised` holds for `pg_trgm` and the weak-alias
   * lookup (C78.3).
   */
  readonly normalised: string;
  /** The name had more than {@link MAX_NAME_TOKENS} tokens; the rest were not read. */
  readonly truncated: boolean;
}

/** A person's name in structured fields; any may be absent. */
export interface PersonNameFields {
  readonly first?: string | null | undefined;
  readonly middle?: string | null | undefined;
  readonly last?: string | null | undefined;
}

/** A raw token with the role its position gave it. */
interface Placed {
  readonly raw: string;
  readonly role: NameTokenRole | null;
}

const placed = (text: string | null | undefined, role: NameTokenRole | null): Placed[] =>
  splitNameText(capText(text ?? '', MAX_NAME_LENGTH)).map((raw) => ({ raw, role }));

/** `FAMILY, Given` (one comma, both sides named) gives roles; anything else gives none. */
function placedByComma(text: string): Placed[] {
  const capped = capText(text, MAX_NAME_LENGTH);
  const sides = capped.split(',');
  if (sides.length === 2) {
    const family = placed(sides[0], 'family');
    const given = placed(sides[1], 'given');
    if (family.length > 0 && given.length > 0) {
      return [...family, ...given];
    }
  }
  return placed(capped, null);
}

const isLatinWord = (token: NameToken) => token.script === 'latin' && token.type === 'word';

/** A generational suffix ending the tokens, as one suffix token with C58's canonical form. */
function suffixAtEnd(tokens: readonly NameToken[]): { length: number; token: NameToken } | null {
  const texts = tokens.map((token) => token.simple);
  const last = texts.at(-1) ?? '';
  const found = ROMAN_SUFFIXES.has(last)
    ? { length: 1, canonicals: [last] }
    : phraseEndingAt('personal-suffixes', texts, texts.length);
  if (found === null || found.length >= tokens.length) {
    return null;
  }
  const canonical = found.canonicals[0] ?? last;
  return {
    length: found.length,
    token: { ...nameToken(canonical, null, 'suffix'), simple: canonical, expanded: canonical },
  };
}

/** The tokens of a person's name: titles dropped, the suffix and particles tagged. */
function personTokens(positions: readonly Placed[]): NameToken[] {
  let tokens = positions.map(({ raw, role }) => nameToken(raw, role));
  while (
    tokens.length > 1 &&
    tokens[0] !== undefined &&
    TITLES.has(tokens[0].simple) &&
    !isListedName(tokens[0].simple)
  ) {
    tokens = tokens.slice(1);
  }
  const suffix = suffixAtEnd(tokens);
  if (suffix !== null) {
    tokens = [...tokens.slice(0, -suffix.length), suffix.token];
  }
  return tokens.map((token) =>
    isLatinWord(token) && PARTICLES.has(token.simple) ? { ...token, type: 'particle' } : token,
  );
}

/** A legal form as one token: its key in both renderings. */
const legalFormToken = (key: string): NameToken => ({
  simple: key,
  expanded: key,
  original: null,
  script: null,
  reliability: 'native',
  role: null,
  type: 'legal_form',
});

/** A run of two or more single Latin letters as one word (`I.B.M.` is `ibm`). */
function glueInitials(tokens: readonly NameToken[], raws: readonly string[]): NameToken[] {
  const out: NameToken[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) {
      out.push(nameToken(run.join('')));
    } else if (run.length === 1) {
      out.push(nameToken(run[0] ?? ''));
    }
    run = [];
  };
  tokens.forEach((token, index) => {
    if (token.script === 'latin' && token.simple.length === 1) {
      run.push(raws[index] ?? token.simple);
    } else {
      flush();
      out.push(token);
    }
  });
  flush();
  return out;
}

/** The tokens of a business name: `the`, initials, legal forms at either end, word types. */
function businessTokens(positions: readonly Placed[]): NameToken[] {
  let raws = positions.map(({ raw }) => raw);
  let tokens = positions.map(({ raw, role }) => nameToken(raw, role));
  if (tokens.length > 1 && tokens[0]?.simple === 'the') {
    tokens = tokens.slice(1);
    raws = raws.slice(1);
  }
  tokens = glueInitials(tokens, raws);
  const texts = tokens.map(phraseText);
  let start = 0;
  let end = tokens.length;
  const leading: NameToken[] = [];
  const trailing: NameToken[] = [];
  for (let found = legalFormEndingAt(texts.slice(start, end), end - start); ;) {
    if (found === null || found.length >= end - start) {
      break;
    }
    trailing.unshift(legalFormToken(found.key));
    end -= found.length;
    found = legalFormEndingAt(texts.slice(start, end), end - start);
  }
  for (let found = legalFormAt(texts.slice(start, end), 0); ;) {
    if (found === null || found.length >= end - start) {
      break;
    }
    leading.push(legalFormToken(found.key));
    start += found.length;
    found = legalFormAt(texts.slice(start, end), 0);
  }
  const words = tokens.slice(start, end).map((token): NameToken => {
    if (!isLatinWord(token)) {
      return token;
    }
    if (GENERIC.has(token.simple)) {
      return { ...token, type: 'generic' };
    }
    return PARTICLES.has(token.simple) ? { ...token, type: 'particle' } : token;
  });
  return [...leading, ...words, ...trailing];
}

function analysed(kind: NameKind, text: string, all: readonly NameToken[]): AnalysedName {
  const tokens = all.slice(0, MAX_NAME_TOKENS);
  return {
    kind,
    text: capText(text, MAX_NAME_LENGTH),
    tokens,
    normalised: tokens
      .map((token) => (token.simple === '' ? (token.original ?? '') : token.simple))
      .filter((text) => text !== '')
      .sort()
      .join(' '),
    truncated: all.length > MAX_NAME_TOKENS,
  };
}

/** Analyses a person's name: a string (the `FAMILY, Given` comma read) or structured fields. */
export function analysePersonName(name: string | PersonNameFields): AnalysedName {
  const positions =
    typeof name === 'string'
      ? placedByComma(name)
      : [
          ...placed(name.first, 'given'),
          ...placed(name.middle, 'middle'),
          ...placed(name.last, 'family'),
        ];
  const text =
    typeof name === 'string'
      ? name
      : [name.first, name.middle, name.last]
          .map((part) => (part ?? '').trim())
          .filter((part) => part !== '')
          .join(' ');
  return analysed('person', text, personTokens(positions));
}

/** Analyses a business's name. */
export function analyseBusinessName(name: string): AnalysedName {
  return analysed('business', name, businessTokens(placed(name.replace(/[&+]/gu, ' and '), null)));
}

const PART_ROLES: Readonly<Record<string, NameTokenRole>> = {
  given: 'given',
  family: 'family',
  middle: 'middle',
  patronymic: 'patronymic',
};

/**
 * Owner decision 1 after 6B: how many analysed list names a process keeps by default, most recently
 * used first. The same list names are screened again and again, the commonest most: analysing each
 * once per process is the `name-cache` shortcut (`match/shortcuts.ts`). A cached name also keeps
 * the scorer's units, joined units and content keys of it, about 2 KB a name in all (measured on
 * the development tables, owner decision 3 after 6C).
 */
export const ANALYSED_NAME_CACHE_SIZE = 50_000;

type NamePart = WatchlistRecord['names'][number]['parts'][number];

/** One cached analysis: what it was made from (the analysis reads nothing else) and the result. */
interface CachedName {
  readonly person: boolean;
  readonly parts: readonly NamePart[];
  readonly analysed: AnalysedName;
}

let cacheSize = ANALYSED_NAME_CACHE_SIZE;

/** The analyses of one full name, and its neighbours in the least-recently-used order. */
interface CachedFullName {
  readonly full: string;
  readonly items: CachedName[];
  older: CachedFullName | null;
  newer: CachedFullName | null;
}

/**
 * The cached analyses by full name (owner decision 3 after 6C: keyed by the full name, with the
 * kind and parts compared field by field, so a hit builds no key); a full name with several kinds
 * or part lists holds each of them. With `name-lru` the least-recently-used order is the list from
 * `oldest` to `newest`; without it, the map's insertion order, least recently used first.
 */
const analysedNames = new Map<string, CachedFullName>();
let oldest: CachedFullName | null = null;
let newest: CachedFullName | null = null;
let cachedCount = 0;

/** What the cache did since the last {@link resetAnalysedNameCacheWork}: a measure of its work, for tests. */
export interface AnalysedNameCacheWork {
  /** Hits: names found analysed. */
  readonly hits: number;
  /** Writes to the map of full names (a set or a delete). */
  readonly mapWrites: number;
}

const cacheWork = { hits: 0, mapWrites: 0 };

/** The cache's work since the last {@link resetAnalysedNameCacheWork}. */
export function analysedNameCacheWork(): AnalysedNameCacheWork {
  return { ...cacheWork };
}

/** Starts counting the cache's work again. */
export function resetAnalysedNameCacheWork(): void {
  cacheWork.hits = 0;
  cacheWork.mapWrites = 0;
}

let linkedOrder = true;

/**
 * Owner decision 3 after 6C (`name-lru`): whether the cache keeps its least-recently-used order in
 * a list of its own rather than in the map's insertion order. Switching it empties the cache.
 */
export function setAnalysedNameCacheOrder(linked: boolean): void {
  if (linked !== linkedOrder) {
    linkedOrder = linked;
    analysedNames.clear();
    oldest = null;
    newest = null;
    cachedCount = 0;
  }
}

function unlink(entry: CachedFullName): void {
  if (entry.older === null) {
    oldest = entry.newer;
  } else {
    entry.older.newer = entry.newer;
  }
  if (entry.newer === null) {
    newest = entry.older;
  } else {
    entry.newer.older = entry.older;
  }
  entry.older = null;
  entry.newer = null;
}

function append(entry: CachedFullName): void {
  entry.older = newest;
  entry.newer = null;
  if (newest === null) {
    oldest = entry;
  } else {
    newest.newer = entry;
  }
  newest = entry;
}

/** Marks a full name the most recently used. */
function touch(entry: CachedFullName): void {
  if (linkedOrder) {
    if (entry !== newest) {
      unlink(entry);
      append(entry);
    }
    return;
  }
  analysedNames.delete(entry.full);
  analysedNames.set(entry.full, entry);
  cacheWork.mapWrites += 2;
}

function forgetOldest(): boolean {
  let entry: CachedFullName | null;
  if (linkedOrder) {
    entry = oldest;
    if (entry !== null) {
      unlink(entry);
    }
  } else {
    // In insertion order the oldest is the map's first entry, read past the slots deleted before it.
    const first = analysedNames.values().next();
    entry = first.done === true ? null : first.value;
  }
  if (entry === null) {
    return false;
  }
  analysedNames.delete(entry.full);
  cacheWork.mapWrites += 1;
  cachedCount -= entry.items.length;
  return true;
}

/**
 * Sets how many analysed list names the process keeps (0 keeps none) and returns the previous
 * size. A name is pure input, so a cached analysis is the analysis.
 */
export function setAnalysedNameCacheSize(size: number): number {
  const previous = cacheSize;
  cacheSize = Math.max(0, Math.floor(size));
  while (cachedCount > cacheSize && forgetOldest()) {
    // Forget until the cache fits.
  }
  return previous;
}

const samePart = (a: NamePart, b: NamePart | undefined) =>
  a.role === b?.role && a.value === b.value;

/** Analyses one name of a list record: by its parts and their roles when it has them. */
export function analyseRecordName(
  name: WatchlistRecord['names'][number],
  kind: WatchlistEntryKind,
): AnalysedName {
  if (cacheSize === 0) {
    return analyseRecordNameUncached(name, kind);
  }
  const person = kind === 'individual';
  const entry = analysedNames.get(name.full);
  const cached = entry?.items.find(
    (item) =>
      item.person === person &&
      item.parts.length === name.parts.length &&
      item.parts.every((part, index) => samePart(part, name.parts[index])),
  );
  if (entry !== undefined) {
    touch(entry);
  }
  if (cached !== undefined) {
    cacheWork.hits += 1;
    return cached.analysed;
  }
  const analysed = analyseRecordNameUncached(name, kind);
  const item: CachedName = {
    person,
    parts: name.parts.map(({ role, value }) => ({ role, value })),
    analysed,
  };
  if (entry === undefined) {
    const added: CachedFullName = { full: name.full, items: [item], older: null, newer: null };
    analysedNames.set(name.full, added);
    cacheWork.mapWrites += 1;
    if (linkedOrder) {
      append(added);
    }
  } else {
    entry.items.push(item);
  }
  cachedCount += 1;
  while (cachedCount > cacheSize && forgetOldest()) {
    // Forget the least recently used names until the cache fits.
  }
  return analysed;
}

function analyseRecordNameUncached(
  name: WatchlistRecord['names'][number],
  kind: WatchlistEntryKind,
): AnalysedName {
  const nameKind: NameKind = kind === 'individual' ? 'person' : 'business';
  if (name.parts.length === 0) {
    return nameKind === 'person' ? analysePersonName(name.full) : analyseBusinessName(name.full);
  }
  const words: Placed[] = [];
  const suffixes: NameToken[] = [];
  const forms: NameToken[] = [];
  for (const part of name.parts) {
    if (part.role === 'title') {
      continue;
    }
    if (part.role === 'legal_form') {
      const texts = placed(part.value, null).map(({ raw }) => phraseText(nameToken(raw)));
      const found = legalFormAt(texts, 0);
      forms.push(
        legalFormToken(found?.length === texts.length ? found.key : `f:${texts.join(' ')}`),
      );
    } else if (part.role === 'suffix') {
      suffixes.push(...placed(part.value, null).map(({ raw }) => nameToken(raw, null, 'suffix')));
    } else {
      words.push(...placed(part.value, PART_ROLES[part.role] ?? null));
    }
  }
  const tokens = nameKind === 'person' ? personTokens(words) : businessTokens(words);
  return analysed(nameKind, name.full, [...tokens, ...suffixes, ...forms]);
}

const reliable = (token: NameToken) =>
  token.reliability === 'native' || token.reliability === 'icao';

/** Whether two tokens are equal after normalisation (see {@link namesExactlyEqual}). */
export function tokensExactlyEqual(a: NameToken, b: NameToken): boolean {
  if (a.type === 'legal_form' || b.type === 'legal_form') {
    return a.type === b.type && a.simple === b.simple;
  }
  if (reliable(a) && reliable(b)) {
    return (
      a.simple === b.simple ||
      a.expanded === b.expanded ||
      a.simple === b.expanded ||
      a.expanded === b.simple
    );
  }
  return a.original !== null && a.script === b.script && a.original === b.original;
}

/** Kuhn's augmenting paths: whether every token of `a` has a distinct equal token in `b`. */
function perfectlyMatched(a: readonly NameToken[], b: readonly NameToken[]): boolean {
  const partnerOf = new Array<number>(b.length).fill(-1);
  const augment = (left: number, seen: boolean[]): boolean => {
    for (let right = 0; right < b.length; right += 1) {
      const leftToken = a[left];
      const rightToken = b[right];
      if (
        seen[right] !== true &&
        leftToken !== undefined &&
        rightToken !== undefined &&
        tokensExactlyEqual(leftToken, rightToken)
      ) {
        seen[right] = true;
        const partner = partnerOf[right] ?? -1;
        if (partner === -1 || augment(partner, seen)) {
          partnerOf[right] = left;
          return true;
        }
      }
    }
    return false;
  };
  return a.every((_, left) => augment(left, []));
}

/**
 * Whether two names are equal after normalisation, in any token order (the `exact` preset, the
 * weak-alias rule and `name_exact`, C78.4, C78.5): the same number of tokens, each equal to a
 * distinct token of the other in either Latin rendering when both are reliable (native or ICAO),
 * else in their original script; legal forms by their key.
 */
export function namesExactlyEqual(a: AnalysedName, b: AnalysedName): boolean {
  return (
    a.tokens.length > 0 &&
    a.tokens.length === b.tokens.length &&
    perfectlyMatched(a.tokens, b.tokens)
  );
}
