import { and, arrayContains, asc, eq, inArray, lt, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  events,
  webhookDeliveries,
  webhooks,
  type EventRecord,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookFilters,
  type WebhookRow,
  type WebhookStatus,
} from '../schema.js';
import { openOptionalJson, openValue, sealJson, sealValue, type Sealed } from '../sealed.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted, type OneOrMany } from './rows.js';

/**
 * A webhook as the API shows it: never with its signing secrets or custom header values.
 * C14 shows custom headers by name only (`customHeaderNames`).
 */
export type Webhook = Omit<
  WebhookRow,
  'secret' | 'previousSecretSealed' | 'customHeadersSealed'
> & {
  customHeaderNames: string[];
};

/** C14 custom headers: name to value. Values are secrets, sealed for the webhook. */
export type WebhookCustomHeaders = Record<string, string>;

export interface NewWebhookInput {
  id: string;
  url: string;
  /** Event names, or `['*']`. */
  enabledEvents: readonly string[];
  /** `wbhsec_...`; encrypted at rest, only the last four characters are shown again. */
  secret: string;
  status?: WebhookStatus;
  /** C12/C14; defaults to the database default (the current version). */
  apiVersion?: string;
  customHeaders?: WebhookCustomHeaders | null;
  filters?: WebhookFilters;
  attributeBlocklist?: readonly string[];
  /** C169.5 (Workflow 9B): omit or `null` for none. */
  name?: string | null;
  description?: string | null;
  /** C169.6: omit or `null` for no alert. */
  failureAlert?: WebhookFailureAlertSetting | null;
}

export interface WebhookChanges {
  url?: string;
  enabledEvents?: readonly string[];
  status?: WebhookStatus;
  apiVersion?: string;
  /** Replaces the headers; `null` removes them. */
  customHeaders?: WebhookCustomHeaders | null;
  filters?: WebhookFilters;
  attributeBlocklist?: readonly string[];
  /** C169.5, C169.6 (Workflow 9B): each `null` removes it. */
  name?: string | null;
  description?: string | null;
  failureAlert?: WebhookFailureAlertSetting | null;
}

/**
 * C169.6 (Workflow 9B Stage 1b (W)): a webhook's failure alert as its three columns hold it: alert
 * when at least `threshold` first attempts failed within `windowMinutes`.
 */
export interface WebhookFailureAlertSetting {
  enabled: boolean;
  threshold: number;
  windowMinutes: number;
}

/** The three alert columns of a setting; `null` clears all three. */
function failureAlertColumns(alert: WebhookFailureAlertSetting | null) {
  return {
    failureAlertEnabled: alert?.enabled ?? null,
    failureAlertThreshold: alert?.threshold ?? null,
    failureAlertWindowMinutes: alert?.windowMinutes ?? null,
  };
}

/** C169.6: a webhook's failure alert, or `null` when it has none. */
export function webhookFailureAlertOf(
  webhook: Pick<
    Webhook,
    'failureAlertEnabled' | 'failureAlertThreshold' | 'failureAlertWindowMinutes'
  >,
): WebhookFailureAlertSetting | null {
  const { failureAlertEnabled, failureAlertThreshold, failureAlertWindowMinutes } = webhook;
  return failureAlertEnabled === null ||
    failureAlertThreshold === null ||
    failureAlertWindowMinutes === null
    ? null
    : {
        enabled: failureAlertEnabled,
        threshold: failureAlertThreshold,
        windowMinutes: failureAlertWindowMinutes,
      };
}

export interface SecretRotation {
  /** The new `wbhsec_...` secret. */
  secret: string;
  /** Until when the old secret also signs (C14 dual signing); `null` drops it now. */
  previousSecretExpiresAt: Date | null;
}

/** What the dispatcher needs to send one delivery (C14). */
export interface WebhookDispatchConfig {
  webhook: Webhook;
  /** The current secret first, then the previous one while it is still valid. */
  secrets: string[];
  customHeaders: WebhookCustomHeaders;
}

