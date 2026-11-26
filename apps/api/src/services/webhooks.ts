/**
 * Webhook subscriptions (contracts C2, C5 and C14).
 *
 * - The signing secret is generated here, returned once (creation, clone and rotate-secret),
 *   stored encrypted, and afterwards shown only by its last four characters.
 * - Custom header values are stored encrypted and never returned: responses show each name
 *   with the value `[REDACTED]`.
 * - `archived` is terminal: every later change answers 409 `invalid-transition`. Changes lock
 *   the webhook's row, so a status check and the change that follows cannot interleave.
 * - Every change writes its C15 audit entry in the transaction that makes the change, so a
 *   change is never committed without it. Entries name the changed attributes, never their
 *   values: URLs can carry customer tokens and header values are secrets.
 * - Simulate and replay write their events and deliveries in one transaction and enqueue the
 *   deliveries after the commit (`events.dispatch`).
 *
 * Delivery itself, including the SSRF guard, is the dispatcher's job.
 */
import {
  WEBHOOK_PREVIOUS_SECRET_DEFAULT_TTL_SECONDS,
  apiVersionSchema,
  buildCreatedWebhookResource,
  buildEventResource,
  buildWebhookResource,
  filterValues,
  idSchema,
  newWebhookSecret,
  toTimestamp,
  webhookDeliveryStatusSchema,
  type AuditActor,
  type CreateWebhookBody,
  type CreatedWebhookResource,
  type EventName,
  type ReplayWebhookBody,
  type RotateWebhookSecretBody,
  type UpdateWebhookBody,
  type WebhookDeliveryResource,
  type WebhookResource,
  type WebhookStatus,
} from '@openverify/contracts';
import { matchesWebhookFilters } from '@openverify/core';
import {
  createEvent,
  createWebhook as insertWebhook,
  createWebhookDelivery,
  getWebhook as findWebhook,
  getWebhookDeliveryWithEvent,
  getWebhookDispatchConfig,
  listReplayableEvents,
  listWebhooks as findWebhooks,
  lockWebhook,
  rotateWebhookSecret as replaceSecret,
  updateWebhook as changeWebhook,
  type Db,
  type ReplaySelection,
  type Webhook,
  type WebhookChanges,
  type WebhookFailureAlertSetting,
  type WebhookFilters,
  webhookFailureAlertOf,
} from '@openverify/db';
import { InvalidTransitionError, NotFoundError } from '../errors.js';
import type { StagedEvent } from '../events/index.js';
import { eventFilterSubjects } from '../events/subject.js';
import type { ServiceContext } from '../ports.js';
import { listWebhookDeliveryPage, webhookDeliveryResource } from '../webhooks/deliveries.js';
import type { WebhookDeliveryJob } from '../webhooks/queue.js';
import { createFixtureSampleSource, type WebhookSampleSource } from '../webhooks/samples.js';
import { auditEntryOf, type ApiDependencies } from './context.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from './pagination.js';

export const WEBHOOKS_PATH = '/api/v1/webhooks';
export const WEBHOOK_DELIVERIES_PATH = '/api/v1/webhook-deliveries';

/** Who changes a webhook, and where: the tenant, the request metadata and the audit actor. */
export interface WebhookCall {
  ctx: ServiceContext;
  actor: AuditActor;
}

export type CreateWebhookAttributes = CreateWebhookBody['data']['attributes'];
export type UpdateWebhookAttributes = UpdateWebhookBody['data']['attributes'];

// Resources -------------------------------------------------------------------------------

/**
 * C169.5 (Workflow 9B, `api-keys-webhooks`' borrowed edit): when the previous secret stops signing,
 * `null` once it no longer does (or none was kept).
 */
function previousSecretEnd(row: Webhook, now: Date): Date | null {
  const end = row.previousSecretExpiresAt;
  return end !== null && end.getTime() > now.getTime() ? end : null;
}

