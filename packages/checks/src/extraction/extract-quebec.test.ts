/**
 * Phase 12A C3 and C5: the extraction of a synthetic Quebec-format licence end to end, from the
 * front's OCR lines (`contracts/fixtures/quebec-dl/ocr-lines.json`), the back's PDF417
 * (`aamva.json`), or both. Invented values only.
 */
import { describe, expect, it } from 'vitest';
import { contextFor } from '../testing/context.js';
import {
  goldenAnalysis,
  quebecAamvaPayload,
  quebecFrontLines,
  withBarcode,
  type FullAnalysis,
} from '../testing/fixtures.js';
import { idExtractionInconsistencyDetection } from '../government-id/id-extraction-inconsistency-detection.js';
import { extractGovernmentId } from './extract.js';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const REQUIRED = {
  'name-first': 'MARIE',
  'name-last': 'TREMBLAY',
  birthdate: '1990-02-14',
  'identification-number': 'T123456789012',
  'expiration-date': '2029-02-14',
};

/** A Quebec-format card: the front's lines of an OCR case, the back's barcode, either optional. */
function quebecCard(front: string | null, barcode: string | null): FullAnalysis {
  const analysis =
    barcode === null
      ? withBarcode(quebecAamvaPayload('qc-v10'))
      : withBarcode(quebecAamvaPayload(barcode));
  if (barcode === null && analysis.sides.back !== null) {
    analysis.sides.back.barcodes = [];
  }
  analysis.sides.front.text = front === null ? [] : quebecFrontLines(front);
  return analysis;
}

const required = (analysis: FullAnalysis) => {
  const { fields } = extractGovernmentId(analysis, { now: NOW }).consolidated;
  return Object.fromEntries(Object.keys(REQUIRED).map((field) => [field, fields[field as never]]));
};

describe('extractGovernmentId on a Quebec-format licence (C5)', () => {
  it('reads the five required fields from the front and the barcode, the sources agreeing', () => {
    const extraction = extractGovernmentId(quebecCard('phone-ocr', 'qc-v10'), { now: NOW });
    expect(extraction.consolidated.fields).toMatchObject(REQUIRED);
    expect(extraction.consolidated.disagreeingFields).toEqual([]);
    for (const field of Object.keys(REQUIRED)) {
      expect(extraction.consolidated.fieldSources[field as never], field).toEqual([
        'barcode',
        'viz',
      ]);
    }
  });

  it('reads the five from the barcode alone', () => {
    expect(required(quebecCard(null, 'qc-v10'))).toEqual(REQUIRED);
  });

  it.each(['phone-ocr', 'labels-unread', 'printed', 'number-confusion'])(
    'reads the five from the %s front alone',
    (front) => {
      expect(required(quebecCard(front, null))).toEqual(REQUIRED);
    },
  );

  it('reads the five from each tolerated barcode deviation', () => {
    for (const id of ['qc-file-type-aamva', 'qc-printed-number', 'qc-offset-shift', 'qc-v08']) {
      expect(required(quebecCard(null, id)), id).toEqual(REQUIRED);
    }
  });

  it('turns the layout rule on from the barcode jurisdiction, with no QUEBEC line printed', () => {
    const analysis = quebecCard('phone-ocr', 'qc-v10');
    analysis.sides.front.text = analysis.sides.front.text.filter((line) => line.text !== 'QUEBEC');
    const { viz } = extractGovernmentId(analysis, { now: NOW }).sources;
    expect(viz?.readings['name-last']).toMatchObject({ via: 'layout', side: 'front' });
    expect(viz?.readings['name-first']).toMatchObject({ via: 'layout', side: 'front' });
  });

  it('reads no name from an unlabeled layout under another issuer', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = quebecFrontLines('not-quebec');
    analysis.sides.back = null;
    const { viz } = extractGovernmentId(analysis, { now: NOW }).sources;
    expect(viz?.readings).not.toHaveProperty('name-last');
  });
});

describe('the VIZ reading method in the extraction and its consistency check (C3)', () => {
  it('keeps how each VIZ field was read', () => {
    const { viz } = extractGovernmentId(quebecCard('phone-ocr', null), { now: NOW }).sources;
    expect(viz?.readings).toMatchObject({
      'identification-number': { via: 'pattern' },
      'name-last': { via: 'layout' },
      'name-first': { via: 'layout' },
      birthdate: { via: 'label' },
      'issue-date': { via: 'label' },
      'expiration-date': { via: 'label' },
      sex: { via: 'label' },
    });
  });

  it('names the VIZ method of each field it compares with the barcode', () => {
    const result = idExtractionInconsistencyDetection(
      contextFor({ analysis: quebecCard('phone-ocr', 'qc-v10'), now: NOW }),
    );
    expect(result).toMatchObject({ status: 'passed', metadata: { sources: ['barcode', 'viz'] } });
    expect(result.metadata['viz-via']).toEqual({
      'name-first': 'layout',
      'name-last': 'layout',
      birthdate: 'label',
      sex: 'label',
      'identification-number': 'pattern',
      'issue-date': 'label',
      'expiration-date': 'label',
    });
  });

  it('names no VIZ method when the visual zone is not compared', () => {
    const result = idExtractionInconsistencyDetection(
      contextFor({ analysis: quebecCard(null, 'qc-v10'), now: NOW }),
    );
    expect(result.metadata).not.toHaveProperty('viz-via');
  });
});
