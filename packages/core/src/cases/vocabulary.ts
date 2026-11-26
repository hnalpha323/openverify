/**
 * The case vocabularies (plan C129-C138): the lists the contracts serve and the tables pin, in
 * `@openverify/core` because `packages/db` reads core alone. The resources themselves live in
 * `@openverify/contracts`.
 *
 * Public values are the public product's (behaviour note, section 3); the rest are ours. Every
 * constant says which it is and where it comes from, and a provisional one can change.
 */
import { z } from 'zod';

const NOTE = 'docs/research/phase8-behaviour.md';
const EDITOR = 'docs/research/phase8-editor-cases.md';

const stated = (value: number, basis: 'public' | 'provisional', source: string) =>
  Object.freeze({ value, basis, source });

/** C130.2 (public, decision 54): what a status means to the lifecycle. */
export const CASE_STATUS_CATEGORIES = ['initial', 'intermediate', 'end'] as const;
export const caseStatusCategorySchema = z.enum(CASE_STATUS_CATEGORIES);
export type CaseStatusCategory = z.infer<typeof caseStatusCategorySchema>;

/** C130.1 (public). */
export const CASE_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export const caseTemplateStatusSchema = z.enum(CASE_TEMPLATE_STATUSES);
export type CaseTemplateStatus = z.infer<typeof caseTemplateStatusSchema>;

/** C130.2 (ours, as Phase 6 report templates and Phase 7 transaction types). */
export const CASE_TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export const caseTemplateVersionStatusSchema = z.enum(CASE_TEMPLATE_VERSION_STATUSES);
export type CaseTemplateVersionStatus = z.infer<typeof caseTemplateVersionStatusSchema>;

/** C129.2: every `*-type` is the public open enum, with an API key wherever a key can act. */
export const CASE_CREATOR_TYPES = ['user', 'api-key', 'workflow-run'] as const;
export const caseCreatorTypeSchema = z.enum(CASE_CREATOR_TYPES);
export type CaseCreatorType = z.infer<typeof caseCreatorTypeSchema>;

export const CASE_ASSIGNER_TYPES = [
  'case-assignment-policy',
  'user',
  'api-key',
  'workflow-run',
] as const;
export const caseAssignerTypeSchema = z.enum(CASE_ASSIGNER_TYPES);
export type CaseAssignerType = z.infer<typeof caseAssignerTypeSchema>;

export const CASE_RESOLVER_TYPES = ['api-key', 'user', 'workflow-run'] as const;
export const caseResolverTypeSchema = z.enum(CASE_RESOLVER_TYPES);
export type CaseResolverType = z.infer<typeof caseResolverTypeSchema>;

export const CASE_UPDATER_TYPES = [
  'api-key',
  'case-assignment-policy',
  'user',
  'workflow-run',
] as const;
export const caseUpdaterTypeSchema = z.enum(CASE_UPDATER_TYPES);
export type CaseUpdaterType = z.infer<typeof caseUpdaterTypeSchema>;

/** C134.1: the public example says `user`; ours add what else can write a comment. */
export const CASE_COMMENTER_TYPES = ['user', 'api-key', 'workflow-run'] as const;
export const caseCommenterTypeSchema = z.enum(CASE_COMMENTER_TYPES);
export type CaseCommenterType = z.infer<typeof caseCommenterTypeSchema>;

/**
 * C136.1 (public `meta.object-ids`): what a case holds. A document is a document verification, as
 * Phase 7 maps them (H31), so both read the `ver` prefix; SARs do not exist here.
 */
export const CASE_HELD_OBJECT_TYPES = [
  'account',
  'inquiry',
  'report',
  'report-run',
  'transaction',
  'verification',
  'graph-query',
  'document',
] as const;
export const caseHeldObjectTypeSchema = z.enum(CASE_HELD_OBJECT_TYPES);
export type CaseHeldObjectType = z.infer<typeof caseHeldObjectTypeSchema>;

export const CASE_HELD_OBJECT_ID_PREFIXES: Readonly<Record<CaseHeldObjectType, string>> =
  Object.freeze({
    account: 'acc',
    inquiry: 'inq',
    report: 'rep',
    'report-run': 'rpr',
    transaction: 'txn',
    verification: 'ver',
    'graph-query': 'grphq',
    document: 'ver',
  });

