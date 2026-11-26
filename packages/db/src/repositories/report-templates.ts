/**
 * C71: report templates and their versions: creation with version 1 published, reads, lists,
 * the name and status, drafts, draft updates and publication under the template row lock.
 *
 * Owner: `api-reports` (Workflow 6A Stage 3). The file and its export line in
 * `repositories/index.ts` are frozen by `foundation-6` (Stage 1b).
 */
import type { ReportType } from '@openverify/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  reportTemplateVersions,
  reportTemplates,
  watchlistSources,
  type ReportTemplateRow,
  type ReportTemplateVersionRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted, type OneOrMany } from './rows.js';

/** The owner of this repository file. */
export const REPORT_TEMPLATES_REPOSITORY_OWNER = 'api-reports';

export type ReportTemplateStatusValue = ReportTemplateRow['status'];
export type ReportTemplateVersionStatusValue = ReportTemplateVersionRow['status'];

/** A template with its published version (C71.1 `current-version`). */
export type ReportTemplateWithVersion = ReportTemplateRow & {
  currentVersion: ReportTemplateVersionRow;
};

export interface NewReportTemplateInput {
  id: string;
  name: string;
  reportType: ReportType;
  /** Version 1, published with the template; `config` as stored (source lists pinned). */
  version: { id: string; config: Record<string, unknown> };
}

const templateCursor = environmentCursor(reportTemplates);
const versionCursor = environmentCursor(reportTemplateVersions);

const templateIn = (environmentId: string, id: string) =>
  and(eq(reportTemplates.id, id), eq(reportTemplates.environmentId, environmentId));
const versionIn = (environmentId: string, id: string) =>
  and(eq(reportTemplateVersions.id, id), eq(reportTemplateVersions.environmentId, environmentId));

/** C71.1: a template and its version 1, published, in one transaction. */
export async function createReportTemplate(
  db: Db,
  environmentId: string,
  input: NewReportTemplateInput,
): Promise<ReportTemplateWithVersion> {
  return db.transaction(async (tx) => {
    const template = inserted(
      await tx
        .insert(reportTemplates)
        .values({ id: input.id, environmentId, name: input.name, reportType: input.reportType })
        .returning(),
      'createReportTemplate',
    );
    const currentVersion = inserted(
      await tx
        .insert(reportTemplateVersions)
        .values({
          id: input.version.id,
          environmentId,
          reportTemplateId: template.id,
          version: 1,
          config: input.version.config,
          status: 'published',
          publishedAt: sql`now()`,
        })
        .returning(),
      'createReportTemplate',
    );
    return { ...template, currentVersion };
  });
}

/** Each template with its published version. */
async function withCurrentVersions(
  db: Db,
  environmentId: string,
  templates: readonly ReportTemplateRow[],
): Promise<ReportTemplateWithVersion[]> {
  if (templates.length === 0) {
    return [];
  }
  const versions = await db
    .select()
    .from(reportTemplateVersions)
    .where(
      and(
        eq(reportTemplateVersions.environmentId, environmentId),
        eq(reportTemplateVersions.status, 'published'),
        inArray(
          reportTemplateVersions.reportTemplateId,
          templates.map((template) => template.id),
        ),
      ),
    );
  const published = new Map(versions.map((version) => [version.reportTemplateId, version]));
  return templates.map((template) => {
    const currentVersion = published.get(template.id);
    if (currentVersion === undefined) {
      throw new Error(`report template ${template.id} has no published version`);
    }
    return { ...template, currentVersion };
  });
}

