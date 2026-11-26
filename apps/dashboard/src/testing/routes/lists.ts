/**
 * `dashboard-lists-transactions`' mock routes for the lists console (Workflow 7C, C108): the
 * lists, their items and importers, registered on a `routeApi()` the test made. Paths are after
 * `/api/v1`; every value is synthetic.
 */
import type {
  ImporterResource,
  ListItemResource,
  ListResource,
  ImporterError,
} from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { RouteApi } from '../api-routes';
import { importerErrors, listDocument, pageOf } from '../lists-fixtures';

export const LISTS_PATH = '/lists';
export const LIST_ITEMS_PATH = '/list-items';
export const IMPORTERS_PATH = '/importers';
export const SETTINGS_PATH = '/dashboard/settings';

/** A reviewer (7B Stage 1a amendment 21): lists read and written, importers read only. */
export const LIST_REVIEWER: readonly Permission[] = [
  'lists:read',
  'lists:write',
  'importers:read',
  'pii:view',
];
/** A viewer: the reads, no value (no `pii:view`). */
export const LIST_VIEWER: readonly Permission[] = ['lists:read', 'importers:read'];
/** An administrator's list scopes, with imports and the settings read. */
export const LIST_ADMIN: readonly Permission[] = [
  'lists:read',
  'lists:write',
  'importers:read',
  'importers:write',
  'pii:view',
  'settings:read',
];

export function serveLists(
  api: RouteApi,
  lists: readonly ListResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', LISTS_PATH, 200, pageOf(lists, next));
}

export function serveList(api: RouteApi, list: ListResource): RouteApi {
  return api.on('GET', `${LISTS_PATH}/${list.id}`, 200, listDocument(list));
}

export function serveListItems(
  api: RouteApi,
  items: readonly ListItemResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', LIST_ITEMS_PATH, 200, pageOf(items, next));
}

export function serveImporters(
  api: RouteApi,
  importers: readonly ImporterResource[],
  next: string | null = null,
): RouteApi {
  return api.on('GET', IMPORTERS_PATH, 200, pageOf(importers, next));
}

export function serveImporter(
  api: RouteApi,
  resource: ImporterResource,
  errors?: readonly ImporterError[],
  next: string | null = null,
): RouteApi {
  api.on('GET', `${IMPORTERS_PATH}/${resource.id}`, 200, { data: resource });
  return api.on(
    'GET',
    `${IMPORTERS_PATH}/${resource.id}/errors`,
    200,
    importerErrors(errors, next),
  );
}

/** `GET /dashboard/settings` with `biometric-lists-basis` (and the face window) as given. */
export function serveListSettings(
  api: RouteApi,
  basis: string | null,
  faceTemplateRetentionDays = 365,
): RouteApi {
  return api.on('GET', SETTINGS_PATH, 200, {
    'require-mfa': false,
    'inquiry-retention-days': null,
    'api-log-retention-days': 30,
    'webhook-delivery-retention-days': 30,
    'event-retention-days': 90,
    'face-template-retention-days': faceTemplateRetentionDays,
    'biometric-lists-basis': basis,
  });
}
