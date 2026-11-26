/**
 * C104.1 (Workflow 7B): `transaction_type_versions`, as C71: a draft changes, one version per type
 * is published, and a published version never changes but to be superseded. Owner:
 * `api-transactions`.
 */
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  transactionTypeVersions,
  transactionTypes,
  type TransactionTypeVersionRow,
} from '../schema.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

export type TransactionTypeVersion = TransactionTypeVersionRow;

const versionCursor = environmentCursor(transactionTypeVersions);

export interface ListTransactionTypeVersionsOptions extends PageRequest {
  transactionTypeIds?: readonly string[] | undefined;
}

/** `GET /transaction-type-versions`: newest first, as `listInquiryTemplateVersions`. */
export async function listTransactionTypeVersions(
  db: Db,
  environmentId: string,
  options: ListTransactionTypeVersionsOptions = {},
): Promise<Page<TransactionTypeVersion>> {
  const filters = allFilters([
    eq(transactionTypeVersions.environmentId, environmentId),
    equalsAny(transactionTypeVersions.transactionTypeId, options.transactionTypeIds),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, versionCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(transactionTypeVersions)
      .where(and(...filters, after))
      .orderBy(...newestFirst(versionCursor))
      .limit(limit),
  );
}

/** What a version holds; the engine in core checks it at publish (C104.3). */
export interface TransactionTypeVersionValues {
  fieldSchemas: readonly unknown[];
  statuses: readonly string[];
  relationSchemas: readonly unknown[];
  allowCardLikeStrings: boolean;
}

export interface NewTransactionTypeVersion extends TransactionTypeVersionValues {
  id: string;
  transactionTypeId: string;
  version: number;
}

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(transactionTypeVersions.environmentId, environmentId), eq(transactionTypeVersions.id, id));

export async function createTransactionTypeVersion(
  tx: Db,
  environmentId: string,
  input: NewTransactionTypeVersion,
): Promise<TransactionTypeVersion> {
  return inserted(
    await tx
      .insert(transactionTypeVersions)
      .values({
        id: input.id,
        environmentId,
        transactionTypeId: input.transactionTypeId,
        version: input.version,
        fieldSchemas: [...input.fieldSchemas],
        statuses: [...input.statuses],
        relationSchemas: [...input.relationSchemas],
        allowCardLikeStrings: input.allowCardLikeStrings,
      })
      .returning(),
    'createTransactionTypeVersion',
  );
}

export async function getTransactionTypeVersion(
  db: Db,
  environmentId: string,
  id: string,
): Promise<TransactionTypeVersion | null> {
  return firstOrNull(
    await db
      .select()
      .from(transactionTypeVersions)
      .where(inEnvironment(environmentId, id))
      .limit(1),
  );
}

/** The highest version number of a type, `0` for none: a new draft takes the next. */
export async function latestTransactionTypeVersionNumber(
  tx: Db,
  environmentId: string,
  transactionTypeId: string,
): Promise<number> {
  const [row] = await tx
    .select({ value: max(transactionTypeVersions.version) })
    .from(transactionTypeVersions)
    .where(
      and(
        eq(transactionTypeVersions.environmentId, environmentId),
        eq(transactionTypeVersions.transactionTypeId, transactionTypeId),
      ),
    );
  return row?.value ?? 0;
}

/** The latest and the published version of each type: what a type resource serves. */
export async function listCurrentTransactionTypeVersions(
  db: Db,
  environmentId: string,
  transactionTypeIds: readonly string[],
): Promise<
  ReadonlyMap<
    string,
    { latest: TransactionTypeVersion | null; published: TransactionTypeVersion | null }
  >
> {
  const current = new Map<
    string,
    { latest: TransactionTypeVersion | null; published: TransactionTypeVersion | null }
  >(transactionTypeIds.map((id) => [id, { latest: null, published: null }]));
  if (transactionTypeIds.length === 0) {
    return current;
  }
  const ofTypes = and(
    eq(transactionTypeVersions.environmentId, environmentId),
    inArray(transactionTypeVersions.transactionTypeId, [...transactionTypeIds]),
  );
  const latest = await db
    .selectDistinctOn([transactionTypeVersions.transactionTypeId])
    .from(transactionTypeVersions)
    .where(ofTypes)
    .orderBy(transactionTypeVersions.transactionTypeId, desc(transactionTypeVersions.version));
  const published = await db
    .select()
    .from(transactionTypeVersions)
    .where(and(ofTypes, eq(transactionTypeVersions.status, 'published')));
  for (const row of latest) {
    const entry = current.get(row.transactionTypeId);
    if (entry !== undefined) {
      entry.latest = row;
    }
  }
  for (const row of published) {
    const entry = current.get(row.transactionTypeId);
    if (entry !== undefined) {
      entry.published = row;
    }
  }
  return current;
}

/** `PATCH /transaction-type-versions/:id`; `null` when the version is no longer a draft. */
export async function updateTransactionTypeVersionDraft(
  tx: Db,
  environmentId: string,
  id: string,
  changes: Partial<TransactionTypeVersionValues>,
): Promise<TransactionTypeVersion | null> {
  return firstOrNull(
    await tx
      .update(transactionTypeVersions)
      .set({
        ...(changes.fieldSchemas === undefined ? {} : { fieldSchemas: [...changes.fieldSchemas] }),
        ...(changes.statuses === undefined ? {} : { statuses: [...changes.statuses] }),
        ...(changes.relationSchemas === undefined
          ? {}
          : { relationSchemas: [...changes.relationSchemas] }),
        ...(changes.allowCardLikeStrings === undefined
          ? {}
          : { allowCardLikeStrings: changes.allowCardLikeStrings }),
      })
      .where(and(inEnvironment(environmentId, id), eq(transactionTypeVersions.status, 'draft')))
      .returning(),
  );
}

/**
 * C104.1, under the type's lock: publishes the draft and supersedes the published version. `null`
 * when the version is not in this environment or is no longer a draft.
 */
export async function publishTransactionTypeVersion(
  tx: Db,
  environmentId: string,
  id: string,
  at: Date,
): Promise<{
  published: TransactionTypeVersion;
  superseded: TransactionTypeVersion | null;
} | null> {
  return tx.transaction(async (inner) => {
    const version = await getTransactionTypeVersion(inner, environmentId, id);
    if (version === null) {
      return null;
    }
    await inner
      .select({ id: transactionTypes.id })
      .from(transactionTypes)
      .where(
        and(
          eq(transactionTypes.environmentId, environmentId),
          eq(transactionTypes.id, version.transactionTypeId),
        ),
      )
      .for('update');
    const draft = await getTransactionTypeVersion(inner, environmentId, id);
    if (draft?.status !== 'draft') {
      return null;
    }
    const superseded = firstOrNull(
      await inner
        .update(transactionTypeVersions)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(transactionTypeVersions.environmentId, environmentId),
            eq(transactionTypeVersions.transactionTypeId, version.transactionTypeId),
            eq(transactionTypeVersions.status, 'published'),
          ),
        )
        .returning(),
    );
    const published = inserted(
      await inner
        .update(transactionTypeVersions)
        .set({ status: 'published', publishedAt: at })
        .where(inEnvironment(environmentId, id))
        .returning(),
      'publishTransactionTypeVersion',
    );
    return { published, superseded };
  });
}
