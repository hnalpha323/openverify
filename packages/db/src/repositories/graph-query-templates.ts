/**
 * C102.1 (Workflow 7B): graph query templates and their versions, as C71: a draft changes, one
 * version per template is published under the template lock, publishing supersedes the published
 * one. Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signatures.
 */
import type { GraphTemplateStatus } from '@openverify/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  graphQueryTemplates,
  graphQueryTemplateVersions,
  type GraphQueryTemplateRow,
  type GraphQueryTemplateVersionRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

export interface GraphQueryTemplateFilters {
  statuses?: readonly GraphTemplateStatus[] | undefined;
}

const templateCursor = environmentCursor(graphQueryTemplates);

const isTemplate = (environmentId: string, id: string) =>
  and(eq(graphQueryTemplates.environmentId, environmentId), eq(graphQueryTemplates.id, id));

const isVersion = (environmentId: string, id: string) =>
  and(
    eq(graphQueryTemplateVersions.environmentId, environmentId),
    eq(graphQueryTemplateVersions.id, id),
  );

export async function createGraphQueryTemplate(
  tx: Db,
  environmentId: string,
  input: { id: string; name: string; version: { id: string; config: Record<string, unknown> } },
): Promise<GraphQueryTemplateRow> {
  return tx.transaction(async (inner) => {
    const template = inserted(
      await inner
        .insert(graphQueryTemplates)
        .values({ id: input.id, environmentId, name: input.name })
        .returning(),
      'createGraphQueryTemplate',
    );
    await inner.insert(graphQueryTemplateVersions).values({
      id: input.version.id,
      environmentId,
      graphQueryTemplateId: input.id,
      version: 1,
      config: input.version.config,
    });
    return template;
  });
}

