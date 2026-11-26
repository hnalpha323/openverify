/**
 * C166.1 (Workflow 9B, `api-exports`; contracts B19): what an export selects. `filter` is the list
 * route's own filters, validated by that route's query schema; `saved-view-id` names a view whose
 * filters are read instead. Verifications have no list route, so their filter schema is ours
 * (`filter[type]` required, as the contract asks, then status, inquiry and the created-at range).
 *
 * Only a view of the environment that is the creator's own (a user's) or shared may be named, and its
 * list must be the export's object type (verifications and lists have no saved view list); anything
 * else reads as a view that does not exist (404), or a mismatch (422).
 */
import {
  filterListSchema,
  filterTimestampSchema,
  idSchema,
  listAccountsQuerySchema,
  listInquiriesQuerySchema,
  listListItemsQuerySchema,
  listReportsQuerySchema,
  listTransactionsQuerySchema,
  type CreateExportBody,
} from '@openverify/contracts';
import {
  IMPORTER_LIST_KINDS,
  VERIFICATION_TYPES,
  type ExportObjectType,
  type SavedViewList,
} from '@openverify/core';
import { getList, getSavedViewRow, type Db } from '@openverify/db';
import { z } from 'zod';
import {
  AppError,
  NotFoundError,
  UnprocessableContentError,
  type ProblemFieldError,
} from '../../errors.js';
import type { Principal } from '../../ports.js';
import { exportProblem } from './problems.js';

/** The public spelling of a verification type (`government-id`), as the API names it. */
export const publicVerificationType = (type: string): string => type.replaceAll('_', '-');

const PUBLIC_VERIFICATION_TYPES = VERIFICATION_TYPES.map(publicVerificationType) as [
  string,
  ...string[],
];

/** Ours: the filters of an export of verifications. */
export const exportVerificationsFilterSchema = z.strictObject({
  'filter[type]': filterListSchema(z.enum(PUBLIC_VERIFICATION_TYPES)),
  'filter[status]': filterListSchema(z.string().regex(/^[a-z_]{1,32}$/)).optional(),
  'filter[inquiry-id]': filterListSchema(idSchema('inq')).optional(),
  'filter[created-at-start]': filterTimestampSchema.optional(),
  'filter[created-at-end]': filterTimestampSchema.optional(),
});

/** C166.1: each type's filter schema, the list route's own. */
export const EXPORT_FILTER_SCHEMAS: Readonly<Record<ExportObjectType, z.ZodType>> = Object.freeze({
  inquiries: listInquiriesQuerySchema,
  verifications: exportVerificationsFilterSchema,
  accounts: listAccountsQuerySchema,
  reports: listReportsQuerySchema,
  lists: listListItemsQuerySchema,
  transactions: listTransactionsQuerySchema,
});

/** The saved view list of each type that has one. */
const SAVED_VIEW_LIST_OF: Readonly<Partial<Record<ExportObjectType, SavedViewList>>> = {
  inquiries: 'inquiries',
  accounts: 'accounts',
  reports: 'reports',
  transactions: 'transactions',
};

export type ExportFilter = Record<string, string | string[]>;

/** The selection an export cut: its filter (with values) and the view it came from. */
export interface ExportSelection {
  filter: ExportFilter;
  savedViewId: string | null;
}

const FILTER_POINTER = '/data/attributes/filter';

/** The filter read through the type's schema; 400 at each key it refuses, never echoing a value. */
export function parsedFilter(objectType: ExportObjectType, filter: ExportFilter): ExportFilter {
  const parsed = EXPORT_FILTER_SCHEMAS[objectType].safeParse(filter);
  if (parsed.success) {
    return filter;
  }
  const errors: ProblemFieldError[] = parsed.error.issues.map((issue) => {
    const keys =
      issue.code === 'unrecognized_keys' ? issue.keys : issue.path.slice(0, 1).map(String);
    return {
      location: 'body',
      pointer: keys.length === 0 ? FILTER_POINTER : `${FILTER_POINTER}/${keys.join(',')}`,
      detail: `is not a filter the ${objectType} list takes`,
    };
  });
  throw new AppError({
    status: 400,
    title: 'Bad Request',
    detail: `The filter is not one the ${objectType} list takes.`,
    errors,
  });
}

/** The filter of the body, or of the saved view it names. */
export async function exportSelectionOf(
  db: Db,
  principal: Principal,
  attributes: CreateExportBody['data']['attributes'],
): Promise<ExportSelection> {
  const objectType = attributes['object-type'];
  const viewId = attributes['saved-view-id'];
  if (viewId === undefined) {
    return { filter: parsedFilter(objectType, attributes.filter ?? {}), savedViewId: null };
  }
  const view = await getSavedViewRow(db, principal.environmentId, viewId);
  const visible =
    view !== null &&
    (view.shared || (principal.kind === 'user' && view.ownerId === principal.userId));
  if (!visible) {
    throw new NotFoundError(`Saved view ${viewId} was not found.`);
  }
  if (SAVED_VIEW_LIST_OF[objectType] !== view.list) {
    throw new UnprocessableContentError(`The saved view is of the ${view.list} list.`, [
      {
        location: 'body',
        pointer: '/data/attributes/saved-view-id',
        detail: `must name a view of the ${objectType} list`,
      },
    ]);
  }
  return { filter: parsedFilter(objectType, view.filters), savedViewId: view.id };
}

/**
 * C166.3 (the 7B refresh's default): a list export is of a list with an importer, whose items hold
 * the values the importer reads back; a face or selfie-background list holds templates and layouts,
 * which no export includes, so it is refused (422 `export_list_kind_refused`).
 */
export async function assertExportableList(
  db: Db,
  environmentId: string,
  filter: ExportFilter,
): Promise<void> {
  const listId = filter['filter[list-id]'];
  if (typeof listId !== 'string') {
    throw new UnprocessableContentError('An export of list items names one list.', [
      { location: 'body', pointer: `${FILTER_POINTER}/filter[list-id]`, detail: 'is required' },
    ]);
  }
  const list = await getList(db, environmentId, listId);
  if (list === null) {
    throw new NotFoundError(`List ${listId} was not found.`);
  }
  if (!IMPORTER_LIST_KINDS.includes(list.type)) {
    // K9-29 (Workflow 9D): the refusal has its own code.
    throw exportProblem(
      'export_list_kind_refused',
      'This list holds face templates or image layouts, which no export includes.',
      [
        {
          location: 'body',
          pointer: `${FILTER_POINTER}/filter[list-id]`,
          detail: 'must name a list whose kind has an importer',
        },
      ],
    );
  }
}
