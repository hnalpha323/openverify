/**
 * C136.4 (Workflow 8B, `api-cases`): a case's fields, on the Phase 7 walker under the pinned
 * version's field schemas. A refusal names a position and never a value (C107.5); a `platform-file`
 * keeps Phase 7's rule (its read scope, and `pii:view` for a face, P12); the card guard is always on
 * for cases (F37). A `searchable` field's value is keyed per template and field (P25).
 */
import { fieldsValidatorOf, type FieldProblem, type FieldSchema } from '@openverify/core';
import { caseFieldValueKey, type CaseTemplateVersionRow, type Db } from '@openverify/db';
import { UnprocessableContentError } from '../../errors.js';
import type { TransactionActing } from '../transactions/acting.js';
import { checkReference, searchableKeysOf, typedFields } from '../transactions/write-checks.js';
import type { CaseActor } from './shared.js';

const FIELDS_POINTER = '/data/attributes/fields';

const DETAILS: Readonly<Record<FieldProblem['code'], string>> = {
  card_number_refused: 'Looks like a card number; a case field never holds one.',
  field_schema_invalid: 'Does not fit its field schema.',
  relation_schema_unknown: 'The template declares no such relation.',
  relation_target_unsupported: 'No producer of this relation target exists.',
  status_does_not_exist: 'No such status.',
};

export const fieldSchemasOf = (version: CaseTemplateVersionRow): readonly FieldSchema[] =>
  version.fieldSchemas as FieldSchema[];

/** What the walker checks an actor's references with (C104.2, P12). */
function referenceActing(acting: CaseActor): TransactionActing {
  const { principal } = acting;
  return {
    ctx: acting.ctx,
    actor: acting.actor,
    mask: acting.mask,
    ...(principal === null
      ? {}
      : { allows: (permission) => principal.permissions.has(permission) }),
  };
}

/**
 * The fields under the pinned version, typed as stored (`{ type, value }`); a `PATCH` is `partial`.
 * @throws {UnprocessableContentError} naming each position at fault, never a value.
 */
export async function validatedCaseFields(
  tx: Db,
  acting: CaseActor,
  version: CaseTemplateVersionRow,
  fields: Readonly<Record<string, unknown>>,
  partial: boolean,
): Promise<Record<string, { type: string; value: unknown }>> {
  const fieldSchemas = fieldSchemasOf(version);
  const walked = fieldsValidatorOf({
    id: version.id,
    fieldSchemas,
    statuses: [],
    relationSchemas: [],
    allowCardLikeStrings: false,
  })(fields, { partial });
  if (walked.problems.length > 0) {
    throw new UnprocessableContentError(
      'The fields do not fit the template.',
      walked.problems.map((problem) => ({
        location: 'body',
        pointer: `${FIELDS_POINTER}${problem.pointer}`,
        detail: DETAILS[problem.code],
        code: problem.code,
      })),
    );
  }
  for (const reference of walked.references) {
    await checkReference(tx, acting.ctx.environmentId, referenceActing(acting), reference);
  }
  return typedFields(walked.values, fieldSchemas);
}

const searchText = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? JSON.stringify(value)
      : null;

/** The text a search value is keyed by: a string as it is, a number or boolean as JSON. */
export const searchValueText = (value: string | number | boolean): string =>
  searchText(value) ?? '';

/** C136.4 (P25): the keys of the searchable fields among the stored `fields`. */
export function caseSearchableKeys(
  key: Uint8Array,
  environmentId: string,
  caseTemplateId: string,
  fieldSchemas: readonly FieldSchema[],
  fields: Readonly<Record<string, unknown>> | null,
): { fieldKey: string; valueKey: string }[] {
  if (fields === null) {
    return [];
  }
  return searchableKeysOf(fieldSchemas).flatMap((fieldKey) => {
    const text = searchText((fields[fieldKey] as { value?: unknown } | undefined)?.value);
    return text === null
      ? []
      : [
          {
            fieldKey,
            valueKey: caseFieldValueKey(key, { environmentId, caseTemplateId, fieldKey, text }),
          },
        ];
  });
}
