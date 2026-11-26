/**
 * C196.4, C199.7, C221.8 (Workflow 10A, api-android-10a; reviews F10, V12): the files this package
 * exports for the Android SDK's Kotlin ports, each written from the TypeScript implementation:
 *
 * - `contracts/fixtures/i18n/copy-keys.json`: every `COPY_KEYS` entry with its rules and legal mark
 *   (C199.7), which Android runs through its key map, an unmapped legal key failing closed;
 * - `contracts/fixtures/flow-spec/visibility-vectors.json`, `pattern-vectors.json` and
 *   `digits-vectors.json` (C196.4): the strict visibility evaluator, the pattern matcher and digit
 *   normalisation over a case table of Phase 9's golden cases copied as data (the pattern goldens
 *   read from their data file, `v2/pattern/vectors.json`), the pathological patterns on
 *   10,000-character inputs and the refusals; the Kotlin ports pass every case in `commonTest`.
 *
 * Assert-only (C221.8): each test fails when the committed file differs from what the
 * implementation gives over this file's own case table, and writes the file only under
 * `UPDATE_CONTRACT_FIXTURES=1`, so a plain `pnpm test` never changes the working tree. It imports
 * only the implementations, never another test file. Each file is also checked against its JSON
 * Schema beside it (contracts-10a, Workflow 10A Stage 1a (S)).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_COPY_ATTRIBUTES,
  COMPONENT_COPY_MAX_LENGTH,
  COPY_KEYS,
  COPY_LEGAL_KINDS,
  COPY_PLACEHOLDER_SOURCE,
} from './v2/copy-keys.js';
import { normalizeDigits } from './v2/digits.js';
import {
  PATTERN_INPUT_LIMIT,
  PATTERN_REFUSAL_REASONS,
  compilePattern,
  matchPattern,
} from './v2/pattern/index.js';
import { VisibilityRuleError, evaluateVisibility } from './v2/visibility.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../contracts/fixtures');

/** The repository's Prettier print width (`.prettierrc`). */
const WIDTH = 100;

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

const isPrimitive = (value: Json): value is string | number | boolean | null =>
  value === null || typeof value !== 'object';

/** How many members or items a list or an object holds. */
const sizeOf = (value: Json): number =>
  isPrimitive(value) ? 0 : Array.isArray(value) ? value.length : Object.keys(value).length;

/**
 * Prettier breaks a list of two or more lists, or of two or more objects, each holding two or more
 * items, whatever its width (its "concisely printed" rule).
 */
const alwaysBreaks = (items: readonly Json[]): boolean =>
  items.length > 1 &&
  (items.every((item) => Array.isArray(item) && sizeOf(item) > 1) ||
    items.every((item) => !isPrimitive(item) && !Array.isArray(item) && sizeOf(item) > 1));

/** A list on one line, or `null` when it cannot be: it holds an object or a list that breaks. */
function flat(value: Json): string | null {
  if (isPrimitive(value)) {
    return JSON.stringify(value);
  }
  if (!Array.isArray(value)) {
    return sizeOf(value) === 0 ? '{}' : null;
  }
  const items = value as readonly Json[];
  if (alwaysBreaks(items)) {
    return null;
  }
  const parts = items.map(flat);
  return parts.every((part) => part !== null) ? `[${parts.join(', ')}]` : null;
}

/**
 * JSON as the repository's Prettier prints a `.json` file whose objects are all written expanded:
 * an object one member per line (Prettier keeps an object expanded once its first member starts a
 * line); a list on one line when nothing in it breaks and it fits the width with what follows it,
 * else one item per line.
 */
