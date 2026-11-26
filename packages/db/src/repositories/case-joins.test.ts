/**
 * Workflow 8B Stage 1b, checkpoint (C) (orchestrator decision 5 after Workflow 8A): two 8A files reach
 * cases only through a stub in an 8B owner's file, so behaviour moves only when that owner fills it.
 * The stubs are replaced here by what an owner would write, and each 8A function must answer it.
 *
 * - `listWorkflowObjectsAfter` reads a case through `listCasesAfter` (C118.4, `api-cases`);
 * - `WORKFLOW_REFERENCE_KINDS` and `readWorkflowReferences` take the case kinds and their source from
 *   `case-references.ts` (C112.2, C121.6, `api-case-workflows`).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { caseTemplates } from '../tables/cases.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import {
  readWorkflowReferences,
  WORKFLOW_REFERENCE_KINDS,
  type WorkflowReferenceKind,
} from './workflow-versions.js';
import { listWorkflowObjectsAfter } from './workflow-schedules.js';

const FILLED = 'case_01M6FQZCV622MRCK2ZKC7F4HD9';

vi.mock('./cases.js', async (original) => ({
  ...(await original<typeof import('./cases.js')>()),
  listCasesAfter: vi.fn(() => Promise.resolve([FILLED])),
}));

vi.mock('./case-references.js', async (original) => ({
  ...(await original<typeof import('./case-references.js')>()),
  CASE_WORKFLOW_REFERENCE_KINDS: ['case-template'],
  caseReferenceSource: () => ({
    table: caseTemplates,
    active: eq(caseTemplates.status, 'active'),
  }),
}));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('the 8A joins of the db package', () => {
  it('read a case for the recurring trigger through api-cases’ stub', async () => {
    const { environment } = await createTestTenant(database.db);

    expect(
      await listWorkflowObjectsAfter(database.db, environment.id, 'case', {
        cursor: null,
        limit: 10,
      }),
    ).toEqual([FILLED]);
  });

  it('name a case kind as a reference, and read it from its owner’s source', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = testId('ctmpl');
    await database.client.query(
      `insert into case_templates (id, environment_id, name, key) values ($1, $2, 'Review', 'KYC')`,
      [id, environment.id],
    );
    const kind = 'case-template' as WorkflowReferenceKind;

    expect(WORKFLOW_REFERENCE_KINDS).toContain(kind);
    expect(await readWorkflowReferences(database.db, environment.id, kind, [id])).toEqual([
      { id, name: 'Review' },
    ]);
  });
});
