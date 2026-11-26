/**
 * The sources of C148.3's golden pattern vectors (dev and test only; never bundled). Each match
 * source names a pattern of the restricted grammar, a few chosen inputs and an alphabet; the
 * generator adds seeded random inputs over the alphabet and asks ECMAScript's `RegExp` (`u` mode,
 * the whole value, as a field pattern is applied) for the expected answer. Refusal sources name a
 * pattern and the reason `compilePattern` must give.
 */

export interface MatchSource {
  readonly pattern: string;
  readonly inputs: readonly string[];
  /** Code points the random inputs are drawn from. */
  readonly alphabet: string;
  readonly seed: number;
}

export interface RefusalSource {
  readonly pattern: string;
  readonly reason: string;
}

export interface PatternVectorSources {
  readonly matches: readonly MatchSource[];
  readonly refusals: readonly RefusalSource[];
}

export interface PatternVectors {
  readonly description: string;
  readonly matches: readonly { pattern: string; input: string; matches: boolean }[];
  readonly refusals: readonly RefusalSource[];
}

const m = (pattern: string, inputs: readonly string[], alphabet: string, seed: number) =>
  ({ pattern, inputs, alphabet, seed }) satisfies MatchSource;

/** A code point as a string, so no invisible character is typed in this file. */
const cp = (code: number): string => String.fromCodePoint(code);

const LATIN = 'ab-_. 09AZz';
/** Two astral code points (U+1F600 and U+20BB7) and a combining mark: `u` mode reads code points. */
const ASTRAL = `a${cp(0x1f600)}${cp(0x20bb7)}${cp(0x301)}${cp(0xe9)}`;
const SPACES = ` \t\n\r${cp(0xa0)}${cp(0x2028)}${cp(0x3000)}${cp(0xfeff)}a1_`;

