/**
 * C165.4 (Phase 9, Workflow 9B Stage 1a, (X); S7): `POST /api/v1/webhook-deliveries/search`
 * (`webhooks:read`), ours, with the public `webhook-events/search` grammar: `and`, `or` and `not`
 * over `updated_at`, `status`, `webhook_id` and `event_name`, at most two levels of operators and 20
 * clauses. It answers the delivery list (`webhookDeliveryListDocumentSchema`), newest first. No
 * clause reads a body, a header or a URL, so a search holds no personal data.
 */
import { z } from 'zod';
import { eventNameSchema } from './event-names.js';
import { idSchema } from './ids.js';
import { filterTimestampSchema } from './list-filters.js';
import { pageSizeSchema } from './json-api.js';
import { webhookDeliveryStatusSchema } from './webhook-deliveries.js';

export const WEBHOOK_DELIVERY_SEARCH_LIMITS = Object.freeze({ depth: 2, clauses: 20 } as const);

const many = <Item extends z.ZodType>(item: Item) => z.union([item, z.array(item).min(1).max(20)]);

/** One clause; `in` takes a list, the others one value. */
export const webhookDeliverySearchClauseSchema = z.discriminatedUnion('attribute', [
  z.strictObject({
    attribute: z.literal('updated_at'),
    operator: z.enum(['gt', 'gte', 'lt', 'lte']),
    value: filterTimestampSchema,
  }),
  z.strictObject({
    attribute: z.literal('status'),
    operator: z.enum(['eq', 'in']),
    value: many(webhookDeliveryStatusSchema),
  }),
  z.strictObject({
    attribute: z.literal('webhook_id'),
    operator: z.enum(['eq', 'in']),
    value: many(idSchema('wbh')),
  }),
  z.strictObject({
    attribute: z.literal('event_name'),
    operator: z.enum(['eq', 'in']),
    value: many(eventNameSchema),
  }),
]);
export type WebhookDeliverySearchClause = z.infer<typeof webhookDeliverySearchClauseSchema>;

const operators = <Inner extends z.ZodType>(inner: Inner) =>
  z.union([
    webhookDeliverySearchClauseSchema,
    z.strictObject({ and: z.array(inner).min(1).max(20) }),
    z.strictObject({ or: z.array(inner).min(1).max(20) }),
    z.strictObject({ not: inner }),
  ]);

/** Two levels of operators at most (`WEBHOOK_DELIVERY_SEARCH_LIMITS.depth`). */
const levelOne = operators(webhookDeliverySearchClauseSchema);
export const webhookDeliverySearchQuerySchema = operators(levelOne);
export type WebhookDeliverySearchQuery = z.infer<typeof webhookDeliverySearchQuerySchema>;

function clauseCount(node: unknown): number {
  if (typeof node !== 'object' || node === null) return 0;
  const record = node as Record<string, unknown>;
  if ('attribute' in record) return 1;
  const children = record.and ?? record.or ?? (record.not === undefined ? [] : [record.not]);
  return (children as unknown[]).reduce<number>((sum, child) => sum + clauseCount(child), 0);
}

export const webhookDeliverySearchBodySchema = z.strictObject({
  query: webhookDeliverySearchQuerySchema.refine(
    (query) => clauseCount(query) <= WEBHOOK_DELIVERY_SEARCH_LIMITS.clauses,
    `at most ${String(WEBHOOK_DELIVERY_SEARCH_LIMITS.clauses)} clauses`,
  ),
  page: z
    .strictObject({ after: idSchema('whd').optional(), size: pageSizeSchema.optional() })
    .optional(),
});
export type WebhookDeliverySearchBody = z.infer<typeof webhookDeliverySearchBodySchema>;
