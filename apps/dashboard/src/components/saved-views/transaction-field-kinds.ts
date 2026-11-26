/**
 * C165.2, DA4 (Workflow 9D, K9-19): which transaction field filters a saved view may hold. A field
 * filter is personal data on a string field (`savedViewPiiFilterKeys`); the console tells the others
 * from the transaction types it reads: a key is not personal only when at least one type declares it
 * and none declares it as a string. Anything it cannot tell (a key no type declares, or types it
 * could not all read) stays personal, failing closed as the API does; the API judges again on save,
 * over every version, drafts included.
 */

/** The top-level field schemas a type declares, as far as this rule needs them. */
interface DeclaredField {
  readonly type?: unknown;
  readonly key?: unknown;
}

/** One transaction type, as far as this rule needs it. */
export interface TypeWithFields {
  readonly attributes: { readonly 'field-schemas'?: readonly unknown[] | null };
}

/** The keys some type declares and none declares as a string, sorted. */
export function nonPersonalTransactionFields(types: readonly TypeWithFields[]): string[] {
  const strings = new Set<string>();
  const others = new Set<string>();
  for (const type of types) {
    for (const field of (type.attributes['field-schemas'] ?? []) as readonly DeclaredField[]) {
      if (typeof field.key !== 'string') {
        continue;
      }
      (field.type === 'string' ? strings : others).add(field.key);
    }
  }
  return [...others].filter((key) => !strings.has(key)).sort();
}

const FIELD_FILTER = /^filter\[fields\.([a-z][a-z0-9_]{0,63})\]$/u;

/**
 * The `transactionStringFields` option of `savedViewPiiFilterKeys` for `filters`: every field key
 * they filter on that is not known to be non-personal. `undefined` (every field filter personal)
 * when the non-personal keys could not be told.
 */
export function transactionStringFieldsFor(
  filters: Readonly<Record<string, unknown>>,
  nonPersonal: readonly string[] | null | undefined,
): { transactionStringFields?: ReadonlySet<string> } {
  if (nonPersonal === null || nonPersonal === undefined) {
    return {};
  }
  const known = new Set(nonPersonal);
  const personal = Object.keys(filters)
    .map((key) => FIELD_FILTER.exec(key)?.[1])
    .filter((field): field is string => field !== undefined && !known.has(field));
  return { transactionStringFields: new Set(personal) };
}