export const PATTERN_VECTOR_SOURCES: PatternVectorSources = {
  matches: [
    m('abc', ['abc', 'ab', 'abcd', ''], 'abc', 1),
    m('^abc$', ['abc', 'abcabc'], 'abc', 2),
    m('a|b|', ['', 'a', 'b', 'ab'], 'ab', 3),
    m('(?:ab|a)(?:c|bc)', ['abc', 'abbc', 'ac'], 'abc', 4),
    m('(ab)(c)', ['abc', 'ab'], 'abc', 5),
    m('a*', ['', 'aaaa', 'ab'], 'ab', 6),
    m('a+b?', ['a', 'ab', 'abb', 'b'], 'ab', 7),
    m('a?', ['', 'a', 'aa'], 'ab', 8),
    m('a{3}', ['aaa', 'aa', 'aaaa'], 'a', 9),
    m('a{2,}', ['a', 'aa', 'aaaaaaa'], 'ab', 10),
    m('a{2,4}', ['a', 'aa', 'aaaa', 'aaaaa'], 'a', 11),
    m('a{0,1}b{0}', ['', 'a', 'b'], 'ab', 12),
    m(
      '\\d{5}(?:-[0-9][0-9][0-9][0-9])?',
      ['12345', '12345-6789', '1234-5678', '12345-'],
      '0123456789-',
      13,
    ),
    m('[A-Z]{2}\\d{6,9}', ['AB123456', 'AB1234567890', 'ab123456'], 'ABab0123456789', 14),
    m('[^0-9]+', ['abc', 'a1', '', cp(0xe9)], `a1${cp(0xe9)} `, 15),
    m('[a-cx-z]*', ['abxz', 'abd', ''], 'abcdxyz', 16),
    m('[-a]+', ['-a-', 'b'], '-ab', 17),
    m('[a-]+', ['a-', '-'], '-ab', 18),
    m('[\\-\\]\\\\]+', ['-]\\', 'a'], '-]\\a', 19),
    m('[\\d\\s]+', ['1 2', 'a'], '12 a\t', 20),
    m('[^\\w]', ['-', 'a', '_'], `a_-${cp(0xe9)}`, 21),
    m('[]', ['', 'a'], 'a', 22),
    m('[^]', ['a', '\n', ''], 'a\n', 23),
    m('.', ['a', '\n', '\r', cp(0x2028), cp(0x2029), cp(0x1f600)], ASTRAL, 24),
    m('.+', ['ab', 'a\nb'], 'ab\n\r', 25),
    m('\\w+', ['abc_123', 'abc-1', cp(0xe9)], LATIN, 26),
    m('\\d+', ['0123456789', cp(0x661) + cp(0x662)], `0189a${cp(0x663)}`, 27),
    m('\\s+', [' \t', cp(0xa0), cp(0x2028), cp(0xfeff), cp(0x180e)], SPACES, 28),
    m('\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\^\\$\\\\\\/', ['.*+?()[]{}|^$\\/'], '.*\\/', 29),
    m('a/b', ['a/b'], 'a/b', 30),
    m(`${cp(0x1f600)}+`, ['', cp(0x1f600) + cp(0x1f600)], ASTRAL, 31),
    m(`[${cp(0x1f600)}-${cp(0x1f64f)}]`, ['a'], ASTRAL, 32),
    m('[a-z]+(?:\\.[a-z]+)', ['ab.cd', 'ab.', '.ab', 'a..b'], 'ab.', 33),
    m('(?:a|b)*c', ['abac', 'c', 'abab'], 'abc', 34),
    m('a^b', ['ab', ''], 'ab', 35),
    m('^$', ['', 'a'], 'a', 36),
    m('(?:)', ['', 'a'], 'a', 37),
    m('x(?:a|b|)y', ['xy', 'xay', 'xaby'], 'abxy', 38),
    m('[0-9A-Fa-f]{2}(?::[0-9A-Fa-f][0-9A-Fa-f]){5}', ['00:1A:2b:3C:4d:5E', '00:1A'], '0aF:g', 39),
    m('\\+?[0-9 ()-]{7,20}', ['+1 (555) 010-0100', '12'], '+0129 ()-', 40),
    m(`[${cp(0xe9)}${cp(0xe8)}]`, [cp(0xe9), `e${cp(0x301)}`], ASTRAL, 41),
    m('(?:a|a)*', ['aaaa', 'aab'], 'ab', 42),
    m('a*a*a*b', ['aaab', 'aaa', 'b'], 'ab', 43),
    m('$a', ['a', ''], 'a', 44),
    m('(?:^a|b$)+', ['a', 'ab', 'b', 'aa'], 'ab', 45),
  ],
  refusals: [
    { pattern: '(a)\\1', reason: 'backreference' },
    { pattern: '(?<x>a)\\k<x>', reason: 'named_group' },
    { pattern: 'a\\k<x>', reason: 'backreference' },
    { pattern: 'a(?=b)', reason: 'lookaround' },
    { pattern: 'a(?!b)', reason: 'lookaround' },
    { pattern: '(?<=a)b', reason: 'lookaround' },
    { pattern: '(?<!a)b', reason: 'lookaround' },
    { pattern: '\\p{L}', reason: 'property_escape' },
    { pattern: '[\\P{L}]', reason: 'property_escape' },
    { pattern: '(?i:a)', reason: 'flag_unsupported' },
    { pattern: '(a+)+', reason: 'nested_quantifier' },
    { pattern: '(?:a|b{2})*', reason: 'nested_quantifier' },
    { pattern: '\\d{5}(?:-\\d{4})?', reason: 'nested_quantifier' },
    { pattern: '[a-z]+(?:\\.[a-z]+)*', reason: 'nested_quantifier' },
    { pattern: 'a*?', reason: 'lazy_quantifier' },
    { pattern: 'a{2,3}?', reason: 'lazy_quantifier' },
    { pattern: 'a**', reason: 'nothing_to_repeat' },
    { pattern: '*a', reason: 'nothing_to_repeat' },
    { pattern: '^*', reason: 'nothing_to_repeat' },
    { pattern: 'a|+', reason: 'nothing_to_repeat' },
    { pattern: 'a{101}', reason: 'quantifier_too_large' },
    { pattern: 'a{1,101}', reason: 'quantifier_too_large' },
    { pattern: 'a{3,2}', reason: 'syntax' },
    { pattern: 'a{,2}', reason: 'syntax' },
    { pattern: 'a{', reason: 'syntax' },
    { pattern: 'a}', reason: 'syntax' },
    { pattern: 'a]', reason: 'syntax' },
    { pattern: '(a', reason: 'syntax' },
    { pattern: 'a)', reason: 'syntax' },
    { pattern: '[a', reason: 'syntax' },
    { pattern: 'a\\', reason: 'syntax' },
    { pattern: '[z-a]', reason: 'class_range_invalid' },
    { pattern: '[\\d-z]', reason: 'class_range_invalid' },
    { pattern: '[a-\\w]', reason: 'class_range_invalid' },
    { pattern: '\\b', reason: 'escape_unsupported' },
    { pattern: '\\D', reason: 'escape_unsupported' },
    { pattern: '\\n', reason: 'escape_unsupported' },
    { pattern: '\\u0041', reason: 'escape_unsupported' },
    { pattern: '\\x41', reason: 'escape_unsupported' },
    { pattern: '\\-', reason: 'escape_unsupported' },
    { pattern: '[\\q]', reason: 'escape_unsupported' },
    { pattern: '', reason: 'empty' },
    { pattern: 'a'.repeat(501), reason: 'too_long' },
    { pattern: '[a-z]{100}'.repeat(30), reason: 'pattern_too_complex' },
  ],
};

/** mulberry32: a small seeded generator, so the file is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANDOM_INPUTS = 12;
const MAX_RANDOM_LENGTH = 9;

/** The answer of ECMAScript's `RegExp` in `u` mode over the whole value: the oracle. */
export function regExpAnswer(pattern: string, input: string): boolean {
  return new RegExp(`^(?:${pattern})$`, 'u').test(input);
}

export function generatePatternVectors(sources: PatternVectorSources): PatternVectors {
  const matches: { pattern: string; input: string; matches: boolean }[] = [];
  for (const source of sources.matches) {
    const alphabet = Array.from(source.alphabet);
    const random = seeded(source.seed);
    const inputs = new Set<string>(source.inputs);
    for (let index = 0; index < RANDOM_INPUTS; index += 1) {
      const length = Math.floor(random() * (MAX_RANDOM_LENGTH + 1));
      let input = '';
      for (let at = 0; at < length; at += 1) {
        input += alphabet[Math.floor(random() * alphabet.length)] ?? '';
      }
      inputs.add(input);
    }
    for (const input of inputs) {
      matches.push({
        pattern: source.pattern,
        input,
        matches: regExpAnswer(source.pattern, input),
      });
    }
  }
  return {
    description:
      'C148.3 golden vectors: each pattern applied to the whole input in u mode. Generated by scripts/write-pattern-vectors.ts with RegExp as the oracle; refusals are the reasons compilePattern gives.',
    matches,
    refusals: sources.refusals,
  };
}
