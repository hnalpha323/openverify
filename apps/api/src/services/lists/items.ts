/**
 * C97.1, C97.5 (Workflow 7B): the list item routes' service. Owner: `api-lists`, with
 * `api-biometric-lists` behind the embed queue for faces and backgrounds.
 *
 * An item is keyed through the list (`keys.ts`), sealed, and written under the list's row lock, so
 * its limit and its `version` move one writer at a time. A value its normaliser refuses answers a
 * code and nothing of the value (C100.4). Each write takes the C12 policy `lists-write`.
 */
import {
  filterValues,
  newId,
  type IdPrefix,
  type ListItemDocument,
  type ListKind,
} from '@openverify/contracts';
import type { listItemListDocumentSchema, listListItemsQuerySchema } from '@openverify/contracts';
import { ListKeyInputError } from '@openverify/checks';
import { LIST_KIND_REGISTRY, LIST_LIMITS, listItemStatusSchema } from '@openverify/core';
import {
  archiveListItem as archiveListItemRow,
  getListItem,
  insertListItems,
  listListItems as listListItemRows,
  lockList,
  type Db,
  type ListItem,
  type ListRow,
} from '@openverify/db';
import type { z } from 'zod';
import { ListProblemError, NotFoundError, SignalProblemError } from '../../errors.js';
import { stageListUpdated } from '../../workflows/actions/lists/list-updated.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import { createBiometricListItem } from './biometric/items.js';
import { fieldError } from './field-error.js';
import { newListItem } from './keys.js';
import type { ListActing } from './lists.js';
import { consumeListWrite } from './rate.js';
import { listItemResource } from './resources.js';

export type ListListItemsQuery = z.infer<typeof listListItemsQuerySchema>;

const ITEMS_PATH = '/api/v1/list-items';

/** C97.5: the items `list` may hold. */
export const itemLimitOf = (list: Pick<ListRow, 'type'>): number =>
  LIST_KIND_REGISTRY[list.type].biometric
    ? LIST_LIMITS.itemsPerBiometricList
    : LIST_LIMITS.itemsPerList;

/**
 * The list an item goes into, under its row lock, in `tx`.
 * @throws {NotFoundError} for a list this environment does not hold.
 * @throws {ListProblemError} 422 `list_kind_mismatch`, 409 `list_archived`.
 */
export async function lockWritableList(
  tx: Db,
  environmentId: string,
  listId: string,
  kind: ListKind,
): Promise<ListRow> {
  const list = await lockList(tx, environmentId, listId);
  if (list === null) {
    throw new NotFoundError(`List ${listId} was not found.`);
  }
  if (list.type !== kind) {
    throw new ListProblemError('list_kind_mismatch', `List ${listId} holds another kind of item.`, {
      errors: [fieldError('/data/attributes/list-id', 'Names a list of another kind.')],
    });
  }
  if (list.status === 'archived') {
    throw new ListProblemError('list_archived', `List ${listId} is archived.`);
  }
  return list;
}

/** A value its normaliser refused, as a problem naming the code and no value (C100.4). */
function refusal(error: ListKeyInputError): ListProblemError {
  const code = error.code as ConstructorParameters<typeof ListProblemError>[0];
  return new ListProblemError(
    code,
    `The value was refused: ${code}.`,
    error.member === undefined
      ? {}
      : { errors: [fieldError(`/data/attributes/${error.member}`, `Refused: ${code}.`)] },
  );
}

