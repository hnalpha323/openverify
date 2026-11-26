/**
 * C78.3: retrieval keys and the `watchlist_names` rows, on synthetic groups and fictional names.
 */
import { describe, expect, it } from 'vitest';
import { analyseBusinessName, analysePersonName } from '../names/index.js';
import type { WatchlistRecord } from '../record/index.js';
import {
  MAX_PAIR_GROUPS,
  MAX_PAIRED_TOKENS,
  consonantSkeleton,
  listNameKeys,
  pairKey,
  queryNameKeys,
  queryNameReach,
  recordNameRows,
  tokenGroups,
  variantGroupsFrom,
} from './index.js';

const groups = variantGroupsFrom(
  [
    ['Q10', ['john', 'jon', 'джон']],
    ['Q20', ['abdulrahman', 'abd al rahman']],
    ['Q30', ['ivan', 'иван', 'iwan']],
  ],
  'a'.repeat(64),
);

describe('consonantSkeleton', () => {
  it.each([
    ['muhammad', 'md'],
    ['mohammed', 'md'],
    ['mohd', 'md'],
    ['magomed', 'mgmd'],
    ['smith', 'smt'],
    ['ivan', 'ivn'],
    ['', ''],
  ])('keys %s as %s', (form, skeleton) => {
    expect(consonantSkeleton(form)).toBe(skeleton);
  });
});

describe('listNameKeys', () => {
  it('gives token, skeleton, group, joined-pair and token-pair keys', () => {
    expect(listNameKeys(analysePersonName('John Smith'), groups)).toEqual([
      'g:Q10',
      'j:johnsmith',
      'p:g:Q10+t:smith',
      'p:t:john+t:smith',
      's:jn',
      's:smt',
      't:john',
      't:smith',
    ]);
  });

  it('gives no token or skeleton key for initials and particles, but joins them', () => {
    expect(listNameKeys(analysePersonName('J. van Smith'), groups)).toEqual([
      'j:jvan',
      'j:vansmith',
      's:smt',
      't:smith',
    ]);
  });

  it('keys a non-Latin token by its original form and its Latin form', () => {
    expect(listNameKeys(analysePersonName('Иван'), groups)).toEqual([
      'g:Q30',
      's:ivn',
      't:ivan',
      't:иван',
    ]);
  });

  it('keys both renderings of a folded token, and a joined pair by its groups', () => {
    expect(listNameKeys(analysePersonName('Müller'), groups)).toEqual([
      's:mlr',
      't:mueller',
      't:muller',
    ]);
    expect(listNameKeys(analysePersonName('Abd Rahman'), groups)).toContain('j:abdrahman');
    expect(listNameKeys(analysePersonName('Abdul Rahman'), groups)).toContain('g:Q20');
  });

  it('gives a business no key for its legal forms and generic words', () => {
    expect(listNameKeys(analyseBusinessName('Acme Trading Ltd'), groups)).toEqual([
      'j:acmetrading',
      's:acm',
      't:acme',
    ]);
  });
});

