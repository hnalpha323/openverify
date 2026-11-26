/**
 * C104.3 (P22): the pure check of a `json` field's schema. It accepts exactly the keywords of
 * `JSON_SCHEMA_ALLOWED_KEYWORDS`, each holding what its keyword means. `api-transactions` compiles
 * what passes with ajv on the server; nothing here compiles or runs a schema.
 */
import type { FieldProblem } from './engine.js';
import { escapePointerToken, isRecord } from './field-tree.js';
import { JSON_SCHEMA_ALLOWED_KEYWORDS, TRANSACTION_LIMITS } from './field-types.js';
import { exceedsJsonBytes, exceedsJsonDepth } from './json-caps.js';

const ALLOWED_KEYWORDS: ReadonlySet<string> = new Set(JSON_SCHEMA_ALLOWED_KEYWORDS);

const JSON_TYPES: ReadonlySet<unknown> = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'null',
]);

const isText = (value: unknown): boolean => typeof value === 'string';
const isBound = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
const isLength = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;

function isTextList(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every(isText) && new Set(value as unknown[]).size === value.length
  );
}

/** What a data keyword may hold; `const` holds anything, and `properties` and `items` are walked. */
const KEYWORD_VALUE: Readonly<Record<string, (value: unknown) => boolean>> = {
  type: (value) => JSON_TYPES.has(value),
  required: isTextList,
  enum: (value) => Array.isArray(value) && value.length > 0,
  minimum: isBound,
  maximum: isBound,
  exclusiveMinimum: isBound,
  exclusiveMaximum: isBound,
  minLength: isLength,
  maxLength: isLength,
  minItems: isLength,
  maxItems: (value) => isLength(value) && Number(value) <= TRANSACTION_LIMITS.arrayItems,
  additionalProperties: (value) => value === false,
  title: isText,
  description: isText,
};

function isArraySchema(schema: Readonly<Record<string, unknown>>): boolean {
  return schema.type === 'array' || 'items' in schema || 'minItems' in schema;
}

function refuse(problems: FieldProblem[], pointer: string): void {
  problems.push({ code: 'field_schema_invalid', pointer });
}

function walkProperties(value: unknown, pointer: string, problems: FieldProblem[]): void {
  if (!isRecord(value)) {
    refuse(problems, pointer);
    return;
  }
  for (const [name, schema] of Object.entries(value)) {
    const memberPointer = `${pointer}/${escapePointerToken(name)}`;
    if (name === '__proto__') {
      refuse(problems, memberPointer);
    } else {
      walkSchema(schema, memberPointer, problems);
    }
  }
}

function walkSchema(schema: unknown, pointer: string, problems: FieldProblem[]): void {
  if (!isRecord(schema)) {
    refuse(problems, pointer);
    return;
  }
  if (isArraySchema(schema) && !('maxItems' in schema)) {
    refuse(problems, pointer);
  }
  for (const [keyword, value] of Object.entries(schema)) {
    const keywordPointer = `${pointer}/${escapePointerToken(keyword)}`;
    if (!ALLOWED_KEYWORDS.has(keyword)) {
      refuse(problems, keywordPointer);
    } else if (keyword === 'properties') {
      walkProperties(value, keywordPointer, problems);
    } else if (keyword === 'items') {
      walkSchema(value, keywordPointer, problems);
    } else if (KEYWORD_VALUE[keyword]?.(value) === false) {
      refuse(problems, keywordPointer);
    }
  }
}

/** C104.3 (P22): the pure allowlist of a `json` field's schema; ajv compiles what passes. */
export function jsonSchemaKeywordProblems(schema: unknown): FieldProblem[] {
  if (
    exceedsJsonDepth(schema, TRANSACTION_LIMITS.jsonSchemaDepth) ||
    exceedsJsonBytes(schema, TRANSACTION_LIMITS.jsonSchemaBytes)
  ) {
    return [{ code: 'field_schema_invalid', pointer: '' }];
  }
  const problems: FieldProblem[] = [];
  walkSchema(schema, '', problems);
  return problems;
}
