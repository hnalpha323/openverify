/**
 * Person names (C58.2). Both names are folded (both renderings), titles are stripped from the
 * front and generational suffixes from the end, then:
 *
 * | Comparison | Level, method |
 * |---|---|
 * | equal folded tokens | `full` |
 * | particles or compounds joined on one side (De Luca, DeLuca) | `partial`, `tokenization` |
 * | given and family names swapped | `partial`, `tokenization`, flag `swapped` |
 * | an initial for a given name (J, John) | `partial`, `substring` |
 * | a nickname (Bill, William) | `partial`, `nickname` |
 * | a token at Jaro-Winkler 0.92 or more | `partial`, `string_similarity` |
 * | a middle name or a second family name on one side only | as the rest |
 * | different middle names | at most `partial`, flag `middle-name-mismatch` |
 * | different generational suffixes (Jr, Sr) | at most `partial`, flag `suffix-mismatch` |
 * | no given or no family name on one side, a family name as an initial | `missing` |
 * | names in two writing systems | `missing`, flag `script-mismatch` |
 *
 * Anything else is `none`. A suffix or title on one side only is stripped (`remove_suffixes`,
 * `remove_prefixes`); a title that is also a given name (Don) is kept. Methods are reported for
 * `full` and `partial` results only. Every name is capped at 200 code points (C58.7).
 */
import { jaroWinkler } from '../name-matching.js';
import { phraseAt, phraseEndingAt } from './dictionaries.js';
import { fieldMatch, type FieldMatch, type MatchLevel, type MatchMethod } from './levels.js';
import { MATCHING_INPUT_LIMITS, capText } from './limits.js';
import { areNicknames, isListedName } from './nicknames.js';
import { foldText, inDifferentScripts } from './text.js';

/** A structured name: any part may be absent. */
export interface PersonName {
  readonly first?: string | null | undefined;
  readonly middle?: string | null | undefined;
  readonly last?: string | null | undefined;
}

/** The Jaro-Winkler score at or above which two name tokens agree (C31.2, C51.3). */
export const NAME_TOKEN_SIMILARITY = 0.92;

/** Generational suffixes libpostal does not list (ours). */
const ROMAN_SUFFIXES = new Set(['ii', 'iii', 'iv']);

/** One name part, folded: its tokens in both renderings, aligned. */
interface Tokens {
  readonly simple: readonly string[];
  readonly expanded: readonly string[];
}

/** A prepared part: its tokens, the normalisations that changed it and its suffix, if any. */
interface PreparedPart extends Tokens {
  readonly raw: string;
  readonly methods: ReadonlySet<MatchMethod>;
  readonly suffix: string | null;
}

const split = (value: string): string[] => (value === '' ? [] : value.split(' '));

function prepare(
  value: string | null | undefined,
  options: { titles: boolean; suffixes: boolean },
): PreparedPart {
  const raw = capText(value ?? '', MATCHING_INPUT_LIMITS.name);
  const folded = foldText(raw);
  const methods = new Set<MatchMethod>();
  if (folded.folded) {
    methods.add('fold_characters');
  }
  if (folded.specialCharacters) {
    methods.add('remove_special_characters');
  }
  let simple = split(folded.simplified);
  let expanded = split(folded.expanded);
  if (expanded.length !== simple.length) {
    expanded = simple;
  }
  // Titles in front, while a name remains; a title that is also a given name (Don) stays.
  while (options.titles && simple.length > 1) {
    const title = phraseAt('personal-titles', simple, 0);
    const first = simple[0] ?? '';
    if (
      title === null ||
      title.length >= simple.length ||
      (title.length === 1 && isListedName(first))
    ) {
      break;
    }
    simple = simple.slice(title.length);
    expanded = expanded.slice(title.length);
    methods.add('remove_prefixes');
  }
  let suffix: string | null = null;
  if (options.suffixes && simple.length > 1) {
    const last = simple.at(-1) ?? '';
    const found = ROMAN_SUFFIXES.has(last)
      ? { length: 1, canonicals: [last] }
      : phraseEndingAt('personal-suffixes', simple, simple.length);
    if (found !== null && found.length < simple.length) {
      suffix = found.canonicals[0] ?? null;
      simple = simple.slice(0, -found.length);
      expanded = expanded.slice(0, -found.length);
    }
  }
  return { raw, methods, suffix, simple, expanded };
}

const tokenAt = (tokens: Tokens, index: number) => ({
  simple: tokens.simple[index] ?? '',
  expanded: tokens.expanded[index] ?? '',
});

