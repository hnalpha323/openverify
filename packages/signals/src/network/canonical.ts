/**
 * Canonical JSON (C92.3): object members sorted by key at every depth, no whitespace, so one value
 * always gives one byte sequence, and its SHA-256 names it.
 */

/**
 * The canonical JSON text of a JSON value.
 * @throws {TypeError} for a value JSON cannot hold (undefined, a function, a bigint, a non-finite
 * number).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonical JSON holds finite numbers only');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`canonical JSON cannot hold a ${typeof value}`);
}
