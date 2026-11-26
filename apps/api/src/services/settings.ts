/**
 * C15 and C16 dashboard settings: the organization's `require-mfa` and the environment's
 * retention windows (`resolveRetentionSettings` applies the C16 defaults on read); C42 the face
 * template settings; C55.7 the OTP text budget per hour (at most the install ceiling,
 * `OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`) and, read-only, when it last tripped (the newest
 * `environment.otp-sms-budget-tripped` audit entry).
 */
import { settingLevel } from '@openverify/core';
import {
  GRAPH_QUERY_RETENTION_DAYS,
  GRAPH_SETTING_DEFAULTS,
  OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION,
  QUEUE_IN_FLIGHT_CAP,
  resolveConnectSettings,
  resolveHardeningSettings,
  resolvePlatformSettings,
  toTimestamp,
  type DashboardSettings,
  type DashboardUpdateSettingsBody,
} from '@openverify/contracts';
import {
  getEnvironment,
  getOrganization,
  latestAuditLogAt,
  listEnvironments,
  resolveFaceTemplateSettings,
  resolveOtpSmsMaxPerHour,
  resolveRetentionSettings,
  resolveSignalSettings,
  resolveWorkflowSettings,
  setOrganizationConnectInbound,
  setOrganizationSlug,
  setOrganizationRequireMfa,
  updateEnvironmentSettings,
  type Db,
  type EnvironmentSettings,
} from '@openverify/db';
import { OrganizationSlugTakenError } from '../operator-auth/oidc/failures.js';
import {
  clampQueueCaps,
  queueCapRefusalDetail,
  queueCapRefusals,
  storedQueueCaps,
} from './quotas/caps.js';
import {
  NotFoundError,
  PermissionDeniedError,
  SignalProblemError,
  UnprocessableContentError,
} from '../errors.js';
import type { AuditLogger, ServiceContext } from '../ports.js';
import type { AuditActor } from '@openverify/contracts';
import {
  createOutboxOnlyPublisher,
  type StagedEvent,
  type TransactionalEventPublisher,
} from '../events/index.js';
import { workflowEgressSettingsProblem } from '../workflows/actions/https/settings-check.js';
import { auditEntryOf } from './context.js';
import { embeddingSettingsProblems } from './embed-origins.js';
import { displayNameProblem } from './nfc-boundary.js';
import { checkThemeSetChoice } from './themes/settings.js';
import { assertSettingsLevelAllowed } from './access/settings-level.js';
import { onAnalyticsSettingsChangedInTx } from './analytics/settings-hook.js';
import { onGraphSettingsChangedInTx } from './graph/settings-hook.js';
import { onSettingsChangedInTx } from './lists/biometric/settings-hook.js';