/** C130.2, C135.2 (decision 62): what an attachment can be, by its magic bytes. */
export const CASE_ATTACHMENT_TYPES = ['jpeg', 'png', 'webp', 'pdf'] as const;
export const caseAttachmentTypeSchema = z.enum(CASE_ATTACHMENT_TYPES);
export type CaseAttachmentType = z.infer<typeof caseAttachmentTypeSchema>;

/** C130.2 (ours): when a version's SLA starts counting. */
export const CASE_SLA_STARTS_ON = ['created', 'entered-queue', 'assigned'] as const;
export const caseSlaStartsOnSchema = z.enum(CASE_SLA_STARTS_ON);
export type CaseSlaStartsOn = z.infer<typeof caseSlaStartsOnSchema>;

/** C130.2, C142.2 (decision 70): the fixed default layout's modules. */
export const CASE_LAYOUT_MODULES = [
  'held-objects',
  'reports',
  'report-runs',
  'transactions',
  'list-matches',
  'graph',
  'signals',
  'device',
  'location',
  'timeline',
  'comments',
  'attachments',
  'case-actions',
] as const;
export const caseLayoutModuleSchema = z.enum(CASE_LAYOUT_MODULES);
export type CaseLayoutModule = z.infer<typeof caseLayoutModuleSchema>;

/**
 * C131.4: the timeline's kinds, a closed list, so a kind can never be a value. History is PII-free by
 * rule: a field change records its keys, a comment or an attachment its id, a status change its keys.
 */
export const CASE_HISTORY_KINDS = [
  'created',
  'status-changed',
  'resolved',
  'reopened',
  'assigned',
  'unassigned',
  'queue-changed',
  'fields-changed',
  'tags-changed',
  'comment-added',
  'comment-redacted',
  'object-attached',
  'object-removed',
  'attachment-added',
  'attachment-scanned',
  'sla-started',
  'sla-paused',
  'sla-resumed',
  'sla-recomputed',
  'sla-met',
  'sla-expired',
  'sla-cleared',
  'exported',
  'print-initiated',
  'redacted',
] as const;
export const caseHistoryKindSchema = z.enum(CASE_HISTORY_KINDS);
export type CaseHistoryKind = z.infer<typeof caseHistoryKindSchema>;

/** C134.4 (public: assigned, SLA breached, mentioned). */
export const CASE_NOTIFICATION_KINDS = ['assigned', 'sla-breached', 'mentioned'] as const;
export const caseNotificationKindSchema = z.enum(CASE_NOTIFICATION_KINDS);
export type CaseNotificationKind = z.infer<typeof caseNotificationKindSchema>;

/**
 * K8-20 (Workflow 8D; C130.2, C134.4, P38): what a link-only email about a case says: each in-app
 * notification's kind, and `created` for a template version's `notify-on-create` (an email only).
 */
export const CASE_NOTIFICATION_EMAIL_KINDS = ['created', ...CASE_NOTIFICATION_KINDS] as const;
export type CaseNotificationEmailKind = (typeof CASE_NOTIFICATION_EMAIL_KINDS)[number];

/** C140.1 (ours): there is no delete route, so an action is retired by archiving it. */
export const CASE_ACTION_STATUSES = ['active', 'archived'] as const;
export const caseActionStatusSchema = z.enum(CASE_ACTION_STATUSES);
export type CaseActionStatus = z.infer<typeof caseActionStatusSchema>;

/**
 * C172.2 (Workflow 9B): the history kinds a checklist writes, PII-free (the item's key and the
 * actor). `case_history_kind_valid` takes them when `foundation-9b` (C) recreates it over
 * `[...CASE_HISTORY_KINDS, ...CASE_CHECKLIST_HISTORY_KINDS]` in migration 0031.
 */
export const CASE_CHECKLIST_HISTORY_KINDS = [
  'checklist-item-checked',
  'checklist-item-unchecked',
] as const;
export type CaseChecklistHistoryKind = (typeof CASE_CHECKLIST_HISTORY_KINDS)[number];

