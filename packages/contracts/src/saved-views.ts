/**
 * C165.1, C165.2, C165.5 (Phase 9, Workflow 9B Stage 1a, (X); decision 44): saved views (`svw_`,
 * ours), on the dashboard API, users only. A view names one of `SAVED_VIEW_LISTS`, its filters
 * (validated by that list route's own query schema, `SAVED_VIEW_QUERY_SCHEMAS`), columns, sort and
 * whether it is shared with every user of the environment who can read the list. Routes:
 * `GET`/`POST /api/v1/dashboard/saved-views`, `PATCH`/`DELETE /api/v1/dashboard/saved-views/:id`
 * (the owner's only; a shared view is copied to be changed).
 *
 * No personal data in a view (C165.2): a filter key the list marks as personal data
 * (`savedViewPiiFilterKeys`) is refused with 422 `saved_view_pii_filter`, so a stored view never holds
 * a person's data. A view whose filter its list no longer accepts says so (`filters-valid: false`,
 * naming the keys) instead of silently widening (C165.5); each reader sees only what that reader's
 * own permissions and masking allow.
 */
import { SAVED_VIEW_LISTS, type SavedViewList } from '@openverify/core';
import { z } from 'zod';
import { listAccountsQuerySchema } from './accounts.js';
import { listApiLogsQuerySchema } from './api-logs.js';
import { listCasesQuerySchema } from './cases.js';
import { listEventsQuerySchema } from './events.js';
import { idSchema } from './ids.js';
import { listInquiriesQuerySchema } from './inquiries.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
} from './json-api.js';
import { listReportsQuerySchema } from './reports.js';
import { TRANSACTION_FIELD_FILTER_PATTERN, listTransactionsQuerySchema } from './transactions.js';
import { listUserAuditLogsQuerySchema } from './user-audit-logs.js';
import { listWebhookDeliveriesQuerySchema } from './webhook-deliveries.js';

export { SAVED_VIEW_LISTS };
export const savedViewListSchema = z.enum(SAVED_VIEW_LISTS);

/** C165.1: each list's own query schema, which a view's `filters` must pass. */
export const SAVED_VIEW_QUERY_SCHEMAS: Readonly<Record<SavedViewList, z.ZodType>> = Object.freeze({
  inquiries: listInquiriesQuerySchema,
  accounts: listAccountsQuerySchema,
  reports: listReportsQuerySchema,
  cases: listCasesQuerySchema,
  transactions: listTransactionsQuerySchema,
  'api-logs': listApiLogsQuerySchema,
  'webhook-deliveries': listWebhookDeliveriesQuerySchema,
  events: listEventsQuerySchema,
  'audit-logs': listUserAuditLogsQuerySchema,
});

/**
 * C165.2: the filter keys each list marks as personal data: reference ids, the step reached (C151.8,
 * review P15), a searched identifier or field value (Phase 8 C137.2's membership-oracle rule) and an
 * IP address (C168.6). No list filters by a name or an email today.
 */
export const SAVED_VIEW_PII_FILTER_KEYS: Readonly<Record<SavedViewList, readonly string[]>> =
  Object.freeze({
    inquiries: ['filter[reference-id]', 'filter[next-step-name]'],
    accounts: ['filter[reference-id]'],
    reports: ['filter[reference-id]'],
    cases: ['filter[reference-id]'],
    transactions: ['filter[reference-id]', 'filter[identifier][value]'],
    'api-logs': [],
    'webhook-deliveries': [],
    events: [],
    'audit-logs': ['filter[ip]'],
  });

/**
 * The keys of `filters` a saved view of `list` may not hold, in their order. A transaction's
 * `filter[fields.<key>]` is personal data on a string field; without `transactionStringFields` (the
 * type version's string field keys) every field filter counts as one, failing closed.
 */
export function savedViewPiiFilterKeys(
  list: SavedViewList,
  filters: Readonly<Record<string, unknown>>,
  options: { transactionStringFields?: ReadonlySet<string> } = {},
): string[] {
  const marked = new Set(SAVED_VIEW_PII_FILTER_KEYS[list]);
  return Object.keys(filters).filter((key) => {
    if (marked.has(key)) {
      return true;
    }
    if (list !== 'transactions') {
      return false;
    }
    const field = TRANSACTION_FIELD_FILTER_PATTERN.exec(key)?.[1];
    return (
      field !== undefined &&
      (options.transactionStringFields === undefined || options.transactionStringFields.has(field))
    );
  });
}

/** A view's filters: the list route's parameters, paging left out. */
export const savedViewFiltersSchema = z
  .record(
    z.string().regex(/^filter\[[a-z0-9_.\-[\]]{1,96}\]$/, 'must be a filter of the list'),
    z.union([z.string().min(1).max(1024), z.array(z.string().min(1).max(1024)).min(1).max(100)]),
  )
  .refine((filters) => Object.keys(filters).length <= 30, 'at most 30 filters');

const savedViewMembers = {
  name: z.string().trim().min(1).max(100),
  filters: savedViewFiltersSchema,
  /** The list's columns, in order. */
  columns: z
    .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
    .max(50)
    .optional(),
  /** One sort attribute, `-` first for descending. */
  sort: z
    .string()
    .regex(/^-?[a-z][a-z0-9-]{0,63}$/)
    .nullable()
    .optional(),
  shared: z.boolean().optional(),
};

export const createSavedViewBodySchema = requestDocumentSchema(
  'saved-view',
  z.strictObject({ list: savedViewListSchema, ...savedViewMembers }),
);
export type CreateSavedViewBody = z.infer<typeof createSavedViewBodySchema>;

/** `PATCH`: an omitted member is unchanged; the list never changes. */
export const updateSavedViewBodySchema = requestDocumentSchema(
  'saved-view',
  z
    .strictObject({
      name: savedViewMembers.name.optional(),
      filters: savedViewMembers.filters.optional(),
      columns: savedViewMembers.columns,
      sort: savedViewMembers.sort,
      shared: savedViewMembers.shared,
    })
    .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update'),
);
export type UpdateSavedViewBody = z.infer<typeof updateSavedViewBodySchema>;

export const savedViewAttributesSchema = z.strictObject({
  list: savedViewListSchema,
  name: z.string().min(1).max(100),
  filters: savedViewFiltersSchema,
  columns: z.array(z.string().max(64)).max(50),
  sort: z.string().max(65).nullable(),
  shared: z.boolean(),
  /** The owner, the only user who may change or delete it. */
  'owner-id': idSchema('usr'),
  /** C165.5: `false` when the list no longer accepts a filter, named in `invalid-filters`. */
  'filters-valid': z.boolean(),
  'invalid-filters': z.array(z.string().max(100)).max(30),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});

export const savedViewResourceSchema = resourceSchema(
  'saved-view',
  'svw',
  savedViewAttributesSchema,
);
export type SavedViewResource = z.infer<typeof savedViewResourceSchema>;
export const savedViewDocumentSchema = singleDocumentSchema(savedViewResourceSchema);
export const savedViewListDocumentSchema = listDocumentSchema(savedViewResourceSchema);

/** `GET /dashboard/saved-views`: the caller's own and the environment's shared, by list. */
export const listSavedViewsQuerySchema = z.strictObject({
  'filter[list]': savedViewListSchema.optional(),
});
