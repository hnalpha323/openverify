/**
 * C98.4, C100.2 (Workflow 7B Stage 1b (L)): the C16 pass runs the two list steps, item retention
 * (`redactExpiredListItems`, `api-lists`) and the importer objects' purge
 * (`purgeExpiredImportObjects`, `api-importers`), drains each batch by batch, and reports counts.
 * Both find nothing until built, so here they are replaced by recorded steps. Synthetic values.
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RedactionService } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { runRetention } from './retention.js';

const items = vi.hoisted(() => vi.fn<() => Promise<number>>());
const objects = vi.hoisted(() => vi.fn<() => Promise<number>>());

vi.mock('@openverify/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openverify/db')>()),
  redactExpiredListItems: items,
}));
vi.mock('./importers/purge.js', () => ({ purgeExpiredImportObjects: objects }));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('the list steps of the C16 pass', () => {
  it('drains both, batch by batch, and reports the counts', async () => {
    items.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValue(0);
    objects.mockResolvedValueOnce(3).mockResolvedValue(0);

    const report = await runRetention({
      db: database.db,
      storage: createInMemoryFileStorage(),
      redaction: {} as RedactionService,
      batchSize: 3,
    });

    expect(report.redactedListItems).toBe(4);
    expect(report.purgedImportObjects).toBe(3);
  });
});
