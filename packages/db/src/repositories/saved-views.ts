/**
 * C165.1, C165.2, C165.5 (Workflow 9B): `saved_views`. Owner: `api-exports`: the create, the
 * owner's and the environment's shared views, the read, the change and the delete. A view's filters
 * never hold a personal-data key (C165.2), which the API refuses before anything is stored.
 */
import type { SavedViewList } from '@openverify/core';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import { savedViews, type SavedViewRow } from '../tables/exports.js';
import { firstOrNull, inserted } from './rows.js';

/** A `saved_views` row; its filters never hold a personal-data key (C165.2). */
export type SavedViewRecord = SavedViewRow;

export interface NewSavedView {
  id: string;
  ownerId: string;
  list: SavedViewList;
  name: string;
  filters: Record<string, string | string[]>;
  columns: readonly string[];
  sort: string | null;
  shared: boolean;
  at: Date;
}

/** What a change sets; a member left out is unchanged. */
export interface SavedViewChanges {
  name?: string | undefined;
  filters?: Record<string, string | string[]> | undefined;
  columns?: readonly string[] | undefined;
  sort?: string | null | undefined;
  shared?: boolean | undefined;
}

const viewIn = (environmentId: string, id: string) =>
  and(eq(savedViews.environmentId, environmentId), eq(savedViews.id, id));

export async function createSavedViewRow(
  tx: Db,
  environmentId: string,
  input: NewSavedView,
): Promise<SavedViewRecord> {
  return inserted(
    await tx
      .insert(savedViews)
      .values({
        id: input.id,
        environmentId,
        ownerId: input.ownerId,
        list: input.list,
        name: input.name,
        filters: input.filters,
        columns: [...input.columns],
        sort: input.sort,
        shared: input.shared,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning(),
    'createSavedViewRow',
  );
}

/** One view of the environment, or `null`. */
export async function getSavedViewRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<SavedViewRecord | null> {
  return firstOrNull(await db.select().from(savedViews).where(viewIn(environmentId, id)));
}

/**
 * The views `ownerId` owns and the environment's shared ones, of `lists`, oldest first (a console
 * keeps them in the order they were made).
 */
export async function listSavedViewRows(
  db: Db,
  environmentId: string,
  options: { ownerId: string; lists: readonly SavedViewList[] },
): Promise<SavedViewRecord[]> {
  if (options.lists.length === 0) {
    return [];
  }
  return db
    .select()
    .from(savedViews)
    .where(
      and(
        eq(savedViews.environmentId, environmentId),
        inArray(savedViews.list, [...options.lists]),
        or(eq(savedViews.ownerId, options.ownerId), eq(savedViews.shared, true)),
      ),
    )
    .orderBy(asc(savedViews.createdAt), asc(savedViews.id));
}

export async function updateSavedViewRow(
  tx: Db,
  environmentId: string,
  id: string,
  changes: SavedViewChanges,
  at: Date,
): Promise<SavedViewRecord | null> {
  return firstOrNull(
    await tx
      .update(savedViews)
      .set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.filters === undefined ? {} : { filters: changes.filters }),
        ...(changes.columns === undefined ? {} : { columns: [...changes.columns] }),
        ...(changes.sort === undefined ? {} : { sort: changes.sort }),
        ...(changes.shared === undefined ? {} : { shared: changes.shared }),
        updatedAt: at,
      })
      .where(viewIn(environmentId, id))
      .returning(),
  );
}

export async function deleteSavedViewRow(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<boolean> {
  const deleted = await tx
    .delete(savedViews)
    .where(viewIn(environmentId, id))
    .returning({ id: savedViews.id });
  return deleted.length > 0;
}
