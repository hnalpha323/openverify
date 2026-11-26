/**
 * C169.6, C169.7 (Workflow 9B, `api-keys-webhooks`; plan W3-W6): what the `webhook-failure-alerts`
 * sweep reads and writes. Which webhooks may alert now; how many first attempts failed in a window
 * (retries never counted); the claim that makes an alert at most once per window; who it reaches
 * (active users holding `webhooks:read` in that environment, with their channels); and the email
 * outbox (queued with ids only, claimed under a lease at most three times, deleted). Synthetic only.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users, webhookAlertEmails } from '../schema.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { createEnvironment } from './organizations.js';
import { setNotificationPreferences } from './notification-preferences.js';
import { createRole, setUserRoleAssignments } from './roles.js';
import { createUser } from './users.js';
import {
  claimWebhookAlertEmails,
  countFailedFirstAttempts,
  deleteWebhookAlertEmails,
  listWebhookAlertRecipients,
  listWebhookFailureAlertCandidates,
  markWebhookFailureAlertedInTx,
  queueWebhookAlertEmails,
  WEBHOOK_ALERT_EMAIL_ATTEMPTS,
  webhookAlertEmailAddress,
} from './webhook-alerts.js';
import {
  createWebhook,
  createWebhookDelivery,
  recordWebhookDeliveryAttempt,
  updateWebhook,
  type WebhookFailureAlertSetting,
} from './webhooks.js';
import { createEvent } from './events.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const MINUTE = 60_000;
const ALERT: WebhookFailureAlertSetting = { enabled: true, threshold: 2, windowMinutes: 30 };

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  return { organizationId: organization.id, environmentId: environment.id };
}

async function webhookIn(environmentId: string, failureAlert: WebhookFailureAlertSetting | null) {
  return createWebhook(database.db, environmentId, {
    id: testId('wbh'),
    url: 'https://hooks.example.test/openverify',
    enabledEvents: ['*'],
    secret: `wbhsec_${'s'.repeat(43)}`,
    failureAlert,
  });
}

/** A delivery whose attempts answered `statuses` (null: no answer), the first at `firstAt`. */
async function delivery(
  environmentId: string,
  webhookId: string,
  firstAt: Date,
  statuses: (number | null)[],
) {
  const event = await createEvent(database.db, environmentId, {
    id: testId('evt'),
    name: 'inquiry.completed',
    payload: { data: { type: 'inquiry', id: testId('inq'), attributes: {} } },
  });
  const row = await createWebhookDelivery(database.db, environmentId, {
    id: testId('whd'),
    webhookId,
    eventId: event.id,
  });
  if (row === null) throw new Error('no delivery');
  for (const [index, status] of statuses.entries()) {
    const ok = status !== null && status >= 200 && status < 300;
    const last = index === statuses.length - 1;
    await recordWebhookDeliveryAttempt(database.db, environmentId, row.id, {
      attempt: index + 1,
      attemptedAt: new Date(firstAt.getTime() + index * MINUTE),
      responseStatus: status,
      durationMs: status === null ? null : 5,
      error: status === null ? 'timeout' : null,
      ...(ok
        ? { outcome: 'succeeded' }
        : last
          ? { outcome: 'failed' }
          : {
              outcome: 'retry',
              nextAttemptAt: new Date(firstAt.getTime() + (index + 1) * MINUTE),
            }),
    });
  }
  return row.id;
}

async function operator(
  organizationId: string,
  permissions: string[],
  environmentIds: string[] | null = null,
) {
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId,
    email: `${testId('usr').toLowerCase()}@example.test`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
  });
  const role = await createRole(database.db, organizationId, {
    id: testId('role'),
    name: `Synthetic ${testId('role')}`,
    permissions,
  });
  await setUserRoleAssignments(database.db, organizationId, user.id, [
    { roleId: role.id, environmentIds },
  ]);
  return user;
}

