/**
 * Connect reads and writes of the console (C242), through the server API with the operator's
 * session (C21), and the destination's activation through its BFF route (C231.3), which takes a
 * user session only. Failures are `@openverify/node` errors, which `renderPage` and `runAction` map.
 * While the installation's switch is off every one of these answers the one generic 404 (C231.10).
 */
import 'server-only';
import {
  connectionDocumentSchema,
  connectionListDocumentSchema,
  consentRecordDocumentSchema,
  consentRecordListDocumentSchema,
  shareTokenDocumentSchema,
  shareTokenListDocumentSchema,
  type ActivateConnectionBody,
  type ConnectionResource,
  type ConsentRecordResource,
  type ConsentWithdrawalReason,
  type RedeemShareTokenBody,
  type SharePolicyInput,
  type ShareTokenDirection,
  type ShareTokenResource,
  type ShareTokenStatus,
} from '@openverify/contracts';
import { apiRequest } from '../../lib/api/client';
import { cursorFromNextLink } from '../../lib/list-query';

/** Connections per page: an organisation has few. */
export const CONNECTIONS_PAGE_SIZE = 100;

export interface ConnectionsPage {
  readonly connections: readonly ConnectionResource[];
  /** The cursor of the next page, or null. */
  readonly next: string | null;
}

const connectionPath = (id: string) => `/connect/connections/${encodeURIComponent(id)}`;

/** `GET /connect/connections` (`connect-connections:read`): both directions, one page. */
export async function listConnections(after?: string): Promise<ConnectionsPage> {
  const page = await apiRequest({
    method: 'GET',
    path: '/connect/connections',
    query: { 'page[after]': after, 'page[size]': String(CONNECTIONS_PAGE_SIZE) },
    schema: connectionListDocumentSchema,
  });
  return { connections: page.data, next: cursorFromNextLink(page.links.next, 'cxn') };
}

/** `GET /connect/connections/:id`, as the caller's side sees it. */
export async function getConnection(id: string): Promise<ConnectionResource> {
  return (
    await apiRequest({ method: 'GET', path: connectionPath(id), schema: connectionDocumentSchema })
  ).data;
}

/** `POST /dashboard/connect/connections/:id/activate` (C231.3): the destination, in the console. */
export async function activateConnection(
  id: string,
  body: ActivateConnectionBody,
): Promise<ConnectionResource> {
  return (
    await apiRequest({
      method: 'POST',
      path: `/dashboard${connectionPath(id)}/activate`,
      body,
      schema: connectionDocumentSchema,
    })
  ).data;
}

/** `POST /connect/connections/:id/deactivate` (C231.4): either side. */
export async function deactivateConnection(id: string): Promise<ConnectionResource> {
  return (
    await apiRequest({
      method: 'POST',
      path: `${connectionPath(id)}/deactivate`,
      schema: connectionDocumentSchema,
    })
  ).data;
}

/** `POST /connect/connections/:id/reactivate` (C231.5): the source. */
export async function reactivateConnection(id: string): Promise<ConnectionResource> {
  return (
    await apiRequest({
      method: 'POST',
      path: `${connectionPath(id)}/reactivate`,
      schema: connectionDocumentSchema,
    })
  ).data;
}

/** `POST /connect/connections/:id/share-policy` (C231.6): the source writes version n + 1. */
export async function changeSharePolicy(
  id: string,
  policy: SharePolicyInput,
): Promise<ConnectionResource> {
  return (
    await apiRequest({
      method: 'POST',
      path: `${connectionPath(id)}/share-policy`,
      body: { data: { type: 'connect/connection', attributes: { 'share-policy': policy } } },
      schema: connectionDocumentSchema,
    })
  ).data;
}

// Share tokens (C232-C234) -----------------------------------------------------------------------

/** Share tokens per list page. */
export const SHARE_TOKENS_PAGE_SIZE = 25;