/**
 * C172.5 (Workflow 9B): where an action shows: the header, a layout module (`module:<key>`) or the
 * status switcher. `case_actions`' placement CHECK takes the new forms when `foundation-9b` (C)
 * recreates it in migration 0031; until then the API's placement stays `header`.
 */
export const CASE_ACTION_FIXED_PLACEMENTS = ['header', 'status-switcher'] as const;
export const CASE_ACTION_MODULE_PLACEMENT_PATTERN = /^module:[a-z][a-z0-9-]{0,62}$/;

/** C140.1: the only placement in Phase 8 (C145). */
export const CASE_ACTION_PLACEMENTS = ['header'] as const;
export const caseActionPlacementSchema = z.enum(CASE_ACTION_PLACEMENTS);
export type CaseActionPlacement = z.infer<typeof caseActionPlacementSchema>;

/** C137.4 (public: assign, change status, change queue, add or remove tags). */
export const CASE_BULK_ACTIONS = [
  'assign',
  'set-status',
  'set-queue',
  'add-tags',
  'remove-tags',
] as const;
export const caseBulkActionSchema = z.enum(CASE_BULK_ACTIONS);
export type CaseBulkAction = z.infer<typeof caseBulkActionSchema>;

/** C137.4: where an asynchronous bulk action stands. */
export const CASE_BULK_STATUSES = ['pending', 'running', 'completed'] as const;
export const caseBulkStatusSchema = z.enum(CASE_BULK_STATUSES);
export type CaseBulkStatus = z.infer<typeof caseBulkStatusSchema>;

/** C137.4: what happened to one case; a refusal carries its problem code. */
export const CASE_BULK_OUTCOMES = ['applied', 'no_change', 'refused'] as const;
export const caseBulkOutcomeSchema = z.enum(CASE_BULK_OUTCOMES);
export type CaseBulkOutcome = z.infer<typeof caseBulkOutcomeSchema>;

/** C137.2 (public): the attributes of `POST /cases/search`, beside `fields.<searchable key>`. */
export const CASE_SEARCH_ATTRIBUTES = [
  'template',
  'case_template_id',
  'status',
  'state',
  'resolution',
  'created_at',
  'updated_at',
  'resolved_at',
  'sla_expires_at',
  'assignee',
  'case_queue',
  'case_queue_id',
  'resolver',
  'account_id',
  'inquiry_id',
  'tag_id',
] as const;
export const caseSearchAttributeSchema = z.enum(CASE_SEARCH_ATTRIBUTES);
export type CaseSearchAttribute = z.infer<typeof caseSearchAttributeSchema>;

/** C137.2 (public). */
export const CASE_SEARCH_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte'] as const;
export const caseSearchOperatorSchema = z.enum(CASE_SEARCH_OPERATORS);
export type CaseSearchOperator = z.infer<typeof caseSearchOperatorSchema>;

// ---------------------------------------------------------------------------------------------
// Queues, assignment and SLA (the (Q) family: C132, C133)

/** C132.1 (public): archiving a queue is permanent. */
export const CASE_QUEUE_STATUSES = ['active', 'archived'] as const;
export const caseQueueStatusSchema = z.enum(CASE_QUEUE_STATUSES);
export type CaseQueueStatus = z.infer<typeof caseQueueStatusSchema>;

/** C132.2 (behaviour note 3.4): how an assignment policy picks an agent. */
export const CASE_ASSIGNMENT_DISTRIBUTIONS = [
  'round-robin',
  'fewest-open',
  'case-creator',
  'inquiry-creator',
] as const;
export const caseAssignmentDistributionSchema = z.enum(CASE_ASSIGNMENT_DISTRIBUTIONS);
export type CaseAssignmentDistribution = z.infer<typeof caseAssignmentDistributionSchema>;

/** C132.2: the order a policy takes unassigned cases in. */
export const CASE_ASSIGNMENT_SORTS = ['created-at', 'sla-expires-at'] as const;
export const caseAssignmentSortSchema = z.enum(CASE_ASSIGNMENT_SORTS);
export type CaseAssignmentSort = z.infer<typeof caseAssignmentSortSchema>;

