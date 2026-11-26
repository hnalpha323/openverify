/**
 * The lists console in words (C97-C100, C108): every kind, status, importer status and mode, every
 * importer error code (C100.4: a code, a row and a column, never a value) and every list problem
 * code. The API titles a problem with its HTTP status ("Conflict"), so a refused list action is
 * titled with these words instead; `describeListProblem` keeps the API's detail, field errors and
 * request id. The tests iterate the core and contract vocabularies first.
 */
import { LIST_PROBLEM_CODES, type ListProblemCode } from '@openverify/contracts';
import {
  LIST_KINDS,
  type ImportErrorCode,
  type ImporterMode,
  type ImporterStatus,
  type ListItemStatus,
  type ListKind,
  type ListStatus,
} from '@openverify/core';
import type { DisplayProblem } from '../../lib/action-state';

export const LIST_KIND_LABELS: Readonly<Record<ListKind, string>> = Object.freeze({
  'browser-fingerprint': 'Browser fingerprint',
  'device-fingerprint': 'Device fingerprint',
  country: 'Country',
  'email-address': 'Email address',
  face: 'Face',
  geolocation: 'Geolocation',
  'government-id-number': 'Government ID number',
  field: 'Inquiry field',
  'ip-address': 'IP address',
  name: 'Name',
  'phone-number': 'Phone number',
  'selfie-background': 'Selfie background',
  string: 'String',
});

export const LIST_STATUS_LABELS: Readonly<Record<ListStatus, string>> = Object.freeze({
  active: 'Active',
  archived: 'Archived',
});

/** C97.2: `pending` is "not yet indexed for matching", which only biometric items ever are. */
export const LIST_ITEM_STATUS_LABELS: Readonly<Record<ListItemStatus, string>> = Object.freeze({
  pending: 'Pending (not matched yet)',
  active: 'Active',
  archived: 'Archived',
});

export const IMPORTER_STATUS_LABELS: Readonly<Record<ImporterStatus, string>> = Object.freeze({
  pending: 'Importing',
  ready: 'Imported',
  errored: 'Errored',
});

export const IMPORTER_MODE_LABELS: Readonly<Record<ImporterMode, string>> = Object.freeze({
  'all-or-nothing': 'All or nothing',
  'skip-invalid': 'Skip invalid rows',
});

/** C100.4: what each importer error means; the console never shows the row's value. */
export const IMPORT_ERROR_WORDS: Readonly<Record<ImportErrorCode, string>> = Object.freeze({
  invalid_encoding:
    'The file is not in the encoding given: UTF-8 unless a single-byte encoding was named.',
  missing_column: 'A column this kind of list needs is missing from the header.',
  unknown_column: 'The header has a column this kind of list does not take.',
  duplicate_column: 'The header names a column twice.',
  row_limit_exceeded: 'The file has more than 100,000 rows.',
  record_too_large: 'A row is longer than 4,096 characters.',
  field_count_mismatch: 'A row has more or fewer cells than the header.',
  invalid_value: 'The value is not valid for this kind of list.',
  unparseable_phone: 'The phone number cannot be read, even with the list’s default region.',
  host_bits_set: 'The range has host bits set: give the network address of the range.',
  out_of_range: 'The value is outside its allowed range.',
  unsupported_class: 'The ID class is not one of the government ID classes.',
});

/** Every list problem code, as the operator who met it reads it. */
export const LIST_PROBLEM_WORDS: Readonly<Record<ListProblemCode, string>> = Object.freeze({
  biometric_lists_not_acknowledged:
    'Face and background lists are not acknowledged: an administrator must record the basis for biometric lists in Settings first.',
  consent_not_given:
    'The source inquiry has no biometric matching consent, so its selfie cannot become a list item.',
  kind_not_collected:
    'This environment does not collect values of this list’s kind, so it cannot be screened.',
  list_archived: 'This list is archived, so it takes no new item.',
  list_kind_mismatch: 'The list is of another kind than the item.',
  list_limit_reached:
    'The environment holds its 1,000 active lists, or the list holds its maximum of items.',
  list_item_exists: 'This value is already an active item of the list.',
  list_match_not_open: 'This match was already dismissed.',
  retention_exceeds_consent:
    'Face and background items cannot be kept longer than the face template retention of this environment, which the source consent promises.',
  invalid_value: 'The value is not valid for this kind of list.',
  unparseable_phone: 'The phone number cannot be read, even with the list’s default region.',
  host_bits_set: 'The range has host bits set: give the network address of the range.',
  out_of_range: 'A value is outside its allowed range.',
  unsupported_class: 'The ID class is not one of the government ID classes.',
  report_lists_required: 'A custom list report needs at least one list.',
  report_list_unavailable: 'A pinned list is archived or no longer exists.',
});

const CODES: ReadonlySet<string> = new Set(LIST_PROBLEM_CODES);

/** `problem`, titled in words when its `code` is a list problem's; anything else unchanged. */
export function describeListProblem(problem: DisplayProblem): DisplayProblem {
  if (problem.code === undefined || !CODES.has(problem.code)) {
    return problem;
  }
  return { ...problem, title: LIST_PROBLEM_WORDS[problem.code as ListProblemCode] };
}

const KINDS: ReadonlySet<string> = new Set(LIST_KINDS);

/**
 * The kind of a `list/<kind>`, `list-item/<kind>` or `importer/list-item/<kind>` resource type.
 * @throws {Error} for any other type.
 */
export function kindOfListType(type: string): ListKind {
  const kind = type.slice(type.lastIndexOf('/') + 1);
  if (!KINDS.has(kind)) {
    throw new Error(`not a list resource type: ${type}`);
  }
  return kind as ListKind;
}

/**
 * The largest file the console sends. A server action's body is held under Next.js's default
 * limit of 1 MB; larger files (up to the API's 20 MB) go through the API itself.
 */
export const IMPORT_FILE_MAX_BYTES = 1_000_000;

/**
 * C122.1: a list's purpose in words. Adding an item to a block list is an adverse step: a
 * workflow records it as a decision and gates it like a decline (C128); allow and watch lists are
 * not adverse.
 */
export const LIST_PURPOSE_WORDS = {
  block: 'Block: adding an item is an adverse step, recorded and gated like a decline',
  allow: 'Allow: adding an item is not adverse',
  watch: 'Watch: adding an item is not adverse',
} as const;
