/**
 * C136.4, C143.5 (P25; Workflow 8B Stage 4): `blind-index:rebuild` recomputes the keys of every
 * unredacted case's searchable fields under the current key, after the transaction field keys; a
 * case whose keys are current is left alone, and a redacted case has none. Synthetic values.
 */
import { caseFieldValueKey, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBlindIndexRebuild } from '../../../scripts/blind-index-rebuild.js';
import { rebuildCaseFieldKeys } from './rebuild.js';

const KEY = new Uint8Array(32).fill(5);
const FIELDS = [
  { key: 'reference', label: 'Reference', type: 'string', config: { searchable: true } },
  { key: 'note', label: 'Note', type: 'string' },
];

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function caseWith(environmentId: string, key: string, redacted = false) {
  const template = await seedCaseTemplate(db, environmentId, { key });
  await db.execute(sql`update case_template_versions
    set field_schemas = ${JSON.stringify(FIELDS)}::jsonb where id = ${template.versionId}`);
  const made = await seedCase(db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
    fields: {
      reference: { type: 'string', value: 'synthetic-ref-1' },
      note: { type: 'string', value: 'synthetic-note' },
    },
  });
  await db.execute(sql`insert into case_field_keys (environment_id, case_id, field_key, value_key)
    values (${environmentId}, ${made.id}, 'reference', ${'0'.repeat(64)})`);
  if (redacted) {
    await db.execute(sql`delete from case_field_keys where case_id = ${made.id}`);
    await db.execute(sql`update cases set fields = null, redacted_at = now() where id = ${made.id}`);
  }
  return { id: made.id, templateId: template.id };
}

async function keysOf(caseId: string): Promise<{ field_key: string; value_key: string }[]> {
  const result = await database.client.query<{ field_key: string; value_key: string }>(
    'select field_key, value_key from case_field_keys where case_id = $1',
    [caseId],
  );
  return result.rows;
}

describe('rebuildCaseFieldKeys (C136.4, P25)', () => {
  it('rewrites a case’s searchable keys under the key, once, and leaves a redacted case alone', async () => {
    const { environment } = await createTestTenant(db);
    const live = await caseWith(environment.id, 'RB1');
    const gone = await caseWith(environment.id, 'RB2', true);

    const first = await rebuildCaseFieldKeys(db, KEY, { batchSize: 1 });
    const second = await rebuildCaseFieldKeys(db, KEY, { batchSize: 1 });

    expect(await keysOf(live.id)).toEqual([
      {
        field_key: 'reference',
        value_key: caseFieldValueKey(KEY, {
          environmentId: environment.id,
          caseTemplateId: live.templateId,
          fieldKey: 'reference',
          text: 'synthetic-ref-1',
        }),
      },
    ]);
    expect(await keysOf(gone.id)).toEqual([]);
    expect(first.updated).toBeGreaterThanOrEqual(1);
    expect(second.updated).toBe(0);
    expect(second.scanned).toBe(first.scanned);
  });

  it('runs in blind-index:rebuild after the transaction field keys, printing counts only', async () => {
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db,
      key: KEY,
      args: { batchSize: 10 },
      out: (line) => lines.push(line),
    });

    expect(result).toHaveProperty('cases.scanned');
    const transactions = lines.findIndex((line) => line.includes('transaction field keys'));
    expect(lines[transactions + 1]).toMatch(
      /^blind-index:rebuild: done: scanned \d+ case field keys, re-indexed \d+\.$/,
    );
  });
});
