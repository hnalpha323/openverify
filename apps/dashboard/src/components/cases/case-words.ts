/**
 * The case console in words (Workflow 8C, C142.1): every case problem code, the publish codes of a
 * template version, and the vocabularies the console shows (status categories, SLA states, bulk
 * actions and outcomes, exports, notifications, assignment, calendars). The API titles a problem with
 * its HTTP status, so a refused case action is titled with these words instead; a refusal with no
 * code keeps the API's own words, and no code is invented for it. A null or unknown value reads with
 * its reason, never as "no" or "clean" (ADR 0002).
 */
import { CASE_PROBLEM_CODES, type CaseProblemCode } from '@openverify/contracts';
import {
  CASE_TRANSITION_MAP_PROBLEMS,
  type CaseAssignmentDistribution,
  type CaseAssignmentSort,
  type CaseAttachmentType,
  type CaseBulkAction,
  type CaseBulkOutcome,
  type CaseBulkStatus,
  type CaseExportStatus,
  type CaseHeldObjectType,
  type CaseLayoutModule,
  type UserNotificationKind,
  type CaseSlaOnReopen,
  type CaseSlaStartsOn,
  type CaseSlaState,
  type CaseStatusCategory,
  type CaseTransitionMapProblemCode,
  type CaseWeekday,
} from '@openverify/core';
import type { DisplayProblem } from '../../lib/action-state';

export const CASE_PROBLEM_WORDS: Readonly<Record<CaseProblemCode, string>> = Object.freeze({
  case_transition_refused:
    'The template does not allow a case to move from its status to that one.',
  case_comment_required: 'That status needs a comment.',
  case_status_tag_required: 'That status needs one of its status tags.',
  case_resolution_invalid: 'That resolution is not one of the template’s resolutions.',
  case_objects_limit: 'A case holds at most 1,000 objects.',
  object_type_unsupported: 'A case cannot hold an object of that kind.',
  object_already_attached: 'The case holds that object already.',
  case_attachment_limit: 'The case has as many attachments as its template allows.',
  attachment_type_refused: 'An attachment must be a JPEG, PNG, WebP or PDF file.',
  attachment_infected: 'The scanner found malware in the attachment, so it is never served.',
  attachment_scan_pending: 'The attachment has not been scanned yet.',
  case_assignee_ineligible:
    'That person cannot take the case: they must be active, hold cases:write and see the template.',
  case_version_conflict: 'The case changed since you opened it. Reload it and try again.',
  sla_out_of_range: 'That SLA cannot be reached in time, or is outside 1 second to 90 days.',
  calendar_invalid: 'The calendar cannot be saved.',
  export_too_large: 'An export takes at most 10,000 cases: narrow the filter.',
  case_redacted: 'The case was redacted, so it can no longer change.',
  case_template_archived: 'The template is archived, so it takes no new case.',
  case_template_not_published: 'The template has no published version yet.',
  case_template_version_not_draft: 'Only a draft version can change; this one is published.',
  case_template_key_taken: 'Another template of this environment has that key.',
  case_bulk_too_large: 'A bulk action takes at most 500 cases: narrow the selection.',
  rendition_unavailable: 'A viewable copy of the attachment could not be made.',
  // C172 (Workflow 9B): the case completions.
  case_checklist_incomplete: 'Check every item that status requires before moving the case there.',
  case_fields_required: 'Fill in every field that status requires before moving the case there.',
  case_action_not_available: 'That action is not available for this case or for your role.',
  attachment_scan_failed: 'The attachment could not be scanned, so it is never served.',
  case_search_invalid: 'The search cannot be run: see each problem.',
  case_template_invalid: 'This version cannot be published: see each problem.',
});

const CODES: ReadonlySet<string> = new Set(CASE_PROBLEM_CODES);

/** Whether `code` is a case problem's code. */
export const isCaseProblemCode = (code: string | null | undefined): code is CaseProblemCode =>
  typeof code === 'string' && CODES.has(code);

/** `problem`, titled in words when its `code` is a case problem's; anything else as is. */
export function describeCaseProblem(problem: DisplayProblem): DisplayProblem {
  return isCaseProblemCode(problem.code)
    ? { ...problem, title: CASE_PROBLEM_WORDS[problem.code] }
    : problem;
}

/** The publish codes of a version's transition map (C131.1), in words. */
export const TRANSITION_MAP_WORDS: Readonly<Record<CaseTransitionMapProblemCode, string>> =
  Object.freeze({
    initial_status_count: 'A version needs exactly one initial status.',
    end_status_missing: 'A version needs at least one end status.',
    status_repeated: 'Two statuses share this key.',
    transition_status_unknown: 'The map names a status the version does not hold.',
    transition_to_itself: 'A status cannot move to itself.',
    transition_repeated: 'This move is listed twice.',
    end_status_unreachable: 'No path of moves reaches this end status from the initial status.',
  });