export async function createListItem(
  deps: ApiDependencies,
  acting: ListActing,
  kind: ListKind,
  attributes: Readonly<Record<string, unknown>>,
): Promise<ListItemDocument> {
  const { environmentId } = acting.ctx;
  await consumeListWrite(deps, environmentId);
  if (kind === 'face' || kind === 'selfie-background') {
    return createBiometricListItem(deps, acting, kind, attributes);
  }
  const { 'list-id': listId, ...value } = attributes;
  const id = newId(LIST_KIND_REGISTRY[kind].itemPrefix as IdPrefix);
  const { item, staged } = await deps.db.transaction(async (tx) => {
    const list = await lockWritableList(tx, environmentId, listId as string, kind);
    if (list.itemCount >= itemLimitOf(list)) {
      throw new ListProblemError(
        'list_limit_reached',
        `List ${list.id} holds as many items as its limit allows.`,
      );
    }
    let row;
    try {
      row = newListItem(deps.blindIndexKey, environmentId, list, {
        id,
        value: kind === 'email-address' ? { 'match-type': 'email_address', ...value } : value,
        creator: { type: acting.actor.type, id: acting.actor.id },
      });
    } catch (error) {
      throw error instanceof ListKeyInputError ? refusal(error) : error;
    }
    const { inserted } = await insertListItems(tx, environmentId, list.id, [row]);
    if (inserted.length === 0) {
      throw new ListProblemError('list_item_exists', `List ${list.id} already holds this value.`);
    }
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'list-item.created',
        resourceType: 'list-item',
        resourceId: id,
        metadata: { 'list-id': list.id, kind },
      }),
    );
    // C127.12 (F20): the item can match from here on.
    const updated = await stageListUpdated(tx, deps, environmentId, [
      { listId: list.id, changeKind: 'items-added', items: 1 },
    ]);
    return { item: await getListItem(tx, environmentId, id), staged: updated };
  });
  await deps.events.dispatch(staged);
  return { data: listItemResource(requireRead(item, id), acting.mask) };
}

function requireRead(item: ListItem | null, id: string): ListItem {
  if (item === null) {
    throw new NotFoundError(`List item ${id} was not found.`);
  }
  return item;
}

export async function getListItemDocument(
  deps: ApiDependencies,
  acting: ListActing,
  _kind: ListKind,
  id: string,
): Promise<ListItemDocument> {
  const item = await getListItem(deps.db, acting.ctx.environmentId, id);
  return { data: listItemResource(requireRead(item, id), acting.mask) };
}

export async function archiveListItem(
  deps: ApiDependencies,
  acting: ListActing,
  _kind: ListKind,
  id: string,
): Promise<ListItemDocument> {
  const { environmentId } = acting.ctx;
  const { item, staged } = await deps.db.transaction(async (tx) => {
    const archived = await archiveListItemRow(tx, environmentId, id, deps.clock.now());
    if (archived === null) {
      return { item: archived, staged: [] };
    }
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'list-item.archived',
        resourceType: 'list-item',
        resourceId: id,
        metadata: { 'list-id': archived.listId },
      }),
    );
    // C127.12 (F20): the item stops matching, once.
    return {
      item: archived,
      staged: archived.changed
        ? await stageListUpdated(tx, deps, environmentId, [
            { listId: archived.listId, changeKind: 'items-archived', items: 1 },
          ])
        : [],
    };
  });
  await deps.events.dispatch(staged);
  return { data: listItemResource(requireRead(item, id), acting.mask) };
}

export async function listListItems(
  deps: ApiDependencies,
  acting: ListActing,
  query: ListListItemsQuery,
): Promise<z.infer<typeof listItemListDocumentSchema>> {
  const listId = query['filter[list-id]'];
  if (listId === undefined) {
    throw new SignalProblemError(
      'filter_required',
      'Items are listed per list: give filter[list-id].',
    );
  }
  const page = await withCursor(() =>
    listListItemRows(
      deps.db,
      acting.ctx.environmentId,
      { listId, statuses: filterValues(query['filter[status]'], listItemStatusSchema) },
      pageRequest(query),
    ),
  );
  const filters = { 'filter[list-id]': listId, 'filter[status]': query['filter[status]'] };
  return {
    data: page.items.map((item) => listItemResource(item, acting.mask)),
    links: { next: nextLink(ITEMS_PATH, filters, query, page.next) },
  };
}
