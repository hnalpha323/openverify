/**
 * C97.4, C98.4, C99.7 (Workflow 7B): face and background items and their side rows. Owner:
 * `api-biometric-lists`.
 *
 * A biometric item has no value and no match key: its side row holds its own sealed copy of a
 * template (Phase 4 deletes a declined inquiry's), or a layout and the envelope object of a
 * person-masked image. There is no ANN index: a template is compared in the worker's memory and a
 * layout by an exact scan, so the Phase 4 privacy finding stands.
 *
 * Lock order: the inquiry first (C40.6), then the item, then its list, as `redactListItems` and the
 * C16 pass do. Every write that changes what a list compares bumps its `version`, which is how the
 * worker's decrypted cache learns of it (C99.7): the writer may be another process.
 */
import { LIST_KIND_REGISTRY, type ListKind, type ListStatus } from '@openverify/core';
import { and, asc, eq, inArray, isNotNull, isNull, l2Distance, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { withSensitiveParameters } from '../errors.js';
import type { ChangedList, ListItemRedaction } from './list-items.js';
import {
  environments,
  listItemBackgrounds,
  listItemFaces,
  listItems,
  listMatches,
  lists,
  type ListItemCreatorType,
} from '../schema.js';
import { openValue, sealValue, type Sealed } from '../sealed.js';
import type { BackgroundLayoutInput } from './face-templates.js';
import { forgetStoredResponses, stubEventPayloads } from './redaction.js';
import { DEFAULT_FACE_TEMPLATE_SETTINGS } from './retention.js';
import { firstOrNull } from './rows.js';
import { encodeFaceTemplate } from './selfie-captures.js';

export type BiometricListKind = 'face' | 'selfie-background';

/** A face item's embedding: the repository seals it for `list_item_faces.template#<item id>`. */
export interface ListItemFaceEmbedding {
  itemId: string;
  embedding: readonly number[];
  model: string;
}

/** A background item's layout and its envelope object (the masked image). */
export interface ListItemBackgroundEmbedding extends BackgroundLayoutInput {
  itemId: string;
  maskedFileKey: string;
  maskedFileWrappedDek: string;
}

/** What creates a pending item: no value and no key (C98.1), only its source (C99.7). */
export interface NewBiometricItem {
  itemId: string;
  listId: string;
  kind: BiometricListKind;
  sourceInquiryId: string;
  normaliserVersion: string;
  creator: { type: ListItemCreatorType; id: string } | null;
}

/** A face or background item, its list and its side row; nothing of the template or the layout. */
export interface BiometricItem {
  itemId: string;
  listId: string;
  kind: BiometricListKind;
  listStatus: ListStatus;
  status: string;
  redactedAt: Date | null;
  sourceInquiryId: string;
  model: string | null;
  maskedFileKey: string | null;
  maskedFileWrappedDek: string | null;
}

/** A list as the matcher finds it: `active` items are compared, `pending` ones cannot be yet. */
export interface BiometricListState {
  id: string;
  kind: BiometricListKind;
  status: ListStatus;
  version: number;
  active: number;
  pending: number;
}

/** One template of a list; `template` is the opened `encodeFaceTemplate` text. */
export interface ListFaceTemplate {
  itemId: string;
  template: string;
  model: string;
}

/** One candidate of the exact layout scan, with its envelope object. */
export interface ListBackgroundCandidate {
  itemId: string;
  distance: number;
  maskedFileKey: string;
  maskedFileWrappedDek: string;
}

/** The id of an item a sweep found, and its environment. */
export interface BiometricItemRef {
  environmentId: string;
  itemId: string;
}

const BIOMETRIC_KINDS: readonly ListKind[] = (Object.keys(LIST_KIND_REGISTRY) as ListKind[]).filter(
  (kind) => LIST_KIND_REGISTRY[kind].biometric,
);

/** The consent key an item stands on (`MATCHING_CONSENT_TEXT_KEY`, C42.3). */
const MATCHING_CONSENT_KEY = 'consent.biometric-matching';

/** Ids per statement of a whole-list redaction. */
const REDACTION_BATCH = 1000;

const LIST_KIND_OF: Readonly<Record<string, BiometricListKind>> = {
  face: 'face',
  'selfie-background': 'selfie-background',
};

/**
 * C97.4: `biometric-lists-basis` under a shared lock of the environment row, so a write that reads
 * it set commits before a clearing settings update can start, which then redacts what it wrote; and
 * a write that waited for that update reads it cleared. `null` when it is not set.
 */
export async function readBiometricListsBasis(
  db: Db,
  environmentId: string,
): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ settings: environments.settings })
      .from(environments)
      .where(eq(environments.id, environmentId))
      .for('share'),
  );
  return row?.settings['biometric-lists-basis'] ?? null;
}

