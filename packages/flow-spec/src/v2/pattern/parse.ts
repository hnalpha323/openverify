/**
 * C148.3's restricted grammar (V10), read into a tree, never handed to `RegExp`:
 * - literal code points and the escaped syntax characters (`\.`, `\*`, ..., `\/`); `.`;
 * - bracket classes with ranges and negation over code points, which may hold `\d`, `\w` and `\s`
 *   (ASCII digits and word characters, as in `u` mode, and ECMAScript's fixed white-space list);
 * - `^` and `$` (the whole input: no `m` flag); alternation; capturing and `(?:...)` groups;
 * - `*`, `+`, `?`, `{n}`, `{n,}` and `{n,m}` with every bound at most 100, never lazy and never on
 *   a group that already holds a quantifier (no nested quantifiers).
 * Everything else is refused with its reason and the index (in UTF-16 code units) where it starts:
 * backreferences, lookaround, named groups, `\p{...}`, inline flags (no `i`, `m`, `s` or `y`: both
 * need Unicode case-folding or property data the plan does not source), and every other escape.
 */
import type { PatternRefusalReason } from './limits.js';

export type PatternNode =
  /** Code points in `ranges` (pairs, inclusive), or every code point outside them. */
  | { readonly t: 'set'; readonly ranges: readonly number[]; readonly negate: boolean }
  | { readonly t: 'start' }
  | { readonly t: 'end' }
  | { readonly t: 'cat'; readonly items: readonly PatternNode[] }
  | { readonly t: 'alt'; readonly options: readonly PatternNode[] }
  /** `max` -1 is unbounded. */
  | { readonly t: 'rep'; readonly body: PatternNode; readonly min: number; readonly max: number };

export class PatternRefusal extends Error {
  override readonly name = 'PatternRefusal';

  constructor(
    readonly reason: PatternRefusalReason,
    readonly index: number | null,
  ) {
    super(reason);
  }
}

/** The largest bound a counted quantifier may name (V10). */
export const MAX_QUANTIFIER_BOUND = 100;

const code = (character: string): number => character.codePointAt(0) ?? 0;

/** ECMAScript's `\d` and `\w` (ASCII in `u` mode without `i`), and `\s`'s fixed list. */
const DIGIT: readonly number[] = [code('0'), code('9')];
const WORD: readonly number[] = [
  code('0'),
  code('9'),
  code('A'),
  code('Z'),
  code('_'),
  code('_'),
  code('a'),
  code('z'),
];
const SPACE: readonly number[] = [
  0x09, 0x0d, 0x20, 0x20, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f,
  0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff,
];
/** `.` matches every code point but the line terminators (no `s` flag). */
const LINE_TERMINATORS: readonly number[] = [0x0a, 0x0a, 0x0d, 0x0d, 0x2028, 0x2029];

const CLASS_ESCAPES: Readonly<Record<string, readonly number[]>> = Object.freeze({
  d: DIGIT,
  w: WORD,
  s: SPACE,
});

const SYNTAX_CHARACTERS = new Set(Array.from('^$\\.*+?()[]{}|/'));
const QUANTIFIER_START = new Set(['*', '+', '?', '{']);

interface Parsed {
  readonly node: PatternNode;
  /** Whether a quantifier may follow (an assertion may not, in `u` mode). */
  readonly quantifiable: boolean;
  /** Whether the node holds a quantifier anywhere inside it. */
  readonly quantified: boolean;
}

class Reader {
  position = 0;

  constructor(readonly source: string) {}

  get done(): boolean {
    return this.position >= this.source.length;
  }

