/**
 * Phase 12A C10: the OCR confidence drop alone can no longer trip `id_handwriting_detection`.
 * The live false positive: clean print (stroke excess about 0.003), no visual-zone field read, one
 * line read with less confidence (drop 0.97), so the old `0.4 × 0.97 = 0.388` beat the 0.383
 * threshold. Synthetic lines only.
 */
import { describe, expect, it } from 'vitest';
import type { TextLineInput } from '../phase1/inputs.js';
import { contextFor } from '../testing/context.js';
import { goldenAnalysis } from '../testing/fixtures.js';
import { idHandwritingDetection } from './id-handwriting-detection.js';
import { handwritingScore } from './scores.js';

const THRESHOLD = 0.383;

function printedLine(text: string, row: number, patch: Partial<TextLineInput> = {}): TextLineInput {
  return {
    text,
    confidence: 0.95,
    box: [40, 40 + row * 28, 300, 20],
    stroke_width_mean: 3,
    stroke_width_cv: 0.12,
    ...patch,
  };
}

/** A front of 21 lines no field reads, one of them read with less confidence. */
function analysisWith(lines: TextLineInput[]) {
  const analysis = goldenAnalysis();
  analysis.sides.front.text = lines;
  if (analysis.sides.back !== null) {
    analysis.sides.back.text = [];
  }
  return analysis;
}

const WORDS =
  'ALPHA BRAVO CHARLIE DELTA ECHO FOXTROT GOLF HOTEL INDIA JULIETT KILO LIMA MIKE'.split(' ');

describe('handwritingScore (C10)', () => {
  it('keeps the live shape, clean print with one low-confidence line, below the threshold', () => {
    const lines = Array.from({ length: 21 }, (_, row) =>
      printedLine(
        `${WORDS[row % WORDS.length] ?? ''} ${WORDS[(row + 3) % WORDS.length] ?? ''}`,
        row,
        {
          // Print's even strokes: the excess over the median stays near 0.003.
          stroke_width_cv: row === 20 ? 0.12072 : 0.12,
          confidence: row === 20 ? 0.66 : 0.95,
        },
      ),
    );
    const context = contextFor({ analysis: analysisWith(lines) });
    expect(context.extraction.sources.viz).toBeNull();
    const score = handwritingScore(context);
    expect(score?.components['confidence-drop']).toBeGreaterThan(0.95);
    expect(score?.components['stroke-width-variation']).toBeLessThan(0.01);
    expect(score?.score).toBeLessThan(THRESHOLD);
    expect(idHandwritingDetection(context)).toMatchObject({ status: 'passed' });
  });

  it('caps a field line without a stroke signal below the threshold, whatever its drop', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) =>
      line.text === '14 02 1990' ? { ...line, confidence: 0.3 } : line,
    );
    const context = contextFor({ analysis });
    const score = handwritingScore(context);
    expect(score?.fieldScores.birthdate).toBeLessThan(THRESHOLD);
    expect(idHandwritingDetection(context)).toMatchObject({ status: 'passed' });
  });

  it('scores every line when fewer than two fields were read, and then needs a stroke signal', () => {
    const lines = [
      printedLine('SEX', 0),
      printedLine('F', 1),
      ...Array.from({ length: 6 }, (_, row) => printedLine(WORDS[row] ?? '', row + 2)),
      printedLine('SCRAWLED WORDS', 9, { stroke_width_cv: 0.6, confidence: 0.6 }),
    ];
    const context = contextFor({ analysis: analysisWith(lines) });
    expect(Object.keys(context.extraction.sources.viz?.readings ?? {})).toEqual(['sex']);
    expect(handwritingScore(context)?.score).toBeGreaterThan(THRESHOLD);
    expect(idHandwritingDetection(context)).toMatchObject({
      status: 'failed',
      reasons: ['handwriting_suspected'],
    });
  });
});
