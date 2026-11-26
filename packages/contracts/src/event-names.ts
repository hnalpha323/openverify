/**
 * Event names (contracts C5 and C17): `<subject>.<action>`, where the subject is the type of
 * the resource in the event payload. Webhooks subscribe to any of them or to `*`.
 */
import {
  INQUIRY_EVENT_BY_STATUS,
  REPORT_EVENT_NAMES as CORE_REPORT_EVENT_NAMES,
  SELFIE_CAPTURE_EVENT_BY_STATUS,
  VERIFICATION_EVENT_BY_STATUS,
  type InquiryStatus,
  type ReportEventName,
} from '@openverify/core';
import { z } from 'zod';

export { VERIFICATION_EVENT_BY_STATUS, verificationEventForStatus } from '@openverify/core';

/** Events whose payload is an `inquiry`. */
export const INQUIRY_EVENT_NAMES = [
  INQUIRY_EVENT_BY_STATUS.created,
  INQUIRY_EVENT_BY_STATUS.pending,
  INQUIRY_EVENT_BY_STATUS.completed,
  INQUIRY_EVENT_BY_STATUS.failed,
  INQUIRY_EVENT_BY_STATUS.approved,
  INQUIRY_EVENT_BY_STATUS.declined,
  INQUIRY_EVENT_BY_STATUS.needs_review,
  INQUIRY_EVENT_BY_STATUS.expired,
  /** Every status change, with `payload.meta: { from, to }` (C10). */
  'inquiry.transitioned',
  'inquiry.updated-tags',
  'inquiry.redacted',
  /** C128.6 (Workflow 8A): ours, so a reopen never reads as a fresh review. */
  'inquiry.reopened',
] as const;

/** Events whose payload is an `inquiry-session`. */
export const INQUIRY_SESSION_EVENT_NAMES = [
  'inquiry-session.started',
  'inquiry-session.expired',
  'inquiry-session.canceled',
] as const;

/** Events whose payload is a `verification/*`. */
export const VERIFICATION_EVENT_NAMES = [
  VERIFICATION_EVENT_BY_STATUS.initiated,
  VERIFICATION_EVENT_BY_STATUS.submitted,
  VERIFICATION_EVENT_BY_STATUS.passed,
  VERIFICATION_EVENT_BY_STATUS.failed,
  VERIFICATION_EVENT_BY_STATUS.canceled,
  VERIFICATION_EVENT_BY_STATUS.skipped,
] as const;

/** Events whose payload is a `selfie` capture (C40.8), in lifecycle order. */
export const SELFIE_EVENT_NAMES = [
  SELFIE_CAPTURE_EVENT_BY_STATUS.initiated,
  SELFIE_CAPTURE_EVENT_BY_STATUS.submitted,
  SELFIE_CAPTURE_EVENT_BY_STATUS.processed,
  SELFIE_CAPTURE_EVENT_BY_STATUS.errored,
] as const;

/** Events whose payload is an `account`. */
export const ACCOUNT_EVENT_NAMES = [
  'account.created',
  'account.updated-fields',
  'account.updated-tags',
  'account.tag-added',
  'account.tag-removed',
  'account.added-relation',
  'account.removed-relation',
  'account.consolidated',
  'account.consolidated-with',
  'account.archived',
  'account.restored',
  'account.status-updated',
  'account.redacted',
] as const;

/**
 * C70.4 (Phase 6): events whose payload is a `report/<type>`, named `report/<type>.<action>` (the
 * public names, which the events table's name check already allows), in `REPORT_TYPES` order.
 */
export const REPORT_EVENT_NAMES: readonly ReportEventName[] = CORE_REPORT_EVENT_NAMES;

/** C99.3 (Workflow 7B): ours, the one list event; lists and items have none, as in the public API. */
export const LIST_MATCH_EVENT_NAMES = ['list-match.created'] as const;

/** C105.3 (Workflow 7B): events whose payload is a `transaction`. */
export const TRANSACTION_EVENT_NAMES = [
  'transaction.created',
  'transaction.status-updated',
  'transaction.updated-fields',
  'transaction.labeled',
  'transaction.redacted',
  'transaction.added-relation',
  'transaction.removed-relation',
] as const;

/** C104.6 (Workflow 7B): events whose payload is a `transaction-type`. */
export const TRANSACTION_TYPE_EVENT_NAMES = [
  'transaction-type.deleted-field',
  'transaction-type.converted-field',
] as const;

/** C102.5 (Workflow 7B): events whose payload is a `graph-query`. */
export const GRAPH_QUERY_EVENT_NAMES = [
  'graph-query.submitted',
  'graph-query.completed',
  'graph-query.errored',
  'graph-query.cancelled',
  'graph-query.timed-out',
  'graph-query.reran',
] as const;

/** C112.7, C121.5 (Workflow 8A): events whose payload is a `workflow`. */
export const WORKFLOW_EVENT_NAMES = ['workflow.published', 'workflow.paused'] as const;

