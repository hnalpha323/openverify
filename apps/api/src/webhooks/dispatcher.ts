/**
 * Webhook dispatcher (contracts C5 and C14): the `webhook-delivery` job processor and the sweep.
 *
 * Each job makes one attempt. It builds the event document, removes the webhook's blocked
 * attributes from the payload, signs the result with every active secret of the webhook (the
 * new one first, then the previous one while a rotation overlaps), POSTs it through the
 * SSRF-guarded sender with the webhook's custom headers and API version, and records the
 * attempt on the delivery row. A 2xx answer is a success. Anything else is retried on the C14
 * schedule (+0, 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h after the first attempt, each
 * with ±10% jitter) until the eighth attempt, except a destination the guard refuses, which
 * fails at once. The database row, not the queue, is the source of truth: a job for an
 * attempt that was already recorded does nothing.
 *
 * Logs carry ids, the attempt number, the outcome and the HTTP status; never the URL (it
 * can hold customer tokens), a secret, a custom header value or the body.
 */
import {
  API_VERSION_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_RETRY_JITTER_RATIO,
  WEBHOOK_RETRY_OFFSETS_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_USER_AGENT,
  buildEventResource,
  customHeaderNameSchema,
  customHeaderValueSchema,
  isEventName,
  storedEventPayloadSchema,
  type EventResource,
} from '@openverify/contracts';
import { applyAttributeBlocklist } from '@openverify/core';
import {
  getEvent,
  getWebhookDelivery,
  getWebhookDispatchConfig,
  listDueWebhookDeliveries,
  recordWebhookDeliveryAttempt,
  type Db,
  type EventRecord,
  type WebhookDelivery,
  type WebhookDeliveryAttempt,
} from '@openverify/db';
import { signWebhookPayload } from '@openverify/node';
import type { WorkerLogger } from '../jobs/logger.js';
import type { Clock } from '../ports.js';
import { deliveryAttemptHeaders } from './attempt-headers/headers.js';
import { WebhookRequestError, type WebhookSender } from './http-sender.js';
import type { WebhookDeliveryJob, WebhookDeliveryScheduler } from './queue.js';

export interface WebhookRetryPolicy {
  /**
   * When each attempt is due, in seconds after the first attempt (C14). Its length is the
   * most attempts a delivery gets.
   */
  offsetsSeconds: readonly number[];
  /** Each offset moves by up to this fraction either way, so retries spread out. */
  jitterRatio: number;
  /** `[0, 1)` source of jitter. */
  random: () => number;
}

/** C14: 8 attempts at +0, 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h, each ±10%. */
export const DEFAULT_WEBHOOK_RETRY_POLICY: WebhookRetryPolicy = Object.freeze({
  offsetsSeconds: WEBHOOK_RETRY_OFFSETS_SECONDS,
  jitterRatio: WEBHOOK_RETRY_JITTER_RATIO,
  random: Math.random,
});

/**
 * When attempt `attempt` (from 1) is due: the first attempt's time plus the attempt's offset,
 * moved by the jitter. The schedule is measured from the first attempt, so a late attempt does
 * not push the later ones back.
 * @returns `null` when the policy has no such attempt.
 */
export function webhookAttemptDueAt(
  firstAttemptAt: Date,
  attempt: number,
  policy: WebhookRetryPolicy,
): Date | null {
  const offsetSeconds = policy.offsetsSeconds[attempt - 1];
  if (offsetSeconds === undefined || attempt < 1) {
    return null;
  }
  const jitter = 1 + policy.jitterRatio * (2 * policy.random() - 1);
  return new Date(firstAttemptAt.getTime() + Math.round(offsetSeconds * 1000 * jitter));
}

export interface DeliverWebhookDeps {
  db: Db;
  sender: WebhookSender;
  scheduler: WebhookDeliveryScheduler;
  clock: Clock;
  logger: WorkerLogger;
  retry?: WebhookRetryPolicy;
}

export type DeliveryResult =
  | { outcome: 'succeeded'; attempt: number; status: number }
  | { outcome: 'retry'; attempt: number; status: number | null; delayMs: number }
  | { outcome: 'failed'; attempt: number; status: number | null }
  | { outcome: 'skipped'; reason: 'not_found' | 'not_pending' | 'stale_attempt' | 'raced' };

interface Prepared {
  url: string;
  /** The current secret first, then the previous one while it is valid. */
  secrets: string[];
  headers: Record<string, string>;
  /** The webhook's C12 API version, sent as `OpenVerify-Version`. */
  apiVersion: string;
  eventId: string;
  body: string;
  /** C169.5 (Workflow 9B Stage 1b (W)): `deliveryAttemptHeaders`' headers for this attempt. */
  attemptHeaders?: Readonly<Record<string, string>>;
}

