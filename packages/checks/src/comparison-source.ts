/**
 * C149.4 (Phase 9, Workflow 9B Stage 1a, (F); 9A Stage 3 amendment 21): `id_inquiry_comparison` and
 * `database_inquiry_comparison` compare with a field's initial value (set by `POST /inquiries`, sealed
 * in `inquiries.initial_fields`) when one exists, else its current value, and record which in their
 * metadata, under `comparison-source`, by compared field: `{ "<field>": "initial" | "entered" }`, so a
 * reviewer can tell a value the person could not edit from one they typed. `api-flow-carry` passes
 * `inquiryFieldSources` (from `comparisonSourceFor`) and writes the member.
 */
import { presentText } from './result.js';

export const COMPARISON_SOURCE_METADATA_KEY = 'comparison-source';
export const COMPARISON_SOURCE_KINDS = Object.freeze(['initial', 'entered'] as const);
export type ComparisonSourceKind = (typeof COMPARISON_SOURCE_KINDS)[number];

/** C149.4: the inquiry keys a compared name reads (both comparison checks). */
export const COMPARED_NAME_KEYS: readonly string[] = Object.freeze([
  'name_first',
  'name_middle',
  'name_last',
]);

/** C149.4: the inquiry keys a compared address reads (both comparison checks). */
export const COMPARED_ADDRESS_KEYS: readonly string[] = Object.freeze([
  'address_street_1',
  'address_street_2',
  'address_city',
  'address_subdivision',
  'address_postal_code',
  'address_country_code',
]);

/**
 * C149.4 (Workflow 9B, api-flow-carry): the `comparison-source` member for `compared`, each a compared
 * field read from the reference keys `keysOf(field)`. A field is `initial` only when every key it read
 * that holds a value is named `initial` by `sources`; a key the sources do not name, or any key typed
 * later, makes it `entered`, so a value the person could change is never reported as one they could
 * not. `null` when the worker passed no sources (the member is then left out). Names only, no value.
 */
export function comparisonSourceOf<Field extends string>(
  compared: readonly Field[],
  keysOf: (field: Field) => readonly string[],
  reference: Readonly<Record<string, unknown>>,
  sources: Readonly<Record<string, ComparisonSourceKind>> | null | undefined,
): Record<Field, ComparisonSourceKind> | null {
  if (sources === null || sources === undefined) {
    return null;
  }
  const member = {} as Record<Field, ComparisonSourceKind>;
  for (const field of compared) {
    const read = keysOf(field).filter((key) => presentText(reference[key]) !== null);
    member[field] =
      read.length > 0 && read.every((key) => sources[key] === 'initial') ? 'initial' : 'entered';
  }
  return member;
}
