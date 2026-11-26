/**
 * Owner decision 4 after Workflow 6C (`rescreen-6d`): the golden test of what the reverse index
 * reads from `keys/`, `queryNameKeys` and `queryNameReach`. The re-screen prepares every recurring
 * subject's keys and reach with them, so `rescreen-6d` may make them faster only as output-identical
 * borrowed edits in `keys/`; this digest of their outputs on seeded inputs fails any change of
 * output. It was pinned at Workflow 6D's base (`9882aee3`), before any change, and is never edited:
 * a change of output is a `KEYS_VERSION` change, which `keys-golden.test.ts` governs.
 *
 * The inputs are fictional names of `@openverify/watchlist/testing` in Latin, Cyrillic, Arabic and
 * Han script, with middle names, particles, initials, titles, suffixes, the `FAMILY, Given` form and
 * names past `pair-max-tokens`; fictional companies; and variant groups built from the names' own
 * tokens and joined pairs, some tokens in more groups than `pair-max-groups`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_PAIR_GROUPS,
  MAX_PAIRED_TOKENS,
  queryNameKeys,
  queryNameReach,
  variantGroupsFrom,
} from '../keys/index.js';
import { analyseBusinessName, analysePersonName, type AnalysedName } from '../names/index.js';
import { canonicalJson } from '../record/index.js';
import {
  fictionalCompanyName,
  fictionalFamilyName,
  fictionalGivenName,
  fictionalHanName,
  seededRandom,
  type NameToken,
} from '../testing/index.js';

/** The digest of every output below, pinned at Workflow 6D's base. */
const GOLDEN = 'c24450f0e61385909531a662b1abf358f0e6739d09646754990d422f1344afc9';

const random = seededRandom('rescreen-6d/query-keys-golden');
const PARTICLES = ['de', 'van', 'al', 'bin', 'von der', 'da'];
const TITLES = ['Dr', 'Mr', 'Sheikh'];
const SUFFIXES = ['Jr', 'III', 'Sr'];

const tokens: NameToken[] = Array.from({ length: 240 }, (_, index) =>
  index % 2 === 0 ? fictionalGivenName(random) : fictionalFamilyName(random),
);
const pick = () => random.pick(tokens);

/** A person's name as a subject or a list writes it. */
function personText(): string {
  const words = Array.from({ length: random.between(2, 4) }, () => pick().latin);
  switch (random.between(0, 7)) {
    case 0:
      return `${(words.at(-1) ?? '').toUpperCase()}, ${words.slice(0, -1).join(' ')}`;
    case 1:
      return `${words[0] ?? ''} ${random.pick(PARTICLES)} ${words.slice(1).join(' ')}`;
    case 2:
      return `${(words[0] ?? 'x').charAt(0)}. ${words.slice(1).join(' ')}`;
    case 3:
      return `${random.pick(TITLES)} ${words.join(' ')} ${random.pick(SUFFIXES)}`;
    case 4:
      return Array.from({ length: MAX_PAIRED_TOKENS + 2 }, () => pick().latin).join(' ');
    case 5:
      return words.map((word) => word.toLowerCase()).join('-');
    default:
      return words.join(' ');
  }
}

const names: AnalysedName[] = [
  ...Array.from({ length: 500 }, () => analysePersonName(personText())),
  ...Array.from({ length: 80 }, () => analysePersonName(`${pick().cyrillic} ${pick().cyrillic}`)),
  ...Array.from({ length: 40 }, () => analysePersonName(`${pick().arabic} ${pick().arabic}`)),
  ...Array.from({ length: 40 }, () => analysePersonName(fictionalHanName(random).han)),
  ...Array.from({ length: 40 }, () => analysePersonName(fictionalHanName(random).latin)),
  ...Array.from({ length: 30 }, () => analysePersonName(pick().latin)),
  ...Array.from({ length: 80 }, () => analyseBusinessName(fictionalCompanyName(random).full)),
  analysePersonName({ first: pick().latin, last: pick().latin }),
  analysePersonName({ first: pick().latin, middle: pick().latin, last: pick().latin }),
];

/**
 * Variant groups over the tokens' own forms: each Latin token with its Cyrillic rendering and a
 * respelling, joined pairs of two tokens, and a few tokens in more groups than `pair-max-groups`.
 */
const groups = variantGroupsFrom(
  [
    ...tokens
      .slice(0, 160)
      .map((token, index): [string, string[]] => [
        `Q${String(index)}`,
        [token.latin, token.cyrillic, `${token.latin}h`],
      ]),
    ...tokens
      .slice(0, 40)
      .map((token, index): [string, string[]] => [
        `J${String(index)}`,
        [`${token.latin}${tokens[index + 1]?.latin ?? ''}`, `${token.latin}z`],
      ]),
    ...tokens
      .slice(0, 6)
      .flatMap((token, index) =>
        Array.from({ length: MAX_PAIR_GROUPS + 2 }, (_, copy): [string, string[]] => [
          `M${String(index)}-${String(copy)}`,
          [token.latin, `${token.latin}${String.fromCharCode(97 + copy)}`],
        ]),
      ),
  ],
  'e'.repeat(64),
);

function outputs() {
  const single = names.map((name) => [
    name.normalised,
    queryNameKeys([name], groups),
    queryNameReach([name], groups),
  ]);
  const several = Array.from({ length: 60 }, (_, index) => {
    const chosen = [names[index * 3], names[index * 7 + 1], names[index * 11 + 2]].filter(
      (name): name is AnalysedName => name !== undefined,
    );
    return [queryNameKeys(chosen, groups), queryNameReach(chosen, groups)];
  });
  return { single, several };
}

describe('queryNameKeys and queryNameReach, as the reverse index reads them (owner decision 4 after 6C)', () => {
  it('keep their outputs on seeded names, so a speed-up in keys/ changes no posting', () => {
    const computed = outputs();
    // The inputs reach the paths a speed-up could break: pair keys, reach groups with pair keys,
    // and a token past pair-max-groups.
    const flat = computed.single.flatMap(([, keys]) => keys as string[]);
    expect(flat.some((key) => key.startsWith('p:'))).toBe(true);
    expect(flat.some((key) => key.startsWith('g:M0-'))).toBe(true);
    expect(
      computed.single.some(([, , reach]) =>
        (reach as string[][]).some((group) => group.some((key) => key.startsWith('p:'))),
      ),
    ).toBe(true);
    const digest = createHash('sha256').update(canonicalJson(computed), 'utf8').digest('hex');
    expect(digest).toBe(GOLDEN);
  });

  it('give the same outputs called again on the same names, in any order', () => {
    const first = outputs();
    expect(outputs()).toEqual(first);
    const reversed = [...names].reverse();
    expect(reversed.map((name) => queryNameReach([name], groups)).reverse()).toEqual(
      first.single.map(([, , reach]) => reach),
    );
  });
});
