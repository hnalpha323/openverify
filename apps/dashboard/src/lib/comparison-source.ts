/**
 * C149.4 (Workflow 9B, api-flow-carry; Workflow 9D, K9-16): where an inquiry comparison read each
 * compared value. `id_inquiry_comparison` and `database_inquiry_comparison` record, under
 * `comparison-source`, `initial` (the value the inquiry was created with, which the person could not
 * change) or `entered` (a value set later, by the person or through the API) for each compared
 * field. Field names only, never a value, so it is shown as recorded to every reader of the check;
 * a field the member does not name with a known kind (an older result, or no sources passed) is
 * "not recorded", never a source.
 */

/** The checks that record it (`COMPARISON_SOURCE_METADATA_KEY` of `@openverify/checks`). */
export const COMPARISON_SOURCE_KEY = 'comparison-source';
export const COMPARISON_CHECKS: readonly string[] = Object.freeze([
  'id_inquiry_comparison',
  'database_inquiry_comparison',
]);

export type ComparisonSourceKind = 'initial' | 'entered';

const KINDS: readonly unknown[] = ['initial', 'entered'] satisfies ComparisonSourceKind[];

/** Where `field`'s compared value came from, or `null` when the result does not record it. */
export function comparisonSourceOf(
  metadata: Readonly<Record<string, unknown>>,
  field: string,
): ComparisonSourceKind | null {
  const member = metadata[COMPARISON_SOURCE_KEY];
  if (typeof member !== 'object' || member === null || Array.isArray(member)) {
    return null;
  }
  const kind: unknown = Object.hasOwn(member, field)
    ? (member as Readonly<Record<string, unknown>>)[field]
    : undefined;
  return KINDS.includes(kind) ? (kind as ComparisonSourceKind) : null;
}

/** C149.4 in words, lower-case so it can follow a field's match. */
export const COMPARISON_SOURCE_WORDS = Object.freeze({
  initial:
    'compared with the value set when the inquiry was created, which the person could not change',
  entered:
    'compared with a value entered after the inquiry was created, by the person or through the API',
  unrecorded: 'where the compared value came from is not recorded',
} as const);

/** A field's source in words; `null` is "not recorded". */
export function comparisonSourceWords(kind: ComparisonSourceKind | null): string {
  return kind === null ? COMPARISON_SOURCE_WORDS.unrecorded : COMPARISON_SOURCE_WORDS[kind];
}
