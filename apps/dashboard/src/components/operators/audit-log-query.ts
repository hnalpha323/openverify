/**
 * The audit log list's URL state (C23): `/audit-logs?action=&actor=&resource-type=&resource-id=
 * &action-prefix=&from=&to=&after=`. An IP address is never read from the URL (C168.6, rule 11): the
 * address search is posted (`app/audit-logs/actions.ts`). Each filter is checked with the contract's own schemas before the API is
 * asked, so the page can explain a filter it cannot use instead of failing. Dates are whole UTC
 * days: `from` is inclusive, `to` too (the API's end is exclusive, so it gets the next midnight).
 */
import {
  anyIdSchema,
  auditActionSchema,
  filterListSchema,
  idSchema,
  listUserAuditLogsQuerySchema,
} from '@openverify/contracts';
import { z } from 'zod';
import type { AuditLogQuery } from '../../lib/api/audit-logs';
import { parseCursor } from '../../lib/list-query';

export interface AuditLogFilters {
  readonly action?: string;
  readonly actor?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  /** C168.6: every action starting with this, such as `settings.`. */
  readonly actionPrefix?: string;
  /** `YYYY-MM-DD`, UTC, inclusive. */
  readonly from?: string;
  /** `YYYY-MM-DD`, UTC, inclusive. */
  readonly to?: string;
}

export type AuditLogFilterErrors = Partial<Record<keyof AuditLogFilters, string>>;

export interface ParsedAuditLogQuery {
  /** The filters as entered (trimmed), for the form. */
  readonly filters: AuditLogFilters;
  /** What the API is asked, once every filter is usable. */
  readonly api: AuditLogQuery;
  /** Why a filter cannot be used, by filter. */
  readonly errors: AuditLogFilterErrors;
}

const PARAMS: Readonly<Record<keyof AuditLogFilters, string>> = {
  action: 'action',
  actor: 'actor',
  resourceType: 'resource-type',
  resourceId: 'resource-id',
  actionPrefix: 'action-prefix',
  from: 'from',
  to: 'to',
};

const CHECKS: Readonly<
  Record<Exclude<keyof AuditLogFilters, 'from' | 'to'>, { schema: z.ZodType; message: string }>
> = {
  action: {
    schema: filterListSchema(auditActionSchema),
    message: 'Enter actions such as inquiry.approved, separated by commas.',
  },
  actor: {
    schema: filterListSchema(z.union([idSchema('usr'), idSchema('key'), idSchema('wfr')])),
    message: 'Enter user, API key or workflow run IDs (usr_…, key_…, wfr_…), separated by commas.',
  },
  resourceType: {
    schema: z.string().min(1).max(64),
    message: 'Enter a resource type of at most 64 characters, such as inquiry.',
  },
  resourceId: {
    schema: filterListSchema(anyIdSchema),
    message: 'Enter IDs such as inq_…, separated by commas.',
  },
  actionPrefix: {
    schema: listUserAuditLogsQuerySchema.shape['filter[action-prefix]'],
    message: 'Enter the start of an action name in lower case, such as settings. or inquiry.',
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a `YYYY-MM-DD` date, or `null` for anything else (such as 2026-02-30). */
function midnightOf(value: string): number | null {
  const match = DATE.exec(value);
  if (match === null) {
    return null;
  }
  const [, year, month, day] = match.map(Number);
  const time = Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0);
  return new Date(time).toISOString().startsWith(value) ? time : null;
}

/** One URL value, trimmed; empty, missing and repeated values are no value. */
function single(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function parseAuditLogQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): ParsedAuditLogQuery {
  const filters: Record<string, string> = {};
  for (const [key, name] of Object.entries(PARAMS)) {
    const value = single(params[name]);
    if (value !== undefined) {
      filters[key] = value;
    }
  }
  const entered = filters as AuditLogFilters;
  const errors: Record<string, string> = {};
  for (const [key, { schema, message }] of Object.entries(CHECKS)) {
    const value = filters[key];
    if (value !== undefined && !schema.safeParse(value).success) {
      errors[key] = message;
    }
  }
  const start = entered.from === undefined ? undefined : midnightOf(entered.from);
  const end = entered.to === undefined ? undefined : midnightOf(entered.to);
  if (start === null) {
    errors.from = 'Enter a date.';
  }
  if (end === null) {
    errors.to = 'Enter a date.';
  } else if (end !== undefined && typeof start === 'number' && end < start) {
    errors.to = 'Enter a date on or after the start date.';
  }

  const after = parseCursor(params.after, 'aud');
  const api: AuditLogQuery = {
    ...(entered.action === undefined ? {} : { action: entered.action }),
    ...(entered.actor === undefined ? {} : { actorId: entered.actor }),
    ...(entered.resourceType === undefined ? {} : { resourceType: entered.resourceType }),
    ...(entered.resourceId === undefined ? {} : { resourceId: entered.resourceId }),
    ...(entered.actionPrefix === undefined ? {} : { actionPrefix: entered.actionPrefix }),
    ...(typeof start === 'number' ? { createdAtStart: new Date(start).toISOString() } : {}),
    ...(typeof end === 'number' ? { createdAtEnd: new Date(end + DAY_MS).toISOString() } : {}),
    ...(after === undefined ? {} : { after }),
  };
  return { filters: entered, api, errors };
}

/** The filters as URL parameters, for links that keep them (pagination). */
export function auditLogFilterQuery(filters: AuditLogFilters): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(PARAMS).map(([key, name]) => [name, filters[key as keyof AuditLogFilters]]),
  );
}
