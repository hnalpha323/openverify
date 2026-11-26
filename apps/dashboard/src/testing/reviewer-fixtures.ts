/**
 * `dashboard-reviewer`'s fixtures (C142.2 to C142.6): a case on a published template version with
 * the default statuses, its timeline, comments, held objects, attachments and available actions,
 * built through the contracts' own builders so each one is what the API serves. Every value is
 * synthetic: fictional people, `example.test` addresses, documentation-range IP addresses.
 */
import {
  buildCaseActionResource,
  buildCaseCommentResource,
  buildCaseHistoryEntryResource,
  buildCaseResource,
  buildCaseTemplateResource,
  buildCaseTemplateVersionResource,
  caseAvailableActionListDocumentSchema,
  caseHeldObjectListDocumentSchema,
  caseQueueResourceSchema,
  type CaseAttachmentRecord,
  type CaseCommentRecord,
  type CaseHistoryEntryRecord,
  type CaseRecord,
  type CaseStatusDefinitionResource,
  type CaseTemplateVersionRecord,
} from '@openverify/contracts';
import { IDS as API_IDS } from './api-fixtures';
import { LIFECYCLE_IDS } from './lifecycle-fixtures';
import { REPORT_IDS } from './report-fixtures';
import { TRANSACTION_IDS } from './transactions-fixtures';

export const REVIEWER_IDS = {
  case: 'case_01JE0000000000000000000001',
  otherCase: 'case_01JE0000000000000000000002',
  template: 'ctmpl_01JE0000000000000000000003',
  version: 'ctmplv_01JE0000000000000000000004',
  queue: 'cqueue_01JE0000000000000000000005',
  otherQueue: 'cqueue_01JE0000000000000000000006',
  comment: 'cscm_01JE0000000000000000000007',
  otherComment: 'cscm_01JE0000000000000000000008',
  attachment: 'catt_01JE0000000000000000000009',
  pdf: 'catt_01JE000000000000000000000A',
  action: 'cact_01JE000000000000000000000B',
  workflow: 'wfl_01JE000000000000000000000C',
  run: 'wfr_01JE000000000000000000000D',
  // The held objects are the other fixtures' own, so their live reads reuse them.
  inquiry: LIFECYCLE_IDS.inquiry,
  account: LIFECYCLE_IDS.account,
  report: REPORT_IDS.report,
  transaction: TRANSACTION_IDS.transaction,
  /** The signed-in operator of `api-mock.ts`' `meDocument`. */
  me: API_IDS.user,
  colleague: 'usr_01JE000000000000000000000J',
  creatorKey: 'key_01JE000000000000000000000K',
} as const;

const IDS = REVIEWER_IDS;

export const C0 = '2026-11-01T09:00:00.000Z';
export const C1 = '2026-11-01T10:30:00.000Z';
export const C2 = '2026-11-02T08:15:00.000Z';
/** The clock of the SLA words: two hours and five minutes before the deadline. */
export const NOW = '2026-11-03T10:00:00.000Z';
export const DEADLINE = '2026-11-03T12:05:00.000Z';

/** A field value the reviewer sees with `pii:view`, and nobody else. */
export const FIELD_VALUE = 'Avery Example-Synthetic';
/** A comment's words, PII by rule (C134.1). */
export const COMMENT_TEXT = 'Synthetic note: the address matches the utility bill.';
/** An attachment's filename, PII by rule (C135.2). */
export const ATTACHMENT_NAME = 'synthetic-utility-bill.jpg';
/** A case action's prefilled value, under the viewer's mask (P38). */
export const PREFILLED_VALUE = 'Synthetic prefilled value';

export const TEMPLATE_NAME = 'Synthetic review';
export const QUEUE_NAME = 'Synthetic first line';

/** The public default statuses (decision 54), with a required comment on Declined. */
export const STATUSES: readonly CaseStatusDefinitionResource[] = Object.freeze([
  status('open', 'Open', 'initial'),
  { ...status('pending', 'Pending', 'intermediate'), 'pauses-sla': true },
  status('approved', 'Approved', 'end'),
  {
    ...status('declined', 'Declined', 'end'),
    'required-comment': true,
    'status-tags': [
      { key: 'document', label: 'Document problem' },
      { key: 'fraud', label: 'Suspected fraud' },
    ],
    'status-tag-required': true,
  },
]);

function status(
  key: string,
  label: string,
  category: CaseStatusDefinitionResource['category'],
): CaseStatusDefinitionResource {
  return {
    key,
    label,
    category,
    'pauses-sla': false,
    'required-comment': false,
    'status-tags': [],
    'status-tag-required': false,
  };
}

const date = (value: string) => new Date(value);

