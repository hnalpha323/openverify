import { writingSystemsOf } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import { isHeldOutGroup, watchlistImportSchema } from '../../record/index.js';
import { fictionalGivenName } from '../names.js';
import { seededRandom } from '../random.js';
import {
  HELD_OUT_SOURCE,
  TYPO_KINDS,
  cyrillicToLatin,
  formsByScript,
  generateHeldOutSet,
  heldOutGroups,
  initialOf,
  latinToCyrillic,
  otherLegalForm,
  parseVariantGroups,
  syntheticCustomers,
  withTypo,
  type VariantGroup,
} from './index.js';

/** Fictional groups in rigour's line format: two Latin spellings and our Cyrillic rendering. */
function fictionalGroupsText(count: number): string {
  const random = seededRandom('held-out-test/groups');
  const lines = Array.from({ length: count }, (_, index) => {
    const token = fictionalGivenName(random);
    const latin = token.latin.toLowerCase();
    return `${latin}, ${latin}e, ${token.cyrillic.toLowerCase()}, two words => Q-test-group-${String(index)}`;
  });
  return ['', 'not a group line', ...lines].join('\n');
}
const GROUPS: VariantGroup[] = parseVariantGroups(fictionalGroupsText(400));
const scripts = (text: string): string[] => [...writingSystemsOf(text)].sort();

describe('our own transliteration rules', () => {
  it('renders Latin in Cyrillic phonetically', () => {
    expect(latinToCyrillic('Brakin')).toBe('Бракин');
    expect(latinToCyrillic('shaw')).toBe('шав');
    expect(latinToCyrillic('Khorst')).toBe('Хорст');
  });

  it('romanises Cyrillic in German and French styles, unlike ICAO 9303', () => {
    expect(cyrillicToLatin('Щербаков', 'german')).toBe('Schtscherbakow');
    expect(cyrillicToLatin('Щербаков', 'french')).toBe('Chtcherbakov');
    expect(cyrillicToLatin('Юрий', 'german')).toBe('Jurij');
    expect(cyrillicToLatin('Юрий', 'french')).toBe('Iouri');
    for (const scheme of ['german', 'french'] as const) {
      expect(cyrillicToLatin('Щербаков', scheme).toLowerCase()).not.toBe('shcherbakov');
    }
  });
});

describe('name variants', () => {
  it('makes one typo of each kind, keeping the first character', () => {
    const random = seededRandom('typos');
    for (const kind of TYPO_KINDS) {
      for (let index = 0; index < 50; index += 1) {
        const typo = withTypo(random, 'Quillfeather', kind);
        expect(typo).not.toBe('Quillfeather');
        expect(typo.charAt(0)).toBe('Q');
        const delta = { substitute: 0, transpose: 0, insert: 1, delete: -1 }[kind];
        expect(typo.length).toBe('Quillfeather'.length + delta);
      }
    }
  });

  it('writes initials and other ways to write a legal form', () => {
    expect(initialOf('Avery')).toBe('A.');
    const random = seededRandom('forms');
    for (let index = 0; index < 20; index += 1) {
      expect(['Limited', null]).toContain(otherLegalForm(random, 'Ltd'));
      expect(['Ltd', null]).toContain(otherLegalForm(random, 'Limited'));
    }
    expect(otherLegalForm(random, 'Unknown Form')).toBeNull();
  });
});

describe('variant groups', () => {
  it('parses rigour’s group lines and skips anything else', () => {
    expect(GROUPS).toHaveLength(400);
    expect(GROUPS[0]?.id).toBe('Q-test-group-0');
    expect(GROUPS[0]?.forms).toHaveLength(4);
  });

  it('holds out the groups isHeldOutGroup selects, about a tenth', () => {
    const held = heldOutGroups(GROUPS, 'evaluation-seed');
    expect(held).toEqual(GROUPS.filter((group) => isHeldOutGroup(group.id, 'evaluation-seed')));
    expect(held.length).toBeGreaterThan(20);
    expect(held.length).toBeLessThan(64);
  });

  it('splits a group’s single-word forms by script', () => {
    const forms = formsByScript(GROUPS[0] ?? { id: '', forms: [] });
    expect(forms.latin).toHaveLength(2);
    expect(forms.other).toHaveLength(1);
    expect(scripts(forms.other[0] ?? '')).toEqual(['cyrillic']);
  });
});