const RETENTION_KEYS = [
  'inquiry-retention-days',
  'api-log-retention-days',
  'webhook-delivery-retention-days',
  'event-retention-days',
  // C42.4, C42.6 (Phase 4).
  'face-template-retention-days',
  'face-search-max-templates',
  // C55.7 (Phase 5).
  'otp-sms-max-per-hour',
  // C73.6 (Phase 6).
  'report-retention-days',
  // C90.8, C91.7 (Workflow 7A); `signal-collection` also needs `settings:privacy`.
  'signal-collection',
  'expose-signals',
  'signal-component-retention-days',
  'ip-retention-days',
  'device-retention-days',
  // C107.7 (Workflow 7A): shown on the handoff context screen.
  'organization-display-name',
  // C97.4 (Workflow 7B); it also needs `settings:privacy`.
  'biometric-lists-basis',
  // C105.5, C107.7 (Workflow 7B).
  'transaction-retention-days',
  // C101, C102.7, C107.7 (Workflow 7B); the three switches also need `settings:privacy`.
  'graph-indexing',
  'graph-weak-kinds',
  'graph-components',
  'graph-query-retention-days',
  // C143.7 (Workflow 8A); `workflow-http-private-cidrs` also needs `settings:privacy`.
  'workflow-run-retention-days',
  'workflow-run-history-retention-days',
  'workflow-in-flight-cap',
  'workflow-http-ports',
  'workflow-http-hosts',
  'workflow-http-private-cidrs',
  'workflow-email-recipients',
  'workflow-sms-recipients',
  'workflow-sms-countries',
  'workflow-link-hosts',
  'case-retention-days',
  // C158.1, C158.4 (Workflow 9A Stage 1b (F)): held to the origin grammar first.
  'allowed-embed-origins',
  'allowed-redirect-origins',
  // C160.7 (Workflow 9A Stage 1b (H)): an active theme set of the environment (`api-themes`).
  'default-theme-set-id',
  // C174.6 (Workflow 9B Stage 1a): the platform settings, bounded by their schemas.
  'analytics-time-zone',
  'analytics-suppression-threshold',
  'analytics-retention-months',
  'analytics-settle-days',
  'analytics-assignee-retention-months',
  'api-key-age-warning-days',
  'mail-sender-name',
  'audit-log-retention-days',
  // C232.1, C241.3 (Workflow 11A Stage 1a): Connect's settings, bounded by their schemas.
  'share-token-max-seconds',
  'consent-proof-retention-days',
  // C251.2, C253.4, C254.2 (Workflow 11B Stage 1a): bounded by their schemas; the install ceiling of
  // a queue cap is foundation-11b's hook (Stage 1a amendment 17).
  'queue-in-flight-caps',
  'account-export-ttl-days',
  'watchlist-full-check-hours',
] as const;

/**
 * C90.8, C97.4, C107.7 (F37, P10, decision 45): the settings that need `settings:privacy` beside
 * `settings:write`.
 */
const PRIVACY_SETTINGS = [
  'signal-collection',
  'biometric-lists-basis',
  'graph-indexing',
  'graph-weak-kinds',
  'graph-components',
  'workflow-http-private-cidrs',
] as const;

/**
 * The settings of the organization and environment of `ctx`.
 * @throws {NotFoundError} when either does not exist (a session cannot outlive them).
 */
