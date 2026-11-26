import { and, asc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  events,
  inquirySessions,
  reports,
  selfieCaptures,
  verifications,
  type EventPayload,
  type EventRecord,
} from '../schema.js';
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

export interface NewEventInput {
  id: string;
  /** C5/C17 event name, e.g. `inquiry.completed`. */
  name: string;
  /** `{ data: <resource>, included? }`; encrypted at rest. */
  payload: EventPayload;
  /** C14 webhook simulation; defaults to `false`. */
  simulated?: boolean;
  /** The resource the event is about; defaults to `payload.data.id` and `.type`. */
  objectId?: string | null;
  objectType?: string | null;
  /** C118.8, C121.3 (Workflow 8A): the internal cause, never in a payload. */
  cause?: EventCause;
}

/** C118.8, C121.3: what caused an event. Every member is optional: a system job has none. */
export interface EventCause {
  /** The run a step staged it from (`wfr_`). */
  runId?: string | null | undefined;
  /** The request's principal, or the principal that caused the root run (`usr_`, `key_`). */
  principal?: string | null | undefined;
  /** The test run a step or a request belongs to (`wfr_`). */
  testRunId?: string | null | undefined;
  bulkId?: string | null | undefined;
  /** C128.2: whether that principal held `inquiries:write` when it staged the event. */
  principalHeldInquiriesWrite?: boolean | null | undefined;
}

export interface ListEventsOptions extends PageRequest, CreatedAtRange {
  /** C12 `filter[name]`, comma values meaning OR. */
  name?: OneOrMany<string> | undefined;
  /** C12 `filter[object-id]`. */
  objectId?: OneOrMany<string> | undefined;
  /** C12 `filter[simulated]`; defaults to `false`. */
  simulated?: boolean | undefined;
  /**
   * C25.7 `filter[inquiry-id]` (Workflow 2E): events whose object is one of these inquiries, one
   * of their verifications, one of their inquiry sessions or one of their selfie captures (C40.1).
   */
  inquiryId?: OneOrMany<string> | undefined;
}

export interface BackfillOptions {
  /** The last event id of the previous batch. */
  after?: string | null;
  /** Defaults to 500. */
  limit?: number;
}

export interface BackfillBatch {
  /** Rows given an object id in this batch. */
  updated: number;
  /** Pass as `after` for the next batch; `null` when done. */
  next: string | null;
}

const eventCursor = environmentCursor(events);

/** `payload.data.id` and `.type`, the resource a C5 event payload embeds. */
export function eventObject(payload: EventPayload): { id: string | null; type: string | null } {
  const data = payload.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { id: null, type: null };
  }
  const { id, type } = data as { id?: unknown; type?: unknown };
  return {
    id: typeof id === 'string' ? id : null,
    type: typeof type === 'string' ? type : null,
  };
}

export async function createEvent(
  db: Db,
  environmentId: string,
  input: NewEventInput,
): Promise<EventRecord> {
  const object = eventObject(input.payload);
  const rows = await db
    .insert(events)
    .values({
      id: input.id,
      environmentId,
      name: input.name,
      payload: input.payload,
      simulated: input.simulated ?? false,
      objectId: input.objectId === undefined ? object.id : input.objectId,
      objectType: input.objectType === undefined ? object.type : input.objectType,
      causedByRunId: input.cause?.runId ?? null,
      causedByPrincipal: input.cause?.principal ?? null,
      causedByTestRunId: input.cause?.testRunId ?? null,
      causedByBulkId: input.cause?.bulkId ?? null,
      causedByPrincipalHeldInquiriesWrite: input.cause?.principalHeldInquiriesWrite ?? null,
    })
    .returning();
  return inserted(rows, 'createEvent');
}

/** C5 `GET /events/:id`. */
export async function getEvent(
  db: Db,
  environmentId: string,
  id: string,
): Promise<EventRecord | null> {
  return firstOrNull(
    await db
      .select()
      .from(events)
      .where(and(eq(events.id, id), eq(events.environmentId, environmentId)))
      .limit(1),
  );
}

