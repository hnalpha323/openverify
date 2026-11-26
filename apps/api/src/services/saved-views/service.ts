/**
 * C165.1, C165.2, C165.5 (Workflow 9B; decision 44): saved views on the dashboard API, users only.
 * Owner: `api-exports`.
 *
 * - A view names one of `SAVED_VIEW_LISTS`, which the caller must be able to read
 *   (`SAVED_VIEW_LIST_PERMISSIONS`, 403 otherwise). Its `filters` pass that list's own query schema
 *   (`SAVED_VIEW_QUERY_SCHEMAS`, 400 at each refused key) and hold no personal-data key
 *   (`savedViewPiiFilterKeys`: 422 `saved_view_pii_filter`, each pointer naming the key, never its
 *   value). A transaction view's every `filter[fields.<key>]` on a string field of any version (drafts
 *   included) counts as personal data, so a stored view never holds a person's data.
 * - The list answers the caller's own views and the environment's shared ones, of the lists the caller
 *   can read, oldest first. A shared view is the owner's filters, read by each reader with that
 *   reader's own permissions and masking: the view holds no data of its own.
 * - Only the owner changes or deletes a view (403 for another user's; 404 for one not in the
 *   environment); a shared view is copied to be changed.
 * - `filters-valid` and `invalid-filters` (C165.5): a view whose filter its list no longer accepts (the
 *   list's schema, or a field that became a string field) says so, naming the keys, instead of
 *   silently widening.
 */
import {
  SAVED_VIEW_QUERY_SCHEMAS,
  savedViewPiiFilterKeys,
  type createSavedViewBodySchema,
  type listSavedViewsQuerySchema,
  type SavedViewResource,
  type savedViewDocumentSchema,
  type savedViewListDocumentSchema,
  type updateSavedViewBodySchema,
} from '@openverify/contracts';
import { SAVED_VIEW_LISTS, type SavedViewList } from '@openverify/core';
import {
  createSavedViewRow,
  deleteSavedViewRow,
  getSavedViewRow,
  listAllTransactionFieldSchemas,
  listSavedViewRows,
  updateSavedViewRow,
  type Db,
  type SavedViewRecord,
} from '@openverify/db';
import type { z } from 'zod';
import {
  AppError,
  NotFoundError,
  PermissionDeniedError,
  type ProblemFieldError,
} from '../../errors.js';
import { systemClock, ulidIdGenerator, type Clock, type UserPrincipal } from '../../ports.js';
import { exportProblem, SAVED_VIEW_LIST_PERMISSIONS } from '../exports/problems.js';

export type SavedViewDocument = z.infer<typeof savedViewDocumentSchema>;
export type SavedViewListDocument = z.infer<typeof savedViewListDocumentSchema>;

type Filters = Record<string, string | string[]>;

export type ListSavedViews = (
  db: Db,
  user: UserPrincipal,
  query: z.infer<typeof listSavedViewsQuerySchema>,
) => Promise<SavedViewListDocument>;
export type CreateSavedView = (
  db: Db,
  user: UserPrincipal,
  body: z.infer<typeof createSavedViewBodySchema>,
  clock?: Clock,
) => Promise<SavedViewDocument>;
export type UpdateSavedView = (
  db: Db,
  user: UserPrincipal,
  id: string,
  body: z.infer<typeof updateSavedViewBodySchema>,
  clock?: Clock,
) => Promise<SavedViewDocument>;
export type DeleteSavedView = (db: Db, user: UserPrincipal, id: string) => Promise<void>;

const canRead = (user: UserPrincipal, list: SavedViewList) =>
  user.permissions.has(SAVED_VIEW_LIST_PERMISSIONS[list]);

/** The string field keys of every transaction type version of the environment, drafts included. */
async function transactionStringFields(db: Db, environmentId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const fields of await listAllTransactionFieldSchemas(db, environmentId)) {
    for (const field of fields as { type?: unknown; key?: unknown }[]) {
      if (field.type === 'string' && typeof field.key === 'string') {
        keys.add(field.key);
      }
    }
  }
  return keys;
}

/** The keys of `filters` the list's query schema refuses, in their order. */
function refusedKeys(list: SavedViewList, filters: Filters): string[] {
  const parsed = SAVED_VIEW_QUERY_SCHEMAS[list].safeParse(filters);
  if (parsed.success) {
    return [];
  }
  const keys = new Set<string>();
  for (const issue of parsed.error.issues) {
    const [first] = issue.path;
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) keys.add(key);
    } else if (typeof first === 'string' && first in filters) {
      keys.add(first);
    } else {
      // A rule over several keys (one filter that needs another): every key it may name.
      for (const key of Object.keys(filters)) keys.add(key);
    }
  }
  return Object.keys(filters).filter((key) => keys.has(key));
}