function webhookRecord(row: Webhook, now: Date) {
  const alert = webhookFailureAlertOf(row);
  return {
    id: row.id,
    url: row.url,
    enabledEvents: row.enabledEvents,
    status: row.status,
    secretLast4: row.secretLast4,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    apiVersion: apiVersionSchema.parse(row.apiVersion),
    customHeaderNames: row.customHeaderNames,
    filters: row.filters,
    attributeBlocklist: row.attributeBlocklist,
    // C169.5, C169.6 (Workflow 9B): `null` for none.
    name: row.name,
    description: row.description,
    failureAlert:
      alert === null
        ? null
        : {
            enabled: alert.enabled,
            threshold: alert.threshold,
            'window-minutes': alert.windowMinutes,
          },
    previousSecretExpiresAt: previousSecretEnd(row, now),
  };
}

/** The webhook resource of every response except those that return a new secret, read at `now`. */
export function webhookResource(row: Webhook, now: Date): WebhookResource {
  return buildWebhookResource(webhookRecord(row, now));
}

/** The resource that carries a new secret: creation, clone and rotate-secret. */
function createdWebhookResource(row: Webhook, secret: string, now: Date): CreatedWebhookResource {
  return buildCreatedWebhookResource(webhookRecord(row, now), secret);
}

// Helpers ---------------------------------------------------------------------------------

const notFound = (id: string) => new NotFoundError(`Webhook ${id} was not found.`);

/** Filters without absent members, as the repository stores them. */
function storedFilters(filters: NonNullable<CreateWebhookAttributes['filters']>): WebhookFilters {
  const templates = filters['inquiry-template-ids'];
  const accountTypes = filters['account-type-ids'];
  // C143.4 (Workflow 8A).
  const workflows = filters['workflow-ids'];
  const lists = filters['list-ids'];
  // C143.4 (Workflow 8B).
  const caseTemplates = filters['case-template-ids'];
  return {
    ...(templates === undefined ? {} : { 'inquiry-template-ids': templates }),
    ...(accountTypes === undefined ? {} : { 'account-type-ids': accountTypes }),
    ...(workflows === undefined ? {} : { 'workflow-ids': workflows }),
    ...(lists === undefined ? {} : { 'list-ids': lists }),
    ...(caseTemplates === undefined ? {} : { 'case-template-ids': caseTemplates }),
  };
}

/** The C14 configuration members of a create or update body, as repository input. */
function configurationOf(attributes: CreateWebhookAttributes | UpdateWebhookAttributes) {
  return {
    ...(attributes['api-version'] === undefined ? {} : { apiVersion: attributes['api-version'] }),
    ...(attributes['custom-headers'] === undefined
      ? {}
      : { customHeaders: attributes['custom-headers'] }),
    ...(attributes.filters === undefined ? {} : { filters: storedFilters(attributes.filters) }),
    ...(attributes['attribute-blocklist'] === undefined
      ? {}
      : { attributeBlocklist: attributes['attribute-blocklist'] }),
    // C169.5, C169.6 (Workflow 9B): each `null` clears it.
    ...(attributes.name === undefined ? {} : { name: attributes.name }),
    ...(attributes.description === undefined ? {} : { description: attributes.description }),
    ...(attributes['failure-alert'] === undefined
      ? {}
      : { failureAlert: failureAlertSettingOf(attributes['failure-alert']) }),
  };
}

/** C169.6: the contract's alert as the repository stores it. */
function failureAlertSettingOf(
  alert: NonNullable<CreateWebhookAttributes['failure-alert']> | null,
): WebhookFailureAlertSetting | null {
  return alert === null
    ? null
    : {
        enabled: alert.enabled,
        threshold: alert.threshold,
        windowMinutes: alert['window-minutes'],
      };
}

function changesOf(attributes: UpdateWebhookAttributes): WebhookChanges {
  return {
    ...(attributes.url === undefined ? {} : { url: attributes.url }),
    ...(attributes['enabled-events'] === undefined
      ? {}
      : { enabledEvents: attributes['enabled-events'] }),
    ...(attributes.status === undefined ? {} : { status: attributes.status }),
    ...configurationOf(attributes),
  };
}

