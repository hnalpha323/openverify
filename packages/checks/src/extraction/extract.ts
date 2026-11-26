/**
 * The extraction of a government ID from its vision analysis (C31): the MRZ (parsed with the
 * C31.3 corrections), the AAMVA barcode and the visual zone, consolidated under the C31.2 rules,
 * and the document class and issuer the document establishes (C30.2). Pure: the worker persists
 * the result; the evaluators read it.
 *
 * Every value here is PII. Only field names, source names and codes may leave it into check
 * metadata (C29.3).
 */
import { EXTRACTION_FIELDS, type ExtractionField } from '@openverify/core';
import {
  AamvaParseError,
  parseAamva,
  type AamvaStructuralErrorCode,
  type ParsedAamva,
} from '../aamva.js';
import { normalizeCountryCode } from '../country-codes.js';
import {
  MrzParseError,
  parseMrz,
  type MrzCorrection,
  type MrzParseErrorCode,
  type ParsedMrz,
} from '../mrz.js';
import type { GovernmentIdAnalysisInput, IdSideAnalysisInput } from '../phase1/inputs.js';
import {
  parseViz,
  type DateOrder,
  type VizField,
  type VizFieldReading,
  type VizJurisdiction,
} from '../viz.js';
import {
  consolidateExtraction,
  type ConsolidatedExtraction,
  type SourceFields,
  type SourceReading,
} from './consolidate.js';
import { establishDocument, type EstablishedDocument } from './document.js';

export type Side = 'front' | 'back';

export interface MrzSource {
  side: Side;
  parsed: ParsedMrz;
  fields: SourceFields;
  /** The C31.5 fields whose MRZ value rests on a C31.3 correction, in field order. */
  correctedFields: readonly ExtractionField[];
  /** The lowest OCR confidence of the MRZ lines, or `null` without one. */
  minLineConfidence: number | null;
}

export interface BarcodeSource {
  side: Side;
  parsed: ParsedAamva;
  fields: SourceFields;
}

export interface VizSource {
  fields: SourceFields;
  /** Where each field was read: the side, the line and how (`label`, `pattern` or `layout`). */
  readings: Readonly<Partial<Record<VizField, VizFieldReading & { side: Side }>>>;
}

export interface ExtractionSources {
  mrz: MrzSource | null;
  /** An MRZ was found but no side's MRZ parsed. */
  mrzError: { side: Side; code: MrzParseErrorCode } | null;
  barcode: BarcodeSource | null;
  /** A PDF417 was decoded but no payload was AAMVA. */
  barcodeError: { side: Side; code: AamvaStructuralErrorCode } | null;
  viz: VizSource | null;
}

export interface GovernmentIdExtraction {
  sources: ExtractionSources;
  consolidated: ConsolidatedExtraction;
  document: EstablishedDocument;
}

export interface ExtractGovernmentIdOptions {
  /** Resolves two-digit MRZ years and pattern dates; defaults to now. */
  now?: Date | undefined;
}

const MS_PER_YEAR = 365.25 * 86_400_000;

