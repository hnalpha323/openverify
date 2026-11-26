/**
 * C104.3 (Workflow 7B; P22): the one JSON Schema a version holds, a `json` field's `json-schema`,
 * compiled by ajv on the server with `strict: true` and `allErrors: false`, once per distinct
 * schema (K7C-R009: one Ajv per process, validators cached by digest under a bound). The engine's allowlist (`jsonSchemaKeywordProblems`) runs first; ajv's strict mode then
 * refuses shapes the allowlist passes (a `required` name with no property, a number keyword without
 * its type), and a schema ajv refuses answers `field_schema_invalid` at its pointer, never a 500.
 * No remote schema is ever loaded: the instance has no `loadSchema`, and `$ref` is refused before.
 */
import { createHash } from 'node:crypto';
import { jsonFieldSchemasOf, type FieldProblem, type FieldSchema } from '@openverify/core';
import { canonicalJson } from '@openverify/flow-spec';
import { Ajv, type ValidateFunction } from 'ajv';

/**
 * K7C-R009 (Workflow 11B): the one Ajv instance of the process, with C104.3's options. A schema is
 * compiled once and kept by the SHA-256 of its canonical JSON, so a draft that changes is a new
 * digest and the same schema in another version or field reuses its validator.
 */
const ajv = new Ajv({ strict: true, allErrors: false });

/**
 * Compiled validators by digest, least recently used first: at most this many (ours,
 * provisional; a bound on memory, about one validator per distinct `json` schema in use).
 */
const MAX_COMPILED = 512;

interface Compiled {
  /** The copy ajv compiled, which is also its own cache's key (removed with the entry). */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly validate: ValidateFunction;
}

const compiled = new Map<string, Compiled>();
let compiles = 0;

/** K7C-R009: the cache's bound, for the tests. */
export const JSON_SCHEMA_CACHE_LIMIT = MAX_COMPILED;

/** K7C-R009: how many schemas ajv compiled in this process, and how many are cached now. */
export function jsonSchemaCompilerState(): { compiles: number; cached: number } {
  return { compiles, cached: compiled.size };
}

/**
 * The validator of `schema`, compiled at most once while it stays cached.
 * @throws whatever ajv throws for a schema strict mode refuses (nothing is kept for it).
 */
function validatorOf(schema: Readonly<Record<string, unknown>>): ValidateFunction {
  const digest = createHash('sha256').update(canonicalJson(schema)).digest('hex');
  const cached = compiled.get(digest);
  if (cached !== undefined) {
    compiled.delete(digest);
    compiled.set(digest, cached);
    return cached.validate;
  }
  const owned = structuredClone(schema);
  let validate: ValidateFunction;
  compiles += 1;
  try {
    validate = ajv.compile(owned);
  } catch (error) {
    ajv.removeSchema(owned);
    throw error;
  }
  compiled.set(digest, { schema: owned, validate });
  if (compiled.size > MAX_COMPILED) {
    const [oldest] = compiled;
    if (oldest !== undefined) {
      compiled.delete(oldest[0]);
      ajv.removeSchema(oldest[1].schema);
    }
  }
  return validate;
}

/**
 * C104.3 at publish: every `json` field's schema compiled; a schema ajv refuses, or a default it
 * does not accept, answers at the schema's pointer (relative to the version's attributes).
 */
export function jsonSchemaCompileProblems(fieldSchemas: readonly FieldSchema[]): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const { pointer, schema, defaultValue } of jsonFieldSchemasOf(fieldSchemas)) {
    let validate: ValidateFunction;
    try {
      // A draft can change: a changed schema is a new digest, compiled once.
      validate = validatorOf(schema);
    } catch {
      problems.push({ code: 'field_schema_invalid', pointer });
      continue;
    }
    if (defaultValue !== undefined && !validate(defaultValue)) {
      problems.push({
        code: 'field_schema_invalid',
        pointer: pointer.replace(/\/config\/json-schema$/, '/default-value'),
      });
    }
  }
  return problems;
}

/**
 * C104.3 on a write: each `json` value the engine accepted, checked by the compiled schema at its
 * pointer in the published version. A value it refuses answers at the field (the engine's rule: a
 * key a request made up can hold a value, so no deeper pointer is given). The version id is kept for
 * the callers; the validator is the schema's own (K7C-R009), whichever version holds it.
 */
export function jsonValueProblems(
  versionId: string,
  fieldSchemas: readonly FieldSchema[],
  values: readonly { pointer: string; schemaPointer: string; value: unknown }[],
): FieldProblem[] {
  if (values.length === 0) {
    return [];
  }
  const schemas = new Map(
    jsonFieldSchemasOf(fieldSchemas).map(({ pointer, schema }) => [pointer, schema]),
  );
  const problems: FieldProblem[] = [];
  for (const { pointer, schemaPointer, value } of values) {
    const schema = schemas.get(schemaPointer);
    if (schema === undefined || !validatorOf(schema)(value)) {
      problems.push({ code: 'field_schema_invalid', pointer });
    }
  }
  return problems;
}
