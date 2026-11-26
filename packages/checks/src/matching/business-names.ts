/**
 * Business names (C58.6). Both names are folded, `&` is read as "and", a leading "The" is
 * dropped, and legal forms at the end (Inc, Ltd, GmbH, S.A., ...) are read by canonical form from
 * the committed libpostal classes, joined initials included (G.m.b.H. is gmbh). Then:
 *
 * | Comparison | Level, method |
 * |---|---|
 * | equal folded words, the legal forms equal or one-sided | `full` (`remove_suffixes` when one-sided) |
 * | different legal forms (Inc, LLC) | at most `partial`, flag `legal-form-mismatch` |
 * | words joined on one side | `partial`, `tokenization` |
 * | Jaro-Winkler 0.92 or more | `partial`, `string_similarity` |
 * | every word of one name in the other | `partial`, `tokenization` |
 * | names in two writing systems | `missing`, flag `script-mismatch` |
 *
 * Anything else is `none`; no name on either side is `missing`. Names are capped at 300 code
 * points (C58.7).
 */
import { jaroWinkler } from '../name-matching.js';
import { canonicalsOf, phraseEndingAt } from './dictionaries.js';
import { fieldMatch, type FieldMatch, type MatchMethod } from './levels.js';
import { MATCHING_INPUT_LIMITS, capText } from './limits.js';
import { foldText, inDifferentScripts } from './text.js';

/** The Jaro-Winkler score at or above which two business names or their words agree (C51.3). */
export const BUSINESS_NAME_SIMILARITY = 0.92;

interface PreparedBusinessName {
  readonly raw: string;
  readonly simple: readonly string[];
  readonly expanded: readonly string[];
  /** Each legal form at the end, as the canonical forms it stands for. */
  readonly forms: readonly (readonly string[])[];
  readonly methods: ReadonlySet<MatchMethod>;
}

const split = (value: string): string[] => (value === '' ? [] : value.split(' '));

function prepare(value: string | null | undefined): PreparedBusinessName {
  const raw = capText(value ?? '', MATCHING_INPUT_LIMITS.businessName);
  const folded = foldText(raw.replace(/[&+]/g, ' and '));
  const methods = new Set<MatchMethod>();
  if (folded.folded) {
    methods.add('fold_characters');
  }
  if (foldText(raw).specialCharacters) {
    methods.add('remove_special_characters');
  }
  let simple = split(folded.simplified);
  let expanded = split(folded.expanded);
  if (expanded.length !== simple.length) {
    expanded = simple;
  }
  if (simple.length > 1 && simple[0] === 'the') {
    simple = simple.slice(1);
    expanded = expanded.slice(1);
    methods.add('remove_prefixes');
  }
  // A legal form written as initials (G.m.b.H.) is read as one word.
  let run = 0;
  while (run < simple.length && simple[simple.length - 1 - run]?.length === 1) {
    run += 1;
  }
  if (run >= 2 && run < simple.length) {
    const glued = simple.slice(-run).join('');
    if (canonicalsOf('company-types', glued).length > 0) {
      simple = [...simple.slice(0, -run), glued];
      expanded = [...expanded.slice(0, -run), glued];
    }
  }
  const forms: (readonly string[])[] = [];
  for (;;) {
    const form = phraseEndingAt('company-types', simple, simple.length);
    if (form === null || form.length >= simple.length) {
      break;
    }
    forms.unshift(form.canonicals);
    simple = simple.slice(0, -form.length);
    expanded = expanded.slice(0, -form.length);
  }
  return { raw, simple, expanded, forms, methods };
}

const sameForm = (a: readonly string[], b: readonly string[]) => a.some((form) => b.includes(form));

