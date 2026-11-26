/**
 * C16 retention: batch selectors and deleters for the daily `retention` job. They span
 * every environment (each environment's window comes from its settings) and work in
 * batches: call a deleter until it returns 0. Rows are taken `FOR UPDATE SKIP LOCKED`, so
 * two job runs never fight over a batch.
 */
import { graphKindCode } from '@openverify/core';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import {
  apiLogs,
  devices,
  environments,
  events,
  graphAttributes,
  graphQueries,
  idempotencyKeys,
  inquiries,
  inquiryFlowActions,
  inquiryFlowSteps,
  inquiryIntegrityChallenges,
  inquiryIntegrityVerdicts,
  inquirySessionSignals,
  inquirySessions,
  inquiryTemplateVersions,
  listMatches,
  mfaChallenges,
  networks,
  handoffTokens,
  oneTimeLinks,
  reports,
  transactions,
  userSessions,
  webauthnRegistrationChallenges,
  webhookDeliveries,
  workflowTriggerDeliveries,
  type EnvironmentSettings,
} from '../schema.js';
import { deleteInquiryFlowRecordsInTx, deleteInquiryIntegrityRecordsInTx } from './redaction.js';
import { DEFAULT_SWEEP_LIMIT, type SweepOptions } from './sweeps.js';

/** Environment retention settings with every default applied. */
export interface RetentionSettings {
  /** `null` keeps inquiries forever. */
  'inquiry-retention-days': number | null;
  'api-log-retention-days': number;
  'webhook-delivery-retention-days': number;
  'event-retention-days': number;
}

/** C16 defaults, applied in code. */
export const DEFAULT_RETENTION: Readonly<RetentionSettings> = Object.freeze({
  'inquiry-retention-days': null,
  'api-log-retention-days': 30,
  'webhook-delivery-retention-days': 30,
  'event-retention-days': 90,
});

/** C42.4, C42.6 face template settings, with their defaults (`@openverify/contracts`). */
export interface FaceTemplateSettings {
  'face-template-retention-days': number;
  'face-search-max-templates': number;
}

export const DEFAULT_FACE_TEMPLATE_SETTINGS: Readonly<FaceTemplateSettings> = Object.freeze({
  'face-template-retention-days': 365,
  'face-search-max-templates': 50_000,
});

/** The environment's face template settings, with the defaults for keys it does not set. */
export function resolveFaceTemplateSettings(settings: EnvironmentSettings): FaceTemplateSettings {
  return {
    'face-template-retention-days':
      settings['face-template-retention-days'] ??
      DEFAULT_FACE_TEMPLATE_SETTINGS['face-template-retention-days'],
    'face-search-max-templates':
      settings['face-search-max-templates'] ??
      DEFAULT_FACE_TEMPLATE_SETTINGS['face-search-max-templates'],
  };
}

/** C55.7: an environment's OTP text budget per hour when it sets none (`OTP_SETTINGS_DEFAULTS`). */
export const DEFAULT_OTP_SMS_MAX_PER_HOUR = 200;

/** C55.7: the environment's OTP text budget per hour, stored or the default. */
export function resolveOtpSmsMaxPerHour(settings: EnvironmentSettings): number {
  return settings['otp-sms-max-per-hour'] ?? DEFAULT_OTP_SMS_MAX_PER_HOUR;
}

/** C90.8, C91.7 (Workflow 7A): the environment's signal settings with every default applied. */
export interface SignalSettings {
  'signal-collection': NonNullable<EnvironmentSettings['signal-collection']>;
  'expose-signals': boolean;
  'signal-component-retention-days': number;
  /** `null` keeps addresses as long as the inquiry. */
  'ip-retention-days': number | null;
  'device-retention-days': number;
}

