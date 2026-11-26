/**
 * The fields extracted from a government ID (C31.5) and the sources that read them (C31.1).
 * They are PII: stored sealed (`government_id_extractions`), masked without `pii:view`, `null`
 * after redaction, and never in logs, check metadata, problems or the flow API (C31.6).
 *
 * The names are the API attribute names of `verification/government-id`; check metadata may name
 * them (`"disagreeing-fields": ["birthdate"]`, C29.3), never their values.
 */
import { z } from 'zod';

/** The C31.5 fields, in their API order. */
export const EXTRACTION_FIELDS = [
  'name-first',
  'name-middle',
  'name-last',
  'birthdate',
  'sex',
  'nationality',
  'identification-number',
  'personal-number',
  'issue-date',
  'expiration-date',
  'issuing-authority-code',
  'address-street-1',
  'address-street-2',
  'address-city',
  'address-subdivision',
  'address-postal-code',
  'address-country-code',
  'endorsements',
  'restrictions',
  'vehicle-class',
] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];
export const extractionFieldSchema = z.enum(EXTRACTION_FIELDS);

/** Where a field was read: the MRZ, the barcode, the visual zone, or (Phase 5) the NFC chip. */
export const EXTRACTION_SOURCES = ['mrz', 'barcode', 'viz', 'nfc'] as const;
export type ExtractionSource = (typeof EXTRACTION_SOURCES)[number];
export const extractionSourceSchema = z.enum(EXTRACTION_SOURCES);

/** Text read from a document: 1 to `max` characters, without control characters. */
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}\p{Cf}]+$/u, 'must not contain control characters');

/** A real calendar date, `YYYY-MM-DD`. */
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'must be a calendar date');

/** The schema of each field's value; `null` when the field was not read. */
const FIELD_SCHEMAS = {
  'name-first': text(100),
  'name-middle': text(100),
  'name-last': text(100),
  birthdate: date,
  sex: z.enum(['M', 'F', 'X']),
  /** The ICAO three-letter code as read (`D` normalized to `DEU`), for example `UTO`. */
  nationality: z.string().regex(/^[A-Z]{3}$/, 'must be a three-letter ICAO code'),
  'identification-number': text(40),
  'personal-number': text(40),
  'issue-date': date,
  'expiration-date': date,
  /** The raw ICAO issuer code or AAMVA IIN, for example `UTO`, `D` or `636014`. */
  'issuing-authority-code': z
    .string()
    .regex(/^[A-Z0-9]{1,6}$/, 'must be an ICAO issuer code or an AAMVA IIN'),
  'address-street-1': text(200),
  'address-street-2': text(200),
  'address-city': text(100),
  'address-subdivision': text(100),
  'address-postal-code': text(20),
  /** ISO 3166-1 alpha-2, or `null` for an issuer without one (Utopia, C30.7). */
  'address-country-code': z.string().regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code'),
  endorsements: text(40),
  restrictions: text(40),
  'vehicle-class': text(40),
} as const satisfies Record<ExtractionField, z.ZodType<string>>;

/** Every C31.5 field, each present and `null` when it was not read. */
export const extractedFieldsSchema = z.strictObject(
  Object.fromEntries(
    EXTRACTION_FIELDS.map((field) => [field, FIELD_SCHEMAS[field].nullable()]),
  ) as { [Field in ExtractionField]: z.ZodNullable<(typeof FIELD_SCHEMAS)[Field]> },
);
export type ExtractedFields = z.infer<typeof extractedFieldsSchema>;

/** Per field, the sources that agreed on it (C31.2), each once: field names, never values. */
export const extractionFieldSourcesSchema = z.partialRecord(
  extractionFieldSchema,
  z
    .array(extractionSourceSchema)
    .min(1)
    .refine((sources) => new Set(sources).size === sources.length, 'must not repeat a source')
    .readonly(),
);
export type ExtractionFieldSources = z.infer<typeof extractionFieldSourcesSchema>;

/** An extraction in which nothing was read. */
export function emptyExtractedFields(): ExtractedFields {
  return Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null])) as ExtractedFields;
}
