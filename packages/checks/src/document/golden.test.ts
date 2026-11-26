/**
 * The golden vision answers (`contracts/fixtures/vision/analyze-document-*.json`, C60.1) through
 * the document checks: vision's answer is the evaluators' input as it arrives, and the fixture
 * holder's bill decides as the plan describes (its covered page-1 line is hidden text over a
 * field, so the advisory fabrication check fails while the required checks pass).
 */
import { readFileSync } from 'node:fs';
import { decideVerification, defaultTemplateConfig } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { evaluateDocument } from './evaluate.js';
import type { DocumentAnalysisInput } from './inputs.js';
import { INQUIRY_REFERENCE, NOW } from './testing.js';

function golden(file: string): DocumentAnalysisInput {
  const url = new URL(`../../../../contracts/fixtures/vision/${file}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as DocumentAnalysisInput;
}

const DEFAULTS = defaultTemplateConfig('document');
const run = (file: string) =>
  evaluateDocument(
    {
      vision: { kind: 'analysis', analysis: golden(file) },
      acceptedTypes: ['utility_bill'],
      references: INQUIRY_REFERENCE,
      now: NOW,
    },
    DEFAULTS,
  );

describe('the golden document analyses', () => {
  it('reads the born-digital bill: every required check passes, the covered line is hidden text', () => {
    const { results, reading } = run('analyze-document-pdf');
    const status = Object.fromEntries(results.map((result) => [result.name, result.status]));
    expect(status).toEqual({
      document_type_detection: 'passed',
      document_extracted_properties_detection: 'passed',
      document_expired_detection: 'not_applicable',
      document_recency_detection: 'passed',
      document_fabrication_detection: 'failed',
      document_name_comparison: 'passed',
      document_address_comparison: 'passed',
    });
    const fabrication = results.find((result) => result.name === 'document_fabrication_detection');
    expect(fabrication?.reasons).toEqual(['pdf_hidden_text']);
    expect(decideVerification(results, DEFAULTS).status).toBe('passed');
    expect(reading).toEqual(
      expect.objectContaining({ documentType: 'utility_bill', pageCount: 2, source: 'pdf' }),
    );
    expect(reading?.fields).toEqual(
      expect.objectContaining({
        name: 'QUINN VALEMONT',
        'issue-date': '2026-09-30',
        issuer: 'UTOPIA WATER BOARD',
      }),
    );
  });

  it('reads the photo of the bill from OCR: every required check passes, nothing fabricated', () => {
    const { results } = run('analyze-document-image');
    const status = Object.fromEntries(results.map((result) => [result.name, result.status]));
    expect(status).toEqual(
      expect.objectContaining({
        document_type_detection: 'passed',
        document_recency_detection: 'passed',
        document_fabrication_detection: 'passed',
        document_name_comparison: 'passed',
      }),
    );
    expect(decideVerification(results, DEFAULTS).status).toBe('passed');
  });
});