describe('listWebhookFailureAlertCandidates (C169.6)', () => {
  it('lists enabled webhooks whose alert is on and was not sent within its window', async () => {
    const { environmentId } = await tenant();
    const now = new Date();
    const on = await webhookIn(environmentId, ALERT);
    const off = await webhookIn(environmentId, { ...ALERT, enabled: false });
    const none = await webhookIn(environmentId, null);
    const disabled = await webhookIn(environmentId, ALERT);
    await updateWebhook(database.db, environmentId, disabled.id, { status: 'disabled' });
    const recent = await webhookIn(environmentId, ALERT);
    const older = await webhookIn(environmentId, ALERT);
    await database.db.transaction(async (tx) => {
      await markWebhookFailureAlertedInTx(
        tx,
        environmentId,
        recent.id,
        new Date(now.getTime() - 29 * MINUTE),
      );
      await markWebhookFailureAlertedInTx(
        tx,
        environmentId,
        older.id,
        new Date(now.getTime() - 31 * MINUTE),
      );
    });

    const listed = (
      await listWebhookFailureAlertCandidates(database.db, { now, limit: 1000 })
    ).filter((candidate) => candidate.environmentId === environmentId);

    expect(listed.map(({ webhookId }) => webhookId).sort()).toEqual([on.id, older.id].sort());
    expect(listed.find(({ webhookId }) => webhookId === on.id)).toEqual({
      environmentId,
      webhookId: on.id,
      threshold: 2,
      windowMinutes: 30,
    });
    expect([off.id, none.id, disabled.id]).not.toContain(listed[0]?.webhookId);
  });

  it('pages by id after a cursor', async () => {
    const { environmentId } = await tenant();
    const now = new Date();
    const ids = [
      (await webhookIn(environmentId, ALERT)).id,
      (await webhookIn(environmentId, ALERT)).id,
      (await webhookIn(environmentId, ALERT)).id,
    ].sort();

    const all = (await listWebhookFailureAlertCandidates(database.db, { now, limit: 100_000 }))
      .map(({ webhookId }) => webhookId)
      .filter((id) => ids.includes(id));
    const after = (
      await listWebhookFailureAlertCandidates(database.db, { now, after: ids[0], limit: 100_000 })
    )
      .map(({ webhookId }) => webhookId)
      .filter((id) => ids.includes(id));

    expect(all).toEqual(ids);
    expect(after).toEqual(ids.slice(1));
  });
});

describe('countFailedFirstAttempts (C169.6, C169.10)', () => {
  it('counts deliveries whose first attempt failed inside the window, never a retry', async () => {
    const { environmentId } = await tenant();
    const now = new Date();
    const webhook = await webhookIn(environmentId, ALERT);
    const other = await webhookIn(environmentId, ALERT);
    const inside = new Date(now.getTime() - 10 * MINUTE);
    await delivery(environmentId, webhook.id, inside, [500]);
    await delivery(environmentId, webhook.id, inside, [null]);
    await delivery(environmentId, webhook.id, inside, [404, 200]);
    // A success first, a retry that failed later, one before the window, another webhook's.
    await delivery(environmentId, webhook.id, inside, [204]);
    await delivery(environmentId, webhook.id, new Date(now.getTime() - 40 * MINUTE), [503, 503]);
    await delivery(environmentId, webhook.id, new Date(now.getTime() - 31 * MINUTE), [500]);
    await delivery(environmentId, other.id, inside, [500]);

    const count = await countFailedFirstAttempts(database.db, environmentId, webhook.id, {
      from: new Date(now.getTime() - 30 * MINUTE),
      to: now,
      createdFrom: new Date(now.getTime() - 30 * MINUTE - 86_400_000),
    });

    expect(count).toBe(3);
  });
});

describe('markWebhookFailureAlertedInTx (C169.6: at most once per window)', () => {
  it('claims an alert once per window, and only while it is on and the webhook enabled', async () => {
    const { environmentId } = await tenant();
    const now = new Date();
    const webhook = await webhookIn(environmentId, ALERT);
    const off = await webhookIn(environmentId, { ...ALERT, enabled: false });

    const claim = (id: string, at: Date) =>
      database.db.transaction((tx) => markWebhookFailureAlertedInTx(tx, environmentId, id, at));
    const results = [
      await claim(webhook.id, now),
      await claim(webhook.id, new Date(now.getTime() + 29 * MINUTE)),
      await claim(webhook.id, new Date(now.getTime() + 30 * MINUTE)),
      await claim(off.id, now),
    ];

    expect(results).toEqual([true, false, true, false]);
  });
});

