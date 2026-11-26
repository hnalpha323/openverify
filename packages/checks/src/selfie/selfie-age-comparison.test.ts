import { describe, expect, it } from 'vitest';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { selfieAgeComparison } from './selfie-age-comparison.js';

const CHECK = 'selfie_age_comparison';
const PROVIDER = { id: 'sandbox', sandbox: true };
const estimate = (age: number) => ({
  providers: {
    selfieAgeEstimate: { kind: 'result' as const, provider: PROVIDER, result: { age } },
  },
});
const limits = (config: Record<string, number>) => selfieTemplate([CHECK], { [CHECK]: config });

describe('selfieAgeComparison (A, C43)', () => {
  it('needs a provider: provider_not_configured, or execution_error when it failed', () => {
    expect(selfieAgeComparison(selfieContextFor())).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
      stage: 'beta',
    });
    expect(
      selfieAgeComparison(selfieContextFor({ providers: { selfieAgeEstimate: { kind: 'error' } } }))
        .reasons,
    ).toEqual(['execution_error']);
  });

  it('passes an estimate within buffer-years of the age by the compared ID birthdate', () => {
    expect(selfieAgeComparison(selfieContextFor(estimate(34)))).toMatchObject({
      status: 'passed',
      metadata: { 'age-difference-years': 2 },
      provenance: {
        provider: PROVIDER,
        thresholds: { 'buffer-years': 3 },
        'threshold-basis': { 'buffer-years': 'provisional' },
      },
    });
  });

  it('fails an estimate further than buffer-years from that age', () => {
    expect(selfieAgeComparison(selfieContextFor(estimate(30)))).toMatchObject({
      status: 'failed',
      reasons: ['age_inconsistent_with_birthdate'],
      metadata: { 'age-difference-years': 6 },
    });
  });

  it('fails an estimate outside the limits by more than buffer-years', () => {
    const noBirthdate = { idBirthdate: null };
    expect(
      selfieAgeComparison(
        selfieContextFor({ ...estimate(18), ...noBirthdate }, limits({ 'min-age': 21 })),
      ),
    ).toMatchObject({ status: 'passed', metadata: { 'years-beyond-limits': 3 } });
    expect(
      selfieAgeComparison(
        selfieContextFor({ ...estimate(17), ...noBirthdate }, limits({ 'min-age': 21 })),
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['age_outside_limits'],
      metadata: { 'years-beyond-limits': 4 },
    });
    expect(
      selfieAgeComparison(
        selfieContextFor(
          { ...estimate(34), ...noBirthdate },
          limits({ 'max-age': 30, 'buffer-years': 0 }),
        ),
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['age_outside_limits'],
      provenance: { thresholds: { 'max-age': 30, 'buffer-years': 0 } },
    });
  });

  it('lists both reasons when both fail, keeping the estimate itself out of the result', () => {
    const result = selfieAgeComparison(selfieContextFor(estimate(12), limits({ 'min-age': 18 })));
    expect(result.reasons).toEqual(['age_outside_limits', 'age_inconsistent_with_birthdate']);
    expect(Object.values(result.metadata)).not.toContain(12);
  });

  it('is no_reference_data without limits or a birthdate, input_missing without a centre face', () => {
    expect(
      selfieAgeComparison(selfieContextFor({ ...estimate(40), idBirthdate: null })),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
    });
    expect(
      selfieAgeComparison(selfieContextFor({ ...estimate(40), idBirthdate: 'not-a-date' })).reasons,
    ).toEqual(['no_reference_data']);
    expect(
      selfieAgeComparison(
        selfieContextFor({
          ...estimate(40),
          analysis: withPose(threePoseAnalysis(), 'center', { face: null, faces: [] }),
        }),
      ).reasons,
    ).toEqual(['input_missing']);
  });
});
