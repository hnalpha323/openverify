/**
 * C140.5, C146.3 (Workflow 8B, `api-case-workflows`): the dev seed's case side. It seeds a published
 * review template a case recipe and a contest route can name, with the default statuses and
 * resolutions and every kind a review holds; run again, it adds nothing. Every value is synthetic.
 */
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { getPublishedCaseTemplateVersion } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REVIEW_TEMPLATE_KEY, seedCaseWorkflows } from './case-workflows.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const templatesOf = async (environmentId: string) =>
  (
    await database.client.query<{ id: string; key: string; name: string; status: string }>(
      'select id, key, name, status from case_templates where environment_id = $1',
      [environmentId],
    )
  ).rows;

describe('seedCaseWorkflows (C140.5)', () => {
  it('seeds a published review template once', async () => {
    const tenant = await createTestTenant(database.db, { kind: 'sandbox' });
    const environmentId = tenant.environment.id;

    const seededBy = testId('usr');
    await seedCaseWorkflows(database.db, environmentId, seededBy);
    await seedCaseWorkflows(database.db, environmentId, seededBy);

    const templates = await templatesOf(environmentId);
    expect(templates).toEqual([
      expect.objectContaining({ key: REVIEW_TEMPLATE_KEY, name: 'Review', status: 'active' }),
    ]);
    const version = await getPublishedCaseTemplateVersion(
      database.db,
      environmentId,
      templates[0]?.id ?? '',
    );
    expect(version).toMatchObject({
      status: 'published',
      resolutions: ['Approved', 'Declined'],
      heldObjectTypes: expect.arrayContaining(['inquiry', 'report', 'account']) as unknown,
    });
    expect(version?.statuses.map((status) => (status as { key: string }).key)).toEqual([
      'open',
      'pending',
      'approved',
      'declined',
    ]);
  });
});