/** `YYMMDD` to `YYYY-MM-DD`: a birth date is in the past, an expiry at most 50 years ahead. */
function mrzDate(value: string, kind: 'birth' | 'expiry', now: Date): string | undefined {
  if (!/^\d{6}$/.test(value)) {
    return undefined;
  }
  const yy = Number(value.slice(0, 2));
  const rest = `-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  const modern = `${String(2000 + yy)}${rest}`;
  const limit =
    kind === 'birth'
      ? now.toISOString().slice(0, 10)
      : new Date(now.getTime() + 50 * MS_PER_YEAR).toISOString().slice(0, 10);
  return modern > limit ? `${String(1900 + yy)}${rest}` : modern;
}

function mrzFields(parsed: ParsedMrz, now: Date): SourceFields {
  const nationality = normalizeCountryCode(parsed.nationality);
  const personal = parsed.format === 'MRVA' || parsed.format === 'MRVB' ? '' : parsed.optionalData1;
  const entries: [ExtractionField, string | undefined][] = [
    ['name-first', parsed.givenNames || undefined],
    ['name-last', parsed.surname || undefined],
    ['birthdate', mrzDate(parsed.birthDate, 'birth', now)],
    ['sex', parsed.sex ?? undefined],
    [
      'nationality',
      nationality !== null && /^[A-Z]{3}$/.test(nationality) ? nationality : undefined,
    ],
    ['identification-number', parsed.documentNumber || undefined],
    ['personal-number', personal || undefined],
    ['expiration-date', mrzDate(parsed.expirationDate, 'expiry', now)],
    ['issuing-authority-code', parsed.issuingState || undefined],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [ExtractionField, string] => entry[1] !== undefined),
  );
}

const CORRECTED: Readonly<Record<MrzCorrection['field'], readonly ExtractionField[]>> = {
  document_code: [],
  issuing_state: ['issuing-authority-code'],
  name: [],
  document_number: ['identification-number'],
  document_number_check_digit: ['identification-number'],
  nationality: ['nationality'],
  birth_date: ['birthdate'],
  birth_date_check_digit: ['birthdate'],
  sex: ['sex'],
  expiration_date: ['expiration-date'],
  expiration_date_check_digit: ['expiration-date'],
  optional_data: ['personal-number'],
  optional_data_check_digit: ['personal-number'],
  composite_check_digit: ['identification-number', 'birthdate', 'expiration-date'],
};

/** The C31.5 fields that rest on the MRZ corrections; a name correction names its component. */
export function mrzCorrectedFields(parsed: ParsedMrz): ExtractionField[] {
  const fields = new Set<ExtractionField>();
  for (const correction of parsed.corrections) {
    if (correction.field === 'name') {
      const line = parsed.lines[correction.line] ?? '';
      const start = parsed.format === 'TD1' ? 0 : 5;
      const separator = line.indexOf('<<', start);
      fields.add(separator === -1 || correction.position < separator ? 'name-last' : 'name-first');
    } else {
      CORRECTED[correction.field].forEach((field) => fields.add(field));
    }
  }
  return EXTRACTION_FIELDS.filter((field) => fields.has(field));
}

type SideEntry = readonly [Side, IdSideAnalysisInput];

function readMrz(
  sides: readonly SideEntry[],
  now: Date,
): Pick<ExtractionSources, 'mrz' | 'mrzError'> {
  let mrzError: ExtractionSources['mrzError'] = null;
  // TD1 cards carry the MRZ on the back; passports and visas on the front.
  for (const [side, analysis] of [...sides].reverse()) {
    const reading = analysis.mrz;
    if (reading?.found !== true || reading.lines.length === 0) {
      continue;
    }
    try {
      const parsed = parseMrz(reading.lines, { correct: true });
      return {
        mrz: {
          side,
          parsed,
          fields: mrzFields(parsed, now),
          correctedFields: mrzCorrectedFields(parsed),
          minLineConfidence:
            reading.line_confidences.length === 0 ? null : Math.min(...reading.line_confidences),
        },
        mrzError: null,
      };
    } catch (error) {
      if (!(error instanceof MrzParseError)) {
        throw error;
      }
      mrzError ??= { side, code: error.code };
    }
  }
  return { mrz: null, mrzError };
}

function readBarcode(
  sides: readonly SideEntry[],
): Pick<ExtractionSources, 'barcode' | 'barcodeError'> {
  let barcodeError: ExtractionSources['barcodeError'] = null;
  for (const [side, analysis] of [...sides].reverse()) {
    for (const barcode of analysis.barcodes ?? []) {
      if (!/PDF.?417/i.test(barcode.format)) {
        continue;
      }
      const payload =
        barcode.bytes_b64 === ''
          ? barcode.text
          : Buffer.from(barcode.bytes_b64, 'base64').toString('latin1');
      try {
        const parsed = parseAamva(payload);
        return { barcode: { side, parsed, fields: parsed.fields }, barcodeError: null };
      } catch (error) {
        if (!(error instanceof AamvaParseError)) {
          throw error;
        }
        barcodeError ??= { side, code: error.code };
      }
    }
  }
  return { barcode: null, barcodeError };
}

function readViz(
  sides: readonly SideEntry[],
  dateOrder: DateOrder,
  now: Date,
  jurisdiction: VizJurisdiction | null,
): VizSource | null {
  const readings: Partial<Record<VizField, VizFieldReading & { side: Side }>> = {};
  for (const [side, analysis] of sides) {
    const parsed = parseViz(analysis.text ?? [], { dateOrder, now, jurisdiction });
    for (const [field, reading] of Object.entries(parsed.fields) as [VizField, VizFieldReading][]) {
      readings[field] ??= { ...reading, side };
    }
  }
  const entries = Object.entries(readings) as [VizField, VizFieldReading][];
  return entries.length === 0
    ? null
    : {
        fields: Object.fromEntries(entries.map(([field, reading]) => [field, reading.value])),
        readings,
      };
}

/** Extracts and consolidates a government ID from its vision analysis (C31). */
export function extractGovernmentId(
  analysis: GovernmentIdAnalysisInput,
  options: ExtractGovernmentIdOptions = {},
): GovernmentIdExtraction {
  const now = options.now ?? new Date();
  const { front, back } = analysis.sides;
  const sides: SideEntry[] =
    back === null
      ? [['front', front]]
      : [
          ['front', front],
          ['back', back],
        ];
  const mrz = readMrz(sides, now);
  const barcode = readBarcode(sides);
  const issuer = barcode.barcode?.parsed.issuer ?? null;
  // US cards print numeric dates month first.
  const dateOrder = issuer?.country === 'US' ? 'MDY' : 'DMY';
  // The barcode's jurisdiction turns on a layout rule of the visual zone (Phase 12A C2).
  const jurisdiction = issuer?.code == null ? null : { country: issuer.country, code: issuer.code };
  const viz = readViz(sides, dateOrder, now, jurisdiction);
  const sources: ExtractionSources = { ...mrz, ...barcode, viz };

  const readings: SourceReading[] = [];
  if (sources.mrz !== null) {
    readings.push({
      source: 'mrz',
      fields: sources.mrz.fields,
      checkDigitsValid: sources.mrz.parsed.checkDigitsValid,
      correctedFields: sources.mrz.correctedFields,
      // A name field filled to its end may have been cut (ICAO 9303 Part 3; G007).
      truncatedFields: sources.mrz.parsed.nameTruncated ? ['name-first', 'name-last'] : [],
    });
  }
  if (sources.barcode !== null) {
    readings.push({ source: 'barcode', fields: sources.barcode.fields });
  }
  if (sources.viz !== null) {
    readings.push({ source: 'viz', fields: sources.viz.fields });
  }

  const document = establishDocument({
    mrz: sources.mrz?.parsed ?? null,
    aamva: sources.barcode?.parsed ?? null,
    vizTexts: sides.flatMap(([, side]) => (side.text ?? []).map((line) => line.text)),
    aspectRatio: front.document?.found === true ? front.document.aspect_ratio : null,
  });
  return { sources, consolidated: consolidateExtraction(readings), document };
}
