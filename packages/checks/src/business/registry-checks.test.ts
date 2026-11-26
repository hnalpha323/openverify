/**
 * C61.7: the business registry checks on the registers' answers: identity through three-valued
 * match groups, the active status table, associated persons by name and birth month, the enabled
 * country and the service's availability. No check passes without a register's answer.
 */
import type { CheckId, CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { evaluateDatabaseBusinessChecks } from './evaluate.js';
import type { DatabaseBusinessCheckInput } from './inputs.js';
import {
  ENTERED,
  PROVIDERS,
  businessInput,
  enteredWithout,
  failed,
  found,
  notFound,
  registryRecord,
  templateOf,
  unsupported,
} from './testing.js';

function resultOf(
  checkId: CheckId,
  input: DatabaseBusinessCheckInput,
  config?: Record<string, unknown>,
  options: { readonly 'allowed-countries'?: string[] } = {},
): CheckResult {
  const results = evaluateDatabaseBusinessChecks(
    input,
    templateOf([checkId], config === undefined ? {} : { [checkId]: config }, options),
  );
  const [result] = results;
  if (result === undefined || results.length !== 1) {
    throw new Error('expected one result');
  }
  return result;
}

describe('database_business_identity_comparison', () => {
  const ID = 'database_business_identity_comparison';

  it('passes the name with the registration number (the first default group)', () => {
    const result = resultOf(ID, businessInput());
    expect(result.status).toBe('passed');
    expect(result.provenance.provider).toEqual(PROVIDERS.gleif);
    expect(result.metadata).toEqual(
      expect.objectContaining({ source: 'gleif', authoritative: false }),
    );
    expect(result.metadata.fields).toEqual(
      expect.objectContaining({
        name: expect.objectContaining({ level: 'full' }) as unknown,
        'registration-number': expect.objectContaining({ level: 'full' }) as unknown,
      }),
    );
    expect(result.provenance.thresholds['match-groups']).toEqual([
      { name: 'partial', 'registration-number': 'full' },
      { name: 'partial', address: 'partial' },
    ]);
    expect(result.provenance['threshold-basis']).toEqual({ 'match-groups': 'provisional' });
  });

  it('takes the best level over the legal name and every other name', () => {
    const trading = { ...ENTERED, 'business-name': 'Utopia Orchards' };
    const fullName = { 'match-groups': [{ name: 'full' }] };
    expect(resultOf(ID, businessInput(undefined, { values: trading }), fullName).status).toBe(
      'passed',
    );
    const legalOnly = [found(registryRecord({ otherNames: [] }))];
    expect(resultOf(ID, businessInput(legalOnly, { values: trading }), fullName).reasons).toEqual([
      'low_confidence_match',
    ]);
  });

  it('passes the name with the address when no number was entered', () => {
    const withoutNumber = enteredWithout('registration-number');
    expect(resultOf(ID, businessInput(undefined, { values: withoutNumber })).status).toBe('passed');
  });

  it('reviews a different number when no address decides (insufficient_data)', () => {
    const record = registryRecord({ registrationNumber: '00000099', registeredAddress: null });
    const result = resultOf(ID, businessInput([found(record)]));
    expect(result.status).toBe('not_applicable');
    expect(result.reasons).toEqual(['insufficient_data']);
  });

  it('fails only when every group is unmet (low_confidence_match)', () => {
    const record = registryRecord({
      registrationNumber: '00000099',
      registeredAddress: {
        lines: ['90 Quillon Street'],
        city: 'Lanternfield',
        region: 'US-UT',
        postalCode: '00099',
        country: 'US',
      },
    });
    expect(resultOf(ID, businessInput([found(record)])).reasons).toEqual(['low_confidence_match']);
    const otherName = registryRecord({ legalName: 'Meridale Glassworks Inc', otherNames: [] });
    expect(resultOf(ID, businessInput([found(otherName)])).reasons).toEqual([
      'low_confidence_match',
    ]);
  });

  it('answers registration_number_not_found when an authoritative register lacks the number', () => {
    const result = resultOf(
      ID,
      businessInput([notFound('companies-house', true), notFound('gleif', false)]),
    );
    expect(result.status).toBe('not_applicable');
    expect(result.reasons).toEqual(['registration_number_not_found']);
    expect(result.provenance.provider).toEqual(PROVIDERS['companies-house']);
  });

  it('answers no_registry_record for any other miss', () => {
    const withoutNumber = enteredWithout('registration-number');
    expect(
      resultOf(ID, businessInput([notFound('companies-house', true)], { values: withoutNumber }))
        .reasons,
    ).toEqual(['no_registry_record']);
    expect(resultOf(ID, businessInput([notFound('gleif', false)])).reasons).toEqual([
      'no_registry_record',
    ]);
    expect(resultOf(ID, businessInput([unsupported('gleif')])).reasons).toEqual([
      'no_registry_record',
    ]);
  });

  it('takes the record a later register found after an earlier one missed or failed', () => {
    expect(resultOf(ID, businessInput([notFound('companies-house', true), found()])).status).toBe(
      'passed',
    );
    expect(resultOf(ID, businessInput([failed('companies-house'), found()])).status).toBe('passed');
  });

  it('never passes without a register: unbound, failed, or no values', () => {
    expect(resultOf(ID, businessInput([])).reasons).toEqual(['provider_not_configured']);
    expect(resultOf(ID, businessInput(undefined, { registry: undefined })).reasons).toEqual([
      'provider_not_configured',
    ]);
    expect(resultOf(ID, businessInput([failed('gleif')])).reasons).toEqual(['execution_error']);
    expect(
      resultOf(ID, businessInput([notFound('gleif', false), failed('companies-house')])).reasons,
    ).toEqual(['execution_error']);
    expect(resultOf(ID, businessInput(undefined, { values: null })).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('database_business_active_business_detection', () => {
  const ID = 'database_business_active_business_detection';
  const withStatus = (
    status: string | null,
    statusDetail: string | null = 'ACTIVE',
    source: 'gleif' | 'companies-house' | 'sec-edgar' = 'gleif',
  ) => businessInput([found(registryRecord({ source, status, statusDetail }))]);

  it('passes an active record and records its status value', () => {
    const result = resultOf(ID, withStatus('ISSUED'));
    expect(result.status).toBe('passed');
    expect(result.metadata).toEqual({ source: 'gleif', status: 'ISSUED', flags: [] });
    expect(result.provenance.thresholds).toEqual({ 'fail-on-lapsed-lei': false });
  });

  it('reviews a lapsed LEI unless configured to fail it', () => {
    const lapsed = resultOf(ID, withStatus('LAPSED'));
    expect(lapsed.status).toBe('not_applicable');
    expect(lapsed.reasons).toEqual(['status_not_available']);
    expect(lapsed.metadata.flags).toEqual(['lei-lapsed']);
    expect(resultOf(ID, withStatus('LAPSED'), { 'fail-on-lapsed-lei': true }).reasons).toEqual([
      'business_inactive',
    ]);
  });

  it('fails a retired LEI or a dissolved company (business_inactive)', () => {
    expect(resultOf(ID, withStatus('RETIRED')).reasons).toEqual(['business_inactive']);
    expect(resultOf(ID, withStatus('dissolved', null, 'companies-house')).reasons).toEqual([
      'business_inactive',
    ]);
  });

  it('answers no_registry_record for an annulled LEI, status_not_available for EDGAR', () => {
    expect(resultOf(ID, withStatus('ANNULLED')).reasons).toEqual(['no_registry_record']);
    expect(resultOf(ID, withStatus(null, null, 'sec-edgar')).reasons).toEqual([
      'status_not_available',
    ]);
  });

  it('answers no_registry_record without a record, and never passes without a register', () => {
    expect(resultOf(ID, businessInput([notFound('gleif', false)])).reasons).toEqual([
      'no_registry_record',
    ]);
    expect(resultOf(ID, businessInput([])).reasons).toEqual(['provider_not_configured']);
    expect(resultOf(ID, businessInput([failed('gleif')])).reasons).toEqual(['execution_error']);
    expect(resultOf(ID, businessInput(undefined, { values: null })).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('database_business_associated_persons_comparison', () => {
  const ID = 'database_business_associated_persons_comparison';
  const persons = (
    ...entered: { 'name-first': string; 'name-last': string; birthdate?: string }[]
  ) =>
    businessInput([found(registryRecord(), { personsAvailable: true })], {
      collectAssociatedPersons: true,
      values: { ...ENTERED, 'associated-persons': entered },
    });

  it('answers not_requested when the step does not collect persons', () => {
    const result = resultOf(ID, businessInput());
    expect(result.status).toBe('not_applicable');
    expect(result.reasons).toEqual(['not_requested']);
  });

  it('passes persons who match active officers or PSCs by name and birth month', () => {
    const result = resultOf(
      ID,
      persons(
        { 'name-first': 'Quinn', 'name-last': 'Valemont', birthdate: '1987-04-12' },
        { 'name-first': 'Ada', 'name-last': 'Vellacott', birthdate: '1990-11' },
      ),
    );
    expect(result.status).toBe('passed');
    expect(result.metadata).toEqual(
      expect.objectContaining({ persons: 2, matched: 2, unmatched: 0, undecided: 0 }),
    );
    expect(result.provenance['threshold-basis']).toEqual({ 'min-match-level': 'provisional' });
  });

  it('fails a person the register does not hold, one who resigned, or another birth month', () => {
    const notOn = { 'name-first': 'Lior', 'name-last': 'Brennagh', birthdate: '1980-01' };
    expect(resultOf(ID, persons(notOn)).reasons).toEqual(['associated_person_not_on_register']);
    const resigned = { 'name-first': 'Ira', 'name-last': 'Holloway', birthdate: '1975-02' };
    expect(resultOf(ID, persons(resigned)).reasons).toEqual(['associated_person_not_on_register']);
    const otherMonth = { 'name-first': 'Quinn', 'name-last': 'Valemont', birthdate: '1987-05' };
    expect(resultOf(ID, persons(otherMonth)).reasons).toEqual([
      'associated_person_not_on_register',
    ]);
  });

  it('reviews a name match whose birth month cannot be compared', () => {
    const result = resultOf(ID, persons({ 'name-first': 'Quinn', 'name-last': 'Valemont' }));
    expect(result.status).toBe('not_applicable');
    expect(result.reasons).toEqual(['input_missing']);
    expect(result.metadata).toEqual(expect.objectContaining({ undecided: 1 }));
  });

  it('honours min-match-level', () => {
    const record = registryRecord({
      persons: [{ name: 'VALEMONT, Q', birthMonth: '1987-04', role: 'officer', active: true }],
    });
    const input = businessInput([found(record)], {
      collectAssociatedPersons: true,
      values: {
        ...ENTERED,
        'associated-persons': [
          { 'name-first': 'Quinn', 'name-last': 'Valemont', birthdate: '1987-04' },
        ],
      },
    });
    expect(resultOf(ID, input).status).toBe('passed');
    expect(resultOf(ID, input, { 'min-match-level': 'full' }).reasons).toEqual([
      'associated_person_not_on_register',
    ]);
  });

  it('answers source_has_no_persons when the source publishes none', () => {
    const input = businessInput(
      [found(registryRecord({ persons: undefined }), { personsAvailable: false })],
      {
        collectAssociatedPersons: true,
        values: {
          ...ENTERED,
          'associated-persons': [{ 'name-first': 'Quinn', 'name-last': 'Valemont' }],
        },
      },
    );
    expect(resultOf(ID, input).reasons).toEqual(['source_has_no_persons']);
  });

  it('never passes without a record, a register, or a person to compare', () => {
    const collected = { collectAssociatedPersons: true };
    const someone = {
      ...ENTERED,
      'associated-persons': [
        { 'name-first': 'Quinn', 'name-last': 'Valemont', birthdate: '1987-04' },
      ],
    };
    expect(
      resultOf(ID, businessInput([notFound('gleif', false)], { ...collected, values: someone }))
        .reasons,
    ).toEqual(['no_registry_record']);
    expect(resultOf(ID, businessInput([], { ...collected, values: someone })).reasons).toEqual([
      'provider_not_configured',
    ]);
    expect(
      resultOf(ID, businessInput([failed('gleif')], { ...collected, values: someone })).reasons,
    ).toEqual(['execution_error']);
    expect(
      resultOf(
        ID,
        businessInput(undefined, {
          ...collected,
          values: { ...ENTERED, 'associated-persons': [] },
        }),
      ).reasons,
    ).toEqual(['input_missing']);
    expect(resultOf(ID, businessInput(undefined, { ...collected, values: null })).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('database_business_enabled_country_detection', () => {
  const ID = 'database_business_enabled_country_detection';

  it('answers no_allowlist (non-blocking) without allowed-countries', () => {
    expect(resultOf(ID, businessInput()).reasons).toEqual(['no_allowlist']);
  });

  it('passes an allowed country and fails another (country_not_enabled)', () => {
    const allowed = resultOf(ID, businessInput(), undefined, { 'allowed-countries': ['US', 'GB'] });
    expect(allowed.status).toBe('passed');
    expect(allowed.provenance.thresholds).toEqual({ 'allowed-countries': ['US', 'GB'] });
    expect(
      resultOf(ID, businessInput(), undefined, { 'allowed-countries': ['GB'] }).reasons,
    ).toEqual(['country_not_enabled']);
  });

  it('answers input_missing without a country', () => {
    const withoutCountry = enteredWithout('country-code');
    expect(resultOf(ID, businessInput(undefined, { values: withoutCountry })).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('database_business_service_available_detection', () => {
  const ID = 'database_business_service_available_detection';

  it('passes when a register covering the country answered, found or not', () => {
    expect(resultOf(ID, businessInput()).status).toBe('passed');
    const missed = resultOf(ID, businessInput([notFound('gleif', false)]));
    expect(missed.status).toBe('passed');
    expect(missed.provenance.provider).toEqual(PROVIDERS.gleif);
  });

  it('answers provider_not_configured when no register is bound or covers the country', () => {
    expect(resultOf(ID, businessInput([])).reasons).toEqual(['provider_not_configured']);
    expect(
      resultOf(ID, businessInput([unsupported('companies-house'), unsupported('gleif')])).reasons,
    ).toEqual(['provider_not_configured']);
  });

  it('answers execution_error when the only answers failed, input_missing without values', () => {
    expect(resultOf(ID, businessInput([failed('gleif')])).reasons).toEqual(['execution_error']);
    expect(
      resultOf(ID, businessInput([unsupported('companies-house'), failed('gleif')])).reasons,
    ).toEqual(['execution_error']);
    expect(resultOf(ID, businessInput(undefined, { values: null })).reasons).toEqual([
      'input_missing',
    ]);
  });
});