function printJson(value: Json, indent = '', lead = 0, trailing = 0): string {
  if (isPrimitive(value)) {
    return JSON.stringify(value);
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value as readonly Json[];
    if (items.length === 0) {
      return '[]';
    }
    const inline = flat(items);
    if (inline !== null && lead + inline.length + trailing <= WIDTH) {
      return inline;
    }
    if (items.every((item) => typeof item === 'number')) {
      // Prettier fills a long list of numbers; no exported file holds one.
      throw new Error('a list of numbers too long for one line');
    }
    const lines = items.map(
      (item, index) =>
        `${inner}${printJson(item, inner, inner.length, index === items.length - 1 ? 0 : 1)}`,
    );
    return `[\n${lines.join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value as Readonly<Record<string, Json>>);
  if (entries.length === 0) {
    return '{}';
  }
  const lines = entries.map(([key, member], index) => {
    const head = `${inner}${JSON.stringify(key)}: `;
    return `${head}${printJson(member, inner, head.length, index === entries.length - 1 ? 0 : 1)}`;
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });

/** The schema of `relative` (`<name>.schema.json` beside it) holds `value`. */
function schemaProblems(relative: string, value: Json): string[] {
  const schemaFile = path.join(FIXTURES, relative.replace(/\.json$/, '.schema.json'));
  const validate = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')) as object);
  return validate(value)
    ? []
    : (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message ?? ''}`);
}

/** The committed text of `relative`, after writing `value` there under the update mode. */
function committedText(relative: string, value: Json): { expected: string; actual: string | null } {
  const file = path.join(FIXTURES, relative);
  const expected = `${printJson(value)}\n`;
  if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
    writeFileSync(file, expected);
  }
  return { expected, actual: existsSync(file) ? readFileSync(file, 'utf8') : null };
}