/** C112.7 (Workflow 8A): public, with no webhook file in the public spec; registered here. */
export const WORKFLOW_VERSION_EVENT_NAMES = ['workflow-version.published'] as const;

/**
 * C112.7 (Workflow 8A): events whose payload is a `workflow-run`; `.canceled` is ours. They never
 * trigger a workflow (C118.8).
 */
export const WORKFLOW_RUN_EVENT_NAMES = [
  'workflow-run.created',
  'workflow-run.resumed',
  'workflow-run.errored',
  'workflow-run.completed',
  'workflow-run.canceled',
] as const;

/** C127.12 (Workflow 8A): ours; a `list/<kind>` with the change in `meta`. */
export const LIST_EVENT_NAMES = ['list.updated'] as const;

/**
 * C129.6 (Workflow 8B): events whose payload is a `case`: the eleven public webhooks, then
 * `case.updated` and `case.print-initiated` from the public events page. `case.agent-reviewed` and
 * `case-message.*` are not emitted (C145).
 */
export const CASE_EVENT_NAMES = [
  'case.created',
  'case.assigned',
  'case.resolved',
  'case.reopened',
  'case.status-updated',
  'case.queue-updated',
  'case.updated-fields',
  'case.updated-tags',
  'case.sla-expired',
  'case.exported',
  'case.redacted',
  'case.updated',
  'case.print-initiated',
] as const;

/** C129.6 (Workflow 8B): the payload is a `case-comment` whose message is `null`. */
export const CASE_COMMENT_EVENT_NAMES = ['case-comment.created'] as const;

/** C129.6 (H29): a field's type never changes, so `case-template.converted-field` is not emitted. */
export const CASE_TEMPLATE_EVENT_NAMES = ['case-template.deleted-field'] as const;

/**
 * C154.8 (Workflow 9A; public names from the events page, which lists no webhook files for them):
 * a draft created and a version published. The payload is the version's summary, never its flow or
 * copy, and the subject resolves through its template for strict webhook filters.
 */
export const INQUIRY_TEMPLATE_VERSION_EVENT_NAMES = [
  'inquiry-template-version.created',
  'inquiry-template-version.published',
] as const;

/** C154.7, C154.8 (Workflow 9A; public): once per publish, the deployment it wrote. */
export const DEPLOYMENT_EVENT_NAMES = ['deployment.completed'] as const;

/**
 * C239.1 (Workflow 11A): events whose payload is a `connect/share-token`, as the receiving side
 * sees it. The four public names first (`outbound-*` in the source environment, `inbound-*` in the
 * destination's); `connect/share-token.ready` is not emitted, because no prefetched copy exists
 * (decision 21). Ours: `.expired` and `.failed` (both sides), `.consent-withdrawn` (the counterparty
 * of a redeemed share) and `.source-redacted` (the destination of a redeemed share whose source was
 * redacted later; advisory only). None carries shared data: the data moves only on redemption.
 */
export const CONNECT_SHARE_TOKEN_EVENT_NAMES = [
  'connect/share-token.outbound-created',
  'connect/share-token.inbound-created',
  'connect/share-token.outbound-redeemed',
  'connect/share-token.inbound-redeemed',
  'connect/share-token.expired',
  'connect/share-token.failed',
  'connect/share-token.consent-withdrawn',
  'connect/share-token.source-redacted',
] as const;

/** C239.1 (Workflow 11A; ours): a `connect/connection`, in every environment of both organisations. */
export const CONNECT_CONNECTION_EVENT_NAMES = [
  'connect/connection.created',
  'connect/connection.activated',
  'connect/connection.deactivated',
  'connect/connection.reactivated',
  'connect/connection.share-policy-changed',
] as const;

/** C239.1 (Workflow 11A; ours): a `consent-record`, in the record's own environment. */
export const CONSENT_RECORD_EVENT_NAMES = [
  'consent-record.created',
  'consent-record.declined',
  'consent-record.withdrawn',
] as const;

/** Every Connect event (C239.1), for the console's `Connect` group. */
export const CONNECT_EVENT_NAMES = [
  ...CONNECT_CONNECTION_EVENT_NAMES,
  ...CONNECT_SHARE_TOKEN_EVENT_NAMES,
  ...CONSENT_RECORD_EVENT_NAMES,
] as const;

