/**
 * C129.2, C129.3 (Workflow 8B, `api-cases`): the case resources, built by the contract's builders.
 *
 * - A case names each held kind's newest 50 with the totals (`getWorkflowCase`), its fields masked
 *   member-wise under the reader's mask (C136.4); an event's case has no fields (C107.5, C136.4).
 * - A template serves its published version's resolutions and field schemas, and the numbers and ids
 *   of its published version and open draft.
 * - A version serves C130.2's defaults where a seed or an older writer left a member out.
 */
import {
  buildCaseCommentResource,
  buildCaseHistoryEntryResource,
  buildCaseResource,
  buildCaseTemplateResource,
  buildCaseTemplateVersionResource,
  type CaseCommentResource,
  type CaseHeldObjectResource,
  type CaseHistoryEntryResource,
  type CaseResource,
  type CaseTemplateResource,
  type CaseTemplateVersionResource,
  type TransactionFieldValue,
} from '@openverify/contracts';
import {
  CASE_ATTACHMENT_TYPES,
  CASE_LIMITS,
  type CaseAttachmentType,
  type CaseHeldObjectType,
  type CaseLayoutModule,
  type FieldSchema,
  type Permission,
} from '@openverify/core';
import {
  getWorkflowCase,
  getWorkflowCases,
  type Case,
  type CaseComment,
  type CaseHeldObjectRow,
  type CaseHistoryRow,
  type CaseTemplateRow,
  type CaseTemplateVersionRow,
  type Db,
  type WorkflowCase,
} from '@openverify/db';
import { UNMASKED, type PiiMask } from '../../auth/pii.js';
import { caseRecordOf } from '../../workflows/actions/cases/case-document.js';
import { caseAttachmentRecordsOf, caseAttachmentRecordsOfCases } from './attachments/resources.js';
import { servedStatus, versionCompletionMembers } from './layout/version-members.js';
import { statusDefinitionOf, statusMachineOf } from './shared.js';

/**
 * The case as the contract's record, from its row, what `getWorkflowCase` reads beside it, and its
 * attachments (C129.2); an event's case names no file (`filenames: false`, `carriesNoValue`).
 */
async function caseRecord(
  db: Db,
  environmentId: string,
  row: Case,
  options: { filenames: boolean } = { filenames: true },
) {
  const view = await getWorkflowCase(db, environmentId, row.id);
  if (view === null) {
    throw new Error(`caseRecord: case ${row.id} was not found`);
  }
  return caseRecordFrom(
    row,
    view,
    await caseAttachmentRecordsOf(db, environmentId, row.id, options),
  );
}

/** The record from what was read: the row, its view and its attachments. */
function caseRecordFrom(
  row: Case,
  view: WorkflowCase,
  attachments: Awaited<ReturnType<typeof caseAttachmentRecordsOf>>,
) {
  return {
    ...caseRecordOf(view),
    status: row.status,
    statusCategory: row.statusCategory,
    resolution: row.resolution,
    caseQueueId: row.caseQueueId,
    assigneeId: row.assigneeId,
    assignerType: row.assignerType,
    assignerId: row.assignerId,
    assignedAt: row.assignedAt,
    resolverType: row.resolverType,
    resolverId: row.resolverId,
    resolvedAt: row.resolvedAt,
    updaterType: row.updaterType,
    updaterId: row.updaterId,
    tags: row.tags,
    fields: row.fields as Readonly<Record<string, TransactionFieldValue>> | null,
    lockVersion: row.lockVersion,
    redactedAt: row.redactedAt,
    updatedAt: row.updatedAt,
    slaState: row.slaState,
    slaExpiresAt: row.slaExpiresAt,
    attachments,
  };
}

/** C129.2: the case under the reader's mask. */
export async function caseResource(
  db: Db,
  environmentId: string,
  row: Case,
  mask: PiiMask,
): Promise<CaseResource> {
  const resource = buildCaseResource(await caseRecord(db, environmentId, row));
  return { ...resource, attributes: mask.attributes(resource.attributes) };
}

/**
 * K8-30 (Workflow 8D; plan item 115): {@link caseResource} for a page of cases, their views and
 * attachments read in a fixed number of queries whatever the page's size, each case served as
 * `GET /cases/:id` serves it.
 */
export async function caseResources(
  db: Db,
  environmentId: string,
  rows: readonly Case[],
  mask: PiiMask,
): Promise<CaseResource[]> {
  const ids = rows.map(({ id }) => id);
  const views = await getWorkflowCases(db, environmentId, ids);
  const attachments = await caseAttachmentRecordsOfCases(db, environmentId, ids);
  return rows.map((row) => {
    const view = views.get(row.id);
    if (view === undefined) {
      throw new Error(`caseResources: case ${row.id} was not found`);
    }
    const resource = buildCaseResource(
      caseRecordFrom(row, view, attachments.get(row.id) ?? []),
    );
    return { ...resource, attributes: mask.attributes(resource.attributes) };
  });
}

/** An event's case: no field value (C136.4, C107.5). */
export async function caseEventResource(
  db: Db,
  environmentId: string,
  row: Case,
): Promise<CaseResource> {
  return buildCaseResource({
    ...(await caseRecord(db, environmentId, row, { filenames: false })),
    fields: null,
  });
}

