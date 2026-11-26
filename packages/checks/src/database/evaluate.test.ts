/**
 * The runners and the contract of the database and AAMVA evaluators (C51.2, C59): every enabled
 * check has an evaluator, results carry only the reasons the C51.2 table gives their check, no
 * A-tier or R+A result passes without a provider's answer, and the default template decides the
 * sandbox endings as the plan describes.
 */
import { checkResultSchema, decideVerification, type CheckId } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import { aamvaSkipsVerification, evaluateAamvaChecks, evaluateDatabaseChecks } from './evaluate.js';
import { AAMVA_EVALUATORS, DATABASE_EVALUATORS } from './evaluators.js';
import type { AamvaCheckInput, DatabaseCheckInput } from './inputs.js';
import { DATABASE_EVALUATOR_REASONS } from './reasons.js';
import {
  ENTERED,
  UNSUPPORTED_COUNTRY,
  aamvaAnswer,
  aamvaInput,
  databaseInput,
  echoedRecord,
  found,
  notFound,
  templateOf,
} from './testing.js';

const DATABASE_CHECKS: readonly CheckId[] = [
  'database_identity_comparison',
  'database_name_comparison',
  'database_address_comparison',
  'database_birthdate_comparison',
  'database_inquiry_comparison',
  'database_po_box_detection',
];
const AAMVA_CHECKS: readonly CheckId[] = [
  'aamva_identity_comparison',
  'aamva_name_comparison',
  'aamva_identification_number_comparison',
];

/** The C51.2 rows of `packages/contracts/src/database-check-reasons.ts`, with their shared reasons. */
const C51_2: Readonly<Record<string, readonly string[]>> = {
  database_identity_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'low_confidence_match',
    'record_not_found',
    'no_matching_record',
    'insufficient_data',
    'unsupported_country',
  ],
  database_name_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'name_mismatch',
    'not_requested',
    'no_reference_data',
    'no_matching_record',
  ],
  database_address_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'address_mismatch',
    'not_requested',
    'no_reference_data',
    'no_matching_record',
  ],
  database_birthdate_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'birthdate_mismatch',
    'not_requested',
    'no_reference_data',
    'no_matching_record',
    'birthdate_ambiguous',
  ],
  database_inquiry_comparison: [
    'input_missing',
    'inquiry_field_mismatch',
    'not_requested',
    'no_reference_data',
  ],
  database_po_box_detection: ['input_missing', 'po_box_detected', 'not_requested'],
  aamva_identity_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'record_mismatch',
    'record_not_found',
    'jurisdiction_not_participating',
  ],
  aamva_name_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'name_mismatch',
    'record_not_found',
    'jurisdiction_not_participating',
  ],
  aamva_identification_number_comparison: [
    'input_missing',
    'execution_error',
    'provider_not_configured',
    'identification_number_mismatch',
    'record_not_found',
    'jurisdiction_not_participating',
  ],
};

const every = (ids: readonly CheckId[]) =>
  templateOf(Object.fromEntries(ids.map((id) => [id, {}])));
const allDatabase = every(DATABASE_CHECKS);
const allAamva = every(AAMVA_CHECKS);

/** A broad set of database inputs: every outcome the source and the values can give. */
const DATABASE_CASES: readonly DatabaseCheckInput[] = [
  databaseInput(),
  databaseInput({ values: null }),
  databaseInput({ providers: {} }),
  databaseInput({ providers: { database: { kind: 'error' } } }),
  databaseInput({ providers: { database: notFound(true) } }),
  databaseInput({ providers: { database: notFound(false) } }),
  databaseInput({ providers: { database: UNSUPPORTED_COUNTRY } }),
  databaseInput({
    providers: { database: found(echoedRecord(ENTERED, { 'name-last': 'Ostrander' })) },
  }),
  databaseInput({
    providers: { database: found(echoedRecord(ENTERED, { birthdate: undefined })) },
  }),
  databaseInput({
    providers: { database: found(echoedRecord(ENTERED, { birthdate: '1987-12-04' })) },
  }),
  databaseInput({ providers: { database: found({}) } }),
  databaseInput({ collectedFields: ['email_address'] }),
  databaseInput({ values: { ...ENTERED, 'address-street-1': 'PO Box 77' } }),
  databaseInput({ inquiryFields: { name_first: 'Mira', name_last: 'Vellacott' } }),
  databaseInput({ inquiryFields: { email_address: 'ada@example.test' } }),
  databaseInput({ inquiryFields: undefined }),
];
const AAMVA_CASES: readonly AamvaCheckInput[] = [
  aamvaInput(),
  aamvaInput({ values: null }),
  aamvaInput({ providers: {} }),
  aamvaInput({ providers: { aamva: { kind: 'error' } } }),
  aamvaInput({ providers: { aamva: aamvaAnswer({ outcome: 'no_match' }) } }),
  aamvaInput({
    providers: { aamva: aamvaAnswer({ outcome: 'no_match', mismatchedFields: ['name-first'] }) },
  }),
  aamvaInput({ providers: { aamva: aamvaAnswer({ outcome: 'not_found' }) } }),
  aamvaInput({ providers: { aamva: aamvaAnswer({ outcome: 'jurisdiction_not_participating' }) } }),
];

