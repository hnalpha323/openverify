/**
 * C78.4, C78.5, C79.1, C79.2: screening subjects against synthetic entries. Every name, birth date
 * and identifier is fictional (the sandbox LEI and IMO number of C82.4).
 */
import { describe, expect, it } from 'vitest';
import { variantGroupsFrom } from '../keys/index.js';
import { resolveNameMatching } from '../score/index.js';
import {
  HOLDINGS,
  OFFICE_HOLDER,
  ORLAN,
  TALIA,
  VESSEL,
  candidates,
} from './fixtures.test-support.js';
import {
  businessSubject,
  personSubject,
  screenCandidates,
  type PersonQuery,
  type ScreeningOptions,
} from './index.js';

const groups = variantGroupsFrom([], 'a'.repeat(64));
const options = (overrides: Partial<ScreeningOptions> = {}): ScreeningOptions => ({
  nameMatching: resolveNameMatching({ preset: 'strict' }),
  birthdateMatching: 'year_plus_minus_one',
  birthdateFilter: 'penalty',
  countryFields: ['birthplace', 'citizenship', 'nationality', 'residency'],
  countryFilter: 'penalty',
  screenWeakAliases: false,
  groups,
  ...overrides,
});
const tolerant = { nameMatching: resolveNameMatching({ preset: 'tolerant' }) };
const person = (query: PersonQuery) => personSubject(query);
const ORLAN_QUERY = { 'name-first': 'Orlan', 'name-last': 'Vexby' } as const;

describe('persons', () => {
  it('matches an equal name with its birth date, and never compares a person with an entity', () => {
    const matches = screenCandidates(
      person({ ...ORLAN_QUERY, birthdate: '1971-03-09' }),
      candidates(ORLAN, TALIA, HOLDINGS),
      options(),
    );
    expect(matches).toEqual([
      {
        sourceId: 'test-src',
        entryId: 'A-1',
        entryKey: 'test-src:A-1',
        score: 1,
        aboveMinimum: true,
        matchTypes: ['name_exact', 'birthdate_exact'],
        qualifiers: ['dob_exact'],
        aliasType: 'primary_name',
        subjectName: 'Orlan Vexby',
        listName: 'VEXBY, Orlan',
        nameScore: 1,
        nameLevel: 'full',
        methods: ['equal'],
        lossy: false,
      },
    ]);
  });

  it('takes the best list name and calls a fuzzy match name_fuzzy', () => {
    const [match] = screenCandidates(
      person({ term: 'Orlan Vexbi' }),
      candidates(ORLAN),
      options(tolerant),
    );
    expect(match).toMatchObject({
      aliasType: 'aka',
      listName: 'Orlan Vexbie',
      matchTypes: ['name_fuzzy'],
      nameLevel: 'partial',
      methods: ['equal', 'typo'],
      aboveMinimum: true,
    });
    expect(screenCandidates(person({ term: 'Orlan Vexbi' }), candidates(ORLAN), options())).toEqual(
      [],
    );
  });

  it('returns a candidate between 0.70 and the minimum without creating a match', () => {
    const [match] = screenCandidates(
      person({ ...ORLAN_QUERY, 'address-country-code': 'FR', gender: 'female' }),
      candidates(ORLAN),
      options(),
    );
    expect(match?.score).toBeCloseTo(0.8, 10);
    expect(match).toMatchObject({
      aboveMinimum: false,
      qualifiers: ['country_mismatch', 'gender_mismatch'],
      matchTypes: ['name_exact'],
    });
  });

  it('screens every name of the subject, additional names included', () => {
    const [match] = screenCandidates(
      person({ term: 'Someone Else', 'additional-names': [{ term: 'Vexby Orlan' }] }),
      candidates(ORLAN),
      options(),
    );
    expect(match).toMatchObject({ subjectName: 'Vexby Orlan', score: 1 });
  });

  it('counts a PEP position country among the entry countries', () => {
    const [match] = screenCandidates(
      person({ term: 'Maren Quillon', 'country-code': 'FR' }),
      candidates(OFFICE_HOLDER),
      options(),
    );
    expect(match?.qualifiers).toEqual([]);
  });

  it('under exact, matches equal names in any order and nothing else', () => {
    const exact = { nameMatching: resolveNameMatching({ preset: 'exact' }) };
    expect(
      screenCandidates(person({ term: 'Vexby Orlan' }), candidates(ORLAN), options(exact))[0],
    ).toMatchObject({ score: 1, aboveMinimum: true, matchTypes: ['name_exact'] });
    expect(
      screenCandidates(person({ term: 'Orlan Vexbi' }), candidates(ORLAN), options(exact)),
    ).toEqual([]);
  });
});

