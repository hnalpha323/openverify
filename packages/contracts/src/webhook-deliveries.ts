/**
 * Webhook deliveries (contract C14): one per (webhook, event), with every attempt. Attempts
 * record the response status, the duration and a generic error, never the URL, the request
 * body or the response body.
 */
import { z } from 'zod';
import { eventNameSchema, type EventName } from './event-names.js';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import { WEBHOOK_MAX_ATTEMPTS } from './webhooks.js';

export const WEBHOOK_DELIVERY_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export const webhookDeliveryStatusSchema = z.enum(WEBHOOK_DELIVERY_STATUSES);
export type WebhookDeliveryStatus = z.infer<typeof webhookDeliveryStatusSchema>;

export const webhookDeliveryAttemptSchema = z.strictObject({
  'attempted-at': timestampSchema,
  /** Null when no response arrived. */
  'response-status': z.int().min(100).max(599).nullable(),
  'duration-ms': z.int().min(0).nullable(),
  /** A generic description such as a timeout; never the URL or a body. */
  error: z.string().max(1000).nullable(),
});

export const webhookDeliveryAttributesSchema = z.strictObject({
  status: webhookDeliveryStatusSchema,
  'webhook-id': idSchema('wbh'),
  'event-id': idSchema('evt'),
  'event-name': eventNameSchema,
  attempts: z.array(webhookDeliveryAttemptSchema).max(WEBHOOK_MAX_ATTEMPTS),
  /** Null once the delivery succeeded or failed for good. */
  'next-attempt-at': timestampSchema.nullable(),
  'created-at': timestampSchema,
});

export const webhookDeliveryResourceSchema = resourceSchema(
  'webhook-delivery',
  'whd',
  webhookDeliveryAttributesSchema,
);
export type WebhookDeliveryResource = z.infer<typeof webhookDeliveryResourceSchema>;

export const webhookDeliveryDocumentSchema = singleDocumentSchema(webhookDeliveryResourceSchema);
export const webhookDeliveryListDocumentSchema = listDocumentSchema(webhookDeliveryResourceSchema);

/** `GET /api/v1/webhook-deliveries` query (scope `webhooks:read`). */
export const listWebhookDeliveriesQuerySchema = listQuerySchema('whd', {
  'filter[webhook-id]': filterListSchema(idSchema('wbh')).optional(),
  'filter[event-id]': filterListSchema(idSchema('evt')).optional(),
  'filter[status]': filterListSchema(webhookDeliveryStatusSchema).optional(),
});

export interface WebhookDeliveryAttemptRecord {
  attemptedAt: Date;
  responseStatus: number | null;
  durationMs: number | null;
  error: string | null;
}

export interface WebhookDeliveryRecord {
  id: string;
  status: WebhookDeliveryStatus;
  webhookId: string;
  eventId: string;
  eventName: EventName;
  attempts: readonly WebhookDeliveryAttemptRecord[];
  nextAttemptAt: Date | null;
  createdAt: Date;
}

/**
 * Builds the webhook-delivery resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWebhookDeliveryResource(
  record: WebhookDeliveryRecord,
): WebhookDeliveryResource {
  return webhookDeliveryResourceSchema.parse({
    type: 'webhook-delivery',
    id: record.id,
    attributes: {
      status: record.status,
      'webhook-id': record.webhookId,
      'event-id': record.eventId,
      'event-name': record.eventName,
      attempts: record.attempts.map((attempt) => ({
        'attempted-at': toTimestamp(attempt.attemptedAt),
        'response-status': attempt.responseStatus,
        'duration-ms': attempt.durationMs,
        error: attempt.error,
      })),
      'next-attempt-at': toNullableTimestamp(record.nextAttemptAt),
      'created-at': toTimestamp(record.createdAt),
    },
  });
}
