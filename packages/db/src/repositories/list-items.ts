/**
 * C97, C98 (Workflow 7B): `list_items`, their extra keys and the range and box side rows, and what
 * matching reads of them. Owner: `api-lists`; `foundation-7b` (Stage 1b (L)) froze the signatures.
 *
 * - Every write bumps the list's `version`; `item_count` counts the items that are not archived, so
 *   it is what the C97.5 limit reads. A caller that checks the limit holds {@link lockList}.
 * - Matching compares only what it may: `status = 'active'`, the process's `LIST_KEYS_VERSION`, and
 *   for a fingerprint the current blind-index key id. A row it leaves out is not "no match": its
 *   list answers `normaliser_outdated` or `key_rotated` through {@link listListItemHealth}.
 * - The sealed value is opened only for the rows a method names: a read of a list's candidates, or
 *   an item the API serves.
 */
import type { ListItemStatus, ListKeyKind, ListKind } from '@openverify/core';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, sealJson } from '../sealed.js';
import {
  listItemBackgrounds,
  listItemFaces,
  listItemGeo,
  listItemIpRanges,
  listItemKeys,
  listItems,
  listMatches,
  lists,
  type ListItemCreatorType,
  type ListItemRow,
  type ListRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { forgetStoredResponses, stubEventPayloads } from './redaction.js';
import type { DeleteOptions } from './retention.js';
import { allFilters, equalsAny, firstOrNull } from './rows.js';

/** One item to insert: the value as entered and its keys, computed by `listKeyInputs`. */
export interface NewListItem {
  id: string;
  /** The item as entered; sealed for `list_items.value#<id>`. */
  value: Readonly<Record<string, unknown>> | null;
  /** `null` on a biometric item, which has no key (C98.1). */
  matchKey: string | null;
  normaliserVersion: string;
  keyId?: string | null;
  countryCode?: string | null;
  status?: ListItemStatus;
  /** The extra probe keys of the multi-key kinds. */
  keys?: readonly { keyKind: ListKeyKind; matchKey: string }[];
  /** The plaintext range, for an IP range item (decision 28). */
  range?: string | null;
  /** The boxes of a geolocation item, as Postgres text; two across ±180° (C98.1). */
  boxes?: readonly string[];
  creator?: { type: ListItemCreatorType; id: string } | null;
}

/** What {@link insertListItems} did: a row that met the partial unique index is `alreadyPresent`. */
export interface ListItemInsertion {
  inserted: { id: string }[];
  alreadyPresent: number;
}

/** An item with its value opened; `value` is `null` once redacted. */
export interface ListItem extends Omit<ListItemRow, 'valueSealed'> {
  value: Readonly<Record<string, unknown>> | null;
  /** The list's kind, which the item's resource type names. */
  listKind: ListKind;
  /** A face or background item's side row (C97.1, C99.7); `null` on the other kinds. */
  biometric: { model: string | null; sourceInquiryId: string } | null;
}

/** The rows one insert carries; a 100,000-row import goes through in chunks. */
const INSERT_CHUNK = 500;

const itemCursor = environmentCursor(listItems);

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(listItems.environmentId, environmentId), eq(listItems.id, id));

/** The side rows of `ids`, environment first. */
const ofItems = (
  table: { environmentId: AnyPgColumn; itemId: AnyPgColumn },
  environmentId: string,
  ids: readonly string[],
) => and(eq(table.environmentId, environmentId), inArray(table.itemId, [...ids]));

/** The list's `version`, bumped by every item write, and its live count, moved by `delta`. */
async function bumpList(tx: Db, environmentId: string, listId: string, delta: number) {
  await tx
    .update(lists)
    .set({
      version: sql`${lists.version} + 1`,
      itemCount: sql`greatest(${lists.itemCount} + ${delta}, 0)`,
    })
    .where(and(eq(lists.environmentId, environmentId), eq(lists.id, listId)));
}

interface NewKeyRow {
  environmentId: string;
  itemId: string;
  keyKind: ListKeyKind;
  matchKey: string;
}

async function insertKeyRows(tx: Db, rows: readonly NewKeyRow[]) {
  if (rows.length > 0) {
    await tx
      .insert(listItemKeys)
      .values([...rows])
      .onConflictDoNothing();
  }
}

