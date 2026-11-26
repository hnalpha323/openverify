import { describe, expect, it } from 'vitest';
import { databaseContext } from './context.js';
import { databaseIdentityComparison } from './database-identity-comparison.js';
import type { DatabaseCheckInput } from './inputs.js';
import {
  ENTERED,
  ENTERED_TEXT,
  SANDBOX_PROVIDER,
  UNSUPPORTED_COUNTRY,
  databaseInput,
  echoedRecord,
  found,
  notFound,
  templateOf,
} from './testing.js';

const ID = 'database_identity_comparison';
const run = (input: DatabaseCheckInput, config?: Record<string, unknown>) =>
  databaseIdentityComparison(
    databaseContext(input, templateOf({ [ID]: config === undefined ? {} : { config } })),
  );
const withRecord = (changes: Parameters<typeof echoedRecord>[1]) =>
  databaseInput({ providers: { database: found(echoedRecord(ENTERED, changes)) } });

describe('database_identity_comparison (C58.1, C59.3)', () => {
  it('passes when the default group (name, birthdate, address at partial) is met', () => {
    const result = run(databaseInput());

    expect(result).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        authoritative: false,
        groups: [
          {
            fields: { name: 'partial', birthdate: 'partial', address: 'partial' },
            outcome: 'met',
          },
        ],
      },
      provenance: {
        provider: SANDBOX_PROVIDER,
        thresholds: {
          'match-groups': [{ name: 'partial', birthdate: 'partial', address: 'partial' }],
          'accept-precision-limited-birthdate': true,
          'accept-transposed-birthdate': false,
        },
        'threshold-basis': {
          'match-groups': 'provisional',
          'accept-precision-limited-birthdate': 'provisional',
          'accept-transposed-birthdate': 'provisional',
        },
      },
    });
    expect((result.metadata.fields as Record<string, { level: string }>).name?.level).toBe('full');
  });

  it('passes on a nickname at partial (sandbox-database-nickname)', () => {
    const result = run(
      databaseInput({
        values: { ...ENTERED, 'name-first': 'Bob' },
        providers: { database: found(echoedRecord(ENTERED, { 'name-first': 'Robert' })) },
      }),
    );

    expect(result.status).toBe('passed');
    expect(result.metadata.fields).toMatchObject({
      name: { level: 'partial', methods: ['nickname'] },
    });
  });

  it('fails low_confidence_match when every group is unmet', () => {
    expect(run(withRecord({ 'name-last': 'Ostrander' }))).toMatchObject({
      status: 'failed',
      reasons: ['low_confidence_match'],
      metadata: { groups: [{ outcome: 'unmet' }] },
    });
  });

  it('goes to review (insufficient_data) for a record without a birthdate, never failing it', () => {
    expect(run(withRecord({ birthdate: undefined }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['insufficient_data'],
      metadata: { groups: [{ outcome: 'undecidable' }] },
    });
  });

  it('a precision-limited birthdate passes by default, and is undecidable when not accepted', () => {
    const partial = withRecord({ birthdate: '1987-04' });

    expect(run(partial).status).toBe('passed');
    const refused = run(partial, { 'accept-precision-limited-birthdate': false });
    expect(refused).toMatchObject({ status: 'not_applicable', reasons: ['insufficient_data'] });
    expect(refused.provenance['threshold-basis']).not.toHaveProperty(
      'accept-precision-limited-birthdate',
    );
  });

  it('a transposed birthdate is undecidable by default, and passes when accepted', () => {
    const transposed = withRecord({ birthdate: '1987-12-04' });

    expect(run(transposed).reasons).toEqual(['insufficient_data']);
    expect(run(transposed, { 'accept-transposed-birthdate': true }).status).toBe('passed');
  });

  it('a step that collects name and phone only: the default group is undecidable, a name and phone group decides', () => {
    const input = databaseInput({
      values: { ...ENTERED, 'phone-number': '+15550100100' },
      collectedFields: ['name_first', 'name_last', 'address_country_code', 'phone_number'],
      providers: {
        database: found({
          'name-first': 'Ada',
          'name-last': 'Vellacott',
          'phone-number': '+15550100100',
        }),
      },
    });

    expect(run(input)).toMatchObject({
      status: 'not_applicable',
      reasons: ['insufficient_data'],
      metadata: { 'not-requested-fields': ['birthdate', 'address'] },
    });
    expect(
      run(input, { 'match-groups': [{ name: 'partial', 'phone-number': 'full' }] }).status,
    ).toBe('passed');
  });

  it('decides on the identification number the source matched', () => {
    const config = { 'match-groups': [{ name: 'partial', 'identification-number': 'full' }] };
    const values = { ...ENTERED, 'identification-number': 'X1234567' };
    const collectedFields = [...databaseInput().collectedFields, 'identification_number' as const];

    expect(
      run(
        databaseInput({
          values,
          collectedFields,
          providers: { database: found(echoedRecord(values)) },
        }),
        config,
      ).status,
    ).toBe('passed');
    expect(
      run(
        databaseInput({
          values,
          collectedFields,
          providers: {
            database: found(echoedRecord(values, { 'identification-number-match': false })),
          },
        }),
        config,
      ).reasons,
    ).toEqual(['low_confidence_match']);
  });

  it('passes when one of several groups is met', () => {
    const result = run(withRecord({ birthdate: '1990-01-01' }), {
      'match-groups': [
        { name: 'partial', birthdate: 'partial' },
        { name: 'partial', address: 'full' },
      ],
    });

    expect(result.status).toBe('passed');
    expect((result.metadata.groups as { outcome: string }[]).map((group) => group.outcome)).toEqual(
      ['unmet', 'met'],
    );
  });

  it('a miss is record_not_found from an authoritative source, else no_matching_record', () => {
    expect(run(databaseInput({ providers: { database: notFound(true) } }))).toMatchObject({
      status: 'failed',
      reasons: ['record_not_found'],
      metadata: { authoritative: true },
    });
    expect(run(databaseInput({ providers: { database: notFound(false) } }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_matching_record'],
    });
    expect(run(databaseInput({ providers: { database: UNSUPPORTED_COUNTRY } }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['unsupported_country'],
    });
  });

  it('never passes without a provider result or without entered values', () => {
    expect(run(databaseInput({ providers: {} })).reasons).toEqual(['provider_not_configured']);
    expect(
      run(databaseInput({ providers: { database: { kind: 'not_configured' } } })).reasons,
    ).toEqual(['provider_not_configured']);
    expect(run(databaseInput({ providers: { database: { kind: 'error' } } })).reasons).toEqual([
      'execution_error',
    ]);
    expect(run(databaseInput({ values: null }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('records levels, methods, flags and field names only, never a value', () => {
    const serialized = JSON.stringify(run(withRecord({ 'name-first': 'Adah' })));

    for (const value of ENTERED_TEXT) {
      expect(serialized).not.toContain(value);
    }
  });
});
