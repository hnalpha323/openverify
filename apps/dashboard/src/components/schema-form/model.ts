/**
 * C153.1: the form model of a template member, on the workflow editor's JSON-Schema form model
 * (Phase 8 8D amendment 20; Phase 7 and 8 outcome 16: one model, never a second). Each member of
 * `z.toJSONSchema()` of a contract schema is one field typed as the editor types it: string as
 * text, integer and number as a number, boolean as Not set, Yes or No, enum as a select, anything
 * else as JSON, an empty control left out. Two template rules sit on top:
 *
 * - a nullable member (`anyOf [X, null]`) is typed by `X`, and says it may be none;
 * - a template member is never a C115 template, so the model runs with `references: false` (no
 *   hint mentions a `{{ path }}`, a number field refuses one: C153.5, a form never offers a value
 *   the contract refuses), and an integer field refuses a fraction before the contract sees it.
 *
 * The contract's own schema stays the judge: `problemsOf` answers its refusals by pointer.
 */
import { z } from 'zod';
import {
  fieldsOf,
  fieldText,
  parseFieldText,
  type FieldParse,
  type FormField,
} from '../workflows/editor/schema-form-model';

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface TemplateField extends FormField {
  /** The member may be `null` (none), beside a value of `schema`. */
  readonly nullable: boolean;
  /** The JSON Schema of the member's value (the non-null branch of a nullable one). */
  readonly schema: JsonSchema;
}

/** A refusal of the contract, at a JSON Pointer inside the member ('' for the member itself). */
export interface MemberProblem {
  readonly pointer: string;
  readonly detail: string;
}

const isRecord = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The JSON Schema of a contract schema, as a request takes it. */
export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
}

/** The non-null branch of `anyOf [X, {type: null}]`, or `null` when the member is not nullable. */
function nonNullBranch(schema: JsonSchema): JsonSchema | null {
  const branches = schema.anyOf;
  if (!Array.isArray(branches) || branches.length !== 2) {
    return null;
  }
  const values = branches.filter(
    (branch): branch is JsonSchema => isRecord(branch) && branch.type !== 'null',
  );
  return values.length === 1 && values[0] !== undefined ? values[0] : null;
}

/** A template member is never a C115 template (request R3, `51755671`). */
const NO_REFERENCES = { references: false } as const;

/** One field per member of an object schema, in its order; none for any other schema. */
export function templateFieldsOf(schema: unknown): readonly TemplateField[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(schema.properties).flatMap(([name, member]) => {
    const memberSchema = isRecord(member) ? member : {};
    const value = nonNullBranch(memberSchema);
    const typed = value ?? memberSchema;
    // `fieldsOf` answers exactly one field for an object with one member.
    return fieldsOf(
      {
        type: 'object',
        properties: { [name]: typed },
        required: required.includes(name) ? [name] : [],
      },
      NO_REFERENCES,
    ).map((base) => ({ ...base, nullable: value !== null, schema: typed }));
  });
}

/** What a field's control shows for a stored value; none (`null`) shows empty. */
export function templateFieldText(field: TemplateField, value: unknown): string {
  return value === null ? '' : fieldText(field, value);
}

/** The value a control's text stands for (`undefined` leaves the member out); never a variable. */
export function parseTemplateFieldText(field: TemplateField, text: string): FieldParse {
  return parseFieldText(field, text, NO_REFERENCES);
}

const pointerOf = (path: readonly PropertyKey[]): string =>
  path.map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');

/** The contract's refusals of `value`, by pointer inside the member, in its issue order. */
export function problemsOf(schema: z.ZodType, value: unknown): readonly MemberProblem[] {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues
        .map((issue) => ({ pointer: pointerOf(issue.path), detail: issue.message }))
        .sort((a, b) => a.pointer.localeCompare(b.pointer));
}
