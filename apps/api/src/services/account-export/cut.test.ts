/**
 * C253.2, C253.4, C253.5 (Workflow 11B, `dsar-export`): one export cut by the job on PGlite with a
 * fake store and in-memory storage: the manifest sealed under a new data key at the export's own key,
 * the row `ready` with its counts, life (`account-export-ttl-days`) and listed ids; an export no
 * longer pending skipped; past the item limit or on a read failure `failed` with its code and no
 * object; an export deleted while it was cut leaves no object. Synthetic values only.
 */
import { accountExportManifestSchema, newId } from '@openverify/contracts';
import { decryptBytes, type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../../jobs/testing.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../../storage/index.js';
import { fixedClock, type TestClock } from '../../test-support/fakes.js';
import { PII_MARKER, seedPiiSubject, type SeededPiiSubject } from '../redaction.test-support.js';
import { collectAccountExport } from './collect.js';
import {
  cutAccountExport,
  type AccountExportCompletion,
  type AccountExportJobStore,
  type CutAccountExportDeps,
} from './cut.js';
import { manifestStorageKey, type AccountExportRow } from './service.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let subject: SeededPiiSubject;
let storage: InMemoryFileStorage;
let clock: TestClock;
let rows: Map<string, AccountExportRow>;
let completions: Map<string, AccountExportCompletion>;
let logger: ReturnType<typeof createCapturingLogger>;

const T0 = new Date('2026-11-13T12:00:00.000Z');

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { environment } = await createTestTenant(db);
  environmentId = environment.id;
  storage = createInMemoryFileStorage();
  subject = await seedPiiSubject({ db, storage, keyring: database.keyring, environmentId });
  clock = fixedClock(T0);
  rows = new Map();
  completions = new Map();
  logger = createCapturingLogger();
});

const store: AccountExportJobStore = {
  claimExport: (_tx, environment, id) => {
    const row = rows.get(id);
    return Promise.resolve(
      row?.environmentId === environment && row.status === 'pending' ? row : null,
    );
  },
  completeExport: (_tx, _environment, id, completion) => {
    const row = rows.get(id);
    if (row?.status !== 'pending') {
      return Promise.resolve(null);
    }
    completions.set(id, completion);
    const ready: AccountExportRow = {
      ...row,
      status: 'ready',
      readyAt: completion.readyAt,
      expiresAt: completion.expiresAt,
      itemCount: completion.itemCount,
      byteCount: completion.byteCount,
      storageKey: completion.storageKey,
      wrappedDek: completion.wrappedDek,
    };
    rows.set(id, ready);
    return Promise.resolve(ready);
  },
  failExport: (_tx, _environment, id, code) => {
    const row = rows.get(id);
    if (row !== undefined) {
      rows.set(id, { ...row, status: 'failed', errorCode: code });
    }
    return Promise.resolve();
  },
};

function pending(): string {
  const id = newId('aexp');
  rows.set(id, {
    id,
    environmentId,
    accountId: subject.accountId,
    status: 'pending',
    createdAt: T0,
    readyAt: null,
    expiresAt: null,
    itemCount: null,
    byteCount: null,
    errorCode: null,
    storageKey: null,
    wrappedDek: null,
  });
  return id;
}

const deps = (overrides: Partial<CutAccountExportDeps> = {}): CutAccountExportDeps => ({
  db,
  clock,
  logger,
  storage,
  keyring: database.keyring,
  store,
  ...overrides,
});