export function caseTemplate() {
  return buildCaseTemplateResource({
    id: IDS.template,
    name: TEMPLATE_NAME,
    key: 'REVIEW',
    status: 'active',
    visibleToRoles: [],
    resolutions: ['Approved', 'Declined'],
    fieldSchemas: [{ type: 'string', key: 'full-name', label: 'Full name' }],
    publishedVersion: 1,
    publishedVersionId: IDS.version,
    draftVersion: null,
    draftVersionId: null,
    createdAt: date(C0),
    updatedAt: date(C0),
    archivedAt: null,
  });
}

export function caseTemplateVersion(changes: Partial<CaseTemplateVersionRecord> = {}) {
  return buildCaseTemplateVersionResource({
    id: IDS.version,
    caseTemplateId: IDS.template,
    versionNumber: 1,
    status: 'published',
    fieldSchemas: [{ type: 'string', key: 'full-name', label: 'Full name' }],
    statuses: STATUSES,
    resolutions: ['Approved', 'Declined'],
    // From Open everything; from Pending only back to Open or to an end; ends reopen to Open.
    transitions: {
      open: ['pending', 'approved', 'declined'],
      pending: ['open', 'approved', 'declined'],
      approved: ['open'],
      declined: ['open'],
    },
    defaultQueueId: IDS.queue,
    assignmentPolicyId: null,
    slaPolicyId: null,
    slaStartsOn: 'created',
    heldObjectTypes: ['account', 'inquiry', 'report', 'transaction'],
    attachmentPolicy: { 'max-files': 20, types: ['jpeg', 'png', 'webp', 'pdf'] },
    notifyOnCreate: [],
    layoutModules: [
      { key: 'held-objects', 'required-permissions': ['cases:read'] },
      { key: 'reports', 'required-permissions': ['reports:read'] },
      { key: 'report-runs', 'required-permissions': ['reports:read'] },
      { key: 'transactions', 'required-permissions': ['transactions:read'] },
      { key: 'list-matches', 'required-permissions': ['lists:read'] },
      { key: 'graph', 'required-permissions': ['graph:read'] },
      { key: 'signals', 'required-permissions': ['inquiries:read'] },
      { key: 'device', 'required-permissions': ['inquiry-sessions:read'] },
      { key: 'location', 'required-permissions': ['inquiry-sessions:read'] },
      { key: 'timeline', 'required-permissions': ['cases:read'] },
      { key: 'comments', 'required-permissions': ['cases:read'] },
      { key: 'attachments', 'required-permissions': ['cases:read', 'pii:view'] },
      { key: 'case-actions', 'required-permissions': ['workflows:trigger'] },
    ],
    createdAt: date(C0),
    publishedAt: date(C0),
    ...changes,
  });
}

export function attachment(changes: Partial<CaseAttachmentRecord> = {}): CaseAttachmentRecord {
  return {
    id: IDS.attachment,
    caseId: IDS.case,
    filename: ATTACHMENT_NAME,
    byteSize: 48_213,
    attachmentType: 'jpeg',
    scanStatus: 'clean',
    scanProvider: 'sandbox',
    scannedAt: date(C1),
    renditionStatus: 'ready',
    pageCount: 1,
    createdAt: date(C1),
    ...changes,
  };
}

export function caseRecord(changes: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: IDS.case,
    name: 'REVIEW-7',
    status: 'open',
    statusCategory: 'initial',
    resolution: null,
    caseTemplateId: IDS.template,
    caseTemplateVersionId: IDS.version,
    caseQueueId: IDS.queue,
    creatorType: 'api-key',
    creatorId: IDS.creatorKey,
    assigneeId: IDS.colleague,
    assignerType: 'user',
    assignerId: IDS.me,
    resolverType: null,
    resolverId: null,
    updaterType: null,
    updaterId: null,
    tags: ['synthetic-priority'],
    fields: { 'full-name': { type: 'string', value: FIELD_VALUE } },
    lockVersion: 4,
    heldObjectCounts: {
      accounts: 1,
      inquiries: 1,
      reports: 1,
      'report-runs': 0,
      transactions: 1,
      verifications: 0,
      'graph-queries': 0,
    },
    commentIds: [IDS.comment],
    accounts: [{ type: 'account', id: IDS.account }],
    inquiries: [{ type: 'inquiry', id: IDS.inquiry }],
    reports: [{ type: 'report/watchlist', id: IDS.report }],
    verifications: [],
    transactions: [{ type: 'transaction', id: IDS.transaction }],
    reportRunIds: [],
    graphQueryIds: [],
    slaExpiresAt: date(DEADLINE),
    slaState: 'running',
    attachments: [attachment()],
    assignedAt: date(C1),
    resolvedAt: null,
    redactedAt: null,
    createdAt: date(C0),
    updatedAt: date(C2),
    ...changes,
  };
}

export function caseResource(changes: Partial<CaseRecord> = {}) {
  return buildCaseResource(caseRecord(changes));
}