/** How two tokens agree: the methods of their agreement (none for equal tokens), or `null`. */
function tokenAgreement(
  a: { simple: string; expanded: string },
  b: { simple: string; expanded: string },
  initials: boolean,
): MatchMethod[] | null {
  if (
    a.simple === b.simple ||
    a.expanded === b.expanded ||
    a.simple === b.expanded ||
    a.expanded === b.simple
  ) {
    return [];
  }
  if (areNicknames(a.simple, b.simple)) {
    return ['nickname'];
  }
  if (
    initials &&
    ((a.simple.length === 1 && b.simple.startsWith(a.simple)) ||
      (b.simple.length === 1 && a.simple.startsWith(b.simple)))
  ) {
    return ['substring'];
  }
  return jaroWinkler(a.simple, b.simple) >= NAME_TOKEN_SIMILARITY ||
    jaroWinkler(a.expanded, b.expanded) >= NAME_TOKEN_SIMILARITY
    ? ['string_similarity']
    : null;
}

interface PartMatch {
  readonly level: MatchLevel;
  readonly methods: readonly MatchMethod[];
  readonly reordered: boolean;
}

const NO_PART: PartMatch = { level: 'missing', methods: [], reordered: false };
const NONE: PartMatch = { level: 'none', methods: [], reordered: false };

/**
 * Two parts: `full` on equal tokens, `partial` when joined they are equal or when every token of
 * the shorter agrees with a distinct token of the longer, `none` otherwise, `missing` when empty.
 * `initials` lets a one-letter token agree with a token it starts, except where `lastIsFamily`
 * marks each side's last token as a family name.
 */
function compareParts(a: Tokens, b: Tokens, initials: boolean, lastIsFamily = false): PartMatch {
  if (a.simple.length === 0 || b.simple.length === 0) {
    return NO_PART;
  }
  const joined = (tokens: Tokens, separator: string) => [
    tokens.simple.join(separator),
    tokens.expanded.join(separator),
  ];
  const [aSimple, aExpanded] = joined(a, ' ');
  const [bSimple, bExpanded] = joined(b, ' ');
  if (aSimple === bSimple || aExpanded === bExpanded) {
    return { level: 'full', methods: [], reordered: false };
  }
  const [aGlued, aGluedExpanded] = joined(a, '');
  const [bGlued, bGluedExpanded] = joined(b, '');
  if (aGlued === bGlued || aGluedExpanded === bGluedExpanded) {
    return { level: 'partial', methods: ['tokenization'], reordered: false };
  }
  const [shorter, longer] = a.simple.length <= b.simple.length ? [a, b] : [b, a];
  const used = new Set<number>();
  const assigned: number[] = [];
  const methods = new Set<MatchMethod>();
  // Equal tokens first, so a later fuzzy agreement cannot take another token's partner.
  const pending: number[] = [];
  for (let index = 0; index < shorter.simple.length; index += 1) {
    const token = tokenAt(shorter, index);
    const partner = longer.simple.findIndex(
      (candidate, at) =>
        !used.has(at) && tokenAgreement(token, tokenAt(longer, at), false)?.length === 0,
    );
    if (partner === -1) {
      pending.push(index);
    } else {
      used.add(partner);
      assigned[index] = partner;
    }
  }
  for (const index of pending) {
    const token = tokenAt(shorter, index);
    const shorterLast = index === shorter.simple.length - 1;
    let found = -1;
    for (let at = 0; at < longer.simple.length && found === -1; at += 1) {
      if (used.has(at)) {
        continue;
      }
      const allowInitial =
        initials && !(lastIsFamily && (shorterLast || at === longer.simple.length - 1));
      const agreement = tokenAgreement(token, tokenAt(longer, at), allowInitial);
      if (agreement !== null) {
        found = at;
        agreement.forEach((method) => methods.add(method));
      }
    }
    if (found === -1) {
      return NONE;
    }
    used.add(found);
    assigned[index] = found;
  }
  const inOrder =
    shorter.simple.length === longer.simple.length &&
    assigned.every((partner, index) => partner === index);
  if (!inOrder) {
    methods.add('tokenization');
  }
  return {
    level: 'partial',
    methods: [...methods],
    reordered: shorter.simple.length === longer.simple.length && !inOrder,
  };
}

const rank = (level: MatchLevel): number =>
  level === 'full' ? 3 : level === 'partial' ? 2 : level === 'none' ? 1 : 0;

/** A one-letter part on one side that starts the other side's first token. */
function initialOnly(a: Tokens, b: Tokens): boolean {
  const [letter] = a.simple;
  return (
    a.simple.length === 1 &&
    letter?.length === 1 &&
    b.simple.length > 0 &&
    (b.simple[0] ?? '').startsWith(letter) &&
    (b.simple[0] ?? '').length > 1
  );
}

const concat = (...parts: Tokens[]): Tokens => ({
  simple: parts.flatMap((part) => part.simple),
  expanded: parts.flatMap((part) => part.expanded),
});

