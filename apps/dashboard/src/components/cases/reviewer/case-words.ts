/**
 * The case page's words (C142.2, C142.7): categories, SLA states with the time left, the timeline's
 * kinds, scan and rendition states, and sizes. Every state is said in words, never by colour alone
 * (1.4.1), and an unknown value is named as it is rather than guessed.
 */
import type {
  CaseAttachment,
  CaseHistoryEntryResource,
  CaseStatusDefinitionResource,
} from '@openverify/contracts';
import type { CaseHeldObjectType, CaseSlaState, CaseStatusCategory } from '@openverify/core';

export const CATEGORY_WORDS: Readonly<Record<CaseStatusCategory, string>> = Object.freeze({
  initial: 'Initial',
  intermediate: 'Intermediate',
  end: 'End',
});

/** A status key as its version labels it, or the key itself for one the version does not hold. */
export function statusLabel(
  statuses: readonly CaseStatusDefinitionResource[] | null,
  key: unknown,
): string {
  if (typeof key !== 'string') {
    return 'none';
  }
  return statuses?.find((status) => status.key === key)?.label ?? key;
}

const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const;

/** A duration in its two largest units: "2 hours 5 minutes", "3 days", "less than a minute". */
export function durationWords(milliseconds: number): string {
  const parts: string[] = [];
  let rest = Math.abs(milliseconds);
  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size);
    if (count > 0 && parts.length < 2) {
      parts.push(`${String(count)} ${unit}${count === 1 ? '' : 's'}`);
      rest -= count * size;
    } else if (parts.length > 0) {
      break;
    }
  }
  return parts.length === 0 ? 'less than a minute' : parts.join(' ');
}

/**
 * C133.4: the SLA in words, with the time left while it runs. A running deadline already passed
 * says so (the sweep has not marked it yet); a paused SLA has no deadline to count down.
 */
export function slaWords(state: CaseSlaState, expiresAt: string | null, now: number): string {
  switch (state) {
    case 'none':
      return 'No SLA';
    case 'paused':
      return 'Paused: the status pauses the deadline';
    case 'met':
      return 'Met before its deadline';
    case 'expired':
      return 'Expired: the deadline passed';
    case 'running': {
      if (expiresAt === null) {
        return 'Running';
      }
      const left = Date.parse(expiresAt) - now;
      return left >= 0
        ? `Running: ${durationWords(left)} left`
        : `Running: ${durationWords(left)} past the deadline`;
    }
  }
}

const HISTORY_WORDS: Readonly<Record<CaseHistoryEntryResource['attributes']['kind'], string>> =
  Object.freeze({
    created: 'Created',
    'status-changed': 'Status changed',
    resolved: 'Resolved',
    reopened: 'Reopened',
    assigned: 'Assigned',
    unassigned: 'Unassigned',
    'queue-changed': 'Queue changed',
    'fields-changed': 'Fields changed',
    'tags-changed': 'Tags changed',
    'comment-added': 'Comment added',
    'comment-redacted': 'Comment redacted',
    'object-attached': 'Object attached',
    'object-removed': 'Object removed',
    'attachment-added': 'Attachment added',
    'attachment-scanned': 'Attachment scanned',
    'sla-started': 'SLA started',
    'sla-paused': 'SLA paused',
    'sla-resumed': 'SLA resumed',
    'sla-recomputed': 'SLA recomputed',
    'sla-met': 'SLA met',
    'sla-expired': 'SLA expired',
    'sla-cleared': 'SLA cleared',
    exported: 'Exported',
    'print-initiated': 'Print started',
    redacted: 'Redacted',
    // C172.2 (Workflow 9B): who checked an item, and when, is in the entry.
    'checklist-item-checked': 'Checklist item checked',
    'checklist-item-unchecked': 'Checklist item unchecked',
  });

