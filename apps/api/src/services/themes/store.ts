/**
 * C160.1, C160.5, C160.6 (`api-themes`, Workflow 9B): the rows of `theme_sets`,
 * `theme_set_revisions` and `theme_assets`, every query scoped to one environment.
 *
 * They sit here rather than in `packages/db/src/repositories/{theme-sets,theme-assets}.ts`, the
 * plan's place, because the repositories index that would export them is a shared file in Workflow
 * 9B (contractDeviation: `integration-9b` may move them there with the index export).
 */
import type { LastUpdater, ThemeAssetKind } from '@openverify/contracts';
import {
  environments,
  themeAssets,
  themeSetRevisions,
  themeSets,
  type Db,
  type ThemeAssetRow,
  type ThemeSetRevisionRow,
  type ThemeSetRow,
} from '@openverify/db';
import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { BadRequestError } from '../../errors.js';

export type { ThemeAssetRow, ThemeSetRevisionRow, ThemeSetRow };

const firstOrNull = <T>(rows: readonly T[]): T | null => rows[0] ?? null;

function inserted<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${what} wrote no row`);
  }
  return row;
}

// Theme sets ------------------------------------------------------------------------------------

export interface NewThemeSet {
  id: string;
  name: string;
  styles: Record<string, unknown>;
  creator: LastUpdater;
}

/** Writes a set at revision 1 and its first revision, in the caller's transaction. */
export async function insertThemeSetInTx(
  tx: Db,
  environmentId: string,
  input: NewThemeSet,
): Promise<ThemeSetRow> {
  const row = inserted(
    await tx
      .insert(themeSets)
      .values({ id: input.id, environmentId, name: input.name, styles: input.styles, revision: 1 })
      .returning(),
    'insertThemeSetInTx',
  );
  await tx.insert(themeSetRevisions).values({
    environmentId,
    themeSetId: row.id,
    revision: 1,
    name: row.name,
    styles: row.styles,
    creatorType: input.creator.type,
    creatorId: input.creator.id,
    restoredFrom: null,
  });
  return row;
}

export async function getThemeSet(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ThemeSetRow | null> {
  return firstOrNull(
    await db
      .select()
      .from(themeSets)
      .where(and(eq(themeSets.environmentId, environmentId), eq(themeSets.id, id)))
      .limit(1),
  );
}

/** The set's row under `FOR UPDATE`, so two saves never write one revision number. */
export async function lockThemeSet(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<ThemeSetRow | null> {
  return firstOrNull(
    await tx
      .select()
      .from(themeSets)
      .where(and(eq(themeSets.environmentId, environmentId), eq(themeSets.id, id)))
      .for('update')
      .limit(1),
  );
}

/** The first of `ids` that names an active set of the environment, in the order given. */
export async function firstActiveThemeSet(
  db: Db,
  environmentId: string,
  ids: readonly (string | null | undefined)[],
): Promise<ThemeSetRow | null> {
  const wanted = ids.filter((id): id is string => typeof id === 'string');
  if (wanted.length === 0) {
    return null;
  }
  const rows = await db
    .select()
    .from(themeSets)
    .where(
      and(
        eq(themeSets.environmentId, environmentId),
        inArray(themeSets.id, wanted),
        eq(themeSets.status, 'active'),
      ),
    );
  return wanted.map((id) => rows.find((row) => row.id === id)).find((row) => row !== undefined) ?? null;
}

/** The active sets of the environment with this name (C160.8's promote re-resolves by name). */
export async function activeThemeSetsNamed(
  db: Db,
  environmentId: string,
  name: string,
): Promise<ThemeSetRow[]> {
  return db
    .select()
    .from(themeSets)
    .where(
      and(
        eq(themeSets.environmentId, environmentId),
        eq(themeSets.name, name),
        eq(themeSets.status, 'active'),
      ),
    )
    .orderBy(desc(themeSets.createdAt), desc(themeSets.id));
}

export interface ThemeSetSave {
  name: string;
  styles: Record<string, unknown>;
  creator: LastUpdater;
  /** The revision a restore copied; `null` for an edit. */
  restoredFrom: number | null;
  now: Date;
}

/** Writes the next revision of a locked set and moves the set to it. */
export async function saveThemeSetRevisionInTx(
  tx: Db,
  current: ThemeSetRow,
  save: ThemeSetSave,
): Promise<ThemeSetRow> {
  const revision = current.revision + 1;
  await tx.insert(themeSetRevisions).values({
    environmentId: current.environmentId,
    themeSetId: current.id,
    revision,
    name: save.name,
    styles: save.styles,
    creatorType: save.creator.type,
    creatorId: save.creator.id,
    restoredFrom: save.restoredFrom,
  });
  return inserted(
    await tx
      .update(themeSets)
      .set({ name: save.name, styles: save.styles, revision, updatedAt: save.now })
      .where(and(eq(themeSets.environmentId, current.environmentId), eq(themeSets.id, current.id)))
      .returning(),
    'saveThemeSetRevisionInTx',
  );
}

/** Archives a locked set; an archived one is answered as it is. */
export async function archiveThemeSetInTx(
  tx: Db,
  current: ThemeSetRow,
  now: Date,
): Promise<ThemeSetRow> {
  if (current.status === 'archived') {
    return current;
  }
  return inserted(
    await tx
      .update(themeSets)
      .set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(and(eq(themeSets.environmentId, current.environmentId), eq(themeSets.id, current.id)))
      .returning(),
    'archiveThemeSetInTx',
  );
}

export interface ThemeSetPage {
  items: ThemeSetRow[];
  next: string | null;
}

/**
 * C1's order (newest first, ties by id), by status, from `page[after]`.
 * @throws {BadRequestError} for an `after` that names no set of this environment.
 */
export async function listThemeSets(
  db: Db,
  environmentId: string,
  options: { statuses?: readonly string[] | undefined; after?: string | undefined; size: number },
): Promise<ThemeSetPage> {
  const filters: SQL[] = [eq(themeSets.environmentId, environmentId)];
  if (options.statuses !== undefined) {
    filters.push(inArray(themeSets.status, [...options.statuses] as ThemeSetRow['status'][]));
  }
  if (options.after !== undefined) {
    const cursor = await getThemeSet(db, environmentId, options.after);
    if (cursor === null) {
      throw new BadRequestError('page[after] does not name a record in this list.');
    }
    filters.push(
      sql`(${themeSets.createdAt}, ${themeSets.id}) < (
        select c.created_at, c.id from theme_sets as c
         where c.id = ${cursor.id} and c.environment_id = ${environmentId})`,
    );
  }
  const rows = await db
    .select()
    .from(themeSets)
    .where(and(...filters))
    .orderBy(desc(themeSets.createdAt), desc(themeSets.id))
    .limit(options.size + 1);
  const items = rows.slice(0, options.size);
  const last = items.at(-1);
  return { items, next: rows.length > options.size && last !== undefined ? last.id : null };
}

// Revisions -------------------------------------------------------------------------------------

export async function getThemeSetRevision(
  db: Db,
  environmentId: string,
  themeSetId: string,
  revision: number,
): Promise<ThemeSetRevisionRow | null> {
  return firstOrNull(
    await db
      .select()
      .from(themeSetRevisions)
      .where(
        and(
          eq(themeSetRevisions.environmentId, environmentId),
          eq(themeSetRevisions.themeSetId, themeSetId),
          eq(themeSetRevisions.revision, revision),
        ),
      )
      .limit(1),
  );
}

/** A set's revisions, newest first, below `before` when given. */
export async function listThemeSetRevisions(
  db: Db,
  environmentId: string,
  themeSetId: string,
  options: { before?: number | undefined; size: number },
): Promise<{ items: ThemeSetRevisionRow[]; next: number | null }> {
  const rows = await db
    .select()
    .from(themeSetRevisions)
    .where(
      and(
        eq(themeSetRevisions.environmentId, environmentId),
        eq(themeSetRevisions.themeSetId, themeSetId),
        ...(options.before === undefined ? [] : [lt(themeSetRevisions.revision, options.before)]),
      ),
    )
    .orderBy(desc(themeSetRevisions.revision))
    .limit(options.size + 1);
  const items = rows.slice(0, options.size);
  const last = items.at(-1);
  return { items, next: rows.length > options.size && last !== undefined ? last.revision : null };
}

// The environment's default ---------------------------------------------------------------------

/** C174.6: the environment's `default-theme-set-id`, `null` when unset. */
export async function defaultThemeSetIdOf(db: Db, environmentId: string): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ settings: environments.settings })
      .from(environments)
      .where(eq(environments.id, environmentId))
      .limit(1),
  );
  const id = row?.settings['default-theme-set-id'];
  return typeof id === 'string' ? id : null;
}

// Assets ----------------------------------------------------------------------------------------

export type NewThemeAsset = Omit<ThemeAssetRow, 'environmentId' | 'createdAt' | 'updatedAt'>;

export async function insertThemeAssetInTx(
  tx: Db,
  environmentId: string,
  input: NewThemeAsset,
): Promise<ThemeAssetRow> {
  return inserted(
    await tx
      .insert(themeAssets)
      .values({ ...input, environmentId })
      .returning(),
    'insertThemeAssetInTx',
  );
}

export async function getThemeAsset(
  db: Db,
  environmentId: string,
  id: string,
  kind?: ThemeAssetKind,
): Promise<ThemeAssetRow | null> {
  return firstOrNull(
    await db
      .select()
      .from(themeAssets)
      .where(
        and(
          eq(themeAssets.environmentId, environmentId),
          eq(themeAssets.id, id),
          ...(kind === undefined ? [] : [eq(themeAssets.kind, kind)]),
        ),
      )
      .limit(1),
  );
}