/** C132.2: what a policy's `sources` name, in priority order. */
export const CASE_ASSIGNMENT_SOURCE_TYPES = ['case-template', 'case-queue'] as const;
export const caseAssignmentSourceTypeSchema = z.enum(CASE_ASSIGNMENT_SOURCE_TYPES);
export type CaseAssignmentSourceType = z.infer<typeof caseAssignmentSourceTypeSchema>;

/**
 * C132.3, C132.4 (ours): the strategy an assignment's history row names, so every assignment can be
 * explained from the timeline: a person's (`manual`), a pull (`pull`), or a policy's distribution.
 */
export const CASE_ASSIGNMENT_STRATEGIES = [
  'manual',
  'pull',
  ...CASE_ASSIGNMENT_DISTRIBUTIONS,
] as const;
export const caseAssignmentStrategySchema = z.enum(CASE_ASSIGNMENT_STRATEGIES);
export type CaseAssignmentStrategy = z.infer<typeof caseAssignmentStrategySchema>;

/** C133.4 (ours): where a case's SLA stands; `sla-expires-at` is set only while `running`. */
export const CASE_SLA_STATES = ['none', 'running', 'paused', 'met', 'expired'] as const;
export const caseSlaStateSchema = z.enum(CASE_SLA_STATES);
export type CaseSlaState = z.infer<typeof caseSlaStateSchema>;

/** C133.1, decision 58: `continue` keeps the consumed time on reopen, `restart` starts again. */
export const CASE_SLA_ON_REOPEN = ['continue', 'restart'] as const;
export const caseSlaOnReopenSchema = z.enum(CASE_SLA_ON_REOPEN);
export type CaseSlaOnReopen = z.infer<typeof caseSlaOnReopenSchema>;

/** C133.2: a business calendar's week, in ISO order. */
export const CASE_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export const caseWeekdaySchema = z.enum(CASE_WEEKDAYS);
export type CaseWeekday = z.infer<typeof caseWeekdaySchema>;

// ---------------------------------------------------------------------------------------------
// Files, renditions and exports (the (F) family: C135, C138)

/** C135.4 (decision 62): each attachment type's media type, as the magic-byte detectors name it. */
export const CASE_ATTACHMENT_MEDIA_TYPES: Readonly<Record<CaseAttachmentType, string>> =
  Object.freeze({
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
  });

/**
 * C135.5 (decision 66; P23, H20): where an attachment's scan stands. `not_scanned` is the `none`
 * provider's, and served behind a warning; with a scanner bound only `clean` is served.
 */
export const CASE_ATTACHMENT_SCAN_STATUSES = [
  'not_scanned',
  'pending',
  'clean',
  'infected',
  'error',
] as const;
export const caseAttachmentScanStatusSchema = z.enum(CASE_ATTACHMENT_SCAN_STATUSES);
export type CaseAttachmentScanStatus = z.infer<typeof caseAttachmentScanStatusSchema>;

/** C135.5: the scanner that answered; the `none` provider scans nothing and names none. */
export const CASE_ATTACHMENT_SCAN_PROVIDERS = ['sandbox', 'clamd'] as const;
export const caseAttachmentScanProviderSchema = z.enum(CASE_ATTACHMENT_SCAN_PROVIDERS);
export type CaseAttachmentScanProvider = z.infer<typeof caseAttachmentScanProviderSchema>;

/**
 * C135.3 (decisions 62, 63; F25): where a rendition stands. It is made asynchronously, so a reader
 * may meet `pending` (the console's "preparing"); `failed` when vision could not read the file; and
 * `deleted` once the source was redacted.
 */
export const CASE_RENDITION_STATUSES = ['pending', 'ready', 'failed', 'deleted'] as const;
export const caseRenditionStatusSchema = z.enum(CASE_RENDITION_STATUSES);
export type CaseRenditionStatus = z.infer<typeof caseRenditionStatusSchema>;