/** One item's side rows, for one statement per table per chunk. */
function sideRowsOf(
  environmentId: string,
  itemId: string,
  sides: { range?: string | null | undefined; boxes?: readonly string[] | undefined },
) {
  return {
    ranges: sides.range == null ? [] : [{ environmentId, itemId, range: sides.range }],
    boxes: (sides.boxes ?? []).map((bbox, part) => ({ environmentId, itemId, bbox, part })),
  };
}

async function insertSideRows(
  tx: Db,
  ranges: readonly ReturnType<typeof sideRowsOf>['ranges'][number][],
  boxes: readonly ReturnType<typeof sideRowsOf>['boxes'][number][],
) {
  if (ranges.length > 0) {
    await tx.insert(listItemIpRanges).values([...ranges]);
  }
  if (boxes.length > 0) {
    await tx.insert(listItemGeo).values([...boxes]);
  }
}

/**
 * C98.1, C100.5: inserts in `tx`, bumping the list's `version` and `item-count` once. A row whose
 * key is live in the list, or repeats one before it in `items`, counts as `alreadyPresent`.
 */
export async function insertListItems(
  tx: Db,
  environmentId: string,
  listId: string,
  items: readonly NewListItem[],
): Promise<ListItemInsertion> {
  const written: { id: string }[] = [];
  for (let start = 0; start < items.length; start += INSERT_CHUNK) {
    const chunk = items.slice(start, start + INSERT_CHUNK);
    const rows = await tx
      .insert(listItems)
      .values(
        chunk.map((item) => ({
          id: item.id,
          environmentId,
          listId,
          valueSealed:
            item.value === null ? null : sealJson(SEALED.listItemValue, item.id, item.value),
          matchKey: item.matchKey,
          countryCode: item.countryCode ?? null,
          normaliserVersion: item.normaliserVersion,
          keyId: item.keyId ?? null,
          status: item.status ?? 'active',
          createdByType: item.creator?.type ?? null,
          createdById: item.creator?.id ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [listItems.environmentId, listItems.listId, listItems.matchKey],
        where: sql`${listItems.archivedAt} is null and ${listItems.redactedAt} is null`,
      })
      .returning({ id: listItems.id });
    written.push(...rows);
    const ids = new Set(rows.map(({ id }) => id));
    const kept = chunk.filter(({ id }) => ids.has(id));
    await insertKeyRows(
      tx,
      kept.flatMap((item) =>
        (item.keys ?? []).map((key) => ({ environmentId, itemId: item.id, ...key })),
      ),
    );
    const sides = kept.map((item) => sideRowsOf(environmentId, item.id, item));
    await insertSideRows(
      tx,
      sides.flatMap(({ ranges }) => ranges),
      sides.flatMap(({ boxes }) => boxes),
    );
  }
  if (written.length > 0) {
    await bumpList(tx, environmentId, listId, written.length);
  }
  return { inserted: written, alreadyPresent: items.length - written.length };
}

/** The list under its row lock, so item writes and their limit check run one at a time. */
export async function lockList(tx: Db, environmentId: string, id: string): Promise<ListRow | null> {
  return firstOrNull(
    await tx
      .select()
      .from(lists)
      .where(and(eq(lists.environmentId, environmentId), eq(lists.id, id)))
      .for('update'),
  );
}

/** The live item holding `matchKey` in the list, when a value was already present. */
export async function getLiveListItemByKey(
  db: Db,
  environmentId: string,
  listId: string,
  matchKey: string,
): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ id: listItems.id })
      .from(listItems)
      .where(
        and(
          eq(listItems.environmentId, environmentId),
          eq(listItems.listId, listId),
          eq(listItems.matchKey, matchKey),
          isNull(listItems.archivedAt),
          isNull(listItems.redactedAt),
        ),
      )
      .limit(1),
  );
  return row?.id ?? null;
}

const SERVED_COLUMNS = {
  item: listItems,
  listKind: lists.type,
  faceModel: listItemFaces.model,
  faceSource: listItemFaces.sourceInquiryId,
  backgroundSource: listItemBackgrounds.sourceInquiryId,
};

