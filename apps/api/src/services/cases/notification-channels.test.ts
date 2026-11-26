/**
 * K9-26 (Workflow 9D; C169.7, C134.4, K8-20): Phase 8's case notifications read each recipient's
 * notification preferences per kind, through the same reader as the webhook-failure alert
 * (`notificationPreferencesOf`): the console notification only when `console` is on, the link-only
 * email only when `email` is on, the defaults (`NOTIFICATION_PREFERENCE_DEFAULT`: console on, email
 * off) for a kind the user never set. One test per kind. Both writers of case notifications, `notify`
 * (`writes.ts`) and `notifyUser` (`queues/work.ts`), go through `notifyByPreferencesInTx`.
 *
 * Every value is synthetic.
 */
import { CASE_NOTIFICATION_KINDS, type CaseNotificationKind } from '@openverify/core';
import { setNotificationPreferences } from '@openverify/db';
import {
  createTestDatabase,
  seedCase,
  seedCaseTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  type DashboardHarness,
  type TestOrganization,
} from '../../routes/dashboard/dashboard.test-support.js';
import { notifyByPreferencesInTx } from './notification-channels.js';

let database: TestDatabase;
let harness: DashboardHarness;
let organization: TestOrganization;
let environmentId: string;
const AT = new Date('2026-11-07T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  harness = await createDashboardHarness(database);
  organization = await harness.organization();
  environmentId = organization.sandboxId;
}, 120_000);

afterAll(async () => {
  await harness.close();
  await database.close();
});

async function newCase() {
  const template = await seedCaseTemplate(database.db, environmentId);
  return seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
  });
}

/** Four reviewers: the defaults, email only, neither, and both, for `kind`. */
async function recipients(kind: CaseNotificationKind) {
  const made = [];
  for (const channels of [
    null,
    { console: false, email: true },
    { console: false, email: false },
    { console: true, email: true },
  ]) {
    const operator = await harness.operator(organization, { roles: ['reviewer'] });
    if (channels !== null) {
      await setNotificationPreferences(database.db, operator.user.id, { [kind]: channels }, AT);
    }
    made.push(operator.user.id);
  }
  return made as [string, string, string, string];
}

async function delivered(caseId: string) {
  const consoleRows = await database.db.execute(
    sql`select user_id from user_notifications where case_id = ${caseId} order by user_id`,
  );
  const emailRows = await database.db.execute(
    sql`select user_id from case_notification_emails where case_id = ${caseId} order by user_id`,
  );
  const ids = (result: unknown) =>
    (result as { rows: { user_id: string }[] }).rows.map((row) => row.user_id);
  return { console: ids(consoleRows), email: ids(emailRows) };
}

describe('case notifications follow each recipient’s preferences per kind (K9-26)', () => {
  it.each(CASE_NOTIFICATION_KINDS.map((kind) => [kind]))(
    '%s: the console notification only with console on, the email only with email on',
    async (kind) => {
      const [defaults, emailOnly, neither, both] = await recipients(kind);
      const { id: caseId } = await newCase();

      await database.db.transaction((tx) =>
        notifyByPreferencesInTx(tx, environmentId, caseId, kind, [
          defaults,
          emailOnly,
          neither,
          both,
        ]),
      );

      expect(await delivered(caseId)).toEqual({
        console: [defaults, both].sort(),
        email: [emailOnly, both].sort(),
      });
    },
  );

  it('reads a user’s preference for that kind only', async () => {
    const operator = await harness.operator(organization, { roles: ['reviewer'] });
    await setNotificationPreferences(
      database.db,
      operator.user.id,
      { mentioned: { console: false, email: true } },
      AT,
    );
    const { id: caseId } = await newCase();

    await database.db.transaction((tx) =>
      notifyByPreferencesInTx(tx, environmentId, caseId, 'assigned', [operator.user.id]),
    );

    expect(await delivered(caseId)).toEqual({ console: [operator.user.id], email: [] });
  });
});