/** C135.3: what a rendition is re-encoded as; a PDF's pages are always PNG. */
export const CASE_RENDITION_MEDIA_TYPES = ['image/jpeg', 'image/png'] as const;
export const caseRenditionMediaTypeSchema = z.enum(CASE_RENDITION_MEDIA_TYPES);
export type CaseRenditionMediaType = z.infer<typeof caseRenditionMediaTypeSchema>;

/** C138.1 (public: CSV; ours: JSON). */
export const CASE_EXPORT_FORMATS = ['csv', 'json'] as const;
export const caseExportFormatSchema = z.enum(CASE_EXPORT_FORMATS);
export type CaseExportFormat = z.infer<typeof caseExportFormatSchema>;

/** C138.1 (decision 69): an export's job, and its file kept 24 hours. */
export const CASE_EXPORT_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'expired',
] as const;
export const caseExportStatusSchema = z.enum(CASE_EXPORT_STATUSES);
export type CaseExportStatus = z.infer<typeof caseExportStatusSchema>;

/** Every limit with its basis: `public` where the public product states it, else provisional. */
export const CASE_LIMITS = Object.freeze({
  'held-objects': stated(1000, 'public', `${NOTE} 3.9; decision 65`),
  /**
   * How many of each kind a resource names, newest first. The public search reads the 50 most recently
   * added, and a list of 100 cases with 1,000 ids each would be megabytes; the rest are read through
   * `GET /cases/:id/objects`, and `held-object-counts` gives the totals.
   */
  'held-objects-served': stated(50, 'provisional', `${NOTE} 3.9`),
  'object-ids': stated(1000, 'public', 'C136.2: one request can fill a case'),
  'comment-characters': stated(10_000, 'provisional', 'C134.1'),
  'statement-characters': stated(10_000, 'provisional', 'C128.7, the same as a comment'),
  'attachments-per-case': stated(20, 'provisional', 'C135.2; decision 62'),
  'bulk-cases': stated(500, 'provisional', 'C137.4'),
  'export-cases': stated(10_000, 'provisional', 'C138.1; decision 69'),
  /**
   * Workflow 8C review R006: the most a file holds. The job keeps about three copies while it seals
   * one (the text, its bytes, the ciphertext), and the console downloads a file whole.
   */
  'export-bytes': stated(67_108_864, 'provisional', 'C138.1 (R006): 64 MiB, a bound on memory'),
  'sla-seconds': stated(7_776_000, 'public', 'C133.1: the API value, 90 days; decision 55'),
  'search-depth': stated(2, 'public', `${NOTE} 3.15`),
  'search-clauses': stated(20, 'public', `${NOTE} 3.15`),
  'search-page': stated(100, 'public', `${NOTE} 3.15`),
  'search-page-default': stated(10, 'public', `${NOTE} 3.15`),
  'template-name-characters': stated(80, 'provisional', 'C130.1'),
  statuses: stated(50, 'provisional', 'C130.2: as `TRANSACTION_LIMITS.statuses`'),
  'status-key-characters': stated(64, 'provisional', 'C130.2: as a field key'),
  'status-label-characters': stated(80, 'provisional', 'C130.2'),
  'status-tags': stated(50, 'provisional', 'C130.2: as `statuses`'),
  resolutions: stated(50, 'provisional', 'C130.2: as `statuses`'),
  'resolution-characters': stated(80, 'provisional', 'C130.2'),
  'notify-on-create': stated(50, 'provisional', 'C130.2: a template notifies a team, no more'),
  'visible-to-roles': stated(50, 'provisional', 'C130.1'),
  'action-templates': stated(50, 'provisional', 'C140.1'),
  'mentions-per-comment': stated(50, 'provisional', `${EDITOR} 5.1`),
  // The (Q) family: queues, assignment and SLA (C132, C133).
  'config-name-characters': stated(80, 'provisional', 'C132, C133: as a template name'),
  'queue-members': stated(200, 'provisional', 'C132.1: a review team, with room to spare'),
  'member-max-open': stated(500, 'provisional', 'C132.1'),
  'member-max-open-default': stated(50, 'provisional', 'C132.1'),
  'policy-agents': stated(200, 'provisional', 'C132.2: as `queue-members`'),
  'policy-sources': stated(50, 'provisional', 'C132.2: as `action-templates`'),
  'sla-target-minutes': stated(525_600, 'provisional', 'C133.1: a year of business minutes'),
  'calendar-intervals-per-day': stated(
    8,
    'provisional',
    `C133.2, ${EDITOR} 4.2: shifts with breaks`,
  ),
  'calendar-holidays': stated(500, 'provisional', 'C133.2: decades of public holidays'),
  'calendar-closures': stated(200, 'provisional', 'C133.2'),
  'calendar-label-characters': stated(80, 'provisional', 'C133.2: as a status label'),
  'calendar-week-minutes-minimum': stated(60, 'provisional', 'C133.2: one business hour a week'),
  'calendar-validation-days': stated(730, 'provisional', 'C133.3: the next two years'),
  'business-time-scan-days': stated(3660, 'provisional', 'C133.3: ten years, so no loop runs on'),
  'holiday-csv-characters': stated(65_536, 'provisional', 'C133.2: a 500-row `date,label` CSV'),
  // The (F) family: files, renditions and exports (C135, C138).
  'attachment-bytes': stated(10_485_760, 'provisional', 'C135.1; decision 62: `MAX_UPLOAD_BYTES`'),
  'patch-attachment-bytes': stated(10_485_760, 'provisional', 'C135.1 (H31): one request decoded'),
  'patch-body-bytes': stated(14_680_064, 'provisional', 'C135.1: base64 of 10 MiB, and the rest'),
  'filename-characters': stated(255, 'provisional', 'C135.2: as a transaction file'),
  'rendition-pages': stated(20, 'provisional', "C135.3: a PDF's first pages"),
  'rendition-image-side-px': stated(4096, 'provisional', 'C135.3: a 12 MP photo keeps its size'),
  'rendition-page-side-px': stated(1600, 'provisional', "C135.3: as C60.4's page render"),
  'rendition-bytes': stated(16_777_216, 'provisional', 'C135.3: one rendition, before base64'),
  'rendition-retry-seconds': stated(5, 'provisional', 'C135.3: the console\'s "preparing" retry'),
  'scan-attempts': stated(3, 'provisional', 'C135.5 (P23)'),
  'export-hours': stated(24, 'provisional', 'C138.1; decision 69'),
} as const);
export type CaseLimit = keyof typeof CASE_LIMITS;

