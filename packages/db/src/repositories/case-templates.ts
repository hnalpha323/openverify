/**
 * C130 (Workflow 8B): case templates and their versions. Owner `api-cases`; `foundation-8b` froze
 * the names. As C71 and C104: a draft changes, one version per template is published, and publishing
 * supersedes it under the template's row lock.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { CaseSlaStartsOn, CaseTemplateStatus } from '@openverify/core';
import type { Db } from '../client.js';
import {
  caseTemplates,
  caseTemplateVersions,
  type CaseTemplateRow,
  type CaseTemplateVersionRow,
} from '../tables/cases.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, createdAtRange, equalsAny, firstOrNull, inserted } from './rows.js';

const templateIn = (environmentId: string, id: string) =>
  and(eq(caseTemplates.environmentId, environmentId), eq(caseTemplates.id, id));

const versionIn = (environmentId: string, id: string) =>
  and(eq(caseTemplateVersions.environmentId, environmentId), eq(caseTemplateVersions.id, id));

export const getCaseTemplateRow = async (
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseTemplateRow | null> =>
  firstOrNull(await db.select().from(caseTemplates).where(templateIn(environmentId, id)).limit(1));

/** C130.2: the template row `FOR UPDATE`; publishing and archiving run under it. */
export const lockCaseTemplateRow = async (
  tx: Db,
  environmentId: string,
  id: string,
): Promise<CaseTemplateRow | null> =>
  firstOrNull(
    await tx.select().from(caseTemplates).where(templateIn(environmentId, id)).for('update'),
  );

/** The template's published version, or `null` when it has none. */
export const getPublishedCaseTemplateVersion = async (
  db: Db,
  environmentId: string,
  caseTemplateId: string,
): Promise<CaseTemplateVersionRow | null> =>
  firstOrNull(
    await db
      .select()
      .from(caseTemplateVersions)
      .where(
        and(
          eq(caseTemplateVersions.environmentId, environmentId),
          eq(caseTemplateVersions.caseTemplateId, caseTemplateId),
          eq(caseTemplateVersions.status, 'published'),
        ),
      )
      .limit(1),
  );

/** The template's open draft, or `null`. */
export const getDraftCaseTemplateVersion = async (
  db: Db,
  environmentId: string,
  caseTemplateId: string,
): Promise<CaseTemplateVersionRow | null> =>
  firstOrNull(
    await db
      .select()
      .from(caseTemplateVersions)
      .where(
        and(
          eq(caseTemplateVersions.environmentId, environmentId),
          eq(caseTemplateVersions.caseTemplateId, caseTemplateId),
          eq(caseTemplateVersions.status, 'draft'),
        ),
      )
      .limit(1),
  );

/** The template's newest version, whatever its status: what a new draft starts from. */
export const getLatestCaseTemplateVersion = async (
  db: Db,
  environmentId: string,
  caseTemplateId: string,
): Promise<CaseTemplateVersionRow | null> =>
  firstOrNull(
    await db
      .select()
      .from(caseTemplateVersions)
      .where(
        and(
          eq(caseTemplateVersions.environmentId, environmentId),
          eq(caseTemplateVersions.caseTemplateId, caseTemplateId),
        ),
      )
      .orderBy(desc(caseTemplateVersions.version))
      .limit(1),
  );

export const getCaseTemplateVersionRow = async (
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseTemplateVersionRow | null> =>
  firstOrNull(
    await db.select().from(caseTemplateVersions).where(versionIn(environmentId, id)).limit(1),
  );

/** C130.2: a draft `FOR UPDATE`, so two edits of one draft never interleave. */
export const lockCaseTemplateVersionRow = async (
  tx: Db,
  environmentId: string,
  id: string,
): Promise<CaseTemplateVersionRow | null> =>
  firstOrNull(
    await tx.select().from(caseTemplateVersions).where(versionIn(environmentId, id)).for('update'),
  );

export interface NewCaseTemplate {
  id: string;
  name: string;
  key: string;
  visibleToRoles: readonly string[];
}

/** C130.1: a template; its key is unique per environment (`case_templates_environment_id_key_key`). */
export const createCaseTemplateRow = async (
  tx: Db,
  environmentId: string,
  input: NewCaseTemplate,
): Promise<CaseTemplateRow> =>
  inserted(
    await tx
      .insert(caseTemplates)
      .values({
        id: input.id,
        environmentId,
        name: input.name,
        key: input.key,
        visibleToRoles: [...input.visibleToRoles],
      })
      .returning(),
    'createCaseTemplateRow',
  );

export interface CaseTemplateChanges {
  name?: string;
  visibleToRoles?: readonly string[];
  status?: CaseTemplateStatus;
  archivedAt?: Date | null;
}

export const updateCaseTemplateRow = async (
  tx: Db,
  environmentId: string,
  id: string,
  changes: CaseTemplateChanges,
): Promise<CaseTemplateRow | null> =>
  firstOrNull(
    await tx
      .update(caseTemplates)
      .set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.visibleToRoles === undefined
          ? {}
          : { visibleToRoles: [...changes.visibleToRoles] }),
        ...(changes.status === undefined ? {} : { status: changes.status }),
        ...(changes.archivedAt === undefined ? {} : { archivedAt: changes.archivedAt }),
      })
      .where(templateIn(environmentId, id))
      .returning(),
  );

