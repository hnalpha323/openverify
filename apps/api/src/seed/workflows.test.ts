/**
 * Workflow 8A Stage 3 (`api-actions`; C140.5): the dev seed installs each recipe without a case as a
 * disabled workflow with a draft, once, so a person publishes it after filling what it names. Synthetic.
 */
import { listWorkflows, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKFLOW_RECIPES } from '../workflows/recipes/rows.js';
import { seedWorkflowRecipes } from './workflows.js';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('seedWorkflowRecipes (C140.5)', () => {
  it('installs every recipe paused, with a draft and nothing published', async () => {
    const { environment } = await createTestTenant(db);
    expect(await seedWorkflowRecipes(db, environment.id, testId('usr'))).toBe(
      WORKFLOW_RECIPES.list().length,
    );
    const { items } = await listWorkflows(db, environment.id, {}, { size: 100 });
    expect(items.map(({ name }) => name).sort()).toEqual(
      WORKFLOW_RECIPES.list()
        .map(({ name }) => name)
        .sort(),
    );
    for (const workflow of items) {
      expect(workflow).toMatchObject({ status: 'paused', latestPublishedVersionId: null });
      expect(workflow.draftVersionId).not.toBeNull();
    }
  });

  it('adds nothing the second time', async () => {
    const { environment } = await createTestTenant(db);
    await seedWorkflowRecipes(db, environment.id, testId('usr'));
    expect(await seedWorkflowRecipes(db, environment.id, testId('usr'))).toBe(0);
  });
});
