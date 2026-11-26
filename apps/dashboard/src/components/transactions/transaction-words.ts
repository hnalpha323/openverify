/**
 * The transactions console in words (C104, C105, C108): every transaction problem code, and the
 * field types. The API titles a problem with its HTTP status, so a refused transaction action is
 * titled with these words instead; `describeTransactionProblem` keeps the API's detail, field
 * errors and request id, except that the two limits (K7B-6) say what to do at their pointers. A
 * refusal with no code keeps the API's own words and pointer, and no code is invented for it.
 */
import { TRANSACTION_PROBLEM_CODES, type TransactionProblemCode } from '@openverify/contracts';
import type { AuditActorType, FieldSchemaType } from '@openverify/contracts';
import { TRANSACTION_LIMITS } from '@openverify/core';
import type { DisplayProblem } from '../../lib/action-state';

/** K7C-2 (K9-1): a relation's target type in words, in the relations list and the relation form. */
export const RELATION_TARGET_WORDS: Readonly<Record<'account' | 'transaction', string>> =
  Object.freeze({ account: 'Account', transaction: 'Transaction' });

/** K7B-4: who moved a status, as the history serves it (no id: the type alone). */
export const STATUS_CHANGE_ACTOR_WORDS: Readonly<Record<AuditActorType, string>> = Object.freeze({
  user: 'An operator',
  'api-key': 'An API key',
  system: 'The system',
  'workflow-run': 'A workflow run',
});

export const TRANSACTION_PROBLEM_WORDS: Readonly<Record<TransactionProblemCode, string>> =
  Object.freeze({
    card_number_refused:
      'A value looks like a payment card number, which is refused: send a processor’s token instead.',
    status_does_not_exist: 'That status is not one of this transaction type’s statuses.',
    field_write_once: 'A write-once field already has a value, which cannot change.',
    field_schema_invalid:
      'A field schema, or a value for one, breaks a rule of the transaction type: see each place below.',
    relation_target_unsupported:
      'A relation field names a document kind no OpenVerify verification produces.',
    relation_schema_unknown: 'The transaction type declares no relation with that key.',
    related_object_not_found: 'An object named is not in this environment, or is of another kind.',
    transaction_type_archived: 'The transaction type is archived, so it takes no new transaction.',
    transaction_type_not_published:
      'The transaction type has no published version, so no transaction can use it yet.',
    transaction_type_version_not_draft: 'Only a draft version can change; this one is published.',
    transaction_redacted: 'The transaction was redacted, so it can no longer change.',
    transaction_file_too_large: 'The file is larger than the field allows.',
    transaction_file_refused:
      'The file is smaller than the field allows, of a type it does not accept, or has the wrong page count.',
    platform_file_not_allowed: 'You cannot read that platform file, so you cannot attach it.',
    relation_cardinality_exceeded: 'This relation already has its one target.',
    related_objects_limit: 'This transaction is at its limit of related objects.',
  });

/** K7B-6: what to do about a limit, at the problem's pointer, in place of the API's short note. */
const LIMIT_POINTER_WORDS: Readonly<Partial<Record<TransactionProblemCode, string>>> =
  Object.freeze({
    relation_cardinality_exceeded: 'Remove the current target first.',
    related_objects_limit: `At most ${String(TRANSACTION_LIMITS.relatedObjects)} related objects: detach one first.`,
  });

const CODES: ReadonlySet<string> = new Set(TRANSACTION_PROBLEM_CODES);

/** `problem`, titled in words when its `code` is a transaction problem's; anything else as is. */
export function describeTransactionProblem(problem: DisplayProblem): DisplayProblem {
  if (problem.code === undefined || !CODES.has(problem.code)) {
    return problem;
  }
  const code = problem.code as TransactionProblemCode;
  const pointerWords = LIMIT_POINTER_WORDS[code];
  return {
    ...problem,
    title: TRANSACTION_PROBLEM_WORDS[code],
    ...(pointerWords === undefined || problem.errors === undefined
      ? {}
      : { errors: problem.errors.map((error) => ({ ...error, detail: pointerWords })) }),
  };
}

/** The fifteen field types (C104.2) in words. */
export const FIELD_TYPE_LABELS: Readonly<Record<FieldSchemaType, string>> = Object.freeze({
  string: 'Text',
  integer: 'Integer',
  number: 'Number',
  boolean: 'Yes or no',
  datetime: 'Date and time',
  'email-address': 'Email address',
  date: 'Date',
  choices: 'Choice',
  'multi-choices': 'Choices',
  array: 'List',
  hash: 'Group of fields',
  file: 'File',
  'platform-file': 'Platform file',
  json: 'JSON',
  'relation-schema': 'Verification',
});