/** C130.1: the prefix of a case's name, unique per environment. */
export const CASE_TEMPLATE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** C130.2 (ours): a status's key, as a field's key reads. */
export const CASE_STATUS_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** C130.2: one status of a version. */
export interface CaseStatusDefinition {
  readonly key: string;
  readonly label: string;
  readonly category: CaseStatusCategory;
  readonly 'pauses-sla': boolean;
  readonly 'required-comment': boolean;
  readonly 'status-tags': readonly { readonly key: string; readonly label: string }[];
  readonly 'status-tag-required': boolean;
}

const status = (
  key: string,
  label: string,
  category: CaseStatusCategory,
  pausesSla: boolean,
): CaseStatusDefinition =>
  Object.freeze({
    key,
    label,
    category,
    'pauses-sla': pausesSla,
    'required-comment': false,
    'status-tags': Object.freeze([]),
    'status-tag-required': false,
  });

/** C130.2 (public defaults; decision 54). */
export const DEFAULT_CASE_STATUSES: readonly CaseStatusDefinition[] = Object.freeze([
  status('open', 'Open', 'initial', false),
  status('pending', 'Pending', 'intermediate', true),
  status('approved', 'Approved', 'end', false),
  status('declined', 'Declined', 'end', false),
]);

/** C130.2 (public). */
export const DEFAULT_CASE_RESOLUTIONS: readonly string[] = Object.freeze(['Approved', 'Declined']);

/** C130.2: with no map of its own, every status may move to every other. */
export function defaultCaseTransitions(
  statuses: readonly { readonly key: string }[],
): Readonly<Record<string, readonly string[]>> {
  const keys = statuses.map(({ key }) => key);
  return Object.fromEntries(keys.map((key) => [key, keys.filter((other) => other !== key)]));
}