/** One timeline entry as a sentence; its keys and ids are PII-free by rule (C131.4). */
export function historySentence(
  entry: CaseHistoryEntryResource,
  statuses: readonly CaseStatusDefinitionResource[] | null,
): string {
  const { kind, from, to } = entry.attributes;
  if (kind === 'status-changed' && to !== null && 'status' in to) {
    return `Status changed from ${statusLabel(statuses, from?.status)} to ${statusLabel(statuses, to.status)}`;
  }
  if (kind === 'assigned' && typeof to?.['assignee-id'] === 'string') {
    return `Assigned to ${to['assignee-id']}`;
  }
  if (kind === 'resolved' && typeof to?.resolution === 'string') {
    return `Resolved: ${to.resolution}`;
  }
  return HISTORY_WORDS[kind];
}

/** The scalar members of an entry's `from` or `to`, as `key: value` text (C131.4). */
export function historyDetails(state: Readonly<Record<string, unknown>> | null): string[] {
  if (state === null) {
    return [];
  }
  return Object.entries(state).flatMap(([key, value]) => {
    if (value === null) {
      return [`${key}: none`];
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [`${key}: ${String(value)}`];
    }
    if (Array.isArray(value) && value.every((each) => typeof each === 'string')) {
      return [`${key}: ${value.join(', ')}`];
    }
    return [];
  });
}

const SCAN_WORDS: Readonly<Record<CaseAttachment['scan-status'], string>> = Object.freeze({
  not_scanned: 'Not scanned: no scanner is configured',
  pending: 'Scan pending',
  clean: 'Clean',
  infected: 'Infected: never served',
  error: 'Scan failed: never served',
});

/**
 * C135.5 (H20): how the attachment was scanned, and by what. The sandbox scanner only knows the
 * EICAR test string, so its verdict says it is no real scan.
 */
export function scanWords(attachment: CaseAttachment): string {
  const words = SCAN_WORDS[attachment['scan-status']];
  return attachment['scan-provider'] === 'sandbox'
    ? `${words}, sandbox scan (not a real scan)`
    : attachment['scan-provider'] === 'clamd'
      ? `${words}, scanned by ClamAV`
      : words;
}

const RENDITION_WORDS: Readonly<Record<CaseAttachment['rendition-status'], string>> = Object.freeze(
  {
    pending: 'Being prepared',
    ready: 'Ready',
    failed: 'Could not be prepared',
    deleted: 'Deleted',
  },
);

export function renditionWords(attachment: CaseAttachment): string {
  const words = RENDITION_WORDS[attachment['rendition-status']];
  const pages = attachment['page-count'];
  return pages === null || attachment['attachment-type'] !== 'pdf'
    ? words
    : `${words}, ${String(pages)} page${pages === 1 ? '' : 's'}`;
}

/** Whether the API would serve the attachment's rendition now (C135.5). */
export function attachmentServed(attachment: CaseAttachment): boolean {
  return (
    (attachment['scan-status'] === 'clean' || attachment['scan-status'] === 'not_scanned') &&
    attachment['rendition-status'] === 'ready'
  );
}

/** A size in bytes, KB or MB (1,000-based, as the upload limit is stated in MiB elsewhere). */
export function sizeWords(bytes: number): string {
  if (bytes < 1_024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KiB`;
  }
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

/** A raw status code in words: `needs_review` reads "needs review". */
export const statusWords = (status: string): string => status.replaceAll(/[_-]/g, ' ');

export const HELD_GROUPS: readonly {
  readonly type: CaseHeldObjectType;
  readonly title: string;
  readonly caption: string;
}[] = Object.freeze([
  { type: 'inquiry', title: 'Inquiries', caption: 'Inquiries held by this case' },
  { type: 'account', title: 'Accounts', caption: 'Accounts held by this case' },
  { type: 'report', title: 'Reports', caption: 'Reports held by this case' },
  { type: 'report-run', title: 'Report runs', caption: 'Report runs held by this case' },
  { type: 'transaction', title: 'Transactions', caption: 'Transactions held by this case' },
  { type: 'verification', title: 'Verifications', caption: 'Verifications held by this case' },
  { type: 'document', title: 'Documents', caption: 'Documents held by this case' },
  { type: 'graph-query', title: 'Graph queries', caption: 'Graph queries held by this case' },
]);
