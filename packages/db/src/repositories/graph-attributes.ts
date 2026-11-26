/**
 * C101.1, C101.3, C101.4 (Workflow 7B): `graph_attributes`, one row per account, value and source.
 * Owner: `api-graph`; `foundation-7b` (Stage 1b (G)) froze the signatures.
 *
 * Every value is a 64-hex HMAC under its kind's identifier label (F10), with the key id it was made
 * with; no plaintext reaches this table. Fan-out is a capped count when a query reads (F24).
 */
import { and, asc, eq, gt, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { graphAttributes, type GraphAttributeRow, type GraphSourceType } from '../schema.js';

export interface NewGraphAttribute {
  /** `GRAPH_KIND_REGISTRY[kind].code`. */
  kind: number;
  valueKey: string;
  keyId: string;
  accountId: string;
  sourceType: GraphSourceType;
  sourceId: string;
  /** The inquiry of an inquiry, session or verification source; `null` for the account's own. */
  inquiryId: string | null;
}

async function rowsOf<T extends Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  const result = await db.execute<T>(query);
  return (result as { rows: T[] }).rows;
}

const textParam = (values: readonly string[]) => sql`${sql.param([...values])}::text[]`;
const smallintParam = (values: readonly number[]) => sql`${sql.param([...values])}::smallint[]`;

/** One row per primary key: a statement may not touch a row twice. */
function distinctRows(rows: readonly NewGraphAttribute[]): NewGraphAttribute[] {
  const seen = new Map<string, NewGraphAttribute>();
  for (const row of rows) {
    seen.set([row.kind, row.valueKey, row.accountId, row.sourceType, row.sourceId].join('|'), row);
  }
  return [...seen.values()];
}

/** Rows per statement: well under Postgres's bound-parameter limit. */
const BATCH = 500;

/**
 * Writes the rows, or moves `last_seen_at` (and the key id) of those already there. Returns how
 * many were new.
 */
export async function upsertGraphAttributes(
  tx: Db,
  environmentId: string,
  rows: readonly NewGraphAttribute[],
  at: Date,
): Promise<number> {
  const unique = distinctRows(rows);
  let written = 0;
  for (let start = 0; start < unique.length; start += BATCH) {
    const batch = unique.slice(start, start + BATCH);
    const result = await tx
      .insert(graphAttributes)
      .values(batch.map((row) => ({ ...row, environmentId, firstSeenAt: at, lastSeenAt: at })))
      .onConflictDoUpdate({
        target: [
          graphAttributes.environmentId,
          graphAttributes.kind,
          graphAttributes.valueKey,
          graphAttributes.accountId,
          graphAttributes.sourceType,
          graphAttributes.sourceId,
        ],
        set: {
          keyId: sql`excluded.key_id`,
          lastSeenAt: sql`greatest(${graphAttributes.lastSeenAt}, excluded.last_seen_at)`,
        },
      })
      .returning({ fresh: sql<boolean>`(xmax = 0)` });
    written += result.filter(({ fresh }) => fresh).length;
  }
  return written;
}

/** Replaces an account's own rows (its fields and reference id) with `rows`. */
export async function replaceAccountGraphAttributes(
  tx: Db,
  environmentId: string,
  accountId: string,
  rows: readonly NewGraphAttribute[],
  at: Date,
): Promise<number> {
  const own = rows.filter((row) => row.sourceType === 'account' && row.accountId === accountId);
  const keep = own.map((row) => `${String(row.kind)}|${row.valueKey}`);
  await tx.execute(sql`
    delete from graph_attributes
    where environment_id = ${environmentId} and account_id = ${accountId}
      and source_type = 'account' and source_id = ${accountId}
      and not ((kind::text || '|' || value_key) = any(${textParam(keep)}))`);
  return upsertGraphAttributes(tx, environmentId, own, at);
}