/** The C14 subject of an event, for webhook `filters`. Absent attributes are not filtered. */
export interface EventSubject {
  inquiryTemplateId?: string | undefined;
  accountTypeId?: string | undefined;
  /** C70.4 (F10): without the attribute, a strict subject fails a present filter. */
  strict?: boolean | undefined;
  /** C107.4: a subject with several links passes a filter that allows any one of them. */
  inquiryTemplateIds?: readonly string[] | undefined;
  accountTypeIds?: readonly string[] | undefined;
  /** C143.4 (Workflow 8A): a workflow, version or run event's workflow. */
  workflowId?: string | undefined;
  /** C143.4 (Workflow 8A): a list event's list. */
  listId?: string | undefined;
  /** C143.4 (Workflow 8B): a case or case-comment event's case template. */
  caseTemplateId?: string | undefined;
  /**
   * C143.4 (Workflow 8B): the templates of every inquiry a case holds. Unlike `inquiryTemplateIds`,
   * a subject passes an inquiry-template filter only when the filter allows every one of them.
   */
  heldInquiryTemplateIds?: readonly string[] | undefined;
}

export interface NewWebhookDeliveryInput {
  id: string;
  webhookId: string;
  eventId: string;
  /** Defaults to now. */
  nextAttemptAt?: Date;
  /** C14 replay: another delivery of an event the webhook already had one for. */
  isReplay?: boolean;
}

/** A delivery with the name of its event (C14 `webhook-delivery` resource). */
export type WebhookDeliveryRecord = WebhookDelivery & { eventName: string };

export interface ListWebhookDeliveriesOptions extends PageRequest {
  webhookId?: OneOrMany<string> | undefined;
  eventId?: OneOrMany<string> | undefined;
  status?: OneOrMany<WebhookDeliveryStatus> | undefined;
}

/** C14 replay selection: explicit events, or a time range (optionally failed only). */
export type ReplaySelection =
  | { eventIds: readonly string[] }
  | { createdAtStart: Date; createdAtEnd: Date; onlyFailed?: boolean };

export interface DueDeliveryOptions {
  /** Defaults to now. */
  now?: Date;
  /** Defaults to 100. */
  limit?: number;
  /**
   * Lock the rows `FOR UPDATE SKIP LOCKED`, inside the caller's transaction, so that
   * concurrent workers never pick the same delivery.
   */
  lock?: boolean;
}

interface AttemptDetails {
  /**
   * The attempt this records, from 1. When given, it is recorded only while the delivery has
   * made `attempt - 1` attempts, so a second worker running the same attempt cannot count it
   * again (Workflow 2B F021).
   */
  attempt?: number;
  attemptedAt: Date;
  responseStatus?: number | null;
  durationMs?: number | null;
  /** Truncated to 1000 characters. Never a response body. */
  error?: string | null;
}

/** The result of one delivery attempt (2xx is success; the C14 schedule allows 8). */
export type WebhookDeliveryAttempt = AttemptDetails &
  ({ outcome: 'succeeded' | 'failed' } | { outcome: 'retry'; nextAttemptAt: Date });

const MAX_ERROR_LENGTH = 1000;
/** C14: at most 1,000 events per replay. */
export const MAX_REPLAY_EVENTS = 1000;

const webhookColumns = {
  id: webhooks.id,
  environmentId: webhooks.environmentId,
  url: webhooks.url,
  enabledEvents: webhooks.enabledEvents,
  status: webhooks.status,
  secretLast4: webhooks.secretLast4,
  previousSecretExpiresAt: webhooks.previousSecretExpiresAt,
  apiVersion: webhooks.apiVersion,
  customHeadersSealed: webhooks.customHeadersSealed,
  filters: webhooks.filters,
  attributeBlocklist: webhooks.attributeBlocklist,
  // C169.5, C169.6 (Workflow 9B Stage 1b (W)).
  name: webhooks.name,
  description: webhooks.description,
  failureAlertEnabled: webhooks.failureAlertEnabled,
  failureAlertThreshold: webhooks.failureAlertThreshold,
  failureAlertWindowMinutes: webhooks.failureAlertWindowMinutes,
  failureAlertNotifiedAt: webhooks.failureAlertNotifiedAt,
  createdAt: webhooks.createdAt,
  updatedAt: webhooks.updatedAt,
};

type WebhookSelection = Omit<WebhookRow, 'secret' | 'previousSecretSealed'>;

const webhookCursor = environmentCursor(webhooks);
const deliveryCursor = environmentCursor(webhookDeliveries);

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(webhooks.id, id), eq(webhooks.environmentId, environmentId));

const openHeaders = (id: string, sealed: Sealed | null): WebhookCustomHeaders =>
  (openOptionalJson(SEALED.webhookCustomHeaders, id, sealed) as WebhookCustomHeaders | null) ?? {};

const sealHeaders = (id: string, headers: WebhookCustomHeaders | null | undefined) =>
  headers == null || Object.keys(headers).length === 0
    ? null
    : sealJson(SEALED.webhookCustomHeaders, id, headers);

