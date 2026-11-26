/**
 * Synthetic API documents for the case console (Workflow 8C, `dashboard-cases`, C142.1): cases,
 * templates and their versions, queues, assignment and SLA policies, calendars, bulk actions,
 * exports and notifications. Every id is a made-up ULID and every value is fictional (a note about
 * a made-up customer, a made-up file name); each builder goes through the contract's builder, so a
 * fixture that drifts from the contract fails where it is built.
 */
import {
  buildCaseAssignmentPolicyResource,
  buildCaseBulkActionResource,
  buildCaseCalendarResource,
  buildCaseExportResource,
  buildCaseQueueResource,
  buildCaseResource,
  buildCaseSlaPolicyResource,
  buildCaseTemplateResource,
  buildCaseTemplateVersionResource,
  buildUserNotificationResource,
  type CaseAssignmentPolicyResource,
  type CaseBulkActionResource,
  type CaseCalendarResource,
  type CaseExportResource,
  type CaseQueueResource,
  type CaseResource,
  type CaseSlaPolicyResource,
  type CaseStatusDefinitionResource,
  type CaseTemplateResource,
  type CaseTemplateVersionResource,
  type FieldSchema,
  type TransactionFieldValue,
  type UserNotificationResource,
} from '@openverify/contracts';
import {
  DEFAULT_CASE_RESOLUTIONS,
  DEFAULT_CASE_STATUSES,
  defaultCaseTransitions,
  type CaseAssignmentDistribution,
  type CaseBulkAction,
  type CaseBulkOutcome,
  type CaseBulkStatus,
  type CaseExportStatus,
  type CaseNotificationKind,
  type CaseSlaState,
  type CaseStatusCategory,
} from '@openverify/core';
import { IDS } from './api-fixtures';

export const CASE_IDS = {
  template: 'ctmpl_01JE0000000000000000000001',
  otherTemplate: 'ctmpl_01JE0000000000000000000002',
  version: 'ctmplv_01JE0000000000000000000001',
  draft: 'ctmplv_01JE0000000000000000000002',
  queue: 'cqueue_01JE0000000000000000000001',
  otherQueue: 'cqueue_01JE0000000000000000000002',
  policy: 'cap_01JE0000000000000000000001',
  slaPolicy: 'cslap_01JE0000000000000000000001',
  calendar: 'ccal_01JE0000000000000000000001',
  case: 'case_01JE0000000000000000000001',
  otherCase: 'case_01JE0000000000000000000002',
  thirdCase: 'case_01JE0000000000000000000003',
  bulk: 'cblk_01JE0000000000000000000001',
  export: 'cexp_01JE0000000000000000000001',
  otherExport: 'cexp_01JE0000000000000000000002',
  notification: 'unot_01JE0000000000000000000001',
  otherNotification: 'unot_01JE0000000000000000000002',
  /** The signed-in operator of every test (`meDocument`). */
  user: IDS.user,
  member: 'usr_01JE0000000000000000000001',
  role: 'role_01JE0000000000000000000001',
  account: 'acc_01JE0000000000000000000001',
  inquiry: 'inq_01JE0000000000000000000001',
  attachment: 'catt_01JE0000000000000000000001',
} as const;

export const CT0 = '2026-11-03T09:00:00.000Z';
export const CT1 = '2026-11-03T10:30:00.000Z';
export const CT2 = '2026-11-04T09:00:00.000Z';

/** A synthetic field value: what a masked read must never carry. */
export const CASE_NOTE_VALUE = 'Synthetic note: Ada Example called about her parcel';
/** A synthetic attachment name: personal data, never in a masked read. */
export const CASE_FILENAME = 'synthetic-statement-ada-example.pdf';

export const CASE_FIELD_SCHEMAS: readonly FieldSchema[] = [
  { type: 'string', key: 'note', label: 'Note' },
  { type: 'number', key: 'amount', label: 'Amount' },
];

export const CASE_STATUSES: readonly CaseStatusDefinitionResource[] = DEFAULT_CASE_STATUSES.map(
  (status) => ({ ...status, 'status-tags': [...status['status-tags']] }),
);