describe('evaluateDatabaseChecks and evaluateAamvaChecks', () => {
  it('runs every enabled check in configuration order, and nothing disabled', () => {
    const config = templateOf({ database_po_box_detection: {}, database_name_comparison: {} });
    config.checks.database_identity_comparison = { enabled: false, required: true };

    expect(evaluateDatabaseChecks(databaseInput(), config).map((result) => result.name)).toEqual([
      'database_po_box_detection',
      'database_name_comparison',
    ]);
    expect(evaluateAamvaChecks(aamvaInput(), allAamva).map((result) => result.name)).toEqual(
      AAMVA_CHECKS,
    );
  });

  it('has an evaluator for every check of both types', () => {
    expect(Object.keys(DATABASE_EVALUATORS).sort()).toEqual([...DATABASE_CHECKS].sort());
    expect(Object.keys(AAMVA_EVALUATORS).sort()).toEqual([...AAMVA_CHECKS].sort());
  });

  it('refuses a check of another type, an unknown check and a config outside the schema', () => {
    expect(() => evaluateDatabaseChecks(databaseInput(), every(['aamva_name_comparison']))).toThrow(
      InvalidCheckConfigError,
    );
    expect(() => evaluateAamvaChecks(aamvaInput(), every(['database_name_comparison']))).toThrow(
      InvalidCheckConfigError,
    );
    expect(() =>
      evaluateDatabaseChecks(databaseInput(), templateOf({ not_a_check: {} } as never)),
    ).toThrow(InvalidCheckConfigError);
    expect(() =>
      evaluateDatabaseChecks(
        databaseInput(),
        templateOf({ database_name_comparison: { config: { 'min-match-level': 'most' } } }),
      ),
    ).toThrow(InvalidCheckConfigError);
  });
});

describe('aamvaSkipsVerification (C50.7, C59.6)', () => {
  const outside = aamvaInput({
    providers: { aamva: aamvaAnswer({ outcome: 'jurisdiction_not_participating' }) },
  });

  it('skips the silent step in a jurisdiction outside DLDV', () => {
    expect(aamvaSkipsVerification({ ...outside, source: 'government_id' }, allAamva)).toBe(true);
  });

  it('sends the form to review by default, and skips it when the template says skip', () => {
    expect(aamvaSkipsVerification(outside, allAamva)).toBe(false);
    expect(
      aamvaSkipsVerification(
        outside,
        templateOf({
          aamva_identity_comparison: { config: { 'on-jurisdiction-not-participating': 'skip' } },
        }),
      ),
    ).toBe(true);
  });

  it('never skips on any other answer', () => {
    for (const input of [
      aamvaInput(),
      aamvaInput({ providers: {} }),
      aamvaInput({ providers: { aamva: { kind: 'error' } } }),
    ]) {
      expect(aamvaSkipsVerification({ ...input, source: 'government_id' }, allAamva)).toBe(false);
    }
  });
});

describe('the database and AAMVA contract (C51.2)', () => {
  it('declares, per check, exactly the reasons of the C51.2 table', () => {
    expect(DATABASE_EVALUATOR_REASONS).toEqual(C51_2);
  });

  it('emits only declared reasons, in schema-valid results, across every outcome', () => {
    const results = [
      ...DATABASE_CASES.flatMap((input) => evaluateDatabaseChecks(input, allDatabase)),
      ...AAMVA_CASES.flatMap((input) => evaluateAamvaChecks(input, allAamva)),
    ];
    const seen = new Set<string>();
    for (const result of results) {
      expect(checkResultSchema.parse(result)).toEqual(result);
      for (const reason of result.reasons) {
        expect(DATABASE_EVALUATOR_REASONS[result.name]).toContain(reason);
        seen.add(`${result.name}:${reason}`);
      }
    }
    // The broad set reaches most of the table, so the check above is not vacuous.
    expect(seen.size).toBeGreaterThanOrEqual(35);
  });

  it('never passes a provider-backed check without the provider answering', () => {
    for (const providers of [
      {},
      { database: { kind: 'not_configured' as const } },
      { database: { kind: 'error' as const } },
    ]) {
      const passed = evaluateDatabaseChecks(databaseInput({ providers }), allDatabase).filter(
        (result) => result.status === 'passed',
      );
      expect(passed.map((result) => result.name).sort()).toEqual(['database_po_box_detection']);
    }
    for (const providers of [{}, { aamva: { kind: 'error' as const } }]) {
      expect(
        evaluateAamvaChecks(aamvaInput({ providers }), allAamva).filter(
          (result) => result.status === 'passed',
        ),
      ).toEqual([]);
    }
  });

  it('decides the sandbox endings under the default template as the plan says (C65.5)', () => {
    // C51.1: identity required; name, address, birthdate, inquiry and PO box advisory.
    const defaults = templateOf({
      database_identity_comparison: {},
      database_name_comparison: { required: false },
      database_address_comparison: { required: false },
      database_birthdate_comparison: { required: false },
      database_inquiry_comparison: { required: false },
      database_po_box_detection: { required: false },
    });
    const decide = (input: DatabaseCheckInput) =>
      decideVerification(evaluateDatabaseChecks(input, defaults), defaults).status;

    expect(decide(databaseInput())).toBe('passed');
    expect(
      decide(
        databaseInput({
          values: { ...ENTERED, 'name-first': 'Bob' },
          providers: { database: found(echoedRecord(ENTERED, { 'name-first': 'Robert' })) },
        }),
      ),
    ).toBe('passed');
    expect(
      decide(
        databaseInput({
          providers: { database: found(echoedRecord(ENTERED, { 'name-last': 'Ostrander' })) },
        }),
      ),
    ).toBe('failed');
    expect(
      decide(
        databaseInput({
          providers: { database: found(echoedRecord(ENTERED, { birthdate: undefined })) },
        }),
      ),
    ).toBe('needs_review');
    expect(decide(databaseInput({ providers: {} }))).toBe('needs_review');
  });
});
