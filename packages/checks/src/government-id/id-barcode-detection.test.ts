import { describe, expect, it } from 'vitest';
import { establishDocument } from '../extraction/document.js';
import { extractGovernmentId } from '../extraction/extract.js';
import { parseAamva } from '../aamva.js';
import { aamvaPayload, barcodeAnalysis, goldenAnalysis, withBarcode } from '../testing/fixtures.js';
import { NOW, contextFor } from '../testing/context.js';
import { idBarcodeDetection } from './id-barcode-detection.js';

/** A California licence established from its barcode, whose barcode the analysis then lost. */
function aamvaWithoutBarcode(backPresent = true) {
  const analysis = withBarcode(aamvaPayload('dl-636014-real-id'));
  const extraction = extractGovernmentId(analysis, { now: NOW });
  if (analysis.sides.back !== null) {
    analysis.sides.back.barcodes = [];
  }
  if (!backPresent) {
    analysis.sides.back = null;
  }
  return {
    analysis,
    extraction: { ...extraction, sources: { ...extraction.sources, barcode: null } },
  };
}

describe('idBarcodeDetection', () => {
  it('passes a decoded AAMVA PDF417', () => {
    expect(idBarcodeDetection(contextFor({ analysis: barcodeAnalysis() }))).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { side: 'front', aamva: true },
      confidence: null,
    });
  });

  it('passes a decoded PDF417 that is not AAMVA, which the inconsistency check reports', () => {
    expect(idBarcodeDetection(contextFor({ analysis: withBarcode('HELLO WORLD') }))).toMatchObject({
      status: 'passed',
      metadata: { side: 'back', aamva: false },
    });
  });

  it('answers feature_absent for an established class without a PDF417 (the Utopia TD1, sandbox)', () => {
    expect(idBarcodeDetection(contextFor())).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
  });

  it('answers input_missing without a feature row', () => {
    expect(idBarcodeDetection(contextFor({ environment: 'production' }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('fails when the class carries a PDF417 and none was found', () => {
    expect(idBarcodeDetection(contextFor(aamvaWithoutBarcode()))).toMatchObject({
      status: 'failed',
      reasons: ['barcode_not_found'],
    });
  });

  it('answers not_requested when the PDF417 sits on a back the flow did not ask for', () => {
    expect(
      idBarcodeDetection(
        contextFor({
          ...aamvaWithoutBarcode(false),
          requiredSides: 'front',
          uploads: { front: { sha256: 'a'.repeat(64) }, back: null },
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['not_requested'] });
  });

  it('answers input_missing for a Phase 1 analysis, which decodes no barcode', () => {
    const { quality, faces, portrait } = goldenAnalysis().sides.front;
    const extraction = extractGovernmentId(barcodeAnalysis(), { now: NOW });
    const document = establishDocument({
      mrz: null,
      aamva: parseAamva(aamvaPayload('dl-636014-real-id')),
      vizTexts: [],
      aspectRatio: null,
    });
    expect(
      idBarcodeDetection(
        contextFor({
          analysis: { sides: { front: { quality, faces, portrait }, back: null } } as never,
          extraction: {
            ...extraction,
            document,
            sources: { ...extraction.sources, barcode: null },
          },
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
  });
});