export interface CaseOptions {
  readonly id?: string;
  readonly name?: string;
  readonly status?: string;
  readonly category?: CaseStatusCategory;
  readonly resolution?: string | null;
  readonly templateId?: string;
  readonly queueId?: string | null;
  readonly assigneeId?: string | null;
  readonly tags?: readonly string[];
  /** As the principal may see them: a masked field reads `{ type, value: null }`. */
  readonly fields?: Readonly<Record<string, TransactionFieldValue>> | null;
  readonly slaState?: CaseSlaState;
  readonly slaExpiresAt?: string | null;
  /** `null` reads a filename masked, as the API serves it without `pii:view`. */
  readonly attachmentFilename?: string | null;
  readonly createdAt?: string;
  readonly redactedAt?: string | null;
}

/** A case with the default status `open`, unassigned, in the queue, holding one inquiry. */
export function caseResource(options: CaseOptions = {}): CaseResource {
  const category = options.category ?? 'initial';
  const slaState = options.slaState ?? 'none';
  const resolved = category === 'end';
  return buildCaseResource({
    id: options.id ?? CASE_IDS.case,
    name: options.name ?? 'KYC-6',
    status: options.status ?? 'open',
    statusCategory: category,
    resolution: options.resolution ?? null,
    caseTemplateId: options.templateId ?? CASE_IDS.template,
    caseTemplateVersionId: CASE_IDS.version,
    caseQueueId: options.queueId === undefined ? CASE_IDS.queue : options.queueId,
    creatorType: 'user',
    creatorId: CASE_IDS.user,
    assigneeId: options.assigneeId ?? null,
    assignerType: options.assigneeId == null ? null : 'user',
    assignerId: options.assigneeId == null ? null : CASE_IDS.user,
    resolverType: resolved ? 'user' : null,
    resolverId: resolved ? CASE_IDS.user : null,
    updaterType: null,
    updaterId: null,
    tags: options.tags ?? ['synthetic'],
    fields:
      options.fields === undefined
        ? { note: { type: 'string', value: CASE_NOTE_VALUE } }
        : options.fields,
    lockVersion: 3,
    heldObjectCounts: {
      accounts: 0,
      inquiries: 1,
      reports: 0,
      'report-runs': 0,
      transactions: 0,
      verifications: 0,
      'graph-queries': 0,
    },
    commentIds: [],
    accounts: [],
    inquiries: [{ type: 'inquiry', id: CASE_IDS.inquiry }],
    reports: [],
    verifications: [],
    transactions: [],
    reportRunIds: [],
    graphQueryIds: [],
    slaState,
    slaExpiresAt:
      slaState === 'none' || slaState === 'paused' ? null : new Date(options.slaExpiresAt ?? CT2),
    attachments:
      options.attachmentFilename === undefined
        ? []
        : [
            {
              id: CASE_IDS.attachment,
              caseId: options.id ?? CASE_IDS.case,
              filename: options.attachmentFilename,
              byteSize: 2048,
              attachmentType: 'pdf',
              scanStatus: 'not_scanned',
              scanProvider: null,
              scannedAt: null,
              renditionStatus: 'pending',
              pageCount: null,
              createdAt: new Date(CT0),
            },
          ],
    assignedAt: options.assigneeId == null ? null : new Date(CT1),
    resolvedAt: resolved ? new Date(CT1) : null,
    redactedAt: options.redactedAt == null ? null : new Date(options.redactedAt),
    createdAt: new Date(options.createdAt ?? CT0),
    updatedAt: new Date(CT1),
  });
}

export interface TemplateOptions {
  readonly id?: string;
  readonly name?: string;
  readonly key?: string;
  readonly status?: 'active' | 'archived';
  readonly publishedVersion?: number | null;
  readonly draftVersion?: number | null;
  readonly visibleToRoles?: readonly string[];
}

export function caseTemplate(options: TemplateOptions = {}): CaseTemplateResource {
  const status = options.status ?? 'active';
  const published = options.publishedVersion === undefined ? 1 : options.publishedVersion;
  const draft = options.draftVersion === undefined ? null : options.draftVersion;
  return buildCaseTemplateResource({
    id: options.id ?? CASE_IDS.template,
    name: options.name ?? 'Synthetic KYC review',
    key: options.key ?? 'KYC',
    status,
    visibleToRoles: options.visibleToRoles ?? [],
    resolutions: DEFAULT_CASE_RESOLUTIONS,
    fieldSchemas: CASE_FIELD_SCHEMAS,
    publishedVersion: published,
    publishedVersionId: published === null ? null : CASE_IDS.version,
    draftVersion: draft,
    draftVersionId: draft === null ? null : CASE_IDS.draft,
    createdAt: new Date(CT0),
    updatedAt: new Date(CT1),
    archivedAt: status === 'archived' ? new Date(CT1) : null,
  });
}

