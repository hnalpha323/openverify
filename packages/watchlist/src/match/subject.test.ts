/** C79.1, C79.2, C80.5, C84.2: subjects from the public query shapes, and the retrieval inputs. */
import { describe, expect, it } from 'vitest';
import { queryNameKeys, queryNameReach, variantGroupsFrom } from '../keys/index.js';
import { businessSubject, personSubject, retrievalQuery } from './index.js';

describe('personSubject', () => {
  it('reads every name, the birth date, the country, the gender and the identification', () => {
    const subject = personSubject({
      'name-first': 'Orlan',
      'name-last': 'Vexby',
      birthdate: '1971-03-09',
      'address-country-code': 'gb',
      gender: 'male',
      'identification-number': 'X 123 45',
      'identification-type': 'passport',
      'identification-country-code': 'GB',
      'additional-names': [{ term: 'Orlan Vexbi' }],
    });
    expect(subject.kind).toBe('person');
    expect(subject.names.map((name) => name.normalised)).toEqual(['orlan vexby', 'orlan vexbi']);
    expect(subject.names.map((name) => name.text)).toEqual(['Orlan Vexby', 'Orlan Vexbi']);
    expect(subject.birthdates).toEqual(['1971-03-09']);
    expect(subject.countries).toEqual(['GB']);
    expect(subject.gender).toBe('male');
    expect(subject.identifiers).toEqual([
      { kind: 'passport', value: 'X12345', country: 'GB', check: 'none' },
    ]);
  });

  it('screens name parts and a term both, once when they are equal', () => {
    expect(
      personSubject({ 'name-first': 'Orlan', 'name-last': 'Vexby', term: 'VEXBY Orlan' }).names,
    ).toHaveLength(1);
    expect(
      personSubject({ 'name-first': 'Orlan', 'name-last': 'Vexby', term: 'Orly Vex' }).names,
    ).toHaveLength(2);
  });

  it('reads country-code, else the default country, and nothing absent', () => {
    expect(personSubject({ term: 'Orlan Vexby', 'country-code': 'fr' }).countries).toEqual(['FR']);
    expect(personSubject({ term: 'Orlan Vexby' }, { defaultCountry: 'de' }).countries).toEqual([
      'DE',
    ]);
    const bare = personSubject({ term: 'Orlan Vexby' });
    expect(bare).toMatchObject({ birthdates: [], countries: [], gender: null, identifiers: [] });
  });
});

describe('businessSubject', () => {
  it('reads the term and every identifier, the registration number within the country', () => {
    const subject = businessSubject({
      term: 'Sandbox Sanctioned Holdings Ltd',
      'address-country-code': 'GB',
      'registration-number': '00 12 34',
      lei: '5299000SANDBOXLEI047',
      website: 'https://www.kestrel.example/about',
      'swift-bic': 'ABCDGB2LXXX',
      'imo-number': '9999993',
      mmsi: '123456789',
      'aircraft-serial': 'sn-001',
      'aircraft-tail': 'zz-tst',
    });
    expect(subject.kind).toBe('business');
    expect(subject.countries).toEqual(['GB']);
    expect(subject.identifiers.map(({ kind, value, country }) => [kind, value, country])).toEqual([
      ['registration_number', '001234', 'GB'],
      ['lei', '5299000SANDBOXLEI047', null],
      ['website', 'kestrel.example', null],
      ['swift_bic', 'ABCDGB2L', null],
      ['imo', '9999993', null],
      ['mmsi', '123456789', null],
      ['aircraft_serial', 'SN001', null],
      ['aircraft_tail', 'ZZTST', null],
    ]);
  });
});

describe('retrievalQuery', () => {
  it('gives the query keys, the identifiers and each normalised name', () => {
    const groups = variantGroupsFrom([], 'a'.repeat(64));
    const subject = personSubject({
      term: 'Orlan Vexby',
      'additional-names': [{ term: 'VEXBY, Orlan' }, { term: 'Orly Vex' }],
      'identification-number': 'X12345',
      'identification-type': 'passport',
    });
    expect(retrievalQuery(subject, groups)).toEqual({
      keys: queryNameKeys(subject.names, groups),
      identifiers: [{ kind: 'passport', value: 'X12345' }],
      normalisedNames: ['orlan vexby', 'orly vex'],
      // Owner decision 1 after 6B: the reach of every pair of each name's tokens.
      reach: queryNameReach(subject.names, groups),
    });
  });
});
