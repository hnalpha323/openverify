import { describe, expect, it } from 'vitest';
import { aamvaPayload, buildAamva, withBarcode } from '../testing/fixtures.js';
import { AAMVA, ICAO, extractionWith } from '../testing/extraction.js';
import { contextFor } from '../testing/context.js';
import { idNumberFormatInconsistencyDetection } from './id-number-format-inconsistency-detection.js';

const CORE = {
  DAQ: 'Y9876543',
  DBB: '02141990',
  DBA: '02142031',
  DCS: 'TESTWORTH',
  DAC: 'JORDAN',
  DCG: 'USA',
};

describe('idNumberFormatInconsistencyDetection', () => {
  it('judges a Utopia document number by the ICAO 9303 rules', () => {
    expect(idNumberFormatInconsistencyDetection(contextFor())).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { grammars: ['icao-9303'], fields: ['identification-number'] },
    });
  });

  it('judges a US licence number by its state grammar', () => {
    expect(
      idNumberFormatInconsistencyDetection(
        contextFor({ analysis: withBarcode(aamvaPayload('dl-636014-real-id')) }),
      ),
    ).toMatchObject({ status: 'passed', metadata: { grammars: ['us-dl-ca'] } });
    const wrong = buildAamva([['DL', { ...CORE, DAQ: '98765432' }]], { version: 8 });
    expect(
      idNumberFormatInconsistencyDetection(contextFor({ analysis: withBarcode(wrong) })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['number_format_invalid'],
      metadata: { grammars: ['us-dl-ca'], 'invalid-fields': ['identification-number'] },
    });
  });

  it('checks a national number of its shape by its checksum, beside the ICAO rules', () => {
    const document = {
      idClass: 'national_id' as const,
      issuer: ICAO('ESP', 'ES'),
      layout: 'TD1' as const,
    };
    expect(
      idNumberFormatInconsistencyDetection(
        contextFor({
          extraction: extractionWith(
            { 'identification-number': 'BAA000589', 'personal-number': '12345678Z' },
            document,
          ),
        }),
      ),
    ).toMatchObject({ status: 'passed', metadata: { grammars: ['icao-9303', 'es-dni'] } });
    expect(
      idNumberFormatInconsistencyDetection(
        contextFor({
          extraction: extractionWith(
            { 'identification-number': 'BAA000589', 'personal-number': '12345678A' },
            document,
          ),
        }),
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['number_format_invalid'],
      metadata: { 'invalid-fields': ['personal-number'] },
    });
  });

  it('leaves a number of another shape to the ICAO rules', () => {
    const document = {
      idClass: 'national_id' as const,
      issuer: ICAO('ESP', 'ES'),
      layout: 'TD1' as const,
    };
    expect(
      idNumberFormatInconsistencyDetection(
        contextFor({
          extraction: extractionWith(
            { 'identification-number': 'BAA000589', 'personal-number': 'ZZ1' },
            document,
          ),
        }),
      ),
    ).toMatchObject({ status: 'passed', metadata: { grammars: ['icao-9303'] } });
  });

  it('fails a document number the ICAO rules refuse for its format', () => {
    expect(
      idNumberFormatInconsistencyDetection(
        contextFor({
          extraction: extractionWith(
            { 'identification-number': 'L898902C3456' },
            { idClass: 'passport', issuer: ICAO('GBR', 'GB'), layout: 'TD3' },
          ),
        }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['number_format_invalid'] });
  });

  it.each([
    ['no issuer', extractionWith({ 'identification-number': 'X12K45P78' })],
    [
      'no number',
      extractionWith({}, { idClass: 'passport', issuer: ICAO('GBR', 'GB'), layout: 'TD3' }),
    ],
    [
      'a jurisdiction without a grammar (Puerto Rico)',
      extractionWith(
        { 'identification-number': '1234567' },
        { idClass: 'drivers_license', issuer: AAMVA('604431', 'PR') },
      ),
    ],
  ])('answers input_missing with %s', (_label, extraction) => {
    expect(idNumberFormatInconsistencyDetection(contextFor({ extraction }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  describe('the Quebec licence grammar (Phase 12A C11)', () => {
    const quebec = (number: string, issuer: ReturnType<typeof AAMVA> | null) =>
      idNumberFormatInconsistencyDetection(
        contextFor({
          extraction: extractionWith(
            { 'identification-number': number },
            { idClass: 'drivers_license', issuer },
            [{ source: 'barcode', fields: { 'identification-number': number } }],
          ),
        }),
      );

    it('passes a letter and twelve digits under the Quebec IIN', () => {
      expect(quebec('T123456789012', AAMVA('604428', 'QC', 'CA'))).toMatchObject({
        status: 'passed',
        metadata: { grammars: ['ca-dl-qc'], 'invalid-fields': [] },
      });
    });

    it('fails a number one digit short', () => {
      expect(quebec('T12345678901', AAMVA('604428', 'QC', 'CA'))).toMatchObject({
        status: 'failed',
        reasons: ['number_format_invalid'],
        metadata: { grammars: ['ca-dl-qc'], 'invalid-fields': ['identification-number'] },
      });
    });

    it('answers input_missing without an established issuer, and for another province', () => {
      expect(quebec('T123456789012', null)).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
      expect(quebec('T123456789012', AAMVA('636012', 'ON', 'CA'))).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
    });
  });
});
