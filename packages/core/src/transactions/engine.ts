/**
 * C104.2-C104.5 (Workflow 7B Stage 2, owner `transaction-schemas`): the pure engine: the field
 * schemas' rules across a version, the validator built by walking them (cached by version id), the
 * card-number guard at every position, the status and relation-schema rules, the version diff that
 * yields `deleted-field` and `converted-field`, and the keyword allowlist of a `json` field's
 * schema. It generates no code; only `api-transactions` compiles a `json` schema, with ajv.
 *
 * This module holds the engine's types and re-exports its functions, one file per concern.
 */
import type { FieldSchema, RelationSchema } from './field-schemas.js';
import type { RelationSchemaTarget } from './field-types.js';

export { isCardLike, transactionTextProblems } from './card-guard.js';
export { fieldsValidatorOf } from './fields-validator.js';
export { jsonSchemaKeywordProblems } from './json-schema-allowlist.js';
export {
  jsonFieldSchemasOf,
  readSourceKeyPath,
  transactionRelationProblems,
  transactionStatusProblems,
  transactionTypeVersionDiff,
} from './version-reads.js';
export { transactionTypeVersionProblems } from './version-rules.js';

/** The area this folder holds. */
export const TRANSACTIONS_AREA = 'transactions';

/** The problem codes the engine answers with (`TRANSACTION_PROBLEM_STATUSES` in contracts). */
export type FieldProblemCode =
  | 'field_schema_invalid'
  | 'relation_target_unsupported'
  | 'relation_schema_unknown'
  | 'status_does_not_exist'
  | 'card_number_refused';

/** One refusal, with a JSON Pointer relative to the document it validated. Never a value. */
export interface FieldProblem {
  readonly code: FieldProblemCode;
  readonly pointer: string;
}

/** What a version holds, as the engine reads it. */
export interface TransactionTypeVersionContent {
  /** The cache key of the built validator. */
  readonly id: string;
  readonly fieldSchemas: readonly FieldSchema[];
  readonly statuses: readonly string[];
  readonly relationSchemas: readonly RelationSchema[];
  /** C104.4: lifts the guard for this version's fields, never `reference-id`, tags or labels. */
  readonly allowCardLikeStrings: boolean;
}

/** An id the walk found, which only the API can check: the environment, the scope, the type. */
export type FieldReference =
  | { readonly kind: 'platform-file'; readonly pointer: string; readonly id: string }
  | {
      readonly kind: 'relation-schema';
      readonly pointer: string;
      readonly id: string;
      readonly target: RelationSchemaTarget;
    };

/** A `json` value the walk accepted, for the ajv validator of the schema at `schemaPointer`. */
export interface JsonFieldValue {
  readonly pointer: string;
  readonly schemaPointer: string;
  readonly value: unknown;
}

/** A `json` field's schema in a version, by its pointer, with the field's default if it has one. */
export interface JsonFieldSchema {
  readonly pointer: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly defaultValue: unknown;
}

/** The walk of one request's `fields`: the coerced values, or its problems. */
export interface FieldsValidation {
  readonly values: Readonly<Record<string, unknown>>;
  readonly problems: readonly FieldProblem[];
  /** The `platform-file` and `relation-schema` ids, at any depth. */
  readonly references: readonly FieldReference[];
  /** The `json` values, at any depth. */
  readonly jsonValues: readonly JsonFieldValue[];
}

export interface FieldsValidatorOptions {
  /** A `PATCH`: an absent field stays as it is, so `required` and defaults do not apply. */
  readonly partial?: boolean | undefined;
}

export type FieldsValidator = (
  fields: Readonly<Record<string, unknown>>,
  options?: FieldsValidatorOptions,
) => FieldsValidation;

/** C104.4: the texts the guard always covers; a version's opt-out never reaches them. */
export interface TransactionTexts {
  readonly 'reference-id'?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly label?: string | undefined;
  readonly 'model-version'?: string | undefined;
}

/** C104.6: what a publish changes from the previous version. */
export interface TransactionTypeVersionDiff {
  readonly deletedFields: readonly string[];
  readonly convertedFields: readonly { key: string; from: string; to: string }[];
}