export interface CaseTemplateFilters {
  statuses?: readonly string[] | undefined;
  keys?: readonly string[] | undefined;
  createdAtStart?: Date | undefined;
  createdAtEnd?: Date | undefined;
}

const templateCursor = environmentCursor(caseTemplates);

/** `GET /case-templates`, newest first (C1). */
export async function listCaseTemplateRows(
  db: Db,
  environmentId: string,
  filters: CaseTemplateFilters,
  page: PageRequest,
): Promise<Page<CaseTemplateRow>> {
  const conditions = allFilters([
    equalsAny(caseTemplates.status, filters.statuses),
    equalsAny(caseTemplates.key, filters.keys),
    ...createdAtRange(caseTemplates.createdAt, filters),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, templateCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseTemplates)
      .where(and(eq(caseTemplates.environmentId, environmentId), ...conditions, after))
      .orderBy(...newestFirst(templateCursor))
      .limit(limit),
  );
}

/** The content of a version (C130.2), as the routes write it. */
export interface CaseTemplateVersionContent {
  fieldSchemas: readonly unknown[];
  statuses: readonly unknown[];
  resolutions: readonly string[];
  transitions: Readonly<Record<string, readonly string[]>> | null;
  defaultQueueId: string | null;
  assignmentPolicyId: string | null;
  slaPolicyId: string | null;
  slaStartsOn: CaseSlaStartsOn;
  heldObjectTypes: readonly string[];
  attachmentPolicy: Readonly<Record<string, unknown>> | null;
  notifyOnCreate: readonly string[];
  layoutModules: readonly unknown[] | null;
  /**
   * C172.1, C172.2, C172.4 (Workflow 9B Stage 1b (C)): the layout (`null` for the default), the
   * checklists and the preset comments; left out, a new version holds none.
   */
  layout?: Readonly<Record<string, unknown>> | null | undefined;
  checklists?: readonly unknown[] | undefined;
  presetComments?: readonly unknown[] | undefined;
}

const contentSet = (content: Partial<CaseTemplateVersionContent>) => ({
  ...(content.fieldSchemas === undefined ? {} : { fieldSchemas: [...content.fieldSchemas] }),
  ...(content.statuses === undefined ? {} : { statuses: [...content.statuses] }),
  ...(content.resolutions === undefined ? {} : { resolutions: [...content.resolutions] }),
  ...(content.transitions === undefined
    ? {}
    : {
        transitions:
          content.transitions === null
            ? null
            : Object.fromEntries(
                Object.entries(content.transitions).map(([key, to]) => [key, [...to]]),
              ),
      }),
  ...(content.defaultQueueId === undefined ? {} : { defaultQueueId: content.defaultQueueId }),
  ...(content.assignmentPolicyId === undefined
    ? {}
    : { assignmentPolicyId: content.assignmentPolicyId }),
  ...(content.slaPolicyId === undefined ? {} : { slaPolicyId: content.slaPolicyId }),
  ...(content.slaStartsOn === undefined ? {} : { slaStartsOn: content.slaStartsOn }),
  ...(content.heldObjectTypes === undefined
    ? {}
    : { heldObjectTypes: [...content.heldObjectTypes] }),
  ...(content.attachmentPolicy === undefined
    ? {}
    : {
        attachmentPolicy:
          content.attachmentPolicy === null ? null : { ...content.attachmentPolicy },
      }),
  ...(content.notifyOnCreate === undefined ? {} : { notifyOnCreate: [...content.notifyOnCreate] }),
  ...(content.layoutModules === undefined
    ? {}
    : { layoutModules: content.layoutModules === null ? null : [...content.layoutModules] }),
  ...(content.layout === undefined
    ? {}
    : { layout: content.layout === null ? null : { ...content.layout } }),
  ...(content.checklists === undefined ? {} : { checklists: [...content.checklists] }),
  ...(content.presetComments === undefined ? {} : { presetComments: [...content.presetComments] }),
});