describe('the pair keys (owner decision 1 after 6B)', () => {
  const pairs = (keys: readonly string[]) => keys.filter((key) => key.startsWith('p:'));

  it('are unordered, so an order swap gives the same pair keys', () => {
    expect(pairKey('t:smith', 't:john')).toBe('p:t:john+t:smith');
    expect(pairKey('t:john', 't:smith')).toBe('p:t:john+t:smith');
    expect(pairs(listNameKeys(analysePersonName('Smith John'), groups))).toEqual(
      pairs(listNameKeys(analysePersonName('John Smith'), groups)),
    );
  });

  it('pair every two keyed tokens in each form and through their variant groups', () => {
    expect(pairs(listNameKeys(analysePersonName('Jon Smith'), groups))).toContain(
      'p:g:Q10+t:smith',
    );
    expect(pairs(listNameKeys(analysePersonName('Иван Петров'), groups))).toEqual([
      'p:g:Q30+t:petrov',
      'p:g:Q30+t:петров',
      'p:t:ivan+t:petrov',
      'p:t:ivan+t:петров',
      'p:t:petrov+t:иван',
      'p:t:иван+t:петров',
    ]);
    expect(pairs(listNameKeys(analysePersonName('Maria Elena Garcia'), groups))).toEqual([
      'p:t:elena+t:garcia',
      'p:t:elena+t:maria',
      'p:t:garcia+t:maria',
    ]);
  });

  it('leave out initials, particles, generic words and legal forms', () => {
    expect(pairs(listNameKeys(analysePersonName('J. van Smith'), groups))).toEqual([]);
    expect(pairs(listNameKeys(analyseBusinessName('Acme Trading Ltd'), groups))).toEqual([]);
  });

  it('pair a token in more groups than the bound by its spellings only', () => {
    const crowded = variantGroupsFrom(
      Array.from({ length: MAX_PAIR_GROUPS + 1 }, (_, index) => [
        `Q${String(100 + index)}`,
        ['orlan', `orlanv${String(index)}`],
      ]),
      'b'.repeat(64),
    );
    const keys = listNameKeys(analysePersonName('Orlan Vexby'), crowded);
    expect(keys.filter((key) => key.startsWith('g:'))).toHaveLength(MAX_PAIR_GROUPS + 1);
    expect(pairs(keys)).toEqual(['p:t:orlan+t:vexby']);
  });

  it(`pair at most the first ${String(MAX_PAIRED_TOKENS)} keyed tokens of a name`, () => {
    const long = analysePersonName('Aa Bb Cc Dd Ee Ff Gg Hh');
    const paired = pairs(listNameKeys(long, groups));
    expect(paired).toHaveLength((MAX_PAIRED_TOKENS * (MAX_PAIRED_TOKENS - 1)) / 2);
    expect(paired.some((key) => key.includes('t:gg') || key.includes('t:hh'))).toBe(false);
  });

  it('are queried as they are stored, without crossing keys', () => {
    const keys = queryNameKeys([analysePersonName('Maria Elena Garcia')], groups);
    expect(pairs(keys)).toEqual(
      pairs(listNameKeys(analysePersonName('Maria Garcia Elena'), groups)),
    );
    expect(keys.some((key) => key.startsWith('j:p:') || key.startsWith('t:p:'))).toBe(false);
  });

  it('group the keys that reach the list names holding each two keyed tokens of a name', () => {
    const [mariaElena, mariaGarcia, elenaGarcia] = queryNameReach(
      [analysePersonName('Maria Elena Garcia')],
      groups,
    );
    expect(mariaElena).toEqual(['p:t:elena+t:maria', 's:eln', 's:mr', 't:elena', 't:maria']);
    expect(mariaGarcia).toEqual(['p:t:garcia+t:maria', 's:grc', 's:mr', 't:garcia', 't:maria']);
    expect(elenaGarcia).toEqual(['p:t:elena+t:garcia', 's:eln', 's:grc', 't:elena', 't:garcia']);
    // A name with one keyed token is reached through that token's own keys alone.
    expect(queryNameReach([analysePersonName('J. Smith')], groups)).toEqual([['s:smt', 't:smith']]);
    // Each name of the subject on its own: one pair, then one token.
    expect(
      queryNameReach([analysePersonName('Maria Garcia'), analysePersonName('Ivan')], groups),
    ).toEqual([
      ['p:t:garcia+t:maria', 's:grc', 's:mr', 't:garcia', 't:maria'],
      ['g:Q30', 's:ivn', 't:ivan'],
    ]);
  });

  it('group the tokens past the paired ones by their own keys', () => {
    const reach = queryNameReach([analysePersonName('Aa Bb Cc Dd Ee Ff Gg')], groups);
    expect(reach).toHaveLength(21);
    expect(reach.at(-1)).toEqual(['t:ff', 't:gg']);
  });
});

describe('queryNameKeys', () => {
  it('adds the crossing keys, for every name of the subject', () => {
    const keys = queryNameKeys(
      [analysePersonName('Abdul Rahman'), analysePersonName('Ivan')],
      groups,
    );
    expect(keys).toContain('t:abdulrahman');
    expect(keys).toContain('j:abdul');
    expect(keys).toContain('j:rahman');
    expect(keys).toContain('t:ivan');
    expect(keys).toEqual([...new Set(keys)].sort());
  });
});

describe('tokenGroups', () => {
  it('finds a token by its Latin renderings, its original form and its ICAO form, never a lossy one', () => {
    const [ivan] = analysePersonName('Иван').tokens;
    const [john] = analysePersonName('JOHN').tokens;
    const [han] = analysePersonName('王小明').tokens;
    expect(ivan && tokenGroups(ivan, groups)).toEqual(['Q30']);
    expect(john && tokenGroups(john, groups)).toEqual(['Q10']);
    expect(han && tokenGroups(han, groups)).toEqual([]);
  });
});

describe('recordNameRows', () => {
  it('gives each name its normalised form and keys, and a weak alias no keys', () => {
    const record = {
      entry_id: 'TEST-1',
      kind: 'individual',
      names: [
        { full: 'SMITH, John', parts: [], script: 'latin', quality: 'strong', primary: true },
        { full: 'Johnny', parts: [], script: 'latin', quality: 'weak', primary: false },
      ],
      birth_dates: [],
      birth_places: [],
      countries: [],
      identifiers: [],
      addresses: [],
      crypto_addresses: [],
      programs: [],
      positions: [],
      relations: [],
    } satisfies WatchlistRecord;
    expect(recordNameRows(record, groups)).toEqual([
      {
        ordinal: 0,
        name: 'SMITH, John',
        normalised: 'john smith',
        script: 'latin',
        quality: 'strong',
        primary: true,
        keys: [
          'g:Q10',
          'j:smithjohn',
          'p:g:Q10+t:smith',
          'p:t:john+t:smith',
          's:jn',
          's:smt',
          't:john',
          't:smith',
        ],
      },
      {
        ordinal: 1,
        name: 'Johnny',
        normalised: 'johnny',
        script: 'latin',
        quality: 'weak',
        primary: false,
        keys: [],
      },
    ]);
  });
});