describe('the identifier rule (H06)', () => {
  const passport = {
    'identification-number': 'X 123 45',
    'identification-type': 'passport',
  } as const;

  it('matches an exact identifier whatever the name says, at 0.95, without qualifiers below 0.70', () => {
    const [match] = screenCandidates(
      person({ term: 'Someone Different', birthdate: '1999-01-01', ...passport }),
      candidates(ORLAN),
      options(),
    );
    expect(match).toMatchObject({
      score: 0.95,
      aboveMinimum: true,
      matchTypes: ['identifier_exact'],
      qualifiers: [],
      nameLevel: null,
      subjectName: 'Someone Different',
      listName: 'VEXBY, Orlan',
      aliasType: 'primary_name',
    });
    expect(match?.methods).toContain('identifier-exact');
  });

  it('needs the same country only when both sides state one', () => {
    expect(
      screenCandidates(
        person({ term: 'Someone Different', ...passport, 'identification-country-code': 'FR' }),
        candidates(ORLAN),
        options(),
      ),
    ).toEqual([]);
    expect(
      screenCandidates(
        person({ term: 'Someone Different', ...passport, 'identification-country-code': 'GB' }),
        candidates(ORLAN),
        options(),
      ),
    ).toHaveLength(1);
  });

  it('keeps an identifier match a strict filter would drop', () => {
    const strict = options({ birthdateFilter: 'strict' });
    expect(
      screenCandidates(
        person({ ...ORLAN_QUERY, birthdate: '1990-01-01' }),
        candidates(ORLAN),
        strict,
      ),
    ).toEqual([]);
    expect(
      screenCandidates(
        person({ ...ORLAN_QUERY, birthdate: '1990-01-01', ...passport }),
        candidates(ORLAN),
        strict,
      )[0]?.matchTypes,
    ).toEqual(['name_exact', 'identifier_exact']);
  });
});

describe('the corroborated weak-alias rule (H10)', () => {
  const weak = options({ screenWeakAliases: true });

  it('is off unless the template turns it on, and needs dob_exact or an identifier', () => {
    expect(screenCandidates(person({ term: 'Orly Vex' }), candidates(ORLAN), options())).toEqual(
      [],
    );
    expect(screenCandidates(person({ term: 'Orly Vex' }), candidates(ORLAN), weak)).toEqual([]);
    const [match] = screenCandidates(
      person({ term: 'Orly Vex', birthdate: '1971-03-09' }),
      candidates(ORLAN),
      weak,
    );
    expect(match).toMatchObject({
      score: 0.9,
      aboveMinimum: true,
      aliasType: 'weak_aka',
      listName: 'Orly Vex',
      matchTypes: ['birthdate_exact', 'weak_alias'],
    });
  });

  it('never fuzzy-matches a weak alias', () => {
    expect(
      screenCandidates(person({ term: 'Orly Vexx', birthdate: '1971-03-09' }), candidates(ORLAN), {
        ...weak,
        ...tolerant,
      }),
    ).toEqual([]);
  });
});

describe('businesses (C79.2)', () => {
  it('matches a business name through its legal form and generic words, and by LEI', () => {
    const [byName] = screenCandidates(
      businessSubject({ term: 'Sandbox Sanctioned Holdings Limited' }),
      candidates(HOLDINGS, ORLAN),
      options({ countryFields: ['registration', 'address'] }),
    );
    expect(byName).toMatchObject({ entryId: 'C-3', score: 1, matchTypes: ['name_exact'] });
    const [byLei] = screenCandidates(
      businessSubject({ term: 'Unrelated Trading', lei: '5299000SANDBOXLEI047' }),
      candidates(HOLDINGS),
      options({ countryFields: ['registration', 'address'] }),
    );
    expect(byLei).toMatchObject({ score: 0.95, matchTypes: ['identifier_exact'] });
  });

  it('searches vessels by name only within entity-kinds, and by IMO number whatever it says', () => {
    const business = options({ countryFields: ['registration', 'address'] });
    expect(
      screenCandidates(businessSubject({ term: 'Marlin Dawn' }), candidates(VESSEL), business),
    ).toEqual([]);
    expect(
      screenCandidates(
        businessSubject({ term: 'Marlin Dawn', 'imo-number': '9999993' }),
        candidates(VESSEL),
        business,
      )[0],
    ).toMatchObject({ score: 0.95, matchTypes: ['identifier_exact'] });
    expect(
      screenCandidates(businessSubject({ term: 'Marlin Dawn' }), candidates(VESSEL), {
        ...business,
        entityKinds: ['entity', 'vessel'],
      })[0],
    ).toMatchObject({ score: 1, matchTypes: ['name_exact'] });
  });

  it('sorts matches by score, then entry key', () => {
    const matches = screenCandidates(
      businessSubject({ term: 'Sandbox Holdings', lei: '5299000SANDBOXLEI047' }),
      candidates(HOLDINGS, { ...HOLDINGS, entry_id: 'C-0' }),
      options({ countryFields: ['registration', 'address'] }),
    );
    expect(matches.map((match) => match.entryKey)).toEqual(['test-src:C-0', 'test-src:C-3']);
  });
});
