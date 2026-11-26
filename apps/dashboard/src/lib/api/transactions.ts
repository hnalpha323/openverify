/**
 * Transaction reads of the transactions console (C104, C105, C108), through the server API with
 * the operator's session. `fields` comes masked member-wise without `pii:view` (C105.8): each key
 * and its type stay and the value is `null`. What a page shows is what these answered, and the
 * console never unmasks. Failures are `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import {
  transactionIncludeDocumentSchema,
  transactionListDocumentSchema,
  transactionTypeDocumentSchema,
  transactionTypeListDocumentSchema,
  transactionTypeVersionDocumentSchema,
} from '@openverify/contracts';
import { apiRequest } from './client';

/** Transactions and types per list page. */
export const TRANSACTIONS_PAGE_SIZE = 25;
/** The types a filter offers, from one page. */
export const TRANSACTION_TYPE_CHOICES = 100;

export interface TransactionFilters {
  readonly typeId?: string | undefined;
  readonly status?: string | undefined;
  readonly referenceId?: string | undefined;
  /** ISO times: the start is inclusive, the end exclusive (C1). */
  readonly createdAtStart?: string | undefined;
  readonly createdAtEnd?: string | undefined;
  /**
   * C165.3 (Workflow 9C): field key to value, each sent as `filter[fields.<key>]`. A string field
   * needs PII visibility on the API (403 otherwise).
   */
  readonly fields?: Readonly<Record<string, string>> | undefined;
}

/** `GET /transactions`: one page, newest first. */
export function listTransactions(filters: TransactionFilters, after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/transactions',
    query: {
      'filter[transaction-type-id]': filters.typeId,
      'filter[status]': filters.status,
      'filter[reference-id]': filters.referenceId,
      'filter[created-at-start]': filters.createdAtStart,
      'filter[created-at-end]': filters.createdAtEnd,
      ...Object.fromEntries(
        Object.entries(filters.fields ?? {}).map(([key, value]) => [
          `filter[fields.${key}]`,
          value,
        ]),
      ),
      'page[after]': after,
      'page[size]': String(TRANSACTIONS_PAGE_SIZE),
    },
    schema: transactionListDocumentSchema,
  });
}

/** `GET /transactions/:id` with its type and latest label. */
export function getTransaction(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/transactions/${encodeURIComponent(id)}`,
    query: { include: 'transaction-type,transaction-label' },
    schema: transactionIncludeDocumentSchema,
  });
}

/** `GET /transaction-types`: one page, newest first. */
export function listTransactionTypes(size: number = TRANSACTIONS_PAGE_SIZE, after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/transaction-types',
    query: { 'page[after]': after, 'page[size]': String(size) },
    schema: transactionTypeListDocumentSchema,
  });
}

/** `GET /transaction-types/:id`: the published version's content. */
export function getTransactionType(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/transaction-types/${encodeURIComponent(id)}`,
    schema: transactionTypeDocumentSchema,
  });
}

/** `GET /transaction-type-versions/:id`. */
export function getTransactionTypeVersion(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/transaction-type-versions/${encodeURIComponent(id)}`,
    schema: transactionTypeVersionDocumentSchema,
  });
}
