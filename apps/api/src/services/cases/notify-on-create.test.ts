/**
 * K8-20 (Workflow 8D; C130.2, P38): a case created on a version with `notify-on-create` queues a
 * link-only email (kind `created`) for each listed user of the organisation, in the creation's
 * transaction; a listed id that names no user of it queues nothing. The sweep sends them
 * (`jobs/cases/notification-emails.test.ts`). Every value is synthetic.
 */
import { createUser } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
}, 120_000);

afterAll(async () => {
  await api.close();
});

let calls = 0;
const call = (method: 'POST', url: string, payload: unknown) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(token), 'idempotency-key': `notify-on-create-${String(calls)}` },
    payload: payload as Record<string, unknown>,
  });
};

describe('notify-on-create (K8-20)', () => {
  it('queues a created email for each listed user of the organisation', async () => {
    const listed = testId('usr');
    await createUser(api.database.db, {
      id: listed,
      organizationId: api.organizationId,
      email: 'notify-on-create@example.org',
      passwordHash: '$argon2id$synthetic-hash',
      name: null,
    });
    const created = await call('POST', '/case-templates', {
      data: { attributes: { name: 'Synthetic notify', key: 'NOTE' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const template = JSON.parse(created.body) as {
      data: { id: string; relationships: Record<string, { data: { id: string } }> };
    };
    const versionId = template.data.relationships['draft-version']?.data.id ?? '';
    const published = await call('POST', `/case-template-versions/${versionId}/publish`, {
      meta: {},
    });
    expect(published.statusCode, published.body).toBe(200);
    await api.database.client.query(
      `update case_template_versions set notify_on_create = $2::text[] where id = $1`,
      [versionId, [listed, testId('usr')]],
    );

    const made = await call('POST', '/cases', {
      data: { attributes: { 'case-template-id': template.data.id } },
    });
    expect(made.statusCode, made.body).toBe(201);
    const caseId = (JSON.parse(made.body) as { data: { id: string } }).data.id;

    const queued = await api.database.client.query<{ user_id: string; kind: string }>(
      `select user_id, kind from case_notification_emails where case_id = $1`,
      [caseId],
    );
    expect(queued.rows).toEqual([{ user_id: listed, kind: 'created' }]);
  });
});