/** A new draft (`ctmplv_`), numbered after the template's newest version. */
export async function createCaseTemplateVersionRow(
  tx: Db,
  environmentId: string,
  input: { id: string; caseTemplateId: string; content: CaseTemplateVersionContent },
): Promise<CaseTemplateVersionRow> {
  const latest = await getLatestCaseTemplateVersion(tx, environmentId, input.caseTemplateId);
  return inserted(
    await tx
      .insert(caseTemplateVersions)
      .values({
        id: input.id,
        environmentId,
        caseTemplateId: input.caseTemplateId,
        version: (latest?.version ?? 0) + 1,
        status: 'draft',
        ...contentSet(input.content),
        statuses: [...input.content.statuses],
      })
      .returning(),
    'createCaseTemplateVersionRow',
  );
}

/** A draft's content; `null` when it is not a draft of this environment. */
export const updateCaseTemplateVersionRow = async (
  tx: Db,
  environmentId: string,
  id: string,
  content: Partial<CaseTemplateVersionContent>,
): Promise<CaseTemplateVersionRow | null> =>
  firstOrNull(
    await tx
      .update(caseTemplateVersions)
      .set(contentSet(content))
      .where(and(versionIn(environmentId, id), eq(caseTemplateVersions.status, 'draft')))
      .returning(),
  );

/**
 * C130.2: publishes a draft at `at`, superseding the version published before it, under the
 * template's lock (the caller's). Answers the published row and the one it superseded.
 */
export async function publishCaseTemplateVersionRow(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<{ published: CaseTemplateVersionRow; superseded: CaseTemplateVersionRow | null }> {
  const draft = await getCaseTemplateVersionRow(tx, environmentId, id);
  if (draft?.status !== 'draft') {
    throw new Error('publishCaseTemplateVersionRow: not a draft of this environment');
  }
  const superseded = firstOrNull(
    await tx
      .update(caseTemplateVersions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(caseTemplateVersions.environmentId, environmentId),
          eq(caseTemplateVersions.caseTemplateId, draft.caseTemplateId),
          eq(caseTemplateVersions.status, 'published'),
        ),
      )
      .returning(),
  );
  const published = inserted(
    await tx
      .update(caseTemplateVersions)
      .set({ status: 'published', publishedAt: at })
      .where(versionIn(environmentId, id))
      .returning(),
    'publishCaseTemplateVersionRow',
  );
  return { published, superseded };
}

const versionCursor = environmentCursor(caseTemplateVersions);

/** `GET /case-template-versions`, newest first (C1). */
export async function listCaseTemplateVersionRows(
  db: Db,
  environmentId: string,
  filters: { caseTemplateIds?: readonly string[] | undefined } & {
    createdAtStart?: Date | undefined;
    createdAtEnd?: Date | undefined;
  },
  page: PageRequest,
): Promise<Page<CaseTemplateVersionRow>> {
  const conditions = allFilters([
    equalsAny(caseTemplateVersions.caseTemplateId, filters.caseTemplateIds),
    ...createdAtRange(caseTemplateVersions.createdAt, filters),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, versionCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseTemplateVersions)
      .where(and(eq(caseTemplateVersions.environmentId, environmentId), ...conditions, after))
      .orderBy(...newestFirst(versionCursor))
      .limit(limit),
  );
}

/** Each template's published and draft versions (for the template resource), by template id. */
export async function listCaseTemplateVersionHeads(
  db: Db,
  environmentId: string,
  caseTemplateIds: readonly string[],
): Promise<
  Map<string, { published: CaseTemplateVersionRow | null; draft: CaseTemplateVersionRow | null }>
> {
  const heads = new Map<
    string,
    { published: CaseTemplateVersionRow | null; draft: CaseTemplateVersionRow | null }
  >(caseTemplateIds.map((id) => [id, { published: null, draft: null }]));
  if (caseTemplateIds.length === 0) {
    return heads;
  }
  const rows = await db
    .select()
    .from(caseTemplateVersions)
    .where(
      and(
        eq(caseTemplateVersions.environmentId, environmentId),
        inArray(caseTemplateVersions.caseTemplateId, [...caseTemplateIds]),
        sql`${caseTemplateVersions.status} in ('published', 'draft')`,
      ),
    );
  for (const row of rows) {
    const head = heads.get(row.caseTemplateId);
    if (head !== undefined) {
      if (row.status === 'published') {
        head.published = row;
      } else {
        head.draft = row;
      }
    }
  }
  return heads;
}

/** The template ids of this environment among `ids`: what a key's restriction may name. */
export async function existingCaseTemplateIds(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }
  const rows = await db
    .select({ id: caseTemplates.id })
    .from(caseTemplates)
    .where(
      and(eq(caseTemplates.environmentId, environmentId), inArray(caseTemplates.id, [...ids])),
    );
  return new Set(rows.map(({ id }) => id));
}