/** C90.8, C91.7 defaults (`DEFAULT_SIGNAL_COLLECTION` and the settings bounds in contracts). */
export const DEFAULT_SIGNAL_SETTINGS: Readonly<SignalSettings> = Object.freeze({
  'signal-collection': Object.freeze({
    'session-integrity': 'on',
    'device-recognition': 'off',
    'device-recognition-basis': null,
  }),
  'expose-signals': true,
  'signal-component-retention-days': 30,
  'ip-retention-days': null,
  'device-retention-days': 365,
});

/** The environment's signal settings, with the defaults for keys it does not set. */
export function resolveSignalSettings(settings: EnvironmentSettings): SignalSettings {
  const defaults = DEFAULT_SIGNAL_SETTINGS;
  return {
    'signal-collection': settings['signal-collection'] ?? { ...defaults['signal-collection'] },
    'expose-signals': settings['expose-signals'] ?? defaults['expose-signals'],
    'signal-component-retention-days':
      settings['signal-component-retention-days'] ?? defaults['signal-component-retention-days'],
    'ip-retention-days':
      settings['ip-retention-days'] === undefined
        ? defaults['ip-retention-days']
        : settings['ip-retention-days'],
    'device-retention-days': settings['device-retention-days'] ?? defaults['device-retention-days'],
  };
}

/** C143.7 (Workflow 8A): the workflow settings of an environment, with their defaults. */
export type WorkflowSettings = Required<
  Pick<
    EnvironmentSettings,
    | 'workflow-run-retention-days'
    | 'workflow-run-history-retention-days'
    | 'workflow-in-flight-cap'
    | 'workflow-http-ports'
    | 'workflow-http-hosts'
    | 'workflow-http-private-cidrs'
    | 'workflow-email-recipients'
    | 'workflow-sms-recipients'
    | 'workflow-sms-countries'
    | 'workflow-link-hosts'
    | 'case-retention-days'
  >
>;

/** C120.8, C117.8, C124.3, C126 (provisional, with C139.3's for cases). */
export const DEFAULT_WORKFLOW_SETTINGS: Readonly<WorkflowSettings> = Object.freeze({
  'workflow-run-retention-days': 30,
  'workflow-run-history-retention-days': 365,
  'workflow-in-flight-cap': 50,
  'workflow-http-ports': [],
  'workflow-http-hosts': null,
  'workflow-http-private-cidrs': [],
  'workflow-email-recipients': [],
  'workflow-sms-recipients': [],
  'workflow-sms-countries': null,
  'workflow-link-hosts': [],
  'case-retention-days': null,
});

/** The environment's workflow settings, with the defaults for keys it does not set. */
export function resolveWorkflowSettings(settings: EnvironmentSettings): WorkflowSettings {
  return Object.fromEntries(
    (Object.keys(DEFAULT_WORKFLOW_SETTINGS) as (keyof WorkflowSettings)[]).map((key) => [
      key,
      settings[key] === undefined ? DEFAULT_WORKFLOW_SETTINGS[key] : settings[key],
    ]),
  ) as WorkflowSettings;
}

/** The environment's retention windows, with the C16 defaults for keys it does not set. */
export function resolveRetentionSettings(settings: EnvironmentSettings): RetentionSettings {
  return {
    'inquiry-retention-days':
      settings['inquiry-retention-days'] === undefined
        ? DEFAULT_RETENTION['inquiry-retention-days']
        : settings['inquiry-retention-days'],
    'api-log-retention-days':
      settings['api-log-retention-days'] ?? DEFAULT_RETENTION['api-log-retention-days'],
    'webhook-delivery-retention-days':
      settings['webhook-delivery-retention-days'] ??
      DEFAULT_RETENTION['webhook-delivery-retention-days'],
    'event-retention-days':
      settings['event-retention-days'] ?? DEFAULT_RETENTION['event-retention-days'],
  };
}

/** C16: terminal statuses whose inquiries are redacted after their retention. */
export const RETENTION_TERMINAL_STATUSES = [
  'completed',
  'failed',
  'expired',
  'approved',
  'declined',
] as const;