export async function getReportTemplate(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ReportTemplateWithVersion | null> {
  const rows = await db
    .select()
    .from(reportTemplates)
    .where(templateIn(environmentId, id))
    .limit(1);
  return firstOrNull(await withCurrentVersions(db, environmentId, rows));
}

export interface ListReportTemplatesOptions extends PageRequest {
  reportType?: OneOrMany<ReportType> | undefined;
  status?: OneOrMany<ReportTemplateStatusValue> | undefined;
}

/** Templates newest first, each with its published version. */
export async function listReportTemplates(
  db: Db,
  environmentId: string,
  options: ListReportTemplatesOptions = {},
): Promise<Page<ReportTemplateWithVersion>> {
  const filters = allFilters([
    eq(reportTemplates.environmentId, environmentId),
    equalsAny(reportTemplates.reportType, options.reportType),
    equalsAny(reportTemplates.status, options.status),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  const page = await paginate(db, templateCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(reportTemplates)
      .where(and(...filters, after))
      .orderBy(...newestFirst(templateCursor))
      .limit(limit),
  );
  return { items: await withCurrentVersions(db, environmentId, page.items), next: page.next };
}

/** C71.1 `PATCH /report-templates/:id`: name and status. `null` when it is not here. */
export async function updateReportTemplate(
  db: Db,
  environmentId: string,
  id: string,
  changes: { name?: string | undefined; status?: ReportTemplateStatusValue | undefined },
): Promise<ReportTemplateWithVersion | null> {
  const set: Partial<typeof reportTemplates.$inferInsert> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.status !== undefined) set.status = changes.status;
  const rows = await db
    .update(reportTemplates)
    .set(set)
    .where(templateIn(environmentId, id))
    .returning();
  return firstOrNull(await withCurrentVersions(db, environmentId, rows));
}

export async function getReportTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ReportTemplateVersionRow | null> {
  return firstOrNull(
    await db.select().from(reportTemplateVersions).where(versionIn(environmentId, id)).limit(1),
  );
}

/** The template's published version, or `null` (unknown template, or none published). */
export async function getPublishedReportTemplateVersion(
  db: Db,
  environmentId: string,
  reportTemplateId: string,
): Promise<ReportTemplateVersionRow | null> {
  return firstOrNull(
    await db
      .select()
      .from(reportTemplateVersions)
      .where(
        and(
          eq(reportTemplateVersions.environmentId, environmentId),
          eq(reportTemplateVersions.reportTemplateId, reportTemplateId),
          eq(reportTemplateVersions.status, 'published'),
        ),
      )
      .limit(1),
  );
}

export interface ListReportTemplateVersionsOptions extends PageRequest {
  reportTemplateId?: OneOrMany<string> | undefined;
  status?: OneOrMany<ReportTemplateVersionStatusValue> | undefined;
}

/** Versions newest first. */
export async function listReportTemplateVersions(
  db: Db,
  environmentId: string,
  options: ListReportTemplateVersionsOptions = {},
): Promise<Page<ReportTemplateVersionRow>> {
  const filters = allFilters([
    eq(reportTemplateVersions.environmentId, environmentId),
    equalsAny(reportTemplateVersions.reportTemplateId, options.reportTemplateId),
    equalsAny(reportTemplateVersions.status, options.status),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, versionCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(reportTemplateVersions)
      .where(and(...filters, after))
      .orderBy(...newestFirst(versionCursor))
      .limit(limit),
  );
}

/** Locks the template row; `null` when it is not here. */
async function lockTemplate(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<ReportTemplateRow | null> {
  return firstOrNull(
    await tx.select().from(reportTemplates).where(templateIn(environmentId, id)).for('update'),
  );
}

/**
 * C71.1: a draft numbered after the latest version, under the template lock. `null` when the
 * template is not here.
 */
export async function createDraftReportTemplateVersion(
  db: Db,
  environmentId: string,
  reportTemplateId: string,
  input: { id: string; config: Record<string, unknown> },
): Promise<ReportTemplateVersionRow | null> {
  return db.transaction(async (tx) => {
    if ((await lockTemplate(tx, environmentId, reportTemplateId)) === null) {
      return null;
    }
    const [latest] = await tx
      .select({
        version: sql<number>`coalesce(max(${reportTemplateVersions.version}), 0)`.mapWith(Number),
      })
      .from(reportTemplateVersions)
      .where(eq(reportTemplateVersions.reportTemplateId, reportTemplateId));
    return inserted(
      await tx
        .insert(reportTemplateVersions)
        .values({
          id: input.id,
          environmentId,
          reportTemplateId,
          version: (latest?.version ?? 0) + 1,
          config: input.config,
          status: 'draft',
        })
        .returning(),
      'createDraftReportTemplateVersion',
    );
  });
}

/** Replaces a draft's configuration. `null` when it is not here or no longer a draft. */
export async function updateDraftReportTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
  config: Record<string, unknown>,
): Promise<ReportTemplateVersionRow | null> {
  return firstOrNull(
    await db
      .update(reportTemplateVersions)
      .set({ config })
      .where(and(versionIn(environmentId, id), eq(reportTemplateVersions.status, 'draft')))
      .returning(),
  );
}

export type ReportTemplateVersionPublish =
  | {
      status: 'published';
      version: ReportTemplateVersionRow;
      superseded: ReportTemplateVersionRow | null;
    }
  | { status: 'not_draft'; version: ReportTemplateVersionRow };

/**
 * C71.1: the draft becomes the template's published version and the previous one `superseded`,
 * in one transaction under the template row lock. `check` runs under the lock with the draft, so
 * a rule it enforces holds at publication; it throws to refuse. `null` when it is not here.
 */
export async function publishReportTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
  check: (draft: ReportTemplateVersionRow) => Promise<void> = () => Promise.resolve(),
): Promise<ReportTemplateVersionPublish | null> {
  return db.transaction(async (tx) => {
    const version = await getReportTemplateVersion(tx, environmentId, id);
    if (version === null) {
      return null;
    }
    await lockTemplate(tx, environmentId, version.reportTemplateId);
    const draft = await getReportTemplateVersion(tx, environmentId, id);
    if (draft?.status !== 'draft') {
      return { status: 'not_draft' as const, version: draft ?? version };
    }
    await check(draft);
    const superseded = firstOrNull(
      await tx
        .update(reportTemplateVersions)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(reportTemplateVersions.environmentId, environmentId),
            eq(reportTemplateVersions.reportTemplateId, draft.reportTemplateId),
            eq(reportTemplateVersions.status, 'published'),
          ),
        )
        .returning(),
    );
    const published = inserted(
      await tx
        .update(reportTemplateVersions)
        .set({ status: 'published', publishedAt: sql`now()` })
        .where(versionIn(environmentId, id))
        .returning(),
      'publishReportTemplateVersion',
    );
    return { status: 'published' as const, version: published, superseded };
  });
}

