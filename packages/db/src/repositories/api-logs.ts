import { and, between, eq, type SQL, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { apiLogs, type ApiLog, type ApiLogRow } from '../schema.js';
import { openOptional, openOptionalJson, sealOptional, sealOptionalJson } from '../sealed.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import {
  allFilters,
  createdAtRange,
  equalsAny,
  firstOrNull,
  inserted,
  type CreatedAtRange,
  type OneOrMany,
} from './rows.js';
import { subjectIdsIn } from './subject-ids.js';

export interface NewApiLogInput {
  /** `alog_...`. */
  id: string;
  method: string;
  path: string;
  /** The route template; `null` when no route matched. */
  route?: string | null;
  status: number;
  durationMs: number;
  requestId?: string | null;
  idempotencyKey?: string | null;
  apiKeyId?: string | null;
  userId?: string | null;
  /** The resource the request was about (C16 redaction clears its bodies). */
  resourceId?: string | null;
  /** The client address; sealed for the row. */
  ip?: string | null;
  userAgent?: string | null;
  /** Parsed query, already redacted by the API; sealed. */
  query?: unknown;
  /** Request body, already redacted and truncated by the API; sealed. */
  requestBody?: unknown;
  /** Response body, already redacted and truncated by the API; sealed. */
  responseBody?: unknown;
}

export interface ListApiLogsOptions extends PageRequest, CreatedAtRange {
  method?: OneOrMany<string> | undefined;
  /** Exact codes (`404`) or classes (`4xx`), comma values meaning OR (C12). */
  status?: OneOrMany<string> | undefined;
  route?: OneOrMany<string> | undefined;
  apiKeyId?: OneOrMany<string> | undefined;
  /** C25.9 `filter[user-id]` (Workflow 2E): requests made with these users' sessions. */
  userId?: OneOrMany<string> | undefined;
}

const apiLogCursor = environmentCursor(apiLogs);

/** Opens the row's sealed columns and drops the ciphertexts. */
export function toApiLog(row: ApiLogRow): ApiLog {
  const { ipSealed, userAgentSealed, querySealed, requestBodySealed, responseBodySealed, ...log } =
    row;
  return {
    ...log,
    ip: openOptional(SEALED.apiLogIp, row.id, ipSealed),
    userAgent: openOptional(SEALED.apiLogUserAgent, row.id, userAgentSealed),
    query: openOptionalJson(SEALED.apiLogQuery, row.id, querySealed),
    requestBody: openOptionalJson(SEALED.apiLogRequestBody, row.id, requestBodySealed),
    responseBody: openOptionalJson(SEALED.apiLogResponseBody, row.id, responseBodySealed),
  };
}

/** Records one server API request (C12), after its response was sent. */
export async function createApiLog(
  db: Db,
  environmentId: string,
  input: NewApiLogInput,
): Promise<ApiLog> {
  const { id } = input;
  const rows = await db
    .insert(apiLogs)
    .values({
      id,
      environmentId,
      method: input.method,
      path: input.path,
      route: input.route ?? null,
      status: input.status,
      durationMs: input.durationMs,
      requestId: input.requestId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      apiKeyId: input.apiKeyId ?? null,
      userId: input.userId ?? null,
      resourceId: input.resourceId ?? null,
      subjectIds: subjectIdsIn(
        input.path,
        input.resourceId,
        input.query,
        input.requestBody,
        input.responseBody,
      ),
      ipSealed: sealOptional(SEALED.apiLogIp, id, input.ip),
      userAgentSealed: sealOptional(SEALED.apiLogUserAgent, id, input.userAgent),
      querySealed: sealOptionalJson(SEALED.apiLogQuery, id, input.query),
      requestBodySealed: sealOptionalJson(SEALED.apiLogRequestBody, id, input.requestBody),
      responseBodySealed: sealOptionalJson(SEALED.apiLogResponseBody, id, input.responseBody),
    })
    .returning();
  return toApiLog(inserted(rows, 'createApiLog'));
}

export async function getApiLog(db: Db, environmentId: string, id: string): Promise<ApiLog | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(apiLogs)
      .where(and(eq(apiLogs.id, id), eq(apiLogs.environmentId, environmentId)))
      .limit(1),
  );
  return row === null ? null : toApiLog(row);
}

const STATUS_CODE = /^[1-5][0-9]{2}$/;
const STATUS_CLASS = /^([1-5])xx$/;

/**
 * `filter[status]`: exact codes or `Nxx` classes, ORed.
 * @throws {RangeError} for anything else.
 */
function statusFilter(values: OneOrMany<string> | undefined): SQL | undefined | null {
  if (values === undefined) {
    return undefined;
  }
  const list = typeof values === 'string' ? [values] : [...values];
  if (list.length === 0) {
    return null;
  }
  return or(
    ...list.map((value) => {
      const normalized = value.trim().toLowerCase();
      if (STATUS_CODE.test(normalized)) {
        return eq(apiLogs.status, Number(normalized));
      }
      const match = STATUS_CLASS.exec(normalized);
      if (match === null) {
        throw new RangeError(`invalid status filter: ${value}`);
      }
      const base = Number(match[1]) * 100;
      return between(apiLogs.status, base, base + 99);
    }),
  );
}

/** C12 `GET /api-logs`: newest first, with the method, status, route, key and date filters. */
export async function listApiLogs(
  db: Db,
  environmentId: string,
  options: ListApiLogsOptions = {},
): Promise<Page<ApiLog>> {
  const filters = allFilters([
    eq(apiLogs.environmentId, environmentId),
    equalsAny(apiLogs.method, options.method),
    statusFilter(options.status),
    equalsAny(apiLogs.route, options.route),
    equalsAny(apiLogs.apiKeyId, options.apiKeyId),
    equalsAny(apiLogs.userId, options.userId),
    ...createdAtRange(apiLogs.createdAt, options),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, apiLogCursor, environmentId, options, async (after, limit) =>
    (
      await db
        .select()
        .from(apiLogs)
        .where(and(...filters, after))
        .orderBy(...newestFirst(apiLogCursor))
        .limit(limit)
    ).map(toApiLog),
  );
}