/** Replaces the sealed headers by their names. */
function toWebhook(row: WebhookSelection): Webhook {
  const { customHeadersSealed, ...webhook } = row;
  return { ...webhook, customHeaderNames: Object.keys(openHeaders(row.id, customHeadersSealed)) };
}

const webhookOrNull = (rows: WebhookSelection[]): Webhook | null => {
  const row = firstOrNull(rows);
  return row === null ? null : toWebhook(row);
};

export async function createWebhook(
  db: Db,
  environmentId: string,
  input: NewWebhookInput,
): Promise<Webhook> {
  const rows = await db
    .insert(webhooks)
    .values({
      id: input.id,
      environmentId,
      url: input.url,
      enabledEvents: [...input.enabledEvents],
      status: input.status ?? 'enabled',
      secret: input.secret,
      secretLast4: input.secret.slice(-4),
      customHeadersSealed: sealHeaders(input.id, input.customHeaders),
      filters: input.filters ?? {},
      attributeBlocklist: [...(input.attributeBlocklist ?? [])],
      name: input.name ?? null,
      description: input.description ?? null,
      ...failureAlertColumns(input.failureAlert ?? null),
      ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
    })
    .returning(webhookColumns);
  return toWebhook(inserted(rows, 'createWebhook'));
}

export async function getWebhook(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Webhook | null> {
  return webhookOrNull(
    await db.select(webhookColumns).from(webhooks).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/**
 * Locks the webhook's row (`SELECT ... FOR UPDATE`) until the caller's transaction ends and
 * returns it, so a status check (C14: archived is terminal) and the change that follows
 * cannot interleave with another change. `null` when it is not in this environment.
 */
export async function lockWebhook(
  db: Db,
  environmentId: string,
  id: string,
): Promise<Webhook | null> {
  return webhookOrNull(
    await db
      .select(webhookColumns)
      .from(webhooks)
      .where(inEnvironment(environmentId, id))
      .for('update'),
  );
}

export async function listWebhooks(
  db: Db,
  environmentId: string,
  page: PageRequest = {},
): Promise<Page<Webhook>> {
  return paginate(db, webhookCursor, environmentId, page, async (after, limit) =>
    (
      await db
        .select(webhookColumns)
        .from(webhooks)
        .where(and(eq(webhooks.environmentId, environmentId), after))
        .orderBy(...newestFirst(webhookCursor))
        .limit(limit)
    ).map(toWebhook),
  );
}

/** C2/C14 `PATCH /webhooks/:id`. With no changes, returns the webhook as it is. */
export async function updateWebhook(
  db: Db,
  environmentId: string,
  id: string,
  changes: WebhookChanges,
): Promise<Webhook | null> {
  const set: PgUpdateSetSource<typeof webhooks> = {};
  if (changes.url !== undefined) set.url = changes.url;
  if (changes.enabledEvents !== undefined) set.enabledEvents = [...changes.enabledEvents];
  if (changes.status !== undefined) set.status = changes.status;
  if (changes.apiVersion !== undefined) set.apiVersion = changes.apiVersion;
  if (changes.customHeaders !== undefined) {
    set.customHeadersSealed = sealHeaders(id, changes.customHeaders);
  }
  if (changes.filters !== undefined) set.filters = changes.filters;
  if (changes.attributeBlocklist !== undefined) {
    set.attributeBlocklist = [...changes.attributeBlocklist];
  }
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.description !== undefined) set.description = changes.description;
  if (changes.failureAlert !== undefined) {
    Object.assign(set, failureAlertColumns(changes.failureAlert));
  }
  if (Object.keys(set).length === 0) {
    return getWebhook(db, environmentId, id);
  }
  return webhookOrNull(
    await db
      .update(webhooks)
      .set(set)
      .where(inEnvironment(environmentId, id))
      .returning(webhookColumns),
  );
}

/**
 * C14 `rotate-secret`: the new secret signs from now on, and the old one, re-sealed for the
 * webhook, keeps signing until `previousSecretExpiresAt`. One transaction, row locked.
 */
export async function rotateWebhookSecret(
  db: Db,
  environmentId: string,
  id: string,
  rotation: SecretRotation,
): Promise<Webhook | null> {
  return db.transaction(async (tx) => {
    const current = firstOrNull(
      await tx
        .select({ secret: webhooks.secret })
        .from(webhooks)
        .where(inEnvironment(environmentId, id))
        .for('update'),
    );
    if (current === null) {
      return null;
    }
    const keepPrevious = rotation.previousSecretExpiresAt !== null;
    return webhookOrNull(
      await tx
        .update(webhooks)
        .set({
          secret: rotation.secret,
          secretLast4: rotation.secret.slice(-4),
          previousSecretSealed: keepPrevious
            ? sealValue(SEALED.webhookPreviousSecret, id, current.secret)
            : null,
          previousSecretExpiresAt: rotation.previousSecretExpiresAt,
        })
        .where(inEnvironment(environmentId, id))
        .returning(webhookColumns),
    );
  });
}

/** The decrypted signing secret, for the dispatcher only. */
export async function getWebhookSigningSecret(
  db: Db,
  environmentId: string,
  id: string,
): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ secret: webhooks.secret })
      .from(webhooks)
      .where(inEnvironment(environmentId, id))
      .limit(1),
  );
  return row?.secret ?? null;
}