/** Every form of one side among the other's: `equal` both ways, `one-sided` one way. */
function compareForms(
  a: readonly (readonly string[])[],
  b: readonly (readonly string[])[],
): 'equal' | 'one-sided' | 'mismatch' {
  const inB = a.every((form) => b.some((other) => sameForm(form, other)));
  const inA = b.every((form) => a.some((other) => sameForm(form, other)));
  if (inA && inB) {
    return a.length === b.length ? 'equal' : 'one-sided';
  }
  return inA || inB ? 'one-sided' : 'mismatch';
}

const wordsAgree = (
  a: { simple: string; expanded: string },
  b: { simple: string; expanded: string },
): 'exact' | 'similar' | null => {
  if (a.simple === b.simple || a.expanded === b.expanded) {
    return 'exact';
  }
  return jaroWinkler(a.simple, b.simple) >= BUSINESS_NAME_SIMILARITY ||
    jaroWinkler(a.expanded, b.expanded) >= BUSINESS_NAME_SIMILARITY
    ? 'similar'
    : null;
};

/** The names without their legal forms: their level and the methods it rests on. */
function compareWords(
  a: PreparedBusinessName,
  b: PreparedBusinessName,
): { level: 'full' | 'partial' | 'none'; methods: MatchMethod[] } {
  const join = (name: PreparedBusinessName, key: 'simple' | 'expanded', separator: string) =>
    name[key].join(separator);
  if (
    join(a, 'simple', ' ') === join(b, 'simple', ' ') ||
    join(a, 'expanded', ' ') === join(b, 'expanded', ' ')
  ) {
    return { level: 'full', methods: [] };
  }
  if (
    join(a, 'simple', '') === join(b, 'simple', '') ||
    join(a, 'expanded', '') === join(b, 'expanded', '')
  ) {
    return { level: 'partial', methods: ['tokenization'] };
  }
  const [shorter, longer] = a.simple.length <= b.simple.length ? [a, b] : [b, a];
  const word = (name: PreparedBusinessName, index: number) => ({
    simple: name.simple[index] ?? '',
    expanded: name.expanded[index] ?? '',
  });
  const used = new Set<number>();
  let similar = false;
  let inOrder = shorter.simple.length === longer.simple.length;
  let covered = true;
  for (let index = 0; index < shorter.simple.length && covered; index += 1) {
    let found = -1;
    for (let at = 0; at < longer.simple.length && found === -1; at += 1) {
      const how = used.has(at) ? null : wordsAgree(word(shorter, index), word(longer, at));
      if (how !== null) {
        found = at;
        similar ||= how === 'similar';
      }
    }
    covered = found !== -1;
    used.add(found);
    inOrder &&= found === index;
  }
  if (covered && shorter.simple.join('').length >= 3) {
    const methods: MatchMethod[] = [];
    if (similar) {
      methods.push('string_similarity');
    }
    if (!inOrder) {
      methods.push('tokenization');
    }
    return { level: 'partial', methods };
  }
  return jaroWinkler(join(a, 'simple', ' '), join(b, 'simple', ' ')) >= BUSINESS_NAME_SIMILARITY
    ? { level: 'partial', methods: ['string_similarity'] }
    : { level: 'none', methods: [] };
}

/** Compares two business names. */
export function matchBusinessNames(
  a: string | null | undefined,
  b: string | null | undefined,
): FieldMatch {
  const left = prepare(a);
  const right = prepare(b);
  if (left.simple.length === 0 || right.simple.length === 0) {
    return fieldMatch('missing');
  }
  if (inDifferentScripts(left.raw, right.raw)) {
    return fieldMatch('missing', [], ['script-mismatch']);
  }
  const words = compareWords(left, right);
  if (words.level === 'none') {
    return fieldMatch('none');
  }
  const methods = new Set<MatchMethod>([...words.methods, ...left.methods, ...right.methods]);
  const forms = compareForms(left.forms, right.forms);
  if (forms === 'mismatch') {
    return fieldMatch('partial', methods, ['legal-form-mismatch']);
  }
  if (forms === 'one-sided') {
    methods.add('remove_suffixes');
  }
  return fieldMatch(words.level, methods);
}
