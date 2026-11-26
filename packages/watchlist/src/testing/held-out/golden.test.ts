/**
 * Owner decision 5 after Workflow 6B: the existing held-out cases stay generated as before for a
 * given seed, so recall per variant source stays comparable with 6B's, and so do the shared
 * fixture helpers they use (`testing/{names,random,records,normalised}.ts`, which ingestion-6c
 * only adds to). Each digest below was taken at Workflow 6C's base (`94ab63f9`); a change to any
 * pinned output fails here. These are characterization tests: they pass on the code they pin.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SYNTHETIC_LEGAL_FORMS,
  fictionalCompanyName,
  fictionalFamilyName,
  fictionalGivenName,
  fictionalPersonName,
} from '../names.js';
import { normalisedImport, normalisedImportText } from '../normalised.js';
import { seededRandom } from '../random.js';
import { SYNTHETIC_COUNTRIES } from '../records.js';
import {
  TYPO_KINDS,
  cyrillicToLatin,
  generateHeldOutSet,
  latinToCyrillic,
  otherLegalForm,
  parseVariantGroups,
  syntheticCustomers,
  withTypo,
} from './index.js';

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

/** Fictional groups in rigour's line format: Latin spellings and our own other-script renderings. */
function fictionalGroupsText(count: number): string {
  const random = seededRandom('held-out-golden/groups');
  return Array.from({ length: count }, (_, index) => {
    const token = index % 2 === 0 ? fictionalGivenName(random) : fictionalFamilyName(random);
    const latin = token.latin.toLowerCase();
    return `${latin}, ${latin}a, ${token.cyrillic.toLowerCase()}, ${token.arabic} => Q-golden-${String(index)}`;
  }).join('\n');
}

const GROUPS = parseVariantGroups(fictionalGroupsText(600));

/** The digests at Workflow 6C's base (`94ab63f9`). */
const PINNED = {
  random: 'aae0371a707ccd3ff58c01277a741d626eae5bd67d62ff5a7368c6c4f9cf81e6',
  names: '7b5c6efdaa08f74f85c00412f54280a1dc948f3c65f1c34be28c49fa920e194f',
  import: {
    countries: '282e6821de0b110b44eae09493e0711313bb29fc4dc7a998d4fb5398543e3844',
    file: 'c3945e1957b9b258d3b3d8b93345405a3be69205378e2f16d6ed611aacad1998',
    text: '950ea39d7791be792067f0c1b3c00d0fd554cdef8a314b21270b813900a7b39a',
  },
  set: {
    list: 'ea2d202f7a01b976724a849a0545dba9abb1f725a9c374d6bd18744fd1abb873',
    cases: '1ac14a97de4de09522e8f4ccb8eee66cd21f237de69289634531fc5b0dde1724',
    customers: '7a98145879ef614d2c1dcdb39b1209c21e1e73a58df6f4e6d14bb23847943f8d',
    heldOutGroupIds: 'ff23c3925362d4882bfa4bf8fc6d59a6a174062e18400a5e4b6ebcfe0f3ba2af',
  },
  datedCases: '7593014abe729c79bca727269d3c19371245d0fd87f08fed709e567a14c20370',
  customers: {
    fictional: 'f40286fca12019269f77be0242a4226d495c842816d7e6c747f81b13531da3e5',
    mixed: 'b4c07cc3d32e579c9f751f22d1c52fdf1e651673601a41f757eb21143ff9300b',
  },
  variants: '1dba90929c76782deff2a6b09688bd8b566bc01dadcaaa25f6a07f67da674d04',
} as const;