describe('listWebhookAlertRecipients (C169.6)', () => {
  it('reaches active users holding webhooks:read in the environment, with their channels', async () => {
    const { organizationId, environmentId } = await tenant();
    const elsewhere = await createEnvironment(database.db, {
      id: testId('env'),
      organizationId,
      kind: 'production',
    });
    const wide = await operator(organizationId, ['webhooks:read']);
    const here = await operator(organizationId, ['webhooks:read', 'cases:read'], [environmentId]);
    const there = await operator(organizationId, ['webhooks:read'], [elsewhere.id]);
    const cases = await operator(organizationId, ['cases:read']);
    const gone = await operator(organizationId, ['webhooks:read']);
    await database.db.update(users).set({ status: 'deactivated' }).where(eq(users.id, gone.id));
    const stranger = await operator((await tenant()).organizationId, ['webhooks:read']);
    await database.db.transaction((tx) =>
      setNotificationPreferences(
        tx,
        here.id,
        { 'webhook-failure': { console: false, email: true } },
        new Date(),
      ),
    );

    const recipients = await listWebhookAlertRecipients(database.db, environmentId);

    expect(recipients).toEqual(
      [
        { userId: wide.id, console: true, email: false },
        { userId: here.id, console: false, email: true },
      ].sort((left, right) => left.userId.localeCompare(right.userId)),
    );
    expect(recipients.map(({ userId }) => userId)).not.toEqual(
      expect.arrayContaining([there.id, cases.id, gone.id, stranger.id]),
    );
  });
});

describe('the alert email outbox (C169.6; outcome 21)', () => {
  it('queues ids only, claims under a lease at most three times, and deletes', async () => {
    const { organizationId, environmentId } = await tenant();
    const webhook = await webhookIn(environmentId, ALERT);
    const user = await operator(organizationId, ['webhooks:read']);
    const now = new Date();
    const lease = 5 * MINUTE;

    const queued = await database.db.transaction((tx) =>
      queueWebhookAlertEmails(tx, environmentId, [{ userId: user.id, webhookId: webhook.id }]),
    );
    const claim = (at: Date) =>
      database.db.transaction((tx) =>
        claimWebhookAlertEmails(tx, { now: at, leaseMs: lease, limit: 100 }),
      );
    const first = (await claim(now)).filter((email) => email.environmentId === environmentId);
    const held = (await claim(new Date(now.getTime() + MINUTE))).filter(
      (email) => email.environmentId === environmentId,
    );
    const second = (await claim(new Date(now.getTime() + lease + 1))).filter(
      (email) => email.environmentId === environmentId,
    );
    const third = (await claim(new Date(now.getTime() + 2 * (lease + 1)))).filter(
      (email) => email.environmentId === environmentId,
    );
    const lapsed = (await claim(new Date(now.getTime() + 3 * (lease + 1)))).filter(
      (email) => email.environmentId === environmentId,
    );

    expect(queued).toBe(1);
    expect(WEBHOOK_ALERT_EMAIL_ATTEMPTS).toBe(3);
    expect(first).toEqual([
      {
        id: expect.any(Number) as unknown,
        environmentId,
        userId: user.id,
        webhookId: webhook.id,
        attempts: 1,
      },
    ]);
    expect([held.length, second[0]?.attempts, third[0]?.attempts, lapsed.length]).toEqual([
      0, 2, 3, 0,
    ]);
    // The third try's lease lapsed: the email is gone.
    const left = await database.db
      .select()
      .from(webhookAlertEmails)
      .where(eq(webhookAlertEmails.environmentId, environmentId));
    expect(left).toEqual([]);
  });

  it('deletes what it is told to', async () => {
    const { organizationId, environmentId } = await tenant();
    const webhook = await webhookIn(environmentId, ALERT);
    const user = await operator(organizationId, ['webhooks:read']);
    await database.db.transaction((tx) =>
      queueWebhookAlertEmails(tx, environmentId, [{ userId: user.id, webhookId: webhook.id }]),
    );
    const [email] = (
      await database.db.transaction((tx) =>
        claimWebhookAlertEmails(tx, { now: new Date(), leaseMs: MINUTE, limit: 1000 }),
      )
    ).filter((claimed) => claimed.environmentId === environmentId);

    await deleteWebhookAlertEmails(database.db, email === undefined ? [] : [email.id]);
    await deleteWebhookAlertEmails(database.db, []);

    expect(
      await database.db
        .select()
        .from(webhookAlertEmails)
        .where(eq(webhookAlertEmails.environmentId, environmentId)),
    ).toEqual([]);
  });

  it('gives the address of a user who may still receive it, and null otherwise', async () => {
    const { organizationId, environmentId } = await tenant();
    const wants = await operator(organizationId, ['webhooks:read']);
    const quiet = await operator(organizationId, ['webhooks:read']);
    const lost = await operator(organizationId, ['inquiries:read']);
    await database.db.transaction((tx) =>
      setNotificationPreferences(
        tx,
        wants.id,
        { 'webhook-failure': { console: true, email: true } },
        new Date(),
      ),
    );

    const addresses = await Promise.all(
      [wants, quiet, lost].map((user) =>
        webhookAlertEmailAddress(database.db, { environmentId, userId: user.id }),
      ),
    );

    expect(addresses).toEqual([wants.email, null, null]);
  });
});
