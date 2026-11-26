/**
 * Event names in words (C40.8, C47, C70.4, C108). The console says every event in words on the
 * inquiry timeline and the event pages; the test iterates `EVENT_NAMES`, so an event added to the
 * contracts without words fails it. A name the console does not know is shown by its name.
 */
import { REPORT_EVENT_NAMES, type SELFIE_EVENT_NAMES } from '@openverify/contracts';
import type {
  ReportEventAction,
  ReportEventName,
  ReportResourceType,
  VerificationEventName,
} from '@openverify/core';
import { REPORT_TYPE_LABELS } from './labels';

/**
 * What happened to a verification (Workflow 6B P5-1), after its type on the inquiry timeline
 * ("Government ID verification passed") and after "Verification" on the event pages.
 */
export const VERIFICATION_EVENT_ACTION_WORDS: Readonly<Record<VerificationEventName, string>> =
  Object.freeze({
    'verification.created': 'started',
    'verification.submitted': 'submitted',
    'verification.passed': 'passed',
    'verification.failed': 'failed',
    'verification.canceled': 'canceled',
    'verification.skipped': 'skipped',
  });

export type SelfieEventName = (typeof SELFIE_EVENT_NAMES)[number];

/** What happened to a selfie capture (C40.8). */
export const SELFIE_EVENT_WORDS: Readonly<Record<SelfieEventName, string>> = Object.freeze({
  'selfie.created': 'Selfie capture started',
  'selfie.submitted': 'Selfie capture submitted',
  'selfie.processed': 'Selfie capture processed',
  'selfie.errored': 'Selfie capture errored',
});

/**
 * C70.4: what happened to a report, after its type ("Watchlist report matched"). An errored
 * report was not screened, never "no match" (C69.4).
 */
export const REPORT_EVENT_ACTION_WORDS: Readonly<Record<ReportEventAction, string>> = Object.freeze(
  {
    ready: 'ready',
    errored: 'errored (not screened)',
    matched: 'matched',
    dismissed: 'match dismissed',
    reviewed: 'match reviewed',
    redacted: 'redacted',
  },
);

/** "Watchlist report matched" for `report/watchlist.matched`. */
function reportEventWords(name: ReportEventName): [string, string] {
  const dot = name.lastIndexOf('.');
  const resourceType = name.slice(0, dot) as ReportResourceType;
  const action = name.slice(dot + 1) as ReportEventAction;
  return [name, `${REPORT_TYPE_LABELS[resourceType]} report ${REPORT_EVENT_ACTION_WORDS[action]}`];
}

