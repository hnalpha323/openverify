/**
 * C134.4 (Workflow 8B Stage 3, `api-cases`): the dashboard's notifications, behind the operator's
 * session: the user's own, newest first, unread when asked, marked read once, and a notification of
 * a case whose template the user may not see left out (C129.4). Another user's is not found.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createUserNotifications } from '@openverify/db';
import {
  createTestDatabase,
  seedCase,
  seedCaseTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  type DashboardHarness,
} from '../../routes/dashboard/dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

describe('the dashboard notifications (C134.4)', () => {
  it('serve the user’s own, unread when asked, mark read once, and leave out a hidden case’s', async () => {
    const api = await createDashboardHarness(database);
    harnesses.push(api);
    const organization = await api.organization();
    const environmentId = organization.sandboxId;
    const reviewer = await api.operator(organization, { roles: ['reviewer'] });
    const other = await api.operator(organization, { roles: ['reviewer'] });
    const db = database.db;
    const open = await seedCaseTemplate(db, environmentId);
    const hidden = await seedCaseTemplate(db, environmentId);
    await db.execute(sql`update case_templates set visible_to_roles = ${`{${organization.roleIds.admin}}`}::text[]
      where id = ${hidden.id}`);
    const seen = await seedCase(db, environmentId, {
      caseTemplateId: open.id,
      caseTemplateVersionId: open.versionId,
      key: open.key,
      number: 1,
    });
    const unseen = await seedCase(db, environmentId, {
      caseTemplateId: hidden.id,
      caseTemplateVersionId: hidden.versionId,
      key: hidden.key,
      number: 1,
    });
    const [first] = await createUserNotifications(db, environmentId, [
      { id: newId('unot'), userId: reviewer.user.id, kind: 'assigned', caseId: seen.id },
      { id: newId('unot'), userId: reviewer.user.id, kind: 'mentioned', caseId: unseen.id },
    ]);
    const token = await api.signIn(reviewer.email);

    const listed = await api.call('GET', '/notifications', { token });
    expect(listed.statusCode, listed.body).toBe(200);
    const all = JSON.parse(listed.body) as { data: { id: string }[] };
    expect(all.data.map(({ id }) => id)).toEqual([first?.id]);

    const read = await api.call('POST', `/notifications/${first?.id ?? ''}/read`, {
      token,
      payload: { meta: {} },
    });
    expect(read.statusCode, read.body).toBe(200);
    const unread = JSON.parse(
      (await api.call('GET', '/notifications?filter[unread]=true', { token })).body,
    ) as { data: unknown[] };
    expect(unread.data).toEqual([]);

    const foreign = await api.call('POST', `/notifications/${first?.id ?? ''}/read`, {
      token: await api.signIn(other.email),
      payload: { meta: {} },
    });
    expect(foreign.statusCode).toBe(404);
    expect(
      (
        await api.call('POST', `/notifications/${testId('unot')}/read`, {
          token,
          payload: { meta: {} },
        })
      ).statusCode,
    ).toBe(404);
  });
});