export async function getDashboardSettings(
  db: Db,
  ctx: ServiceContext,
  otpSmsMaxPerHourCeiling: number,
  queueInFlightCapMax: number = QUEUE_IN_FLIGHT_CAP.ceilingDefault,
): Promise<DashboardSettings> {
  const organization = await getOrganization(db, ctx.organizationId);
  const environment = await getEnvironment(db, ctx.environmentId);
  if (organization === null || environment?.organizationId !== ctx.organizationId) {
    throw new NotFoundError('The session’s organization or environment no longer exists.');
  }
  const trippedAt = await latestAuditLogAt(
    db,
    ctx.environmentId,
    OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION,
  );
  return {
    'require-mfa': organization.requireMfa,
    // C231.10 (Workflow 11A Stage 1a (C)): the organisation's opt-in to inbound connections.
    'connect-inbound': organization.connectInbound,
    // C248.8 (Workflow 11B, sso-oidc's borrowed edit; amendments 10 and 39): the sign-in name.
    'organization-slug': organization.slug,
    ...resolveRetentionSettings(environment.settings),
    ...resolveFaceTemplateSettings(environment.settings),
    // C55.7: a ceiling lowered below the stored budget wins.
    'otp-sms-max-per-hour': Math.min(
      resolveOtpSmsMaxPerHour(environment.settings),
      otpSmsMaxPerHourCeiling,
    ),
    'otp-sms-budget-tripped-at': trippedAt === null ? null : toTimestamp(trippedAt),
    // C73.6 (P14): null keeps reports as long as inquiries.
    'report-retention-days': environment.settings['report-retention-days'] ?? null,
    // C90.8, C91.7 (Workflow 7A): the signal settings, with their defaults.
    ...resolveSignalSettings(environment.settings),
    // C107.7 (Workflow 7A; F30): `null` until set.
    'organization-display-name': environment.settings['organization-display-name'] ?? null,
    // C97.4 (Workflow 7B): `null` until set.
    'biometric-lists-basis': environment.settings['biometric-lists-basis'] ?? null,
    // C105.5 (Workflow 7B): null keeps transactions.
    'transaction-retention-days': environment.settings['transaction-retention-days'] ?? null,
    // C101, C102.7 (Workflow 7B; P26, decision 19): the graph switches and the result window.
    'graph-indexing':
      environment.settings['graph-indexing'] ?? GRAPH_SETTING_DEFAULTS['graph-indexing'],
    'graph-weak-kinds':
      environment.settings['graph-weak-kinds'] ?? GRAPH_SETTING_DEFAULTS['graph-weak-kinds'],
    'graph-components':
      environment.settings['graph-components'] ?? GRAPH_SETTING_DEFAULTS['graph-components'],
    'graph-query-retention-days':
      environment.settings['graph-query-retention-days'] ?? GRAPH_QUERY_RETENTION_DAYS.default,
    // C143.7 (Workflow 8A): with their defaults.
    ...resolveWorkflowSettings(environment.settings),
    // C158.1, C158.4 (Workflow 9A Stage 1b (F)): no embed origin, and the embed origins for
    // redirects (`null`), until set.
    'allowed-embed-origins': environment.settings['allowed-embed-origins'] ?? [],
    'allowed-redirect-origins': environment.settings['allowed-redirect-origins'] ?? null,
    // C160.7 (Workflow 9A Stage 1b (H)): the built-in tokens until set.
    'default-theme-set-id': environment.settings['default-theme-set-id'] ?? null,
    // C174.6 (Workflow 9B Stage 1a): the platform settings, with their defaults.
    ...resolvePlatformSettings(environment.settings),
    // C232.1, C241.3 (Workflow 11A Stage 1a): Connect's settings, with their defaults.
    ...resolveConnectSettings(environment.settings),
    // C251.2, C253.4, C254.2 (Workflow 11B Stage 1a): with their defaults.
    ...resolveHardeningSettings(environment.settings),
    // C251.2 (Workflow 11B, quotas' borrowed edit; amendments 14 and 17): a cap stored above a
    // ceiling lowered later is served at the ceiling, never refused on read.
    'queue-in-flight-caps': clampQueueCaps(
      storedQueueCaps(environment.settings['queue-in-flight-caps']),
      queueInFlightCapMax,
    ),
    'workflow-in-flight-cap': Math.min(
      resolveWorkflowSettings(environment.settings)['workflow-in-flight-cap'],
      queueInFlightCapMax,
    ),
  };
}

/**
 * C143.5 (P19; rule 11): the audit entry's metadata. The two recipient lists hold addresses and
 * numbers, so their entry says how many, never who.
 */
function auditedChanges(changes: DashboardUpdateSettingsBody): Record<string, unknown> {
  const counted = (key: 'workflow-email-recipients' | 'workflow-sms-recipients') => {
    const list = changes[key];
    return list === undefined ? {} : { [key]: { count: list.length } };
  };
  return {
    ...changes,
    ...counted('workflow-email-recipients'),
    ...counted('workflow-sms-recipients'),
  };
}

/**
 * `PATCH /dashboard/settings`: `require-mfa` on the organization and the retention windows, face
 * template settings and OTP text budget on the environment, in one transaction with its
 * `settings.updated` audit entry (in the environment, with the changes as metadata).
 * @throws {UnprocessableContentError} for an OTP text budget above the install ceiling (C55.7).
 */
