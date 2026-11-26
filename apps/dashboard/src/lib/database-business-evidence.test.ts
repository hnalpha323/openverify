/**
 * C61, C66: what the business registry evidence reads from a verification answer: the register
 * and its authority, how the status was read, each match field, the groups, the persons' counts
 * and the country and service checks.
 */
import { DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { BUSINESS_MATCH_FIELDS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  businessChecks,
  businessVerification,
  type BusinessScenario,
} from '../testing/fixtures/database-business';
import { phase5Verification } from '../testing/phase5-fixtures';
import {
  BUSINESS_VALUE_MEMBERS,
  databaseBusinessEvidenceOf,
  type DatabaseBusinessVerification,
} from './database-business-evidence';

const evidenceOf = (scenario: BusinessScenario) =>
  databaseBusinessEvidenceOf(businessVerification({ scenario }) as DatabaseBusinessVerification);

describe('the attributes of each business match field (C52.3, C52.8)', () => {
  it('names the entered business, number and address under the field each is compared as', () => {
    expect(Object.keys(BUSINESS_VALUE_MEMBERS)).toEqual([...BUSINESS_MATCH_FIELDS]);
    expect(BUSINESS_VALUE_MEMBERS).toEqual({
      name: ['business-name'],
      'registration-number': ['registration-number'],
      address: [
        'address-street-1',
        'address-street-2',
        'address-city',
        'address-subdivision',
        'address-postal-code',
        'address-country-code',
      ],
    });
    for (const member of Object.values(BUSINESS_VALUE_MEMBERS).flat()) {
      expect(Object.keys(DATABASE_BUSINESS_VERIFICATION_ATTRIBUTES)).toContain(member);
    }
  });
});

describe('databaseBusinessEvidenceOf (C61)', () => {
  it('reads the register, its authority, the identity and the status read as active', () => {
    expect(evidenceOf('match')).toMatchObject({
      ran: true,
      provider: { id: 'sandbox', sandbox: true },
      authoritative: true,
      identity: { name: 'database_business_identity_comparison', status: 'passed' },
      active: { status: 'passed', required: true },
      reading: 'active',
      flags: [],
      country: { status: 'not_applicable', reasons: ['no_allowlist'] },
      service: { status: 'passed' },
    });
  });

  it('reads each match field and both groups', () => {
    const { fields, groups } = evidenceOf('match');

    expect(fields.map((field) => [field.field, field.match?.level])).toEqual([
      ['name', 'full'],
      ['registration-number', 'full'],
      ['address', 'full'],
    ]);
    expect(fields[2]?.match?.components).toHaveLength(7);
    expect(groups).toEqual([
      {
        fields: [
          ['name', 'partial'],
          ['registration-number', 'full'],
        ],
        outcome: 'met',
      },
      {
        fields: [
          ['name', 'partial'],
          ['address', 'partial'],
        ],
        outcome: 'met',
      },
    ]);
  });

  it.each([
    ['dissolved', 'inactive', []],
    ['lapsed-lei', 'not-available', ['lei-lapsed']],
    ['number-not-found', 'no-record', []],
  ] as const)('reads a %s register status as %s', (scenario, reading, flags) => {
    expect(evidenceOf(scenario)).toMatchObject({ reading, flags });
  });

  it('reads a GLEIF record as not authoritative and no sandbox', () => {
    expect(evidenceOf('lapsed-lei')).toMatchObject({
      provider: { id: 'gleif', sandbox: false },
      authoritative: false,
    });
  });

  it('reads no comparison and the template’s groups for a number the register lacks', () => {
    const evidence = evidenceOf('number-not-found');

    expect(evidence.identity?.reasons).toEqual(['registration_number_not_found']);
    expect(evidence.fields.every((field) => field.match === null)).toBe(true);
    expect(evidence.groups.map((group) => group.outcome)).toEqual([null, null]);
  });

  it('reads the persons’ counts, and none when the step did not collect persons', () => {
    expect(evidenceOf('person-not-listed').persons).toEqual({
      outcome: {
        name: 'database_business_associated_persons_comparison',
        status: 'failed',
        required: false,
        reasons: ['associated_person_not_on_register'],
      },
      persons: 1,
      matched: 0,
      unmatched: 1,
      undecided: 0,
    });
    expect(evidenceOf('match').persons).toMatchObject({
      outcome: { reasons: ['not_requested'] },
      persons: null,
      matched: null,
    });
  });

  it('reads the service check’s coverage flag', () => {
    const checks = businessChecks().map((check) =>
      check.name === 'database_business_service_available_detection'
        ? {
            ...check,
            status: 'not_applicable' as const,
            reasons: ['provider_not_configured'],
            metadata: { flags: ['country-not-covered'] },
          }
        : check,
    );
    const evidence = databaseBusinessEvidenceOf(
      businessVerification({ checks }) as DatabaseBusinessVerification,
    );

    expect(evidence.flags).toEqual(['country-not-covered']);
    expect(evidence.service?.reasons).toEqual(['provider_not_configured']);
  });

  it('reads nothing before the checks ran', () => {
    expect(
      databaseBusinessEvidenceOf(
        businessVerification({ checks: [], status: 'initiated' }) as DatabaseBusinessVerification,
      ),
    ).toMatchObject({
      ran: false,
      provider: null,
      authoritative: null,
      identity: null,
      reading: null,
      groups: [],
      persons: { outcome: null, persons: null },
    });
  });

  it('reads the golden fixture, which the evaluators wrote', () => {
    const evidence = databaseBusinessEvidenceOf(
      phase5Verification('verification/database-business') as DatabaseBusinessVerification,
    );

    expect(evidence).toMatchObject({ authoritative: true, reading: 'active' });
    expect(evidence.groups.map((group) => group.outcome)).toEqual(['met', 'met']);
  });
});
