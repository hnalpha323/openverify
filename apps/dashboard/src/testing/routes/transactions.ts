/**
 * `dashboard-lists-transactions`' mock routes for the transactions console (Workflow 7C, C108):
 * transactions, their types and the types' versions, registered on a `routeApi()` the test made.
 * Paths are after `/api/v1`; every value is synthetic.
 */
import type {
  TransactionLabelResource,
  TransactionRelationResource,
  TransactionResource,
  TransactionStatusChangeResource,
  TransactionTypeResource,
  TransactionTypeVersionResource,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { RouteApi } from '../api-routes';
import { pageOf, transactionLabel } from '../transactions-fixtures';

export const TRANSACTIONS_PATH = '/transactions';
export const TRANSACTION_TYPES_PATH = '/transaction-types';
export const TRANSACTION_TYPE_VERSIONS_PATH = '/transaction-type-versions';

/** A reviewer (7B Stage 1a amendment 21): the three transaction scopes, no type editing. */
export const TRANSACTION_REVIEWER: readonly Permission[] = [
  'transactions:read',
  'transactions:write',
  'transactions:redact',
  'pii:view',
];
/** A developer: transactions and types written, no redaction, no `pii:view`. */
export const TRANSACTION_DEVELOPER: readonly Permission[] = [
  'transactions:read',
  'transactions:write',
  'transaction-types:write',
];
/** A viewer: the read only. */
export const TRANSACTION_VIEWER: readonly Permission[] = ['transactions:read'];

export function serveTransactions(
  api: RouteApi,
  transactions: readonly TransactionResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', TRANSACTIONS_PATH, 200, pageOf(transactions, next));
}

/** `GET /transactions/:id/status-changes` answers one page of `changes`, newest first. */
export function serveStatusChanges(
  api: RouteApi,
  id: string,
  changes: readonly TransactionStatusChangeResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', `${TRANSACTIONS_PATH}/${id}/status-changes`, 200, pageOf(changes, next));
}

/** `GET /transactions/:id/labels` answers one page of `labels`, newest first. */
export function serveLabels(
  api: RouteApi,
  id: string,
  labels: readonly TransactionLabelResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', `${TRANSACTIONS_PATH}/${id}/labels`, 200, pageOf(labels, next));
}

/** `GET /transactions/:id/relations` answers one page of `relations`, newest first. */
export function serveRelations(
  api: RouteApi,
  id: string,
  relations: readonly TransactionRelationResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', `${TRANSACTIONS_PATH}/${id}/relations`, 200, pageOf(relations, next));
}

/**
 * `GET /transactions/:id` with its type and latest label included, as the console asks, and an
 * empty status history, label list and relation list, which a test replaces with
 * `serveStatusChanges`, `serveLabels` or `serveRelations`.
 */
export function serveTransaction(
  api: RouteApi,
  resource: TransactionResource,
  type: TransactionTypeResource,
  withLabel = true,
): RouteApi {
  serveStatusChanges(api, resource.id, []);
  serveLabels(api, resource.id, []);
  serveRelations(api, resource.id, []);
  return api.on('GET', `${TRANSACTIONS_PATH}/${resource.id}`, 200, {
    data: resource,
    included: [type, ...(withLabel ? [transactionLabel()] : [])],
  });
}

export function serveTransactionTypes(
  api: RouteApi,
  types: readonly TransactionTypeResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', TRANSACTION_TYPES_PATH, 200, pageOf(types, next));
}

/** `GET /transaction-type-versions` answers one page of `versions` (K7B-3). */
export function serveTransactionTypeVersions(
  api: RouteApi,
  versions: readonly TransactionTypeVersionResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', TRANSACTION_TYPE_VERSIONS_PATH, 200, pageOf(versions, next));
}

/** `GET /transaction-types/:id`, and an empty version list a test replaces. */
export function serveTransactionType(api: RouteApi, type: TransactionTypeResource): RouteApi {
  serveTransactionTypeVersions(api, []);
  return api.on('GET', `${TRANSACTION_TYPES_PATH}/${type.id}`, 200, { data: type });
}

export function serveTransactionTypeVersion(
  api: RouteApi,
  version: TransactionTypeVersionResource,
): RouteApi {
  return api.on('GET', `${TRANSACTION_TYPE_VERSIONS_PATH}/${version.id}`, 200, { data: version });
}
