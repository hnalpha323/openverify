/**
 * C112.4, C116 (Workflow 8A): `workflow_versions` and `workflow_deployments`. A workflow has at most
 * one draft, edited in place at its `lock_version`; a published version never changes again, except
 * that a later publish or a finished rollout archives it.
 */
import type { WorkflowDeploymentStatus, WorkflowTriggerType } from '@openverify/core';
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  accountTypes,
  graphQueryTemplates,
  inquiryTemplateVersions,
  inquiryTemplates,
  lists,
  reportTemplates,
  transactionTypes,
  workflowDeployments,
  workflows,
  workflowTriggers,
  workflowVersions,
  type WorkflowDeploymentRow,
  type WorkflowVersionRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { CASE_WORKFLOW_REFERENCE_KINDS, caseReferenceSource } from './case-references.js';
import { firstOrNull, inserted } from './rows.js';

export interface NewWorkflowDraft {
  id: string;
  workflowId: string;
  versionNumber: number;
  schemaVersion: number;
  definition: Readonly<Record<string, unknown>>;
  lastUpdater: string | null;
  promotedFrom?: string | null | undefined;
}

export interface WorkflowDraftChanges {
  definition: Readonly<Record<string, unknown>>;
  schemaVersion: number;
  triggerType: WorkflowTriggerType | null;
  triggerConfig: Readonly<Record<string, unknown>> | null;
  warnings: readonly unknown[];
  lastUpdater: string;
}

/** What publish freezes on a draft (C116.1, C116.4, C121.2, C121.4). */
export interface WorkflowVersionPublication {
  definitionSha256: string;
  grant: Readonly<Record<string, unknown>>;
  egress: readonly unknown[];
  acknowledgements: readonly unknown[];
  warnings: readonly unknown[];
  description: string | null;
  publishedAt: Date;
  publishedById: string;
}

export interface NewWorkflowDeployment {
  id: string;
  workflowId: string;
  versions: readonly unknown[];
}

/** C112.2: what a definition can name, each re-resolved by name in a promote. */
export const WORKFLOW_REFERENCE_KINDS = [
  'inquiry-template',
  'report-template',
  'list',
  'transaction-type',
  'account-type',
  'graph-query-template',
  'workflow',
  // Workflow 8B (C121.6): the case kinds, `api-case-workflows`' to name.
  ...CASE_WORKFLOW_REFERENCE_KINDS,
] as const;
export type WorkflowReferenceKind = (typeof WORKFLOW_REFERENCE_KINDS)[number];

export interface WorkflowReferenceRow {
  id: string;
  name: string;
}

const versionCursor = environmentCursor(workflowVersions);

const scopedVersion = (environmentId: string, id: string) =>
  and(eq(workflowVersions.environmentId, environmentId), eq(workflowVersions.id, id));

const scopedDeployment = (environmentId: string, id: string) =>
  and(eq(workflowDeployments.environmentId, environmentId), eq(workflowDeployments.id, id));

export async function createWorkflowDraft(
  tx: Db,
  environmentId: string,
  input: NewWorkflowDraft,
): Promise<WorkflowVersionRow> {
  return inserted(
    await tx
      .insert(workflowVersions)
      .values({
        id: input.id,
        environmentId,
        workflowId: input.workflowId,
        versionNumber: input.versionNumber,
        schemaVersion: input.schemaVersion,
        definition: { ...input.definition },
        lastUpdater: input.lastUpdater,
        promotedFrom: input.promotedFrom ?? null,
      })
      .returning(),
    'workflow version',
  );
}

export async function getWorkflowVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowVersionRow | null> {
  return firstOrNull(
    await db.select().from(workflowVersions).where(scopedVersion(environmentId, id)).limit(1),
  );
}