/** The case as a reader without `pii:view` gets it: fields member-wise null, no filenames. */
export function maskedCaseResource(changes: Partial<CaseRecord> = {}) {
  return caseResource({
    fields: { 'full-name': { type: 'string', value: null } },
    attachments: [attachment({ filename: null })],
    ...changes,
  });
}

export function caseQueue(id: string = IDS.queue, name: string = QUEUE_NAME) {
  return caseQueueResourceSchema.parse({
    type: 'case-queue',
    id,
    attributes: {
      name,
      status: 'active',
      members: [
        { 'user-id': IDS.me, 'max-open': 50, paused: false },
        { 'user-id': IDS.colleague, 'max-open': 50, paused: false },
      ],
      'created-at': C0,
      'updated-at': C0,
      'archived-at': null,
      'case-assignment-policy-id': null,
    },
  });
}

export function historyEntry(changes: Partial<CaseHistoryEntryRecord> = {}) {
  return buildCaseHistoryEntryResource({
    sequence: 1,
    kind: 'created',
    actorType: 'api-key',
    actorId: IDS.creatorKey,
    from: null,
    to: { status: 'open' },
    requestId: 'req-synthetic-0001',
    createdAt: date(C0),
    ...changes,
  });
}

/** The timeline, newest first, as `GET /cases/:id/history` serves it. */
export function history() {
  return [
    historyEntry({
      sequence: 4,
      kind: 'comment-added',
      actorType: 'user',
      actorId: IDS.colleague,
      from: null,
      to: { 'comment-id': IDS.comment },
      createdAt: date(C2),
    }),
    historyEntry({
      sequence: 3,
      kind: 'status-changed',
      actorType: 'user',
      actorId: IDS.me,
      from: { status: 'pending' },
      to: { status: 'open' },
      createdAt: date(C1),
    }),
    historyEntry({
      sequence: 2,
      kind: 'assigned',
      actorType: 'user',
      actorId: IDS.me,
      from: { 'assignee-id': null },
      to: { 'assignee-id': IDS.colleague, strategy: 'manual' },
      createdAt: date(C1),
    }),
    historyEntry(),
  ];
}

export function comment(changes: Partial<CaseCommentRecord> = {}) {
  return buildCaseCommentResource({
    id: IDS.comment,
    caseId: IDS.case,
    message: `${COMMENT_TEXT} @[${IDS.me}] see ${IDS.inquiry} and https://docs.example.test/guide`,
    commenterType: 'user',
    commenterId: IDS.colleague,
    mentions: [IDS.me],
    createdAt: date(C2),
    updatedAt: date(C2),
    redactedAt: null,
    ...changes,
  });
}

export function heldObjects() {
  const row = (type: string, id: string, state: Record<string, unknown>) => ({
    type: 'case-held-object',
    id: `${IDS.case}:${id}`,
    attributes: {
      'object-type': type,
      'object-id': id,
      'attached-at': C0,
      'attached-by-type': 'api-key',
      'attached-by-id': IDS.creatorKey,
      'attached-state': state,
    },
  });
  return caseHeldObjectListDocumentSchema.parse({
    data: [
      row('inquiry', IDS.inquiry, { status: 'completed', 'verification-ids': [] }),
      row('account', IDS.account, { status: 'active' }),
      row('report', IDS.report, { status: 'ready', 'report-type': 'report/watchlist' }),
      row('transaction', IDS.transaction, { status: 'created' }),
    ],
    links: { next: null },
  });
}

export function caseAction() {
  return buildCaseActionResource({
    id: IDS.action,
    workflowId: IDS.workflow,
    caseTemplateIds: [IDS.template],
    label: 'Re-screen the account',
    status: 'active',
    placement: 'header',
    prefill: { reference: 'case.fields.full-name' },
    createdAt: date(C0),
    updatedAt: date(C0),
  });
}

/** `GET /cases/:id/available-actions`, prefilled under the viewer's mask (P38). */
export function availableActions(prefilled: string | null = PREFILLED_VALUE) {
  return caseAvailableActionListDocumentSchema.parse({
    data: [
      {
        type: 'case-action',
        id: IDS.action,
        attributes: {
          label: 'Re-screen the account',
          placement: 'header',
          form: [
            { name: 'reference', type: 'string', required: true, 'prefilled-value': prefilled },
            { name: 'priority', type: 'number', required: false, 'prefilled-value': null },
            { name: 'notify', type: 'boolean', required: false, 'prefilled-value': null },
          ],
        },
        relationships: { workflow: { data: { type: 'workflow', id: IDS.workflow } } },
      },
    ],
    links: { next: null },
  });
}

export const single = <Resource>(data: Resource) => ({ data });
export const listOf = <Resource>(data: readonly Resource[], next: string | null = null) => ({
  data,
  links: { next },
});
