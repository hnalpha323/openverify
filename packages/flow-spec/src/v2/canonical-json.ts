/**
 * RFC 8785 (JSON Canonicalization Scheme), the form `flow-sha256` hashes (C147.7, Phase 8
 * C113.7): members sorted by their UTF-16 code units at every depth, no whitespace, numbers and
 * strings written as ECMAScript's `JSON.stringify` writes them (RFC 8785 §3.2.2 adopts exactly that
 * serialisation, lower-case `\u` escapes included). A value JSON cannot hold (a non-finite number,
 * a bigint, a function, a symbol) is refused, never coerced.
 */
function write(value: unknown, out: string[]): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    out.push(JSON.stringify(value));
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('RFC 8785 has no non-finite number');
    }
    out.push(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    value.forEach((item: unknown, index) => {
      if (index > 0) out.push(',');
      // JSON writes an absent array member as null.
      write(item === undefined ? null : item, out);
    });
    out.push(']');
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    // The default sort compares UTF-16 code units, which is RFC 8785 §3.2.3's order.
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    out.push('{');
    keys.forEach((key, index) => {
      if (index > 0) out.push(',');
      out.push(JSON.stringify(key), ':');
      write(record[key], out);
    });
    out.push('}');
    return;
  }
  throw new TypeError(`RFC 8785 cannot hold a ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join('');
}
