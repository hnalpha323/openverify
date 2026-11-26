/**
 * C60.5: a document is read from its visible text-layer lines on born-digital pages, else from
 * OCR, never from invisible text; each text-layer line carries the OCR of its box.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentPageInput } from './inputs.js';
import { boxesOverlap, documentLines } from './lines.js';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  pdfAnalysis,
  pdfPage,
  photoAnalysis,
  photoPage,
} from './testing.js';

const texts = (page: DocumentPageInput, extra: Partial<DocumentPageInput> = {}) =>
  documentLines(pdfAnalysis([{ ...page, ...extra }])).map((line) => line.text);

describe('documentLines', () => {
  it('reads a born-digital page from its visible text-layer lines only', () => {
    const page = pdfPage([
      'UTOPIA WATER BOARD',
      { text: 'Statement date: 30 September 2026', hidden: 'covered' },
      'Statement date: 30 September 2024',
    ]);
    const lines = documentLines(pdfAnalysis([page]));
    expect(lines.map((line) => line.text)).toEqual([
      'UTOPIA WATER BOARD',
      'Statement date: 30 September 2024',
    ]);
    expect(lines.every((line) => line.source === 'text_layer')).toBe(true);
  });

  it.each([
    'render_mode_invisible',
    'clipped',
    'off_page',
    'covered',
    'background_fill',
    'too_small',
  ] as const)('never reads a text-layer line hidden as %s', (hidden) => {
    expect(texts(pdfPage(['Amount due: 48.20', { text: 'Amount due: 4.82', hidden }]))).toEqual([
      'Amount due: 48.20',
    ]);
  });

  it('reads OCR on a page whose text layer is all invisible (a scan under an OCR layer)', () => {
    const page: DocumentPageInput = {
      ...pdfPage([
        { text: 'Meridale Gas', hidden: 'render_mode_invisible' },
        { text: 'Amount due 12.00', hidden: 'render_mode_invisible' },
      ]),
      ocr: photoPage(['MERIDALE GAS', 'Amount due 12.00']).ocr,
    };
    const lines = documentLines(pdfAnalysis([page]));
    expect(lines.map((line) => [line.text, line.source])).toEqual([
      ['MERIDALE GAS', 'ocr'],
      ['Amount due 12.00', 'ocr'],
    ]);
  });

  it('reads a photo from OCR', () => {
    const lines = documentLines(photoAnalysis(photoPage(['UTOPIA WATER BOARD', 'Amount due'])));
    expect(lines.map((line) => line.source)).toEqual(['ocr', 'ocr']);
    expect(lines.every((line) => line.ocrText === null && line.fontIds.length === 0)).toBe(true);
  });

  it('gives each text-layer line the OCR read over its box, left to right', () => {
    const page = pdfPage(['Statement date: 30 September 2026', 'Amount due: 48.20'], {
      ocr: { 0: 'Statement date: 30 September 2025' },
    });
    const split: DocumentPageInput = {
      ...page,
      ocr: [
        { text: '48.20', confidence: 0.9, box: [400, 200, 120, 40] },
        { text: 'Amount due:', confidence: 0.9, box: [150, 200, 250, 40] },
        page.ocr[0] ?? { text: '', confidence: 0, box: [0, 0, 1, 1] },
      ],
    };
    const lines = documentLines(pdfAnalysis([split]));
    expect(lines.map((line) => line.ocrText)).toEqual([
      'Statement date: 30 September 2025',
      'Amount due: 48.20',
    ]);
  });

  it('leaves ocrText null where OCR read nothing over the line', () => {
    const lines = documentLines(
      pdfAnalysis([pdfPage(['Amount due: 48.20'], { ocr: { 0: null } })]),
    );
    expect(lines[0]?.ocrText).toBeNull();
  });

  it('puts lines in reading order: page, top to bottom, left to right', () => {
    const lines = documentLines(
      pdfAnalysis([
        pdfPage(['Second page'], { number: 2 }),
        pdfPage([
          { text: 'right', box: [900, 150, 100, 40] },
          { text: 'bottom', box: [150, 900, 100, 40] },
          { text: 'left', box: [150, 152, 100, 40] },
        ]),
      ]),
    );
    expect(lines.map((line) => line.text)).toEqual(['left', 'right', 'bottom', 'Second page']);
    expect(lines.map((line) => line.page)).toEqual([1, 1, 1, 2]);
    expect(lines[0]).toEqual(
      expect.objectContaining({ pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT }),
    );
  });

  it('keeps at most 600 lines of 300 code points per page and drops blank ones (C58.7)', () => {
    const many = Array.from({ length: 700 }, (_, index) => ({
      text: `line ${String(index)}`,
      box: [150, index * 3, 100, 2] as const,
    }));
    const page = photoPage([...many, { text: 'x'.repeat(400) }, { text: '   ' }]);
    const lines = documentLines(photoAnalysis(page));
    expect(lines).toHaveLength(600);
    const long = documentLines(photoAnalysis(photoPage(['y'.repeat(400), '  '])));
    expect(long.map((line) => line.text.length)).toEqual([300]);
  });

  it('tokenises every line', () => {
    const [line] = documentLines(photoAnalysis(photoPage(['Amount due: 48.20'])));
    expect(line?.tokens.map((token) => token.folded)).toEqual(['amount', 'due', '48', '20']);
  });
});

describe('boxesOverlap', () => {
  it.each([
    [[0, 0, 100, 40], [0, 0, 100, 40], true],
    [[0, 0, 100, 40], [500, 500, 100, 40], false],
    [[0, 0, 400, 40], [100, 5, 50, 30], true],
    [[0, 0, 100, 40], [80, 0, 100, 40], false],
    [[0, 0, 100, 40], [40, 0, 100, 40], true],
  ] as const)('%j and %j: %s', (a, b, overlap) => {
    expect(boxesOverlap(a, b)).toBe(overlap);
  });
});