/** The other codes a refused publish carries per place (C130.2, C130.3). */
const FIELD_PUBLISH_WORDS: Readonly<Record<string, string>> = Object.freeze({
  field_schema_invalid:
    'This field breaks a rule of the field schemas. A case field is never a file (attachments carry files) or JSON.',
  field_type_changed: 'A field key keeps its type in every version of a template.',
  card_number_refused: 'A value looks like a payment card number, which a case field refuses.',
  relation_target_unsupported: 'A case field cannot name that kind of document.',
});

const TRANSITION_CODES: ReadonlySet<string> = new Set(CASE_TRANSITION_MAP_PROBLEMS);

/** A publish error's code in words, or `undefined` for a code the console does not know. */
export function publishCodeWords(code: string): string | undefined {
  if (TRANSITION_CODES.has(code)) {
    return TRANSITION_MAP_WORDS[code as CaseTransitionMapProblemCode];
  }
  return FIELD_PUBLISH_WORDS[code];
}

export const STATUS_CATEGORY_WORDS: Readonly<Record<CaseStatusCategory, string>> = Object.freeze({
  initial: 'Initial',
  intermediate: 'In progress',
  end: 'End',
});

export const SLA_STATE_WORDS: Readonly<Record<CaseSlaState, string>> = Object.freeze({
  none: 'No SLA set',
  running: 'Running',
  paused: 'Paused',
  met: 'Met',
  expired: 'Expired',
});

export const BULK_ACTION_WORDS: Readonly<Record<CaseBulkAction, string>> = Object.freeze({
  assign: 'Assign',
  'set-status': 'Set the status',
  'set-queue': 'Move to a queue',
  'add-tags': 'Add tags',
  'remove-tags': 'Remove tags',
});

export const BULK_OUTCOME_WORDS: Readonly<Record<CaseBulkOutcome, string>> = Object.freeze({
  applied: 'Applied',
  no_change: 'No change: the case already was so',
  refused: 'Refused',
});

export const BULK_STATUS_WORDS: Readonly<Record<CaseBulkStatus, string>> = Object.freeze({
  pending: 'Waiting to start: the outcomes are not known yet',
  running: 'Running: the outcomes are not known yet',
  completed: 'Done',
});

/** A refused case's reason: the problem's code in words, or the API's code when it has no words. */
export function bulkRefusalWords(code: string | null): string {
  if (code === null) {
    return 'Refused, for a reason the API did not name';
  }
  if (isCaseProblemCode(code)) {
    return CASE_PROBLEM_WORDS[code];
  }
  const generic: Readonly<Record<string, string>> = {
    not_found: 'Not found, or not visible to you',
    forbidden: 'Your role does not allow this change',
    conflict: 'The case changed meanwhile',
    gone: 'The case was redacted',
    unprocessable: 'The change does not fit the case',
  };
  return generic[code] ?? `Refused (${code})`;
}

export const EXPORT_STATUS_WORDS: Readonly<Record<CaseExportStatus, string>> = Object.freeze({
  pending: 'Waiting to start',
  running: 'Being written',
  completed: 'Ready to download',
  failed: 'Failed',
  expired: 'Expired: the file was deleted',
});

export const NOTIFICATION_KIND_WORDS: Readonly<Record<UserNotificationKind, string>> =
  Object.freeze({
    assigned: 'A case was assigned to you',
    'sla-breached': 'A case of yours passed its SLA deadline',
    mentioned: 'You were mentioned in a comment',
    // C169.7 (Workflow 9B): it counts failed first attempts in the alert's window.
    'webhook-failure': 'A webhook failed more first attempts than its alert allows',
  });

export const DISTRIBUTION_WORDS: Readonly<Record<CaseAssignmentDistribution, string>> =
  Object.freeze({
    'round-robin': 'Round robin: each eligible agent in turn',
    'fewest-open': 'Fewest open: the eligible agent with the fewest open cases',
    'case-creator': 'Case creator: whoever created the case, when eligible',
    'inquiry-creator': 'Inquiry creator: whoever created its first inquiry, when eligible',
  });

export const SORT_WORDS: Readonly<Record<CaseAssignmentSort, string>> = Object.freeze({
  'created-at': 'Oldest first',
  'sla-expires-at': 'Nearest SLA deadline first',
});

export const SLA_STARTS_ON_WORDS: Readonly<Record<CaseSlaStartsOn, string>> = Object.freeze({
  created: 'When the case is created',
  'entered-queue': 'When the case enters a queue',
  assigned: 'When the case is assigned',
});

export const ON_REOPEN_WORDS: Readonly<Record<CaseSlaOnReopen, string>> = Object.freeze({
  continue: 'Continue: the time already used counts',
  restart: 'Restart: the full target again',
});

export const LAYOUT_MODULE_WORDS: Readonly<Record<CaseLayoutModule, string>> = Object.freeze({
  'held-objects': 'Held objects',
  reports: 'Reports',
  'report-runs': 'Report runs',
  transactions: 'Transactions',
  'list-matches': 'List matches',
  graph: 'Graph',
  signals: 'Signals',
  device: 'Device',
  location: 'Location',
  timeline: 'Timeline',
  comments: 'Comments',
  attachments: 'Attachments',
  'case-actions': 'Case actions',
});

