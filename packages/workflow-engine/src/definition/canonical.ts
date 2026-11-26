/**
 * The canonical form of a definition (plan C113.7): RFC 8785 key ordering, with numbers and strings
 * as ECMAScript's `JSON.stringify` writes them, which is what the RFC specifies. The hash leaves out
 * `layout`, so moving a node is no new behaviour.
 */
import { createHash } from 'node:crypto';
import type { WorkflowDefinition } from '@openverify/contracts';

/** RFC 8785 section 3.2.3: by UTF-16 code units, which is what `<` compares on strings. */
const byCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError('A canonical value holds finite numbers only');
  }
  return JSON.stringify(value);
}

/**
 * C113.7: RFC 8785's canonical text of a JSON value.
 * @throws {TypeError} for anything that is no JSON value.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return canonicalNumber(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
      }
      const members = Object.entries(value as Readonly<Record<string, unknown>>).sort(
        ([left], [right]) => byCodeUnits(left, right),
      );
      const text = members.map(
        ([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`,
      );
      return `{${text.join(',')}}`;
    }
    default:
      throw new TypeError('A canonical value holds JSON values only');
  }
}

/** C113.7: `definition_sha256`, over everything except `layout`, in lower-case hex. */
export function definitionSha256(definition: WorkflowDefinition): string {
  const hashed = Object.fromEntries(
    Object.entries(definition).filter(([member]) => member !== 'layout'),
  );
  return createHash('sha256').update(canonicalJson(hashed), 'utf8').digest('hex');
}
