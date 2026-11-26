import { describe, expect, it } from 'vitest';
import { aamvaPayload, barcodeAnalysis, withBarcode } from '../testing/fixtures.js';
import { contextFor, template } from '../testing/context.js';
import { idRealIdDetection } from './id-real-id-detection.js';

function card(vector: string, star: { found: boolean; score: number } | null) {
  const analysis = withBarcode(aamvaPayload(vector));
  const forensics = analysis.sides.front.forensics;
  analysis.sides.front.forensics =
    star === null || forensics === null
      ? null
      : { ...forensics, star_glyph: { ...star, box: star.found ? [40, 20, 60, 60] : null } };
  return contextFor({ analysis, environment: 'production' });
}

describe('idRealIdDetection', () => {
  it('passes a US card whose barcode says compliant (DDA F) and that shows the star', () => {
    expect(idRealIdDetection(card('dl-636014-real-id', { found: true, score: 0.9 }))).toMatchObject(
      {
        status: 'passed',
        reasons: [],
        metadata: { 'real-id-compliance': 'F', 'star-glyph-found': true, 'star-glyph-score': 0.9 },
        provenance: { thresholds: { 'min-star-glyph-score': 0.5 } },
      },
    );
  });

  it('passes on the barcode alone when the front was not measured', () => {
    expect(idRealIdDetection(card('dl-636014-real-id', null))).toMatchObject({
      status: 'passed',
      metadata: { 'star-glyph-found': null },
    });
  });

  it('fails a compliant barcode on a card without the star, or a weak match', () => {
    expect(
      idRealIdDetection(card('dl-636014-real-id', { found: false, score: 0.1 })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['real_id_marker_inconsistent'],
    });
    expect(idRealIdDetection(card('dl-636014-real-id', { found: true, score: 0.3 }))).toMatchObject(
      {
        status: 'failed',
        reasons: ['real_id_marker_inconsistent'],
      },
    );
  });

  it('fails a card the barcode says is not compliant (DDA N)', () => {
    expect(
      idRealIdDetection(card('id-636020-not-real-id', { found: false, score: 0 })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['real_id_not_compliant'],
    });
    expect(
      idRealIdDetection(card('id-636020-not-real-id', { found: true, score: 0.9 })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['real_id_marker_inconsistent'],
    });
  });

  it('judges a barcode without DDA by the star', () => {
    const analysis = barcodeAnalysis();
    const context = (found: boolean | null) => {
      const copy = structuredClone(analysis);
      const forensics = copy.sides.front.forensics;
      copy.sides.front.forensics =
        found === null || forensics === null
          ? null
          : {
              ...forensics,
              star_glyph: { found, score: found ? 0.9 : 0.1, box: found ? [1, 1, 5, 5] : null },
            };
      return contextFor({ analysis: copy, environment: 'production' });
    };
    expect(idRealIdDetection(context(true)).status).toBe('passed');
    expect(idRealIdDetection(context(false))).toMatchObject({
      status: 'failed',
      reasons: ['real_id_not_compliant'],
    });
    expect(idRealIdDetection(context(null))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('takes a configured star threshold', () => {
    const analysis = withBarcode(aamvaPayload('dl-636014-real-id'));
    const forensics = analysis.sides.front.forensics;
    if (forensics !== null) {
      analysis.sides.front.forensics = {
        ...forensics,
        star_glyph: { found: true, score: 0.6, box: [1, 1, 5, 5] },
      };
    }
    expect(
      idRealIdDetection(
        contextFor(
          { analysis },
          template({ id_real_id_detection: { 'min-star-glyph-score': 0.7 } }),
        ),
      ).reasons,
    ).toEqual(['real_id_marker_inconsistent']);
  });

  it('answers feature_absent for an established class with no REAL ID: a Canadian licence, the Utopia card', () => {
    expect(idRealIdDetection(card('dl-636012-canada', null))).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
    expect(idRealIdDetection(contextFor())).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
  });

  it('answers input_missing without a feature row', () => {
    expect(idRealIdDetection(contextFor({ environment: 'production' }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});