/** The unmasked case: what a stored copy or a run reads. */
export const caseUnmaskedResource = (db: Db, environmentId: string, row: Case) =>
  caseResource(db, environmentId, row, UNMASKED);

/** C129.3: the template, with its published version's content and its two heads. */
export function caseTemplateResource(
  row: CaseTemplateRow,
  heads: { published: CaseTemplateVersionRow | null; draft: CaseTemplateVersionRow | null },
): CaseTemplateResource {
  return buildCaseTemplateResource({
    id: row.id,
    name: row.name,
    key: row.key,
    status: row.status,
    visibleToRoles: row.visibleToRoles,
    resolutions: heads.published?.resolutions ?? [],
    fieldSchemas: (heads.published?.fieldSchemas ?? []) as FieldSchema[],
    publishedVersion: heads.published?.version ?? null,
    publishedVersionId: heads.published?.id ?? null,
    draftVersion: heads.draft?.version ?? null,
    draftVersionId: heads.draft?.id ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  });
}

/**
 * C130.2, C142.2 (decision 70): the default layout, each module with what a reader needs to see it.
 * Provisional, ours: each module asks for the scope that reads what it shows.
 */
export const DEFAULT_LAYOUT_MODULES: readonly {
  key: CaseLayoutModule;
  'required-permissions': readonly Permission[];
}[] = Object.freeze([
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
]);

/** C130.2 (decision 62): every type, 20 files. */
export const DEFAULT_ATTACHMENT_POLICY = Object.freeze({
  'max-files': CASE_LIMITS['attachments-per-case'].value,
  types: [...CASE_ATTACHMENT_TYPES] as CaseAttachmentType[],
});

/** C130.2: a version, with the defaults where a member was left out. */
export function caseTemplateVersionResource(
  row: CaseTemplateVersionRow,
): CaseTemplateVersionResource {
  const machine = statusMachineOf(row);
  return buildCaseTemplateVersionResource({
    id: row.id,
    caseTemplateId: row.caseTemplateId,
    versionNumber: row.version,
    status: row.status,
    fieldSchemas: row.fieldSchemas as FieldSchema[],
    // C172.3 (Workflow 9B, api-cases-reports): a status's `requires-fields` is served too.
    statuses: row.statuses.map((stored) => {
      const status = statusDefinitionOf(stored);
      return servedStatus({ ...status, 'status-tags': [...status['status-tags']] }, stored);
    }),
    resolutions: row.resolutions,
    transitions: machine.transitions,
    defaultQueueId: row.defaultQueueId,
    assignmentPolicyId: row.assignmentPolicyId,
    slaPolicyId: row.slaPolicyId,
    slaStartsOn: row.slaStartsOn,
    heldObjectTypes: row.heldObjectTypes as CaseHeldObjectType[],
    attachmentPolicy:
      (row.attachmentPolicy as { 'max-files': number; types: CaseAttachmentType[] } | null) ??
      DEFAULT_ATTACHMENT_POLICY,
    notifyOnCreate: row.notifyOnCreate,
    layoutModules:
      (row.layoutModules as
        { key: CaseLayoutModule; 'required-permissions': Permission[] }[] | null) ??
      DEFAULT_LAYOUT_MODULES,
    // C172.1, C172.2, C172.4 (Workflow 9B, api-cases-reports): on every version.
    ...versionCompletionMembers(row),
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
  });
}

/** C134.1: a comment under the reader's mask; `null` once redacted. */
export function caseCommentResource(
  comment: CaseComment,
  mask: PiiMask,
  options: { forEvent?: boolean } = {},
): CaseCommentResource {
  const resource = buildCaseCommentResource({
    id: comment.id,
    caseId: comment.caseId,
    message: options.forEvent === true ? null : comment.message,
    commenterType: comment.commenterType,
    commenterId: comment.commenterId,
    mentions: comment.mentions,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    redactedAt: comment.redactedAt,
  });
  return { ...resource, attributes: mask.attributes(resource.attributes) };
}

/** C131.4: one timeline entry, PII-free by rule. */
export const caseHistoryResource = (row: CaseHistoryRow): CaseHistoryEntryResource =>
  buildCaseHistoryEntryResource({
    sequence: row.id,
    kind: row.kind,
    actorType: row.actorType,
    actorId: row.actorId,
    from: row.from,
    to: row.to,
    requestId: row.requestId,
    createdAt: row.createdAt,
  });

/** C136.3: one held object, as attached. */
export const caseHeldObjectResource = (row: CaseHeldObjectRow): CaseHeldObjectResource => ({
  type: 'case-held-object',
  id: `${row.caseId}:${row.objectId}`,
  attributes: {
    'object-type': row.objectType,
    'object-id': row.objectId,
    'attached-at': row.attachedAt.toISOString(),
    'attached-by-type': row.attachedByType,
    'attached-by-id': row.attachedById,
    'attached-state': row.attachedState as CaseHeldObjectResource['attributes']['attached-state'],
  },
});
