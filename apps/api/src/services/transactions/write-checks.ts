/**
 * C104.2-C104.5 (Workflow 7B): the checks every transaction write runs before it stores anything,
 * on the engine of `transaction-schemas` (`@openverify/core`). The engine walks the values; what
 * only the API can know is checked here: a `json` value against its compiled schema, a
 * `platform-file` against the environment and the principal's scope (P12), a `relation-schema`
 * value against the environment and the verification's type. Every refusal names a position and
 * never a value.
 */
import {
  RELATION_TARGET_VERIFICATION_TYPES,
  fieldsValidatorOf,
  transactionTextProblems,
  type FieldReference,
  type FieldSchema,
  type TransactionTexts,
} from '@openverify/core';
import {
  getFile,
  getVerification,
  identifierKey,
  type Db,
  type TransactionFieldKey,
  type TransactionTypeVersion,
} from '@openverify/db';
import { TransactionProblemError } from '../../errors.js';
import { fieldError } from '../lists/field-error.js';
import type { TransactionActing } from './acting.js';
import { jsonValueProblems } from './json-schemas.js';
import { throwFieldProblems, versionContent } from './shared.js';

const FIELDS_POINTER = '/data/attributes/fields';

/** Selfie poses and portraits: writing one needs `pii:view` too (P12). */
const FACE_FILE_KINDS: ReadonlySet<string> = new Set([
  'selfie-center',
  'selfie-left',
  'selfie-right',
  'portrait',
  'chip-dg2',
  'chip-portrait',
]);

/** C104.4: the reference, tags and labels, which no version's opt-out reaches. */
export function assertTexts(texts: TransactionTexts, prefix: string): void {
  const problems = transactionTextProblems(texts);
  if (problems.length > 0) {
    throwFieldProblems(problems, prefix, 'A text of this request looks like a card number.');
  }
}

const notFound = (pointer: string, detail: string) =>
  new TransactionProblemError('related_object_not_found', detail, {
    errors: [fieldError(pointer, 'Names nothing this environment holds.')],
  });

/** One `platform-file` or `relation-schema` value the engine found, checked against the environment. */
export async function checkReference(
  tx: Db,
  environmentId: string,
  acting: TransactionActing,
  reference: FieldReference,
): Promise<void> {
  const pointer = `${FIELDS_POINTER}${reference.pointer}`;
  if (reference.kind === 'platform-file') {
    if (acting.allows?.('verifications:read') !== true) {
      throw new TransactionProblemError(
        'platform_file_not_allowed',
        'Writing a platform file needs the scope that reads it (verifications:read).',
        { errors: [fieldError(pointer, 'Needs verifications:read.')] },
      );
    }
    const file = await getFile(tx, environmentId, reference.id);
    if (file === null) {
      throw notFound(pointer, 'A platform file this environment does not hold.');
    }
    if (FACE_FILE_KINDS.has(file.kind) && !acting.mask.visible) {
      throw new TransactionProblemError(
        'platform_file_not_allowed',
        'Writing a selfie or portrait file needs pii:view.',
        { errors: [fieldError(pointer, 'Needs pii:view.')] },
      );
    }
    return;
  }
  const verification = await getVerification(tx, environmentId, reference.id);
  const expected =
    RELATION_TARGET_VERIFICATION_TYPES[
      reference.target as keyof typeof RELATION_TARGET_VERIFICATION_TYPES
    ];
  if (verification?.type !== expected) {
    throw notFound(pointer, 'No verification of this environment of the relation’s type.');
  }
}

/**
 * The values of `fields` under the pinned version, each checked; a `PATCH` is `partial`.
 * @throws {TransactionProblemError} with every problem the engine found, or the first reference
 * that fails.
 */
export async function validatedFields(
  tx: Db,
  environmentId: string,
  acting: TransactionActing,
  version: TransactionTypeVersion,
  fields: Readonly<Record<string, unknown>>,
  partial: boolean,
): Promise<Readonly<Record<string, unknown>>> {
  const content = versionContent(version);
  const walked = fieldsValidatorOf(content)(fields, { partial });
  if (walked.problems.length > 0) {
    throwFieldProblems(walked.problems, FIELDS_POINTER, 'The fields do not fit the type.');
  }
  const json = jsonValueProblems(version.id, content.fieldSchemas, walked.jsonValues);
  if (json.length > 0) {
    throwFieldProblems(json, FIELDS_POINTER, 'A json field does not fit its schema.');
  }
  for (const reference of walked.references) {
    await checkReference(tx, environmentId, acting, reference);
  }
  return walked.values;
}

/** Each top-level value as C105.1 stores it: `{ type, value }`. */
export function typedFields(
  values: Readonly<Record<string, unknown>>,
  fieldSchemas: readonly FieldSchema[],
): Record<string, { type: string; value: unknown }> {
  const types = new Map(fieldSchemas.map((field) => [field.key, field.type]));
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, { type: types.get(key) ?? 'json', value }]),
  );
}

/** The searchable top-level fields of a version. */
export function searchableKeysOf(fieldSchemas: readonly FieldSchema[]): string[] {
  return fieldSchemas
    .filter((field) => field.config?.searchable === true)
    .map((field) => field.key);
}

/**
 * C105.4 (F10): the keyed value of one searchable field: the field key and the value's text, under
 * `identifier-transaction-field`. A string is keyed as stored, and a number or boolean by its JSON
 * text, so `filter[identifier][value]` matches the stored value exactly.
 */
export function fieldValueKey(
  key: Uint8Array,
  environmentId: string,
  fieldKey: string,
  text: string,
): string {
  return identifierKey(key, {
    environmentId,
    kind: 'identifier-transaction-field',
    input: `${fieldKey}|${text}`,
  });
}

const searchText = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? JSON.stringify(value)
      : null;

/** The field keys of the searchable fields among `fields`. */
export function searchableFieldKeys(
  key: Uint8Array,
  environmentId: string,
  fieldSchemas: readonly FieldSchema[],
  fields: Readonly<Record<string, unknown>>,
): TransactionFieldKey[] {
  const keys: TransactionFieldKey[] = [];
  for (const fieldKey of searchableKeysOf(fieldSchemas)) {
    const stored = fields[fieldKey] as { value?: unknown } | undefined;
    const text = searchText(stored?.value);
    if (text !== null) {
      keys.push({ fieldKey, valueKey: fieldValueKey(key, environmentId, fieldKey, text) });
    }
  }
  return keys;
}