export interface VersionOptions {
  readonly id?: string;
  readonly templateId?: string;
  readonly number?: number;
  readonly status?: 'draft' | 'published' | 'superseded';
  readonly statuses?: readonly CaseStatusDefinitionResource[];
  readonly transitions?: Readonly<Record<string, readonly string[]>>;
  readonly fieldSchemas?: readonly FieldSchema[];
  readonly slaPolicyId?: string | null;
  readonly defaultQueueId?: string | null;
  readonly assignmentPolicyId?: string | null;
}

export function caseTemplateVersion(options: VersionOptions = {}): CaseTemplateVersionResource {
  const status = options.status ?? 'published';
  const statuses = options.statuses ?? CASE_STATUSES;
  return buildCaseTemplateVersionResource({
    id: options.id ?? (status === 'draft' ? CASE_IDS.draft : CASE_IDS.version),
    caseTemplateId: options.templateId ?? CASE_IDS.template,
    versionNumber: options.number ?? (status === 'draft' ? 2 : 1),
    status,
    fieldSchemas: options.fieldSchemas ?? CASE_FIELD_SCHEMAS,
    statuses,
    resolutions: DEFAULT_CASE_RESOLUTIONS,
    transitions: options.transitions ?? defaultCaseTransitions(statuses),
    defaultQueueId: options.defaultQueueId ?? null,
    assignmentPolicyId: options.assignmentPolicyId ?? null,
    slaPolicyId: options.slaPolicyId ?? null,
    slaStartsOn: 'created',
    heldObjectTypes: ['inquiry', 'account'],
    attachmentPolicy: { 'max-files': 20, types: ['jpeg', 'png', 'pdf'] },
    notifyOnCreate: [],
    layoutModules: [
      { key: 'held-objects', 'required-permissions': [] },
      { key: 'timeline', 'required-permissions': [] },
    ],
    createdAt: new Date(CT0),
    publishedAt: status === 'draft' ? null : new Date(CT1),
  });
}

export interface QueueOptions {
  readonly id?: string;
  readonly name?: string;
  readonly status?: 'active' | 'archived';
  readonly members?: readonly { userId: string; maxOpen: number; paused: boolean }[];
  readonly policyId?: string | null;
}

export function caseQueue(options: QueueOptions = {}): CaseQueueResource {
  const status = options.status ?? 'active';
  return buildCaseQueueResource({
    id: options.id ?? CASE_IDS.queue,
    name: options.name ?? 'Synthetic first line',
    status,
    members: options.members ?? [
      { userId: CASE_IDS.user, maxOpen: 50, paused: false },
      { userId: CASE_IDS.member, maxOpen: 10, paused: true },
    ],
    caseAssignmentPolicyId: options.policyId === undefined ? CASE_IDS.policy : options.policyId,
    createdAt: new Date(CT0),
    updatedAt: new Date(CT1),
    archivedAt: status === 'archived' ? new Date(CT1) : null,
  });
}

export function assignmentPolicy(
  options: {
    readonly id?: string;
    readonly name?: string;
    readonly distribution?: CaseAssignmentDistribution;
    readonly agents?: readonly string[] | null;
    readonly maxCapacity?: number | null;
  } = {},
): CaseAssignmentPolicyResource {
  return buildCaseAssignmentPolicyResource({
    id: options.id ?? CASE_IDS.policy,
    name: options.name ?? 'Synthetic round robin',
    distribution: options.distribution ?? 'round-robin',
    sort: 'sla-expires-at',
    agentIds: options.agents === undefined ? null : options.agents,
    maxCapacity: options.maxCapacity === undefined ? 20 : options.maxCapacity,
    sources: [
      { type: 'case-queue', id: CASE_IDS.queue },
      { type: 'case-template', id: CASE_IDS.template },
    ],
    createdAt: new Date(CT0),
    updatedAt: new Date(CT1),
  });
}

