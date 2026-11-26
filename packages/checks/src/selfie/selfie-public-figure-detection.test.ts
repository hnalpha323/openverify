import { describe, expect, it } from 'vitest';
import { selfieContextFor, threePoseAnalysis, withPose } from '../testing/selfie.js';
import { selfiePublicFigureDetection } from './selfie-public-figure-detection.js';

const PROVIDER = { id: 'sandbox', sandbox: true };
const answer = (match: boolean, score: number) => ({
  providers: {
    selfiePublicFigure: { kind: 'result' as const, provider: PROVIDER, result: { match, score } },
  },
});

describe('selfiePublicFigureDetection (A, C43)', () => {
  it('needs a provider: provider_not_configured, or execution_error when it failed', () => {
    expect(selfiePublicFigureDetection(selfieContextFor())).toMatchObject({
      status: 'not_applicable',
      reasons: ['provider_not_configured'],
      provenance: { thresholds: {} },
    });
    expect(
      selfiePublicFigureDetection(
        selfieContextFor({ providers: { selfiePublicFigure: { kind: 'error' } } }),
      ).reasons,
    ).toEqual(['execution_error']);
  });

  it('fails the provider match on the centre image (public_figure_match), labelled with it', () => {
    expect(selfiePublicFigureDetection(selfieContextFor(answer(true, 0.93)))).toMatchObject({
      status: 'failed',
      reasons: ['public_figure_match'],
      metadata: { 'provider-score': 0.93 },
      provenance: { provider: PROVIDER },
    });
  });

  it('passes when the provider finds no match', () => {
    expect(selfiePublicFigureDetection(selfieContextFor(answer(false, 0.04)))).toMatchObject({
      status: 'passed',
      reasons: [],
    });
  });

  it('is input_missing without a centre face, never passed', () => {
    expect(
      selfiePublicFigureDetection(
        selfieContextFor({
          ...answer(false, 0),
          analysis: withPose(threePoseAnalysis(), 'center', { face: null, faces: [] }),
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
  });
});
