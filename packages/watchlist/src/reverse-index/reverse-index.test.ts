/**
 * C78.6: the reverse index finds every subject a changed entry may match, by names (in any order,
 * with typos the skeleton keeps), weak aliases, identifiers and crypto addresses. Every name and
 * identifier is fictional; the LEI is the sandbox value of C82.4.
 */
import { describe, expect, it } from 'vitest';
import { canonicaliseCryptoAddress } from '../crypto/index.js';
import { queryNameKeys, variantGroupsFrom } from '../keys/index.js';
import { analysePersonName } from '../names/index.js';
import { HOLDINGS, ORLAN, entry, name } from '../match/fixtures.test-support.js';
import { businessSubject, personSubject } from '../match/index.js';
import {
  REVERSE_INDEX_MAX_SUBJECTS,
  buildReverseIndex,
  prepareReverseIndex,
  trigramSimilarity,
  trigramsOf,
  type ReverseSubject,
} from './index.js';

const groups = variantGroupsFrom([], 'a'.repeat(64));
const EVM = canonicaliseCryptoAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')?.canonical;

const subjects: ReverseSubject[] = [
  { id: 'rep-orlan', subject: personSubject({ term: 'Orlan Vexby' }) },
  { id: 'rep-talia', subject: personSubject({ term: 'Talia Morrow-Quist' }) },
  {
    id: 'rep-holdings',
    subject: businessSubject({ term: 'Unrelated Trading', lei: '5299000SANDBOXLEI047' }),
  },
  { id: 'rep-wallet', cryptoAddress: EVM },
  { id: 'rep-orly', subject: personSubject({ term: 'Orly Vex' }) },
];
const index = buildReverseIndex(subjects, groups);

describe('buildReverseIndex', () => {
  it('finds the subjects an entry may match by name, in any order and through a typo', () => {
    expect(index.size).toBe(5);
    expect(index.candidatesFor(entry('X-1', 'individual', [name('Vexby Orlan')]))).toEqual([
      'rep-orlan',
    ]);
    expect(index.candidatesFor(entry('X-2', 'individual', [name('Orlan Vexbi')]))).toEqual([
      'rep-orlan',
    ]);
    expect(index.candidatesFor(entry('X-3', 'individual', [name('Nobody Known')]))).toEqual([]);
  });

  it('finds subjects by a weak alias, an identifier and a crypto address', () => {
    expect(index.candidatesFor(ORLAN)).toEqual(['rep-orlan', 'rep-orly']);
    expect(index.candidatesFor(HOLDINGS)).toEqual(['rep-holdings', 'rep-wallet']);
  });

  it('uses a key however many subjects hold it, without the list frequencies', () => {
    const crowd: ReverseSubject[] = Array.from({ length: 100 }, (_, number) => ({
      id: `rep-${String(number).padStart(3, '0')}`,
      subject: personSubject({ term: 'Ansel Brightwater' }),
    }));
    crowd.push({ id: 'rep-other', subject: personSubject({ term: 'Ansel Coldharbour' }) });
    const common = buildReverseIndex(crowd, groups);
    const found = common.candidatesFor(entry('X-4', 'individual', [name('BRIGHTWATER Ansel')]));
    expect(found).toHaveLength(101);
  });

  it(`holds at most ${String(REVERSE_INDEX_MAX_SUBJECTS)} subjects`, () => {
    expect(() =>
      buildReverseIndex(new Array<ReverseSubject>(REVERSE_INDEX_MAX_SUBJECTS + 1), groups),
    ).toThrow(RangeError);
  });
});

describe('the reverse index keyed by the list frequencies (owner decision 3 after 6B)', () => {
  /** Every query key of a token, held by 600 entries: over the bound of the cap (500). */
  const crowded = (...tokens: string[]) =>
    tokens.flatMap((token) =>
      queryNameKeys([analysePersonName(token)], groups).map((key) => [key, 600] as const),
    );

  it('keys each subject as its own search would: a key over the list bound is not used', () => {
    const subjects: ReverseSubject[] = [
      { id: 'rep-ansel', subject: personSubject({ term: 'Ansel Coldharbour' }) },
    ];
    const index = buildReverseIndex(subjects, groups, {
      frequencies: new Map([...crowded('Ansel'), ['t:coldharbour', 1]]),
      bound: 500,
    });
    expect(index.candidatesFor(entry('X-5', 'individual', [name('Ansel Brightwater')]))).toEqual(
      [],
    );
    expect(index.candidatesFor(entry('X-6', 'individual', [name('Coldharbour Ansel')]))).toEqual([
      'rep-ansel',
    ]);
  });

  it('finds Maria Elena Garcia for the listed Maria Garcia through the pair key, maria and garcia over the bound and elena rare', () => {
    const subjects: ReverseSubject[] = [
      { id: 'rep-meg', subject: personSubject({ term: 'Maria Elena Garcia' }) },
      { id: 'rep-other', subject: personSubject({ term: 'Maria Elena Westbrook' }) },
    ];
    const frequencies = new Map<string, number>([
      ...crowded('Maria', 'Garcia'),
      ['t:elena', 3],
      ['p:t:garcia+t:maria', 1],
    ]);
    const index = buildReverseIndex(subjects, groups, { frequencies, bound: 500 });
    expect(index.candidatesFor(entry('X-7', 'individual', [name('Maria Garcia')]))).toEqual([
      'rep-meg',
    ]);
  });

  it('meets a subject out of reach through the pair keys its search looks up, and an additional name through trigrams', () => {
    const subjects: ReverseSubject[] = [
      { id: 'rep-mg', subject: personSubject({ term: 'Maria Garcia' }) },
      {
        id: 'rep-extra',
        subject: personSubject({
          term: 'Talia Quist',
          'additional-names': [{ term: 'Orlen Vexbury' }],
        }),
      },
    ];
    const frequencies = new Map<string, number>([
      ...crowded('Maria', 'Garcia'),
      ['p:t:garcia+t:maria', 900],
    ]);
    const prepared = prepareReverseIndex(subjects, groups);
    expect([...prepared.keys]).toContain('p:t:garcia+t:maria');
    const index = prepared.build({ frequencies, bound: 500 });
    // Every key of the pair maria-garcia is over the bound: the search looks that pair key up
    // itself, up to its cap, so a namesake meets the subject and a misspelling does not.
    expect(index.candidatesFor(entry('X-8', 'individual', [name('Garcia Maria')]))).toEqual([
      'rep-mg',
    ]);
    expect(index.candidatesFor(entry('X-11', 'individual', [name('Maria Garsia')]))).toEqual([]);
    // An additional name is always searched by its trigrams too.
    expect(index.candidatesFor(entry('X-9', 'individual', [name('Orlen Vexburi')]))).toEqual([
      'rep-extra',
    ]);
    expect(index.candidatesFor(entry('X-10', 'individual', [name('Nobody Known')]))).toEqual([]);
  });

  it('measures trigram similarity as pg_trgm does', () => {
    expect([...trigramsOf('word')].sort()).toEqual(['  w', ' wo', 'ord', 'rd ', 'wor']);
    expect(trigramSimilarity('word', 'two words')).toBeCloseTo(0.363636, 5);
    expect(trigramSimilarity('maria garcia', 'maria garcia')).toBe(1);
    expect(trigramSimilarity('', 'maria')).toBe(0);
  });
});
