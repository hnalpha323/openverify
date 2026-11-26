import { describe, expect, it } from 'vitest';
import { aamvaPayload, goldenAnalysis, withBarcode } from '../testing/fixtures.js';
import { ICAO, extractionWith } from '../testing/extraction.js';
import { contextFor } from '../testing/context.js';
import { idCompromisedDetection } from './id-compromised-detection.js';

const line = (text: string, y: number) => ({
  text,
  confidence: 0.9,
  box: [100, y, 300, 30] as const,
  stroke_width_mean: 3,
  stroke_width_cv: 0.14,
});

describe('idCompromisedDetection', () => {
  it('passes the Utopia card in a sandbox, where Utopia is the documented test issuer (C30.7)', () => {
    expect(idCompromisedDetection(contextFor())).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { markers: [], 'text-lines-scanned': 9 },
    });
  });

  it('fails the Utopia card in production as a specimen issuer (C30.7)', () => {
    expect(idCompromisedDetection(contextFor({ environment: 'production' }))).toMatchObject({
      status: 'failed',
      reasons: ['specimen_issuer'],
    });
  });

  it('fails a specimen marker printed outside the field values', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = [...analysis.sides.front.text, line('Spécimen', 560)];
    expect(idCompromisedDetection(contextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['specimen_marker_found'],
      metadata: { markers: ['SPECIMEN'] },
    });
  });

  it('ignores a marker word that is a field value: a holder named Sample', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((entry) =>
      entry.text === 'VALEMONT' ? { ...entry, text: 'SAMPLE' } : entry,
    );
    expect(idCompromisedDetection(contextFor({ analysis })).status).toBe('passed');
  });

  it('ignores markers inside OCR lines that are MRZ lines', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = [
      ...analysis.sides.front.text,
      line('SAMPLE<<ANNA<<<<<<<<<<<<<<<<<<', 560),
    ];
    expect(idCompromisedDetection(contextFor({ analysis })).status).toBe('passed');
  });

  it('fails the document number of a published ICAO example', () => {
    expect(
      idCompromisedDetection(
        contextFor({
          extraction: extractionWith(
            { 'identification-number': 'L898902C3' },
            { idClass: 'passport', issuer: ICAO('GBR', 'GB'), layout: 'TD3' },
          ),
        }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['specimen_document_number'] });
  });

  it('fails OpenVerify synthetic barcode data in production only', () => {
    const analysis = withBarcode(aamvaPayload('dl-636014-real-id'));
    expect(
      idCompromisedDetection(contextFor({ analysis, environment: 'production' })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['synthetic_test_data'],
    });
    expect(idCompromisedDetection(contextFor({ analysis })).status).toBe('passed');
  });

  it("fails a number on the organization's compromised list", () => {
    expect(
      idCompromisedDetection(contextFor({ compromisedList: { matched: true, unscreened: [] } })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['compromised_list_match'],
    });
    expect(
      idCompromisedDetection(contextFor({ compromisedList: { matched: false, unscreened: [] } }))
        .status,
    ).toBe('passed');
  });

  describe('a configured list it could not read (C99.9, H09)', () => {
    const unscreened = [
      { 'list-id': 'lst_01M5CK3190XEVBM5ZXA76E1JSN', reason: 'normaliser_outdated' },
    ];

    it('never passes: not_applicable with compromised_list_unavailable, which a required check sends to review', () => {
      const result = idCompromisedDetection(
        contextFor({ compromisedList: { matched: false, unscreened } }),
      );
      expect(result).toMatchObject({
        status: 'not_applicable',
        reasons: ['compromised_list_unavailable'],
      });
    });

    it('still fails on a match, or on any other hard signal', () => {
      expect(
        idCompromisedDetection(contextFor({ compromisedList: { matched: true, unscreened } })),
      ).toMatchObject({ status: 'failed', reasons: ['compromised_list_match'] });
      const analysis = withBarcode(aamvaPayload('dl-636014-real-id'));
      expect(
        idCompromisedDetection(
          contextFor({
            analysis,
            environment: 'production',
            compromisedList: { matched: false, unscreened },
          }),
        ),
      ).toMatchObject({ status: 'failed', reasons: ['synthetic_test_data'] });
    });

    it('lists what it screened and what it could not, by id', () => {
      const result = idCompromisedDetection(
        contextFor({
          compromisedList: {
            matched: false,
            unscreened,
            screened: ['lst_01M5CK3190XEVBM5ZXA76E1JSM'],
          },
        }),
      );
      expect(result.metadata).toMatchObject({
        'compromised-lists-screened': ['lst_01M5CK3190XEVBM5ZXA76E1JSM'],
        'compromised-lists-unscreened': unscreened,
      });
    });

    it('adds nothing to the metadata with no configured list', () => {
      expect(idCompromisedDetection(contextFor({})).metadata).not.toHaveProperty(
        'compromised-lists-screened',
      );
    });
  });

  it('answers input_missing when no OCR model ran, since no marker could be read', () => {
    const analysis = goldenAnalysis();
    analysis.model_versions = {
      ...analysis.model_versions,
      text_detector: null,
      text_recognizer: null,
    };
    expect(idCompromisedDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('answers input_missing when the OCR read no text at all', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = [];
    if (analysis.sides.back !== null) {
      analysis.sides.back.text = [];
    }
    expect(idCompromisedDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});