export function slaPolicy(
  options: {
    readonly id?: string;
    readonly name?: string;
    readonly calendarId?: string | null;
    readonly targetMinutes?: number;
  } = {},
): CaseSlaPolicyResource {
  return buildCaseSlaPolicyResource({
    id: options.id ?? CASE_IDS.slaPolicy,
    name: options.name ?? 'Synthetic four hours',
    targetMinutes: options.targetMinutes ?? 240,
    caseCalendarId: options.calendarId === undefined ? CASE_IDS.calendar : options.calendarId,
    onReopen: 'continue',
    revision: 2,
    createdAt: new Date(CT0),
    updatedAt: new Date(CT1),
  });
}

const NINE_TO_FIVE = [{ start: '09:00', end: '17:00' }];

export function caseCalendar(
  options: { readonly holidays?: readonly { date: string; label: string }[] } = {},
): CaseCalendarResource {
  return buildCaseCalendarResource({
    id: CASE_IDS.calendar,
    name: 'Synthetic London office',
    timeZone: 'Europe/London',
    week: {
      monday: NINE_TO_FIVE,
      tuesday: NINE_TO_FIVE,
      wednesday: NINE_TO_FIVE,
      thursday: NINE_TO_FIVE,
      friday: NINE_TO_FIVE,
      saturday: [],
      sunday: [],
    },
    holidays: options.holidays ?? [{ date: '2026-12-25', label: 'Synthetic closing day' }],
    closures: [],
    createdAt: new Date(CT0),
    updatedAt: new Date(CT1),
  });
}

export function bulkAction(
  options: {
    readonly action?: CaseBulkAction;
    readonly status?: CaseBulkStatus;
    readonly outcomes?: readonly {
      caseId: string;
      outcome: CaseBulkOutcome;
      code: string | null;
    }[];
  } = {},
): CaseBulkActionResource {
  const status = options.status ?? 'completed';
  const outcomes =
    options.outcomes ??
    (status === 'completed'
      ? [
          { caseId: CASE_IDS.case, outcome: 'applied' as const, code: null },
          { caseId: CASE_IDS.otherCase, outcome: 'no_change' as const, code: null },
          {
            caseId: CASE_IDS.thirdCase,
            outcome: 'refused' as const,
            code: 'case_transition_refused',
          },
        ]
      : []);
  return buildCaseBulkActionResource({
    id: CASE_IDS.bulk,
    action: options.action ?? 'set-status',
    status,
    requestedCount: 3,
    outcomes,
    createdAt: new Date(CT0),
    completedAt: status === 'completed' ? new Date(CT1) : null,
  });
}

export function caseExport(
  options: {
    readonly id?: string;
    readonly status?: CaseExportStatus;
    readonly format?: 'csv' | 'json';
    readonly personalData?: boolean;
    readonly errorCode?: string | null;
  } = {},
): CaseExportResource {
  const status = options.status ?? 'completed';
  const finished = status === 'completed' || status === 'expired';
  return buildCaseExportResource({
    id: options.id ?? CASE_IDS.export,
    status,
    format: options.format ?? 'csv',
    includePersonalData: options.personalData ?? false,
    caseCount: finished ? 12 : null,
    byteSize: status === 'completed' ? 4096 : null,
    errorCode: status === 'failed' ? (options.errorCode ?? 'export_failed') : null,
    createdAt: new Date(CT0),
    completedAt: finished ? new Date(CT1) : null,
    expiresAt: finished ? new Date(CT2) : null,
  });
}

export function notification(
  options: {
    readonly id?: string;
    readonly kind?: CaseNotificationKind;
    readonly caseId?: string;
    readonly readAt?: string | null;
  } = {},
): UserNotificationResource {
  return buildUserNotificationResource({
    id: options.id ?? CASE_IDS.notification,
    kind: options.kind ?? 'assigned',
    caseId: options.caseId ?? CASE_IDS.case,
    readAt: options.readAt == null ? null : new Date(options.readAt),
    createdAt: new Date(CT1),
  });
}

export const casePageOf = <T>(data: readonly T[], next: string | null = null) => ({
  data,
  links: { next },
});
