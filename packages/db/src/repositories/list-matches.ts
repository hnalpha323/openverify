/**
 * C99.3 (Workflow 7B): `list_matches`. Owner: `api-lists`; `foundation-7b` (Stage 1b (L)) froze the
 * signatures. The inquiry redaction nulls the sealed values itself (`redactInquiryRecords`).
 *
 * `inquiry/list_match_count` is the inquiry's open matches, held on its `list_screenings` row
 * (V06): a write here that changes them moves a `completed` row's count, so a dismissal and a
 * C99.9 record written after the screening keep it true.
 */
import type {
  ListMatchMethod,
  ListMatchStatus,
  ListMatchTier,
  ListProbeSource,
} from '@openverify/core';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { listItems, listMatches, listScreenings, type ListMatchRow } from '../schema.js';
import { openOptional, sealValue } from '../sealed.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull } from './rows.js';

export interface NewListMatch {
  id: string;
  listId: string;
  listItemId: string;
  inquiryId: string;
  accountId: string | null;
  source: ListProbeSource;
  method: ListMatchMethod;
  tier: ListMatchTier;
  confidence: number | null;
  approximate: boolean;
  score: number | null;
  distanceMeters: number | null;
  listVersion: number;
  matchedValue: string;
}

/** A match with its sealed values opened. */
export interface ListMatch extends Omit<ListMatchRow, 'matchedValueSealed' | 'reasonSealed'> {
  matchedValue: string | null;
  reason: string | null;
}

export interface ListMatchFilters {
  inquiryIds?: readonly string[] | undefined;
  accountIds?: readonly string[] | undefined;
  listIds?: readonly string[] | undefined;
  statuses?: readonly ListMatchStatus[] | undefined;
}

const matchCursor = environmentCursor(listMatches);

function toListMatch(row: ListMatchRow): ListMatch {
  const { matchedValueSealed, reasonSealed, ...rest } = row;
  return {
    ...rest,
    matchedValue: openOptional(SEALED.listMatchMatchedValue, row.id, matchedValueSealed),
    reason: openOptional(SEALED.listMatchReason, row.id, reasonSealed),
  };
}

const openMatches = (environmentId: string, inquiryId: string) =>
  and(
    eq(listMatches.environmentId, environmentId),
    eq(listMatches.inquiryId, inquiryId),
    eq(listMatches.status, 'open'),
    isNull(listMatches.redactedAt),
  );

/** V06: a `completed` screening's count is the inquiry's open matches. */
async function refreshScreeningCount(tx: Db, environmentId: string, inquiryId: string) {
  const [row] = await tx
    .select({ value: count() })
    .from(listMatches)
    .where(openMatches(environmentId, inquiryId));
  await tx
    .update(listScreenings)
    .set({ matchCount: row?.value ?? 0 })
    .where(
      and(
        eq(listScreenings.environmentId, environmentId),
        eq(listScreenings.inquiryId, inquiryId),
        eq(listScreenings.status, 'completed'),
      ),
    );
}

/**
 * C99.3: writes the matches in `tx`, once per inquiry, item and source, bumping each item's
 * `match-count`. Returns the rows it wrote (a retried job writes none).
 */
export async function insertListMatches(
  tx: Db,
  environmentId: string,
  matches: readonly NewListMatch[],
): Promise<ListMatch[]> {
  if (matches.length === 0) {
    return [];
  }
  const written = await tx
    .insert(listMatches)
    .values(
      matches.map(({ matchedValue, ...match }) => ({
        ...match,
        environmentId,
        matchedValueSealed: sealValue(SEALED.listMatchMatchedValue, match.id, matchedValue),
      })),
    )
    .onConflictDoNothing({
      target: [
        listMatches.environmentId,
        listMatches.inquiryId,
        listMatches.listItemId,
        listMatches.source,
      ],
      where: sql`${listMatches.listItemId} is not null`,
    })
    .returning();
  const counts = new Map<string, number>();
  for (const { listItemId } of written) {
    if (listItemId !== null) {
      counts.set(listItemId, (counts.get(listItemId) ?? 0) + 1);
    }
  }
  for (const [itemId, added] of counts) {
    await tx
      .update(listItems)
      .set({ matchCount: sql`${listItems.matchCount} + ${added}` })
      .where(and(eq(listItems.environmentId, environmentId), eq(listItems.id, itemId)));
  }
  for (const inquiryId of new Set(written.map((row) => row.inquiryId))) {
    await refreshScreeningCount(tx, environmentId, inquiryId);
  }
  return written.map(toListMatch);
}

export async function getListMatch(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ListMatch | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(listMatches)
      .where(and(eq(listMatches.environmentId, environmentId), eq(listMatches.id, id)))
      .limit(1),
  );
  return row === null ? null : toListMatch(row);
}

/** `GET /list-matches`: `created_at DESC, id DESC`. */
export async function listListMatches(
  db: Db,
  environmentId: string,
  filters: ListMatchFilters,
  page: PageRequest,
): Promise<Page<ListMatch>> {
  const conditions = allFilters([
    eq(listMatches.environmentId, environmentId),
    equalsAny(listMatches.inquiryId, filters.inquiryIds),
    equalsAny(listMatches.accountId, filters.accountIds),
    equalsAny(listMatches.listId, filters.listIds),
    equalsAny(listMatches.status, filters.statuses),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, matchCursor, environmentId, page, async (after, limit) =>
    (
      await db
        .select()
        .from(listMatches)
        .where(and(...conditions, after))
        .orderBy(...newestFirst(matchCursor))
        .limit(limit)
    ).map(toListMatch),
  );
}

/** C99.3: dismisses an open match; `null` when it is not open, or was redacted. */
export async function dismissListMatch(
  db: Db,
  environmentId: string,
  id: string,
  input: { reason: string; at: Date },
): Promise<ListMatch | null> {
  return db.transaction(async (tx) => {
    const row = firstOrNull(
      await tx
        .update(listMatches)
        .set({
          status: 'dismissed',
          dismissedAt: input.at,
          reasonSealed: sealValue(SEALED.listMatchReason, id, input.reason),
        })
        .where(
          and(
            eq(listMatches.environmentId, environmentId),
            eq(listMatches.id, id),
            eq(listMatches.status, 'open'),
            isNull(listMatches.redactedAt),
          ),
        )
        .returning(),
    );
    if (row === null) {
      return null;
    }
    await refreshScreeningCount(tx, environmentId, row.inquiryId);
    return toListMatch(row);
  });
}

/** C99.6: the inquiry's open matches, for the screening's count; their values stay sealed. */
export async function listOpenListMatches(
  db: Db,
  environmentId: string,
  inquiryId: string,
): Promise<{ id: string; listId: string }[]> {
  return db
    .select({ id: listMatches.id, listId: listMatches.listId })
    .from(listMatches)
    .where(openMatches(environmentId, inquiryId));
}
