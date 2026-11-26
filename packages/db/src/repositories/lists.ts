/**
 * C97, C99.5, C99.9 (Workflow 7B): the `lists` rows. Owner: `api-lists`; `foundation-7b` (Stage 1b
 * (L)) froze the signatures and built {@link anyListScreenedByAll}, which the transition's
 * screening hook needs.
 */
import { LIST_KINDS, LIST_KIND_REGISTRY, type ListKind, type ListStatus } from '@openverify/core';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { lists, type ListRow } from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

/** What creates a list; the kind-specific members follow C97.2. */
export interface NewList {
  id: string;
  type: ListKind;
  name: string;
  itemRetentionDays?: number | null;
  screenAtCompletion?: boolean;
  fieldKey?: string | null;
  caseSensitive?: boolean;
  defaultRegion?: string | null;
  useForCompromisedIds?: boolean;
  allowFuzzyNameFirst?: boolean;
  /** C122.1: `block` when left out. */
  purpose?: ListRow['purpose'];
}

/** C97.1 `PATCH /lists/:id`: the five members that may change. */
export interface ListChanges {
  name?: string;
  itemRetentionDays?: number | null;
  screenAtCompletion?: boolean;
  useForCompromisedIds?: boolean;
  purpose?: ListRow['purpose'];
}

export interface ListFilters {
  statuses?: readonly ListStatus[] | undefined;
  kinds?: readonly ListKind[] | undefined;
}

/** C99.5: the kinds `list-config.screen: all` reads. */
const KINDS_SCREENED_BY_ALL: readonly ListKind[] = LIST_KINDS.filter(
  (kind) => LIST_KIND_REGISTRY[kind].screenedByAll,
);

/**
 * C99.4, C99.5: whether `screen: all` selects any list here: an active list with
 * `screen-at-completion` of a kind `all` reads. A kind the environment does not collect still
 * counts: the screening records it as `kind_not_collected` (V21), which only a row can do.
 */
export async function anyListScreenedByAll(tx: Db, environmentId: string): Promise<boolean> {
  const rows = await tx
    .select({ present: sql<number>`1` })
    .from(lists)
    .where(
      and(
        eq(lists.environmentId, environmentId),
        eq(lists.status, 'active'),
        eq(lists.screenAtCompletion, true),
        inArray(lists.type, [...KINDS_SCREENED_BY_ALL]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

const listCursor = environmentCursor(lists);

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(lists.environmentId, environmentId), eq(lists.id, id));

export async function createList(db: Db, environmentId: string, input: NewList): Promise<ListRow> {
  return inserted(
    await db
      .insert(lists)
      .values({
        id: input.id,
        environmentId,
        type: input.type,
        name: input.name,
        itemRetentionDays: input.itemRetentionDays ?? null,
        screenAtCompletion: input.screenAtCompletion ?? true,
        fieldKey: input.fieldKey ?? null,
        caseSensitive: input.caseSensitive ?? false,
        defaultRegion: input.defaultRegion ?? null,
        useForCompromisedIds: input.useForCompromisedIds ?? false,
        allowFuzzyNameFirst: input.allowFuzzyNameFirst ?? false,
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
      })
      .returning(),
    'createList',
  );
}

export async function getList(db: Db, environmentId: string, id: string): Promise<ListRow | null> {
  return firstOrNull(
    await db.select().from(lists).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/** The lists of `ids` in the environment; an id it does not hold is left out. */
export async function getLists(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<ListRow[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select()
    .from(lists)
    .where(and(eq(lists.environmentId, environmentId), inArray(lists.id, [...ids])));
}

/** `GET /lists`: `created_at DESC, id DESC`. */
export async function listLists(
  db: Db,
  environmentId: string,
  filters: ListFilters,
  page: PageRequest,
): Promise<Page<ListRow>> {
  const conditions = allFilters([
    eq(lists.environmentId, environmentId),
    equalsAny(lists.status, filters.statuses),
    equalsAny(lists.type, filters.kinds),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, listCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(lists)
      .where(and(...conditions, after))
      .orderBy(...newestFirst(listCursor))
      .limit(limit),
  );
}

export async function updateList(
  db: Db,
  environmentId: string,
  id: string,
  changes: ListChanges,
): Promise<ListRow | null> {
  return firstOrNull(
    await db
      .update(lists)
      .set({
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.itemRetentionDays === undefined
          ? {}
          : { itemRetentionDays: changes.itemRetentionDays }),
        ...(changes.screenAtCompletion === undefined
          ? {}
          : { screenAtCompletion: changes.screenAtCompletion }),
        ...(changes.useForCompromisedIds === undefined
          ? {}
          : { useForCompromisedIds: changes.useForCompromisedIds }),
        ...(changes.purpose === undefined ? {} : { purpose: changes.purpose }),
      })
      .where(inEnvironment(environmentId, id))
      .returning(),
  );
}

/**
 * C97.1 `DELETE /lists/:id`: archives; items stay readable and stop matching. Outcome 25 (C127.12):
 * the version moves, so a monitored custom-list report gets a run that reads `list_archived` rather
 * than keep an old "no match".
 */
export async function archiveList(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<ListRow | null> {
  const archived = firstOrNull(
    await db
      .update(lists)
      .set({ status: 'archived', archivedAt: at, version: sql`${lists.version} + 1` })
      .where(and(inEnvironment(environmentId, id), eq(lists.status, 'active')))
      .returning(),
  );
  return archived ?? getList(db, environmentId, id);
}

/** C97.5: the active lists that count against the limit. */
export async function countActiveLists(db: Db, environmentId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(lists)
    .where(and(eq(lists.environmentId, environmentId), eq(lists.status, 'active')));
  return row?.value ?? 0;
}

/** C97.5: one list creation at a time per environment, so the limit is never overshot. */
export async function lockListLimit(tx: Db, environmentId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`lists:${environmentId}`}, 0))`,
  );
}

/** C99.9: the active government ID number lists with `use-for-compromised-ids`. */
export async function listCompromisedIdLists(db: Db, environmentId: string): Promise<ListRow[]> {
  return db
    .select()
    .from(lists)
    .where(
      and(
        eq(lists.environmentId, environmentId),
        eq(lists.status, 'active'),
        eq(lists.type, 'government-id-number'),
        eq(lists.useForCompromisedIds, true),
      ),
    );
}

/** C99.5: what `list-config.screen: all` selects: active, `screen-at-completion`, of its kinds. */
export async function listListsScreenedByAll(db: Db, environmentId: string): Promise<ListRow[]> {
  return db
    .select()
    .from(lists)
    .where(
      and(
        eq(lists.environmentId, environmentId),
        eq(lists.status, 'active'),
        eq(lists.screenAtCompletion, true),
        inArray(lists.type, [...KINDS_SCREENED_BY_ALL]),
      ),
    );
}

/** C99.4: every active list of `kinds`, what `POST /lists/match` reads without `list-ids`. */
export async function listActiveListsOfKinds(
  db: Db,
  environmentId: string,
  kinds: readonly ListKind[],
): Promise<ListRow[]> {
  if (kinds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(lists)
    .where(
      and(
        eq(lists.environmentId, environmentId),
        eq(lists.status, 'active'),
        inArray(lists.type, [...kinds]),
      ),
    );
}