/**
 * The custom headers that may be sent: valid names outside the reserved ones (the API refuses
 * the others, but a row written another way must not be able to override the dispatcher's
 * headers or inject new ones) with one-line printable values.
 */
function sendableCustomHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) =>
        customHeaderNameSchema.safeParse(name).success &&
        customHeaderValueSchema.safeParse(value).success,
    ),
  );
}

/** The event document as stored, or `null` when the row no longer satisfies the contract. */
function eventDocument(event: EventRecord): EventResource | null {
  const payload = storedEventPayloadSchema.safeParse(event.payload);
  if (!isEventName(event.name) || !payload.success) {
    return null;
  }
  try {
    return buildEventResource({
      id: event.id,
      name: event.name,
      payload: payload.data,
      createdAt: event.createdAt,
      simulated: event.simulated,
    });
  } catch {
    return null;
  }
}

/** A payload as the blocklist walks it: a resource or a list, and the included resources. */
interface BlockablePayload {
  readonly data: unknown;
  readonly included?: readonly unknown[];
}

/**
 * The event without the webhook's blocked attributes (C14), serialized for signing. The
 * result is not validated again: removing attributes the contract requires is the point.
 */
function deliveryBody(resource: EventResource, blocklist: readonly string[]): string {
  const stored = resource.attributes.payload as BlockablePayload;
  const payload = blocklist.length === 0 ? stored : applyAttributeBlocklist(stored, blocklist);
  return JSON.stringify({ data: { ...resource, attributes: { ...resource.attributes, payload } } });
}

/** Loads what the attempt needs, or the reason it cannot be made. */
async function prepare(
  db: Db,
  delivery: WebhookDelivery,
  now: Date,
): Promise<Prepared | { error: string }> {
  const { environmentId } = delivery;
  const config = await getWebhookDispatchConfig(db, environmentId, delivery.webhookId, now);
  if (config?.webhook.status !== 'enabled') {
    const archived = config?.webhook.status === 'archived';
    return { error: archived ? 'The webhook is archived' : 'The webhook is disabled' };
  }
  const event = await getEvent(db, environmentId, delivery.eventId);
  const resource = event === null ? null : eventDocument(event);
  if (resource === null) {
    return { error: 'The event is not available' };
  }
  return {
    url: config.webhook.url,
    secrets: config.secrets,
    headers: sendableCustomHeaders(config.customHeaders),
    apiVersion: config.webhook.apiVersion,
    eventId: resource.id,
    body: deliveryBody(resource, config.webhook.attributeBlocklist),
  };
}

/** What one attempt produced: an HTTP status, or the reason no response came. */
interface AttemptOutcome {
  status: number | null;
  durationMs: number | null;
  error: string | null;
  /** Whether trying again can help: any HTTP answer, or a transient request error. */
  retryable: boolean;
}