export const HELD_OBJECT_TYPE_WORDS: Readonly<Record<CaseHeldObjectType, string>> = Object.freeze({
  account: 'Accounts',
  inquiry: 'Inquiries',
  report: 'Reports',
  'report-run': 'Report runs',
  transaction: 'Transactions',
  verification: 'Verifications',
  'graph-query': 'Graph queries',
  document: 'Documents',
});

export const ATTACHMENT_TYPE_WORDS: Readonly<Record<CaseAttachmentType, string>> = Object.freeze({
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  pdf: 'PDF',
});

export const WEEKDAY_WORDS: Readonly<Record<CaseWeekday, string>> = Object.freeze({
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
});

/** "1 case" or "3 cases". */
export const casesCount = (count: number): string =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? 'case' : 'cases'}`;

/** C132.2: who a policy assigns to, in words. */
export const agentsWords = (agents: readonly string[] | null): string =>
  agents === null
    ? 'The members of the queue a case is in'
    : `${String(agents.length)} named ${agents.length === 1 ? 'agent' : 'agents'}`;

/** C132.2: how many open cases each agent takes, in words. */
export const capacityWords = (capacity: number | null): string =>
  capacity === null ? 'Each member’s own limit' : `At most ${String(capacity)} open cases each`;

/** C132.1: a queue's members, with how many are paused. */
export function membersWords(members: readonly { readonly paused: boolean }[]): string {
  if (members.length === 0) {
    return 'No members';
  }
  const paused = members.filter((member) => member.paused).length;
  const total = `${String(members.length)} ${members.length === 1 ? 'member' : 'members'}`;
  return paused === 0 ? total : `${total}, ${String(paused)} paused`;
}

const hoursAndMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    ...(hours > 0
      ? [`${hours.toLocaleString('en-GB')} business ${hours === 1 ? 'hour' : 'hours'}`]
      : []),
    ...(rest > 0 ? [`${String(rest)} ${rest === 1 ? 'minute' : 'minutes'}`] : []),
  ];
  return parts.join(' ');
};

/** C133.1: an SLA target in business time, "4 business hours (240 minutes)". */
export const targetWords = (minutes: number): string =>
  minutes < 60
    ? `${String(minutes)} business ${minutes === 1 ? 'minute' : 'minutes'}`
    : `${hoursAndMinutes(minutes)} (${minutes.toLocaleString('en-GB')} minutes)`;

const minutesOf = (time: string): number => {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

/** C133.2: a week's business time, "40 business hours a week". */
export function weekWords(
  week: Readonly<Record<CaseWeekday, readonly { readonly start: string; readonly end: string }[]>>,
): string {
  const total = Object.values(week)
    .flat()
    .reduce((sum, { start, end }) => sum + minutesOf(end) - minutesOf(start), 0);
  return `${total % 60 === 0 ? String(total / 60) : (total / 60).toFixed(1)} business hours a week`;
}

/** One day's intervals as the week editor writes them: "09:00-12:00, 13:00-17:00". */
export const intervalsText = (
  intervals: readonly { readonly start: string; readonly end: string }[],
) => intervals.map(({ start, end }) => `${start}-${end}`).join(', ');

/** C133.2: what a refused row of a holiday import means, by its code; never its value. */
export const HOLIDAY_ROW_WORDS: Readonly<Record<string, string>> = Object.freeze({
  invalid_value:
    'the date or the label is not valid (a real date, YYYY-MM-DD, and a label of 1 to 80 characters).',
  date_repeated: 'the date is already in this file.',
  field_count_mismatch: 'the row has more or fewer cells than the header.',
  record_too_large: 'the row is longer than a holiday row may be.',
});

/** C133.2: why a whole holiday file was refused, by its code. */
export const HOLIDAY_FILE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  invalid_encoding: 'The file is not UTF-8 text.',
  missing_column: 'The header needs a date column and a label column: date,label.',
  unknown_column: 'The header has a column other than date and label.',
  duplicate_column: 'The header names a column twice.',
  row_limit_exceeded: 'The file has more rows than a calendar keeps holidays (500).',
});

/** "Row 3: the date is already in this file." */
export const holidayRowWords = (row: number, code: string): string =>
  `Row ${String(row)}: ${HOLIDAY_ROW_WORDS[code] ?? `refused (${code}).`}`;

/** C138.1: why an export failed, by its code, in words. */
export function exportFailureWords(code: string | null): string {
  if (isCaseProblemCode(code)) {
    return CASE_PROBLEM_WORDS[code];
  }
  return code === 'export_failed'
    ? 'The export job failed. Ask for the export again.'
    : `The export failed${code === null ? '' : ` (${code})`}.`;
}

/** A file's size in words: "4 KB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} bytes`;
  }
  if (bytes < 1024 * 1024) {
    return `${String(Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