function record(
  deps: ApiDependencies,
  tx: Db,
  call: WebhookCall,
  action: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return deps.audit.record(
    tx,
    auditEntryOf(call.ctx, call.actor, {
      action,
      resourceType: 'webhook',
      resourceId,
      ...(metadata === undefined ? {} : { metadata }),
    }),
  );
}

/**
 * Locks the webhook for a change.
 * @throws {NotFoundError} when it is not in the environment.
 * @throws {InvalidTransitionError} when it is archived (C14: terminal).
 */
async function lockChangeable(tx: Db, environmentId: string, id: string): Promise<Webhook> {
  const webhook = await lockWebhook(tx, environmentId, id);
  if (webhook === null) {
    throw notFound(id);
  }
  if (webhook.status === 'archived') {
    throw new InvalidTransitionError(`Webhook ${id} is archived; an archived webhook cannot change.`);
  }
  return webhook;
}

/**
 * Locks a webhook that must be able to receive a delivery now (simulate, replay).
 * @throws {NotFoundError | InvalidTransitionError} as `lockChangeable`, and for a disabled one.
 */
async function lockDeliverable(tx: Db, environmentId: string, id: string): Promise<Webhook> {
  const webhook = await lockChangeable(tx, environmentId, id);
  if (webhook.status !== 'enabled') {
    throw new InvalidTransitionError(
      `Webhook ${id} is ${webhook.status}; enable it before sending it events.`,
    );
  }
  return webhook;
}

const firstAttempt = (environmentId: string, deliveryId: string): WebhookDeliveryJob => ({
  environmentId,
  deliveryId,
  attempt: 1,
});

// Webhooks --------------------------------------------------------------------------------

export async function createWebhook(
  deps: ApiDependencies,
  call: WebhookCall,
  attributes: CreateWebhookAttributes,
): Promise<CreatedWebhookResource> {
  const secret = newWebhookSecret();
  const webhook = await deps.db.transaction(async (tx) => {
    const created = await insertWebhook(tx, call.ctx.environmentId, {
      id: deps.ids.newId('wbh'),
      url: attributes.url,
      enabledEvents: attributes['enabled-events'],
      secret,
      ...configurationOf(attributes),
    });
    await record(deps, tx, call, 'webhook.created', created.id);
    return created;
  });
  return createdWebhookResource(webhook, secret, deps.clock.now());
}

/** @throws {NotFoundError} when the webhook is not in this environment. */
export async function getWebhook(
  { db, clock }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<WebhookResource> {
  const webhook = await findWebhook(db, environmentId, id);
  if (webhook === null) {
    throw notFound(id);
  }
  return webhookResource(webhook, clock.now());
}

export async function listWebhooks(
  { db, clock }: ApiDependencies,
  environmentId: string,
  query: PageQuery,
): Promise<{ data: WebhookResource[]; links: { next: string | null } }> {
  const page = await withCursor(() => findWebhooks(db, environmentId, pageRequest(query)));
  const now = clock.now();
  return {
    data: page.items.map((row) => webhookResource(row, now)),
    links: { next: nextLink(WEBHOOKS_PATH, {}, query, page.next) },
  };
}

/**
 * `PATCH /webhooks/:id`: `custom-headers`, `filters` and `attribute-blocklist` replace the
 * stored values.
 * @throws {NotFoundError | InvalidTransitionError} see `lockChangeable`.
 */
export async function updateWebhook(
  deps: ApiDependencies,
  call: WebhookCall,
  id: string,
  attributes: UpdateWebhookAttributes,
): Promise<WebhookResource> {
  const { environmentId } = call.ctx;
  const webhook = await deps.db.transaction(async (tx) => {
    await lockChangeable(tx, environmentId, id);
    const changed = await changeWebhook(tx, environmentId, id, changesOf(attributes));
    if (changed === null) {
      throw notFound(id);
    }
    const names = Object.entries(attributes)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name);
    await record(deps, tx, call, 'webhook.updated', id, { attributes: names });
    return changed;
  });
  return webhookResource(webhook, deps.clock.now());
}