/** C102.3: one hop's read: the accounts' rows of the given kind codes. */
export async function listAccountGraphAttributes(
  db: Db,
  environmentId: string,
  input: { accountIds: readonly string[]; kinds: readonly number[] },
): Promise<GraphAttributeRow[]> {
  if (input.accountIds.length === 0 || input.kinds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(graphAttributes)
    .where(
      and(
        eq(graphAttributes.environmentId, environmentId),
        sql`${graphAttributes.accountId} = any(${textParam(input.accountIds)})`,
        sql`${graphAttributes.kind} = any(${smallintParam(input.kinds)})`,
      ),
    );
}

/**
 * C102.3 (F24): the accounts holding one value, read with `limit cap + 1`, so a hub value answers
 * `cap + 1` accounts and is skipped by the caller.
 */
export async function listGraphValueHolders(
  db: Db,
  environmentId: string,
  input: { kind: number; valueKey: string; cap: number },
): Promise<string[]> {
  const [found] = await listGraphValueHoldersOf(db, environmentId, {
    values: [{ kind: input.kind, valueKey: input.valueKey }],
    cap: input.cap,
  });
  return found?.accountIds ?? [];
}

/**
 * C102.3 (F24): one hop's holders of several values in one statement, each capped at `cap + 1`
 * accounts, so a hub value answers `cap + 1` and is skipped by the caller. A value with no holder
 * is left out.
 */
export async function listGraphValueHoldersOf(
  db: Db,
  environmentId: string,
  input: { values: readonly { kind: number; valueKey: string }[]; cap: number },
): Promise<{ kind: number; valueKey: string; accountIds: string[] }[]> {
  if (input.values.length === 0) {
    return [];
  }
  const rows = await rowsOf<{ kind: unknown; value_key: string; account_ids: string[] }>(
    db,
    sql`
      select v.kind, v.value_key, h.account_ids
      from unnest(${smallintParam(input.values.map(({ kind }) => kind))},
                  ${textParam(input.values.map(({ valueKey }) => valueKey))}) as v(kind, value_key)
      cross join lateral (
        select array_agg(c.account_id) as account_ids from (
          select distinct g.account_id from graph_attributes g
          where g.environment_id = ${environmentId} and g.kind = v.kind
            and g.value_key = v.value_key
          limit ${input.cap + 1}
        ) c
      ) h
      where h.account_ids is not null`,
  );
  return rows.map((row) => ({
    kind: Number(row.kind),
    valueKey: row.value_key,
    accountIds: row.account_ids,
  }));
}

/** C101.3, C101.4: an inquiry's rows move with it to `accountId` (add-objects, remove-objects). */
export async function moveInquiryGraphAttributes(
  tx: Db,
  environmentId: string,
  input: { inquiryIds: readonly string[]; accountId: string },
): Promise<number> {
  if (input.inquiryIds.length === 0) {
    return 0;
  }
  const moved = await rowsOf<{ n: unknown }>(
    tx,
    sql`
      with moved as (
        delete from graph_attributes
        where environment_id = ${environmentId}
          and inquiry_id = any(${textParam(input.inquiryIds)})
          and account_id <> ${input.accountId}
        returning kind, value_key, key_id, source_type, source_id, inquiry_id, first_seen_at,
          last_seen_at
      ), written as (
        insert into graph_attributes (environment_id, kind, value_key, key_id, account_id,
          source_type, source_id, inquiry_id, first_seen_at, last_seen_at)
        select ${environmentId}, kind, value_key, key_id, ${input.accountId}, source_type,
          source_id, inquiry_id, first_seen_at, last_seen_at from moved
        on conflict do nothing
        returning 1
      )
      select (select count(*) from moved)::int as n`,
  );
  return Number(moved[0]?.n ?? 0);
}

/**
 * C101.4: a consolidation moves the absorbed accounts' rows to the survivor, one row per value and
 * source kept.
 */
export async function moveAccountGraphAttributes(
  tx: Db,
  environmentId: string,
  input: { targetId: string; sourceIds: readonly string[] },
): Promise<number> {
  const sources = input.sourceIds.filter((id) => id !== input.targetId);
  if (sources.length === 0) {
    return 0;
  }
  const moved = await rowsOf<{ n: unknown }>(
    tx,
    sql`
      with moved as (
        delete from graph_attributes
        where environment_id = ${environmentId} and account_id = any(${textParam(sources)})
        returning kind, value_key, key_id, source_type, source_id, inquiry_id, first_seen_at,
          last_seen_at
      ), written as (
        insert into graph_attributes (environment_id, kind, value_key, key_id, account_id,
          source_type, source_id, inquiry_id, first_seen_at, last_seen_at)
        select ${environmentId}, kind, value_key, key_id, ${input.targetId}, source_type,
          source_id, inquiry_id, first_seen_at, last_seen_at from moved
        on conflict do nothing
        returning 1
      )
      select (select count(*) from moved)::int as n`,
  );
  return Number(moved[0]?.n ?? 0);
}

/** C101.4: an inquiry's redaction deletes the rows it contributed. */
export async function deleteInquiryGraphAttributes(
  tx: Db,
  environmentId: string,
  inquiryId: string,
): Promise<number> {
  const deleted = await tx
    .delete(graphAttributes)
    .where(
      and(
        eq(graphAttributes.environmentId, environmentId),
        eq(graphAttributes.inquiryId, inquiryId),
      ),
    )
    .returning({ kind: graphAttributes.kind });
  return deleted.length;
}

/** C101.4: an account's redaction deletes all its rows. */
export async function deleteAccountGraphAttributes(
  tx: Db,
  environmentId: string,
  accountId: string,
): Promise<number> {
  const deleted = await tx
    .delete(graphAttributes)
    .where(
      and(
        eq(graphAttributes.environmentId, environmentId),
        eq(graphAttributes.accountId, accountId),
      ),
    )
    .returning({ kind: graphAttributes.kind });
  return deleted.length;
}

/** C101.5, `blind-index:rebuild`: rows made under a key other than `keyId`, in pages. */
export async function listGraphAttributesKeyedOtherwise(
  db: Db,
  input: { keyId: string; limit: number },
): Promise<GraphAttributeRow[]> {
  return db
    .select()
    .from(graphAttributes)
    .where(ne(graphAttributes.keyId, input.keyId))
    .orderBy(asc(graphAttributes.environmentId), asc(graphAttributes.accountId))
    .limit(input.limit);
}

/**
 * C101.6: the environment's rows of `kinds` in primary-key order after `after`, a page at a time,
 * for the components' union-find.
 */
export async function listGraphAttributesPage(
  db: Db,
  environmentId: string,
  input: {
    kinds: readonly number[];
    after: { kind: number; valueKey: string; accountId: string } | null;
    limit: number;
  },
): Promise<{ kind: number; valueKey: string; accountId: string }[]> {
  if (input.kinds.length === 0) {
    return [];
  }
  const { after } = input;
  return db
    .selectDistinct({
      kind: graphAttributes.kind,
      valueKey: graphAttributes.valueKey,
      accountId: graphAttributes.accountId,
    })
    .from(graphAttributes)
    .where(
      and(
        eq(graphAttributes.environmentId, environmentId),
        inArray(graphAttributes.kind, [...input.kinds]),
        after === null
          ? undefined
          : or(
              gt(graphAttributes.kind, after.kind),
              and(
                eq(graphAttributes.kind, after.kind),
                gt(graphAttributes.valueKey, after.valueKey),
              ),
              and(
                eq(graphAttributes.kind, after.kind),
                eq(graphAttributes.valueKey, after.valueKey),
                gt(graphAttributes.accountId, after.accountId),
              ),
            ),
      ),
    )
    .orderBy(
      asc(graphAttributes.kind),
      asc(graphAttributes.valueKey),
      asc(graphAttributes.accountId),
    )
    .limit(input.limit);
}

/** C101.5: the rows one source gave one account, under any key (the rebuild replaces them). */
export async function deleteGraphAttributesOfSource(
  tx: Db,
  environmentId: string,
  input: { accountId: string; sourceType: GraphSourceType; sourceId: string },
): Promise<number> {
  const deleted = await tx
    .delete(graphAttributes)
    .where(
      and(
        eq(graphAttributes.environmentId, environmentId),
        eq(graphAttributes.accountId, input.accountId),
        eq(graphAttributes.sourceType, input.sourceType),
        eq(graphAttributes.sourceId, input.sourceId),
      ),
    )
    .returning({ kind: graphAttributes.kind });
  return deleted.length;
}

/** C102.2: what a template's `filters` keep of the accounts a hop reached. */
export interface GraphAccountFilters {
  accountTypeIds?: readonly string[] | undefined;
  statuses?: readonly string[] | undefined;
  /** Any of these tags, ignoring case. */
  tags?: readonly string[] | undefined;
  createdAtStart?: Date | null | undefined;
  createdAtEnd?: Date | null | undefined;
}

/**
 * C102.3: the accounts of `ids` a result may hold: not redacted, not absorbed by a consolidation,
 * and passing the template's filters. One statement per hop.
 */
export async function filterGraphAccounts(
  db: Db,
  environmentId: string,
  ids: readonly string[],
  filters: GraphAccountFilters,
): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  const conditions: SQL[] = [
    sql`environment_id = ${environmentId}`,
    sql`id = any(${textParam(ids)})`,
    sql`redacted_at is null`,
    sql`consolidated_into is null`,
  ];
  if (filters.accountTypeIds !== undefined) {
    conditions.push(sql`account_type_id = any(${textParam(filters.accountTypeIds)})`);
  }
  if (filters.statuses !== undefined) {
    conditions.push(sql`status::text = any(${textParam(filters.statuses)})`);
  }
  if (filters.tags !== undefined) {
    const tags = filters.tags.map((tag) => tag.toLowerCase());
    conditions.push(
      sql`exists (select 1 from unnest(tags) t where lower(t) = any(${textParam(tags)}))`,
    );
  }
  if (filters.createdAtStart != null) {
    conditions.push(sql`created_at >= ${filters.createdAtStart.toISOString()}::timestamptz`);
  }
  if (filters.createdAtEnd != null) {
    conditions.push(sql`created_at < ${filters.createdAtEnd.toISOString()}::timestamptz`);
  }
  const rows = await rowsOf<{ id: string }>(
    db,
    sql`select id from accounts where ${sql.join(conditions, sql` and `)}`,
  );
  return rows.map(({ id }) => id);
}

/**
 * C102.6: where a value of a result came from: its rows among the result's accounts, oldest first.
 */
export async function listGraphValueSources(
  db: Db,
  environmentId: string,
  input: { kind: number; valueKey: string; accountIds: readonly string[] },
): Promise<GraphAttributeRow[]> {
  if (input.accountIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(graphAttributes)
    .where(
      and(
        eq(graphAttributes.environmentId, environmentId),
        eq(graphAttributes.kind, input.kind),
        eq(graphAttributes.valueKey, input.valueKey),
        sql`${graphAttributes.accountId} = any(${textParam(input.accountIds)})`,
      ),
    )
    .orderBy(asc(graphAttributes.firstSeenAt), asc(graphAttributes.sourceId));
}
