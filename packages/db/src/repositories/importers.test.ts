/**
 * C100 (Workflow 7B): the importer rows, the sealed staging table, the error table and the object
 * purge. Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { importRowKey } from '../schema.js';
import { openValue, type Sealed } from '../sealed.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  seedImporter,
  seedList,
  seedListImportRow,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { SEALED } from '../encrypted-columns.js';
import {
  beginImportAttempt,
  completeImporter,
  createImporter,
  findRecentImporter,
  getImporter,
  getImportList,
  listImporterErrors,
  listImporters,
  listImportObjectsDue,
  listPendingImporters,
  listStagedImportRows,
  lockImportFile,
  lockPendingImporter,
  markImportersEnqueued,
  markImportObjectDeleted,
  recordImportErrors,
  recordImportFailure,
  stageImportRows,
  type NewImporter,
} from './importers.js';

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function newImporter(listId: string, overrides: Partial<NewImporter> = {}): NewImporter {
  return {
    id: testId('mprt'),
    listId,
    mode: 'all-or-nothing',
    encoding: 'utf-8',
    fileSha256: createHash('sha256').update(randomBytes(8)).digest('hex'),
    fileBytes: 12,
    storageKey: `imports/${randomBytes(4).toString('hex')}`,
    wrappedDek: 'ov1.test.synthetic',
    ...overrides,
  };
}

const OUTCOME = {
  status: 'ready',
  rowCount: 3,
  successfulCount: 2,
  duplicateCount: 1,
  alreadyPresentCount: 0,
  errorCount: 0,
  at: new Date('2026-10-20T00:00:00.000Z'),
} as const;

describe('createImporter and its reads', () => {
  it('writes a pending row and reads it with the kind of its list', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id, { kind: 'email-address' });
    const input = newImporter(list.id, { mode: 'skip-invalid', encoding: 'windows-1252' });

    const created = await createImporter(database.db, environment.id, input);

    expect(created).toMatchObject({
      id: input.id,
      status: 'pending',
      mode: 'skip-invalid',
      encoding: 'windows-1252',
      fileSha256: input.fileSha256,
      rowCount: 0,
      completedAt: null,
    });
    expect(await getImporter(database.db, environment.id, input.id)).toMatchObject({
      id: input.id,
      kind: 'email-address',
    });
  });

  it('keeps importers apart by environment', async () => {
    const one = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const list = await seedList(database.db, one.environment.id);
    const importer = await createImporter(database.db, one.environment.id, newImporter(list.id));

    expect(await getImporter(database.db, other.environment.id, importer.id)).toBeNull();
    expect(await getImportList(database.db, other.environment.id, list.id)).toBeNull();
  });

  it('lists newest first, ties by id, with the filters and the kind', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const emails = await seedList(database.db, environment.id, { kind: 'email-address' });
    const strings = await seedList(database.db, environment.id, { kind: 'string' });
    const clock = createdAtClock(database.db);
    const first = await createImporter(database.db, environment.id, newImporter(emails.id));
    await clock.at('importers', first.id);
    const second = await createImporter(database.db, environment.id, newImporter(strings.id));
    await clock.at('importers', second.id);
    const third = await createImporter(database.db, environment.id, newImporter(strings.id));
    await completeImporter(database.db, environment.id, third.id, OUTCOME);
    await clock.at('importers', third.id);

    const page = await listImporters(database.db, environment.id, {}, { size: 2 });
    expect(page.items.map(({ id, kind }) => [id, kind])).toEqual([
      [third.id, 'string'],
      [second.id, 'string'],
    ]);
    expect(page.next).toBe(second.id);
    const rest = await listImporters(
      database.db,
      environment.id,
      {},
      { size: 2, after: page.next ?? undefined },
    );
    expect(rest.items.map(({ id, kind }) => [id, kind])).toEqual([[first.id, 'email-address']]);
    expect(rest.next).toBeNull();

    const filtered = await listImporters(
      database.db,
      environment.id,
      { listIds: [strings.id], statuses: ['pending'] },
      { size: 10 },
    );
    expect(filtered.items.map(({ id }) => id)).toEqual([second.id]);
  });
});

describe('getImportList', () => {
  it('reads the members the normalisers need', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id, {
      kind: 'field',
      fieldKey: 'synthetic-field',
      status: 'archived',
    });

    expect(await getImportList(database.db, environment.id, list.id)).toEqual({
      id: list.id,
      kind: 'field',
      status: 'archived',
      fieldKey: 'synthetic-field',
      caseSensitive: false,
      defaultRegion: null,
    });
  });
});

describe('findRecentImporter (C100.5)', () => {
  it('finds the same list, mode, encoding and SHA-256 since the instant, newest first', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const input = newImporter(list.id);
    const clock = createdAtClock(database.db);
    const older = await createImporter(database.db, environment.id, input);
    const olderAt = await clock.at('importers', older.id);
    const newer = await createImporter(database.db, environment.id, {
      ...input,
      id: testId('mprt'),
      storageKey: 'imports/newer',
    });
    const newerAt = await clock.at('importers', newer.id);

    const find = (overrides: Partial<Parameters<typeof findRecentImporter>[2]> = {}) =>
      findRecentImporter(database.db, environment.id, {
        listId: list.id,
        mode: input.mode,
        encoding: input.encoding,
        fileSha256: input.fileSha256,
        since: olderAt,
        ...overrides,
      });

    expect((await find())?.id).toBe(newer.id);
    expect(await find({ mode: 'skip-invalid' })).toBeNull();
    expect(await find({ encoding: 'windows-1252' })).toBeNull();
    expect(await find({ fileSha256: 'a'.repeat(64) })).toBeNull();
    expect(await find({ since: new Date(newerAt.getTime() + 1) })).toBeNull();
  });

  it('skips an import that ended with no verdict on the file, so a retry can run', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const input = newImporter(list.id);
    const importer = await createImporter(database.db, environment.id, input);
    const find = () =>
      findRecentImporter(database.db, environment.id, {
        listId: list.id,
        mode: input.mode,
        encoding: input.encoding,
        fileSha256: input.fileSha256,
        since: new Date(0),
      });
    await completeImporter(database.db, environment.id, importer.id, {
      ...OUTCOME,
      status: 'errored',
      successfulCount: 0,
      lastErrorCode: 'attempts_exhausted',
    });
    expect(await find()).toBeNull();

    const refused = await createImporter(database.db, environment.id, {
      ...input,
      id: testId('mprt'),
    });
    await completeImporter(database.db, environment.id, refused.id, {
      ...OUTCOME,
      status: 'errored',
      successfulCount: 0,
      errorCount: 1,
    });
    expect((await find())?.id).toBe(refused.id);
  });
});

describe('lockImportFile (C100.5)', () => {
  it('takes a transaction lock', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);

    await database.db.transaction(async (tx) => {
      await lockImportFile(tx, environment.id, {
        listId: list.id,
        mode: 'all-or-nothing',
        encoding: 'utf-8',
        fileSha256: 'a'.repeat(64),
      });
      const held = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from pg_locks where locktype = 'advisory'`,
      );
      expect(held.rows[0]?.count).toBeGreaterThan(0);
    });
  });
});

describe('the sweep reads (C100.2)', () => {
  it('lists pending imports never enqueued or enqueued too long ago, oldest first', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const clock = createdAtClock(database.db, new Date('2026-10-20T00:00:00.000Z'));
    const fresh = await createImporter(database.db, environment.id, newImporter(list.id));
    await clock.at('importers', fresh.id);
    const lost = await createImporter(database.db, environment.id, newImporter(list.id));
    await clock.at('importers', lost.id);
    const waiting = await createImporter(database.db, environment.id, newImporter(list.id));
    await clock.at('importers', waiting.id);
    const finished = await createImporter(database.db, environment.id, newImporter(list.id));
    await completeImporter(database.db, environment.id, finished.id, OUTCOME);

    const at = new Date('2026-10-21T00:00:00.000Z');
    await markImportersEnqueued(
      database.db,
      [{ environmentId: environment.id, id: lost.id }],
      new Date(at.getTime() - 10 * 60_000),
    );
    await markImportersEnqueued(
      database.db,
      [{ environmentId: environment.id, id: waiting.id }],
      at,
    );

    const rows = await listPendingImporters(database.db, {
      olderThan: new Date(at.getTime() - 60_000),
      limit: 10,
    });
    const mine = rows.filter((row) => row.environmentId === environment.id).map(({ id }) => id);
    expect(mine).toEqual([fresh.id, lost.id]);

    const limited = await listPendingImporters(database.db, {
      olderThan: new Date(at.getTime() - 60_000),
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });

  it('marks nothing for an empty batch', async () => {
    await expect(markImportersEnqueued(database.db, [], new Date())).resolves.toBeUndefined();
  });
});

describe('a run of the job', () => {
  it('counts the attempt outside the transaction, and stops counting once it ended', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));

    await expect(
      database.db.transaction(async (tx) => {
        await lockPendingImporter(tx, environment.id, importer.id);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect((await beginImportAttempt(database.db, environment.id, importer.id))?.attempts).toBe(1);
    expect((await beginImportAttempt(database.db, environment.id, importer.id))?.attempts).toBe(2);

    await completeImporter(database.db, environment.id, importer.id, OUTCOME);
    expect(await beginImportAttempt(database.db, environment.id, importer.id)).toBeNull();
    expect(await beginImportAttempt(database.db, environment.id, testId('mprt'))).toBeNull();
  });

  it('locks a pending row, and answers null once it ended', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));

    await database.db.transaction(async (tx) => {
      expect((await lockPendingImporter(tx, environment.id, importer.id))?.id).toBe(importer.id);
    });
    await completeImporter(database.db, environment.id, importer.id, OUTCOME);
    await database.db.transaction(async (tx) => {
      expect(await lockPendingImporter(tx, environment.id, importer.id)).toBeNull();
    });
  });

  it('records a failure by its code', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));

    await recordImportFailure(database.db, environment.id, importer.id, 'import_failed');

    expect(await getImporter(database.db, environment.id, importer.id)).toMatchObject({
      status: 'pending',
      lastErrorCode: 'import_failed',
    });
  });
});

describe('the staging table (C100.2, P18)', () => {
  it('seals each row for its importer and row, and opens them in file order', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));
    const value = { value: 'synthetic-row-value' };

    await stageImportRows(database.db, environment.id, importer.id, [
      { row: 4, value: { value: 'later' }, matchKey: 'b'.repeat(64) },
      { row: 2, value, matchKey: 'a'.repeat(64) },
    ]);

    const raw = await database.db.execute<{ value: Sealed; row: number }>(
      sql`select value, row from list_import_rows where importer_id = ${importer.id} order by row`,
    );
    const sealed = raw.rows[0]?.value ?? ('' as Sealed);
    expect(sealed).not.toContain('synthetic-row-value');
    expect(
      JSON.parse(openValue(SEALED.listImportRowValue, importRowKey(importer.id, 2), sealed)),
    ).toEqual(value);
    expect(() =>
      openValue(SEALED.listImportRowValue, importRowKey(importer.id, 3), sealed),
    ).toThrow();

    expect(
      await listStagedImportRows(database.db, environment.id, importer.id, {
        afterRow: 0,
        limit: 10,
      }),
    ).toEqual([
      { row: 2, value, matchKey: 'a'.repeat(64) },
      { row: 4, value: { value: 'later' }, matchKey: 'b'.repeat(64) },
    ]);
    expect(
      await listStagedImportRows(database.db, environment.id, importer.id, {
        afterRow: 2,
        limit: 10,
      }),
    ).toEqual([{ row: 4, value: { value: 'later' }, matchKey: 'b'.repeat(64) }]);
    expect(
      await listStagedImportRows(database.db, environment.id, importer.id, {
        afterRow: 0,
        limit: 1,
      }),
    ).toHaveLength(1);
  });

  it('stages nothing for an empty batch', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));

    await expect(
      stageImportRows(database.db, environment.id, importer.id, []),
    ).resolves.toBeUndefined();
  });

  it('reads no row of another environment', async () => {
    const one = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const list = await seedList(database.db, one.environment.id);
    const importer = await createImporter(database.db, one.environment.id, newImporter(list.id));
    await seedListImportRow(database.db, one.environment.id, {
      importerId: importer.id,
      row: 2,
      value: { value: 'x' },
    });

    expect(
      await listStagedImportRows(database.db, other.environment.id, importer.id, {
        afterRow: 0,
        limit: 10,
      }),
    ).toEqual([]);
  });
});

describe('the error table (C100.1, F12)', () => {
  it('serves whole-file errors first, then rows after the cursor', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));

    await recordImportErrors(database.db, environment.id, importer.id, [
      { row: 9, column: 'value', code: 'invalid_value' },
      { row: 3, column: null, code: 'field_count_mismatch' },
      { row: null, column: 'value', code: 'missing_column' },
      { row: null, column: null, code: 'unknown_column' },
    ]);

    expect(
      await listImporterErrors(database.db, environment.id, importer.id, {
        afterRow: 0,
        limit: 1,
      }),
    ).toEqual([
      { row: null, column: 'value', code: 'missing_column' },
      { row: null, column: null, code: 'unknown_column' },
      { row: 3, column: null, code: 'field_count_mismatch' },
    ]);
    expect(
      await listImporterErrors(database.db, environment.id, importer.id, {
        afterRow: 3,
        limit: 10,
      }),
    ).toEqual([{ row: 9, column: 'value', code: 'invalid_value' }]);
  });

  it('keeps at most 1,000 per import, across calls', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));
    const errors = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        row: from + index,
        column: null,
        code: 'invalid_value' as const,
      }));

    await recordImportErrors(database.db, environment.id, importer.id, errors(1, 990));
    await recordImportErrors(database.db, environment.id, importer.id, errors(1000, 20));
    await recordImportErrors(database.db, environment.id, importer.id, errors(2000, 5));

    const stored = await database.db.execute<{ count: number; last: number }>(
      sql`select count(*)::int as count, max(row)::int as last from list_import_errors
          where importer_id = ${importer.id}`,
    );
    expect(stored.rows[0]).toEqual({ count: 1000, last: 1009 });
  });

  it('records nothing for an empty batch', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));

    await expect(
      recordImportErrors(database.db, environment.id, importer.id, []),
    ).resolves.toBeUndefined();
  });
});

describe('completeImporter (C100.2)', () => {
  it('ends the import and deletes its staged rows in one call', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));
    await seedListImportRow(database.db, environment.id, {
      importerId: importer.id,
      row: 2,
      value: { value: 'x' },
    });

    const ended = await completeImporter(database.db, environment.id, importer.id, OUTCOME);

    expect(ended).toMatchObject({
      status: 'ready',
      rowCount: 3,
      successfulCount: 2,
      duplicateCount: 1,
      alreadyPresentCount: 0,
      errorCount: 0,
      completedAt: OUTCOME.at,
      lastErrorCode: null,
    });
    const rows = await database.db.execute<{ count: number }>(
      sql`select count(*)::int as count from list_import_rows where importer_id = ${importer.id}`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });

  it('keeps the code of an import that ended with no verdict', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));

    const ended = await completeImporter(database.db, environment.id, importer.id, {
      ...OUTCOME,
      status: 'errored',
      lastErrorCode: 'object_missing',
    });

    expect(ended).toMatchObject({ status: 'errored', lastErrorCode: 'object_missing' });
  });

  it('never moves an import that already ended', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const importer = await createImporter(database.db, environment.id, newImporter(list.id));
    await completeImporter(database.db, environment.id, importer.id, OUTCOME);

    expect(
      await completeImporter(database.db, environment.id, importer.id, {
        ...OUTCOME,
        status: 'errored',
      }),
    ).toBeNull();
    expect(await getImporter(database.db, environment.id, importer.id)).toMatchObject({
      status: 'ready',
    });
  });
});

describe('the object purge (C100.2)', () => {
  const endedAt = new Date('2026-10-01T00:00:00.000Z');

  it('finds an object 7 days after the import ended, not before, whatever the outcome', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const ready = await createImporter(database.db, environment.id, newImporter(list.id));
    await completeImporter(database.db, environment.id, ready.id, { ...OUTCOME, at: endedAt });
    const errored = await createImporter(database.db, environment.id, newImporter(list.id));
    await completeImporter(database.db, environment.id, errored.id, {
      ...OUTCOME,
      status: 'errored',
      at: endedAt,
    });
    await createImporter(database.db, environment.id, newImporter(list.id));

    const due = async (now: Date) =>
      (await listImportObjectsDue(database.db, { now }))
        .filter((row) => row.environmentId === environment.id)
        .map(({ id }) => id)
        .sort();

    expect(await due(new Date(endedAt.getTime() + 7 * DAY - 1))).toEqual([]);
    expect(await due(new Date(endedAt.getTime() + 7 * DAY))).toEqual([ready.id, errored.id].sort());
  });

  it('holds no object past a shorter item retention of its list (P08)', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id, { itemRetentionDays: 2 });
    const long = await seedList(database.db, environment.id, { itemRetentionDays: 30 });
    const short = await createImporter(database.db, environment.id, newImporter(list.id));
    await completeImporter(database.db, environment.id, short.id, { ...OUTCOME, at: endedAt });
    const kept = await createImporter(database.db, environment.id, newImporter(long.id));
    await completeImporter(database.db, environment.id, kept.id, { ...OUTCOME, at: endedAt });

    const due = await listImportObjectsDue(database.db, {
      now: new Date(endedAt.getTime() + 2 * DAY),
    });

    expect(due.filter((row) => row.environmentId === environment.id).map(({ id }) => id)).toEqual([
      short.id,
    ]);
  });

  it('answers at most the batch, oldest first, each row with its key', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const first = await createImporter(database.db, environment.id, newImporter(list.id));
    await completeImporter(database.db, environment.id, first.id, {
      ...OUTCOME,
      at: new Date('2026-01-01T00:00:00.000Z'),
    });
    const second = await createImporter(database.db, environment.id, newImporter(list.id));
    await completeImporter(database.db, environment.id, second.id, {
      ...OUTCOME,
      at: new Date('2026-01-02T00:00:00.000Z'),
    });

    expect(
      await listImportObjectsDue(database.db, {
        now: new Date('2026-02-01T00:00:00.000Z'),
        limit: 1,
      }),
    ).toEqual([{ id: first.id, environmentId: environment.id, storageKey: first.storageKey }]);
    await markImportObjectDeleted(database.db, environment.id, first.id, endedAt);
    await markImportObjectDeleted(database.db, environment.id, second.id, endedAt);
  });

  it('nulls the key and the wrapped DEK, so the row is not found again', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await seedList(database.db, environment.id);
    const seeded = await seedImporter(database.db, environment.id, { listId: list.id });
    await completeImporter(database.db, environment.id, seeded.id, { ...OUTCOME, at: endedAt });

    await markImportObjectDeleted(database.db, environment.id, seeded.id, endedAt);

    expect(await getImporter(database.db, environment.id, seeded.id)).toMatchObject({
      storageKey: null,
      wrappedDek: null,
      objectDeletedAt: endedAt,
    });
    const due = await listImportObjectsDue(database.db, { now: new Date('2027-01-01') });
    expect(due.map(({ id }) => id)).not.toContain(seeded.id);
  });
});