/** The status each action sets, and the audit action it records. */
export const WEBHOOK_STATUS_ACTIONS = {
  enable: { status: 'enabled', audit: 'webhook.enabled' },
  disable: { status: 'disabled', audit: 'webhook.disabled' },
  archive: { status: 'archived', audit: 'webhook.archived' },
} as const satisfies Record<string, { status: WebhookStatus; audit: string }>;

export type WebhookStatusAction = keyof typeof WEBHOOK_STATUS_ACTIONS;

/**
 * `enable`, `disable` and `archive`. Repeating the current status changes nothing but is
 * still recorded.
 * @throws {NotFoundError | InvalidTransitionError} see `lockChangeable`.
 */
export async function changeWebhookStatus(
  deps: ApiDependencies,
  call: WebhookCall,
  id: string,
  action: WebhookStatusAction,
): Promise<WebhookResource> {
  const { status, audit } = WEBHOOK_STATUS_ACTIONS[action];
  const { environmentId } = call.ctx;
  const webhook = await deps.db.transaction(async (tx) => {
    const current = await lockChangeable(tx, environmentId, id);
    const changed = await changeWebhook(tx, environmentId, id, { status });
    if (changed === null) {
      throw notFound(id);
    }
    await record(deps, tx, call, audit, id, { from: current.status, to: status });
    return changed;
  });
  return webhookResource(webhook, deps.clock.now());
}

/**
 * `clone`: a new webhook with the same URL, events, API version, custom headers, filters and
 * blocklist, a new secret (returned once) and status `disabled`. An archived webhook can be
 * cloned: the source does not change.
 * @throws {NotFoundError} when the source is not in this environment.
 */
export async function cloneWebhook(
  deps: ApiDependencies,
  call: WebhookCall,
  id: string,
): Promise<CreatedWebhookResource> {
  const { environmentId } = call.ctx;
  const secret = newWebhookSecret();
  const clone = await deps.db.transaction(async (tx) => {
    const source = await getWebhookDispatchConfig(tx, environmentId, id, deps.clock.now());
    if (source === null) {
      throw notFound(id);
    }
    const { webhook } = source;
    const created = await insertWebhook(tx, environmentId, {
      id: deps.ids.newId('wbh'),
      url: webhook.url,
      enabledEvents: webhook.enabledEvents,
      secret,
      status: 'disabled',
      apiVersion: webhook.apiVersion,
      customHeaders: source.customHeaders,
      filters: webhook.filters,
      attributeBlocklist: webhook.attributeBlocklist,
      // C169.5, C169.6 (Workflow 9B).
      name: webhook.name,
      description: webhook.description,
      failureAlert: webhookFailureAlertOf(webhook),
    });
    await record(deps, tx, call, 'webhook.cloned', created.id, { 'source-webhook-id': id });
    return created;
  });
  return createdWebhookResource(clone, secret, deps.clock.now());
}

export interface RotatedWebhookDocument {
  data: CreatedWebhookResource;
  meta: { 'previous-secret-expires-at': string };
}

/**
 * `rotate-secret`: a new secret, returned once, signs from now on; the previous one also signs
 * until `previous-secret-expires-in-seconds` (default 24 h, 0 retires it at once). The webhook
 * keeps one previous secret: rotating again during an overlap retires the oldest at once.
 * @throws {NotFoundError | InvalidTransitionError} see `lockChangeable`.
 */
