import { describe, expect, it } from 'vitest';
import { watchlistRecordSchema, type WatchlistRecord } from '../../record/index.js';
import { SYNTHETIC_LEGAL_FORMS, fictionalFamilyName, fictionalGivenName } from '../names.js';
import { seededRandom } from '../random.js';
import {
  SCALE_COMPANY_SOURCES,
  SCALE_PERSON_SOURCES,
  generateScalePopulation,
  indistinguishableCustomers,
  nameKey,
  zipfCompanyLaw,
  zipfPersonLaw,
  zipfRank,
  type ScaleCustomer,
  type ScalePopulation,
  type VariantGroup,
} from './index.js';

/** Fictional groups in rigour's shape (lower-case forms, as rigour writes them). */
function fictionalGroups(count: number): VariantGroup[] {
  const random = seededRandom('scale-population-test/groups');
  return Array.from({ length: count }, (_, index) => {
    const token = index % 2 === 0 ? fictionalGivenName(random) : fictionalFamilyName(random);
    const latin = token.latin.toLowerCase();
    return { id: `Q-scale-${String(index)}`, forms: [latin, `${latin}e`, token.cyrillic] };
  });
}

const counts = (values: readonly string[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return map;
};

describe('zipfRank', () => {
  it('draws ranks with weights 1 / (rank + 1), the first the most often', () => {
    const draw = zipfRank(5);
    const random = seededRandom('zipf-rank');
    const drawn = [0, 0, 0, 0, 0];
    for (let index = 0; index < 60_000; index += 1) {
      const rank = draw(random);
      drawn[rank] = (drawn[rank] ?? 0) + 1;
    }
    const [first = 0, second = 0, , , fifth = 0] = drawn;

    expect(first / second).toBeGreaterThan(1.85);
    expect(first / second).toBeLessThan(2.15);
    expect(first / fifth).toBeGreaterThan(4.6);
    expect(first / fifth).toBeLessThan(5.4);
  });

  it('is flat with exponent 0, and refuses an empty range', () => {
    const draw = zipfRank(4, 0);
    const random = seededRandom('zipf-flat');
    const drawn = [0, 0, 0, 0];
    for (let index = 0; index < 40_000; index += 1) {
      const rank = draw(random);
      drawn[rank] = (drawn[rank] ?? 0) + 1;
    }

    for (const count of drawn) {
      expect(count / 40_000).toBeGreaterThan(0.23);
      expect(count / 40_000).toBeLessThan(0.27);
    }
    expect(() => zipfRank(0)).toThrow(RangeError);
  });
});

describe('the laws over name forms', () => {
  it('draws person forms from the groups and fictional names, heavy-headed, given and family apart', () => {
    const law = zipfPersonLaw({ seed: 'law', groups: fictionalGroups(600), fictional: 400 });
    const again = zipfPersonLaw({ seed: 'law', groups: fictionalGroups(600), fictional: 400 });
    const random = seededRandom('law-draws');
    const other = seededRandom('law-draws');
    const given = Array.from({ length: 5000 }, () => law.given(random).latin[0] ?? '');
    const family = Array.from({ length: 5000 }, () => law.family(random).latin[0] ?? '');
    const top = (values: string[]) =>
      [...counts(values).entries()].sort((left, right) => right[1] - left[1])[0] ?? ['', 0];

    expect(Array.from({ length: 5000 }, () => again.given(other).latin[0] ?? '')).toEqual(given);
    expect(top(given)[1] / 5000).toBeGreaterThan(0.08);
    expect(counts(given).size).toBeGreaterThan(300);
    expect(top(given)[0]).not.toBe(top(family)[0]);
    expect(given.some((form) => /^[a-z]+$/u.test(form))).toBe(true);
    expect(given.some((form) => /^[A-Z][a-z]+$/u.test(form))).toBe(true);
  });

  it('draws company names from fictional words, generic words and the synthetic legal forms', () => {
    const law = zipfCompanyLaw({ seed: 'companies', words: 800 });
    const random = seededRandom('company-draws');
    const names = Array.from({ length: 3000 }, () => law.name(random));
    const words = names.map((name) => name.words[0] ?? '');

    for (const name of names) {
      expect(name.words.length).toBeGreaterThanOrEqual(1);
      expect(name.words.length).toBeLessThanOrEqual(2);
      expect(SYNTHETIC_LEGAL_FORMS).toContain(name.legalForm);
      expect(name.generic === null || /^[A-Z][a-z]+$/u.test(name.generic)).toBe(true);
    }
    expect(Math.max(...counts(words).values()) / 3000).toBeGreaterThan(0.05);
    expect(names.some((name) => name.generic === null)).toBe(true);
    expect(names.some((name) => name.generic !== null)).toBe(true);
  });
});

describe('generateScalePopulation (owner decision 5)', () => {
  const options = () =>
    ({
      seed: 'population-seed',
      persons: 700,
      companies: 200,
      customers: 1500,
      businessCustomers: 300,
      law: zipfPersonLaw({ seed: 'population', groups: fictionalGroups(800), fictional: 600 }),
    }) as const;
  let built: { population: ScalePopulation; entries: Map<string, WatchlistRecord> } | undefined;
  /** Built on first use, so each test fails on its own while the generator is a stub. */
  const fixture = () => {
    if (built === undefined) {
      const population = generateScalePopulation(options());
      built = {
        population,
        entries: new Map(population.entries.map((entry) => [entry.entry_id, entry] as const)),
      };
    }
    return built;
  };
  const partOf = (entry: WatchlistRecord | undefined, role: string): string | undefined =>
    entry?.names[0]?.parts.find((part) => part.role === role)?.value;

  it('writes valid listed persons and companies, cases aimed at them and customers, the same for a seed', () => {
    const { population, entries } = fixture();
    expect(population.entries).toHaveLength(900);
    expect(population.entries.filter((entry) => entry.kind === 'individual')).toHaveLength(700);
    expect(population.entries.filter((entry) => entry.kind === 'entity')).toHaveLength(200);
    for (const entry of population.entries) {
      expect(watchlistRecordSchema.parse(entry)).toEqual(entry);
      expect(entry.entry_id.startsWith('HZ-')).toBe(true);
    }
    expect(population.cases).toHaveLength(900);
    expect(population.customers).toHaveLength(1800);
    const ids = [
      ...population.entries.map((entry) => entry.entry_id),
      ...population.cases.map((item) => item.id),
      ...population.customers.map((customer) => customer.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of population.cases) {
      expect(entries.has(item.expectedEntryId), item.id).toBe(true);
    }
    expect(generateScalePopulation(options())).toEqual(population);
    expect(generateScalePopulation({ ...options(), seed: 'another' }).cases).not.toEqual(
      population.cases,
    );
  });

  it('takes the person and company sources in turn', () => {
    const { population } = fixture();
    const persons = counts(
      population.cases.filter((c) => c.subject === 'person').map((c) => c.variantSource),
    );
    const companies = counts(
      population.cases.filter((c) => c.subject === 'business').map((c) => c.variantSource),
    );

    expect([...persons.keys()].sort()).toEqual([...SCALE_PERSON_SOURCES].sort());
    expect([...companies.keys()].sort()).toEqual([...SCALE_COMPANY_SOURCES].sort());
    for (const count of persons.values()) {
      expect(count).toBe(100);
    }
    for (const count of companies.values()) {
      expect(count).toBe(50);
    }
  });

  it('varies each listed person’s name by its source, and asks with the person’s birth date', () => {
    const { population, entries } = fixture();
    let listedDates = 0;
    for (const item of population.cases.filter((c) => c.subject === 'person')) {
      const entry = entries.get(item.expectedEntryId);
      const [given = '', middle, family = ''] = ['given', 'middle', 'family'].map((role) =>
        partOf(entry, role),
      );
      const { query } = item;
      expect(query.birthdate, item.id).toMatch(/^(19[4-9]\d|200[0-5])-\d{2}-\d{2}$/u);
      if (entry?.birth_dates.length === 1) {
        listedDates += 1;
        expect(entry.birth_dates[0]?.value).toBe(query.birthdate);
      }
      expect(item.edit === null).toBe(!['typo', 'transposition'].includes(item.variantSource));
      switch (item.variantSource) {
        case 'exact':
          expect([query['name-first'], query['name-middle'], query['name-last']]).toEqual([
            given,
            middle,
            family,
          ]);
          break;
        case 'order_swap':
          expect([query['name-first'], query['name-last']]).toEqual([family, given]);
          break;
        case 'dropped_middle':
          expect(middle).toBeDefined();
          expect([query['name-first'], query['name-middle'], query['name-last']]).toEqual([
            given,
            undefined,
            family,
          ]);
          break;
        case 'added_middle':
          expect(middle).toBeUndefined();
          expect(query['name-middle']).toBeTruthy();
          expect([query['name-first'], query['name-last']]).toEqual([given, family]);
          break;
        case 'initials':
          expect(query['name-first']).toBe(`${given.charAt(0)}.`);
          expect(query['name-last']).toBe(family);
          break;
        case 'typo': {
          const typed = query['name-last'] ?? '';
          const delta = { substitute: 0, insert: 1, delete: -1, transpose: 0 };
          expect(['substitute', 'insert', 'delete']).toContain(item.edit?.kind);
          expect(item.edit?.length).toBe(family.length);
          expect(typed.length - family.length).toBe(delta[item.edit?.kind ?? 'transpose']);
          expect(typed).not.toBe(family);
          expect(typed.charAt(0)).toBe(family.charAt(0));
          expect(query['name-first']).toBe(given);
          break;
        }
        case 'transposition': {
          const typed = query['name-last'] ?? '';
          let at = 0;
          while (at < typed.length && typed.charAt(at) === family.charAt(at)) {
            at += 1;
          }
          expect(item.edit).toEqual({ kind: 'transpose', length: family.length });
          expect(typed.length).toBe(family.length);
          expect(typed.slice(0, at)).toBe(family.slice(0, at));
          expect(typed.charAt(at)).toBe(family.charAt(at + 1));
          expect(typed.charAt(at + 1)).toBe(family.charAt(at));
          expect(typed.slice(at + 2)).toBe(family.slice(at + 2));
          break;
        }
        default:
          throw new Error(`a person case of ${item.variantSource}`);
      }
    }
    expect(listedDates / 700).toBeGreaterThan(0.78);
    expect(listedDates / 700).toBeLessThan(0.92);
  });

  it('varies each listed company’s name by its source', () => {
    const { population, entries } = fixture();
    for (const item of population.cases.filter((c) => c.subject === 'business')) {
      const listed = entries.get(item.expectedEntryId)?.names[0]?.full ?? '';
      const term = item.query.term ?? '';
      const [first = ''] = listed.split(' ');
      expect(Object.keys(item.query)).toEqual(['term']);
      switch (item.variantSource) {
        case 'exact':
          expect(term).toBe(listed);
          break;
        case 'typo':
        case 'transposition':
          expect(item.edit?.length).toBe(first.length);
          expect(term.split(' ').slice(1)).toEqual(listed.split(' ').slice(1));
          expect(term.split(' ')[0]).not.toBe(first);
          break;
        case 'legal_form': {
          const form = listed.split(' ').at(-1) ?? '';
          expect(SYNTHETIC_LEGAL_FORMS).toContain(form);
          expect(term).not.toBe(listed);
          expect(term.startsWith(listed.slice(0, listed.length - form.length).trim())).toBe(true);
          break;
        }
        default:
          throw new Error(`a company case of ${item.variantSource}`);
      }
    }
  });

  it('draws customers from the same law, persons with a birth date and companies by name', () => {
    const { population } = fixture();
    const persons = population.customers.filter((customer) => customer.subject === 'person');
    const businesses = population.customers.filter((customer) => customer.subject === 'business');
    const families = counts(persons.map((customer) => customer.query['name-last'] ?? ''));
    const listedFamilies = new Set(
      population.entries.map((entry) => partOf(entry, 'family')?.toLowerCase()),
    );

    expect(persons).toHaveLength(1500);
    expect(businesses).toHaveLength(300);
    for (const customer of persons) {
      expect(customer.query['name-first']).toBeTruthy();
      expect(customer.query['name-last']).toBeTruthy();
      expect(customer.query.birthdate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(customer.query.term).toBeUndefined();
    }
    for (const customer of businesses) {
      expect(customer.query.term).toBeTruthy();
      expect(customer.query.birthdate).toBeUndefined();
    }
    expect(Math.max(...families.values()) / 1500).toBeGreaterThan(0.03);
    const shared = persons.filter((customer) =>
      listedFamilies.has(customer.query['name-last']?.toLowerCase()),
    );
    expect(shared.length / 1500).toBeGreaterThan(0.3);
    expect(persons.some((customer) => customer.query['address-country-code'] !== undefined)).toBe(
      true,
    );
    expect(persons.some((customer) => customer.query['name-middle'] !== undefined)).toBe(true);
  });
});

describe('nameKey', () => {
  it('folds case, marks, order and punctuation, and nothing else', () => {
    expect(nameKey('Müller-Anna  José')).toBe(nameKey('jose ANNA muller'));
    expect(nameKey('Anna Müller')).toBe('anna muller');
    expect(nameKey('Anna Müller')).not.toBe(nameKey('Anna Muller Jose'));
    expect(nameKey('Anna Müller')).not.toBe(nameKey('Ana Müller'));
  });
});

describe('indistinguishableCustomers', () => {
  const person = (id: string, full: string, dates: string[]): WatchlistRecord => ({
    entry_id: id,
    kind: 'individual',
    names: [{ full, parts: [], script: 'latin', quality: 'strong', primary: true }],
    birth_dates: dates.map((value) => ({ value, precision: 'day' as const })),
    birth_places: [],
    countries: [],
    identifiers: [],
    addresses: [],
    crypto_addresses: [],
    programs: [],
    positions: [],
    relations: [],
  });
  const company = (id: string, full: string, country: string | null): WatchlistRecord => ({
    ...person(id, full, []),
    kind: 'entity',
    countries: country === null ? [] : [{ code: country, role: 'registration' }],
  });
  const customer = (
    id: string,
    subject: ScaleCustomer['subject'],
    query: Record<string, string>,
  ): ScaleCustomer => ({ id, subject, query });

  it('finds persons equal in name and birth date, and companies equal in name and stated country', () => {
    const entries = [
      person('E1', 'Anna Maria Kessler', ['1970-01-02', '1971-05-06']),
      person('E2', 'Anna Kessler', []),
      company('E3', 'Velmor Holdings Ltd', 'GB'),
      company('E4', 'Brakin Trading GmbH', null),
    ];
    const customers = [
      customer('K1', 'person', {
        'name-first': 'kessler',
        'name-middle': 'Maria',
        'name-last': 'ANNA',
        birthdate: '1971-05-06',
      }),
      customer('K2', 'person', {
        'name-first': 'Anna',
        'name-middle': 'Maria',
        'name-last': 'Kessler',
        birthdate: '1980-01-01',
      }),
      customer('K3', 'person', {
        'name-first': 'Anna',
        'name-last': 'Kessler',
        birthdate: '1970-01-02',
      }),
      customer('K4', 'business', { term: 'velmor holdings ltd' }),
      customer('K5', 'business', { term: 'Velmor Holdings Ltd', 'address-country-code': 'FR' }),
      customer('K6', 'business', { term: 'Velmor Holdings Ltd', 'address-country-code': 'GB' }),
      customer('K7', 'business', { term: 'Brakin Trading GmbH', 'address-country-code': 'DE' }),
      customer('K8', 'business', { term: 'Anna Kessler' }),
    ];

    expect(indistinguishableCustomers(customers, entries)).toEqual(
      new Map([
        ['K1', 'E1'],
        ['K4', 'E3'],
        ['K6', 'E3'],
      ]),
    );
  });
});