export async function updateDashboardSettings(
  db: Db,
  audit: AuditLogger,
  ctx: ServiceContext,
  actor: AuditActor,
  changes: DashboardUpdateSettingsBody,
  otpSmsMaxPerHourCeiling: number,
  permissions: ReadonlySet<string> = new Set(),
  events: TransactionalEventPublisher = createOutboxOnlyPublisher(db),
  queueInFlightCapMax: number = QUEUE_IN_FLIGHT_CAP.ceilingDefault,
): Promise<DashboardSettings> {
  // C167.2 (Workflow 9B Stage 1b (U); V14): an organisation setting (`SETTING_LEVEL`) only with
  // organisation-wide `settings:write`, before anything is written (`api-access`'s hook).
  await assertSettingsLevelAllowed(db, {
    organizationId: ctx.organizationId,
    environmentId: ctx.environmentId,
    actor,
    keys: Object.keys(changes).filter(
      (key) => changes[key as keyof DashboardUpdateSettingsBody] !== undefined,
    ),
  });
  const privacy = PRIVACY_SETTINGS.find((setting) => changes[setting] !== undefined);
  if (privacy !== undefined && !permissions.has('settings:privacy')) {
    throw new PermissionDeniedError(`Changing ${privacy} needs the settings:privacy permission.`, [
      'settings:privacy',
    ]);
  }
  const collection = changes['signal-collection'];
  if (collection !== undefined) {
    if (
      collection['device-recognition'] === 'exempt' &&
      collection['device-recognition-basis'] === null
    ) {
      throw new SignalProblemError(
        'basis_required',
        'Device recognition in exempt mode needs its recorded basis.',
        {
          errors: [
            {
              location: 'body',
              pointer: '/signal-collection/device-recognition-basis',
              detail: 'is required when device-recognition is exempt',
            },
          ],
        },
      );
    }
  }
  // C124.3: what only the egress rules can judge, before anything is written.
  const egress = workflowEgressSettingsProblem(changes);
  if (egress !== null) {
    throw new UnprocessableContentError(egress.detail, [
      { location: 'body', pointer: `/${egress.setting}`, detail: egress.detail },
    ]);
  }
  // C158.1, C158.4 (V17): each origin in the grammar for the environment's kind, and a production
  // wildcard only with its acknowledgement (`services/embed-origins.ts`, `flow-server-embed`).
  if (
    changes['allowed-embed-origins'] !== undefined ||
    changes['allowed-redirect-origins'] !== undefined
  ) {
    const environment = await getEnvironment(db, ctx.environmentId);
    const problem = embeddingSettingsProblems(environment?.kind ?? 'production', changes);
    if (problem !== null) {
      throw problem;
    }
  }
  // C160.7 (Workflow 9A Stage 1b (H)): the default names an active set of the environment.
  const defaultThemeSet = changes['default-theme-set-id'];
  if (defaultThemeSet !== undefined) {
    await checkThemeSetChoice(db, {
      environmentId: ctx.environmentId,
      themeSetId: defaultThemeSet,
      pointer: '/default-theme-set-id',
    });
  }
  // C200.2, C221.12 (Workflow 10A; review V13): a name a consent text is filled with starts with a
  // stable NFC boundary, so a device's unnormalised fill has the digest the server takes.
  const displayName = changes['organization-display-name'];
  const displayNameRefusal =
    typeof displayName === 'string' ? displayNameProblem(displayName) : null;
  if (displayNameRefusal !== null) {
    throw new UnprocessableContentError(displayNameRefusal, [
      { location: 'body', pointer: '/organization-display-name', detail: displayNameRefusal },
    ]);
  }
  // C251.2 (Workflow 11B, quotas' borrowed edit; review P15): no queue cap above the install
  // ceiling, with C55.7's generic 422 and a pointer per refused cap, before anything is written.
  const capRefusals = queueCapRefusals(changes, queueInFlightCapMax);
  if (capRefusals.length > 0) {
    throw new UnprocessableContentError(
      queueCapRefusalDetail(queueInFlightCapMax),
      capRefusals.map((refusal) => ({ location: 'body', ...refusal })),
    );
  }
  const budget = changes['otp-sms-max-per-hour'];
  if (budget !== undefined && budget > otpSmsMaxPerHourCeiling) {
    throw new UnprocessableContentError(
      `otp-sms-max-per-hour is at most this installation's ceiling, ${String(otpSmsMaxPerHourCeiling)}.`,
      [
        {
          location: 'body',
          pointer: '/otp-sms-max-per-hour',
          detail: `must be at most ${String(otpSmsMaxPerHourCeiling)}`,
        },
      ],
    );
  }
  const staged: StagedEvent[] = [];
  await db.transaction(async (tx) => {
    if (changes['require-mfa'] !== undefined) {
      await setOrganizationRequireMfa(tx, ctx.organizationId, changes['require-mfa']);
    }
    // C231.10 (Workflow 11A Stage 1a (C)): organisation-level, so `assertSettingsLevelAllowed` above
    // already refused it to an environment-scoped `settings:write`.
    if (changes['connect-inbound'] !== undefined) {
      await setOrganizationConnectInbound(tx, ctx.organizationId, changes['connect-inbound']);
    }
    // C248.8 (Workflow 11B, sso-oidc's borrowed edit): organisation-level like the two above; a
    // name another organisation holds rolls the whole change back.
    const slug = changes['organization-slug'];
    if (
      slug !== undefined &&
      (await setOrganizationSlug(tx, ctx.organizationId, slug)) === 'taken'
    ) {
      throw new OrganizationSlugTakenError();
    }
    const retention: EnvironmentSettings = {};
    for (const key of RETENTION_KEYS) {
      const value = changes[key];
      if (value !== undefined) {
        Object.assign(retention, { [key]: value });
      }
    }
    if (Object.keys(retention).length > 0) {
      // C97.4 (Workflow 7B; F16): the hook sees both sides of the change, in this transaction.
      const before = await getEnvironment(tx, ctx.environmentId);
      const after = await updateEnvironmentSettings(tx, ctx.environmentId, retention);
      staged.push(
        ...(await onSettingsChangedInTx(
          tx,
          ctx.environmentId,
          before?.settings ?? {},
          after?.settings ?? {},
          { events },
        )),
      );
      // C101.5 (Workflow 7B; H10): a switch that starts writing graph kinds marks them incomplete.
      await onGraphSettingsChangedInTx(
        tx,
        ctx.environmentId,
        before?.settings ?? {},
        after?.settings ?? {},
      );
      // C163.2 (Workflow 9B Stage 1b (A)): a changed reporting zone leads to a rebuild of the open
      // days (`api-analytics`).
      await onAnalyticsSettingsChangedInTx(
        tx,
        ctx.environmentId,
        before?.settings ?? {},
        after?.settings ?? {},
      );
    }
    await audit.record(
      tx,
      auditEntryOf(ctx, actor, {
        action: 'settings.updated',
        resourceType: 'environment',
        resourceId: ctx.environmentId,
        metadata: auditedChanges(changes),
      }),
    );
    // C167.2 (Workflow 9B): an organisation setting (SETTING_LEVEL) changes every environment, so
    // each other environment of the organisation records its change, the organisation keys only.
    const organizationChanges = Object.fromEntries(
      Object.entries(changes).filter(([key]) => settingLevel(key) === 'organization'),
    );
    if (Object.keys(organizationChanges).length > 0) {
      for (const environment of await listEnvironments(tx, ctx.organizationId)) {
        if (environment.id === ctx.environmentId) continue;
        await audit.record(
          tx,
          auditEntryOf({ ...ctx, environmentId: environment.id }, actor, {
            action: 'settings.updated',
            resourceType: 'environment',
            resourceId: environment.id,
            metadata: organizationChanges,
          }),
        );
      }
    }
  });
  await events.dispatch(staged);
  return getDashboardSettings(db, ctx, otpSmsMaxPerHourCeiling, queueInFlightCapMax);
}