export async function rotateWebhookSecret(
  deps: ApiDependencies,
  call: WebhookCall,
  id: string,
  body: RotateWebhookSecretBody,
): Promise<RotatedWebhookDocument> {
  const { environmentId } = call.ctx;
  const seconds =
    body?.meta?.['previous-secret-expires-in-seconds'] ??
    WEBHOOK_PREVIOUS_SECRET_DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(deps.clock.now().getTime() + seconds * 1000);
  const secret = newWebhookSecret();
  const rotated = await deps.db.transaction(async (tx) => {
    await lockChangeable(tx, environmentId, id);
    const changed = await replaceSecret(tx, environmentId, id, {
      secret,
      previousSecretExpiresAt: seconds === 0 ? null : expiresAt,
    });
    if (changed === null) {
      throw notFound(id);
    }
    await record(deps, tx, call, 'webhook.secret-rotated', id, {
      'previous-secret-expires-at': toTimestamp(expiresAt),
    });
    return changed;
  });
  return {
    data: createdWebhookResource(rotated, secret, deps.clock.now()),
    meta: { 'previous-secret-expires-at': toTimestamp(expiresAt) },
  };
}

const defaultSamples = createFixtureSampleSource();

export interface SimulatedWebhookDocument {
  data: WebhookResource;
  meta: { 'event-id': string };
}

/**
 * `simulate`: stores a sample event (`simulated: true`) built from the golden fixtures and
 * delivers it to this webhook only, whether or not it subscribes to the event. Filters do not
 * apply; the blocklist does, at delivery. Simulated events are never replayed, and the Events
 * API lists them only with `filter[simulated]=true`.
 * @throws {NotFoundError | InvalidTransitionError} see `lockDeliverable`.
 */
export async function simulateWebhook(
  deps: ApiDependencies,
  call: WebhookCall,
  id: string,
  eventName: EventName,
  samples: WebhookSampleSource = defaultSamples,
): Promise<SimulatedWebhookDocument> {
  const { environmentId } = call.ctx;
  const payload = await samples.payloadFor(eventName);
  const eventId = deps.ids.newId('evt');
  // Fails loudly (500) rather than store an event the dispatcher could not send.
  buildEventResource({
    id: eventId,
    name: eventName,
    payload,
    createdAt: deps.clock.now(),
    simulated: true,
  });
  const { webhook, staged } = await deps.db.transaction(async (tx) => {
    const target = await lockDeliverable(tx, environmentId, id);
    await createEvent(tx, environmentId, { id: eventId, name: eventName, payload, simulated: true });
    const delivery = await createWebhookDelivery(tx, environmentId, {
      id: deps.ids.newId('whd'),
      webhookId: id,
      eventId,
    });
    await record(deps, tx, call, 'webhook.simulated', id, {
      'event-name': eventName,
      'event-id': eventId,
    });
    const jobs = delivery === null ? [] : [firstAttempt(environmentId, delivery.id)];
    return { webhook: target, staged: { eventId, deliveries: jobs } satisfies StagedEvent };
  });
  await deps.events.dispatch([staged]);
  return { data: webhookResource(webhook, deps.clock.now()), meta: { 'event-id': eventId } };
}

export interface ReplayedWebhookDocument {
  data: WebhookResource;
  meta: { 'replayed-count': number };
}

function replaySelection(meta: ReplayWebhookBody['meta']): ReplaySelection {
  if ('event-ids' in meta) {
    return { eventIds: meta['event-ids'] };
  }
  return {
    createdAtStart: new Date(meta['created-at-start']),
    createdAtEnd: new Date(meta['created-at-end']),
    onlyFailed: meta.status === 'failed',
  };
}

/**
 * `replay`: a new delivery of each selected event this webhook subscribes to (by name and by
 * its current filters), oldest first. Events are named by id, or by creation range (inclusive
 * start, exclusive end), optionally only those whose delivery to this webhook failed. At most
 * the 1,000 oldest matching events; simulated events and other environments' events are never
 * selected, and unknown ids are skipped.
 * @throws {NotFoundError | InvalidTransitionError} see `lockDeliverable`.
 */