/**
 * C71.2: the enablement of the given watchlist sources, as the reconciliation recorded it (C76.4),
 * for resolving a template's default source list. A source without a row is left out.
 */
export async function listWatchlistSourceRows(
  db: Db,
  ids: readonly string[],
): Promise<{ id: string; enabled: boolean; sandboxOnly: boolean }[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({
      id: watchlistSources.id,
      enabled: watchlistSources.enabled,
      sandboxOnly: watchlistSources.sandboxOnly,
    })
    .from(watchlistSources)
    .where(inArray(watchlistSources.id, [...ids]));
}

/** C76.4: an active report template's pinned source list, from its published version. */
export interface ReportTemplateSourceList {
  reportTemplateId: string;
  /** The template's name (owner decision 17: the sources page names each warned template). */
  name: string;
  reportType: string;
  searchLists: string[];
}

/** C76.4: the environment's active templates with their pinned `search-lists`. */
export async function listReportTemplateSourceLists(
  db: Db,
  environmentId: string,
): Promise<ReportTemplateSourceList[]> {
  const { rows } = (await db.execute(
    sql`select t.id as "reportTemplateId", t.name as "name", t.report_type as "reportType",
               v.config -> 'search-lists' as "searchLists"
          from report_templates t
          join report_template_versions v
            on v.environment_id = t.environment_id and v.report_template_id = t.id
           and v.status = 'published'
         where t.environment_id = ${environmentId} and t.status = 'active'
           and jsonb_typeof(v.config -> 'search-lists') = 'array'
         order by t.id`,
  )) as { rows: Record<string, unknown>[] };
  return rows.map((row) => ({
    reportTemplateId: String(row.reportTemplateId),
    name: String(row.name),
    reportType: String(row.reportType),
    searchLists: (
      (typeof row.searchLists === 'string'
        ? JSON.parse(row.searchLists)
        : row.searchLists) as unknown[]
    ).filter((id): id is string => typeof id === 'string'),
  }));
}