/**
 * C25.7: the event's object is one of the inquiries, or a verification, inquiry session or selfie
 * capture (C40.1) of one of them, in this environment. The ids are gathered in an `ARRAY(...)`
 * subquery, which Postgres runs once (an InitPlan) through the verifications', sessions' and
 * captures' inquiry indexes; the events are then found through
 * `events_environment_id_object_id_idx` with `object_id = ANY(...)`, not by filtering the
 * environment's events. `null` for an empty list, which matches nothing.
 */
function aboutInquiries(
  environmentId: string,
  inquiryIds: OneOrMany<string> | undefined,
): SQL | undefined | null {
  if (inquiryIds === undefined) {
    return undefined;
  }
  const list = typeof inquiryIds === 'string' ? [inquiryIds] : [...inquiryIds];
  if (list.length === 0) {
    return null;
  }
  const ids = sql`array[${sql.join(
    list.map((id) => sql`${id}`),
    sql`, `,
  )}]::text[]`;
  return sql`${events.objectId} = any(array(
    select unnest(${ids})
    union all
    select ${verifications.id} from ${verifications}
     where ${verifications.environmentId} = ${environmentId}
       and ${verifications.inquiryId} = any(${ids})
    union all
    select ${inquirySessions.id} from ${inquirySessions}
     where ${inquirySessions.environmentId} = ${environmentId}
       and ${inquirySessions.inquiryId} = any(${ids})
    union all
    select ${selfieCaptures.id} from ${selfieCaptures}
     where ${selfieCaptures.environmentId} = ${environmentId}
       and ${selfieCaptures.inquiryId} = any(${ids})
    union all
    select ${reports.id} from ${reports}
     where ${reports.environmentId} = ${environmentId}
       and ${reports.inquiryId} = any(${ids})
  ))`;
}

/**
 * C12 `GET /events`: newest first, by name, object, date and `simulated` (default false); C25.7
 * by inquiry.
 */
export async function listEvents(
  db: Db,
  environmentId: string,
  options: ListEventsOptions = {},
): Promise<Page<EventRecord>> {
  const filters = allFilters([
    eq(events.environmentId, environmentId),
    eq(events.simulated, options.simulated ?? false),
    equalsAny(events.name, options.name),
    equalsAny(events.objectId, options.objectId),
    aboutInquiries(environmentId, options.inquiryId),
    ...createdAtRange(events.createdAt, options),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, eventCursor, environmentId, options, (after, limit) =>
    db
      .select()
      .from(events)
      .where(and(...filters, after))
      .orderBy(...newestFirst(eventCursor))
      .limit(limit),
  );
}

/**
 * Gives events written before schema v2 their `object_id` and `object_type`, which only the
 * encrypted payload knows, so `filter[object-id]` and C16 redaction find them. A batch
 * scans up to `limit` events without an object, across environments, by id; repeat with
 * `next` until it is `null`. Payloads without `data.id` stay without an object.
 */
export async function backfillEventObjectIds(
  db: Db,
  options: BackfillOptions = {},
): Promise<BackfillBatch> {
  const limit = options.limit ?? 500;
  const rows = await db
    .select({ id: events.id, payload: events.payload })
    .from(events)
    .where(
      and(
        isNull(events.objectId),
        options.after == null ? undefined : gt(events.id, options.after),
      ),
    )
    .orderBy(asc(events.id))
    .limit(limit);
  let updated = 0;
  for (const row of rows) {
    const object = eventObject(row.payload);
    if (object.id === null) {
      continue;
    }
    await db
      .update(events)
      .set({ objectId: object.id, objectType: object.type })
      .where(and(eq(events.id, row.id), isNull(events.objectId)));
    updated += 1;
  }
  return { updated, next: rows.length === limit ? (rows.at(-1)?.id ?? null) : null };
}
