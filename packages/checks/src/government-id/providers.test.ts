/** The A-tier checks (C35): a provider's result, or provider_not_configured, never a fake pass. */
import { describe, expect, it } from 'vitest';
import { aamvaPayload, goldenAnalysis, withBarcode } from '../testing/fixtures.js';
import { contextFor, template } from '../testing/context.js';
import { idAamvaDatabaseLookup } from './id-aamva-database-lookup.js';
import { idAgeInconsistencyDetection } from './id-age-inconsistency-detection.js';
import { idPublicFigureDetection } from './id-public-figure-detection.js';
import { GOVERNMENT_ID_EVALUATOR_REASONS } from './reasons.js';

const SANDBOX = { id: 'sandbox', sandbox: true } as const;
const result = <T>(value: T) => ({ kind: 'result' as const, provider: SANDBOX, result: value });
const licence = () => withBarcode(aamvaPayload('dl-636014-real-id'));

describe('idAamvaDatabaseLookup', () => {
  it('passes a record the provider matched, labelled with the provider', () => {
    expect(
      idAamvaDatabaseLookup(
        contextFor({ analysis: licence(), providers: { aamva: result({ outcome: 'match' }) } }),
      ),
    ).toMatchObject({ status: 'passed', reasons: [], provenance: { provider: SANDBOX } });
  });

  it.each([
    [
      { outcome: 'no_match', mismatchedFields: ['birthdate'] },
      'aamva_record_mismatch',
      { 'mismatched-fields': ['birthdate'] },
    ],
    [{ outcome: 'not_found' }, 'aamva_record_not_found', {}],
  ] as const)('fails %j', (value, reason, metadata) => {
    expect(
      idAamvaDatabaseLookup(
        contextFor({ analysis: licence(), providers: { aamva: result(value) } }),
      ),
    ).toMatchObject({ status: 'failed', reasons: [reason], metadata });
  });

  it('answers not_applicable, blocking, when the jurisdiction does not take part (C59.4, a C35 amendment)', () => {
    const answered = idAamvaDatabaseLookup(
      contextFor({
        analysis: licence(),
        providers: { aamva: result({ outcome: 'jurisdiction_not_participating' }) },
      }),
    );
    expect(answered).toMatchObject({
      status: 'not_applicable',
      reasons: ['aamva_jurisdiction_not_participating'],
      provenance: { provider: SANDBOX },
    });
    expect(GOVERNMENT_ID_EVALUATOR_REASONS.id_aamva_database_lookup).toContain(
      'aamva_jurisdiction_not_participating',
    );
  });

  it('answers provider_not_configured without a provider, and execution_error after its failure', () => {
    expect(idAamvaDatabaseLookup(contextFor({ analysis: licence() }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
    });
    expect(
      idAamvaDatabaseLookup(
        contextFor({ analysis: licence(), providers: { aamva: { kind: 'not_configured' } } }),
      ),
    ).toMatchObject({ reasons: ['provider_not_configured'] });
    expect(
      idAamvaDatabaseLookup(
        contextFor({ analysis: licence(), providers: { aamva: { kind: 'error' } } }),
      ),
    ).toMatchObject({ reasons: ['execution_error'] });
  });

  it('answers feature_absent for an established document that is not a US licence', () => {
    expect(
      idAamvaDatabaseLookup(contextFor({ providers: { aamva: result({ outcome: 'match' }) } })),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
  });

  it('answers input_missing when the result has no number to have looked up', () => {
    const analysis = licence();
    const context = contextFor({ analysis, providers: { aamva: result({ outcome: 'match' }) } });
    expect(
      idAamvaDatabaseLookup({
        ...context,
        extraction: {
          ...context.extraction,
          consolidated: {
            ...context.extraction.consolidated,
            fields: { ...context.extraction.consolidated.fields, 'identification-number': null },
          },
        },
      }),
    ).toMatchObject({ reasons: ['input_missing'] });
  });
});

describe('idPublicFigureDetection', () => {
  it('passes a portrait that matches no public figure, fails one that does', () => {
    expect(
      idPublicFigureDetection(
        contextFor({ providers: { publicFigure: result({ outcome: 'no_match' }) } }),
      ),
    ).toMatchObject({ status: 'passed', stage: 'beta', provenance: { provider: SANDBOX } });
    expect(
      idPublicFigureDetection(
        contextFor({ providers: { publicFigure: result({ outcome: 'match' }) } }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['public_figure_match'] });
  });

  it('answers no_reference_data with an empty gallery', () => {
    expect(
      idPublicFigureDetection(
        contextFor({ providers: { publicFigure: result({ outcome: 'gallery_empty' }) } }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['no_reference_data'] });
  });

  it('answers provider_not_configured, execution_error or input_missing without a result to use', () => {
    expect(idPublicFigureDetection(contextFor())).toMatchObject({
      reasons: ['provider_not_configured'],
    });
    expect(
      idPublicFigureDetection(contextFor({ providers: { publicFigure: { kind: 'error' } } })),
    ).toMatchObject({
      reasons: ['execution_error'],
    });
    const analysis = goldenAnalysis();
    analysis.sides.front.portrait = null;
    expect(
      idPublicFigureDetection(
        contextFor({ analysis, providers: { publicFigure: result({ outcome: 'no_match' }) } }),
      ),
    ).toMatchObject({ reasons: ['input_missing'] });
  });
});

describe('idAgeInconsistencyDetection', () => {
  it('passes an apparent age close to the age from the birth date, with the provider confidence', () => {
    expect(
      idAgeInconsistencyDetection(
        contextFor({ providers: { ageEstimate: result({ estimatedAge: 40, confidence: 0.7 }) } }),
      ),
    ).toMatchObject({
      status: 'passed',
      confidence: 0.7,
      metadata: { 'age-difference-years': 4 },
      provenance: { provider: SANDBOX, thresholds: { 'max-age-difference-years': 10 } },
    });
  });

  it('fails an apparent age far from it', () => {
    expect(
      idAgeInconsistencyDetection(
        contextFor({ providers: { ageEstimate: result({ estimatedAge: 62 }) } }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['apparent_age_inconsistent'], confidence: null });
    const tight = template({ id_age_inconsistency_detection: { 'max-age-difference-years': 3 } });
    expect(
      idAgeInconsistencyDetection(
        contextFor({ providers: { ageEstimate: result({ estimatedAge: 40 }) } }, tight),
      ).status,
    ).toBe('failed');
  });

  it('answers provider_not_configured, execution_error or input_missing', () => {
    expect(idAgeInconsistencyDetection(contextFor())).toMatchObject({
      reasons: ['provider_not_configured'],
    });
    expect(
      idAgeInconsistencyDetection(contextFor({ providers: { ageEstimate: { kind: 'error' } } })),
    ).toMatchObject({
      reasons: ['execution_error'],
    });
    const analysis = goldenAnalysis();
    analysis.sides.front.portrait = null;
    expect(
      idAgeInconsistencyDetection(
        contextFor({ analysis, providers: { ageEstimate: result({ estimatedAge: 40 }) } }),
      ),
    ).toMatchObject({ reasons: ['input_missing'] });
  });
});
