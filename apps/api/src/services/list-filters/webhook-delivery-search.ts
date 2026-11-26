/**
 * C165.4 (Workflow 9B; S7; contracts B22): `POST /webhook-deliveries/search`, the public
 * `webhook-events/search` grammar over `updated_at`, `status`, `webhook_id` and `event_name`. Owner:
 * `api-exports`; `foundation-9b` (Stage 1b (X)) froze the route
 * (`routes/server/webhook-delivery-search.ts`), whose schema holds the grammar (two levels of
 * operators, 20 clauses).
 *
 * The clause tree becomes one SQL condition on the environment's deliveries (`and`, `or` and `not` as
 * SQL's; `eq` and `in` as `in`; the time comparisons on `updated_at`), ANDed with the environment.
 * The answer is the delivery list document, newest first (`created_at DESC, id DESC`), paged by
 * `page { after, size }`; `links.next` is the id to send as `page.after` for the next page (the route
 * is a `POST`, so there is no link to follow), or `null`. No clause reads a body, a header or a URL.
 */
import type {
  WebhookDeliverySearchBody,
  WebhookDeliverySearchClause,
  WebhookDeliverySearchQuery,
  webhookDeliveryListDocumentSchema,
} from '@openverify/contracts';
import { events, pageSize, webhookDeliveries } from '@openverify/db';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { BadRequestError } from '../../errors.js';
import { webhookDeliveryResource } from '../../webhooks/deliveries.js';
import type { ApiDependencies } from '../context.js';
import type { Acting } from '../inquiries.js';

export type WebhookDeliveryListDocument = z.infer<typeof webhookDeliveryListDocumentSchema>;

export type SearchWebhookDeliveries = (
  deps: ApiDependencies,
  acting: Acting,
  body: WebhookDeliverySearchBody,
) => Promise<WebhookDeliveryListDocument>;

const listOf = <T>(value: T | readonly T[]): T[] =>
  Array.isArray(value) ? [...(value as readonly T[])] : [value as T];

const COMPARISONS = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

/** One clause as a condition on `webhook_deliveries` joined to its event. */
function clauseCondition(clause: WebhookDeliverySearchClause): SQL {
  switch (clause.attribute) {
    case 'updated_at':
      return sql`${webhookDeliveries.updatedAt} ${sql.raw(COMPARISONS[clause.operator])} ${new Date(
        clause.value,
      ).toISOString()}::timestamptz`;
    case 'status':
      return inArray(webhookDeliveries.status, listOf(clause.value));
    case 'webhook_id':
      return inArray(webhookDeliveries.webhookId, listOf(clause.value));
    case 'event_name':
      return inArray(events.name, listOf(clause.value));
  }
}

/** The clause tree as one condition. */
export function searchCondition(node: WebhookDeliverySearchQuery): SQL {
  if ('attribute' in node) {
    return clauseCondition(node);
  }
  if ('not' in node) {
    return sql`not (${searchCondition(node.not)})`;
  }
  const [operator, children] = 'and' in node ? ['and', node.and] : ['or', node.or];
  const parts = (children as WebhookDeliverySearchQuery[]).map(
    (child) => sql`(${searchCondition(child)})`,
  );
  return sql`(${sql.join(parts, sql.raw(` ${operator} `))})`;
}

export const searchWebhookDeliveries: SearchWebhookDeliveries = async ({ db }, acting, body) => {
  const { environmentId } = acting.ctx;
  const size = pageSize(body.page?.size);
  const after = body.page?.after;
  const found = await db
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
        searchCondition(body.query),
        after === undefined
          ? undefined
          : sql`(${webhookDeliveries.createdAt}, ${webhookDeliveries.id}) < (
                select c."created_at", c."id" from ${webhookDeliveries} as c
                 where c."id" = ${after} and c."environment_id" = ${environmentId})`,
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(size + 1);
  if (found.length === 0 && after !== undefined) {
    const cursor = await db
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.id, after), eq(webhookDeliveries.environmentId, environmentId)),
      )
      .limit(1);
    if (cursor.length === 0) {
      throw new BadRequestError('page.after does not name a delivery of this environment.');
    }
  }
  const rows = found;
  const items = rows.slice(0, size).map(({ delivery, eventName }) => ({ ...delivery, eventName }));
  return {
    data: items.map(webhookDeliveryResource),
    links: { next: rows.length > size ? (items.at(-1)?.id ?? null) : null },
  };
};