export async function getGraphQueryTemplate(
  db: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryTemplateRow | null> {
  return firstOrNull(
    await db.select().from(graphQueryTemplates).where(isTemplate(environmentId, id)),
  );
}

/** The template's row, locked for a publish or an archive (C71). */
export async function lockGraphQueryTemplate(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryTemplateRow | null> {
  return firstOrNull(
    await tx.select().from(graphQueryTemplates).where(isTemplate(environmentId, id)).for('update'),
  );
}

/** `created_at DESC, id DESC` (C1). */
export async function listGraphQueryTemplates(
  db: Db,
  environmentId: string,
  filters: GraphQueryTemplateFilters,
  page: PageRequest,
): Promise<Page<GraphQueryTemplateRow>> {
  const status = equalsAny(graphQueryTemplates.status, filters.statuses);
  if (status === null) {
    return { items: [], next: null };
  }
  return paginate(db, templateCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(graphQueryTemplates)
      .where(and(eq(graphQueryTemplates.environmentId, environmentId), status, after))
      .orderBy(...newestFirst(templateCursor))
      .limit(limit),
  );
}

export async function updateGraphQueryTemplate(
  tx: Db,
  environmentId: string,
  id: string,
  changes: { name?: string; status?: GraphTemplateStatus },
): Promise<GraphQueryTemplateRow | null> {
  const set: Partial<typeof graphQueryTemplates.$inferInsert> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.status !== undefined) set.status = changes.status;
  if (Object.keys(set).length === 0) {
    return getGraphQueryTemplate(tx, environmentId, id);
  }
  return firstOrNull(
    await tx.update(graphQueryTemplates).set(set).where(isTemplate(environmentId, id)).returning(),
  );
}

/** A new draft, numbered after the template's latest under its lock. */
export async function createGraphQueryTemplateVersion(
  tx: Db,
  environmentId: string,
  input: { id: string; graphQueryTemplateId: string; config: Record<string, unknown> },
): Promise<GraphQueryTemplateVersionRow> {
  return tx.transaction(async (inner) => {
    await lockGraphQueryTemplate(inner, environmentId, input.graphQueryTemplateId);
    const [latest] = await inner
      .select({
        version: sql<number>`coalesce(max(${graphQueryTemplateVersions.version}), 0)`.mapWith(
          Number,
        ),
      })
      .from(graphQueryTemplateVersions)
      .where(
        and(
          eq(graphQueryTemplateVersions.environmentId, environmentId),
          eq(graphQueryTemplateVersions.graphQueryTemplateId, input.graphQueryTemplateId),
        ),
      );
    return inserted(
      await inner
        .insert(graphQueryTemplateVersions)
        .values({
          id: input.id,
          environmentId,
          graphQueryTemplateId: input.graphQueryTemplateId,
          version: (latest?.version ?? 0) + 1,
          config: input.config,
        })
        .returning(),
      'createGraphQueryTemplateVersion',
    );
  });
}

export async function getGraphQueryTemplateVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<GraphQueryTemplateVersionRow | null> {
  return firstOrNull(
    await db.select().from(graphQueryTemplateVersions).where(isVersion(environmentId, id)),
  );
}

const versionCursor = environmentCursor(graphQueryTemplateVersions);

export interface ListGraphQueryTemplateVersionsOptions extends PageRequest {
  templateIds?: readonly string[] | undefined;
}

/** `GET /graph-query-template-versions`: newest first, as `listInquiryTemplateVersions`. */
export async function listGraphQueryTemplateVersions(
  db: Db,
  environmentId: string,
  options: ListGraphQueryTemplateVersionsOptions = {},
): Promise<Page<GraphQueryTemplateVersionRow>> {
  const filters = allFilters([
    eq(graphQueryTemplateVersions.environmentId, environmentId),
    equalsAny(graphQueryTemplateVersions.graphQueryTemplateId, options.templateIds),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, versionCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(graphQueryTemplateVersions)
      .where(and(...filters, after))
      .orderBy(...newestFirst(versionCursor))
      .limit(limit),
  );
}

/** The latest and the published version of each template, for the template resource. */
export async function listCurrentGraphQueryTemplateVersions(
  db: Db,
  environmentId: string,
  templateIds: readonly string[],
): Promise<
  ReadonlyMap<
    string,
    { latest: GraphQueryTemplateVersionRow; published: GraphQueryTemplateVersionRow | null }
  >
> {
  const current = new Map<
    string,
    { latest: GraphQueryTemplateVersionRow; published: GraphQueryTemplateVersionRow | null }
  >();
  if (templateIds.length === 0) {
    return current;
  }
  const rows = await db
    .select()
    .from(graphQueryTemplateVersions)
    .where(
      and(
        eq(graphQueryTemplateVersions.environmentId, environmentId),
        inArray(graphQueryTemplateVersions.graphQueryTemplateId, [...templateIds]),
      ),
    )
    .orderBy(desc(graphQueryTemplateVersions.version));
  for (const row of rows) {
    const seen = current.get(row.graphQueryTemplateId);
    if (seen === undefined) {
      current.set(row.graphQueryTemplateId, {
        latest: row,
        published: row.status === 'published' ? row : null,
      });
    } else if (row.status === 'published') {
      seen.published = row;
    }
  }
  return current;
}

/** A draft's config; `null` when it is not a draft here. */
export async function updateGraphQueryTemplateVersionDraft(
  tx: Db,
  environmentId: string,
  id: string,
  config: Record<string, unknown>,
): Promise<GraphQueryTemplateVersionRow | null> {
  return firstOrNull(
    await tx
      .update(graphQueryTemplateVersions)
      .set({ config })
      .where(and(isVersion(environmentId, id), eq(graphQueryTemplateVersions.status, 'draft')))
      .returning(),
  );
}

/**
 * Publishes a draft and supersedes the published version, under the template lock; `null` when
 * it is not a draft here.
 */
export async function publishGraphQueryTemplateVersion(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<GraphQueryTemplateVersionRow | null> {
  return tx.transaction(async (inner) => {
    const version = await getGraphQueryTemplateVersion(inner, environmentId, id);
    if (version === null) {
      return null;
    }
    await lockGraphQueryTemplate(inner, environmentId, version.graphQueryTemplateId);
    const draft = await getGraphQueryTemplateVersion(inner, environmentId, id);
    if (draft?.status !== 'draft') {
      return null;
    }
    await inner
      .update(graphQueryTemplateVersions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(graphQueryTemplateVersions.environmentId, environmentId),
          eq(graphQueryTemplateVersions.graphQueryTemplateId, version.graphQueryTemplateId),
          eq(graphQueryTemplateVersions.status, 'published'),
        ),
      );
    return firstOrNull(
      await inner
        .update(graphQueryTemplateVersions)
        .set({ status: 'published', publishedAt: at })
        .where(isVersion(environmentId, id))
        .returning(),
    );
  });
}
