/** C104.3 (P22): the size and depth of a JSON document, for the schema and for a `json` value. */

const encoder = new TextEncoder();

/** Whether containers nest deeper than `limit`. It stops there, so it cannot overflow the stack. */
export function exceedsJsonDepth(value: unknown, limit: number): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (limit === 0) {
    return true;
  }
  const members: unknown[] = Array.isArray(value) ? value : Object.values(value);
  return members.some((member) => exceedsJsonDepth(member, limit - 1));
}

/** Whether the JSON text of `value` is longer than `limit` bytes of UTF-8. Check the depth first. */
export function exceedsJsonBytes(value: unknown, limit: number): boolean {
  const text = JSON.stringify(value) as string | undefined;
  // A UTF-8 character takes at most 3 bytes per UTF-16 unit, so most texts need no encoding.
  return text !== undefined && text.length * 3 > limit && encoder.encode(text).length > limit;
}
