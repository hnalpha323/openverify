/**
 * C14 webhook deliveries as the server API lists them: newest first with the C1 cursor, by
 * webhook, event, status and the C9 creation range, each with its event's name. Every query
 * is scoped to the caller's environment.
 *
 * The repository's `listWebhookDeliveries` has no creation range, so the list query lives
 * here; the single lookup uses the repository's `getWebhookDeliveryWithEvent`.
 */
import {
  buildWebhookDeliveryResource,
  isEventName,
  type WebhookDeliveryResource,
  type WebhookDeliveryStatus,
} from '@openverify/contracts';
import {
  InvalidCursorError,
  events,
  pageSize,
  webhookDeliveries,
  type Db,
  type Page,
  type WebhookDeliveryRecord,
} from '@openverify/db';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';

export interface WebhookDeliveryFilters {
  webhookIds?: readonly string[] | undefined;
  eventIds?: readonly string[] | undefined;
  statuses?: readonly WebhookDeliveryStatus[] | undefined;
  /** Inclusive. */
  createdAtStart?: Date | undefined;
  /** Exclusive. */
  createdAtEnd?: Date | undefined;
}

export interface WebhookDeliveryPageRequest {
  /** `page[after]`: the last delivery of the previous page. */
  after?: string | undefined;
  size?: number | undefined;
}

const anyOf = (column: Parameters<typeof inArray>[0], values: readonly string[] | undefined) =>
  values === undefined ? undefined : inArray(column, [...values]);

/** The C1 cursor: rows strictly after the `after` delivery in (created-at, id) order. */
const afterCursor = (environmentId: string, after: string): SQL =>
  sql`(${webhookDeliveries.createdAt}, ${webhookDeliveries.id}) < (
    select c."created_at", c."id" from ${webhookDeliveries} as c
     where c."id" = ${after} and c."environment_id" = ${environmentId})`;

/**
 * One page of the environment's deliveries.
 * @throws {InvalidCursorError} when `after` is not a delivery of this environment.
 */
export async function listWebhookDeliveryPage(
  db: Db,
  environmentId: string,
  filters: WebhookDeliveryFilters,
  page: WebhookDeliveryPageRequest = {},
): Promise<Page<WebhookDeliveryRecord>> {
  const size = pageSize(page.size);
  const rows = await db
    .select({ delivery: webhookDeliveries, eventName: events.name })
    .from(webhookDeliveries)
    .innerJoin(
      events,
      and(
        eq(events.environmentId, webhookDeliveries.environmentId),
        eq(events.id, webhookDeliveries.eventId),
      ),
    )
    .where(
      and(
        eq(webhookDeliveries.environmentId, environmentId),
        anyOf(webhookDeliveries.webhookId, filters.webhookIds),
        anyOf(webhookDeliveries.eventId, filters.eventIds),
        anyOf(webhookDeliveries.status, filters.statuses),
        filters.createdAtStart === undefined
          ? undefined
          : gte(webhookDeliveries.createdAt, filters.createdAtStart),
        filters.createdAtEnd === undefined
          ? undefined
          : lt(webhookDeliveries.createdAt, filters.createdAtEnd),
        page.after === undefined ? undefined : afterCursor(environmentId, page.after),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(size + 1);
  if (rows.length === 0 && page.after !== undefined) {
    const cursor = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.id, page.after),
          eq(webhookDeliveries.environmentId, environmentId),
        ),
      )
      .limit(1);
    if (cursor.length === 0) {
      throw new InvalidCursorError();
    }
  }
  const items = rows.slice(0, size).map(({ delivery, eventName }) => ({ ...delivery, eventName }));
  return { items, next: rows.length > size ? (items.at(-1)?.id ?? null) : null };
}

/**
 * The C14 `webhook-delivery` resource. The stored attempts keep their Phase 1 snake_case
 * entries; the resource shows them in kebab-case.
 * @throws {Error} for a delivery whose event name is outside the event contract.
 */
export function webhookDeliveryResource(row: WebhookDeliveryRecord): WebhookDeliveryResource {
  if (!isEventName(row.eventName)) {
    throw new Error(`Webhook delivery ${row.id} has an event name outside the event contract`);
  }
  return buildWebhookDeliveryResource({
    id: row.id,
    status: row.status,
    webhookId: row.webhookId,
    eventId: row.eventId,
    eventName: row.eventName,
    attempts: row.attempts.map((attempt) => ({
      attemptedAt: new Date(attempt.attempted_at),
      responseStatus: attempt.response_status,
      durationMs: attempt.duration_ms,
      error: attempt.error,
    })),
    nextAttemptAt: row.nextAttemptAt,
    createdAt: row.createdAt,
  });
}