/** C99.7: whether the list holds a live item of this source; the caller holds the list's lock. */
export async function hasLiveBiometricItem(
  tx: Db,
  environmentId: string,
  listId: string,
  sourceInquiryId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: listItems.id })
    .from(listItems)
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
    )
    .where(
      and(
        eq(listItems.environmentId, environmentId),
        eq(listItems.listId, listId),
        isNull(listItems.archivedAt),
        or(
          eq(listItemFaces.sourceInquiryId, sourceInquiryId),
          eq(listItemBackgrounds.sourceInquiryId, sourceInquiryId),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Bumps `version`, by one each write of a list, and moves `item-count`. */
async function touchList(
  tx: Db,
  environmentId: string,
  listId: string,
  itemCountChange: number,
): Promise<void> {
  await tx
    .update(lists)
    .set({
      version: sql`${lists.version} + 1`,
      itemCount: sql`greatest(${lists.itemCount} + ${itemCountChange}, 0)`,
    })
    .where(and(eq(lists.environmentId, environmentId), eq(lists.id, listId)));
}

/** Writes the pending item's side row in `tx`, naming its source inquiry (C99.7). */
export async function createListItemBiometricRow(
  tx: Db,
  environmentId: string,
  input: { itemId: string; kind: BiometricListKind; sourceInquiryId: string },
): Promise<void> {
  const { itemId, sourceInquiryId } = input;
  await tx
    .insert(input.kind === 'face' ? listItemFaces : listItemBackgrounds)
    .values({ itemId, environmentId, sourceInquiryId });
}

/** C99.7: the pending item and its side row; bumps the list's `version` and `item-count`. */
export async function insertBiometricListItem(
  tx: Db,
  environmentId: string,
  input: NewBiometricItem,
): Promise<void> {
  await tx.insert(listItems).values({
    id: input.itemId,
    environmentId,
    listId: input.listId,
    normaliserVersion: input.normaliserVersion,
    status: 'pending',
    createdByType: input.creator?.type ?? null,
    createdById: input.creator?.id ?? null,
  });
  await createListItemBiometricRow(tx, environmentId, input);
  await touchList(tx, environmentId, input.listId, 1);
}

/** The item, its list and its side row; `null` when no such item is in the environment. */
export async function getBiometricItem(
  db: Db,
  environmentId: string,
  itemId: string,
): Promise<BiometricItem | null> {
  const row = firstOrNull(
    await db
      .select({
        itemId: listItems.id,
        listId: listItems.listId,
        type: lists.type,
        listStatus: lists.status,
        status: listItems.status,
        redactedAt: listItems.redactedAt,
        faceSource: listItemFaces.sourceInquiryId,
        backgroundSource: listItemBackgrounds.sourceInquiryId,
        model: listItemFaces.model,
        maskedFileKey: listItemBackgrounds.maskedFileKey,
        maskedFileWrappedDek: listItemBackgrounds.maskedFileWrappedDek,
      })
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
      )
      .where(and(eq(listItems.environmentId, environmentId), eq(listItems.id, itemId)))
      .limit(1),
  );
  const kind = row === null ? undefined : LIST_KIND_OF[row.type];
  const sourceInquiryId = row?.faceSource ?? row?.backgroundSource ?? null;
  if (row === null || kind === undefined || sourceInquiryId === null) {
    return null;
  }
  return {
    itemId: row.itemId,
    listId: row.listId,
    kind,
    listStatus: row.listStatus,
    status: row.status,
    redactedAt: row.redactedAt,
    sourceInquiryId,
    model: row.model,
    maskedFileKey: row.maskedFileKey,
    maskedFileWrappedDek: row.maskedFileWrappedDek,
  };
}

/** Moves a pending item to `active`; `false` when it is no longer pending. */
async function activate(tx: Db, environmentId: string, itemId: string): Promise<string | null> {
  const row = firstOrNull(
    await tx
      .update(listItems)
      .set({ status: 'active' })
      .where(
        and(
          eq(listItems.environmentId, environmentId),
          eq(listItems.id, itemId),
          eq(listItems.status, 'pending'),
        ),
      )
      .returning({ listId: listItems.listId }),
  );
  return row?.listId ?? null;
}

/** Fills a face item's row and makes the item `active`; `false` when it is no longer pending. */
export async function completeListItemFace(
  tx: Db,
  environmentId: string,
  embedding: ListItemFaceEmbedding,
): Promise<boolean> {
  const { itemId } = embedding;
  const listId = await activate(tx, environmentId, itemId);
  if (listId === null) {
    return false;
  }
  await tx
    .update(listItemFaces)
    .set({
      templateSealed: sealValue(
        SEALED.listItemFaceTemplate,
        itemId,
        encodeFaceTemplate(embedding.embedding),
      ),
      model: embedding.model,
    })
    .where(and(eq(listItemFaces.environmentId, environmentId), eq(listItemFaces.itemId, itemId)));
  await touchList(tx, environmentId, listId, 0);
  return true;
}

/** Fills a background item's row and makes the item `active`; `false` as above. */
export async function completeListItemBackground(
  tx: Db,
  environmentId: string,
  embedding: ListItemBackgroundEmbedding,
): Promise<boolean> {
  const { itemId } = embedding;
  const listId = await activate(tx, environmentId, itemId);
  if (listId === null) {
    return false;
  }
  await withSensitiveParameters('completeListItemBackground', () =>
    tx
      .update(listItemBackgrounds)
      .set({
        layout: [...embedding.layout],
        validCells: embedding.validCells,
        coverage: embedding.coverage,
        maskedFileKey: embedding.maskedFileKey,
        maskedFileWrappedDek: embedding.maskedFileWrappedDek,
      })
      .where(
        and(
          eq(listItemBackgrounds.environmentId, environmentId),
          eq(listItemBackgrounds.itemId, itemId),
        ),
      ),
  );
  await touchList(tx, environmentId, listId, 0);
  return true;
}

/** C99.7: a pending item whose source is gone is `archived` with `source_unavailable`. */
export async function archiveUnavailableBiometricItem(
  tx: Db,
  environmentId: string,
  itemId: string,
  at: Date,
): Promise<boolean> {
  const row = firstOrNull(
    await tx
      .update(listItems)
      .set({ status: 'archived', archivedAt: at, archiveReason: 'source_unavailable' })
      .where(
        and(
          eq(listItems.environmentId, environmentId),
          eq(listItems.id, itemId),
          eq(listItems.status, 'pending'),
        ),
      )
      .returning({ listId: listItems.listId }),
  );
  if (row === null) {
    return false;
  }
  await touchList(tx, environmentId, row.listId, -1);
  return true;
}

/** Drizzle's raw rows, on node-postgres and on PGlite alike. */
const rowsOf = <Row>(result: unknown): Row[] => (result as { rows: Row[] }).rows;

interface RefRow extends Record<string, unknown> {
  environment_id: string;
  item_id: string;
}

const toRef = (row: RefRow): BiometricItemRef => ({
  environmentId: row.environment_id,
  itemId: row.item_id,
});

/**
 * The `list-item-embed-sweep`: the pending items of active lists, oldest first. It reads the side
 * rows, which hold only biometric items, so its 15 s never scan `list_items`.
 */
export async function listPendingBiometricItems(
  db: Db,
  options: { limit: number },
): Promise<BiometricItemRef[]> {
  return rowsOf<RefRow>(
    await db.execute(sql`
      select side.environment_id, side.item_id
      from (
        select environment_id, item_id from list_item_faces where model is null
        union all
        select environment_id, item_id from list_item_backgrounds where layout is null
      ) side
      join list_items item
        on item.environment_id = side.environment_id and item.id = side.item_id
      join lists list on list.environment_id = item.environment_id and list.id = item.list_id
      where item.status = 'pending' and list.status = 'active'
      order by item.created_at, item.id
      limit ${options.limit}`),
  ).map(toRef);
}

/** The decrypted cache's load: a list's active templates, opened (C99.7). */
export async function listListFaceTemplates(
  db: Db,
  environmentId: string,
  listId: string,
): Promise<ListFaceTemplate[]> {
  const rows = await db
    .select({
      itemId: listItemFaces.itemId,
      templateSealed: listItemFaces.templateSealed,
      model: listItemFaces.model,
    })
    .from(listItemFaces)
    .innerJoin(
      listItems,
      and(
        eq(listItems.environmentId, listItemFaces.environmentId),
        eq(listItems.id, listItemFaces.itemId),
      ),
    )
    .where(
      and(
        eq(listItemFaces.environmentId, environmentId),
        eq(listItems.listId, listId),
        eq(listItems.status, 'active'),
        isNotNull(listItemFaces.templateSealed),
      ),
    )
    .orderBy(asc(listItemFaces.itemId));
  return rows.map((row) => ({
    itemId: row.itemId,
    template: openValue(SEALED.listItemFaceTemplate, row.itemId, row.templateSealed as Sealed),
    model: row.model ?? '',
  }));
}

/** C99.7: the selected lists as they stand, for the matcher and the cache's check. */
export async function listBiometricListStates(
  db: Db,
  environmentId: string,
  listIds: readonly string[],
): Promise<BiometricListState[]> {
  if (listIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      id: lists.id,
      type: lists.type,
      status: lists.status,
      version: lists.version,
      active:
        sql<number>`count(${listItems.id}) filter (where ${listItems.status} = 'active')`.mapWith(
          Number,
        ),
      pending:
        sql<number>`count(${listItems.id}) filter (where ${listItems.status} = 'pending')`.mapWith(
          Number,
        ),
    })
    .from(lists)
    .leftJoin(
      listItems,
      and(eq(listItems.environmentId, lists.environmentId), eq(listItems.listId, lists.id)),
    )
    .where(
      and(
        eq(lists.environmentId, environmentId),
        inArray(lists.id, [...listIds]),
        inArray(lists.type, [...BIOMETRIC_KINDS]),
      ),
    )
    .groupBy(lists.id)
    .orderBy(asc(lists.id));
  return rows.flatMap(({ type, ...row }) => {
    const kind = LIST_KIND_OF[type];
    return kind === undefined ? [] : [{ ...row, kind }];
  });
}

/**
 * C99.7: what the decrypted cache checks its lists against, across environments: a worker's cache
 * holds whatever its jobs read.
 */
export async function listCachedListStates(
  db: Db,
  listIds: readonly string[],
): Promise<{ id: string; version: number; status: ListStatus }[]> {
  if (listIds.length === 0) {
    return [];
  }
  return db
    .select({ id: lists.id, version: lists.version, status: lists.status })
    .from(lists)
    .where(inArray(lists.id, [...listIds]));
}

/** C99.7: the nearest active layouts of one list, by an exact scan (no ANN index). */
export async function nearestListBackgrounds(
  db: Db,
  environmentId: string,
  input: { listId: string; layout: readonly number[]; limit: number },
): Promise<ListBackgroundCandidate[]> {
  const distance = l2Distance(listItemBackgrounds.layout, [...input.layout]);
  const rows = await withSensitiveParameters('nearestListBackgrounds', () =>
    db
      .select({
        itemId: listItemBackgrounds.itemId,
        distance: sql<number>`${distance}`.mapWith(Number),
        maskedFileKey: listItemBackgrounds.maskedFileKey,
        maskedFileWrappedDek: listItemBackgrounds.maskedFileWrappedDek,
      })
      .from(listItemBackgrounds)
      .innerJoin(
        listItems,
        and(
          eq(listItems.environmentId, listItemBackgrounds.environmentId),
          eq(listItems.id, listItemBackgrounds.itemId),
        ),
      )
      .where(
        and(
          eq(listItemBackgrounds.environmentId, environmentId),
          eq(listItems.listId, input.listId),
          eq(listItems.status, 'active'),
          isNotNull(listItemBackgrounds.layout),
          isNotNull(listItemBackgrounds.maskedFileKey),
        ),
      )
      .orderBy(distance, asc(listItemBackgrounds.itemId))
      .limit(input.limit),
  );
  return rows.flatMap((row) =>
    row.maskedFileKey === null || row.maskedFileWrappedDek === null
      ? []
      : [
          {
            itemId: row.itemId,
            distance: row.distance,
            maskedFileKey: row.maskedFileKey,
            maskedFileWrappedDek: row.maskedFileWrappedDek,
          },
        ],
  );
}

/** C98.4: the items an inquiry was the source of, of either kind, whatever their status. */
export async function listBiometricItemsBySource(
  db: Db,
  environmentId: string,
  sourceInquiryId: string,
): Promise<{ itemId: string; kind: BiometricListKind }[]> {
  const faces = await db
    .select({ itemId: listItemFaces.itemId })
    .from(listItemFaces)
    .where(
      and(
        eq(listItemFaces.environmentId, environmentId),
        eq(listItemFaces.sourceInquiryId, sourceInquiryId),
      ),
    );
  const backgrounds = await db
    .select({ itemId: listItemBackgrounds.itemId })
    .from(listItemBackgrounds)
    .where(
      and(
        eq(listItemBackgrounds.environmentId, environmentId),
        eq(listItemBackgrounds.sourceInquiryId, sourceInquiryId),
      ),
    );
  return [
    ...faces.map(({ itemId }) => ({ itemId, kind: 'face' as const })),
    ...backgrounds.map(({ itemId }) => ({ itemId, kind: 'selfie-background' as const })),
  ];
}

/**
 * Clears the side rows of `ids`: a template goes at once, and so does a background row with no
 * object. A masked object stays on its row, without its layout, until the `list-item-embed` job has
 * deleted it, and is answered for a caller that can delete it sooner.
 */
async function clearSideRows(
  tx: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<string[]> {
  const scope = [...ids];
  await tx
    .delete(listItemFaces)
    .where(
      and(eq(listItemFaces.environmentId, environmentId), inArray(listItemFaces.itemId, scope)),
    );
  const backgrounds = and(
    eq(listItemBackgrounds.environmentId, environmentId),
    inArray(listItemBackgrounds.itemId, scope),
  );
  await tx
    .delete(listItemBackgrounds)
    .where(and(backgrounds, isNull(listItemBackgrounds.maskedFileKey)));
  const kept = await tx
    .update(listItemBackgrounds)
    .set({ layout: null, validCells: null, coverage: null })
    .where(backgrounds)
    .returning({ key: listItemBackgrounds.maskedFileKey });
  return kept.flatMap(({ key }) => (key === null ? [] : [key]));
}

/**
 * C98.4: redacts the items in `tx`: no template, layout, value or key is left, each item is
 * `archived` with `redacted_at`, and stored API logs and event payloads about it are forgotten. A
 * masked object stays recorded on its row until the `list-item-embed` job has deleted it, so a crash
 * or a storage failure after the commit cannot orphan it; its key is answered for a caller with
 * storage to delete at once. Idempotent.
 */
export async function redactBiometricItems(
  tx: Db,
  environmentId: string,
  itemIds: readonly string[],
  input: { at: Date },
): Promise<ListItemRedaction> {
  if (itemIds.length === 0) {
    return { storageKeys: [], changedLists: [], redactedItemIds: [] };
  }
  const { at } = input;
  const rows = await tx
    .select({
      id: listItems.id,
      listId: listItems.listId,
      archivedAt: listItems.archivedAt,
      redactedAt: listItems.redactedAt,
    })
    .from(listItems)
    .where(and(eq(listItems.environmentId, environmentId), inArray(listItems.id, [...itemIds])))
    .orderBy(asc(listItems.id))
    .for('update');
  if (rows.length === 0) {
    return { storageKeys: [], changedLists: [], redactedItemIds: [] };
  }
  const live = rows.filter((row) => row.redactedAt === null);
  const freed = new Map<string, number>();
  const taken = new Map<string, number>();
  for (const row of live) {
    freed.set(row.listId, (freed.get(row.listId) ?? 0) + (row.archivedAt === null ? 1 : 0));
    taken.set(row.listId, (taken.get(row.listId) ?? 0) + 1);
  }
  const liveIds = live.map(({ id }) => id);
  if (liveIds.length > 0) {
    await tx
      .update(listItems)
      .set({
        status: 'archived',
        archivedAt: sql`coalesce(${listItems.archivedAt}, ${at.toISOString()}::timestamptz)`,
        redactedAt: at,
        valueSealed: null,
        matchKey: null,
        countryCode: null,
      })
      .where(and(eq(listItems.environmentId, environmentId), inArray(listItems.id, liveIds)));
    // C99.3: the match stays, and its `list-item` relationship reads `null` from here.
    await tx
      .update(listMatches)
      .set({ listItemId: null })
      .where(
        and(eq(listMatches.environmentId, environmentId), inArray(listMatches.listItemId, liveIds)),
      );
    for (const listId of [...freed.keys()].sort()) {
      await touchList(tx, environmentId, listId, -(freed.get(listId) ?? 0));
    }
    await stubEventPayloads(tx, environmentId, liveIds, at);
    await forgetStoredResponses(tx, environmentId, liveIds);
  }
  return {
    storageKeys: await clearSideRows(
      tx,
      environmentId,
      rows.map(({ id }) => id),
    ),
    changedLists: [...taken].map(([listId, items]) => ({ listId, items })),
    redactedItemIds: liveIds,
  };
}

/**
 * C97.4 (P08): redacts every item of the environment's biometric lists and archives the lists, in
 * the settings transaction, which has no storage: the masked objects stay on their rows for the
 * `list-item-embed` job. Answers the counts.
 */
export async function redactBiometricLists(
  tx: Db,
  environmentId: string,
  at: Date,
): Promise<{
  lists: number;
  items: number;
  changedLists: ChangedList[];
  redactedItemIds: string[];
}> {
  const biometric = await tx
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.environmentId, environmentId), inArray(lists.type, [...BIOMETRIC_KINDS])))
    .orderBy(asc(lists.id));
  const listIds = biometric.map(({ id }) => id);
  if (listIds.length === 0) {
    return { lists: 0, items: 0, changedLists: [], redactedItemIds: [] };
  }
  const items = await tx
    .select({ id: listItems.id })
    .from(listItems)
    .where(
      and(
        eq(listItems.environmentId, environmentId),
        inArray(listItems.listId, listIds),
        isNull(listItems.redactedAt),
      ),
    )
    .orderBy(asc(listItems.id));
  const taken = new Map<string, number>();
  const redactedItemIds: string[] = [];
  for (let start = 0; start < items.length; start += REDACTION_BATCH) {
    const batch = await redactBiometricItems(
      tx,
      environmentId,
      items.slice(start, start + REDACTION_BATCH).map(({ id }) => id),
      { at },
    );
    redactedItemIds.push(...batch.redactedItemIds);
    for (const { listId, items: count } of batch.changedLists) {
      taken.set(listId, (taken.get(listId) ?? 0) + count);
    }
  }
  await tx
    .update(lists)
    .set({
      status: 'archived',
      archivedAt: sql`coalesce(${lists.archivedAt}, ${at.toISOString()}::timestamptz)`,
      version: sql`${lists.version} + 1`,
    })
    .where(and(eq(lists.environmentId, environmentId), inArray(lists.id, listIds)));
  // Every list moves, so its archive reaches a monitored report whether or not it held an item.
  const changedLists = listIds.map((listId) => ({ listId, items: taken.get(listId) ?? 0 }));
  return { lists: listIds.length, items: items.length, changedLists, redactedItemIds };
}