  /** The code point at the cursor, as a string, or `''` at the end. */
  peek(offset = 0): string {
    let at = this.position;
    for (let skipped = 0; skipped < offset && at < this.source.length; skipped += 1) {
      at += (this.source.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
    }
    const point = this.source.codePointAt(at);
    return point === undefined ? '' : String.fromCodePoint(point);
  }

  next(): string {
    const character = this.peek();
    this.position += character.length;
    return character;
  }

  refuse(reason: PatternRefusalReason, index: number = this.position): never {
    throw new PatternRefusal(reason, index);
  }
}

/** `{n}`, `{n,}` or `{n,m}` at the cursor, without moving it; `null` when it is not one. */
function readBraces(reader: Reader): { min: number; max: number; length: number } | null {
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  const match = /^\{(\d+)(,(\d*))?\}/.exec(reader.source.slice(reader.position));
  if (match === null) {
    return null;
  }
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : match[3] === '' ? -1 : Number(match[3]);
  return { min, max, length: match[0].length };
}

function parseQuantifier(reader: Reader, atom: Parsed): PatternNode {
  const at = reader.position;
  if (!atom.quantifiable) {
    reader.refuse('nothing_to_repeat', at);
  }
  let min: number;
  let max: number;
  const character = reader.peek();
  if (character === '{') {
    const braces = readBraces(reader);
    if (braces === null) {
      reader.refuse('syntax', at);
    }
    if (braces.max !== -1 && braces.max < braces.min) {
      reader.refuse('syntax', at);
    }
    if (braces.min > MAX_QUANTIFIER_BOUND || braces.max > MAX_QUANTIFIER_BOUND) {
      reader.refuse('quantifier_too_large', at);
    }
    reader.position += braces.length;
    ({ min, max } = braces);
  } else {
    reader.next();
    min = character === '+' ? 1 : 0;
    max = character === '?' ? 1 : -1;
  }
  if (reader.peek() === '?') {
    reader.refuse('lazy_quantifier', reader.position);
  }
  if (QUANTIFIER_START.has(reader.peek())) {
    reader.refuse('nothing_to_repeat', reader.position);
  }
  if (atom.quantified) {
    reader.refuse('nested_quantifier', at);
  }
  return { t: 'rep', body: atom.node, min, max };
}

/** An escape outside a class; the cursor is on the backslash. */
function parseEscape(reader: Reader): PatternNode {
  const at = reader.position;
  reader.next();
  const character = reader.next();
  if (character === '') {
    reader.refuse('syntax', at);
  }
  const set = CLASS_ESCAPES[character];
  if (set !== undefined) {
    return { t: 'set', ranges: set, negate: false };
  }
  if (/^[1-9k]$/.test(character)) {
    reader.refuse('backreference', at);
  }
  if (character === 'p' || character === 'P') {
    reader.refuse('property_escape', at);
  }
  if (SYNTAX_CHARACTERS.has(character)) {
    return { t: 'set', ranges: [code(character), code(character)], negate: false };
  }
  return reader.refuse('escape_unsupported', at);
}

type ClassAtom = { readonly point: number } | { readonly set: readonly number[] };

/** One member of a class: a code point, an escaped one, or `\d`, `\w`, `\s`. */
function parseClassAtom(reader: Reader): ClassAtom {
  const at = reader.position;
  const character = reader.next();
  if (character !== '\\') {
    return { point: code(character) };
  }
  const escaped = reader.next();
  const set = CLASS_ESCAPES[escaped];
  if (set !== undefined) {
    return { set };
  }
  if (escaped === 'p' || escaped === 'P') {
    reader.refuse('property_escape', at);
  }
  if (escaped === '-' || SYNTAX_CHARACTERS.has(escaped)) {
    return { point: code(escaped) };
  }
  return reader.refuse(escaped === '' ? 'syntax' : 'escape_unsupported', at);
}

function parseClass(reader: Reader): PatternNode {
  const open = reader.position;
  reader.next();
  const negate = reader.peek() === '^';
  if (negate) {
    reader.next();
  }
  const ranges: number[] = [];
  for (;;) {
    if (reader.done) {
      reader.refuse('syntax', open);
    }
    if (reader.peek() === ']') {
      reader.next();
      return { t: 'set', ranges, negate };
    }
    const first = parseClassAtom(reader);
    if (reader.peek() === '-' && reader.peek(1) !== ']' && reader.peek(1) !== '') {
      const dash = reader.position;
      reader.next();
      const last = parseClassAtom(reader);
      if (!('point' in first) || !('point' in last) || first.point > last.point) {
        reader.refuse('class_range_invalid', dash);
      }
      ranges.push(first.point, last.point);
    } else if ('point' in first) {
      ranges.push(first.point, first.point);
    } else {
      ranges.push(...first.set);
    }
  }
}

function parseGroup(reader: Reader, depth: number): Parsed {
  const open = reader.position;
  reader.next();
  if (reader.peek() === '?') {
    const marker = reader.peek(1);
    const after = reader.peek(2);
    if (marker === ':') {
      reader.position += 2;
    } else if (marker === '=' || marker === '!' || (marker === '<' && /^[=!]$/.test(after))) {
      reader.refuse('lookaround', open);
    } else if (marker === '<') {
      reader.refuse('named_group', open);
    } else if (/^[a-zA-Z-]$/.test(marker)) {
      reader.refuse('flag_unsupported', open);
    } else {
      reader.refuse('syntax', open);
    }
  }
  const body = parseDisjunction(reader, depth + 1);
  if (reader.peek() !== ')') {
    reader.refuse('syntax', open);
  }
  reader.next();
  return { node: body.node, quantifiable: true, quantified: body.quantified };
}

function parseAtom(reader: Reader, depth: number): Parsed {
  const character = reader.peek();
  const plain = (node: PatternNode): Parsed => ({ node, quantifiable: true, quantified: false });
  switch (character) {
    case '^':
      reader.next();
      return { node: { t: 'start' }, quantifiable: false, quantified: false };
    case '$':
      reader.next();
      return { node: { t: 'end' }, quantifiable: false, quantified: false };
    case '.':
      reader.next();
      return plain({ t: 'set', ranges: LINE_TERMINATORS, negate: true });
    case '(':
      return parseGroup(reader, depth);
    case '[':
      return plain(parseClass(reader));
    case '\\':
      return plain(parseEscape(reader));
    case '*':
    case '+':
    case '?':
      return reader.refuse('nothing_to_repeat');
    case '{':
      return reader.refuse(readBraces(reader) === null ? 'syntax' : 'nothing_to_repeat');
    case '}':
    case ']':
    case ')':
      return reader.refuse('syntax');
    default:
      reader.next();
      return plain({ t: 'set', ranges: [code(character), code(character)], negate: false });
  }
}

function parseAlternative(reader: Reader, depth: number): Parsed {
  const items: PatternNode[] = [];
  let quantified = false;
  while (!reader.done && reader.peek() !== '|' && !(reader.peek() === ')' && depth > 0)) {
    const atom = parseAtom(reader, depth);
    if (QUANTIFIER_START.has(reader.peek())) {
      items.push(parseQuantifier(reader, atom));
      quantified = true;
    } else {
      items.push(atom.node);
      quantified ||= atom.quantified;
    }
  }
  return {
    node: items.length === 1 && items[0] !== undefined ? items[0] : { t: 'cat', items },
    quantifiable: true,
    quantified,
  };
}

function parseDisjunction(reader: Reader, depth: number): Parsed {
  const options: PatternNode[] = [];
  let quantified = false;
  for (;;) {
    const alternative = parseAlternative(reader, depth);
    options.push(alternative.node);
    quantified ||= alternative.quantified;
    if (reader.peek() !== '|') {
      break;
    }
    reader.next();
  }
  return {
    node: options.length === 1 && options[0] !== undefined ? options[0] : { t: 'alt', options },
    quantifiable: true,
    quantified,
  };
}

/** The tree of a pattern, or a `PatternRefusal`. */
export function parsePattern(source: string): PatternNode {
  // At the top level an alternative runs to the end (a stray `)` is refused as an atom).
  return parseDisjunction(new Reader(source), 0).node;
}
