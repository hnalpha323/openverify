/**
 * C60.1, C60.4: the zod side of the document contract. It parses the same golden fixtures as the
 * pydantic models (`contracts/fixtures/vision/`) and refuses what they refuse.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentAnalysis } from '../ports.js';
import {
  DOCUMENT_PROBLEM_CODES,
  GUARDED_WORKER_FAILED,
  MASKED_BACKGROUND_MAX_SIDE_PX,
  PORTRAIT_MAX_SIDE_PX,
  RENDER_MAX_SIDE_PX,
  documentAnalysisSchema,
  faceEmbeddingResultSchema,
} from './schemas.js';

function fixture(name: string): unknown {
  const url = new URL(`../../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

const pdf = () => fixture('analyze-document-pdf');
const photo = () => fixture('analyze-document-image');

type Node = Record<string, unknown> | unknown[];

/** The node at the dotted `path` (array indexes as numbers) of `value`. */
function at(value: unknown, path: string): Node {
  let node = value;
  for (const key of path === '' ? [] : path.split('.')) {
    node = (node as Record<string, unknown>)[key];
  }
  return node as Node;
}

/** A deep copy of `value` with `patch` set at the dotted `path`. */
function patched(value: unknown, path: string, patch: unknown): unknown {
  const copy = structuredClone(value);
  const keys = path.split('.');
  const last = keys.pop() ?? '';
  (at(copy, keys.join('.')) as Record<string, unknown>)[last] = patch;
  return copy;
}

function refused(document: unknown): string {
  const parsed = documentAnalysisSchema.safeParse(document);
  expect(parsed.success).toBe(false);
  return parsed.success ? '' : JSON.stringify(parsed.error.issues);
}

describe('the C60.1 golden documents', () => {
  it.each(['analyze-document-pdf', 'analyze-document-image'])('parse %s unchanged', (name) => {
    const parsed: DocumentAnalysis = documentAnalysisSchema.parse(fixture(name));
    expect(parsed).toEqual(fixture(name));
  });

  it('parse the chip portrait embedding (subject=chip, C60.4)', () => {
    const parsed = faceEmbeddingResultSchema.parse(fixture('embed-face-chip'));
    expect(parsed.face?.embedding).toHaveLength(128);
  });

  it('agree with the PNG limits both sides read', () => {
    expect(fixture('png-limits')).toEqual({
      media_type: 'image/png',
      render_document_page_max_side_px: RENDER_MAX_SIDE_PX,
      convert_portrait_max_side_px: PORTRAIT_MAX_SIDE_PX,
      mask_background_max_side_px: MASKED_BACKGROUND_MAX_SIDE_PX,
      jpeg2000_max_pixels: 4_000_000,
    });
  });

  it('name the problem codes vision answers', () => {
    expect(DOCUMENT_PROBLEM_CODES).toEqual([
      'pdf_encrypted',
      'pdf_unprocessable',
      'too_many_pages',
    ]);
    expect(GUARDED_WORKER_FAILED).toBe('guarded_worker_failed');
  });
});

describe('documentAnalysisSchema refuses what C60.1 rules out', () => {
  it('an unknown member', () => {
    refused(patched(pdf(), 'verdict', 'genuine'));
  });

  it('more than fifty pages', () => {
    refused(patched(pdf(), 'page_count', 51));
  });

  it('analysed pages other than the first three and the last', () => {
    expect(refused(patched(pdf(), 'page_count', 6))).toContain('first three pages and the last');
  });

  it('pages out of the analysed order', () => {
    const pages = [...(at(pdf(), 'pages') as unknown[])].reverse();
    expect(refused(patched(pdf(), 'pages', pages))).toContain('one entry per analysed page');
  });

  it('a PDF without its PDF measurements, and a photo with them', () => {
    expect(refused(patched(pdf(), 'pdf', null))).toContain('source is a PDF');
    expect(refused(patched(photo(), 'pdf', at(pdf(), 'pdf')))).toContain('source is a PDF');
  });

  it('a photo with a text layer or a page box', () => {
    const line = at(pdf(), 'pages.0.text_layer.0');
    expect(refused(patched(photo(), 'pages.0.text_layer', [line]))).toContain(
      'without a text layer',
    );
    const boxed = patched(patched(photo(), 'pages.0.width_pt', 612), 'pages.0.height_pt', 792);
    expect(refused(boxed)).toContain('page box');
  });

  it('a visible line with a hidden reason, or a hidden one without', () => {
    expect(refused(patched(pdf(), 'pages.0.text_layer.0.hidden_reason', 'covered'))).toContain(
      'hidden_reason',
    );
    const lines = at(pdf(), 'pages.0.text_layer') as Record<string, unknown>[];
    const hidden = lines.findIndex((line) => line.visible === false);
    expect(hidden).toBeGreaterThan(-1);
    expect(
      refused(patched(pdf(), `pages.0.text_layer.${String(hidden)}.hidden_reason`, null)),
    ).toContain('hidden_reason');
  });

  it('a line over 300 characters, or over 600 lines on a page', () => {
    refused(patched(pdf(), 'pages.0.ocr.0.text', 'X'.repeat(301)));
    const line = at(pdf(), 'pages.0.ocr.0');
    refused(
      patched(
        pdf(),
        'pages.0.ocr',
        Array.from({ length: 601 }, () => line),
      ),
    );
  });

  it('a page box over 14,400 points', () => {
    refused(patched(pdf(), 'pages.0.width_pt', 14_401));
  });

  it('an agreement without both a text layer and OCR', () => {
    expect(refused(patched(photo(), 'pages.0.text_layer_ocr_agreement', 0.9))).toContain(
      'needs both',
    );
  });

  it('font ids that are not positions, and a subset tag that is not six capitals', () => {
    expect(refused(patched(pdf(), 'pdf.fonts.0.id', 7))).toContain('position in fonts');
    refused(patched(pdf(), 'pdf.fonts.0.subset_tag', 'abc'));
  });

  it('edits after a signature without a signature', () => {
    const unsigned = patched(
      patched(pdf(), 'pdf.signatures', 0),
      'pdf.edits_after_signature',
      true,
    );
    expect(refused(unsigned)).toContain('needs a signature');
  });

  it('a date that is not ISO 8601', () => {
    refused(patched(pdf(), 'pdf.creation_date', "D:20260301120000+01'00'"));
  });
});
