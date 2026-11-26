/**
 * C77.3: the canonical JSON both hashes are taken over, frozen in Workflow 6A Stage 1a. Object keys
 * are sorted (JavaScript string order, by UTF-16 code units), strings are normalised to NFC, members
 * whose value is `undefined` are left out, `null` is kept, arrays keep their order and nothing adds
 * whitespace. Set-like lists are sorted by the hash projections ({@link setLike}), not here.
 */

/** A JSON value with NFC strings, sorted keys and no `undefined` members. */
function normalised(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }
  if (Array.isArray(value)) {
    return value.map(normalised);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .map(([key, member]) => [key.normalize('NFC'), normalised(member)] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

/** The canonical JSON text of a value (C77.3). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalised(value));
}

/**
 * A set-like list in canonical order: each item's canonical JSON, duplicates dropped, sorted by
 * UTF-16 code units, so a publisher reordering aliases or programmes changes no hash.
 */
export function setLike(items: readonly unknown[]): unknown[] {
  const byText = new Map(items.map((item) => [canonicalJson(item), item] as const));
  return [...byText.keys()].sort().map((key) => JSON.parse(key) as unknown);
}
