/**
 * C169.6, C169.7, C169.10 (Workflow 9B, `api-keys-webhooks`; plan outcome 21): one
 * `webhook-failure-alerts` pass. A webhook whose failed first attempts reach its threshold within its
 * window alerts once per window: a console notification for each user holding `webhooks:read` in the
 * environment who keeps the console on, and, when the mailer is configured and the user chose email,
 * a link-only email through the outbox, sent after the commit under the environment's sender name.
 * Every value is synthetic.
 */
import { newId, newWebhookSecret } from '@openverify/contracts';
import {
  createEvent,
  createRole,
  createUser,
  createWebhook,
  createWebhookDelivery,
  getWebhook,
  recordWebhookDeliveryAttempt,
  setNotificationPreferences,
  setUserRoleAssignments,
  updateEnvironmentSettings,
  userNotifications,
  webhookAlertEmails,
  type Db,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapturingMailer } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { runWebhookFailureAlerts, type WebhookFailureAlertDeps } from './webhook-alerts.js';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const MINUTE = 60_000;
const CONSOLE = 'https://console.example.test/';

async function operator(organizationId: string, permissions: string[]) {
  const id = newId('usr');
  const user = await createUser(db, {
    id,
    organizationId,
    email: `${id.toLowerCase()}@example.test`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
  });
  const role = await createRole(db, organizationId, {
    id: newId('role'),
    name: `Synthetic ${newId('role')}`,
    permissions,
  });
  await setUserRoleAssignments(db, organizationId, user.id, [
    { roleId: role.id, environmentIds: null },
  ]);
  return user;
}

/** A tenant with a watched webhook, three operators and `failures` failed first attempts. */
async function scene(failures: number, threshold = 2) {
  const now = new Date();
  const { organization, environment } = await createTestTenant(db);
  const environmentId = environment.id;
  const webhook = await createWebhook(db, environmentId, {
    id: newId('wbh'),
    url: 'https://hooks.example.test/synthetic-path?token=synthetic',
    enabledEvents: ['*'],
    secret: newWebhookSecret(),
    name: 'Synthetic CRM sync',
    failureAlert: { enabled: true, threshold, windowMinutes: 30 },
  });
  const watcher = await operator(organization.id, ['webhooks:read']);
  const mailed = await operator(organization.id, ['webhooks:read']);
  const outsider = await operator(organization.id, ['cases:read']);
  await db.transaction((tx) =>
    setNotificationPreferences(
      tx,
      mailed.id,
      { 'webhook-failure': { console: true, email: true } },
      now,
    ),
  );
  for (let index = 0; index < failures; index += 1) {
    const event = await createEvent(db, environmentId, {
      id: newId('evt'),
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry', id: newId('inq'), attributes: {} } },
    });
    const row = await createWebhookDelivery(db, environmentId, {
      id: newId('whd'),
      webhookId: webhook.id,
      eventId: event.id,
    });
    await recordWebhookDeliveryAttempt(db, environmentId, row?.id ?? '', {
      attempt: 1,
      attemptedAt: new Date(now.getTime() - 5 * MINUTE),
      responseStatus: 500,
      durationMs: 4,
      error: null,
      outcome: 'retry',
      nextAttemptAt: new Date(now.getTime() - 4 * MINUTE),
    });
  }
  return { now, environmentId, webhook, watcher, mailed, outsider };
}

function depsAt(now: Date, overrides: Partial<WebhookFailureAlertDeps> = {}) {
  const mailer = createCapturingMailer();
  const logger = createCapturingLogger();
  const deps: WebhookFailureAlertDeps = {
    db,
    clock: { now: () => now },
    logger,
    mailer,
    dashboardPublicUrl: CONSOLE,
    ...overrides,
  };
  return { deps, mailer, logger };
}

const notificationsOf = (environmentId: string) =>
  db
    .select({
      userId: userNotifications.userId,
      kind: userNotifications.kind,
      webhookId: userNotifications.webhookId,
      caseId: userNotifications.caseId,
    })
    .from(userNotifications)
    .where(eq(userNotifications.environmentId, environmentId));

const outboxOf = (environmentId: string) =>
  db.select().from(webhookAlertEmails).where(eq(webhookAlertEmails.environmentId, environmentId));

