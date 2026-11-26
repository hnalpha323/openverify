/**
 * C59.4–C59.6, C66: what the AAMVA evidence reads from a verification answer. A field's answer
 * comes only from what the results say: a failed identity that names no field leaves every field
 * "not recorded", never "no difference".
 */
import { AAMVA_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { aamvaChecks, aamvaVerification, type AamvaScenario } from '../testing/fixtures/aamva';
import { phase5Verification } from '../testing/phase5-fixtures';
import { AAMVA_VALUE_MEMBERS, aamvaEvidenceOf, type AamvaVerification } from './aamva-evidence';

const evidenceOf = (verification: ReturnType<typeof aamvaVerification>) =>
  aamvaEvidenceOf(verification as AamvaVerification);

/** Each member's answer, as a record. */
const answers = (scenario: AamvaScenario) =>
  Object.fromEntries(
    evidenceOf(aamvaVerification({ scenario })).fields.map((field) => [field.member, field.answer]),
  );

describe('the AAMVA value attributes (C52.8)', () => {
  it('lists every value attribute in contract order, the source left out', () => {
    expect(AAMVA_VALUE_MEMBERS).toEqual(
      Object.keys(AAMVA_VERIFICATION_ATTRIBUTES).filter((name) => name !== 'source'),
    );
  });
});

describe('aamvaEvidenceOf (C59.4–C59.6)', () => {
  it('reads the source, the provider, the identity result and its thresholds', () => {
    const evidence = evidenceOf(aamvaVerification());

    expect(evidence).toMatchObject({
      ran: true,
      skipped: false,
      source: 'form',
      provider: { id: 'sandbox', sandbox: true },
      identity: { name: 'aamva_identity_comparison', status: 'passed', required: true },
      ignoredFields: [],
      onNonParticipation: 'review',
    });
  });

  it('reports no difference on every compared field of a match, and the issuing authority as routing', () => {
    expect(answers('match')).toEqual({
      'name-first': 'no-difference',
      'name-last': 'no-difference',
      birthdate: 'no-difference',
      'identification-number': 'no-difference',
      'issuing-authority': 'routing',
      'issue-date': 'no-difference',
      'expiration-date': 'no-difference',
      'address-postal-code': 'no-difference',
    });
  });

  it('names the field that differs (0002)', () => {
    expect(answers('postal-code')).toMatchObject({
      'address-postal-code': 'differs',
      'name-last': 'no-difference',
    });
  });

  it('tells a difference the template ignores apart (ignored-fields)', () => {
    const evidence = evidenceOf(aamvaVerification({ scenario: 'ignored' }));

    expect(evidence.ignoredFields).toEqual(['address-postal-code']);
    expect(answers('ignored')['address-postal-code']).toBe('ignored');
  });

  it('says no record (9999) and not compared (5555) for every compared field', () => {
    expect(answers('not-found')).toMatchObject({
      'name-first': 'no-record',
      birthdate: 'no-record',
    });
    expect(answers('not-participating')).toMatchObject({
      'name-first': 'not-compared',
      'issuing-authority': 'routing',
    });
  });

  it('never says no difference when a failed identity names no field', () => {
    const fields = Object.entries(answers('no-field-list')).filter(
      ([member]) => member !== 'issuing-authority',
    );
    expect(fields.every(([, answer]) => answer === 'not-recorded')).toBe(true);
  });

  it('reads the names and the number from their own results when the identity did not run', () => {
    const [, name, number] = aamvaChecks('postal-code');
    if (name === undefined || number === undefined) throw new Error('two results');
    const evidence = evidenceOf(
      aamvaVerification({
        checks: [
          {
            ...name,
            status: 'failed',
            reasons: ['name_mismatch'],
            metadata: { 'name-first-match': true, 'name-last-match': false },
          },
          { ...number, status: 'failed', reasons: ['identification_number_mismatch'] },
        ],
      }),
    );
    const read = Object.fromEntries(evidence.fields.map((field) => [field.member, field.answer]));

    expect(evidence.identity).toBeNull();
    expect(read).toMatchObject({
      'name-first': 'no-difference',
      'name-last': 'differs',
      'identification-number': 'differs',
      birthdate: 'not-recorded',
    });
  });

  it('reads a passed number result as no difference without the identity', () => {
    const [, , number] = aamvaChecks('match');
    if (number === undefined) throw new Error('a number result');
    const read = evidenceOf(aamvaVerification({ checks: [number] })).fields;

    expect(read.find((field) => field.member === 'identification-number')?.answer).toBe(
      'no-difference',
    );
    expect(read.find((field) => field.member === 'name-first')?.answer).toBe('not-recorded');
  });

  it('answers nothing before the checks ran, and says a skipped attempt is never compared', () => {
    const initiated = evidenceOf(
      aamvaVerification({ checks: [], status: 'initiated', source: null }),
    );
    expect(initiated).toMatchObject({ ran: false, skipped: false, source: null, provider: null });
    expect(
      initiated.fields.every((field) => field.answer === null || field.answer === 'routing'),
    ).toBe(true);

    const skipped = evidenceOf(
      aamvaVerification({ checks: [], status: 'skipped', source: 'government_id' }),
    );
    expect(skipped).toMatchObject({ ran: false, skipped: true, source: 'government_id' });
  });

  it('reads the golden fixture: a silent attempt skipped for a jurisdiction that does not take part', () => {
    const evidence = evidenceOf(phase5Verification('verification/aamva'));

    expect(evidence).toMatchObject({ skipped: true, source: 'government_id' });
    expect(evidence.fields.find((field) => field.member === 'birthdate')?.answer).toBe(
      'not-compared',
    );
    // The evaluator records the template's choice; the silent step skips whatever it says.
    expect(evidence.onNonParticipation).toBe('review');
  });
});