describe('cutAccountExport (C253.2)', () => {
  it('seals the manifest at the export’s key and marks the export ready with its counts and ids', async () => {
    const id = pending();
    const before = new Set(storage.keys());

    await expect(cutAccountExport(deps(), environmentId, id)).resolves.toMatchObject({
      outcome: 'ready',
    });

    const key = manifestStorageKey(environmentId, id);
    expect(storage.keys().filter((stored) => !before.has(stored))).toEqual([key]);
    const row = rows.get(id);
    expect(row).toMatchObject({ status: 'ready', storageKey: key, readyAt: T0 });
    expect(row?.expiresAt).toEqual(new Date(T0.getTime() + 7 * 86_400_000));
    const ciphertext = await storage.get(key);
    expect(Buffer.from(ciphertext ?? []).toString('utf8')).not.toContain(PII_MARKER);
    const manifest = accountExportManifestSchema.parse(
      JSON.parse(
        decryptBytes(
          { wrappedDek: row?.wrappedDek ?? '', ciphertext: ciphertext ?? Buffer.alloc(0) },
          database.keyring,
          {
            context: id,
          },
        ).toString('utf8'),
      ),
    );
    expect(manifest).toMatchObject({ 'export-id': id, 'account-id': subject.accountId });
    expect(JSON.stringify(manifest)).toContain(PII_MARKER);
    const completion = completions.get(id);
    expect(completion?.itemCount).toBe(manifest['item-count']);
    const filesSize = manifest.files.reduce((sum, file) => sum + file.size, 0);
    expect(completion?.byteCount).toBe(
      Buffer.byteLength(JSON.stringify(manifest), 'utf8') + filesSize,
    );
    expect(completion?.itemIds).toEqual(
      expect.arrayContaining([subject.accountId, subject.inquiryId]),
    );
    for (const fileId of subject.fileIds) {
      expect(completion?.itemIds).toContain(fileId);
    }
  });

  it('keeps an export for the environment’s account-export-ttl-days', async () => {
    await db.execute(sql`update environments
      set settings = settings || '{"account-export-ttl-days": 3}'::jsonb where id = ${environmentId}`);
    const id = pending();
    await cutAccountExport(deps(), environmentId, id);
    expect(rows.get(id)?.expiresAt).toEqual(new Date(T0.getTime() + 3 * 86_400_000));
  });

  it('skips an export that is not pending (claimed, finished or gone)', async () => {
    const id = pending();
    const row = rows.get(id);
    if (row !== undefined) {
      rows.set(id, { ...row, status: 'ready' });
    }
    const before = storage.keys().length;
    await expect(cutAccountExport(deps(), environmentId, id)).resolves.toEqual({
      outcome: 'skipped',
    });
    expect(storage.keys()).toHaveLength(before);
  });

  it('fails an account past the item limit with account_export_too_large and stores nothing (C253.5)', async () => {
    const id = pending();
    const collected = await collectAccountExport({ db, clock }, environmentId, subject.accountId);
    const before = storage.keys().length;
    const outcome = await cutAccountExport(
      deps({
        collect: () =>
          Promise.resolve({
            ...collected,
            inquiries: Array.from({ length: 5000 }, (_, index) => ({
              type: 'inquiry',
              id: `inq_${String(index)}`,
              attributes: {},
            })),
          }),
      }),
      environmentId,
      id,
    );
    expect(outcome).toEqual({ outcome: 'failed', code: 'account_export_too_large' });
    expect(rows.get(id)).toMatchObject({ status: 'failed', errorCode: 'account_export_too_large' });
    expect(storage.keys()).toHaveLength(before);
    // C250.7: counted by its registered metric, the environment the only label.
    expect(logger.entries.filter((entry) => entry.message === 'metric')).toEqual([
      {
        level: 'info',
        object: { metric: 'account_export_refused_too_large', value: 1, environmentId },
        message: 'metric',
      },
    ]);
  });

  it('fails a read it cannot finish with account_export_unavailable, logging no value', async () => {
    const id = pending();
    const outcome = await cutAccountExport(
      deps({ collect: () => Promise.reject(new Error(`boom ${PII_MARKER}`)) }),
      environmentId,
      id,
    );
    expect(outcome).toEqual({ outcome: 'failed', code: 'account_export_unavailable' });
    expect(rows.get(id)?.status).toBe('failed');
    expect(JSON.stringify(logger.entries)).not.toContain(PII_MARKER);
  });

  it('deletes the manifest it stored when the export was deleted meanwhile (C253.4)', async () => {
    const id = pending();
    const before = new Set(storage.keys());
    const outcome = await cutAccountExport(
      deps({
        store: {
          ...store,
          completeExport: () => {
            rows.delete(id);
            return Promise.resolve(null);
          },
        },
      }),
      environmentId,
      id,
    );
    expect(outcome).toEqual({ outcome: 'skipped' });
    expect(storage.keys().filter((key) => !before.has(key))).toEqual([]);
  });

  it('deletes the stored manifest and fails the export unavailable when its row cannot be written (KP10-54)', async () => {
    const id = pending();
    const before = new Set(storage.keys());
    const outcome = await cutAccountExport(
      deps({
        store: {
          ...store,
          completeExport: () => Promise.reject(new Error(`synthetic write failure ${PII_MARKER}`)),
        },
      }),
      environmentId,
      id,
    );
    // Never left pending (one pending export per account would refuse every later one) and no
    // object without a row that names its key.
    expect(outcome).toEqual({ outcome: 'failed', code: 'account_export_unavailable' });
    expect(rows.get(id)).toMatchObject({
      status: 'failed',
      errorCode: 'account_export_unavailable',
    });
    expect(storage.keys().filter((key) => !before.has(key))).toEqual([]);
    expect(JSON.stringify(logger.entries)).not.toContain(PII_MARKER);
  });
});