/** The personal-data keys of `filters` (C165.2), transaction string fields included. */
async function personalKeys(
  db: Db,
  environmentId: string,
  list: SavedViewList,
  filters: Filters,
): Promise<string[]> {
  return savedViewPiiFilterKeys(
    list,
    filters,
    list === 'transactions'
      ? { transactionStringFields: await transactionStringFields(db, environmentId) }
      : {},
  );
}

const pointer = (key: string): string => `/data/attributes/filters/${key}`;

/** Refuses filters the list does not take (400) or that hold personal data (422). */
async function checkFilters(
  db: Db,
  environmentId: string,
  list: SavedViewList,
  filters: Filters,
): Promise<void> {
  const refused = refusedKeys(list, filters);
  if (refused.length > 0) {
    throw new AppError({
      status: 400,
      title: 'Bad Request',
      detail: `A filter of the view is not one the ${list} list takes.`,
      errors: refused.map((key): ProblemFieldError => ({
        location: 'body',
        pointer: pointer(key),
        detail: `is not a filter the ${list} list takes`,
      })),
    });
  }
  const personal = await personalKeys(db, environmentId, list, filters);
  if (personal.length > 0) {
    throw exportProblem(
      'saved_view_pii_filter',
      'A saved view cannot filter on personal data.',
      personal.map((key) => ({
        location: 'body',
        pointer: pointer(key),
        detail: `${key} is personal data, so no saved view may filter on it.`,
      })),
    );
  }
}

/** C165.5: the view as its reader sees it, saying which filters its list no longer accepts. */
async function savedViewResource(db: Db, row: SavedViewRecord): Promise<SavedViewResource> {
  const filters = row.filters;
  const invalid = new Set([
    ...refusedKeys(row.list, filters),
    ...(await personalKeys(db, row.environmentId, row.list, filters)),
  ]);
  return {
    type: 'saved-view',
    id: row.id,
    attributes: {
      list: row.list,
      name: row.name,
      filters,
      columns: [...row.columns],
      sort: row.sort,
      shared: row.shared,
      'owner-id': row.ownerId,
      'filters-valid': invalid.size === 0,
      'invalid-filters': Object.keys(filters).filter((key) => invalid.has(key)),
      'created-at': row.createdAt.toISOString(),
      'updated-at': row.updatedAt.toISOString(),
    },
  };
}

function requireList(user: UserPrincipal, list: SavedViewList): void {
  if (!canRead(user, list)) {
    throw new PermissionDeniedError(`Saving a view of the ${list} list needs reading it.`, [
      SAVED_VIEW_LIST_PERMISSIONS[list],
    ]);
  }
}

/** The caller's own view: another user's answers 403, one not in the environment 404. */
async function ownView(db: Db, user: UserPrincipal, id: string): Promise<SavedViewRecord> {
  const row = await getSavedViewRow(db, user.environmentId, id);
  if (row === null) {
    throw new NotFoundError(`Saved view ${id} was not found.`);
  }
  if (row.ownerId !== user.userId) {
    throw new PermissionDeniedError(
      'Only the owner of a saved view changes or deletes it; copy a shared view to change it.',
    );
  }
  return row;
}

export const listSavedViews: ListSavedViews = async (db, user, query) => {
  const asked = query['filter[list]'];
  const lists = (asked === undefined ? SAVED_VIEW_LISTS : [asked]).filter((list) =>
    canRead(user, list),
  );
  const rows = await listSavedViewRows(db, user.environmentId, { ownerId: user.userId, lists });
  const data: SavedViewResource[] = [];
  for (const row of rows) {
    data.push(await savedViewResource(db, row));
  }
  return { data, links: { next: null } };
};

export const createSavedView: CreateSavedView = async (db, user, body, clock = systemClock) => {
  const attributes = body.data.attributes;
  requireList(user, attributes.list);
  await checkFilters(db, user.environmentId, attributes.list, attributes.filters);
  const row = await createSavedViewRow(db, user.environmentId, {
    id: ulidIdGenerator.newId('svw'),
    ownerId: user.userId,
    list: attributes.list,
    name: attributes.name,
    filters: attributes.filters,
    columns: attributes.columns ?? [],
    sort: attributes.sort ?? null,
    shared: attributes.shared ?? false,
    at: clock.now(),
  });
  return { data: await savedViewResource(db, row) };
};

export const updateSavedView: UpdateSavedView = async (db, user, id, body, clock = systemClock) => {
  const current = await ownView(db, user, id);
  const attributes = body.data.attributes;
  requireList(user, current.list);
  if (attributes.filters !== undefined) {
    await checkFilters(db, user.environmentId, current.list, attributes.filters);
  }
  const row = await updateSavedViewRow(db, user.environmentId, id, attributes, clock.now());
  if (row === null) {
    throw new NotFoundError(`Saved view ${id} was not found.`);
  }
  return { data: await savedViewResource(db, row) };
};

export const deleteSavedView: DeleteSavedView = async (db, user, id) => {
  await ownView(db, user, id);
  await deleteSavedViewRow(db, user.environmentId, id);
};
