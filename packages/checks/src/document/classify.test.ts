/**
 * C60.5: the classifier's fixed constants, its softmax over the five classes and `other`, and the
 * `unknown` rules (another script or language, too little confidence, too small a margin).
 */
import { DOCUMENT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { DOCUMENT_CLASSIFIER_CONSTANTS, classifyDocument } from './classify.js';
import { DOCUMENT_LANGUAGES } from './lexicons/index.js';
import { documentLines } from './lines.js';
import {
  CLASS_SAMPLES,
  LETTER_SAMPLE,
  OTHER_SCRIPT_SAMPLE,
  PASSPORT_SAMPLE,
  UNCOVERED_LANGUAGE_SAMPLE,
} from './samples.js';
import {
  cpuTimesReference,
  pdfAnalysis,
  pdfPage,
  photoAnalysis,
  photoPage,
  type LineSpec,
} from './testing.js';

const MIN_CONFIDENCE = 0.5;
const classify = (specs: readonly LineSpec[], minConfidence = MIN_CONFIDENCE) =>
  classifyDocument(documentLines(photoAnalysis(photoPage(specs))), { minConfidence });

/** The softmax of C60.5 at temperature 1 with `other` at θ = 2. */
function softmax(scores: readonly number[]): number[] {
  const all = [...scores, 2].map((score) => Math.exp(score));
  const total = all.reduce((sum, value) => sum + value, 0);
  return all.map((value) => value / total);
}

describe('DOCUMENT_CLASSIFIER_CONSTANTS', () => {
  it('holds the values the plan fixed (C60.5; not tuned, H23)', () => {
    expect(DOCUMENT_CLASSIFIER_CONSTANTS).toEqual({
      temperature: 1,
      otherScore: 2,
      minMargin: 0.15,
      cueWeights: { anchor: 3, medium: 2, weak: 1 },
      maxRepeats: 3,
      fuzzySimilarity: 0.93,
      fuzzyMinLength: 5,
      identityLabels: 3,
    });
  });
});

describe('classifyDocument', () => {
  describe.each(DOCUMENT_LANGUAGES)('%s', (language) => {
    it.each(DOCUMENT_TYPES)('classifies the %s sample', (documentClass) => {
      const result = classify(CLASS_SAMPLES[language][documentClass]);
      expect(result.classification).toBe(documentClass);
      expect(result.language).toBe(language);
      expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
      expect(result.margin).toBeGreaterThanOrEqual(DOCUMENT_CLASSIFIER_CONSTANTS.minMargin);
      expect(result.identityDocument).toBe(false);
      expect(result.unknownReason).toBeNull();
    });
  });

  it('scores an anchor 3 and runs the softmax with other at 2', () => {
    const result = classify(['Statement of account']);
    expect(result.scores).toEqual({
      utility_bill: 0,
      bank_statement: 3,
      lease: 0,
      pay_stub: 0,
      tax_document: 0,
    });
    const [utility = 0, bank = 0, lease = 0, pay = 0, tax = 0, other = 0] = softmax([
      0, 3, 0, 0, 0,
    ]);
    const expected = {
      utility_bill: utility,
      bank_statement: bank,
      lease,
      pay_stub: pay,
      tax_document: tax,
      other,
    };
    for (const [name, probability] of Object.entries(expected)) {
      expect(result.probabilities?.[name as keyof typeof expected]).toBeCloseTo(probability, 12);
    }
    expect(result.classification).toBe('bank_statement');
    expect(result.confidence).toBeCloseTo(bank, 12);
    expect(result.margin).toBeCloseTo(bank - other, 12);
  });

  it('counts a phrase at most three times', () => {
    const result = classify(Array.from({ length: 6 }, () => 'Statement of account'));
    expect(result.scores?.bank_statement).toBe(9);
  });

  it('adds a weak cue to every class it names', () => {
    const result = classify(['Account number', 'for the account of the holder']);
    expect(result.scores).toEqual(
      expect.objectContaining({ utility_bill: 1, bank_statement: 1, lease: 0 }),
    );
  });

  it('adds the layout features', () => {
    const result = classify(CLASS_SAMPLES.en.utility_bill);
    expect(result.features).toContain('meter-readings');
  });

  it('answers other for covered text without class evidence', () => {
    const result = classify(LETTER_SAMPLE);
    expect(result.classification).toBe('other');
    expect(result.top).toBe('other');
    expect(result.confidence).toBeCloseTo(softmax([0, 0, 0, 0, 0])[5] ?? 0, 12);
  });

  it('answers unknown when two classes tie (margin under 0.15)', () => {
    const tie = ['Statement of account', 'Electricity bill for the account'];
    // With integer weights, T = 1 and θ = 2, a tie never reaches 0.5, so the default confidence
    // rule answers first; the margin rule binds once min-confidence is set below 0.5.
    expect(classify(tie)).toEqual(
      expect.objectContaining({ classification: 'unknown', unknownReason: 'confidence' }),
    );
    const result = classify(tie, 0.3);
    expect(result.classification).toBe('unknown');
    expect(result.unknownReason).toBe('margin');
    expect(result.margin).toBeLessThan(0.15);
  });

  it('answers unknown under the configured min-confidence', () => {
    const result = classify(['Statement of account'], 0.9);
    expect(result.classification).toBe('unknown');
    expect(result.unknownReason).toBe('confidence');
    expect(result.top).toBe('bank_statement');
  });

  it('answers unknown for a document in another script or language, or without text', () => {
    expect(classify(OTHER_SCRIPT_SAMPLE)).toEqual(
      expect.objectContaining({
        classification: 'unknown',
        unknownReason: 'script',
        script: 'cyrillic',
      }),
    );
    expect(classify(UNCOVERED_LANGUAGE_SAMPLE)).toEqual(
      expect.objectContaining({
        classification: 'unknown',
        unknownReason: 'language',
        language: null,
      }),
    );
    expect(classifyDocument([], { minConfidence: 0.5 })).toEqual(
      expect.objectContaining({
        classification: 'unknown',
        unknownReason: 'no-text',
        confidence: null,
        probabilities: null,
      }),
    );
  });

  it('flags an identity document: an MRZ, or the identity labels of a covered language', () => {
    const passport = classify(PASSPORT_SAMPLE);
    expect(passport.classification).toBe('other');
    expect(passport.identityDocument).toBe(true);
    const labelsOnly = classify([
      'Surname: VALEMONT',
      'Given names: QUINN',
      'Date of birth: 12 APR 1987',
      'Nationality: UTOPIAN',
    ]);
    expect(labelsOnly.identityDocument).toBe(true);
    expect(classify(['Surname: VALEMONT', 'the bill of the month']).identityDocument).toBe(false);
    expect(classify(CLASS_SAMPLES.en.utility_bill).identityDocument).toBe(false);
  });

  it('reads a misread word of five letters or more as the lexicon word (OCR tolerance)', () => {
    const misread = classify([
      'Kontoauszvg Nr. 9',
      'Kontoinhaber: Quinn Valemont',
      'für den Monat',
    ]);
    expect(misread.language).toBe('de');
    expect(misread.scores?.bank_statement).toBeGreaterThanOrEqual(3);
  });

  it('never reads invisible text: a covered lease heading leaves a bill a bill', () => {
    const page = pdfPage([
      { text: 'RESIDENTIAL LEASE AGREEMENT', hidden: 'covered' },
      { text: 'Landlord and tenant', hidden: 'background_fill' },
      ...CLASS_SAMPLES.en.utility_bill,
    ]);
    const result = classifyDocument(documentLines(pdfAnalysis([page])), { minConfidence: 0.5 });
    expect(result.classification).toBe('utility_bill');
    expect(result.scores?.lease).toBe(0);
  });

  it('gives probabilities that sum to one', () => {
    const result = classify(CLASS_SAMPLES.fr.pay_stub);
    const total = Object.values(result.probabilities ?? {}).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 12);
  });

  // The bound is relative to a fixed reference workload measured beside it, because CPU time itself grows on a loaded or
  // throttled machine (2,688 ms in the full validation of 2026-11-05, about 300 ms alone): at most 16 references, about
  // two seconds on the machine the limit was set on (rule 6).
  it('classifies four pages of 600 long near-matching lines within 16 reference workloads, about two seconds (C58.7)', () => {
    const line = 'Statement of acount balanse brought forwards opening balanse 1,204.50 '.repeat(4);
    const pages = [1, 2, 3, 4].map((number) =>
      photoPage(
        Array.from({ length: 600 }, (_, index) => ({
          text: line.slice(0, 300),
          box: [150, index * 3, 1400, 2] as const,
        })),
        { number },
      ),
    );
    const work = () => {
      const lines = documentLines({
        ...photoAnalysis(pages[0] ?? photoPage([])),
        pages,
        page_count: 4,
        analysed_pages: [1, 2, 3, 4],
      });
      classifyDocument(lines, { minConfidence: 0.5 });
    };
    expect(cpuTimesReference(work)).toBeLessThan(16);
  });
});
