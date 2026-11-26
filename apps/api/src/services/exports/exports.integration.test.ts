/**
 * C178.2 (Workflow 9B, `api-exports`): the exports job with masking and expiry on Postgres
 * (Testcontainers, `pgvector/pgvector:pg17`):
 *
 * - two jobs of one export race; the claim (`FOR UPDATE SKIP LOCKED`) lets one cut it, so one file
 *   is stored and the export is completed once;
 * - the file without personal data masks every `pii` column (the JSON keys kept), the one with it
 *   holds the values, and both are sealed (the stored bytes hold no value);
 * - the request is dropped once cut (the table's CHECK); after 24 hours the retention step deletes
 *   the file and the export reads `expired`, keeping its count and times.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { readCsv } from '@openverify/checks';
import {
  createDatabase,
  createExportRow,
  createKeyring,
  getExportRow,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
  testId,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExport, type ExportJobDeps } from '../../jobs/exports/export.js';
import { createWorkerLogger } from '../../jobs/logger.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { createRecordingEventPublisher } from '../../test-support/fakes.js';
import { openSealedObject } from '../cases/attachments/objects.js';
import { runExportRetention } from './retention.js';

const keyring = createKeyring(randomBytes(32));
const T0 = new Date('2026-11-06T12:00:00.000Z');

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let now = T0;
const clock = { now: () => now };
const storage = createInMemoryFileStorage();

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
  await createTestInquiry(db, environmentId, {
    referenceId: 'synthetic-integration-ref',
    fields: { 'name-first': 'Avery' },
  });
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const deps = (): ExportJobDeps => ({
  db,
  storage,
  keyring,
  events: createRecordingEventPublisher(),
  clock,
  logger: createWorkerLogger({ level: 'silent' }),
});

async function pendingExport(includePersonalData: boolean): Promise<string> {
  const id = testId('exp');
  await createExportRow(db, environmentId, {
    id,
    creator: { type: 'user', id: testId('usr') },
    objectType: 'inquiries',
    format: 'csv',
    includePersonalData,
    request: { filter: { 'filter[reference-id]': 'synthetic-integration-ref' }, blocklist: [] },
    filterKeys: ['filter[reference-id]'],
    savedViewId: null,
    at: now,
  });
  return id;
}

async function fileOf(id: string): Promise<{ text: string; ciphertext: string }> {
  const row = await getExportRow(db, environmentId, id);
  const storageKey = row?.storageKey ?? '';
  const ciphertext = Buffer.from((await storage.get(storageKey)) ?? new Uint8Array()).toString(
    'latin1',
  );
  const bytes = await openSealedObject(
    { storage, keyring },
    { storageKey, wrappedDek: row?.wrappedDek ?? '', context: id },
  );
  return { text: bytes.toString('utf8'), ciphertext };
}

const cells = (text: string) =>
  readCsv(Buffer.from(text), { maxRows: 10, maxRecordCharacters: 10_000 }).rows.map(
    (row) => row.cells,
  );

describe('the export job on Postgres (C178.2)', () => {
  it('cuts an export once when two jobs race, masking its personal columns', async () => {
    const id = await pendingExport(false);
    const before = storage.keys().length;

    await Promise.all([runExport(deps(), environmentId, id), runExport(deps(), environmentId, id)]);

    const row = await getExportRow(db, environmentId, id);
    expect(row).toMatchObject({ status: 'completed', rowCount: 1, request: null });
    expect(storage.keys().length - before).toBe(1);
    const { text, ciphertext } = await fileOf(id);
    const [only] = cells(text);
    expect(only?.['reference-id']).toBe('');
    expect(JSON.parse(only?.fields ?? '{}')).toEqual({ 'name-first': null });
    expect(ciphertext).not.toContain('synthetic-integration-ref');
  });

  it('holds the values with personal data, sealed, and expires the file after 24 hours', async () => {
    const id = await pendingExport(true);

    await runExport(deps(), environmentId, id);
    const { text, ciphertext } = await fileOf(id);
    const kept = (await getExportRow(db, environmentId, id))?.storageKey ?? '';
    now = new Date(T0.getTime() + 25 * 60 * 60 * 1000);
    const report = await runExportRetention({ db, storage }, { now, limit: 50 });

    expect(cells(text)[0]?.['reference-id']).toBe('synthetic-integration-ref');
    expect(ciphertext).not.toContain('synthetic-integration-ref');
    expect(report.expiredExports).toBeGreaterThanOrEqual(1);
    expect(await getExportRow(db, environmentId, id)).toMatchObject({
      status: 'expired',
      storageKey: null,
      wrappedDek: null,
      byteSize: null,
      rowCount: 1,
    });
    expect(await storage.get(kept)).toBeNull();
  });
});