describe('syntheticCustomers', () => {
  it('writes unique, reproducible customers in the public query shape', () => {
    const customers = syntheticCustomers({ seed: 'customers', count: 500 });
    expect(new Set(customers.map((customer) => customer.id)).size).toBe(500);
    for (const customer of customers) {
      expect(customer.query['name-first']).toBeTruthy();
      expect(customer.query['name-last']).toBeTruthy();
      expect(customer.query.birthdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(syntheticCustomers({ seed: 'customers', count: 500 })).toEqual(customers);
  });

  it('draws some names from the variant groups when given them', () => {
    const forms = new Set(GROUPS.flatMap((group) => group.forms));
    const customers = syntheticCustomers({ seed: 'mixed', count: 200, groups: GROUPS });
    const fromGroups = customers.filter((customer) =>
      forms.has((customer.query['name-first'] ?? '').toLowerCase()),
    );
    expect(fromGroups.length).toBeGreaterThan(20);
  });
});

describe('generateHeldOutSet', () => {
  const seed = 'evaluation-seed';
  const set = generateHeldOutSet({
    seed,
    persons: 40,
    companies: 20,
    customers: 100,
    groups: GROUPS,
    groupCases: 10,
  });
  const entries = new Map(set.list.entries.map((entry) => [entry.entry_id, entry] as const));
  const listedName = (id: string) => entries.get(id)?.names[0]?.full ?? '';
  const queryName = (query: Readonly<Record<string, string>>) =>
    query.term ??
    [query['name-first'], query['name-middle'], query['name-last']].filter(Boolean).join(' ');

  it('writes a valid list of fictional persons and companies and the customers', () => {
    expect(watchlistImportSchema.parse(set.list)).toEqual(set.list);
    expect(set.list.source).toBe(HELD_OUT_SOURCE);
    expect(set.list.entries.filter((entry) => entry.kind === 'individual')).toHaveLength(40 + 20);
    expect(set.list.entries.filter((entry) => entry.kind === 'entity')).toHaveLength(20);
    expect(set.customers).toHaveLength(100);
    expect(
      generateHeldOutSet({
        seed,
        persons: 40,
        companies: 20,
        customers: 100,
        groups: GROUPS,
        groupCases: 10,
      }),
    ).toEqual(set);
  });

  it('covers every variant source, each case aimed at a listed entry it differs from', () => {
    const sources = new Set(set.cases.map((entry) => entry.variantSource));
    for (const source of [
      'exact',
      'typo',
      'order_swap',
      'dropped_middle',
      'initials',
      'joined_tokens',
      'split_tokens',
      'legal_form',
      'own_transliteration',
      'held_out_group_cross_script',
      'held_out_group_same_script',
    ] as const) {
      expect(sources.has(source), source).toBe(true);
    }
    expect(new Set(set.cases.map((entry) => entry.id)).size).toBe(set.cases.length);
    for (const entry of set.cases) {
      expect(entries.has(entry.expectedEntryId), entry.id).toBe(true);
      const query = queryName(entry.query);
      if (entry.variantSource === 'exact') {
        expect(query).toBe(listedName(entry.expectedEntryId));
      } else {
        expect(query, entry.id).not.toBe(listedName(entry.expectedEntryId));
      }
    }
  });

  it('draws group cases only from held-out groups, across or within a script (V12)', () => {
    const groupCases = set.cases.filter((entry) => entry.groupIds.length > 0);
    expect(groupCases.length).toBe(20);
    for (const entry of groupCases) {
      for (const id of entry.groupIds) {
        expect(isHeldOutGroup(id, seed)).toBe(true);
      }
      const query = queryName(entry.query);
      expect(scripts(query)).toEqual(
        entry.variantSource === 'held_out_group_cross_script' ? ['cyrillic'] : ['latin'],
      );
    }
    expect([...set.heldOutGroupIds].sort()).toEqual(
      [...new Set(groupCases.flatMap((entry) => entry.groupIds))].sort(),
    );
  });

  it('crosses scripts in own-transliteration cases, and has no group case without groups', () => {
    for (const entry of set.cases.filter((c) => c.variantSource === 'own_transliteration')) {
      expect(scripts(queryName(entry.query))).not.toEqual(
        scripts(listedName(entry.expectedEntryId)),
      );
    }
    const plain = generateHeldOutSet({ seed, persons: 10, companies: 5, customers: 10 });
    expect(plain.cases.some((entry) => entry.groupIds.length > 0)).toBe(false);
    expect(plain.heldOutGroupIds).toEqual([]);
  });
});
