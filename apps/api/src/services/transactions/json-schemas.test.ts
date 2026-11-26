/**
 * K7C-R009 (Phase 7 plan, 7C "Later phases", R009; Workflow 11B ingestion-11b; C252.1 records ajv's
 * code generation from a `json` field schema as an entry point with its caps): one Ajv instance per
 * process, with C104.3's options (`strict: true`, `allErrors: false`), each schema compiled once and
 * cached by its digest under a stated bound. Before, every compile made a new Ajv: a publish built
 * one per `json` field and never cached, and a write built one per version and pointer. The
 * publish-time allowlist (`jsonSchemaKeywordProblems`) and strict mode are unchanged. Every schema
 * and value is synthetic.
 */
import type { FieldSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  JSON_SCHEMA_CACHE_LIMIT,
  jsonSchemaCompileProblems,
  jsonSchemaCompilerState,
  jsonValueProblems,
} from './json-schemas.js';

/** One `json` field whose schema bounds a number at `minimum`. */
const fieldWith = (schema: Record<string, unknown>, key = 'meta'): FieldSchema => ({
  type: 'json',
  key,
  label: 'Meta',
  config: { 'json-schema': schema },
});

/** A schema no earlier test compiled, so each case counts from its own baseline. */
let made = 0;
const freshSchema = (): Record<string, unknown> => {
  made += 1;
  return { type: 'object', properties: { score: { type: 'number', minimum: made } } };
};

const compilesDuring = (run: () => void): number => {
  const before = jsonSchemaCompilerState().compiles;
  run();
  return jsonSchemaCompilerState().compiles - before;
};

describe('the json field schema compiler (K7C-R009)', () => {
  it('compiles one schema once across two publishes', () => {
    const schema = freshSchema();
    const compiles = compilesDuring(() => {
      expect(jsonSchemaCompileProblems([fieldWith(schema)])).toEqual([]);
      expect(jsonSchemaCompileProblems([fieldWith(structuredClone(schema), 'other')])).toEqual([]);
    });
    expect(compiles).toBe(1);
  });

  it('reuses the publish’s compilation for the writes of every version that holds the schema', () => {
    const schema = freshSchema();
    const minimum = made;
    const compiles = compilesDuring(() => {
      jsonSchemaCompileProblems([fieldWith(schema)]);
      for (const versionId of ['txntpv_a', 'txntpv_b']) {
        const problems = jsonValueProblems(
          versionId,
          [fieldWith(schema)],
          [
            {
              pointer: '/fields/meta',
              schemaPointer: '/field-schemas/0/config/json-schema',
              value: { score: minimum - 1 },
            },
            {
              pointer: '/fields/meta',
              schemaPointer: '/field-schemas/0/config/json-schema',
              value: { score: minimum },
            },
          ],
        );
        expect(problems).toEqual([{ code: 'field_schema_invalid', pointer: '/fields/meta' }]);
      }
    });
    expect(compiles).toBe(1);
  });

  it('keeps strict mode: a schema ajv refuses answers at its pointer each time, and is not cached', () => {
    const refused = { type: 'object', required: ['missing'] };
    expect(jsonSchemaCompileProblems([fieldWith(refused)])).toEqual([
      { code: 'field_schema_invalid', pointer: '/field-schemas/0/config/json-schema' },
    ]);
    const cachedBefore = jsonSchemaCompilerState().cached;
    expect(jsonSchemaCompileProblems([fieldWith(refused)])).toEqual([
      { code: 'field_schema_invalid', pointer: '/field-schemas/0/config/json-schema' },
    ]);
    expect(jsonSchemaCompilerState().cached).toBe(cachedBefore);
  });

  it('refuses a default the compiled schema does not accept, at the default', () => {
    const schema = freshSchema();
    const field = { ...fieldWith(schema), 'default-value': { score: made - 1 } } as FieldSchema;
    expect(jsonSchemaCompileProblems([field])).toEqual([
      { code: 'field_schema_invalid', pointer: '/field-schemas/0/default-value' },
    ]);
  });

  it(`stays within its bound of ${String(JSON_SCHEMA_CACHE_LIMIT)}, evicting the least recently used`, () => {
    const first = freshSchema();
    jsonSchemaCompileProblems([fieldWith(first)]);
    for (let index = 0; index < JSON_SCHEMA_CACHE_LIMIT; index += 1) {
      jsonSchemaCompileProblems([fieldWith(freshSchema())]);
    }
    expect(jsonSchemaCompilerState().cached).toBe(JSON_SCHEMA_CACHE_LIMIT);
    // The first schema was the least recently used, so it was evicted and compiles again.
    expect(compilesDuring(() => jsonSchemaCompileProblems([fieldWith(first)]))).toBe(1);
    expect(jsonSchemaCompilerState().cached).toBe(JSON_SCHEMA_CACHE_LIMIT);
  });
});
