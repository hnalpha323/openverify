/**
 * List reads of the lists console (C97-C100, C108): the lists, a list's items and imports, and an
 * import's errors, through the server API with the operator's session. Item values come masked for
 * an operator without `pii:view` (C97.6): what a page shows is what these answered, and the
 * console never unmasks. Failures are `@openverify/node` errors, which `renderPage` maps.
 */
import 'server-only';
import {
  importerDocumentSchema,
  importerErrorListDocumentSchema,
  importerListDocumentSchema,
  listItemListDocumentSchema,
  listResourceDocumentSchema,
  listResourceListDocumentSchema,
  type DashboardSettings,
} from '@openverify/contracts';
import type { ListKind, ListStatus } from '@openverify/core';
import { apiRequest } from './client';
import { getSettings } from './settings';

/** Rows per list page. */
export const LISTS_PAGE_SIZE = 25;
/** Import errors per page; the API keeps at most 1,000 per import (C100.1). */
export const IMPORT_ERRORS_PAGE_SIZE = 100;

export interface ListFilters {
  readonly type?: ListKind | undefined;
  readonly status?: ListStatus | undefined;
}

/** `GET /lists`: one page, newest first; `filter[type]` takes the singular kind. */
export function listLists(filters: ListFilters, after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/lists',
    query: {
      'filter[type]': filters.type,
      'filter[status]': filters.status,
      'page[after]': after,
      'page[size]': String(LISTS_PAGE_SIZE),
    },
    schema: listResourceListDocumentSchema,
  });
}

/** `GET /lists/:id`, with the kind's limits in `meta`. */
export function getList(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/lists/${encodeURIComponent(id)}`,
    schema: listResourceDocumentSchema,
  });
}

/** `GET /list-items?filter[list-id]=`: one page of a list's items, newest first. */
export function listListItems(listId: string, after?: string) {
  return apiRequest({
    method: 'GET',
    path: '/list-items',
    query: {
      'filter[list-id]': listId,
      'page[after]': after,
      'page[size]': String(LISTS_PAGE_SIZE),
    },
    schema: listItemListDocumentSchema,
  });
}

/** `GET /importers?filter[list-id]=`: the list's newest imports. */
export function listImporters(listId: string) {
  return apiRequest({
    method: 'GET',
    path: '/importers',
    query: { 'filter[list-id]': listId, 'page[size]': String(LISTS_PAGE_SIZE) },
    schema: importerListDocumentSchema,
  });
}

/** `GET /importers/:id`. */
export function getImporter(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/importers/${encodeURIComponent(id)}`,
    schema: importerDocumentSchema,
  });
}

/** `GET /importers/:id/errors`: one page in row order, after the row `after`. */
export function listImporterErrors(id: string, after?: number) {
  return apiRequest({
    method: 'GET',
    path: `/importers/${encodeURIComponent(id)}/errors`,
    query: {
      'page[size]': String(IMPORT_ERRORS_PAGE_SIZE),
      'page[after]': after === undefined ? undefined : String(after),
    },
    schema: importerErrorListDocumentSchema,
  });
}

/**
 * What the console knows of the face and background acknowledgement (C97.4): the
 * `biometric-lists-basis` setting, read only with `settings:read`; without it, nothing.
 */
export type BiometricAcknowledgement =
  | { readonly kind: 'unreadable' }
  | {
      readonly kind: 'read';
      readonly basis: string | null;
      /** The face template window, the most a face or background list may keep its items. */
      readonly faceTemplateRetentionDays: number | undefined;
    };

export async function readBiometricAcknowledgement(
  canReadSettings: boolean,
): Promise<BiometricAcknowledgement> {
  if (!canReadSettings) {
    return { kind: 'unreadable' };
  }
  const settings: DashboardSettings = await getSettings();
  return {
    kind: 'read',
    basis: settings['biometric-lists-basis'] ?? null,
    faceTemplateRetentionDays: settings['face-template-retention-days'],
  };
}
