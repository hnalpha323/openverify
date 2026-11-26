/**
 * Test helpers: the golden vision fixtures of C32.1 (`contracts/fixtures/vision`), read fresh for
 * every call so a test may change its copy. Test-only; not exported from the package.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  GovernmentIdAnalysisInput,
  IdSideAnalysisInput,
  TextLineInput,
} from '../phase1/inputs.js';

const VISION = path.resolve(import.meta.dirname, '../../../../contracts/fixtures/vision');

/** A side as the C32.1 contract types it: every v2 field present. */
export type FullSide = {
  [Key in keyof IdSideAnalysisInput]-?: Exclude<IdSideAnalysisInput[Key], undefined>;
};

export interface FullAnalysis extends GovernmentIdAnalysisInput {
  sides: { front: FullSide; back: FullSide | null };
}

/** `analyze-government-id.json`: a Utopia TD1 card, VIZ on the front, MRZ and address on the back. */
export function goldenAnalysis(): FullAnalysis {
  return JSON.parse(
    readFileSync(path.join(VISION, 'analyze-government-id.json'), 'utf8'),
  ) as FullAnalysis;
}

/** `analyze-government-id-barcode.json`: a barcode-only image of a synthetic AAMVA payload. */
export function barcodeAnalysis(): FullAnalysis {
  return JSON.parse(
    readFileSync(path.join(VISION, 'analyze-government-id-barcode.json'), 'utf8'),
  ) as FullAnalysis;
}

const AAMVA = path.resolve(import.meta.dirname, '../../../../contracts/fixtures/aamva');

/** The payload of an AAMVA vector (`contracts/fixtures/aamva`) by id. */
export function aamvaPayload(id: string): string {
  for (const file of ['valid.json', 'invalid.json']) {
    const vectors = (
      JSON.parse(readFileSync(path.join(AAMVA, file), 'utf8')) as {
        vectors: { id: string; payload: string }[];
      }
    ).vectors;
    const vector = vectors.find((candidate) => candidate.id === id);
    if (vector !== undefined) {
      return vector.payload;
    }
  }
  throw new Error(`no AAMVA vector ${id}`);
}

const QUEBEC = path.resolve(import.meta.dirname, '../../../../contracts/fixtures/quebec-dl');

interface QuebecAamvaCase {
  id: string;
  payload: string;
}

interface QuebecOcrCase {
  id: string;
  lines: { text: string; confidence: number; box: [number, number, number, number] }[];
}

/** The cases of `contracts/fixtures/quebec-dl/<file>` (Phase 12A, synthetic values). */
function quebecCases(file: 'aamva.json'): QuebecAamvaCase[];
function quebecCases(file: 'ocr-lines.json'): QuebecOcrCase[];
function quebecCases(file: string): { id: string }[] {
  return (JSON.parse(readFileSync(path.join(QUEBEC, file), 'utf8')) as { cases: { id: string }[] })
    .cases;
}

function byId<Case extends { id: string }>(cases: readonly Case[], id: string): Case {
  const found = cases.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no Quebec case ${id}`);
  }
  return found;
}

/** The payload of a synthetic Quebec-format AAMVA case (`quebec-dl/aamva.json`) by id. */
export function quebecAamvaPayload(id: string): string {
  return byId(quebecCases('aamva.json'), id).payload;
}

/**
 * The OCR lines of a synthetic Quebec-format front (`quebec-dl/ocr-lines.json`) by id, as vision
 * returns them: stroke widths uniform, as printed type measures.
 */
export function quebecFrontLines(id: string): TextLineInput[] {
  return byId(quebecCases('ocr-lines.json'), id).lines.map((line) => ({
    text: line.text,
    confidence: line.confidence,
    box: line.box,
    stroke_width_mean: 3,
    stroke_width_cv: 0.12,
  }));
}

/** The golden card with the given PDF417 payload on one side, and no MRZ anywhere. */
export function withBarcode(payload: string, side: 'front' | 'back' = 'back'): FullAnalysis {
  const analysis = goldenAnalysis();
  const noMrz = { found: false, format_guess: null, lines: [], line_confidences: [], box: null };
  analysis.sides.front.mrz = noMrz;
  const target = side === 'front' ? analysis.sides.front : analysis.sides.back;
  if (analysis.sides.back !== null) {
    analysis.sides.back.mrz = noMrz;
  }
  if (target !== null) {
    // The barcode side shows the barcode, not a visual zone.
    target.text = [];
    target.barcodes = [
      {
        format: 'PDF417',
        bytes_b64: Buffer.from(payload, 'latin1').toString('base64'),
        text: payload,
        quad: [
          [96, 160],
          [928, 160],
          [928, 480],
          [96, 480],
        ],
      },
    ];
  }
  return analysis;
}

/** OCR lines with a label above each value, one column, as a visual zone reads. */
export function labelledLines(pairs: readonly (readonly [label: string, value: string])[]) {
  return pairs.flatMap(([label, value], index) => [
    {
      text: label,
      confidence: 0.95,
      box: [40, 100 + index * 60, 200, 16] as const,
      stroke_width_mean: 2,
      stroke_width_cv: 0.14,
    },
    {
      text: value,
      confidence: 0.96,
      box: [40, 122 + index * 60, 220, 24] as const,
      stroke_width_mean: 3.3,
      stroke_width_cv: 0.14,
    },
  ]);
}

/** Builds an AAMVA payload with correct designators (Annex D): subfiles of `[type, elements]`. */
export function buildAamva(
  subfiles: readonly (readonly [string, Readonly<Record<string, string>>])[],
  { iin = '636014', version = 10, jurisdiction = 0 } = {},
): string {
  const header = `@\n\x1e\rANSI ${iin}${String(version).padStart(2, '0')}${
    version >= 2 ? String(jurisdiction).padStart(2, '0') : ''
  }${String(subfiles.length).padStart(2, '0')}`;
  const bodies = subfiles.map(
    ([type, elements]) =>
      `${type}${Object.entries(elements)
        .map(([id, value]) => id + value)
        .join('\n')}\r`,
  );
  let offset = header.length + 10 * subfiles.length;
  const designators = subfiles.map(([type], index) => {
    const length = bodies[index]?.length ?? 0;
    const designator = `${type}${String(offset).padStart(4, '0')}${String(length).padStart(4, '0')}`;
    offset += length;
    return designator;
  });
  return header + designators.join('') + bodies.join('');
}
