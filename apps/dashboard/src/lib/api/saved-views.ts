/**
 * Saved views (C165.1, C165.2, C165.5) on the dashboard API with the operator's session: the
 * caller's own and the environment's shared views of a list, oldest first and unpaged; a view is
 * created, renamed or deleted by its owner only (a shared one is copied to be changed). A filter key
 * the list marks as personal data is refused (422 `saved_view_pii_filter`), and a view whose filter
 * its list no longer accepts says so (`filters-valid: false`). Failures are `@openverify/node`
 * errors, which the callers map.
 */
import 'server-only';
import {
  savedViewDocumentSchema,
  savedViewListDocumentSchema,
  type CreateSavedViewBody,
  type UpdateSavedViewBody,
} from '@openverify/contracts';
import type { SavedViewList } from '@openverify/core';
import { z } from 'zod';
import { apiRequest } from './client';

export const SAVED_VIEWS_PATH = '/dashboard/saved-views';

const viewPath = (id: string) => `${SAVED_VIEWS_PATH}/${encodeURIComponent(id)}`;

/** `GET /dashboard/saved-views?filter[list]=`: own and shared, oldest first. */
export function listSavedViews(list: SavedViewList) {
  return apiRequest({
    method: 'GET',
    path: SAVED_VIEWS_PATH,
    query: { 'filter[list]': list },
    schema: savedViewListDocumentSchema,
  });
}

/** `POST /dashboard/saved-views` (201). */
export function createSavedView(attributes: CreateSavedViewBody['data']['attributes']) {
  return apiRequest({
    method: 'POST',
    path: SAVED_VIEWS_PATH,
    body: { data: { type: 'saved-view', attributes } },
    schema: savedViewDocumentSchema,
  });
}

/** `PATCH /dashboard/saved-views/:id` (the owner's). */
export function updateSavedView(id: string, attributes: UpdateSavedViewBody['data']['attributes']) {
  return apiRequest({
    method: 'PATCH',
    path: viewPath(id),
    body: { data: { type: 'saved-view', attributes } },
    schema: savedViewDocumentSchema,
  });
}

/** `DELETE /dashboard/saved-views/:id` (204; the owner's). */
export async function deleteSavedView(id: string): Promise<void> {
  await apiRequest({ method: 'DELETE', path: viewPath(id), schema: z.undefined() });
}
