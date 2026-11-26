/**
 * Owner decision 4 after Workflow 6C (`rescreen-6d`): the golden test of the reverse index's
 * outputs, so a speed-up of its preparation, build or lookup keeps every posting and every
 * candidate. Seeded fictional subjects (one, two and three words, initials, additional names,
 * identifiers, businesses, crypto addresses) under seeded key frequencies (some keys over the bound,
 * some held by one entry, some by several), and seeded entries that share their tokens, misspell
 * them, reorder them, carry weak aliases, identifiers and addresses, or are strangers. The digest
 * was pinned at Workflow 6D's base (`9882aee3`), before any change, and is never edited.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicaliseCryptoAddress } from '../crypto/index.js';
import { variantGroupsFrom } from '../keys/index.js';
import { entry, name } from '../match/fixtures.test-support.js';
import { businessSubject, personSubject } from '../match/index.js';
import { canonicalJson, type WatchlistRecord } from '../record/index.js';
import {
  fictionalCompanyName,
  fictionalFamilyName,
  fictionalGivenName,
  seededRandom,
  type NameToken,
} from '../testing/index.js';
import { prepareReverseEntry, prepareReverseIndex, type ReverseSubject } from './index.js';

/** The digest of every output below, pinned at Workflow 6D's base. */
const GOLDEN = 'c984ff81a7e4391724febe5d037288abf4b500a154ff6d7f058c2f8235d49def';

const random = seededRandom('rescreen-6d/reverse-index-golden');
const tokens: NameToken[] = Array.from({ length: 90 }, (_, index) =>
  index % 2 === 0 ? fictionalGivenName(random) : fictionalFamilyName(random),
);
const pick = () => random.pick(tokens).latin;
const ADDRESSES = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4',
  '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
];
const groups = variantGroupsFrom(
  tokens
    .slice(0, 30)
    .map((token, index): [string, string[]] => [
      `Q${String(index)}`,
      [token.latin, `${token.latin}a`],
    ]),
  'd'.repeat(64),
);

/** A misspelling: one letter dropped. */
const typo = (word: string) => {
  const at = random.between(1, Math.max(1, word.length - 1));
  return word.slice(0, at) + word.slice(at + 1);
};

const subjects: ReverseSubject[] = Array.from({ length: 400 }, (_, index): ReverseSubject => {
  const id = `rep-${String(index).padStart(4, '0')}`;
  switch (index % 8) {
    case 0:
      return { id, subject: personSubject({ term: pick() }) };
    case 1:
      return { id, subject: personSubject({ 'name-first': pick(), 'name-last': pick() }) };
    case 2:
      return {
        id,
        subject: personSubject({
          'name-first': pick(),
          'name-middle': pick(),
          'name-last': pick(),
          'additional-names': [{ 'name-first': pick(), 'name-last': pick() }],
        }),
      };
    case 3:
      return { id, subject: personSubject({ term: `${pick().charAt(0)}. ${pick()}` }) };
    case 4:
      return {
        id,
        subject: personSubject({
          'name-first': pick(),
          'name-last': pick(),
          'identification-number': `P${String(index % 23)}`,
          'identification-type': 'passport',
        }),
      };
    case 5:
      return { id, subject: businessSubject({ term: fictionalCompanyName(random).full }) };
    case 6:
      return {
        id,
        cryptoAddress: canonicaliseCryptoAddress(ADDRESSES[index % ADDRESSES.length] ?? '')
          ?.canonical,
      };
    default:
      return { id, subject: personSubject({ term: `${pick()} ${pick()} ${pick()}` }) };
  }
});

/** Entries that meet the subjects by every path, and strangers. */
const entries: WatchlistRecord[] = Array.from({ length: 300 }, (_, index) => {
  const id = `E-${String(index)}`;
  const a = pick();
  const b = pick();
  switch (index % 7) {
    case 0:
      return entry(id, 'individual', [name(`${a} ${b}`, { primary: true })]);
    case 1:
      return entry(id, 'individual', [name(`${b.toUpperCase()}, ${typo(a)}`, { primary: true })]);
    case 2:
      return entry(id, 'individual', [
        name(`${a} ${b}`, { primary: true }),
        name(`${typo(b)} ${a} ${pick()}`),
        name(a, { quality: 'weak' }),
      ]);
    case 3:
      return entry(id, 'individual', [name(`${a}${b.toLowerCase()}`, { primary: true })], {
        identifiers: [{ kind: 'passport', value: `P${String(index % 23)}` }],
      });
    case 4:
      return entry(id, 'entity', [name(fictionalCompanyName(random).full, { primary: true })], {
        crypto_addresses: [{ raw: ADDRESSES[index % ADDRESSES.length] ?? '', ticker: 'SYN' }],
      });
    case 5:
      return entry(id, 'individual', [name(typo(a), { primary: true })]);
    default:
      return entry(id, 'individual', [
        name(`Zorvath Quillane ${String(index)}`, { primary: true }),
      ]);
  }
});

const prepared = prepareReverseIndex(subjects, groups);
/** Seeded counts over the subjects' keys: over the bound, within it, held by one entry, none. */
const frequencies = new Map(
  [...prepared.keys].sort().flatMap((key): [string, number][] => {
    const draw = random.between(0, 9);
    return draw === 0 ? [] : [[key, draw <= 2 ? 1 : draw <= 7 ? random.between(2, 50) : 400]];
  }),
);

function outputs() {
  const keyed = prepared.build({ frequencies, bound: 60 });
  const unkeyed = prepared.build();
  return {
    keys: [...prepared.keys].sort(),
    size: keyed.size,
    candidates: entries.map((record) => [
      keyed.candidatesFor(record),
      keyed.candidatesFor(prepareReverseEntry(record, groups)),
      unkeyed.candidatesFor(record),
    ]),
  };
}

describe('the reverse index, as the re-screen reads it (owner decision 4 after 6C)', () => {
  it('keeps every key and every candidate on seeded subjects and entries', () => {
    const computed = outputs();
    // The inputs reach every path: keys within and over the bound, trigrams, identifiers, crypto.
    expect(
      computed.candidates.filter(([found]) => (found?.length ?? 0) > 0).length,
    ).toBeGreaterThan(150);
    expect(
      computed.candidates.some(
        ([keyed, , unkeyed]) => (keyed?.length ?? 0) < (unkeyed?.length ?? 0),
      ),
    ).toBe(true);
    const digest = createHash('sha256').update(canonicalJson(computed), 'utf8').digest('hex');
    expect(digest).toBe(GOLDEN);
  });
});