export async function replayWebhook(
  deps: ApiDependencies,
  call: WebhookCall,
  id: string,
  meta: ReplayWebhookBody['meta'],
): Promise<ReplayedWebhookDocument> {
  const { environmentId } = call.ctx;
  const selection = replaySelection(meta);
  const { webhook, staged } = await deps.db.transaction(async (tx) => {
    const target = await lockDeliverable(tx, environmentId, id);
    const events = await listReplayableEvents(tx, environmentId, id, selection);
    const subjects = await eventFilterSubjects(
      tx,
      environmentId,
      events.map((event) => event.payload),
    );
    const replayed: StagedEvent[] = [];
    for (const [index, event] of events.entries()) {
      const subject = subjects[index];
      const matches = matchesWebhookFilters(
        { payload: event.payload, ...(subject === undefined ? {} : { subject }) },
        target.filters,
      );
      if (!matches) {
        continue;
      }
      const delivery = await createWebhookDelivery(tx, environmentId, {
        id: deps.ids.newId('whd'),
        webhookId: id,
        eventId: event.id,
        isReplay: true,
      });
      if (delivery !== null) {
        replayed.push({ eventId: event.id, deliveries: [firstAttempt(environmentId, delivery.id)] });
      }
    }
    const byIds = 'eventIds' in selection;
    await record(deps, tx, call, 'webhook.replayed', id, {
      'replayed-count': replayed.length,
      selection: byIds ? 'event-ids' : 'created-at',
      ...(byIds || selection.onlyFailed !== true ? {} : { status: 'failed' }),
    });
    return { webhook: target, staged: replayed };
  });
  await deps.events.dispatch(staged);
  return {
    data: webhookResource(webhook, deps.clock.now()),
    meta: { 'replayed-count': staged.length },
  };
}

// Deliveries ------------------------------------------------------------------------------

export interface ListWebhookDeliveriesQuery extends PageQuery {
  'filter[webhook-id]'?: string | undefined;
  'filter[event-id]'?: string | undefined;
  'filter[status]'?: string | undefined;
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
}

const optionalDate = (value: string | undefined) =>
  value === undefined ? undefined : new Date(value);

/** C14 `GET /webhook-deliveries`, newest first. */
export async function listWebhookDeliveries(
  { db }: ApiDependencies,
  environmentId: string,
  query: ListWebhookDeliveriesQuery,
): Promise<{ data: WebhookDeliveryResource[]; links: { next: string | null } }> {
  const filters = {
    webhookIds: filterValues(query['filter[webhook-id]'], idSchema('wbh')),
    eventIds: filterValues(query['filter[event-id]'], idSchema('evt')),
    statuses: filterValues(query['filter[status]'], webhookDeliveryStatusSchema),
    createdAtStart: optionalDate(query['filter[created-at-start]']),
    createdAtEnd: optionalDate(query['filter[created-at-end]']),
  };
  const page = await withCursor(() =>
    listWebhookDeliveryPage(db, environmentId, filters, pageRequest(query)),
  );
  const links = {
    'filter[webhook-id]': query['filter[webhook-id]'],
    'filter[event-id]': query['filter[event-id]'],
    'filter[status]': query['filter[status]'],
    'filter[created-at-start]': query['filter[created-at-start]'],
    'filter[created-at-end]': query['filter[created-at-end]'],
  };
  return {
    data: page.items.map(webhookDeliveryResource),
    links: { next: nextLink(WEBHOOK_DELIVERIES_PATH, links, query, page.next) },
  };
}

/** @throws {NotFoundError} when the delivery is not in this environment. */
export async function getWebhookDelivery(
  { db }: ApiDependencies,
  environmentId: string,
  id: string,
): Promise<WebhookDeliveryResource> {
  const delivery = await getWebhookDeliveryWithEvent(db, environmentId, id);
  if (delivery === null) {
    throw new NotFoundError(`Webhook delivery ${id} was not found.`);
  }
  return webhookDeliveryResource(delivery);
}
