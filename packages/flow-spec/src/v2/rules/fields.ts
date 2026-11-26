/** C149.2: field keys keep their type across versions, and a version holds at most 1,000. */
import type { FlowProblem } from '../schemas/problems.js';

/** The public cap on a template's fields (C149.2), the inquiry's `MAX_INQUIRY_FIELDS` too. */
export const MAX_FIELD_SCHEMAS = 1000;

export function checkFieldSchemaChanges(
  fields: readonly { readonly key: string; readonly type: string }[],
  published: readonly (readonly { readonly key: string; readonly type: string }[])[],
): FlowProblem[] {
  const problems: FlowProblem[] = [];
  if (fields.length > MAX_FIELD_SCHEMAS) {
    problems.push({
      pointer: '',
      code: 'fields_too_many',
      detail: `A version declares at most ${String(MAX_FIELD_SCHEMAS)} fields`,
      severity: 'error',
    });
  }
  // The first version that published a key fixes its type.
  const fixed = new Map<string, string>();
  for (const version of published) {
    for (const field of version) if (!fixed.has(field.key)) fixed.set(field.key, field.type);
  }
  fields.forEach((field, index) => {
    const type = fixed.get(field.key);
    if (type !== undefined && type !== field.type) {
      problems.push({
        pointer: `/${String(index)}/type`,
        code: 'field_type_changed',
        detail: `Field "${field.key}" was published as ${type} and keeps that type`,
        severity: 'error',
      });
    }
  });
  return problems;
}
