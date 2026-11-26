/**
 * The user audit log of the session's environment (C15, dashboard API, `audit-logs:read`):
 * every state-changing call, file views, sign-ins, MFA changes and environment switches. The
 * client address and user agent are masked (null) without `pii:view`.
 */
import 'server-only';
import {
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
  type UserAuditLogResource,
} from '@openverify/contracts';
import { apiRequest } from './client';

const AUDIT_LOGS_PATH = '/dashboard/audit-logs';
/** Entries per page of the `/audit-logs` list. */
export const AUDIT_LOGS_PAGE_SIZE = 25;

/** The list filters the API supports, already validated; a list value is comma-separated. */
export interface AuditLogQuery {
  readonly action?: string | undefined;
  readonly actorId?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  /** ISO-8601, inclusive. */
  readonly createdAtStart?: string | undefined;
  /** ISO-8601, exclusive. */
  readonly createdAtEnd?: string | undefined;
  /** C168.6: every action starting with this, such as `settings.` (kebab case). */
  readonly actionPrefix?: string | undefined;
  /** C168.6: one exact IPv4 or IPv6 address; the API needs `pii:view` for it. */
  readonly ip?: string | undefined;
  /** The last entry ID of the previous page. */
  readonly after?: string | undefined;
}

/** `GET /dashboard/audit-logs`: one page, newest first. */
export function listAuditLogs(query: AuditLogQuery) {
  return apiRequest({
    method: 'GET',
    path: AUDIT_LOGS_PATH,
    query: {
      'filter[action]': query.action,
      'filter[actor-id]': query.actorId,
      'filter[resource-type]': query.resourceType,
      'filter[resource-id]': query.resourceId,
      'filter[created-at-start]': query.createdAtStart,
      'filter[created-at-end]': query.createdAtEnd,
      'filter[action-prefix]': query.actionPrefix,
      'filter[ip]': query.ip,
      'page[after]': query.after,
      'page[size]': String(AUDIT_LOGS_PAGE_SIZE),
    },
    schema: userAuditLogListDocumentSchema,
  });
}

/** `GET /dashboard/audit-logs/:id`. */
export async function getAuditLog(id: string): Promise<UserAuditLogResource> {
  const { data } = await apiRequest({
    method: 'GET',
    path: `${AUDIT_LOGS_PATH}/${encodeURIComponent(id)}`,
    schema: userAuditLogDocumentSchema,
  });
  return data;
}

/** Settings changes read for the collection tier trail (C107.7): the newest 100. */
export const SETTINGS_CHANGES_PAGE_SIZE = 100;

/**
 * C107.7, C108: the `settings.updated` entries of `environmentId`, newest first, for the trail of
 * collection tier changes (the entries whose metadata names `signal-collection`).
 */
export function listSettingsChanges(environmentId: string) {
  return apiRequest({
    method: 'GET',
    path: AUDIT_LOGS_PATH,
    query: {
      'filter[action]': 'settings.updated',
      'filter[resource-type]': 'environment',
      'filter[resource-id]': environmentId,
      'page[size]': String(SETTINGS_CHANGES_PAGE_SIZE),
    },
    schema: userAuditLogListDocumentSchema,
  });
}