describe('the shared fixture helpers keep their output (ingestion-6c only adds)', () => {
  it('seededRandom', () => {
    const random = seededRandom('held-out-golden/random');
    const values = {
      next: Array.from({ length: 64 }, () => random.next()),
      int: Array.from({ length: 16 }, () => random.int(1000)),
      between: Array.from({ length: 16 }, () => random.between(5, 9)),
      chance: Array.from({ length: 16 }, () => random.chance(0.3)),
      pick: Array.from({ length: 8 }, () => random.pick(['a', 'b', 'c', 'd', 'e'])),
      shuffle: random.shuffle(Array.from({ length: 20 }, (_, index) => index)),
      sample: random.sample(
        Array.from({ length: 30 }, (_, index) => index),
        7,
      ),
      string: random.string('abcxyz', 12),
      bytes: [...random.bytes(16)],
      fork: Array.from({ length: 4 }, () => random.fork('child').next()),
    };

    expect(digest(values)).toBe(PINNED.random);
  });

  it('the fictional names', () => {
    const random = seededRandom('held-out-golden/names');
    const values = {
      given: Array.from({ length: 100 }, () => fictionalGivenName(random)),
      family: Array.from({ length: 100 }, () => fictionalFamilyName(random)),
      withMiddle: Array.from({ length: 50 }, () => fictionalPersonName(random, { middle: true })),
      withoutMiddle: Array.from({ length: 50 }, () => fictionalPersonName(random)),
      companies: Array.from({ length: 100 }, () => fictionalCompanyName(random)),
      legalForms: SYNTHETIC_LEGAL_FORMS,
    };

    expect(digest(values)).toBe(PINNED.names);
  });

  it('the synthetic countries and the normalised import', () => {
    const set = generateHeldOutSet({ seed: 'held-out-golden/import', persons: 6, companies: 3 });
    const file = normalisedImport('evaluation-held-out', '2026-01-01T00:00:00Z', set.list.entries);

    expect({
      countries: digest(SYNTHETIC_COUNTRIES),
      file: digest(file),
      text: digest(normalisedImportText(file)),
    }).toEqual(PINNED.import);
  });
});

describe('the existing held-out cases keep their output for a given seed (owner decision 5)', () => {
  const options = {
    seed: 'held-out-golden/set',
    persons: 80,
    companies: 30,
    customers: 150,
    groups: GROUPS,
    groupCases: 12,
  } as const;

  it('the list, the cases, the customers and the held-out group ids', () => {
    const set = generateHeldOutSet(options);

    expect(set.cases).toHaveLength(80 + 30 + 24);
    expect({
      list: digest(set.list),
      cases: digest(set.cases),
      customers: digest(set.customers),
      heldOutGroupIds: digest(set.heldOutGroupIds),
    }).toEqual(PINNED.set);
  });

  it('the cases with the listed birth date', () => {
    const dated = generateHeldOutSet({ ...options, withBirthdates: true });

    expect(digest(dated.cases)).toBe(PINNED.datedCases);
  });

  it('the customers alone, with and without groups', () => {
    expect({
      fictional: digest(syntheticCustomers({ seed: 'held-out-golden/customers', count: 120 })),
      mixed: digest(
        syntheticCustomers({ seed: 'held-out-golden/customers', count: 120, groups: GROUPS }),
      ),
    }).toEqual(PINNED.customers);
  });

  it('the variants: typos, our own transliterations and legal forms', () => {
    const random = seededRandom('held-out-golden/variants');
    const values = {
      typos: TYPO_KINDS.map((kind) =>
        Array.from({ length: 20 }, () => withTypo(random, 'Quillfeather', kind)),
      ),
      cyrillic: ['Brakin', 'Shawford', 'Khorst', 'Yuliana', 'Zhetson'].map(latinToCyrillic),
      latin: ['Щербаков', 'Юрий', 'Жданова', 'Хорст'].flatMap((word) => [
        cyrillicToLatin(word, 'german'),
        cyrillicToLatin(word, 'french'),
      ]),
      forms: SYNTHETIC_LEGAL_FORMS.map((form) => otherLegalForm(random, form)),
    };

    expect(digest(values)).toBe(PINNED.variants);
  });
});