/**
 * C99.7 (P08): items due for redaction: `face-template-retention-days` after the newest consent of
 * the source that holds matching (a rejected handoff's consent authorises nothing, and no such
 * consent leaves a stored face no basis at all), or `item-retention-days` after the item, whichever
 * is sooner. Oldest first, across environments.
 */
export async function listBiometricItemsPastRetention(
  db: Db,
  options: { now: Date; limit: number },
): Promise<BiometricItemRef[]> {
  const now = options.now.toISOString();
  const defaultDays = DEFAULT_FACE_TEMPLATE_SETTINGS['face-template-retention-days'];
  return rowsOf<RefRow>(
    await db.execute(sql`
      select side.environment_id, side.item_id
      from (
        select environment_id, item_id, source_inquiry_id from list_item_faces
        union all
        select environment_id, item_id, source_inquiry_id from list_item_backgrounds
      ) side
      join list_items item
        on item.environment_id = side.environment_id and item.id = side.item_id
      join lists list on list.environment_id = item.environment_id and list.id = item.list_id
      join environments environment on environment.id = side.environment_id
      left join lateral (
        select max((session.consent ->> 'accepted_at')::timestamptz) as accepted_at
        from inquiry_sessions session
        where session.environment_id = side.environment_id
          and session.inquiry_id = side.source_inquiry_id
          and (session.handoff_from_session_id is null or session.handoff_rejected_at is null)
          and (
            coalesce(session.consent -> 'text_keys', '[]'::jsonb)
              @> ${JSON.stringify([MATCHING_CONSENT_KEY])}::jsonb
            or coalesce(session.consent -> 'optional_text_keys', '[]'::jsonb)
              @> ${JSON.stringify([MATCHING_CONSENT_KEY])}::jsonb
          )
      ) consent on true
      where item.redacted_at is null
        and (
          consent.accepted_at is null
          or consent.accepted_at + make_interval(days => coalesce(
            (environment.settings ->> 'face-template-retention-days')::integer,
            ${defaultDays}::integer)) <= ${now}::timestamptz
          or item.created_at + make_interval(days => list.item_retention_days)
            <= ${now}::timestamptz
        )
      order by item.created_at, item.id
      limit ${options.limit}`),
  ).map(toRef);
}