export interface RetentionCandidate {
  id: string;
  environmentId: string;
}

export interface DeleteOptions {
  /** Defaults to now. */
  now?: Date;
  /** Batch size; defaults to 500. */
  limit?: number;
}

const now = (options: { now?: Date }) => (options.now ?? new Date()).toISOString();

/** `settings ->> key` as integer days, or the default when the key is absent. */
const settingDays = (key: keyof RetentionSettings, fallback: number | null): SQL =>
  sql`coalesce((${environments.settings} ->> ${key})::integer, ${fallback}::integer)`;

/** `column < now - days`; a `NULL` window (keep forever) matches nothing. */
const olderThan = (column: AnyPgColumn, at: string, days: SQL): SQL =>
  sql`${column} < ${at}::timestamptz - make_interval(days => ${days})`;

/**
 * Inquiries the C16 job must redact: in a terminal status, not yet redacted, and last
 * updated longer ago than their retention, which is the template version's
 * `settings.retention-days` or else the environment's `inquiry-retention-days` (none:
 * kept forever). Oldest first, across environments.
 */
export async function listInquiriesDueForRetention(
  db: Db,
  options: SweepOptions = {},
): Promise<RetentionCandidate[]> {
  const days = sql`coalesce(
    (${inquiryTemplateVersions.settings} ->> 'retention-days')::integer,
    (${environments.settings} ->> 'inquiry-retention-days')::integer)`;
  const query = db
    .select({ id: inquiries.id, environmentId: inquiries.environmentId })
    .from(inquiries)
    .innerJoin(environments, eq(environments.id, inquiries.environmentId))
    .innerJoin(
      inquiryTemplateVersions,
      eq(inquiryTemplateVersions.id, inquiries.inquiryTemplateVersionId),
    )
    .where(
      and(
        sql`${inquiries.redactedAt} IS NULL`,
        inArray(inquiries.status, [...RETENTION_TERMINAL_STATUSES]),
        olderThan(inquiries.updatedAt, now(options), days),
      ),
    )
    .orderBy(asc(inquiries.updatedAt), asc(inquiries.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
  return options.lock === true ? query.for('update', { of: inquiries, skipLocked: true }) : query;
}

/**
 * C73.6 (P14): reports the retention run must redact: not yet redacted, and created longer ago
 * than their environment's `report-retention-days` (none: kept forever). Oldest first, across
 * environments; with `lock`, taken `FOR UPDATE SKIP LOCKED` in the caller's transaction.
 */
export async function listReportsDueForRetention(
  db: Db,
  options: SweepOptions = {},
): Promise<RetentionCandidate[]> {
  const days = sql`(${environments.settings} ->> 'report-retention-days')::integer`;
  const query = db
    .select({ id: reports.id, environmentId: reports.environmentId })
    .from(reports)
    .innerJoin(environments, eq(environments.id, reports.environmentId))
    .where(and(isNull(reports.redactedAt), olderThan(reports.createdAt, now(options), days)))
    .orderBy(asc(reports.createdAt), asc(reports.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
  return options.lock === true ? query.for('update', { of: reports, skipLocked: true }) : query;
}

/**
 * C105.5: transactions the retention run must redact: not yet redacted, and created longer ago than
 * their environment's `transaction-retention-days` (none: kept forever). Oldest first, across
 * environments; with `lock`, taken `FOR UPDATE SKIP LOCKED` in the caller's transaction.
 */
export async function listTransactionsDueForRetention(
  db: Db,
  options: SweepOptions = {},
): Promise<RetentionCandidate[]> {
  const days = sql`(${environments.settings} ->> 'transaction-retention-days')::integer`;
  const query = db
    .select({ id: transactions.id, environmentId: transactions.environmentId })
    .from(transactions)
    .innerJoin(environments, eq(environments.id, transactions.environmentId))
    .where(
      and(isNull(transactions.redactedAt), olderThan(transactions.createdAt, now(options), days)),
    )
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
  return options.lock === true
    ? query.for('update', { of: transactions, skipLocked: true })
    : query;
}

/** C102.7 (Workflow 7B; decision 19): `graph-query-retention-days`, 1-365, default 30. */
export const DEFAULT_GRAPH_QUERY_RETENTION_DAYS = 30;

/**
 * C102.7: graph queries the retention run must redact: not yet redacted, and created longer ago
 * than their environment's `graph-query-retention-days` (default 30). Oldest first, across
 * environments; with `lock`, taken `FOR UPDATE SKIP LOCKED` in the caller's transaction. Built by
 * `foundation-7b` (Stage 1b (G)).
 */
export async function listGraphQueriesDueForRetention(
  db: Db,
  options: SweepOptions = {},
): Promise<RetentionCandidate[]> {
  const days = sql`coalesce((${environments.settings} ->> 'graph-query-retention-days')::integer,
    ${DEFAULT_GRAPH_QUERY_RETENTION_DAYS}::integer)`;
  const query = db
    .select({ id: graphQueries.id, environmentId: graphQueries.environmentId })
    .from(graphQueries)
    .innerJoin(environments, eq(environments.id, graphQueries.environmentId))
    .where(
      and(isNull(graphQueries.redactedAt), olderThan(graphQueries.createdAt, now(options), days)),
    )
    .orderBy(asc(graphQueries.createdAt), asc(graphQueries.id))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT);
  return options.lock === true
    ? query.for('update', { of: graphQueries, skipLocked: true })
    : query;
}

/** C16: API logs past their environment's `api-log-retention-days` (default 30). */
export async function deleteExpiredApiLogs(db: Db, options: DeleteOptions = {}): Promise<number> {
  const batch = db
    .select({ id: apiLogs.id })
    .from(apiLogs)
    .innerJoin(environments, eq(environments.id, apiLogs.environmentId))
    .where(
      olderThan(
        apiLogs.createdAt,
        now(options),
        settingDays('api-log-retention-days', DEFAULT_RETENTION['api-log-retention-days']),
      ),
    )
    .orderBy(asc(apiLogs.createdAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { of: apiLogs, skipLocked: true });
  const rows = await db
    .delete(apiLogs)
    .where(inArray(apiLogs.id, batch))
    .returning({ id: apiLogs.id });
  return rows.length;
}

/**
 * C16: finished (not `pending`) webhook deliveries past their environment's
 * `webhook-delivery-retention-days` (default 30).
 */
export async function deleteExpiredWebhookDeliveries(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const batch = db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .innerJoin(environments, eq(environments.id, webhookDeliveries.environmentId))
    .where(
      and(
        ne(webhookDeliveries.status, 'pending'),
        olderThan(
          webhookDeliveries.createdAt,
          now(options),
          settingDays(
            'webhook-delivery-retention-days',
            DEFAULT_RETENTION['webhook-delivery-retention-days'],
          ),
        ),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { of: webhookDeliveries, skipLocked: true });
  const rows = await db
    .delete(webhookDeliveries)
    .where(inArray(webhookDeliveries.id, batch))
    .returning({ id: webhookDeliveries.id });
  return rows.length;
}

/**
 * C16: events past their environment's `event-retention-days` (default 90), except those
 * a `pending` delivery still needs. Their other deliveries go with them (cascade).
 */
export async function deleteExpiredEvents(db: Db, options: DeleteOptions = {}): Promise<number> {
  const pending = db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.environmentId, events.environmentId),
        eq(webhookDeliveries.eventId, events.id),
        eq(webhookDeliveries.status, 'pending'),
      ),
    );
  // C118.1: a pending workflow delivery still needs its event. Once it is finished or `expired` it
  // holds nothing, and its row stays until the run's skeleton goes (P27).
  const pendingWorkflowDelivery = db
    .select({ id: workflowTriggerDeliveries.id })
    .from(workflowTriggerDeliveries)
    .where(
      and(
        eq(workflowTriggerDeliveries.eventId, events.id),
        eq(workflowTriggerDeliveries.status, 'pending'),
      ),
    );
  const batch = db
    .select({ id: events.id })
    .from(events)
    .innerJoin(environments, eq(environments.id, events.environmentId))
    .where(
      and(
        olderThan(
          events.createdAt,
          now(options),
          settingDays('event-retention-days', DEFAULT_RETENTION['event-retention-days']),
        ),
        notExists(pending),
        notExists(pendingWorkflowDelivery),
      ),
    )
    .orderBy(asc(events.createdAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { of: events, skipLocked: true });
  const rows = await db
    .delete(events)
    .where(inArray(events.id, batch))
    .returning({ id: events.id });
  return rows.length;
}

/**
 * How long user sessions and one-time links are kept after they expire (Workflow 2B F022):
 * long enough to look into a recent sign-in or link, then they go. A used or revoked one has
 * expired by then too (sessions live 12 hours, links at most 30 days).
 */
export const EXPIRED_CREDENTIAL_RETENTION_DAYS = 30;

const credentialCutoff = (options: DeleteOptions): Date =>
  new Date((options.now ?? new Date()).getTime() - EXPIRED_CREDENTIAL_RETENTION_DAYS * 86_400_000);

/** Dashboard user sessions 30 days past their expiry. */
export async function deleteExpiredUserSessions(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const batch = db
    .select({ id: userSessions.id })
    .from(userSessions)
    .where(lt(userSessions.expiresAt, credentialCutoff(options)))
    .orderBy(asc(userSessions.expiresAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { skipLocked: true });
  const rows = await db
    .delete(userSessions)
    .where(inArray(userSessions.id, batch))
    .returning({ id: userSessions.id });
  return rows.length;
}

/** C10 one-time links 30 days past their expiry, used, revoked or not. */
export async function deleteExpiredOneTimeLinks(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const batch = db
    .select({ id: oneTimeLinks.id })
    .from(oneTimeLinks)
    .where(lt(oneTimeLinks.expiresAt, credentialCutoff(options)))
    .orderBy(asc(oneTimeLinks.expiresAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { skipLocked: true });
  const rows = await db
    .delete(oneTimeLinks)
    .where(inArray(oneTimeLinks.id, batch))
    .returning({ id: oneTimeLinks.id });
  return rows.length;
}

/**
 * C96.2 (Workflow 7A, P27): handoff tokens 30 days past their expiry, used, revoked or not, as
 * one-time links are.
 */
export async function deleteExpiredHandoffTokens(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const batch = db
    .select({ id: handoffTokens.id })
    .from(handoffTokens)
    .where(lt(handoffTokens.expiresAt, credentialCutoff(options)))
    .orderBy(asc(handoffTokens.expiresAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { skipLocked: true });
  const rows = await db
    .delete(handoffTokens)
    .where(inArray(handoffTokens.id, batch))
    .returning({ id: handoffTokens.id });
  return rows.length;
}

/** C12/C16: idempotency keys past their 24 h expiry. */
export async function deleteExpiredIdempotencyKeys(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const batch = db
    .select({ id: idempotencyKeys.id })
    .from(idempotencyKeys)
    .where(lte(idempotencyKeys.expiresAt, options.now ?? new Date()))
    .orderBy(asc(idempotencyKeys.expiresAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { skipLocked: true });
  const rows = await db
    .delete(idempotencyKeys)
    .where(inArray(idempotencyKeys.id, batch))
    .returning({ id: idempotencyKeys.id });
  return rows.length;
}

/** Expired MFA login challenges and WebAuthn registration challenges. Returns the count. */
export async function deleteExpiredAuthChallenges(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const at = options.now ?? new Date();
  const challenges = await db
    .delete(mfaChallenges)
    .where(lt(mfaChallenges.expiresAt, at))
    .returning({ id: mfaChallenges.id });
  const registrations = await db
    .delete(webauthnRegistrationChallenges)
    .where(lt(webauthnRegistrationChallenges.expiresAt, at))
    .returning({ id: webauthnRegistrationChallenges.id });
  return challenges.length + registrations.length;
}

/** `settings ->> key` as integer days for a signal setting, or its default. */
const signalDays = (key: keyof SignalSettings, fallback: number | null): SQL =>
  sql`coalesce((${environments.settings} ->> ${key})::integer, ${fallback}::integer)`;

/**
 * C91.7 (P19, Workflow 7A): nulls the sealed collector components of signal bodies older than
 * their environment's `signal-component-retention-days` (default 30); the behaviour aggregates
 * stay with the inquiry. Returns how many bodies changed.
 */
export async function nullExpiredSignalComponents(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const batch = db
    .select({ id: inquirySessionSignals.id })
    .from(inquirySessionSignals)
    .innerJoin(environments, eq(environments.id, inquirySessionSignals.environmentId))
    .where(
      and(
        sql`${inquirySessionSignals.componentsSealed} is not null`,
        olderThan(
          inquirySessionSignals.createdAt,
          now(options),
          signalDays(
            'signal-component-retention-days',
            DEFAULT_SIGNAL_SETTINGS['signal-component-retention-days'],
          ),
        ),
      ),
    )
    .orderBy(asc(inquirySessionSignals.createdAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { of: inquirySessionSignals, skipLocked: true });
  const rows = await db
    .update(inquirySessionSignals)
    .set({ componentsSealed: null })
    .where(inArray(inquirySessionSignals.id, batch))
    .returning({ id: inquirySessionSignals.id });
  return rows.length;
}

/** C91.7, P19 (Workflow 7B): the probe sources whose compared value came from an address. */
const IP_SOURCED_LIST_MATCH_SOURCES = [
  'session.ip-address',
  'session.ip-country',
  'session.ip-point',
] as const;

/**
 * C91.7, C101.2: deletes `limit` `ip_address` graph rows older than their environment's
 * `ip-retention-days`. A row is a keyed address, so an account still links through it after the
 * address was nulled. `first_seen_at` is the session's first flow call, and it stays through a
 * re-index, which `last_seen_at` does not. Returns how many went.
 */
async function deleteExpiredIpGraphRows(
  db: Db,
  input: { at: string; days: SQL; limit: number },
): Promise<number> {
  const deleted = await db.execute(sql`
    with batch as (
      select ${graphAttributes}.ctid as row_id
        from ${graphAttributes}
        join ${environments} on ${environments.id} = ${graphAttributes.environmentId}
       where ${graphAttributes.kind} = ${graphKindCode('ip_address')}
         and ${olderThan(graphAttributes.firstSeenAt, input.at, input.days)}
       order by ${graphAttributes.firstSeenAt}
       limit ${input.limit}
         for update of ${graphAttributes} skip locked
    )
    delete from ${graphAttributes}
     where ctid in (select row_id from batch)
    returning 1 as gone`);
  return (deleted as { rows: unknown[] }).rows.length;
}

/**
 * C91.7: nulls, earlier than the inquiry's retention, the sealed addresses of sessions (and their
 * consent records) and networks, and the IP-sourced values of list matches, older than their
 * environment's `ip-retention-days` (none by default: nothing), and deletes the `ip_address` graph
 * rows (C101.2). The derived network facts and the match records stay. Returns how many rows
 * changed, the four tables together (each batch of each table at most `limit`).
 */
export async function nullExpiredAddresses(db: Db, options: DeleteOptions = {}): Promise<number> {
  const at = now(options);
  const days = sql`(${environments.settings} ->> 'ip-retention-days')::integer`;
  const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
  const consentIp = sql`${inquirySessions.consent} ->> 'ip'`;
  const sessionBatch = db
    .select({ id: inquirySessions.id })
    .from(inquirySessions)
    .innerJoin(environments, eq(environments.id, inquirySessions.environmentId))
    .where(
      and(
        sql`(${inquirySessions.ipSealed} is not null or ${consentIp} is not null)`,
        olderThan(inquirySessions.createdAt, at, days),
      ),
    )
    .orderBy(asc(inquirySessions.createdAt))
    .limit(limit)
    .for('update', { of: inquirySessions, skipLocked: true });
  const sessions = await db
    .update(inquirySessions)
    .set({
      ipSealed: null,
      consent: sql`case when ${inquirySessions.consent} is null then null
        else ${inquirySessions.consent} || '{"ip": null}'::jsonb end`,
    })
    .where(inArray(inquirySessions.id, sessionBatch))
    .returning({ id: inquirySessions.id });
  const networkBatch = db
    .select({ id: networks.id })
    .from(networks)
    .innerJoin(environments, eq(environments.id, networks.environmentId))
    .where(and(sql`${networks.ipSealed} is not null`, olderThan(networks.createdAt, at, days)))
    .orderBy(asc(networks.createdAt))
    .limit(limit)
    .for('update', { of: networks, skipLocked: true });
  const nulled = await db
    .update(networks)
    .set({ ipSealed: null })
    .where(inArray(networks.id, networkBatch))
    .returning({ id: networks.id });
  const matchBatch = db
    .select({ id: listMatches.id })
    .from(listMatches)
    .innerJoin(environments, eq(environments.id, listMatches.environmentId))
    .where(
      and(
        sql`${listMatches.matchedValueSealed} is not null`,
        inArray(listMatches.source, [...IP_SOURCED_LIST_MATCH_SOURCES]),
        olderThan(listMatches.createdAt, at, days),
      ),
    )
    .orderBy(asc(listMatches.createdAt))
    .limit(limit)
    .for('update', { of: listMatches, skipLocked: true });
  const matches = await db
    .update(listMatches)
    .set({ matchedValueSealed: null })
    .where(inArray(listMatches.id, matchBatch))
    .returning({ id: listMatches.id });
  const graphRows = await deleteExpiredIpGraphRows(db, { at, days, limit });
  return sessions.length + nulled.length + matches.length + graphRows;
}

/**
 * C91.7: deletes devices whose `last_seen_at` is older than their environment's
 * `device-retention-days` (default 365), with their HMACs and links (cascade); sessions keep their
 * facts without the link. Returns how many devices went.
 */
export async function deleteExpiredDevices(db: Db, options: DeleteOptions = {}): Promise<number> {
  const batch = db
    .select({ id: devices.id })
    .from(devices)
    .innerJoin(environments, eq(environments.id, devices.environmentId))
    .where(
      olderThan(
        devices.lastSeenAt,
        now(options),
        signalDays('device-retention-days', DEFAULT_SIGNAL_SETTINGS['device-retention-days']),
      ),
    )
    .orderBy(asc(devices.lastSeenAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { of: devices, skipLocked: true });
  const rows = await db
    .delete(devices)
    .where(inArray(devices.id, batch))
    .returning({ id: devices.id });
  return rows.length;
}

/**
 * C174.3 (Workflow 9A Stage 1b (S)): the flow engine's records follow their inquiry's retention.
 * The inquiry's redaction deletes them (`redactInquiryRecords`); this step deletes any a redacted
 * inquiry still holds (one written in a race with the redaction, or by a process that stopped), in
 * batches of `limit` inquiries. Returns the inquiries cleaned.
 */
export async function deleteFlowRecordsOfRedactedInquiries(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
  const holders = async (table: typeof inquiryFlowSteps | typeof inquiryFlowActions) =>
    db
      .selectDistinct({ environmentId: table.environmentId, inquiryId: table.inquiryId })
      .from(table)
      .innerJoin(
        inquiries,
        and(eq(inquiries.environmentId, table.environmentId), eq(inquiries.id, table.inquiryId)),
      )
      .where(isNotNull(inquiries.redactedAt))
      .orderBy(asc(table.environmentId), asc(table.inquiryId))
      .limit(limit);
  const found = new Map<string, Set<string>>();
  for (const { environmentId, inquiryId } of [
    ...(await holders(inquiryFlowSteps)),
    ...(await holders(inquiryFlowActions)),
  ]) {
    found.set(environmentId, (found.get(environmentId) ?? new Set()).add(inquiryId));
  }
  let cleaned = 0;
  await db.transaction(async (tx) => {
    for (const [environmentId, ids] of found) {
      await deleteInquiryFlowRecordsInTx(tx, environmentId, [...ids]);
      cleaned += ids.size;
    }
  });
  return Math.min(cleaned, limit);
}

/**
 * C211.3, C221.3 (Workflow 10B Stage 1b (I)): how long an integrity challenge is kept past its
 * expiry (ours, provisional): the `integrity-decode` job reads a token within seconds of its post and
 * retries for minutes, so a day leaves room for an outage while no undecoded token lingers.
 */
export const INTEGRITY_CHALLENGE_RETENTION_HOURS = 24;

/**
 * C221.3 (Workflow 10B): integrity challenges a day past their expiry, used or not, with any token
 * still sealed in them. Returns how many were deleted.
 */
export async function deleteExpiredIntegrityChallenges(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - INTEGRITY_CHALLENGE_RETENTION_HOURS * 3_600_000,
  );
  const batch = db
    .select({ id: inquiryIntegrityChallenges.id })
    .from(inquiryIntegrityChallenges)
    .where(lt(inquiryIntegrityChallenges.expiresAt, cutoff))
    .orderBy(asc(inquiryIntegrityChallenges.expiresAt))
    .limit(options.limit ?? DEFAULT_SWEEP_LIMIT)
    .for('update', { skipLocked: true });
  const rows = await db
    .delete(inquiryIntegrityChallenges)
    .where(inArray(inquiryIntegrityChallenges.id, batch))
    .returning({ id: inquiryIntegrityChallenges.id });
  return rows.length;
}

/**
 * C221.3 (Workflow 10B): the integrity records follow their inquiry's retention. The inquiry's
 * redaction deletes them (`redactInquiryRecords`); this step deletes any a redacted inquiry still
 * holds (a token or verdict written in a race with the redaction), in batches of `limit` inquiries.
 * Returns the inquiries cleaned.
 */
export async function deleteIntegrityRecordsOfRedactedInquiries(
  db: Db,
  options: DeleteOptions = {},
): Promise<number> {
  const limit = options.limit ?? DEFAULT_SWEEP_LIMIT;
  const holders = async (
    table: typeof inquiryIntegrityChallenges | typeof inquiryIntegrityVerdicts,
  ) =>
    db
      .selectDistinct({ environmentId: table.environmentId, inquiryId: table.inquiryId })
      .from(table)
      .innerJoin(
        inquiries,
        and(eq(inquiries.environmentId, table.environmentId), eq(inquiries.id, table.inquiryId)),
      )
      .where(isNotNull(inquiries.redactedAt))
      .orderBy(asc(table.environmentId), asc(table.inquiryId))
      .limit(limit);
  const found = new Map<string, Set<string>>();
  for (const { environmentId, inquiryId } of [
    ...(await holders(inquiryIntegrityChallenges)),
    ...(await holders(inquiryIntegrityVerdicts)),
  ]) {
    found.set(environmentId, (found.get(environmentId) ?? new Set()).add(inquiryId));
  }
  let cleaned = 0;
  await db.transaction(async (tx) => {
    for (const [environmentId, ids] of found) {
      await deleteInquiryIntegrityRecordsInTx(tx, environmentId, [...ids]);
      cleaned += ids.size;
    }
  });
  return Math.min(cleaned, limit);
}
