/**
 * K8-20 (Workflow 8D; C133.7, C134.4, P38, decision 76): the link-only case emails. Each in-app
 * notification (assigned, mentioned, SLA breached) queues one, and so does `notify-on-create`; the
 * worker's sweep sends each once to the user's address, with a fixed sentence and the case's console
 * link and never a field, a comment or a filename. A user who can no longer read the case (not
 * active, no `cases:read`, a template it may not see) and a redacted case are skipped at send. Without
 * a console URL the message goes without its link; without an SMTP server nothing is sent and the
 * queue is emptied; a failed send is tried three times in all.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createUserNotifications, queueCaseNotificationEmails } from '@openverify/db';
import {
  createTestDatabase,
  seedCase,
  seedCaseTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Mailer, MailMessage } from '../../ports.js';
import {
  createDashboardHarness,
  type DashboardHarness,
  type TestOperator,
  type TestOrganization,
} from '../../routes/dashboard/dashboard.test-support.js';
import { createCapturingMailer } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { runCaseNotificationEmails } from './notification-emails.js';

const URL = 'https://console.example.test';
const CANARY = 'synthetic-field-canary';

let database: TestDatabase;
let harness: DashboardHarness;
let organization: TestOrganization;
let environmentId: string;
let reviewer: TestOperator;
let now = new Date('2026-11-03T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  harness = await createDashboardHarness(database);
  organization = await harness.organization();
  environmentId = organization.sandboxId;
  reviewer = await harness.operator(organization, { roles: ['reviewer'] });
}, 120_000);

afterAll(async () => {
  await harness.close();
  await database.close();
});

async function newCase(options: { hiddenFrom?: 'reviewer' } = {}) {
  const template = await seedCaseTemplate(database.db, environmentId);
  if (options.hiddenFrom !== undefined) {
    await database.db.execute(sql`update case_templates
      set visible_to_roles = ${`{${organization.roleIds.admin}}`}::text[]
      where id = ${template.id}`);
  }
  return seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
    fields: { note: CANARY },
  });
}

/** `null` for a console with no public URL (an `undefined` would take the default). */
function deps(mailer: Mailer, url: string | null = URL) {
  const dashboardPublicUrl = url ?? undefined;
  const logger = createCapturingLogger();
  return {
    db: database.db,
    mailer,
    clock: { now: () => now },
    logger,
    dashboardPublicUrl,
  };
}

const notification = (
  userId: string,
  caseId: string,
  kind: 'assigned' | 'mentioned' | 'sla-breached',
) => ({
  id: newId('unot'),
  userId,
  kind,
  caseId,
});