interface ServedRow {
  item: ListItemRow;
  listKind: ListKind;
  faceModel: string | null;
  faceSource: string | null;
  backgroundSource: string | null;
}

/** The value opened, with the kind and a biometric item's side row. */
function toListItem({
  item,
  listKind,
  faceModel,
  faceSource,
  backgroundSource,
}: ServedRow): ListItem {
  const { valueSealed, ...rest } = item;
  const source = faceSource ?? backgroundSource;
  return {
    ...rest,
    listKind,
    value:
      valueSealed === null
        ? null
        : (openJson(SEALED.listItemValue, item.id, valueSealed) as ListItem['value']),
    biometric: source === null ? null : { model: faceModel, sourceInquiryId: source },
  };
}

const served = (db: Db) =>
  db
    .select(SERVED_COLUMNS)
    .from(listItems)
    .innerJoin(
      lists,
      and(eq(lists.environmentId, listItems.environmentId), eq(lists.id, listItems.listId)),
    )
    .leftJoin(
      listItemFaces,
      and(
        eq(listItemFaces.environmentId, listItems.environmentId),
        eq(listItemFaces.itemId, listItems.id),
      ),
    )
    .leftJoin(
      listItemBackgrounds,
      and(
        eq(listItemBackgrounds.environmentId, listItems.environmentId),
        eq(listItemBackgrounds.itemId, listItems.id),
      ),
    );

