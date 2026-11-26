/** Redaction of secrets before storage (contracts C12 and C14). */

/** The value shown in place of a secret: API log bodies, webhook custom header values. */
export const REDACTED_VALUE = '[REDACTED]';

/**
 * Keys whose values API logs never store (C12), at any depth of the query or bodies. `flow-url`
 * is added to the C12 list because the `resume` response's flow URL carries the session token
 * in its fragment.
 */
export const API_LOG_REDACTED_KEYS = Object.freeze([
  'secret',
  'token',
  'session-token',
  'one-time-link',
  'one-time-token',
  'password',
  'code',
  'totp-code',
  'recovery-code',
  'flow-url',
  // C143.5 (Workflow 8A): a workflow secret's value, on the route that sets it.
  'secret-value',
  // C248.3, C248.4 (Workflow 11B): an SSO provider's client secret and the browser binding.
  'client-secret',
  'binding',
] as const);

/**
 * Members whose value is a map of names to secrets (Workflow 2B F009): API logs keep the names
 * and replace every value. A webhook's `custom-headers` carry the receiver's credentials, which
 * C14 stores encrypted and only ever shows as `[REDACTED]`.
 */
export const API_LOG_REDACTED_VALUE_MAPS = Object.freeze(['custom-headers'] as const);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The map with each value redacted; any other non-null value is redacted whole. */
function redactValues(map: unknown): unknown {
  if (map === null) {
    return null;
  }
  return isPlainObject(map)
    ? Object.fromEntries(Object.keys(map).map((name) => [name, REDACTED_VALUE]))
    : REDACTED_VALUE;
}

/**
 * A deep copy of `value` in which the value of every object member named in `keys` is
 * `REDACTED_VALUE`, and every value inside a member named in `maps` too, at any depth. The
 * input is not changed.
 */
export function redactKeys(
  value: unknown,
  keys: readonly string[] = API_LOG_REDACTED_KEYS,
  maps: readonly string[] = API_LOG_REDACTED_VALUE_MAPS,
): unknown {
  const redacted = new Set(keys);
  const redactedMaps = new Set(maps);
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(walk);
    }
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(
        Object.entries(item).map(([key, member]) => [
          key,
          redacted.has(key)
            ? REDACTED_VALUE
            : redactedMaps.has(key)
              ? redactValues(member)
              : walk(member),
        ]),
      );
    }
    return item;
  };
  return walk(value);
}