describe('the link-only case emails (K8-20)', () => {
  it('sends each notification’s email once, with its link and no case content', async () => {
    const { id: caseId } = await newCase();
    await createUserNotifications(database.db, environmentId, [
      notification(reviewer.user.id, caseId, 'assigned'),
      notification(reviewer.user.id, caseId, 'mentioned'),
      notification(reviewer.user.id, caseId, 'sla-breached'),
    ]);
    await queueCaseNotificationEmails(database.db, environmentId, [
      { userId: reviewer.user.id, caseId, kind: 'created' },
    ]);
    const mailer = createCapturingMailer();

    const first = await runCaseNotificationEmails(deps(mailer));
    const second = await runCaseNotificationEmails(deps(mailer));

    expect(first).toEqual({ sent: 4, skipped: 0, failed: 0 });
    expect(second).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(mailer.messages.map(({ to }) => to.address)).toEqual(
      Array.from({ length: 4 }, () => reviewer.email),
    );
    expect(new Set(mailer.messages.map(({ subject }) => subject)).size).toBe(4);
    for (const message of mailer.messages) {
      expect(message.text).toContain(`${URL}/cases/${caseId}`);
      expect(JSON.stringify(message)).not.toContain(CANARY);
    }
  });

  it('skips a user who cannot read the case, and a redacted case', async () => {
    const deactivated = await harness.operator(organization, { roles: ['reviewer'] });
    await database.db.execute(
      sql`update users set status = 'deactivated' where id = ${deactivated.user.id}`,
    );
    const roleless = await harness.operator(organization, { roles: [] });
    const visible = await newCase();
    const hidden = await newCase({ hiddenFrom: 'reviewer' });
    const redacted = await newCase();
    await database.db.execute(
      sql`update cases set redacted_at = now(), fields = null where id = ${redacted.id}`,
    );
    await createUserNotifications(database.db, environmentId, [
      notification(deactivated.user.id, visible.id, 'assigned'),
      notification(roleless.user.id, visible.id, 'assigned'),
      notification(reviewer.user.id, hidden.id, 'assigned'),
      notification(reviewer.user.id, redacted.id, 'assigned'),
    ]);
    const mailer = createCapturingMailer();

    expect(await runCaseNotificationEmails(deps(mailer))).toEqual({
      sent: 0,
      skipped: 4,
      failed: 0,
    });
    expect(mailer.messages).toEqual([]);
    expect(await runCaseNotificationEmails(deps(mailer))).toEqual({
      sent: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('says the same without a link when the console has no public URL', async () => {
    const { id: caseId } = await newCase();
    await createUserNotifications(database.db, environmentId, [
      notification(reviewer.user.id, caseId, 'assigned'),
    ]);
    const mailer = createCapturingMailer();

    await runCaseNotificationEmails(deps(mailer, null));

    expect(mailer.messages).toHaveLength(1);
    expect(mailer.messages[0]?.text).not.toContain('http');
    expect(mailer.messages[0]?.text).not.toContain(caseId);
  });

  it('sends nothing without an SMTP server, and empties the queue', async () => {
    const { id: caseId } = await newCase();
    await createUserNotifications(database.db, environmentId, [
      notification(reviewer.user.id, caseId, 'assigned'),
    ]);
    const unconfigured: Mailer & { messages: MailMessage[] } = {
      configured: false,
      messages: [],
      send(message) {
        this.messages.push(message);
        return Promise.resolve();
      },
    };

    await runCaseNotificationEmails(deps(unconfigured));
    const later = createCapturingMailer();
    await runCaseNotificationEmails(deps(later));

    expect(unconfigured.messages).toEqual([]);
    expect(later.messages).toEqual([]);
  });

  it('tries a failed send three times in all, a lease apart, then gives it up', async () => {
    const { id: caseId } = await newCase();
    await createUserNotifications(database.db, environmentId, [
      notification(reviewer.user.id, caseId, 'mentioned'),
    ]);
    const failing: Mailer = {
      configured: true,
      send: () => Promise.reject(new Error('synthetic SMTP refusal')),
    };
    const runs = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      runs.push(await runCaseNotificationEmails(deps(failing)));
      // Held by its lease until it lapses.
      runs.push(await runCaseNotificationEmails(deps(failing)));
      now = new Date(now.getTime() + 10 * 60_000);
    }
    const mailer = createCapturingMailer();
    await runCaseNotificationEmails(deps(mailer));

    expect(runs).toEqual([
      { sent: 0, skipped: 0, failed: 1 },
      { sent: 0, skipped: 0, failed: 0 },
      { sent: 0, skipped: 0, failed: 1 },
      { sent: 0, skipped: 0, failed: 0 },
      { sent: 0, skipped: 0, failed: 1 },
      { sent: 0, skipped: 0, failed: 0 },
    ]);
    expect(mailer.messages).toEqual([]);
  });
});

describe('the sender name (C169.8, K9-25)', () => {
  it('sends a case email from the environment’s mail-sender-name', async () => {
    const { id: caseId } = await newCase();
    await database.db.execute(sql`update environments
      set settings = settings || '{"mail-sender-name": "Synthetic Bank"}'::jsonb
      where id = ${environmentId}`);
    await queueCaseNotificationEmails(database.db, environmentId, [
      { userId: reviewer.user.id, caseId, kind: 'created' },
    ]);
    const mailer = createCapturingMailer();

    try {
      await runCaseNotificationEmails(deps(mailer));
    } finally {
      await database.db.execute(sql`update environments
        set settings = settings - 'mail-sender-name' where id = ${environmentId}`);
    }

    expect(mailer.messages.map(({ senderName }) => senderName)).toEqual(['Synthetic Bank']);
  });
});
