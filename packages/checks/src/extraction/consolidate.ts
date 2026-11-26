/**
 * `consolidateExtraction` (C31.2): one value per C31.5 field from the sources that read it, and,
 * per field, which sources read it, which agree with the value kept, and which pairs disagree.
 *
 * Precedence: the NFC chip (Phase 5), a check-digit-valid MRZ, the barcode, the visual zone, and
 * last an MRZ whose check digits fail. An MRZ field that rests on a C31.3 correction counts only
 * where the visual zone read the same value; otherwise it is left out and named in
 * `unconfirmedCorrections`. A value the C31.5 schema refuses is left out, and so is a reading
 * that cannot be compared with the value kept (an issuer code of another scheme). Results name
 * fields and sources, never values, except `fields` itself (PII).
 */
import {
  EXTRACTION_FIELDS,
  EXTRACTION_SOURCES,
  emptyExtractedFields,
  extractedFieldsSchema,
  type ExtractedFields,
  type ExtractionField,
  type ExtractionFieldSources,
  type ExtractionSource,
} from '@openverify/core';
import { fieldsAgree, fieldsComparable } from './agreement.js';

/** The fields one source read; a field not read is absent. */
export type SourceFields = Readonly<Partial<Record<ExtractionField, string>>>;

export interface SourceReading {
  source: ExtractionSource;
  fields: SourceFields;
  /** MRZ only: every check digit holds, which puts it first (C31.2). */
  checkDigitsValid?: boolean | undefined;
  /** MRZ only: fields whose value rests on a C31.3 correction. */
  correctedFields?: readonly ExtractionField[] | undefined;
  /**
   * MRZ only: the name fields its full name field may have cut short (ICAO 9303 Part 3); they
   * agree with a longer reading they are a truncation of, and only they (G007).
   */
  truncatedFields?: readonly ExtractionField[] | undefined;
}

export interface FieldConsolidation {
  /** The value kept (PII). */
  value: string;
  /** The sources that read the field, by precedence. */
  readBy: readonly ExtractionSource[];
  /** The sources that agree with the value kept, by precedence. */
  agreeing: readonly ExtractionSource[];
  /** Every pair of sources that read the field and disagree, by precedence. */
  disagreeing: readonly (readonly [ExtractionSource, ExtractionSource])[];
}

export interface ConsolidatedExtraction {
  /** Every C31.5 field, `null` when no source read a valid value. */
  fields: ExtractedFields;
  /** Per field read, the sources that agree with the value kept (C31.5 `extraction-sources`). */
  fieldSources: ExtractionFieldSources;
  details: Readonly<Partial<Record<ExtractionField, FieldConsolidation>>>;
  /** The fields two sources read differently, in field order. */
  disagreeingFields: readonly ExtractionField[];
  /** Corrected MRZ fields the visual zone did not confirm (C31.3), in field order. */
  unconfirmedCorrections: readonly ExtractionField[];
}

function rank(reading: SourceReading): number {
  switch (reading.source) {
    case 'nfc':
      return 0;
    case 'mrz':
      return reading.checkDigitsValid === true ? 1 : 4;
    case 'barcode':
      return 2;
    case 'viz':
      return 3;
  }
}

const sourceOrder = (sources: readonly ExtractionSource[]): ExtractionSource[] =>
  EXTRACTION_SOURCES.filter((source) => sources.includes(source));

function validValue(field: ExtractionField, value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') {
    return null;
  }
  return extractedFieldsSchema.shape[field].safeParse(trimmed).success ? trimmed : null;
}

/** Consolidates the readings of each source into one extraction (C31.2). */
export function consolidateExtraction(readings: readonly SourceReading[]): ConsolidatedExtraction {
  const ordered = [...readings].sort((a, b) => rank(a) - rank(b));
  const viz = readings.find((reading) => reading.source === 'viz');
  const fields = emptyExtractedFields() as Record<ExtractionField, string | null>;
  const fieldSources: Partial<Record<ExtractionField, ExtractionSource[]>> = {};
  const details: Partial<Record<ExtractionField, FieldConsolidation>> = {};
  const disagreeingFields: ExtractionField[] = [];
  const unconfirmedCorrections: ExtractionField[] = [];

  for (const field of EXTRACTION_FIELDS) {
    const read: { source: ExtractionSource; value: string; truncated: boolean }[] = [];
    for (const reading of ordered) {
      const value = validValue(field, reading.fields[field]);
      if (value === null) {
        continue;
      }
      const truncated = reading.truncatedFields?.includes(field) === true;
      if (reading.correctedFields?.includes(field) === true) {
        const confirmation = validValue(field, viz?.fields[field]);
        if (
          confirmation === null ||
          !fieldsAgree(field, value, confirmation, truncated ? 'a' : undefined)
        ) {
          unconfirmedCorrections.push(field);
          continue;
        }
      }
      read.push({ source: reading.source, value, truncated });
    }
    const [chosen] = read;
    if (chosen === undefined) {
      continue;
    }
    // A reading that cannot be compared with the value kept (an ICAO code beside an AAMVA IIN,
    // G004) is another kind of value, not a reading of this one: it is left out.
    const entries = read.filter((entry) => fieldsComparable(field, chosen.value, entry.value));
    const agree = (left: (typeof read)[number], right: (typeof read)[number]): boolean =>
      fieldsAgree(
        field,
        left.value,
        right.value,
        left.truncated ? 'a' : right.truncated ? 'b' : undefined,
      );
    const disagreeing: [ExtractionSource, ExtractionSource][] = [];
    entries.forEach((left, index) => {
      for (const right of entries.slice(index + 1)) {
        if (!agree(left, right)) {
          disagreeing.push([left.source, right.source]);
        }
      }
    });
    const agreeing = entries
      .filter((entry) => entry === chosen || agree(chosen, entry))
      .map((entry) => entry.source);
    fields[field] = chosen.value;
    fieldSources[field] = sourceOrder(agreeing);
    details[field] = {
      value: chosen.value,
      readBy: entries.map((entry) => entry.source),
      agreeing,
      disagreeing,
    };
    if (disagreeing.length > 0) {
      disagreeingFields.push(field);
    }
  }

  return {
    fields: fields as ExtractedFields,
    fieldSources,
    details,
    disagreeingFields,
    unconfirmedCorrections,
  };
}

/** The fields both sources read, in field order (the C31.4 minimums count them). */
export function fieldsReadByBoth(
  consolidated: ConsolidatedExtraction,
  a: ExtractionSource,
  b: ExtractionSource,
): ExtractionField[] {
  return EXTRACTION_FIELDS.filter((field) => {
    const readBy = consolidated.details[field]?.readBy ?? [];
    return readBy.includes(a) && readBy.includes(b);
  });
}