export interface ShareTokenFilters {
  readonly direction?: ShareTokenDirection | undefined;
  readonly status?: ShareTokenStatus | undefined;
  readonly connectionId?: string | undefined;
}

export interface ShareTokensPage {
  readonly tokens: readonly ShareTokenResource[];
  readonly next: string | null;
}

const tokenPath = (id: string) => `/connect/share-tokens/${encodeURIComponent(id)}`;

/**
 * `GET /connect/share-tokens` (`connect-share-tokens:read`; C232.2): the outbound tokens of this
 * environment and the inbound ones whose destination it is; never a peek.
 */
export async function listShareTokens(
  filters: ShareTokenFilters,
  after?: string,
): Promise<ShareTokensPage> {
  const page = await apiRequest({
    method: 'GET',
    path: '/connect/share-tokens',
    query: {
      'filter[direction]': filters.direction,
      'filter[status]': filters.status,
      'filter[connection-id]': filters.connectionId,
      'page[after]': after,
      'page[size]': String(SHARE_TOKENS_PAGE_SIZE),
    },
    schema: shareTokenListDocumentSchema,
  });
  return { tokens: page.data, next: cursorFromNextLink(page.links.next, 'cnst') };
}

/**
 * `GET /connect/share-tokens/:id` as the caller's side sees it; with `peek`, the destination's peek
 * (`peek-source-data=true`, C233), which counts against the token's ten peeks and the rate policy.
 */
export async function getShareToken(
  id: string,
  { peek = false }: { readonly peek?: boolean } = {},
): Promise<ShareTokenResource> {
  return (
    await apiRequest({
      method: 'GET',
      path: tokenPath(id),
      query: peek ? { 'peek-source-data': 'true' } : {},
      schema: shareTokenDocumentSchema,
    })
  ).data;
}

/** `POST /connect/share-tokens/:id/expire` (C232.4): the source. */
export async function expireShareToken(id: string): Promise<ShareTokenResource> {
  return (
    await apiRequest({
      method: 'POST',
      path: `${tokenPath(id)}/expire`,
      schema: shareTokenDocumentSchema,
    })
  ).data;
}

/** `POST /connect/share-tokens/:id/redeem` (C234.1): the destination; 202 with the token pending. */
export async function redeemShareToken(
  id: string,
  body: RedeemShareTokenBody,
): Promise<ShareTokenResource> {
  return (
    await apiRequest({
      method: 'POST',
      path: `${tokenPath(id)}/redeem`,
      body,
      schema: shareTokenDocumentSchema,
    })
  ).data;
}

// Consent records (C236, C237) ------------------------------------------------------------------

/** Consent records shown per object: an object rarely has more than a few. */
export const CONSENT_RECORDS_PAGE_SIZE = 100;

/**
 * `GET /connect/consent-records?filter[subject-id]=` (`connect-share-tokens:read`; C236.2): the
 * records about an object on both sides (a destination record's subject is the object a redemption
 * made or filled, C236.10). The evidence and the stored text come only with `pii:view`.
 */
export async function listConsentRecords(
  subjectId: string,
): Promise<readonly ConsentRecordResource[]> {
  return (
    await apiRequest({
      method: 'GET',
      path: '/connect/consent-records',
      query: {
        'filter[subject-id]': subjectId,
        'page[size]': String(CONSENT_RECORDS_PAGE_SIZE),
      },
      schema: consentRecordListDocumentSchema,
    })
  ).data;
}

/** `POST /connect/consent-records/:id/withdraw` (C237.1), from the console. */
export async function withdrawConsentRecord(
  id: string,
  reason: ConsentWithdrawalReason | undefined,
): Promise<ConsentRecordResource> {
  return (
    await apiRequest({
      method: 'POST',
      path: `/connect/consent-records/${encodeURIComponent(id)}/withdraw`,
      body: {
        data: {
          type: 'consent-record',
          attributes: reason === undefined ? {} : { 'withdrawal-reason': reason },
        },
      },
      schema: consentRecordDocumentSchema,
    })
  ).data;
}
