/** The AAMVA checks (C59.4, C59.5), on the DLDV verdict a provider returns. */
import { describe, expect, it } from 'vitest';
import { aamvaIdentificationNumberComparison } from './aamva-identification-number-comparison.js';
import { aamvaIdentityComparison } from './aamva-identity-comparison.js';
import { aamvaNameComparison } from './aamva-name-comparison.js';
import { aamvaContext } from './context.js';
import type { AamvaCheckInput } from './inputs.js';
import {
  AAMVA_ENTERED,
  ENTERED_TEXT,
  SANDBOX_PROVIDER,
  aamvaAnswer,
  aamvaInput,
  templateOf,
} from './testing.js';

const identity = (input: AamvaCheckInput, config?: Record<string, unknown>) =>
  aamvaIdentityComparison(
    aamvaContext(
      input,
      templateOf({ aamva_identity_comparison: config === undefined ? {} : { config } }),
    ),
  );
const name = (input: AamvaCheckInput) =>
  aamvaNameComparison(aamvaContext(input, templateOf({ aamva_name_comparison: {} })));
const number = (input: AamvaCheckInput) =>
  aamvaIdentificationNumberComparison(
    aamvaContext(input, templateOf({ aamva_identification_number_comparison: {} })),
  );
const noMatch = (mismatchedFields?: string[]) =>
  aamvaInput({
    providers: {
      aamva: aamvaAnswer({
        outcome: 'no_match',
        ...(mismatchedFields === undefined ? {} : { mismatchedFields }),
      }),
    },
  });
const answered = (outcome: 'not_found' | 'jurisdiction_not_participating') =>
  aamvaInput({ providers: { aamva: aamvaAnswer({ outcome }) } });

describe('aamva_identity_comparison (C59.5)', () => {
  it('passes a matching record, naming the thresholds and the sandbox provider', () => {
    expect(identity(aamvaInput())).toMatchObject({
      status: 'passed',
      metadata: { 'mismatched-fields': [] },
      provenance: {
        provider: SANDBOX_PROVIDER,
        thresholds: { 'ignored-fields': [], 'on-jurisdiction-not-participating': 'review' },
      },
    });
  });

  it('fails record_mismatch naming each mismatched field outside ignored-fields', () => {
    expect(identity(noMatch(['name-last', 'birthdate']))).toMatchObject({
      status: 'failed',
      reasons: ['record_mismatch'],
      metadata: { 'mismatched-fields': ['name-last', 'birthdate'] },
    });
    expect(
      identity(noMatch(['name-last', 'birthdate']), { 'ignored-fields': ['birthdate'] }),
    ).toMatchObject({
      status: 'failed',
      metadata: { 'mismatched-fields': ['name-last'], 'ignored-mismatches': ['birthdate'] },
    });
  });

  it('passes when every mismatched field is one the template ignores', () => {
    expect(
      identity(noMatch(['address-postal-code']), { 'ignored-fields': ['address-postal-code'] }),
    ).toMatchObject({
      status: 'passed',
      metadata: { 'mismatched-fields': [], 'ignored-mismatches': ['address-postal-code'] },
    });
  });

  it('a no-match without its fields fails, unless some field is ignored, which leaves it undecided', () => {
    expect(identity(noMatch()).reasons).toEqual(['record_mismatch']);
    expect(identity(noMatch(), { 'ignored-fields': ['birthdate'] })).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('fails record_not_found without a record, and answers jurisdiction_not_participating (review)', () => {
    expect(identity(answered('not_found'))).toMatchObject({
      status: 'failed',
      reasons: ['record_not_found'],
    });
    expect(identity(answered('jurisdiction_not_participating'))).toMatchObject({
      status: 'not_applicable',
      reasons: ['jurisdiction_not_participating'],
    });
  });

  it('never passes without a provider result or every AAMVA input', () => {
    expect(identity(aamvaInput({ providers: {} })).reasons).toEqual(['provider_not_configured']);
    expect(identity(aamvaInput({ providers: { aamva: { kind: 'error' } } })).reasons).toEqual([
      'execution_error',
    ]);
    expect(identity(aamvaInput({ values: null })).reasons).toEqual(['input_missing']);
    expect(
      identity(aamvaInput({ values: { ...AAMVA_ENTERED, 'issuing-authority': null } })).reasons,
    ).toEqual(['input_missing']);
  });
});

describe('aamva_name_comparison (C59.5)', () => {
  it('passes a matching record with both names marked as matching', () => {
    expect(name(aamvaInput())).toMatchObject({
      status: 'passed',
      metadata: { 'name-first-match': true, 'name-last-match': true },
    });
    expect(name(noMatch(['birthdate'])).status).toBe('passed');
  });

  it('fails name_mismatch on either name, saying which', () => {
    expect(name(noMatch(['name-last']))).toMatchObject({
      status: 'failed',
      reasons: ['name_mismatch'],
      metadata: { 'name-first-match': true, 'name-last-match': false },
    });
  });

  it('cannot judge a no-match without its fields, and follows the record otherwise', () => {
    expect(name(noMatch()).reasons).toEqual(['execution_error']);
    expect(name(answered('not_found')).reasons).toEqual(['record_not_found']);
    expect(name(answered('jurisdiction_not_participating')).reasons).toEqual([
      'jurisdiction_not_participating',
    ]);
    expect(name(aamvaInput({ values: { ...AAMVA_ENTERED, 'name-first': null } })).reasons).toEqual([
      'input_missing',
    ]);
    expect(name(aamvaInput({ providers: {} })).reasons).toEqual(['provider_not_configured']);
  });
});

describe('aamva_identification_number_comparison (C59.5)', () => {
  it('passes a matching number and fails identification_number_mismatch otherwise', () => {
    expect(number(aamvaInput()).status).toBe('passed');
    expect(number(noMatch(['name-last'])).status).toBe('passed');
    expect(number(noMatch(['identification-number']))).toMatchObject({
      status: 'failed',
      reasons: ['identification_number_mismatch'],
    });
  });

  it('cannot judge a no-match without its fields, and follows the record otherwise', () => {
    expect(number(noMatch()).reasons).toEqual(['execution_error']);
    expect(number(answered('not_found')).reasons).toEqual(['record_not_found']);
    expect(number(answered('jurisdiction_not_participating')).reasons).toEqual([
      'jurisdiction_not_participating',
    ]);
    expect(
      number(aamvaInput({ values: { ...AAMVA_ENTERED, 'identification-number': null } })).reasons,
    ).toEqual(['input_missing']);
    expect(
      number(aamvaInput({ providers: { aamva: { kind: 'not_configured' } } })).reasons,
    ).toEqual(['provider_not_configured']);
  });

  it('copies no value', () => {
    for (const result of [
      identity(noMatch(['name-last'])),
      name(noMatch(['name-last'])),
      number(aamvaInput()),
    ]) {
      const serialized = JSON.stringify(result);
      for (const value of ENTERED_TEXT) {
        expect(serialized).not.toContain(value);
      }
    }
  });
});