// A map, so a name such as `constructor` never reaches `Object.prototype`.
const WORDS: ReadonlyMap<string, string> = new Map([
  // C5, C17: inquiries, sessions and accounts (the inquiry timeline keeps its own shorter words).
  ['inquiry.created', 'Inquiry created'],
  ['inquiry.started', 'Inquiry started by the end user'],
  ['inquiry.completed', 'Inquiry completed'],
  ['inquiry.failed', 'Inquiry failed'],
  ['inquiry.approved', 'Inquiry approved'],
  ['inquiry.declined', 'Inquiry declined'],
  ['inquiry.marked-for-review', 'Inquiry marked for review'],
  ['inquiry.expired', 'Inquiry expired'],
  ['inquiry.transitioned', 'Inquiry status changed'],
  ['inquiry.updated-tags', 'Inquiry tags changed'],
  ['inquiry.redacted', 'Inquiry redacted'],
  ['inquiry-session.started', 'Session started'],
  ['inquiry-session.expired', 'Session expired'],
  ['inquiry-session.canceled', 'Session canceled'],
  ['account.created', 'Account created'],
  ['account.updated-fields', 'Account fields changed'],
  ['account.updated-tags', 'Account tags changed'],
  ['account.tag-added', 'Account tag added'],
  ['account.tag-removed', 'Account tag removed'],
  ['account.added-relation', 'Account relation added'],
  ['account.removed-relation', 'Account relation removed'],
  ['account.consolidated', 'Account consolidated into another'],
  ['account.consolidated-with', 'Account received a consolidated account'],
  ['account.archived', 'Account archived'],
  ['account.restored', 'Account restored'],
  ['account.status-updated', 'Account status changed'],
  ['account.redacted', 'Account redacted'],
  ...Object.entries(VERIFICATION_EVENT_ACTION_WORDS).map(([name, action]): [string, string] => [
    name,
    `Verification ${action}`,
  ]),
  ...Object.entries(SELFIE_EVENT_WORDS),
  ...REPORT_EVENT_NAMES.map(reportEventWords),
  // C99.3 (Workflow 7B).
  ['list-match.created', 'List match found'],
  // C105.3, C104.6 (Workflow 7B).
  ['transaction.created', 'Transaction created'],
  ['transaction.status-updated', 'Transaction status updated'],
  ['transaction.updated-fields', 'Transaction fields updated'],
  ['transaction.labeled', 'Transaction labeled'],
  ['transaction.redacted', 'Transaction redacted'],
  ['transaction.added-relation', 'Transaction relation added'],
  ['transaction.removed-relation', 'Transaction relation removed'],
  ['transaction-type.deleted-field', 'Transaction type field deleted'],
  ['transaction-type.converted-field', 'Transaction type field converted'],
  // C102.5 (Workflow 7B).
  ['graph-query.submitted', 'Graph query submitted'],
  ['graph-query.completed', 'Graph query completed'],
  ['graph-query.errored', 'Graph query errored'],
  ['graph-query.cancelled', 'Graph query cancelled'],
  ['graph-query.timed-out', 'Graph query timed out'],
  ['graph-query.reran', 'Graph query run again'],
  // C112.7, C127.12, C128.6 (Workflow 8A).
  ['workflow.published', 'Workflow published'],
  ['workflow.paused', 'Workflow paused'],
  ['workflow-version.published', 'Workflow version published'],
  ['workflow-run.created', 'Workflow run started'],
  ['workflow-run.resumed', 'Workflow run resumed'],
  ['workflow-run.errored', 'Workflow run errored'],
  ['workflow-run.completed', 'Workflow run completed'],
  ['workflow-run.canceled', 'Workflow run canceled'],
  ['list.updated', 'List updated'],
  ['inquiry.reopened', 'Inquiry reopened for review'],
  // C129.6 (Workflow 8B).
  ['case.created', 'Case created'],
  ['case.assigned', 'Case assigned'],
  ['case.resolved', 'Case resolved'],
  ['case.reopened', 'Case reopened'],
  ['case.status-updated', 'Case status changed'],
  ['case.queue-updated', 'Case queue changed'],
  ['case.updated-fields', 'Case fields changed'],
  ['case.updated-tags', 'Case tags changed'],
  ['case.sla-expired', 'Case SLA expired'],
  ['case.exported', 'Case exported'],
  ['case.redacted', 'Case redacted'],
  ['case.updated', 'Case updated'],
  ['case.print-initiated', 'Case printed'],
  ['case-comment.created', 'Case comment added'],
  ['case-template.deleted-field', 'Case template field dropped'],
  // C154.8 (Workflow 9A).
  ['inquiry-template-version.created', 'Template draft created'],
  ['inquiry-template-version.published', 'Template version published'],
  ['deployment.completed', 'Template deployed'],
  // C239.3 (Workflow 11A): Connect. A share token's event carries no shared data.
  ['connect/connection.created', 'Connection created'],
  ['connect/connection.activated', 'Connection activated'],
  ['connect/connection.deactivated', 'Connection deactivated'],
  ['connect/connection.reactivated', 'Connection reactivated, waiting for acceptance'],
  ['connect/connection.share-policy-changed', 'Connection share policy changed'],
  ['connect/share-token.outbound-created', 'Share token created for a partner'],
  ['connect/share-token.inbound-created', 'Share token received from a partner'],
  ['connect/share-token.outbound-redeemed', 'Share token redeemed by the partner'],
  ['connect/share-token.inbound-redeemed', 'Share token redeemed here'],
  ['connect/share-token.expired', 'Share token expired'],
  ['connect/share-token.failed', 'Share token redemption failed'],
  ['connect/share-token.consent-withdrawn', 'Consent withdrawn for a redeemed share'],
  ['connect/share-token.source-redacted', 'Source of a redeemed share redacted'],
  ['consent-record.created', 'Sharing consent recorded'],
  ['consent-record.declined', 'Sharing consent declined'],
  ['consent-record.withdrawn', 'Sharing consent withdrawn'],
]);

/** The words of an event name, or `undefined` for one the console has no words for. */
export function eventWords(name: string): string | undefined {
  return WORDS.get(name);
}
