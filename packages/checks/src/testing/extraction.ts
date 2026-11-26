/** Test helpers: extractions built from given fields and a given document. Test-only. */
import type { ExtractionField } from '@openverify/core';
import type { DocumentIssuer, DocumentLayout } from '../data/feature-table.js';
import { consolidateExtraction, type SourceReading } from '../extraction/consolidate.js';
import type { EstablishedDocument } from '../extraction/document.js';
import type { GovernmentIdExtraction } from '../extraction/extract.js';

export const ICAO = (code: string, country: string | null = null): DocumentIssuer => ({
  scheme: 'icao',
  code,
  country,
  jurisdiction: null,
});

export const AAMVA = (iin: string, jurisdiction: string, country = 'US'): DocumentIssuer => ({
  scheme: 'aamva',
  code: iin,
  country,
  jurisdiction,
});

/** An extraction whose single MRZ-precedence reading holds `fields`, for `document`. */
export function extractionWith(
  fields: Readonly<Partial<Record<ExtractionField, string>>>,
  document: Partial<EstablishedDocument> & { layout?: DocumentLayout | null } = {},
  readings: readonly SourceReading[] = [{ source: 'mrz', fields, checkDigitsValid: true }],
): GovernmentIdExtraction {
  return {
    sources: { mrz: null, mrzError: null, barcode: null, barcodeError: null, viz: null },
    consolidated: consolidateExtraction(readings),
    document: {
      idClass: null,
      classSource: null,
      issuer: null,
      layout: null,
      ...document,
    },
  };
}
