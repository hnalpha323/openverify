/**
 * C99.3 (Workflow 7B): the list match routes' service. Owner: `api-lists`. A match's compared value
 * and dismissal reason are masked without `pii:view`; a dismissal is audited without its reason.
 */
import {
  filterValues,
  idSchema,
  type DismissListMatchBody,
  type ListMatchDocument,
  type ListMatchResource,
  type listListMatchesQuerySchema,
  type listMatchListDocumentSchema,
} from '@openverify/contracts';
import { listMatchStatusSchema, type ListKind } from '@openverify/core';
import {
  dismissListMatch as dismissListMatchRow,
  getListMatch,
  getLists,
  listListMatches as listListMatchRows,
  type Db,
  type ListMatch,
} from '@openverify/db';
import type { z } from 'zod';
import type { PiiMask } from '../../auth/pii.js';
import { ListProblemError, NotFoundError } from '../../errors.js';
import { auditEntryOf, type ApiDependencies } from '../context.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';
import type { ListActing } from './lists.js';
import { listMatchResource } from './resources.js';

export type ListListMatchesQuery = z.infer<typeof listListMatchesQuerySchema>;

const MATCHES_PATH = '/api/v1/list-matches';

/** The matches as resources, each with its list's kind, which its types name. */
async function resources(
  db: Db,
  environmentId: string,
  matches: readonly ListMatch[],
  mask: PiiMask,
): Promise<ListMatchResource[]> {
  const lists = await getLists(db, environmentId, [...new Set(matches.map((m) => m.listId))]);
  const kinds = new Map<string, ListKind>(lists.map((list) => [list.id, list.type]));
  return matches.flatMap((match) => {
    const kind = kinds.get(match.listId);
    return kind === undefined ? [] : [listMatchResource(match, kind, mask)];
  });
}

export async function listListMatches(
  deps: ApiDependencies,
  acting: ListActing,
  query: ListListMatchesQuery,
): Promise<z.infer<typeof listMatchListDocumentSchema>> {
  const { environmentId } = acting.ctx;
  const page = await withCursor(() =>
    listListMatchRows(
      deps.db,
      environmentId,
      {
        inquiryIds: filterValues(query['filter[inquiry-id]'], idSchema('inq')),
        accountIds: filterValues(query['filter[account-id]'], idSchema('acc')),
        listIds: filterValues(query['filter[list-id]'], idSchema('lst')),
        statuses: filterValues(query['filter[status]'], listMatchStatusSchema),
      },
      pageRequest(query),
    ),
  );
  const filters = {
    'filter[inquiry-id]': query['filter[inquiry-id]'],
    'filter[account-id]': query['filter[account-id]'],
    'filter[list-id]': query['filter[list-id]'],
    'filter[status]': query['filter[status]'],
  };
  return {
    data: await resources(deps.db, environmentId, page.items, acting.mask),
    links: { next: nextLink(MATCHES_PATH, filters, query, page.next) },
  };
}

export async function getListMatchDocument(
  deps: ApiDependencies,
  acting: ListActing,
  id: string,
): Promise<ListMatchDocument> {
  const { environmentId } = acting.ctx;
  const match = await getListMatch(deps.db, environmentId, id);
  const [data] = match === null ? [] : await resources(deps.db, environmentId, [match], acting.mask);
  if (data === undefined) {
    throw new NotFoundError(`List match ${id} was not found.`);
  }
  return { data };
}

export async function dismissListMatch(
  deps: ApiDependencies,
  acting: ListActing,
  id: string,
  attributes: DismissListMatchBody['data']['attributes'],
): Promise<ListMatchDocument> {
  const { environmentId } = acting.ctx;
  const dismissed = await deps.db.transaction(async (tx) => {
    if ((await getListMatch(tx, environmentId, id)) === null) {
      throw new NotFoundError(`List match ${id} was not found.`);
    }
    const row = await dismissListMatchRow(tx, environmentId, id, {
      reason: attributes.reason,
      at: deps.clock.now(),
    });
    if (row === null) {
      throw new ListProblemError('list_match_not_open', `List match ${id} is not open.`);
    }
    await deps.audit.record(
      tx,
      auditEntryOf(acting.ctx, acting.actor, {
        action: 'list-match.dismissed',
        resourceType: 'list-match',
        resourceId: id,
      }),
    );
    return row;
  });
  const [data] = await resources(deps.db, environmentId, [dismissed], acting.mask);
  if (data === undefined) {
    throw new NotFoundError(`List match ${id} was not found.`);
  }
  return { data };
}

/** C107.6: the most list matches one document includes, as for reports (C70.5). */
export const MAX_INCLUDED_LIST_MATCHES = 50;

/**
 * C107.6: the list matches of `GET /inquiries/:id?include=list-matches` and the account's, the
 * `GET /list-matches` view, newest first, each masked as that route serves it to the caller.
 */
export async function includedListMatchesFor(
  db: Db,
  environmentId: string,
  target: { inquiryId: string } | { accountId: string },
  mask: PiiMask,
): Promise<ListMatchResource[]> {
  const { items } = await listListMatchRows(
    db,
    environmentId,
    'inquiryId' in target ? { inquiryIds: [target.inquiryId] } : { accountIds: [target.accountId] },
    { size: MAX_INCLUDED_LIST_MATCHES },
  );
  return resources(db, environmentId, items, mask);
}
