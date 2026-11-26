/**
 * The text a document is read from (C60.5): on a page with visible text-layer lines (a
 * born-digital PDF page), those lines only, never an invisible one (render mode 3, clipped, off
 * the page, covered by an opaque fill, in the background's colour, or under 2 pt); on any other
 * page (a photo, a scan, a scan under an invisible OCR layer) vision's OCR lines. Each text-layer
 * line carries the OCR text read over its box, so a field whose text layer disagrees with what the
 * page shows can take the OCR value (C60.5). Lines come in reading order (page, then top to
 * bottom, then left to right), capped as C58.7 caps document text: 600 lines of 300 code points
 * per page.
 */
import { MATCHING_INPUT_LIMITS, capText } from '../matching/limits.js';
import type { DocumentAnalysisInput, DocumentBox, DocumentPageInput } from './inputs.js';
import { documentTokens, type DocumentToken } from './text.js';

/** One line the classifier and the extractor read. PII. */
export interface DocumentLine {
  /** 1-based. */
  readonly page: number;
  /** The page raster's size, in pixels. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly text: string;
  readonly box: DocumentBox;
  readonly source: 'text_layer' | 'ocr';
  /** Text-layer lines only: indexes into `pdf.fonts`. */
  readonly fontIds: readonly number[];
  readonly fontSizePt: number | null;
  /**
   * Text-layer lines only: the OCR text read over the line's box, left to right, or `null` when
   * OCR read nothing there (or the line is an OCR line).
   */
  readonly ocrText: string | null;
  readonly tokens: readonly DocumentToken[];
}

/** The share of the smaller box two boxes must have in common to overlap. */
const MIN_OVERLAP = 0.5;

/** Whether two boxes overlap by at least half of the smaller one's area. */
export function boxesOverlap(a: DocumentBox, b: DocumentBox): boolean {
  const width = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const height = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  if (width <= 0 || height <= 0) {
    return false;
  }
  const smaller = Math.min(a[2] * a[3], b[2] * b[3]);
  return smaller > 0 && (width * height) / smaller >= MIN_OVERLAP;
}

interface RawLine {
  readonly text: string;
  readonly box: DocumentBox;
  readonly source: 'text_layer' | 'ocr';
  readonly fontIds: readonly number[];
  readonly fontSizePt: number | null;
  readonly ocrText: string | null;
}

const centreY = (box: DocumentBox) => box[1] + box[3] / 2;

/**
 * Reading order: by the top of the line, then in rows (a line whose centre is within half a line
 * height of the row's first line joins it), each row left to right.
 */
function inReadingOrder(lines: readonly RawLine[]): RawLine[] {
  const byTop = [...lines].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
  const rows: RawLine[][] = [];
  for (const line of byTop) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (
      row !== undefined &&
      first !== undefined &&
      Math.abs(centreY(line.box) - centreY(first.box)) <= first.box[3] / 2
    ) {
      row.push(line);
    } else {
      rows.push([line]);
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.box[0] - b.box[0]));
}

/** The OCR text read over a box, left to right, or `null` when OCR read nothing there. */
function ocrTextOver(page: DocumentPageInput, box: DocumentBox): string | null {
  const over = page.ocr
    .filter((line) => boxesOverlap(line.box, box))
    .sort((a, b) => a.box[0] - b.box[0])
    .map((line) => line.text.trim())
    .filter(Boolean);
  return over.length === 0 ? null : over.join(' ');
}

function pageLines(page: DocumentPageInput): RawLine[] {
  const visible = page.text_layer.filter((line) => line.visible);
  if (visible.length > 0) {
    return visible.map((line) => ({
      text: line.text,
      box: line.box,
      source: 'text_layer',
      fontIds: line.font_ids,
      fontSizePt: line.font_size_pt,
      ocrText: ocrTextOver(page, line.box),
    }));
  }
  return page.ocr.map((line) => ({
    text: line.text,
    box: line.box,
    source: 'ocr',
    fontIds: [],
    fontSizePt: null,
    ocrText: null,
  }));
}

/** The lines of every analysed page, in reading order. */
export function documentLines(analysis: DocumentAnalysisInput): DocumentLine[] {
  const pages = [...analysis.pages].sort((a, b) => a.number - b.number);
  const folds = new Map<string, string>();
  return pages.flatMap((page) =>
    inReadingOrder(
      pageLines(page)
        .map((line) => ({
          ...line,
          text: capText(line.text, MATCHING_INPUT_LIMITS.documentLineLength).trim(),
        }))
        .filter((line) => line.text !== ''),
    )
      .slice(0, MATCHING_INPUT_LIMITS.documentLinesPerPage)
      .map((line) => ({
        ...line,
        page: page.number,
        pageWidth: page.width,
        pageHeight: page.height,
        tokens: documentTokens(line.text, folds),
      })),
  );
}