/**
 * Everything the dispatcher needs for one delivery: the webhook, the secrets that sign it
 * (the previous one only until it expires, C14) and the custom header values. For the
 * dispatcher only.
 */
export async function getWebhookDispatchConfig(
  db: Db,
  environmentId: string,
  id: string,
  now: Date = new Date(),
): Promise<WebhookDispatchConfig | null> {
  const row = firstOrNull(
    await db
      .select({
        ...webhookColumns,
        secret: webhooks.secret,
        previousSecretSealed: webhooks.previousSecretSealed,
      })
      .from(webhooks)
      .where(inEnvironment(environmentId, id))
      .limit(1),
  );
  if (row === null) {
    return null;
  }
  const { secret, previousSecretSealed, ...selection } = row;
  const secrets = [secret];
  if (
    previousSecretSealed !== null &&
    (row.previousSecretExpiresAt?.getTime() ?? 0) > now.getTime()
  ) {
    secrets.push(openValue(SEALED.webhookPreviousSecret, id, previousSecretSealed));
  }
  return {
    webhook: toWebhook(selection),
    secrets,
    customHeaders: openHeaders(id, row.customHeadersSealed),
  };
}

/**
 * A present C14 filter must contain the subject's value; an absent attribute is not filtered,
 * except for a strict subject (C70.4), which then fails any present filter.
 */
function subjectFilter(
  key: keyof WebhookFilters,
  single: string | undefined,
  several: readonly string[] | undefined,
  strict: boolean,
): SQL | undefined {
  const values = [...(single === undefined ? [] : [single]), ...(several ?? [])];
  if (values.length === 0) {
    return strict ? sql`not (${webhooks.filters} ? ${key})` : undefined;
  }
  const allowed = sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
  return sql`(not (${webhooks.filters} ? ${key})
    or (${webhooks.filters} -> ${key}) ?| array[${allowed}]::text[])`;
}

/**
 * C143.4 (Workflow 8B): a present filter must allow every value, so a case passes an inquiry-template
 * filter only when each inquiry it holds is on a template the filter names. A subject with none fails
 * the filter when strict, because nothing it holds is allowed; without the attribute it is unfiltered.
 */
function everyHeldFilter(
  key: keyof WebhookFilters,
  held: readonly string[],
  strict: boolean,
): SQL | undefined {
  if (held.length === 0) {
    return strict ? sql`not (${webhooks.filters} ? ${key})` : undefined;
  }
  const values = sql.join(
    [...new Set(held)].map((value) => sql`${value}`),
    sql`, `,
  );
  return sql`(not (${webhooks.filters} ? ${key})
    or (${webhooks.filters} -> ${key}) ?& array[${values}]::text[])`;
}

/**
 * Enabled webhooks subscribed to the event by name or with `*`, oldest first. With a
 * `subject`, C14 `filters` apply: every filter the webhook has must match the subject.
 */
