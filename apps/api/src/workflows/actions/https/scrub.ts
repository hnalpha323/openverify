/**
 * C125.5: before an output, an error message or a test-run log line is stored, every occurrence of a
 * value resolved in that step, and of its base64, base64url and percent-encoded forms, reads
 * `[REDACTED]`. The same goes for one-time-link tokens (P32). A value inside something else that was
 * encoded (a Basic header's `user:secret`) is not found: `docs/workflows/secrets.md` says so.
 */
import type { JsonValue } from '@openverify/workflow-engine';

export const REDACTED = '[REDACTED]';

export interface Scrubber {
  readonly text: (value: string) => string;
  readonly json: (value: JsonValue) => JsonValue;
}

/** Every written form of `value`. */
function formsOf(value: string): readonly string[] {
  const bytes = Buffer.from(value, 'utf8');
  const base64 = bytes.toString('base64');
  return [
    value,
    base64,
    base64.replace(/={1,2}$/, ''),
    bytes.toString('base64url'),
    encodeURIComponent(value),
    new URLSearchParams({ v: value }).toString().slice(2),
  ];
}

export function createScrubber(values: readonly string[]): Scrubber {
  const forms = [...new Set(values.filter((value) => value !== '').flatMap(formsOf))].sort(
    (left, right) => right.length - left.length,
  );
  const text = (value: string): string =>
    forms.reduce((scrubbed, form) => scrubbed.replaceAll(form, REDACTED), value);
  const json = (value: JsonValue): JsonValue => {
    if (typeof value === 'string') {
      return text(value);
    }
    if (Array.isArray(value)) {
      return value.map(json);
    }
    if (typeof value === 'object' && value !== null) {
      const members: Record<string, JsonValue> = {};
      for (const [name, member] of Object.entries(value)) {
        // A plain definition, so a member named `__proto__` is a member and nothing else.
        Object.defineProperty(members, text(name), {
          value: json(member),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return members;
    }
    return value;
  };
  return { text, json };
}