export async function getListItem(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ListItem | null> {
  const row = firstOrNull(await served(db).where(inEnvironment(environmentId, id)).limit(1));
  return row === null ? null : toListItem(row);
}

/** `GET /list-items?filter[list-id]=`: `created_at DESC, id DESC`. */
export async function listListItems(
  db: Db,
  environmentId: string,
  filters: { listId: string; statuses?: readonly ListItemStatus[] | undefined },
  page: PageRequest,
): Promise<Page<ListItem>> {
  const conditions = allFilters([
    eq(listItems.environmentId, environmentId),
    eq(listItems.listId, filters.listId),
    equalsAny(listItems.status, filters.statuses),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, itemCursor, environmentId, page, async (after, limit) =>
    (
      await served(db)
        .where(and(...conditions, after))
        .orderBy(...newestFirst(itemCursor))
        .limit(limit)
    ).map(toListItem),
  );
}

/** C127.12: one list a write changed, and how many of its items, for `stageListUpdated`. */
export interface ChangedList {
  listId: string;
  items: number;
}

/** What an item redaction took (F20, V25). */
export interface ListItemRedaction {
  storageKeys: string[];
  changedLists: ChangedList[];
  redactedItemIds: string[];
}

/** C97.1 `DELETE`: archives; `changed` says whether this call did. */
export async function archiveListItem(
  db: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<(ListItem & { changed: boolean }) | null> {
  return db.transaction(async (tx) => {
    const archived = await tx
      .update(listItems)
      .set({ status: 'archived', archivedAt: at })
      .where(and(inEnvironment(environmentId, id), ne(listItems.status, 'archived')))
      .returning({ listId: listItems.listId });
    const [row] = archived;
    if (row !== undefined) {
      await bumpList(tx, environmentId, row.listId, -1);
    }
    const item = await getListItem(tx, environmentId, id);
    return item === null ? null : { ...item, changed: row !== undefined };
  });
}

/** What the matching reads of a key search. */
export interface ListItemKeyQuery {
  listIds: readonly string[];
  keys: readonly string[];
  /** The kinds of `list_item_keys` to read (the index leads with the kind). */
  keyKinds: readonly ListKeyKind[];
  /** Only rows of this `LIST_KEYS_VERSION` are compared (C98.2). */
  normaliserVersion: string;
  /** The current blind-index key id; a keyed item under another is not compared (C94.4). */
  keyId: string | null;
}

/** The rows a method may compare: live, current, and under the current key where keyed. */
function comparable(query: {
  listIds: readonly string[];
  normaliserVersion?: string;
  keyId?: string | null;
}): SQL | undefined {
  return and(
    inArray(listItems.listId, [...query.listIds]),
    eq(listItems.status, 'active'),
    query.normaliserVersion === undefined
      ? undefined
      : eq(listItems.normaliserVersion, query.normaliserVersion),
    query.keyId === undefined || query.keyId === null
      ? undefined
      : or(isNull(listItems.keyId), eq(listItems.keyId, query.keyId)),
  );
}

/** C99.2: the active items that hold a key, and which key each hit. */
export async function findListItemsByKeys(
  db: Db,
  environmentId: string,
  query: ListItemKeyQuery,
): Promise<{ itemId: string; listId: string; key: string }[]> {
  if (query.listIds.length === 0 || query.keys.length === 0) {
    return [];
  }
  const direct = await db
    .select({ itemId: listItems.id, listId: listItems.listId, key: listItems.matchKey })
    .from(listItems)
    .where(
      and(
        eq(listItems.environmentId, environmentId),
        inArray(listItems.matchKey, [...query.keys]),
        comparable(query),
      ),
    );
  const extra =
    query.keyKinds.length === 0
      ? []
      : await db
          .select({ itemId: listItems.id, listId: listItems.listId, key: listItemKeys.matchKey })
          .from(listItemKeys)
          .innerJoin(
            listItems,
            and(
              eq(listItems.environmentId, listItemKeys.environmentId),
              eq(listItems.id, listItemKeys.itemId),
            ),
          )
          .where(
            and(
              eq(listItemKeys.environmentId, environmentId),
              inArray(listItemKeys.keyKind, [...query.keyKinds]),
              inArray(listItemKeys.matchKey, [...query.keys]),
              comparable(query),
            ),
          );
  return [
    ...direct.flatMap(({ key, ...row }) => (key === null ? [] : [{ ...row, key }])),
    ...extra,
  ];
}

/** C98.2: whether each list holds a live item it cannot compare; one entry per list. */
export async function listListItemHealth(
  db: Db,
  environmentId: string,
  listIds: readonly string[],
  current: { normaliserVersion: string; keyId: string | null },
): Promise<Map<string, { outdated: boolean; rotated: boolean }>> {
  const health = new Map(listIds.map((id) => [id, { outdated: false, rotated: false }]));
  if (listIds.length === 0) {
    return health;
  }
  const live = and(
    eq(listItems.environmentId, environmentId),
    inArray(listItems.listId, [...listIds]),
    ne(listItems.status, 'archived'),
  );
  const unusable = await db
    .selectDistinct({
      listId: listItems.listId,
      outdated: sql<boolean>`${listItems.normaliserVersion} <> ${current.normaliserVersion}`,
      rotated:
        current.keyId === null
          ? sql<boolean>`false`
          : sql<boolean>`coalesce(${listItems.keyId} <> ${current.keyId}, false)`,
    })
    .from(listItems)
    .where(
      and(
        live,
        or(
          ne(listItems.normaliserVersion, current.normaliserVersion),
          current.keyId === null
            ? undefined
            : and(isNotNull(listItems.keyId), ne(listItems.keyId, current.keyId)),
        ),
      ),
    );
  for (const { listId, outdated, rotated } of unusable) {
    const entry = health.get(listId);
    if (entry !== undefined) {
      entry.outdated ||= outdated;
      entry.rotated ||= rotated;
    }
  }
  return health;
}

/** C99.2: the active range items that contain `address`, through the SP-GiST index. */
export async function findListItemsInRange(
  db: Db,
  environmentId: string,
  query: { listIds: readonly string[]; address: string; normaliserVersion: string },
): Promise<{ itemId: string; listId: string }[]> {
  if (query.listIds.length === 0) {
    return [];
  }
  return db
    .select({ itemId: listItems.id, listId: listItems.listId })
    .from(listItemIpRanges)
    .innerJoin(
      listItems,
      and(
        eq(listItems.environmentId, listItemIpRanges.environmentId),
        eq(listItems.id, listItemIpRanges.itemId),
      ),
    )
    .where(
      and(
        sql`${listItemIpRanges.range} >>= ${query.address}::inet`,
        eq(listItemIpRanges.environmentId, environmentId),
        comparable(query),
      ),
    );
}

/** C98.2: the active country items of `codes`, matched on the plaintext column. */
export async function findCountryListItems(
  db: Db,
  environmentId: string,
  query: { listIds: readonly string[]; codes: readonly string[]; normaliserVersion: string },
): Promise<{ itemId: string; listId: string; countryCode: string }[]> {
  if (query.listIds.length === 0 || query.codes.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      itemId: listItems.id,
      listId: listItems.listId,
      countryCode: listItems.countryCode,
    })
    .from(listItems)
    .where(
      and(
        eq(listItems.environmentId, environmentId),
        inArray(listItems.countryCode, [...query.codes]),
        comparable(query),
      ),
    );
  return rows.flatMap(({ countryCode, ...row }) =>
    countryCode === null ? [] : [{ ...row, countryCode }],
  );
}

const openedValue = (id: string, sealed: ListItemRow['valueSealed']) =>
  (sealed === null ? {} : openJson(SEALED.listItemValue, id, sealed)) as Readonly<
    Record<string, unknown>
  >;

/** C99.2: the active geolocation items whose boxes overlap, with their sealed points opened. */
export async function findGeoListItems(
  db: Db,
  environmentId: string,
  query: { listIds: readonly string[]; boxes: readonly string[]; normaliserVersion: string },
): Promise<{ itemId: string; listId: string; value: Readonly<Record<string, unknown>> }[]> {
  if (query.listIds.length === 0 || query.boxes.length === 0) {
    return [];
  }
  const rows = await db
    .selectDistinct({ id: listItems.id, listId: listItems.listId, sealed: listItems.valueSealed })
    .from(listItemGeo)
    .innerJoin(
      listItems,
      and(
        eq(listItems.environmentId, listItemGeo.environmentId),
        eq(listItems.id, listItemGeo.itemId),
      ),
    )
    .where(
      and(
        or(...query.boxes.map((box) => sql`${listItemGeo.bbox} && ${box}::box`)),
        eq(listItemGeo.environmentId, environmentId),
        comparable(query),
      ),
    );
  return rows.map(({ id, listId, sealed }) => ({
    itemId: id,
    listId,
    value: openedValue(id, sealed),
  }));
}

/** C99.2 (F17): at most `limit` candidates by last-name key, their values opened. */
export async function findNameCandidates(
  db: Db,
  environmentId: string,
  query: {
    listId: string;
    keys: readonly string[];
    limit: number;
    normaliserVersion: string;
  },
): Promise<{ itemId: string; value: Readonly<Record<string, unknown>> }[]> {
  if (query.keys.length === 0) {
    return [];
  }
  const rows = await db
    .selectDistinct({ id: listItems.id, sealed: listItems.valueSealed })
    .from(listItemKeys)
    .innerJoin(
      listItems,
      and(
        eq(listItems.environmentId, listItemKeys.environmentId),
        eq(listItems.id, listItemKeys.itemId),
      ),
    )
    .where(
      and(
        eq(listItemKeys.environmentId, environmentId),
        eq(listItemKeys.keyKind, 'identifier-name-last'),
        inArray(listItemKeys.matchKey, [...query.keys]),
        comparable({ listIds: [query.listId], normaliserVersion: query.normaliserVersion }),
      ),
    )
    .limit(query.limit);
  return rows.map(({ id, sealed }) => ({ itemId: id, value: openedValue(id, sealed) }));
}

/** One item as the C98.2 rebuild reads it: its value and what its list says about its keys. */
export interface ListItemForRebuild {
  id: string;
  environmentId: string;
  listId: string;
  kind: ListKind;
  value: Readonly<Record<string, unknown>> | null;
  matchKey: string | null;
  normaliserVersion: string;
  keyId: string | null;
  fieldKey: string | null;
  caseSensitive: boolean;
  defaultRegion: string | null;
  allowFuzzyNameFirst: boolean;
}

/** C98.2: the next page of live items by id, across environments. */
export async function listListItemsForRebuild(
  db: Db,
  page: { afterId: string | null; limit: number },
): Promise<ListItemForRebuild[]> {
  const rows = await db
    .select({
      item: listItems,
      kind: lists.type,
      fieldKey: lists.fieldKey,
      caseSensitive: lists.caseSensitive,
      defaultRegion: lists.defaultRegion,
      allowFuzzyNameFirst: lists.allowFuzzyNameFirst,
    })
    .from(listItems)
    .innerJoin(
      lists,
      and(eq(lists.environmentId, listItems.environmentId), eq(lists.id, listItems.listId)),
    )
    .where(
      and(
        isNull(listItems.redactedAt),
        isNull(listItems.archivedAt),
        page.afterId === null ? undefined : gt(listItems.id, page.afterId),
      ),
    )
    .orderBy(asc(listItems.id))
    .limit(page.limit);
  return rows.map(({ item, ...list }) => ({
    id: item.id,
    environmentId: item.environmentId,
    listId: item.listId,
    value: item.valueSealed === null ? null : openedValue(item.id, item.valueSealed),
    matchKey: item.matchKey,
    normaliserVersion: item.normaliserVersion,
    keyId: item.keyId,
    ...list,
  }));
}

/** The keys C98.2 recomputed for one item. */
export interface ListItemKeysRewrite {
  id: string;
  listId: string;
  matchKey: string;
  normaliserVersion: string;
  keys: readonly { keyKind: ListKeyKind; matchKey: string }[];
  range?: string | null;
  boxes?: readonly string[];
}

/**
 * C98.2: replaces an item's keys, in one transaction, bumping the list. `merged`: the new key is
 * live on another item of the list, so this one is archived and the other stays.
 */
export async function rewriteListItemKeys(
  db: Db,
  environmentId: string,
  rewrite: ListItemKeysRewrite,
): Promise<'rewritten' | 'merged'> {
  return db.transaction(async (tx) => {
    const { id, listId, matchKey } = rewrite;
    const holder = await getLiveListItemByKey(tx, environmentId, listId, matchKey);
    if (holder !== null && holder !== id) {
      const archived = await tx
        .update(listItems)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(and(inEnvironment(environmentId, id), ne(listItems.status, 'archived')))
        .returning({ id: listItems.id });
      if (archived.length > 0) {
        await bumpList(tx, environmentId, listId, -1);
      }
      return 'merged';
    }
    await tx
      .update(listItems)
      .set({ matchKey, normaliserVersion: rewrite.normaliserVersion })
      .where(inEnvironment(environmentId, id));
    await tx.delete(listItemKeys).where(ofItems(listItemKeys, environmentId, [id]));
    await insertKeyRows(
      tx,
      rewrite.keys.map((key) => ({ environmentId, itemId: id, ...key })),
    );
    await tx.delete(listItemIpRanges).where(ofItems(listItemIpRanges, environmentId, [id]));
    await tx.delete(listItemGeo).where(ofItems(listItemGeo, environmentId, [id]));
    const { ranges, boxes } = sideRowsOf(environmentId, id, rewrite);
    await insertSideRows(tx, ranges, boxes);
    await bumpList(tx, environmentId, listId, 0);
    return 'rewritten';
  });
}

/**
 * C98.4: nulls `value`, `match_key` and `country_code`, deletes the keys and side rows, sets
 * `redacted_at`, archives, and calls `stubEventPayloads` and `forgetStoredResponses` for the ids.
 * A match keeps its record and loses its link to the item. Returns the storage objects to delete
 * after the commit. An item of another environment, or already redacted, is left.
 */
export async function redactListItems(
  tx: Db,
  environmentId: string,
  ids: readonly string[],
  at: Date,
): Promise<ListItemRedaction> {
  if (ids.length === 0) {
    return { storageKeys: [], changedLists: [], redactedItemIds: [] };
  }
  const target = and(
    eq(listItems.environmentId, environmentId),
    inArray(listItems.id, [...ids]),
    isNull(listItems.redactedAt),
  );
  const before = await tx
    .select({ id: listItems.id, listId: listItems.listId, status: listItems.status })
    .from(listItems)
    .where(target)
    .for('update');
  if (before.length === 0) {
    return { storageKeys: [], changedLists: [], redactedItemIds: [] };
  }
  const redacted = before.map(({ id }) => id);
  await tx
    .update(listItems)
    .set({
      valueSealed: null,
      matchKey: null,
      countryCode: null,
      status: 'archived',
      archivedAt: sql`coalesce(${listItems.archivedAt}, ${at.toISOString()}::timestamptz)`,
      redactedAt: at,
    })
    .where(and(eq(listItems.environmentId, environmentId), inArray(listItems.id, redacted)));
  await tx.delete(listItemKeys).where(ofItems(listItemKeys, environmentId, redacted));
  await tx.delete(listItemIpRanges).where(ofItems(listItemIpRanges, environmentId, redacted));
  await tx.delete(listItemGeo).where(ofItems(listItemGeo, environmentId, redacted));
  await tx.delete(listItemFaces).where(ofItems(listItemFaces, environmentId, redacted));
  const backgrounds = await tx
    .delete(listItemBackgrounds)
    .where(ofItems(listItemBackgrounds, environmentId, redacted))
    .returning({ key: listItemBackgrounds.maskedFileKey });
  await tx
    .update(listMatches)
    .set({ listItemId: null })
    .where(
      and(eq(listMatches.environmentId, environmentId), inArray(listMatches.listItemId, redacted)),
    );
  const live = new Map<string, number>();
  const taken = new Map<string, number>();
  for (const { listId, status } of before) {
    live.set(listId, (live.get(listId) ?? 0) + (status === 'archived' ? 0 : 1));
    taken.set(listId, (taken.get(listId) ?? 0) + 1);
  }
  for (const [listId, count] of live) {
    await bumpList(tx, environmentId, listId, -count);
  }
  await stubEventPayloads(tx, environmentId, redacted, at);
  await forgetStoredResponses(tx, environmentId, redacted);
  return {
    storageKeys: backgrounds.flatMap(({ key }) => (key === null ? [] : [key])),
    changedLists: [...taken].map(([listId, items]) => ({ listId, items })),
    redactedItemIds: redacted,
  };
}

const DEFAULT_REDACTION_BATCH = 500;

/** What the C16 pass passes for item retention. */
export interface ExpiredListItemOptions extends DeleteOptions {
  /**
   * Deletes the masked objects of background items, after the commit. Without it those items wait
   * for a pass that can: a redaction that dropped the side row would orphan the object for good.
   */
  deleteObjects?: ((keys: readonly string[]) => Promise<void>) | undefined;
  /** C127.12, C128.1 (F20, V25): what each environment's batch took, in its transaction. */
  onRedacted?:
    ((tx: Db, environmentId: string, redaction: ListItemRedaction) => Promise<void>) | undefined;
}

/**
 * C98.4 (C16 pass): redacts items past their list's `item-retention-days`, one batch at a time.
 * Returns how many went.
 */
export async function redactExpiredListItems(
  db: Db,
  options: ExpiredListItemOptions = {},
): Promise<number> {
  const at = options.now ?? new Date();
  const { deleteObjects, onRedacted } = options;
  const { count, storageKeys } = await db.transaction(async (tx) => {
    const due = await tx
      .select({ id: listItems.id, environmentId: listItems.environmentId })
      .from(listItems)
      .innerJoin(
        lists,
        and(eq(lists.environmentId, listItems.environmentId), eq(lists.id, listItems.listId)),
      )
      .where(
        and(
          isNull(listItems.redactedAt),
          isNotNull(lists.itemRetentionDays),
          deleteObjects === undefined ? ne(lists.type, 'selfie-background') : undefined,
          lte(
            listItems.createdAt,
            sql`${at.toISOString()}::timestamptz - make_interval(days => ${lists.itemRetentionDays})`,
          ),
        ),
      )
      .limit(options.limit ?? DEFAULT_REDACTION_BATCH)
      .for('update', { of: listItems, skipLocked: true });
    const byEnvironment = new Map<string, string[]>();
    for (const { id, environmentId } of due) {
      byEnvironment.set(environmentId, [...(byEnvironment.get(environmentId) ?? []), id]);
    }
    const keys: string[] = [];
    for (const [environmentId, ids] of byEnvironment) {
      const redaction = await redactListItems(tx, environmentId, ids, at);
      keys.push(...redaction.storageKeys);
      await onRedacted?.(tx, environmentId, redaction);
    }
    return { count: due.length, storageKeys: keys };
  });
  if (storageKeys.length > 0) {
    await deleteObjects?.(storageKeys);
  }
  return count;
}
