/**
 * C168.6 (Phase 9, Workflow 9B; review P23; contracts B28): the audit explorer's list, the C15 list
 * with `filter[action-prefix]`, `filter[from]` (included), `filter[to]` (excluded) and `filter[ip]`.
 *
 * `filter[ip]` matches one exact address through `audit_log_ip_index` (the address's HMAC under the
 * environment's blind-index subkey; the address is never compared or logged), and needs `pii:view`
 * besides `audit-logs:read`. Without the blind-index key the filter cannot be answered, so it is
 * refused with 503 rather than answering an unfiltered list. The next page's link keeps every
 * filter.
 */
import { filterValues, type UserAuditLogResource } from '@openverify/contracts';
import { auditIpHmac, auditIpIndexKey, listUserAuditLogs, type Db } from '@openverify/db';
import { z } from 'zod';
import type { PiiMask } from '../../auth/pii.js';
import { AppError, PermissionDeniedError } from '../../errors.js';
import { toUserAuditLogResource, type UserAuditLogQuery } from '../audit-log.js';
import { nextLink, pageRequest, withCursor } from '../pagination.js';

/** The explorer's query: C15's list query with the four C168.6 filters. */
export type AuditExplorerQuery = UserAuditLogQuery & {
  'filter[action-prefix]'?: string | undefined;
  'filter[from]'?: string | undefined;
  'filter[to]'?: string | undefined;
  'filter[ip]'?: string | undefined;
};

const FILTERS = [
  'filter[action]',
  'filter[actor-id]',
  'filter[resource-type]',
  'filter[resource-id]',
  'filter[created-at-start]',
  'filter[created-at-end]',
  'filter[action-prefix]',
  'filter[from]',
  'filter[to]',
  'filter[ip]',
] as const;

const anyString = z.string();

const toDate = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

/** 503: the process has no blind-index key, so `filter[ip]` has no index to read. */
class AuditIpIndexUnavailableError extends AppError {
  override name = 'AuditIpIndexUnavailableError';

  constructor() {
    super({
      status: 503,
      detail: 'filter[ip] is not available: set OPENVERIFY_BLIND_INDEX_KEY.',
    });
  }
}

export interface AuditExplorerOptions {
  /** The caller holds `pii:view`, which `filter[ip]` needs. */
  piiView: boolean;
}

/**
 * `GET /dashboard/audit-logs`: the environment's entries, newest first, filtered and paged.
 * @throws {PermissionDeniedError} for `filter[ip]` without `pii:view`.
 * @throws {AppError} 503 for `filter[ip]` without the blind-index key.
 */
export async function listAuditExplorerDocument(
  db: Db,
  environmentId: string,
  query: AuditExplorerQuery,
  mask: PiiMask,
  path: string,
  options: AuditExplorerOptions,
): Promise<{ data: UserAuditLogResource[]; links: { next: string | null } }> {
  const ip = query['filter[ip]'];
  let ipHmac: string | undefined;
  if (ip !== undefined) {
    if (!options.piiView) {
      throw new PermissionDeniedError('filter[ip] needs the pii:view permission.', ['pii:view']);
    }
    const key = auditIpIndexKey();
    if (key === null) {
      throw new AuditIpIndexUnavailableError();
    }
    ipHmac = auditIpHmac(key, environmentId, ip);
  }
  const page = await withCursor(() =>
    listUserAuditLogs(db, environmentId, {
      ...pageRequest(query),
      action: filterValues(query['filter[action]'], anyString),
      actorId: filterValues(query['filter[actor-id]'], anyString),
      resourceType: query['filter[resource-type]'],
      resourceId: filterValues(query['filter[resource-id]'], anyString),
      createdAtStart: toDate(query['filter[created-at-start]']),
      createdAtEnd: toDate(query['filter[created-at-end]']),
      actionPrefix: query['filter[action-prefix]'],
      from: toDate(query['filter[from]']),
      to: toDate(query['filter[to]']),
      ipHmac,
    }),
  );
  const data = page.items.map((entry) => toUserAuditLogResource(entry, mask));
  const filters = Object.fromEntries(FILTERS.map((name) => [name, query[name]]));
  return { data, links: { next: nextLink(path, filters, query, page.next) } };
}