describe('runWebhookFailureAlerts (C169.6)', () => {
  it('alerts the users who hold webhooks:read: the console for each, a link-only email for one who chose it', async () => {
    const { now, environmentId, webhook, watcher, mailed } = await scene(2);
    await updateEnvironmentSettings(db, environmentId, { 'mail-sender-name': 'Synthetic Bank' });
    const { deps, mailer, logger } = depsAt(now);

    const result = await runWebhookFailureAlerts(deps);

    expect(result).toMatchObject({ notifications: 2, emailsQueued: 1, emailsSent: 1 });
    expect(result.alerted).toBeGreaterThanOrEqual(1);
    const written = await notificationsOf(environmentId);
    expect(written.map(({ userId }) => userId).sort()).toEqual([watcher.id, mailed.id].sort());
    expect(
      written.every((row) => row.kind === 'webhook-failure' && row.webhookId === webhook.id),
    ).toBe(true);
    expect(written.every((row) => row.caseId === null)).toBe(true);
    const mine = mailer.messages.filter((message) => message.to.address === mailed.email);
    expect(mine).toHaveLength(1);
    const [message] = mine;
    expect(message?.senderName).toBe('Synthetic Bank');
    expect(message?.text).toContain(`https://console.example.test/webhooks/${webhook.id}`);
    expect(message?.text).toContain('first');
    // A link only: never the webhook's URL, its name or a count of what it carried.
    expect(JSON.stringify(message)).not.toContain('hooks.example.test');
    expect(JSON.stringify(message)).not.toContain('Synthetic CRM sync');
    expect(await outboxOf(environmentId)).toEqual([]);
    expect((await getWebhook(db, environmentId, webhook.id))?.failureAlertNotifiedAt).toEqual(now);
    expect(JSON.stringify(logger.entries)).not.toContain(mailed.email);
  });

  it('alerts at most once per window', async () => {
    const { now, environmentId } = await scene(2);
    await runWebhookFailureAlerts(depsAt(now).deps);

    await runWebhookFailureAlerts(depsAt(new Date(now.getTime() + 29 * MINUTE)).deps);
    const within = (await notificationsOf(environmentId)).length;

    expect(within).toBe(2);
  });

  it('stays quiet below the threshold', async () => {
    const { now, environmentId, webhook } = await scene(1);

    await runWebhookFailureAlerts(depsAt(now).deps);

    expect(await notificationsOf(environmentId)).toEqual([]);
    expect((await getWebhook(db, environmentId, webhook.id))?.failureAlertNotifiedAt).toBeNull();
  });

  it('queues no email without a configured mailer, and still writes the console notifications', async () => {
    const { now, environmentId } = await scene(2);
    const unconfigured = { configured: false, send: () => Promise.reject(new Error('unused')) };

    const result = await runWebhookFailureAlerts(depsAt(now, { mailer: unconfigured }).deps);

    expect(await outboxOf(environmentId)).toEqual([]);
    expect((await notificationsOf(environmentId)).length).toBe(2);
    expect(result.emailsSent).toBe(0);
  });

  it('keeps an email whose send failed for the next pass, then sends it', async () => {
    const { now, environmentId, mailed } = await scene(2);
    const first = depsAt(now);
    first.mailer.failNext(new Error('synthetic SMTP failure'));

    await runWebhookFailureAlerts(first.deps);
    const kept = await outboxOf(environmentId);
    const later = depsAt(new Date(now.getTime() + 6 * MINUTE));
    await runWebhookFailureAlerts(later.deps);

    expect(kept.map(({ attempts }) => attempts)).toEqual([1]);
    expect(later.mailer.messages.map(({ to }) => to.address)).toContain(mailed.email);
    expect(await outboxOf(environmentId)).toEqual([]);
  });

  it('writes no link without the console’s public URL, and names no webhook', async () => {
    const { now, mailed } = await scene(2);
    const { deps, mailer } = depsAt(now, { dashboardPublicUrl: undefined });

    await runWebhookFailureAlerts(deps);

    const message = mailer.messages.find(({ to }) => to.address === mailed.email);
    expect(message?.text).toContain('Sign in to the OpenVerify console');
    expect(message?.text).not.toContain('wbh_');
  });
});