/** Every event name: the Phase 1 events first (C5), then those C17 adds, then the reports'. */
export const EVENT_NAMES = [
  INQUIRY_EVENT_BY_STATUS.created,
  INQUIRY_EVENT_BY_STATUS.pending,
  INQUIRY_EVENT_BY_STATUS.completed,
  INQUIRY_EVENT_BY_STATUS.failed,
  VERIFICATION_EVENT_BY_STATUS.initiated,
  VERIFICATION_EVENT_BY_STATUS.submitted,
  VERIFICATION_EVENT_BY_STATUS.passed,
  VERIFICATION_EVENT_BY_STATUS.failed,
  INQUIRY_EVENT_BY_STATUS.approved,
  INQUIRY_EVENT_BY_STATUS.declined,
  INQUIRY_EVENT_BY_STATUS.needs_review,
  INQUIRY_EVENT_BY_STATUS.expired,
  'inquiry.transitioned',
  'inquiry.updated-tags',
  'inquiry.redacted',
  'inquiry.reopened',
  ...INQUIRY_SESSION_EVENT_NAMES,
  VERIFICATION_EVENT_BY_STATUS.canceled,
  VERIFICATION_EVENT_BY_STATUS.skipped,
  ...ACCOUNT_EVENT_NAMES,
  ...SELFIE_EVENT_NAMES,
  ...REPORT_EVENT_NAMES,
  ...LIST_MATCH_EVENT_NAMES,
  ...TRANSACTION_EVENT_NAMES,
  ...TRANSACTION_TYPE_EVENT_NAMES,
  ...GRAPH_QUERY_EVENT_NAMES,
  ...WORKFLOW_EVENT_NAMES,
  ...WORKFLOW_VERSION_EVENT_NAMES,
  ...WORKFLOW_RUN_EVENT_NAMES,
  ...LIST_EVENT_NAMES,
  ...CASE_EVENT_NAMES,
  ...CASE_COMMENT_EVENT_NAMES,
  ...CASE_TEMPLATE_EVENT_NAMES,
  ...INQUIRY_TEMPLATE_VERSION_EVENT_NAMES,
  ...DEPLOYMENT_EVENT_NAMES,
  ...CONNECT_EVENT_NAMES,
] as const;

export const eventNameSchema = z.enum(EVENT_NAMES);
export type EventName = z.infer<typeof eventNameSchema>;

const KNOWN_EVENTS: ReadonlySet<string> = new Set(EVENT_NAMES);

/** Whether `value` is an event name, for example a name read back from storage. */
export function isEventName(value: string): value is EventName {
  return KNOWN_EVENTS.has(value);
}

/** The kind of resource an event's payload carries; `report` covers every `report/<type>`. */
export type EventSubject =
  | 'inquiry'
  | 'inquiry-session'
  | 'verification'
  | 'account'
  | 'selfie'
  | 'report'
  | 'list-match'
  | 'transaction'
  | 'transaction-type'
  | 'graph-query'
  | 'workflow'
  | 'workflow-version'
  | 'workflow-run'
  | 'list'
  | 'case'
  | 'case-comment'
  | 'case-template'
  | 'inquiry-template-version'
  | 'deployment'
  | 'connect/connection'
  | 'connect/share-token'
  | 'consent-record';

const SUBJECTS: ReadonlyMap<string, EventSubject> = new Map([
  ['inquiry', 'inquiry'],
  ['inquiry-session', 'inquiry-session'],
  ['verification', 'verification'],
  ['account', 'account'],
  ['selfie', 'selfie'],
  ['list-match', 'list-match'],
  ['transaction', 'transaction'],
  ['transaction-type', 'transaction-type'],
  ['graph-query', 'graph-query'],
  ['workflow', 'workflow'],
  ['workflow-version', 'workflow-version'],
  ['workflow-run', 'workflow-run'],
  ['list', 'list'],
  ['case', 'case'],
  ['case-comment', 'case-comment'],
  ['case-template', 'case-template'],
  ['inquiry-template-version', 'inquiry-template-version'],
  ['deployment', 'deployment'],
  ['consent-record', 'consent-record'],
]);

/** C239.4: the `connect/` heads, each its own subject, beside `report/`. */
const CONNECT_SUBJECTS: ReadonlySet<string> = new Set([
  'connect/connection',
  'connect/share-token',
]);
const CONNECT_PREFIX = 'connect/';

/**
 * The subject of an event, from the part of its name before the dot: `report` for every
 * `report/<type>.<action>` (C70.4), and the head itself for a `connect/` head (C239.4:
 * `connect/share-token`, `connect/connection`). `consent-record` is flat.
 * @throws {TypeError} for a name outside `EVENT_NAMES`.
 */
export function eventSubject(name: EventName): EventSubject {
  if (!isEventName(name)) {
    throw new TypeError('Not an event name');
  }
  const head = name.slice(0, name.indexOf('.'));
  if (head.startsWith(CONNECT_PREFIX)) {
    if (!CONNECT_SUBJECTS.has(head)) {
      throw new TypeError('Not an event name');
    }
    return head as EventSubject;
  }
  const subject = head.startsWith('report/') ? 'report' : SUBJECTS.get(head);
  if (subject === undefined) {
    throw new TypeError('Not an event name');
  }
  return subject;
}

/** The payload resource type of an event: `report/<type>` for a report event, else its subject. */
export function eventResourceType(name: EventName): string {
  const subject = eventSubject(name);
  return subject === 'report' ? name.slice(0, name.indexOf('.')) : subject;
}

/** The event for an inquiry entering `status`, or `null` for an unknown status. */
export function inquiryEventForStatus(status: InquiryStatus): EventName | null {
  return Object.hasOwn(INQUIRY_EVENT_BY_STATUS, status) ? INQUIRY_EVENT_BY_STATUS[status] : null;
}
