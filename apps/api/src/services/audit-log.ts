/**
 * C15 user audit log: one entry per state-changing call by any principal, plus file views,
 * logins, logouts, MFA changes, environment switches and what the system did with no principal.
 * Entries are append-only; the client address and user agent are encrypted at rest and masked for
 * users without `pii:view`.
 *
 * Served by the server API (`GET /user-audit-logs`) and the dashboard API
 * (`GET /dashboard/audit-logs`), both with the permission `audit-logs:read`.
 */
import {
  auditActionSchema,
  buildUserAuditLogResource,
  filterValues,
  type AuditActor,
  type ListUserAuditLogsQuery,
  type ServedAuditActor,
  type UserAuditLogResource,
} from '@openverify/contracts';
import {
  appendAuditLog,
  getAuditLog,
  listUserAuditLogs,
  type AuditLog,
  type Db,
} from '@openverify/db';
import { z } from 'zod';
import type { PiiMask } from '../auth/pii.js';
import { NotFoundError } from '../errors.js';
import type { AuditLogger } from '../ports.js';
import { nextLink, pageRequest, withCursor } from './pagination.js';

/**
 * Actions the contract and the database both accept: dotted kebab-case without digits (the
 * `audit_logs_action_format` check allows letters, `-` and `_`; the contract no `_`).
 */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const STORABLE_ACTION = /^[a-z][a-z-]*(?:\.[a-z][a-z-]*)+$/;

function checkAction(action: string): void {
  if (!auditActionSchema.safeParse(action).success || !STORABLE_ACTION.test(action)) {
    throw new RangeError(`Audit action ${JSON.stringify(action)} is not dotted kebab-case`);
  }
}

/**
 * How a principal is stored, in every table that names one (`audit_logs`, `report_actions`,
 * `transaction_status_history`): one exhaustive switch, so a new kind of actor fails typecheck
 * here and never reads as another kind (owner decision 5 after Workflow 7B).
 */
export function storedActorOf(actor: AuditActor) {
  switch (actor.type) {
    case 'user':
      return { actorType: 'user', actorId: actor.id } as const;
    case 'api-key':
      return { actorType: 'api_key', actorId: actor.id } as const;
    case 'workflow-run':
      return { actorType: 'workflow_run', actorId: actor.id } as const;
  }
}

/** The DB-backed audit logger every route records through (`deps.audit`). */
export function createAuditLogger(): AuditLogger {
  return {
    async record(db, entry) {
      checkAction(entry.action);
      await appendAuditLog(db, entry.environmentId, {
        ...storedActorOf(entry.actor),
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        requestId: entry.requestId ?? null,
        ip: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      });
    },
  };
}

export interface SystemAuditEntry {
  action: string;
  resourceType: string;
  resourceId: string;
  /** Never PII. */
  metadata?: Record<string, unknown>;
}

/**
 * Records an action no principal took, such as the `user:reset-mfa` command a self-hoster runs. The
 * C15 resource serves it with the actor `{ type: 'system', id: null }`.
 */
export async function appendSystemAuditEntry(
  db: Db,
  environmentId: string,
  entry: SystemAuditEntry,
): Promise<void> {
  checkAction(entry.action);
  await appendAuditLog(db, environmentId, {
    actorType: 'system',
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
  });
}

/**
 * The C15 name of a stored action. Phase 1 wrote resource names in snake_case
 * (`user_session.created`); the contract spells them in kebab-case.
 */
export function auditActionName(stored: string): string {
  return stored.replace(/_/g, '-');
}

/** Who a stored entry names: an entry with no principal is the system's. */
function servedActorOf({ actorType, actorId }: AuditLog): ServedAuditActor {
  if (actorId === null) {
    return { type: 'system', id: null };
  }
  switch (actorType) {
    case 'system':
      return { type: 'system', id: null };
    case 'api_key':
      return { type: 'api-key', id: actorId };
    case 'user':
      return { type: 'user', id: actorId };
    case 'workflow_run':
      return { type: 'workflow-run', id: actorId };
  }
}

/**
 * The user-audit-log resource of a stored entry, with the client address and agent masked as
 * `mask` says, whoever wrote it.
 */
export function toUserAuditLogResource(entry: AuditLog, mask: PiiMask): UserAuditLogResource {
  return buildUserAuditLogResource({
    id: entry.publicId,
    action: auditActionName(entry.action),
    actor: servedActorOf(entry),
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    ipAddress: mask.ipAddress(entry.ip),
    userAgent: mask.userAgent(entry.userAgent),
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  });
}

const FILTERS = [
  'filter[action]',
  'filter[actor-id]',
  'filter[resource-type]',
  'filter[resource-id]',
  'filter[created-at-start]',
  'filter[created-at-end]',
] as const;

const anyString = z.string();

/**
 * The query of the audit log lists. The contract's inferred type leaves out the `created-at`
 * range that its schema (`listQuerySchema`) validates, so it is added here.
 */
export type UserAuditLogQuery = ListUserAuditLogsQuery & {
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
};

const toDate = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : new Date(value);

/**
 * `GET /user-audit-logs` and `GET /dashboard/audit-logs`: the environment's entries, newest
 * first, filtered and paged (C1, C9), system entries included.
 */
export async function listUserAuditLogDocument(
  db: Db,
  environmentId: string,
  query: UserAuditLogQuery,
  mask: PiiMask,
  path: string,
): Promise<{ data: UserAuditLogResource[]; links: { next: string | null } }> {
  const page = await withCursor(() =>
    listUserAuditLogs(db, environmentId, {
      ...pageRequest(query),
      action: filterValues(query['filter[action]'], anyString),
      actorId: filterValues(query['filter[actor-id]'], anyString),
      resourceType: query['filter[resource-type]'],
      resourceId: filterValues(query['filter[resource-id]'], anyString),
      createdAtStart: toDate(query['filter[created-at-start]']),
      createdAtEnd: toDate(query['filter[created-at-end]']),
    }),
  );
  const data = page.items.map((entry) => toUserAuditLogResource(entry, mask));
  const filters = Object.fromEntries(FILTERS.map((name) => [name, query[name]]));
  return { data, links: { next: nextLink(path, filters, query, page.next) } };
}

/**
 * `GET /user-audit-logs/:id` and `GET /dashboard/audit-logs/:id`.
 * @throws {NotFoundError} when the entry is not in the environment.
 */
export async function getUserAuditLogDocument(
  db: Db,
  environmentId: string,
  id: string,
  mask: PiiMask,
): Promise<{ data: UserAuditLogResource }> {
  const entry = await getAuditLog(db, environmentId, id);
  if (entry === null) {
    throw new NotFoundError('No audit log entry with this id exists.');
  }
  return { data: toUserAuditLogResource(entry, mask) };
}