/** What both names' normalisations and suffixes add to a match. */
function finish(
  level: MatchLevel,
  methods: Iterable<MatchMethod>,
  flags: string[],
  sides: readonly (readonly [PreparedPart, PreparedPart])[],
): FieldMatch {
  const used = new Set<MatchMethod>(methods);
  let finalLevel = level;
  for (const [a, b] of sides) {
    a.methods.forEach((method) => used.add(method));
    b.methods.forEach((method) => used.add(method));
    if (a.suffix !== null && b.suffix !== null && a.suffix !== b.suffix) {
      finalLevel = finalLevel === 'full' ? 'partial' : finalLevel;
      flags.push('suffix-mismatch');
    } else if ((a.suffix === null) !== (b.suffix === null)) {
      used.add('remove_suffixes');
    }
  }
  return fieldMatch(finalLevel, used, flags);
}

/** Compares two structured names. */
export function matchPersonNames(a: PersonName, b: PersonName): FieldMatch {
  const left = {
    first: prepare(a.first, { titles: true, suffixes: false }),
    middle: prepare(a.middle, { titles: false, suffixes: false }),
    last: prepare(a.last, { titles: false, suffixes: true }),
  };
  const right = {
    first: prepare(b.first, { titles: true, suffixes: false }),
    middle: prepare(b.middle, { titles: false, suffixes: false }),
    last: prepare(b.last, { titles: false, suffixes: true }),
  };
  const all = (side: typeof left) => [side.first.raw, side.middle.raw, side.last.raw].join(' ');
  if (inDifferentScripts(all(left), all(right))) {
    return fieldMatch('missing', [], ['script-mismatch']);
  }
  const family = compareParts(left.last, right.last, false);
  let given = compareParts(left.first, right.first, true);
  if (given.level !== 'full' && (left.middle.simple.length > 0 || right.middle.simple.length > 0)) {
    const withMiddle = compareParts(
      concat(left.first, left.middle),
      concat(right.first, right.middle),
      true,
    );
    given = rank(withMiddle.level) > rank(given.level) ? withMiddle : given;
  }
  if (family.level === 'none' || given.level === 'none') {
    if (initialOnly(left.last, right.last) || initialOnly(right.last, left.last)) {
      return given.level === 'none'
        ? fieldMatch('none')
        : fieldMatch('missing', [], ['family-name-initial']);
    }
    const crossFamily = compareParts(left.first, right.last, false);
    const crossGiven = compareParts(left.last, right.first, false);
    if (rank(crossFamily.level) >= 2 && rank(crossGiven.level) >= 2) {
      return finish(
        'partial',
        ['tokenization', ...crossFamily.methods, ...crossGiven.methods],
        ['swapped'],
        [
          [left.first, right.first],
          [left.last, right.last],
        ],
      );
    }
    return fieldMatch('none');
  }
  if (family.level === 'missing' || given.level === 'missing') {
    return fieldMatch(
      'missing',
      [],
      [
        ...(family.level === 'missing' ? ['family-name-missing'] : []),
        ...(given.level === 'missing' ? ['given-name-missing'] : []),
      ],
    );
  }
  let level: MatchLevel = family.level === 'full' && given.level === 'full' ? 'full' : 'partial';
  const methods = new Set<MatchMethod>([...family.methods, ...given.methods]);
  const flags: string[] = [];
  if (left.middle.simple.length > 0 && right.middle.simple.length > 0) {
    const middle = compareParts(left.middle, right.middle, true);
    if (middle.level !== 'full') {
      level = 'partial';
      middle.methods.forEach((method) => methods.add(method));
      if (middle.level === 'none') {
        flags.push('middle-name-mismatch');
      }
    }
  }
  return finish(level, methods, flags, [
    [left.first, right.first],
    [left.middle, right.middle],
    [left.last, right.last],
  ]);
}

/**
 * Compares two names written as one string each (a document's addressee, a register's officer):
 * the last token is taken as the family name.
 */
export function matchNameStrings(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const left = prepare(a, { titles: true, suffixes: true });
  const right = prepare(b, { titles: true, suffixes: true });
  if (left.simple.length === 0 || right.simple.length === 0) {
    return fieldMatch('missing');
  }
  if (inDifferentScripts(left.raw, right.raw)) {
    return fieldMatch('missing', [], ['script-mismatch']);
  }
  const lastOf = (part: PreparedPart): Tokens => ({
    simple: part.simple.slice(-1),
    expanded: part.expanded.slice(-1),
  });
  if (
    left.simple.length > 1 &&
    right.simple.length > 1 &&
    (initialOnly(lastOf(left), lastOf(right)) || initialOnly(lastOf(right), lastOf(left)))
  ) {
    return fieldMatch('missing', [], ['family-name-initial']);
  }
  if ((left.simple.length === 1) !== (right.simple.length === 1)) {
    return fieldMatch('missing', [], ['name-incomplete']);
  }
  const match = compareParts(left, right, true, true);
  if (match.level === 'none' || match.level === 'missing') {
    return fieldMatch(match.level);
  }
  return finish(match.level, match.methods, match.reordered ? ['swapped'] : [], [[left, right]]);
}