describe('the printer', () => {
  it('prints objects expanded, short primitive lists inline and long ones one per line', () => {
    expect(printJson({ a: [], b: {}, c: ['x', 1, true, null] })).toBe(
      '{\n  "a": [],\n  "b": {},\n  "c": ["x", 1, true, null]\n}',
    );
    const long = Array.from({ length: 12 }, (_unused, index) => `item-${String(index)}`);
    expect(printJson({ list: long }).split('\n')).toHaveLength(long.length + 4);
    expect(printJson([{ a: 1 }])).toBe('[\n  {\n    "a": 1\n  }\n]');
    expect(() => printJson({ n: Array.from({ length: 40 }, () => 12345) })).toThrow();
  });

  it('keeps nested lists on one line unless each of two or more holds two or more items', () => {
    expect(printJson({ a: [[]], b: [['x']], c: ['x', ['y', 'z']] })).toBe(
      '{\n  "a": [[]],\n  "b": [["x"]],\n  "c": ["x", ["y", "z"]]\n}',
    );
    expect(
      printJson([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('[\n  ["a", "b"],\n  ["c", "d"]\n]');
    expect(printJson([[{ a: 1 }]])).toBe('[\n  [\n    {\n      "a": 1\n    }\n  ]\n]');
  });

  it('counts the comma that follows a list against the width', () => {
    const fits = 'x'.repeat(WIDTH - '  "k": [""]'.length);
    expect(printJson({ k: [fits] })).toBe(`{\n  "k": ["${fits}"]\n}`);
    expect(printJson({ k: [fits], l: 1 })).toContain(`"k": [\n    "${fits}"\n  ],`);
  });
});

// ---------------------------------------------------------------------------------------------
// contracts/fixtures/i18n/copy-keys.json (C162.2, C199.7)
// ---------------------------------------------------------------------------------------------

const COPY_KEYS_FILE = 'i18n/copy-keys.json';

function copyKeysExport(): Json {
  return {
    format: 1,
    description:
      'C162.2, C199.7: every built-in copy key an operator may override, with its rules and its legal mark, from COPY_KEYS (packages/flow-spec/src/v2/copy-keys.ts). Written by packages/flow-spec/src/export-vectors.test.ts with UPDATE_CONTRACT_FIXTURES=1; never edited by hand. Android runs every key through its key map: an override it cannot place is ignored, unless the key is legal, when the step renders unsupported.',
    legalKinds: [...COPY_LEGAL_KINDS],
    componentAttributes: [...COMPONENT_COPY_ATTRIBUTES],
    componentMaxLength: COMPONENT_COPY_MAX_LENGTH,
    placeholderPattern: COPY_PLACEHOLDER_SOURCE,
    keys: Object.fromEntries(
      Object.keys(COPY_KEYS)
        .sort()
        .map((key) => {
          const definition = COPY_KEYS[key];
          if (definition === undefined) {
            throw new Error(`no definition for ${key}`);
          }
          return [
            key,
            {
              maxLength: definition.maxLength,
              placeholders: [...definition.placeholders],
              consent: definition.consent,
              multiline: definition.multiline,
              legal: definition.legal,
            },
          ];
        }),
    ),
  };
}

describe('contracts/fixtures/i18n/copy-keys.json (C199.7)', () => {
  const exported = copyKeysExport() as { keys: Record<string, { legal: string | null }> };

  it('holds every COPY_KEYS entry with its legal mark', () => {
    expect(Object.keys(exported.keys)).toEqual(Object.keys(COPY_KEYS).sort());
    expect(exported.keys['consent.biometric']?.legal).toBe('consent');
    expect(exported.keys['notice.session-integrity']?.legal).toBe('notice');
    expect(exported.keys['consent.title']?.legal).toBeNull();
  });

  it('meets its JSON Schema', () => {
    expect(schemaProblems(COPY_KEYS_FILE, copyKeysExport())).toEqual([]);
  });

  it('is the committed file', () => {
    const { expected, actual } = committedText(COPY_KEYS_FILE, copyKeysExport());
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// contracts/fixtures/flow-spec/visibility-vectors.json (C148.4, C196.1)
// ---------------------------------------------------------------------------------------------

const VISIBILITY_FILE = 'flow-spec/visibility-vectors.json';

type Rule = Readonly<Record<string, Json>>;

const v = (path: string): Rule => ({ var: path });

/** The values Phase 9's evaluator cases read (`visibility.test.ts`), copied as data. */
const SCREEN = Object.freeze({
  country: 'US',
  has_middle_name: false,
  interests: ['music', 'art'],
  age: 0,
});

interface VisibilityCase {
  readonly name: string;
  readonly rule: Rule | null;
  readonly values: Readonly<Record<string, Json>>;
}

const c = (name: string, rule: Rule | null, values: VisibilityCase['values'] = SCREEN) => ({
  name,
  rule,
  values,
});

/** The case table: Phase 9's golden cases as data first, then this export's own. */
const VISIBILITY_CASES: readonly VisibilityCase[] = [
  c('an absent rule holds', null, {}),
  c('=== on a string', { '===': [v('screen.country'), 'US'] }),
  c('== is ===, so a number is not its string', { '==': [v('screen.age'), '0'] }),
  c('== on a number', { '==': [v('screen.age'), 0] }),
  c('!== on a string', { '!==': [v('screen.country'), 'CA'] }),
  c('two lists are never equal', { '===': [v('screen.interests'), ['music', 'art']] }),
  c('a field with no value reads null', { '===': [v('screen.missing'), null] }),
  c('! of a field with no value', { '!': [v('screen.missing')] }),
  c('a field named like a prototype member reads null', {
    '===': [v('screen.constructor'), null],
  }),
  c('!! of false', { '!!': [v('screen.has_middle_name')] }),
  c('! with one operand not in a list', { '!': v('screen.age') }),
  c('an empty list is false', { '!!': [[]] }),
  c('a list with an item is true', { '!!': [['x']] }),
  c('and over truthy operands', { and: [true, v('screen.country')] }),
  c('and with a falsy number', { and: [v('screen.age'), true] }),
  c('or finds the truthy operand', { or: [false, '', v('screen.country')] }),
  c('or over falsy operands', { or: [false, 0] }),
  c('in a field list', { in: ['music', v('screen.interests')] }),
  c('not in a field list', { in: ['sport', v('screen.interests')] }),
  c('a field in a literal list', { in: [v('screen.country'), ['US', 'CA']] }),
  c('in inside a string', { in: ['S', v('screen.country')] }),
  c('a number is never inside a string', { in: [1, v('screen.country')] }),
  c('in a field with no value', { in: ['x', v('screen.missing')] }),
  c('!== null', { '!==': [v('screen.country'), null] }),
  c('and of !! and ===', {
    and: [{ '!!': [v('screen.has_middle_name')] }, { '===': [v('screen.age'), 18] }],
  }),
  c('or of two in', {
    or: [{ in: ['music', v('screen.interests')] }, { in: [v('screen.country'), ['US', 'CA']] }],
  }),
  c('a literal on the left', { '===': [true, v('screen.has_middle_name')] }),
  // This export's own cases.
  c('=== on an equal number', { '===': [v('screen.age'), 18] }, { age: 18 }),
  c('=== on a decimal number', { '===': [v('screen.amount'), 2.5] }, { amount: 2.5 }),
  c('=== on true', { '===': [v('screen.agreed'), true] }, { agreed: true }),
  c('an explicit null value reads null', { '===': [v('screen.middle'), null] }, { middle: null }),
  c('null === null', { '===': [null, v('screen.missing')] }),
  c('!== between two lists', { '!==': [v('screen.interests'), ['music', 'art']] }),
  c('!! of an empty string', { '!!': [v('screen.name')] }, { name: '' }),
  c('!! of a string', { '!!': [v('screen.name')] }, { name: 'Ada' }),
  c('!! of zero', { '!!': [v('screen.age')] }),
  c('!! of null', { '!!': [null] }),
  c('! of a non-empty list', { '!': [v('screen.interests')] }),
  c('and over three truthy operands', { and: [true, 'x', 1] }),
  c('and with one operand', { and: [v('screen.country')] }),
  c('or with one falsy operand', { or: [v('screen.has_middle_name')] }),
  c('a list needle is never in a list', { in: [v('screen.interests'), ['music']] }),
  c('a string field in a list of numbers', { in: [v('screen.country'), [1, 2]] }),
  c('a number in a list of numbers', { in: [v('screen.age'), [0, 1]] }),
  c('in a literal string', { in: ['U', 'US'] }),
  c('a nested rule', {
    '!': [{ and: [{ '===': [v('screen.country'), 'US'] }, { '!!': v('screen.has_middle_name') }] }],
  }),
  c('a rule over a field the values do not hold', { '===': [v('screen.later'), 'x'] }, {}),
];

/** Rules `evaluateVisibility` refuses with `VisibilityRuleError`: copied from Phase 9, then ours. */
const VISIBILITY_REFUSALS: readonly VisibilityCase[] = [
  c('an operator outside the subset (<)', { '<': [v('screen.age'), 1] }),
  c('a server fact', { '===': [v('inquiry.status'), 'x'] }),
  c('!= is not in the subset', { '!=': [v('screen.age'), 1] }),
  c('if is not in the subset', { if: [true, true, false] }),
  c('var with a default', { var: ['screen.age', 3] }),
  c('var of a number', { var: 7 }),
  c('=== with one operand', { '===': [v('screen.age')] }),
  c('! with two operands', { '!': [true, false] }),
  c('and with no operand', { and: [] }),
  c('in looks in an operator', { in: [v('screen.age'), { '!!': true }] }),
  c('an object literal operand', { '===': [{ a: 1 }, 1] }),
  c('two operators in one node', { '===': [v('screen.age'), 1], '!': [true] }),
  c('a list holding a var', { in: ['a', [v('screen.age')]] }),
  ...[
    'verifications.id_card.status',
    'signals.inquiry/bot_score',
    'inquiry.fields.country',
    'screen',
    'screen.country.length',
    'country',
  ].map((path) => c(`the path ${path}`, { and: [true, { '!!': v(path) }] })),
  c('a field name with a capital', { '!!': v('screen.Country') }),
  c('a field name starting with a digit', { '!!': v('screen.1st') }),
  c('a rule past the depth limit', deepRule(17)),
  c('a rule past the node limit', { or: Array.from({ length: 200 }, () => true) }),
];

/** `{ '!!': screen.age }` under `levels` nodes of `!`. */
function deepRule(levels: number): Rule {
  let rule: Rule = { '!!': v('screen.age') };
  for (let level = 0; level < levels; level += 1) {
    rule = { '!': [rule] };
  }
  return rule;
}

function visibilityExport(): Json {
  return {
    format: 1,
    description:
      'C148.4, C196.1: the strict visibility evaluator over a rule and its screen values. Each case gives the answer of evaluateVisibility (packages/flow-spec/src/v2/visibility.ts), a null rule being an absent one; each refusal is a rule it throws VisibilityRuleError for, which the Kotlin evaluator refuses with VisibilityRuleRefused. Written by packages/flow-spec/src/export-vectors.test.ts with UPDATE_CONTRACT_FIXTURES=1; never edited by hand.',
    cases: VISIBILITY_CASES.map(({ name, rule, values }) => ({
      name,
      rule,
      values,
      result: evaluateVisibility(rule ?? undefined, values),
    })),
    refusals: VISIBILITY_REFUSALS.map(({ name, rule, values }) => ({ name, rule, values })),
  };
}

describe('contracts/fixtures/flow-spec/visibility-vectors.json (C196.1)', () => {
  it('answers both ways and refuses every rule of the refusal table', () => {
    const results = VISIBILITY_CASES.map(({ rule, values }) =>
      evaluateVisibility(rule ?? undefined, values),
    );
    expect(results).toContain(true);
    expect(results).toContain(false);
    const answered = VISIBILITY_REFUSALS.filter(({ name, rule, values }) => {
      try {
        evaluateVisibility(rule ?? undefined, values);
        return true;
      } catch (error) {
        expect(error, name).toBeInstanceOf(VisibilityRuleError);
        return false;
      }
    });
    expect(answered.map(({ name }) => name)).toEqual([]);
  });

  it('gives each case a name once', () => {
    const names = [...VISIBILITY_CASES, ...VISIBILITY_REFUSALS].map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('meets its JSON Schema', () => {
    expect(schemaProblems(VISIBILITY_FILE, visibilityExport())).toEqual([]);
  });

  it('is the committed file', () => {
    const { expected, actual } = committedText(VISIBILITY_FILE, visibilityExport());
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// contracts/fixtures/flow-spec/pattern-vectors.json (C148.3, C196.2)
// ---------------------------------------------------------------------------------------------

const PATTERN_FILE = 'flow-spec/pattern-vectors.json';

/**
 * Phase 9's golden vectors (`src/v2/pattern/vectors.json`, a data file its generator writes with
 * `RegExp` as the oracle), read as data: their patterns and inputs are this export's first cases,
 * and each answer here is our matcher's own.
 */
const GOLDEN = JSON.parse(
  readFileSync(new URL('./v2/pattern/vectors.json', import.meta.url), 'utf8'),
) as {
  matches: readonly { pattern: string; input: string; matches: boolean }[];
  refusals: readonly { pattern: string; reason: string }[];
};

interface PatternCase {
  readonly name?: string;
  readonly pattern: string;
  readonly input?: string;
  readonly prefix?: string;
  readonly repeat?: { readonly text: string; readonly count: number };
  readonly suffix?: string;
  readonly pathological?: boolean;
}

/**
 * The pathological patterns (Phase 9's linear-time cases, copied as data) on 10,000-character
 * inputs, and the input cap: a backtracking engine takes 2^n or n^5 steps on the first three, our
 * Pike VM one pass. The Kotlin suite holds each to its step budget (C196.4).
 */
const PATHOLOGICAL: readonly PatternCase[] = [
  {
    name: 'an alternation of equals under a star',
    pattern: '(?:a|a)*',
    repeat: { text: 'a', count: PATTERN_INPUT_LIMIT - 1 },
    suffix: 'b',
  },
  {
    name: 'overlapping alternatives under a star',
    pattern: '(?:a|ab|b)*c',
    repeat: { text: 'ab', count: PATTERN_INPUT_LIMIT / 2 },
  },
  {
    name: 'five stars in a row',
    pattern: 'a*a*a*a*a*b',
    repeat: { text: 'a', count: PATTERN_INPUT_LIMIT },
  },
  { name: 'four dot-stars', pattern: '.*.*.*.*=x', repeat: { text: 'x=', count: 5000 } },
  {
    name: 'overlapping classes under a star',
    pattern: '(?:\\w|\\d|[a-z0-9_])*!',
    repeat: { text: 'a1_', count: 3333 },
  },
  {
    name: 'the longest program on the longest input',
    pattern: '[a-z]{100}'.repeat(19),
    repeat: { text: 'a', count: PATTERN_INPUT_LIMIT },
  },
  {
    name: 'an input at the cap matches',
    pattern: '[^]*',
    repeat: { text: 'a', count: PATTERN_INPUT_LIMIT },
  },
  {
    name: 'an input past the cap never matches',
    pattern: '[^]*',
    prefix: 'a',
    repeat: { text: 'a', count: PATTERN_INPUT_LIMIT },
  },
].map((entry) => ({ ...entry, pathological: true }));

/** Refusals beyond the golden file's, from Phase 9's `compilePattern` cases. */
const OWN_REFUSALS: readonly string[] = ['ab(?=c)', 'x\\1', '(?<x>a)', 'a{1,2}{3}', '[\\b]'];

function inputOf(entry: PatternCase): string {
  return (
    entry.input ??
    `${entry.prefix ?? ''}${(entry.repeat?.text ?? '').repeat(entry.repeat?.count ?? 0)}${entry.suffix ?? ''}`
  );
}

function answer(entry: PatternCase): boolean {
  const compiled = compilePattern(entry.pattern);
  if (!compiled.ok) {
    throw new Error(`a match case whose pattern is refused: ${entry.pattern}`);
  }
  return matchPattern(compiled.pattern, inputOf(entry));
}

const PATTERN_CASES: readonly PatternCase[] = [
  ...GOLDEN.matches.map(({ pattern, input }) => ({ pattern, input })),
  ...PATHOLOGICAL,
];

function refusalOf(pattern: string): string {
  const result = compilePattern(pattern);
  if (result.ok) {
    throw new Error(`a refusal case that compiles: ${pattern}`);
  }
  return result.reason;
}

function patternExport(): Json {
  return {
    format: 1,
    description:
      "C148.3, C196.2: the restricted pattern grammar applied to the whole input, as compilePattern and matchPattern (packages/flow-spec/src/v2/pattern/) answer. The first matches are Phase 9's golden vectors (src/v2/pattern/vectors.json); the pathological ones run on 10,000-character inputs, written as prefix + repeat.text x repeat.count + suffix, an input past 10,000 characters never matching; each refusal gives compilePattern's reason. Written by packages/flow-spec/src/export-vectors.test.ts with UPDATE_CONTRACT_FIXTURES=1; never edited by hand.",
    matches: PATTERN_CASES.map((entry) => ({
      ...(entry.name === undefined ? {} : { name: entry.name }),
      pattern: entry.pattern,
      ...(entry.input === undefined ? {} : { input: entry.input }),
      ...(entry.prefix === undefined ? {} : { prefix: entry.prefix }),
      ...(entry.repeat === undefined ? {} : { repeat: { ...entry.repeat } }),
      ...(entry.suffix === undefined ? {} : { suffix: entry.suffix }),
      matches: answer(entry),
      ...(entry.pathological === true ? { pathological: true } : {}),
    })),
    refusals: [...GOLDEN.refusals.map(({ pattern }) => pattern), ...OWN_REFUSALS].map(
      (pattern) => ({ pattern, reason: refusalOf(pattern) }),
    ),
  };
}

describe('contracts/fixtures/flow-spec/pattern-vectors.json (C196.2)', () => {
  it('agrees with the golden file on every golden case', () => {
    const disagreements = GOLDEN.matches.filter((entry) => answer(entry) !== entry.matches);
    expect(disagreements).toEqual([]);
    expect(GOLDEN.refusals.filter(({ pattern, reason }) => refusalOf(pattern) !== reason)).toEqual(
      [],
    );
  });

  it('runs the pathological cases on inputs of 10,000 characters, one past the cap', () => {
    const lengths = PATHOLOGICAL.map((entry) => inputOf(entry).length);
    expect(Math.max(...lengths)).toBe(PATTERN_INPUT_LIMIT + 1);
    expect(lengths.filter((length) => length >= PATTERN_INPUT_LIMIT - 1).length).toBeGreaterThan(4);
    expect(PATHOLOGICAL.map(answer)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it('gives a reason of PATTERN_REFUSAL_REASONS to every refusal', () => {
    const reasons = new Set<string>(PATTERN_REFUSAL_REASONS);
    const refused = [...GOLDEN.refusals.map(({ pattern }) => pattern), ...OWN_REFUSALS];
    expect(refused.map(refusalOf).filter((reason) => !reasons.has(reason))).toEqual([]);
  });

  it('meets its JSON Schema', () => {
    expect(schemaProblems(PATTERN_FILE, patternExport())).toEqual([]);
  });

  it('is the committed file', () => {
    const { expected, actual } = committedText(PATTERN_FILE, patternExport());
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------------
// contracts/fixtures/flow-spec/digits-vectors.json (C161.4, C196.3)
// ---------------------------------------------------------------------------------------------

const DIGITS_FILE = 'flow-spec/digits-vectors.json';

/** A string of code points, so no digit of another script is typed by hand. */
const cp = (...codes: readonly number[]): string => String.fromCodePoint(...codes);
/** U+0660 + n and U+06F0 + n for each ASCII digit n. */
const shifted = (digits: string, zero: number): string =>
  Array.from(digits, (digit) => cp(zero + Number(digit))).join('');
const arabicIndic = (digits: string): string => shifted(digits, 0x0660);
const extended = (digits: string): string => shifted(digits, 0x06f0);

/** The case table: Phase 9's golden cases as data first, then this export's own. */
const DIGITS_CASES: readonly { name: string; input: string }[] = [
  { name: 'every Arabic-Indic digit', input: arabicIndic('0123456789') },
  { name: 'every Extended Arabic-Indic digit', input: extended('0123456789') },
  {
    name: 'mixed with text, the decimal separator kept',
    input: `code ${arabicIndic('12')}-${extended('34')} 56 ${cp(0x066b)} x`,
  },
  { name: 'empty', input: '' },
  { name: 'no digits', input: 'no digits' },
  { name: 'Devanagari and fullwidth digits kept', input: cp(0x096c, 0xff17) },
  // This export's own cases.
  {
    name: 'a phone number',
    input: `+${arabicIndic('966')} ${arabicIndic('50')} ${arabicIndic('1234567')}`,
  },
  { name: 'a date', input: `${arabicIndic('2026')}-${arabicIndic('11')}-${arabicIndic('08')}` },
  { name: 'a code in Persian digits', input: extended('048213') },
  {
    name: 'Arabic letters around a digit kept',
    input: `${cp(0x0631, 0x0642, 0x0645)} ${arabicIndic('3')}`,
  },
  {
    name: 'the Arabic thousands separator kept',
    input: `${arabicIndic('1')}${cp(0x066c)}${arabicIndic('000')}`,
  },
  {
    name: 'the code points beside both ranges kept',
    input: cp(0x065f, 0x066a, 0x06ef, 0x06fa),
  },
  { name: 'Bengali digits kept', input: cp(0x09e6, 0x09e7, 0x09ef) },
  { name: 'Myanmar digits kept', input: cp(0x1040, 0x1049) },
  { name: 'Marathi (Devanagari) digits kept', input: cp(0x0966, 0x096f) },
  { name: 'an astral digit kept', input: cp(0x1d7ce) },
  { name: 'ASCII digits kept', input: '0123456789' },
];

function digitsExport(): Json {
  return {
    format: 1,
    description:
      'C161.4, C196.3: normalizeDigits (packages/flow-spec/src/v2/digits.ts): U+0660-U+0669 and U+06F0-U+06F9 to ASCII before validation and submission, every other character unchanged, the digits of other scripts included. Written by packages/flow-spec/src/export-vectors.test.ts with UPDATE_CONTRACT_FIXTURES=1; never edited by hand.',
    cases: DIGITS_CASES.map(({ name, input }) => ({
      name,
      input,
      output: normalizeDigits(input),
    })),
  };
}

describe('contracts/fixtures/flow-spec/digits-vectors.json (C196.3)', () => {
  it('maps both Arabic ranges to ASCII and keeps every other character', () => {
    const outputs = DIGITS_CASES.map(({ input }) => normalizeDigits(input));
    expect(outputs[0]).toBe('0123456789');
    expect(outputs[1]).toBe('0123456789');
    expect(outputs.every((output) => !/[٠-٩۰-۹]/u.test(output))).toBe(true);
    const kept = DIGITS_CASES.filter(({ name }) => name.endsWith('kept'));
    expect(kept.length).toBeGreaterThan(5);
  });

  it('meets its JSON Schema', () => {
    expect(schemaProblems(DIGITS_FILE, digitsExport())).toEqual([]);
  });

  it('is the committed file', () => {
    const { expected, actual } = committedText(DIGITS_FILE, digitsExport());
    expect(actual).toBe(expected);
  });
});