/** C97.4: redacted background items whose masked object is still in storage. */
export async function listMaskedObjectsToPurge(
  db: Db,
  options: { limit: number },
): Promise<BiometricItemRef[]> {
  const rows = await db
    .select({
      environmentId: listItemBackgrounds.environmentId,
      itemId: listItemBackgrounds.itemId,
    })
    .from(listItemBackgrounds)
    .innerJoin(
      listItems,
      and(
        eq(listItems.environmentId, listItemBackgrounds.environmentId),
        eq(listItems.id, listItemBackgrounds.itemId),
      ),
    )
    .where(and(isNotNull(listItems.redactedAt), isNotNull(listItemBackgrounds.maskedFileKey)))
    .orderBy(asc(listItemBackgrounds.itemId))
    .limit(options.limit);
  return rows;
}

/** C97.4: the side row of a redacted item, once its object is gone. */
export async function deleteRedactedBackgroundRow(
  db: Db,
  environmentId: string,
  itemId: string,
): Promise<void> {
  await db.delete(listItemBackgrounds).where(
    and(
      eq(listItemBackgrounds.environmentId, environmentId),
      eq(listItemBackgrounds.itemId, itemId),
      sql`exists (
        select 1 from list_items item
        where item.environment_id = ${environmentId} and item.id = ${itemId}
          and item.redacted_at is not null)`,
    ),
  );
}