/** C116.1: writes only at `expectedLockVersion` and bumps it; `null` on a mismatch. */
export async function saveWorkflowDraft(
  tx: Db,
  environmentId: string,
  id: string,
  expectedLockVersion: number,
  changes: WorkflowDraftChanges,
): Promise<WorkflowVersionRow | null> {
  return firstOrNull(
    await tx
      .update(workflowVersions)
      .set({
        definition: { ...changes.definition },
        schemaVersion: changes.schemaVersion,
        triggerType: changes.triggerType,
        triggerConfig: changes.triggerConfig === null ? null : { ...changes.triggerConfig },
        warnings: [...changes.warnings],
        lastUpdater: changes.lastUpdater,
        lockVersion: sql`${workflowVersions.lockVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          scopedVersion(environmentId, id),
          eq(workflowVersions.status, 'draft'),
          eq(workflowVersions.lockVersion, expectedLockVersion),
        ),
      )
      .returning(),
  );
}

export async function publishWorkflowVersion(
  tx: Db,
  environmentId: string,
  id: string,
  publication: WorkflowVersionPublication,
): Promise<WorkflowVersionRow | null> {
  return firstOrNull(
    await tx
      .update(workflowVersions)
      .set({
        status: 'published',
        definitionSha256: publication.definitionSha256,
        grant: { ...publication.grant },
        egress: [...publication.egress],
        acknowledgements: [...publication.acknowledgements],
        warnings: [...publication.warnings],
        description: publication.description,
        publishedAt: publication.publishedAt,
        publishedByType: 'user',
        publishedById: publication.publishedById,
        updatedAt: sql`now()`,
      })
      .where(and(scopedVersion(environmentId, id), eq(workflowVersions.status, 'draft')))
      .returning(),
  );
}

/** A published version leaves the public list and keeps everything else (C116.1). */
export async function archiveWorkflowVersion(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowVersionRow | null> {
  return firstOrNull(
    await tx
      .update(workflowVersions)
      .set({ status: 'archived', updatedAt: sql`now()` })
      .where(and(scopedVersion(environmentId, id), eq(workflowVersions.status, 'published')))
      .returning(),
  );
}

/** The public list (C112.6): published versions and the draft, newest first, never archived. */
export async function listWorkflowVersions(
  db: Db,
  environmentId: string,
  workflowId: string,
  page: PageRequest,
): Promise<Page<WorkflowVersionRow>> {
  return paginate(db, versionCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.environmentId, environmentId),
          eq(workflowVersions.workflowId, workflowId),
          inArray(workflowVersions.status, ['draft', 'published']),
          after,
        ),
      )
      .orderBy(...newestFirst(versionCursor))
      .limit(limit),
  );
}

export async function nextWorkflowVersionNumber(
  tx: Db,
  environmentId: string,
  workflowId: string,
): Promise<number> {
  const [row] = await tx
    .select({ highest: sql<number>`coalesce(max(${workflowVersions.versionNumber}), 0)::int` })
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.environmentId, environmentId),
        eq(workflowVersions.workflowId, workflowId),
      ),
    );
  return (row?.highest ?? 0) + 1;
}

export async function createWorkflowDeployment(
  tx: Db,
  environmentId: string,
  input: NewWorkflowDeployment,
): Promise<WorkflowDeploymentRow> {
  return inserted(
    await tx
      .insert(workflowDeployments)
      .values({
        id: input.id,
        environmentId,
        workflowId: input.workflowId,
        versions: [...input.versions],
      })
      .returning(),
    'workflow deployment',
  );
}

export async function getWorkflowDeployment(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WorkflowDeploymentRow | null> {
  return firstOrNull(
    await db.select().from(workflowDeployments).where(scopedDeployment(environmentId, id)).limit(1),
  );
}

export async function setWorkflowDeploymentStatus(
  tx: Db,
  environmentId: string,
  id: string,
  status: WorkflowDeploymentStatus,
): Promise<WorkflowDeploymentRow | null> {
  return firstOrNull(
    await tx
      .update(workflowDeployments)
      .set({ status, updatedAt: sql`now()` })
      .where(scopedDeployment(environmentId, id))
      .returning(),
  );
}

/** C116.3: a rollout's new percentages. */
export async function setWorkflowDeploymentVersions(
  tx: Db,
  environmentId: string,
  id: string,
  versions: readonly unknown[],
): Promise<WorkflowDeploymentRow | null> {
  return firstOrNull(
    await tx
      .update(workflowDeployments)
      .set({ versions: [...versions], updatedAt: sql`now()` })
      .where(scopedDeployment(environmentId, id))
      .returning(),
  );
}

/** Every `published` version of a workflow, newest first: the live one, or a rollout's two. */
export async function listPublishedWorkflowVersions(
  db: Db,
  environmentId: string,
  workflowId: string,
): Promise<WorkflowVersionRow[]> {
  return db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.environmentId, environmentId),
        eq(workflowVersions.workflowId, workflowId),
        eq(workflowVersions.status, 'published'),
      ),
    )
    .orderBy(desc(workflowVersions.versionNumber));
}

/** C121.3: the published versions with a step naming `workflowId`, for the widening warning. */
export async function listPublishedWorkflowVersionsCalling(
  db: Db,
  environmentId: string,
  workflowId: string,
): Promise<WorkflowVersionRow[]> {
  const step = JSON.stringify({ steps: [{ config: { 'workflow-id': workflowId } }] });
  return db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.environmentId, environmentId),
        eq(workflowVersions.status, 'published'),
        sql`${workflowVersions.definition} @> ${step}::jsonb`,
      ),
    );
}

/** C117.7, H18: how many other workflows `eventName` starts in this environment. */
export async function countWorkflowsListeningToEvent(
  db: Db,
  environmentId: string,
  eventName: string,
  exceptWorkflowId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.environmentId, environmentId),
        inArray(workflowTriggers.kind, ['trigger-event', 'trigger-verification']),
        eq(workflowTriggers.eventName, eventName),
        ne(workflowTriggers.workflowId, exceptWorkflowId),
      ),
    );
  return row?.total ?? 0;
}

/** The table and active test of each kind of reference. */
function referenceSource(kind: WorkflowReferenceKind) {
  switch (kind) {
    case 'inquiry-template':
      return {
        table: inquiryTemplates,
        active: eq(inquiryTemplates.status, 'active'),
      };
    case 'report-template':
      return { table: reportTemplates, active: eq(reportTemplates.status, 'active') };
    case 'list':
      return { table: lists, active: eq(lists.status, 'active') };
    case 'transaction-type':
      return { table: transactionTypes, active: eq(transactionTypes.status, 'active') };
    case 'account-type':
      return { table: accountTypes, active: undefined };
    case 'graph-query-template':
      return { table: graphQueryTemplates, active: eq(graphQueryTemplates.status, 'active') };
    case 'workflow':
      return { table: workflows, active: ne(workflows.status, 'archived') };
  }
  // Workflow 8B: a case kind's source is its owner's.
  return caseReferenceSource(kind);
}

/** C112.2, C116.4: the active objects of `kind` among `ids`, in this environment. */
export async function readWorkflowReferences(
  db: Db,
  environmentId: string,
  kind: WorkflowReferenceKind,
  ids: readonly string[],
): Promise<WorkflowReferenceRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const { table, active } = referenceSource(kind);
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(and(eq(table.environmentId, environmentId), inArray(table.id, [...ids]), active))
    .orderBy(table.id);
}

/** C112.2: the active objects of `kind` called `name`, at most two, in this environment. */
export async function findWorkflowReferences(
  db: Db,
  environmentId: string,
  kind: WorkflowReferenceKind,
  name: string,
): Promise<WorkflowReferenceRow[]> {
  const { table, active } = referenceSource(kind);
  return db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(and(eq(table.environmentId, environmentId), eq(table.name, name), active))
    .orderBy(table.id)
    .limit(2);
}

export interface WorkflowTypeFacts {
  /** C122.1: every status some active transaction type calls adverse. */
  transactionAdverseStatuses: string[];
  /** C128.3: whether every active type holds a contest route, and at least one exists. */
  transactionTypesContest: boolean;
  accountTypesContest: boolean;
  /** C128.4: active face and background lists. */
  faceLists: number;
}

/** C116.4: what the publish rules read of an environment's types and lists. */
export async function readWorkflowTypeFacts(
  db: Db,
  environmentId: string,
): Promise<WorkflowTypeFacts> {
  const transactions = await db
    .select({
      adverseStatuses: transactionTypes.adverseStatuses,
      contestRoute: transactionTypes.contestRoute,
    })
    .from(transactionTypes)
    .where(
      and(eq(transactionTypes.environmentId, environmentId), eq(transactionTypes.status, 'active')),
    );
  const accounts = await db
    .select({ contestRoute: accountTypes.contestRoute })
    .from(accountTypes)
    .where(eq(accountTypes.environmentId, environmentId));
  const [faces] = await db
    .select({ total: count() })
    .from(lists)
    .where(
      and(
        eq(lists.environmentId, environmentId),
        eq(lists.status, 'active'),
        inArray(lists.type, ['face', 'selfie-background']),
      ),
    );
  const contested = (rows: readonly { contestRoute: unknown }[]) =>
    rows.length > 0 && rows.every(({ contestRoute }) => contestRoute !== null);
  return {
    transactionAdverseStatuses: transactions.flatMap(({ adverseStatuses }) => adverseStatuses),
    transactionTypesContest: contested(transactions),
    accountTypesContest: contested(accounts),
    faceLists: faces?.total ?? 0,
  };
}

/** C128.4: the published flow and list configuration of each template. */
export async function readInquiryTemplateFlows(
  db: Db,
  environmentId: string,
  templateIds: readonly string[],
): Promise<
  {
    inquiryTemplateId: string;
    flow: Record<string, unknown>;
    listConfig: Record<string, unknown>;
  }[]
> {
  if (templateIds.length === 0) {
    return [];
  }
  return db
    .select({
      inquiryTemplateId: inquiryTemplateVersions.inquiryTemplateId,
      flow: inquiryTemplateVersions.flow,
      listConfig: inquiryTemplateVersions.listConfig,
    })
    .from(inquiryTemplateVersions)
    .where(
      and(
        eq(inquiryTemplateVersions.environmentId, environmentId),
        eq(inquiryTemplateVersions.status, 'published'),
        inArray(inquiryTemplateVersions.inquiryTemplateId, [...templateIds]),
      ),
    );
}

/** C121.5: a published version's warnings change when its publisher's standing does. */
export async function setWorkflowVersionWarnings(
  tx: Db,
  environmentId: string,
  id: string,
  warnings: readonly unknown[],
): Promise<void> {
  await tx
    .update(workflowVersions)
    .set({ warnings: [...warnings], updatedAt: sql`now()` })
    .where(scopedVersion(environmentId, id));
}