export async function listWebhooksForEvent(
  db: Db,
  environmentId: string,
  eventName: string,
  subject: EventSubject = {},
): Promise<Webhook[]> {
  const rows = await db
    .select(webhookColumns)
    .from(webhooks)
    .where(
      and(
        eq(webhooks.environmentId, environmentId),
        eq(webhooks.status, 'enabled'),
        or(
          arrayContains(webhooks.enabledEvents, [eventName]),
          arrayContains(webhooks.enabledEvents, ['*']),
        ),
        // C143.4 (Workflow 8B): a case answers for every inquiry it holds, never for any one.
        subject.heldInquiryTemplateIds === undefined
          ? subjectFilter(
              'inquiry-template-ids',
              subject.inquiryTemplateId,
              subject.inquiryTemplateIds,
              subject.strict === true,
            )
          : everyHeldFilter(
              'inquiry-template-ids',
              subject.heldInquiryTemplateIds,
              subject.strict === true,
            ),
        subjectFilter(
          'account-type-ids',
          subject.accountTypeId,
          subject.accountTypeIds,
          subject.strict === true,
        ),
        // C143.4 (Workflow 8A): a loose subject without the attribute stays unfiltered by it (C14).
        subjectFilter('workflow-ids', subject.workflowId, undefined, subject.strict === true),
        subjectFilter('list-ids', subject.listId, undefined, subject.strict === true),
        // C143.4 (Workflow 8B): a case or a case comment, by its case's template.
        subjectFilter(
          'case-template-ids',
          subject.caseTemplateId,
          undefined,
          subject.strict === true,
        ),
      ),
    )
    .orderBy(asc(webhooks.createdAt), asc(webhooks.id));
  return rows.map(toWebhook);
}

/**
 * Queues the delivery of an event to a webhook. Returns `null` when that pair already
 * has a (non-replay) delivery, so fanning an event out twice does not send it twice. A C14
 * replay (`isReplay`) always creates a new delivery.
 */
export async function createWebhookDelivery(
  db: Db,
  environmentId: string,
  input: NewWebhookDeliveryInput,
): Promise<WebhookDelivery | null> {
  const insert = db.insert(webhookDeliveries).values({
    id: input.id,
    environmentId,
    webhookId: input.webhookId,
    eventId: input.eventId,
    isReplay: input.isReplay ?? false,
    ...(input.nextAttemptAt === undefined ? {} : { nextAttemptAt: input.nextAttemptAt }),
  });
  if (input.isReplay === true) {
    return inserted(await insert.returning(), 'createWebhookDelivery');
  }
  return firstOrNull(
    await insert
      .onConflictDoNothing({
        target: [webhookDeliveries.webhookId, webhookDeliveries.eventId],
        where: sql`not "is_replay"`,
      })
      .returning(),
  );
}

const deliveryWithEvent = { delivery: webhookDeliveries, eventName: events.name };
const withEventName = (row: { delivery: WebhookDelivery; eventName: string }) => ({
  ...row.delivery,
  eventName: row.eventName,
});

export async function getWebhookDelivery(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WebhookDelivery | null> {
  return firstOrNull(
    await db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.environmentId, environmentId)))
      .limit(1),
  );
}

/** One delivery with its event name (C14 `GET /webhook-deliveries/:id`), or `null`. */
export async function getWebhookDeliveryWithEvent(
  db: Db,
  environmentId: string,
  id: string,
): Promise<WebhookDeliveryRecord | null> {
  const row = firstOrNull(
    await db
      .select(deliveryWithEvent)
      .from(webhookDeliveries)
      .innerJoin(
        events,
        and(
          eq(events.environmentId, webhookDeliveries.environmentId),
          eq(events.id, webhookDeliveries.eventId),
        ),
      )
      .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.environmentId, environmentId)))
      .limit(1),
  );
  return row === null ? null : withEventName(row);
}