/** Signs and sends the event; a guard refusal or network failure becomes an outcome. */
async function attemptDelivery(
  sender: WebhookSender,
  prepared: Prepared,
  now: Date,
): Promise<AttemptOutcome> {
  const timestamp = Math.floor(now.getTime() / 1000);
  try {
    const response = await sender.send({
      url: prepared.url,
      // Custom headers first: the dispatcher's own headers are set after them and win.
      headers: {
        ...prepared.headers,
        // C169.5: after the custom headers and before the dispatcher's own, which win.
        ...prepared.attemptHeaders,
        'content-type': 'application/json',
        'user-agent': WEBHOOK_USER_AGENT,
        [WEBHOOK_EVENT_ID_HEADER]: prepared.eventId,
        [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(prepared.body, prepared.secrets, timestamp),
        [API_VERSION_HEADER]: prepared.apiVersion,
      },
      body: prepared.body,
    });
    return {
      status: response.status,
      durationMs: response.durationMs,
      error: null,
      retryable: true,
    };
  } catch (caught) {
    if (!(caught instanceof WebhookRequestError)) {
      throw caught;
    }
    return { status: null, durationMs: null, error: caught.message, retryable: caught.retryable };
  }
}

/** When the first attempt was made: recorded on the row, or now for the first one. */
function firstAttemptOf(delivery: WebhookDelivery, now: Date): Date {
  if (delivery.firstAttemptedAt !== null) {
    return delivery.firstAttemptedAt;
  }
  // Rows from before schema v2 have attempts but no first attempt time.
  const recorded = delivery.attempts[0]?.attempted_at;
  const parsed = recorded === undefined ? Number.NaN : Date.parse(recorded);
  return Number.isNaN(parsed) ? now : new Date(parsed);
}

/** Makes one delivery attempt and records it. */
export async function deliverWebhook(
  job: WebhookDeliveryJob,
  deps: DeliverWebhookDeps,
): Promise<DeliveryResult> {
  const { db, logger } = deps;
  const policy = deps.retry ?? DEFAULT_WEBHOOK_RETRY_POLICY;
  const { environmentId, deliveryId } = job;
  const delivery = await getWebhookDelivery(db, environmentId, deliveryId);
  if (delivery === null) {
    return { outcome: 'skipped', reason: 'not_found' };
  }
  if (delivery.status !== 'pending') {
    return { outcome: 'skipped', reason: 'not_pending' };
  }
  const attempt = delivery.attemptCount + 1;
  if (job.attempt !== attempt) {
    return { outcome: 'skipped', reason: 'stale_attempt' };
  }

  const now = deps.clock.now();
  const prepared = await prepare(db, delivery, now);
  const lastAttempt = Math.min(policy.offsetsSeconds.length, delivery.maxAttempts);
  const { status, durationMs, error, retryable } =
    'error' in prepared
      ? { status: null, durationMs: null, error: prepared.error, retryable: false }
      : await attemptDelivery(
          deps.sender,
          {
            ...prepared,
            // C169.5 (Workflow 9B Stage 1b (W)): `api-keys-webhooks`' attempt headers.
            attemptHeaders: deliveryAttemptHeaders({
              attempt,
              maxAttempts: lastAttempt,
              firstAttemptedAt: firstAttemptOf(delivery, now),
            }),
          },
          now,
        );

  const nextDue =
    attempt < lastAttempt
      ? webhookAttemptDueAt(firstAttemptOf(delivery, now), attempt + 1, policy)
      : null;
  const delayMs = nextDue === null ? 0 : Math.max(0, nextDue.getTime() - now.getTime());
  // Numbered, so a second worker running this attempt records nothing (2B F021).
  const details = { attempt, attemptedAt: now, responseStatus: status, durationMs, error };
  const record: WebhookDeliveryAttempt =
    status !== null && status >= 200 && status < 300
      ? { ...details, outcome: 'succeeded' }
      : retryable && nextDue !== null
        ? { ...details, outcome: 'retry', nextAttemptAt: new Date(now.getTime() + delayMs) }
        : { ...details, outcome: 'failed' };
  if ((await recordWebhookDeliveryAttempt(db, environmentId, deliveryId, record)) === null) {
    return { outcome: 'skipped', reason: 'raced' };
  }
  const context = {
    deliveryId,
    webhookId: delivery.webhookId,
    eventId: delivery.eventId,
    attempt,
    outcome: record.outcome,
    status,
  };
  logger.info(context, 'webhook delivery attempt recorded');

  if (record.outcome === 'succeeded' && status !== null) {
    return { outcome: 'succeeded', attempt, status };
  }
  if (record.outcome !== 'retry') {
    return { outcome: 'failed', attempt, status };
  }
  try {
    await deps.scheduler.scheduleDelivery(
      { environmentId, deliveryId, attempt: attempt + 1 },
      delayMs,
    );
  } catch (caught) {
    logger.warn(
      { ...context, error: (caught as Error).name },
      'webhook retry not enqueued; the dispatcher sweep will enqueue it',
    );
  }
  return { outcome: 'retry', attempt, status, delayMs };
}

export interface SweepDeps {
  db: Db;
  scheduler: WebhookDeliveryScheduler;
  clock: Clock;
  /** Only deliveries overdue by more than this are re-enqueued. Defaults to 60 s. */
  graceMs?: number;
  /** Defaults to 100 per sweep. */
  limit?: number;
}

/**
 * Enqueues pending deliveries whose attempt is overdue, for example because the enqueue
 * after commit failed, Valkey lost the job, or the job failed for good on an infrastructure
 * error (its BullMQ retries ran out while the database was down). A job left under the
 * attempt's id is replaced, since BullMQ would otherwise ignore the add (Workflow 2B F011); the
 * row is the source of truth, and a job for an attempt already recorded does nothing.
 * @returns how many deliveries were enqueued.
 */
export async function sweepDueWebhookDeliveries(deps: SweepDeps): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - (deps.graceMs ?? 60_000));
  const due = await listDueWebhookDeliveries(deps.db, { now: cutoff, limit: deps.limit ?? 100 });
  for (const delivery of due) {
    await deps.scheduler.scheduleDelivery(
      {
        environmentId: delivery.environmentId,
        deliveryId: delivery.id,
        attempt: delivery.attemptCount + 1,
      },
      0,
      { replace: true },
    );
  }
  return due.length;
}