/** C14 `GET /webhook-deliveries`: newest first, by webhook, event and status. */
export async function listWebhookDeliveries(
  db: Db,
  environmentId: string,
  options: ListWebhookDeliveriesOptions = {},
): Promise<Page<WebhookDeliveryRecord>> {
  const filters = allFilters([
    eq(webhookDeliveries.environmentId, environmentId),
    equalsAny(webhookDeliveries.webhookId, options.webhookId),
    equalsAny(webhookDeliveries.eventId, options.eventId),
    equalsAny(webhookDeliveries.status, options.status),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, deliveryCursor, environmentId, options, async (after, limit) =>
    (
      await db
        .select(deliveryWithEvent)
        .from(webhookDeliveries)
        .innerJoin(
          events,
          and(
            eq(events.environmentId, webhookDeliveries.environmentId),
            eq(events.id, webhookDeliveries.eventId),
          ),
        )
        .where(and(...filters, after))
        .orderBy(...newestFirst(deliveryCursor))
        .limit(limit)
    ).map(withEventName),
  );
}

/**
 * C14 `replay`: the events to deliver again to a webhook, oldest first, at most 1,000:
 * the named events, or those in `[createdAtStart, createdAtEnd)` (only those whose
 * delivery to this webhook failed, with `onlyFailed`). Only events the webhook subscribes
 * to are returned; simulated events are never replayed.
 */
export async function listReplayableEvents(
  db: Db,
  environmentId: string,
  webhookId: string,
  selection: ReplaySelection,
): Promise<EventRecord[]> {
  const webhook = firstOrNull(
    await db
      .select({ enabledEvents: webhooks.enabledEvents })
      .from(webhooks)
      .where(inEnvironment(environmentId, webhookId))
      .limit(1),
  );
  if (webhook === null) {
    return [];
  }
  const subscribed = webhook.enabledEvents.includes('*')
    ? undefined
    : inArray(events.name, webhook.enabledEvents);
  let scope: SQL | undefined;
  if ('eventIds' in selection) {
    if (selection.eventIds.length === 0) {
      return [];
    }
    scope = inArray(events.id, [...selection.eventIds]);
  } else {
    scope = and(
      gte(events.createdAt, selection.createdAtStart),
      lt(events.createdAt, selection.createdAtEnd),
      selection.onlyFailed === true
        ? sql`exists (select 1 from ${webhookDeliveries}
            where ${webhookDeliveries.environmentId} = ${events.environmentId}
              and ${webhookDeliveries.eventId} = ${events.id}
              and ${webhookDeliveries.webhookId} = ${webhookId}
              and ${webhookDeliveries.status} = 'failed')`
        : undefined,
    );
  }
  return db
    .select()
    .from(events)
    .where(
      and(eq(events.environmentId, environmentId), eq(events.simulated, false), subscribed, scope),
    )
    .orderBy(asc(events.createdAt), asc(events.id))
    .limit(MAX_REPLAY_EVENTS);
}

/**
 * Pending deliveries whose next attempt is due, oldest first. This is the dispatcher's
 * sweep, so it spans every environment; each row carries its `environmentId` for the
 * tenant-scoped calls that follow.
 */
export async function listDueWebhookDeliveries(
  db: Db,
  options: DueDeliveryOptions = {},
): Promise<WebhookDelivery[]> {
  const query = db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextAttemptAt, options.now ?? new Date()),
      ),
    )
    .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.id))
    .limit(options.limit ?? 100);
  return options.lock === true ? query.for('update', { skipLocked: true }) : query;
}

/**
 * Records one attempt on a pending delivery: bumps the counter, appends the attempt to
 * `attempts`, stamps `first_attempted_at` on the first one (the C14 schedule counts from
 * it), and sets the status (`retry` stays pending until `nextAttemptAt`). Returns `null`
 * when the delivery is not pending or not here, or `attempt.attempt` was already recorded.
 */
export async function recordWebhookDeliveryAttempt(
  db: Db,
  environmentId: string,
  id: string,
  attempt: WebhookDeliveryAttempt,
): Promise<WebhookDelivery | null> {
  const error = attempt.error == null ? null : attempt.error.slice(0, MAX_ERROR_LENGTH);
  const responseStatus = attempt.responseStatus ?? null;
  const durationMs = attempt.durationMs ?? null;
  const entry = sql`jsonb_build_object(
    'attempt', ${webhookDeliveries.attemptCount} + 1,
    'attempted_at', ${attempt.attemptedAt.toISOString()}::text,
    'response_status', ${responseStatus}::integer,
    'duration_ms', ${durationMs}::integer,
    'error', ${error}::text)`;
  const set: PgUpdateSetSource<typeof webhookDeliveries> = {
    status: attempt.outcome === 'retry' ? 'pending' : attempt.outcome,
    attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
    nextAttemptAt: attempt.outcome === 'retry' ? attempt.nextAttemptAt : null,
    lastAttemptAt: attempt.attemptedAt,
    lastResponseStatus: responseStatus,
    lastError: error,
    deliveredAt: attempt.outcome === 'succeeded' ? attempt.attemptedAt : null,
    attempts: sql`${webhookDeliveries.attempts} || jsonb_build_array(${entry})`,
    firstAttemptedAt: sql`coalesce(${webhookDeliveries.firstAttemptedAt}, ${attempt.attemptedAt.toISOString()}::timestamptz)`,
  };
  return firstOrNull(
    await db
      .update(webhookDeliveries)
      .set(set)
      .where(
        and(
          eq(webhookDeliveries.id, id),
          eq(webhookDeliveries.environmentId, environmentId),
          eq(webhookDeliveries.status, 'pending'),
          attempt.attempt === undefined
            ? undefined
            : eq(webhookDeliveries.attemptCount, attempt.attempt - 1),
        ),
      )
      .returning(),
  );
}
