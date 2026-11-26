/**
 * C100.2 to C100.5, C100.7: the `list-import` job on PGlite, with `ListItemWriter`'s in-memory fake:
 * a clean file, both modes, the codes, the counts of the three kinds of repeat, the staged rows gone
 * whatever the outcome, and no value in any log, error or audit entry. Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  createImporter,
  encryptBytes,
  getImporter,
  listAuditLogs,
  listImporterErrors,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { IMPORT_LIMITS, type ImporterMode, type ListKind } from '@openverify/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListItemWriter } from '../../ports.js';
import {
  createFakeListItemWriter,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import { createCapturingLogger, createMemoryStorage } from '../testing.js';
import { IMPORT_MAX_ATTEMPTS, processListImport, type ListImportDeps } from './process.js';

const listUpdated = vi.hoisted(() => vi.fn());
vi.mock('../../workflows/actions/lists/list-updated.js', () => ({
  stageListUpdated: listUpdated,
}));

let database: TestDatabase;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  ({
    environment: { id: environmentId },
  } = await createTestTenant(database.db));
}, 120_000);

afterAll(async () => {
  await database.close();
});

const BLIND_INDEX_KEY = randomBytes(32);

function harness(overrides: Partial<ListImportDeps> = {}) {
  const writer = createFakeListItemWriter();
  const logger = createCapturingLogger();
  const storage = createMemoryStorage();
  const deps: ListImportDeps = {
    events: createRecordingEventPublisher(),
    db: database.db,
    clock: fixedClock(),
    logger,
    storage,
    keyring: database.keyring,
    blindIndexKey: BLIND_INDEX_KEY,
    writer,
    ...overrides,
  };
  return { deps, writer, logger, storage };
}

interface SeedOptions {
  kind?: ListKind;
  mode?: ImporterMode;
  encoding?: string;
  listId?: string;
  list?: Parameters<typeof seedList>[2];
}

/** A stored import of `content`, as the route leaves it: a pending row and its sealed object. */
async function seedImport(
  { storage }: Pick<ReturnType<typeof harness>, 'storage'>,
  content: string | Uint8Array,
  options: SeedOptions = {},
) {
  const listId =
    options.listId ??
    (
      await seedList(database.db, environmentId, {
        kind: options.kind ?? 'string',
        ...options.list,
      })
    ).id;
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const id = testId('mprt');
  const sealed = encryptBytes(bytes, database.keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createImporter(database.db, environmentId, {
    id,
    listId,
    mode: options.mode ?? 'all-or-nothing',
    encoding: options.encoding ?? 'utf-8',
    fileSha256: createHash('sha256').update(bytes).digest('hex'),
    fileBytes: bytes.byteLength,
    storageKey,
    wrappedDek: sealed.wrappedDek,
  });
  return { id, listId, storageKey };
}

const run = (deps: ListImportDeps, importerId: string) =>
  processListImport({ environmentId, importerId }, deps);

const stored = (id: string) => getImporter(database.db, environmentId, id);
const errorsOf = (id: string) =>
  listImporterErrors(database.db, environmentId, id, { afterRow: 0, limit: 2000 });

async function stagedRows(id: string): Promise<number> {
  const rows = await database.db.execute<{ count: number }>(
    sql`select count(*)::int as count from list_import_rows where importer_id = ${id}`,
  );
  return rows.rows[0]?.count ?? -1;
}

describe('list.updated (C127.12, F20)', () => {
  beforeEach(() => {
    listUpdated.mockReset().mockResolvedValue([]);
  });

  const updates = () => listUpdated.mock.calls.map((call) => call.slice(2) as unknown[]);

  it('comes once, when the import ends, however many batches it wrote', async () => {
    const test = harness();
    const rows = Array.from({ length: 2500 }, (_, index) => `v${String(index)}`);
    const { id, listId } = await seedImport(test, `value\n${rows.join('\n')}\n`);

    await run(test.deps, id);

    expect(updates()).toEqual([
      [environmentId, [{ listId, changeKind: 'items-added', items: 2500 }]],
    ]);
  });

  it('dispatches it after the commit', async () => {
    const test = harness();
    const staged = { eventId: 'evt_synthetic', deliveries: [] };
    listUpdated.mockResolvedValue([staged]);
    const dispatch = vi.spyOn(test.deps.events, 'dispatch');
    const { id } = await seedImport(test, 'value\nv1\n');

    await run(test.deps, id);

    expect(dispatch).toHaveBeenCalledWith([staged]);
  });

  it('stays quiet when nothing was written', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\n');

    await run(test.deps, id);

    expect(listUpdated).not.toHaveBeenCalled();
  });

  it('stays quiet when all-or-nothing rolled the rows back', async () => {
    const test = harness();
    test.writer.refusals = [{ index: 0, code: 'row_limit_exceeded' }];
    const { id } = await seedImport(test, 'value\nv1\n');

    await run(test.deps, id);

    expect((await stored(id))?.status).toBe('errored');
    expect(listUpdated).not.toHaveBeenCalled();
  });
});

describe('a clean file (C100.2)', () => {
  it.each<[ListKind, string, Record<string, unknown>, SeedOptions['list']?]>([
    ['browser-fingerprint', `value\n${'a'.repeat(64)}\n`, { value: 'a'.repeat(64) }],
    ['device-fingerprint', `value\n${'b'.repeat(64)}\n`, { value: 'b'.repeat(64) }],
    ['country', 'country_code\nDE\n', { 'country-code': 'DE' }],
    [
      'email-address',
      'value,match_type\njane@example.com,email_address\nexample.org,domain\n',
      { value: 'jane@example.com', 'match-type': 'email_address' },
    ],
    [
      'geolocation',
      'latitude,longitude,radius_meters\n48.5,2.25,1000\n',
      { latitude: 48.5, longitude: 2.25, 'radius-meters': 1000 },
    ],
    [
      'government-id-number',
      'id_number,id_class\nX1234567,passport\n',
      { 'id-number': 'X1234567', 'id-class': 'passport' },
    ],
    ['field', 'field_value\nsynthetic\n', { 'field-value': 'synthetic' }, { fieldKey: 'plan' }],
    ['ip-address', 'value\n192.0.2.1\n', { value: '192.0.2.1' }],
    [
      'name',
      'name_first,name_last\nJane,Example\n',
      { 'name-first': 'Jane', 'name-last': 'Example' },
    ],
    ['phone-number', 'value\n+12025550100\n', { value: '+12025550100' }],
    ['string', 'value\nsynthetic\n', { value: 'synthetic' }],
  ])('imports a %s row through the writer', async (kind, content, attributes, list) => {
    const test = harness();
    const { id, listId } = await seedImport(test, content, { kind, list });

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'ready' });

    const [first] = test.writer.written.get(listId) ?? [];
    expect(first).toEqual({ attributes, creator: { type: 'importer', id } });
    expect(await stored(id)).toMatchObject({
      status: 'ready',
      errorCount: 0,
      alreadyPresentCount: 0,
      duplicateCount: 0,
      completedAt: fixedClock().now(),
    });
  });

  it('counts every row: successful, repeated in the file, already in the list', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, 'value\nkept\nKEPT\nnew\nother\n');
    test.writer.written.set(listId, [
      { attributes: { value: 'other' }, creator: { type: 'importer', id: 'mprt_x' } },
    ]);

    await run(test.deps, id);

    expect(await stored(id)).toMatchObject({
      status: 'ready',
      rowCount: 4,
      successfulCount: 2,
      duplicateCount: 1,
      alreadyPresentCount: 1,
      errorCount: 0,
    });
  });

  it('reads the list’s own rules: a case-sensitive list keeps both spellings', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, 'value\nkept\nKEPT\n');
    await database.db.execute(sql`update lists set case_sensitive = true where id = ${listId}`);

    await run(test.deps, id);

    expect(await stored(id)).toMatchObject({ successfulCount: 2, duplicateCount: 0 });
  });

  it('reads a national phone number by the list’s default region', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, 'value\n(202) 555-0100\n', {
      kind: 'phone-number',
    });
    await database.db.execute(sql`update lists set default_region = 'US' where id = ${listId}`);

    await run(test.deps, id);

    expect(await stored(id)).toMatchObject({ status: 'ready', successfulCount: 1 });
  });

  it('strips the neutraliser of an exported cell once (C100.5)', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, `value\n'=formula\n`);

    await run(test.deps, id);

    expect(test.writer.written.get(listId)?.[0]?.attributes).toEqual({ value: '=formula' });
  });

  it('treats a header with no rows as a finished, empty import', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\n');

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'ready' });

    expect(await stored(id)).toMatchObject({ status: 'ready', rowCount: 0, successfulCount: 0 });
  });

  it('writes in batches, in file order, leaving nothing staged', async () => {
    const test = harness();
    const batches: number[] = [];
    const insertItems = test.writer.insertItems.bind(test.writer);
    test.writer.insertItems = (tx, input) => {
      batches.push(input.items.length);
      return insertItems(tx, input);
    };
    const rows = Array.from({ length: 2500 }, (_, index) => `v${String(index)}`);
    const { id, listId } = await seedImport(test, `value\n${rows.join('\n')}\n`);

    await run(test.deps, id);

    expect(batches).toEqual([1000, 1000, 500]);
    expect(test.writer.written.get(listId)?.at(-1)?.attributes).toEqual({ value: 'v2499' });
    expect(await stagedRows(id)).toBe(0);
  });

  it('holds staged rows sealed while the writer reads them', async () => {
    const test = harness();
    let raw: string[] = [];
    const writer: ListItemWriter = {
      async insertItems(tx) {
        const result: unknown = await tx.execute(
          sql`select value from list_import_rows order by id desc limit 1`,
        );
        raw = (result as { rows: { value: string }[] }).rows.map(({ value }) => value);
        return { inserted: [], alreadyPresent: 0, refused: [] };
      },
    };
    const { id } = await seedImport(test, 'value\nsentinel-staged-value\n');

    await run({ ...test.deps, writer }, id);

    expect(raw).toHaveLength(1);
    expect(raw[0]).not.toContain('sentinel-staged-value');
  });
});

describe('a row the normaliser refuses (C100.4)', () => {
  const FILE = 'value\n+12025550100\nnot a phone\n+12025550101\n';

  it('all-or-nothing: applies nothing and names the row and column', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, FILE, { kind: 'phone-number' });

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(test.writer.written.get(listId)).toBeUndefined();
    expect(await stored(id)).toMatchObject({
      status: 'errored',
      rowCount: 3,
      successfulCount: 0,
      errorCount: 1,
      lastErrorCode: null,
    });
    expect(await errorsOf(id)).toEqual([{ row: 3, column: 'value', code: 'unparseable_phone' }]);
    expect(await stagedRows(id)).toBe(0);
  });

  it('skip-invalid: applies the valid rows and records the rest', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, FILE, {
      kind: 'phone-number',
      mode: 'skip-invalid',
    });

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'ready' });

    expect(test.writer.written.get(listId)).toHaveLength(2);
    expect(await stored(id)).toMatchObject({
      status: 'ready',
      rowCount: 3,
      successfulCount: 2,
      errorCount: 1,
    });
    expect(await errorsOf(id)).toEqual([{ row: 3, column: 'value', code: 'unparseable_phone' }]);
  });

  it('skip-invalid: a file with no good row applied ends errored', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\nnot a phone\nnor this\n', {
      kind: 'phone-number',
      mode: 'skip-invalid',
    });

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(await stored(id)).toMatchObject({ status: 'errored', errorCount: 2 });
  });

  it('lists parser and normaliser errors together, in row order', async () => {
    const test = harness();
    const { id } = await seedImport(
      test,
      'value,match_type\n@,email_address\nshort\njane@example.org,email_address\n@@,email_address\n',
      { kind: 'email-address', mode: 'skip-invalid' },
    );

    await run(test.deps, id);

    expect(await errorsOf(id)).toEqual([
      { row: 2, column: 'value', code: 'invalid_value' },
      { row: 3, column: null, code: 'field_count_mismatch' },
      { row: 5, column: 'value', code: 'invalid_value' },
    ]);
  });

  it('answers each kind’s own code', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\n192.0.2.1/24\n', {
      kind: 'ip-address',
      mode: 'skip-invalid',
    });

    await run(test.deps, id);

    expect(await errorsOf(id)).toEqual([{ row: 2, column: 'value', code: 'host_bits_set' }]);
  });

  it('answers out_of_range on the column that broke it', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'latitude,longitude,radius_meters\n91,2,1000\n', {
      kind: 'geolocation',
    });

    await run(test.deps, id);

    expect(await errorsOf(id)).toEqual([{ row: 2, column: 'latitude', code: 'out_of_range' }]);
  });

  it('keeps 1,000 errors and counts them all', async () => {
    const test = harness();
    const rows = Array.from({ length: 1205 }, () => 'not a phone');
    const { id } = await seedImport(test, `value\n${rows.join('\n')}\n`, { kind: 'phone-number' });

    await run(test.deps, id);

    expect(await stored(id)).toMatchObject({ rowCount: 1205, errorCount: 1205 });
    const kept = await errorsOf(id);
    expect(kept).toHaveLength(IMPORT_LIMITS.errorsPerImport);
    expect(kept.at(-1)?.row).toBe(1001);
  });
});

describe('a file refused whole (C100.2 to C100.4)', () => {
  it.each<ImporterMode>(['all-or-nothing', 'skip-invalid'])(
    '%s: an invalid byte refuses it, with no row read',
    async (mode) => {
      const test = harness();
      const { id, listId } = await seedImport(test, Uint8Array.from([0x76, 0x0a, 0xff, 0x0a]), {
        mode,
      });

      await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

      expect(test.writer.written.get(listId)).toBeUndefined();
      expect(await stored(id)).toMatchObject({ status: 'errored', errorCount: 1, rowCount: 0 });
      expect(await errorsOf(id)).toEqual([{ row: null, column: null, code: 'invalid_encoding' }]);
    },
  );

  it('accepts a windows-1252 file by parameter', async () => {
    const test = harness();
    const bytes = Uint8Array.from([...new TextEncoder().encode('value\n'), 0xe9, 0x0a]);
    const { id, listId } = await seedImport(test, bytes, { encoding: 'windows-1252' });

    await run(test.deps, id);

    expect(test.writer.written.get(listId)?.[0]?.attributes).toEqual({ value: 'é' });
  });

  it('refuses a UTF-16 BOM', async () => {
    const test = harness();
    const { id } = await seedImport(test, Uint8Array.from([0xff, 0xfe, 0x76, 0x00]));

    await run(test.deps, id);

    expect(await errorsOf(id)).toEqual([{ row: null, column: null, code: 'invalid_encoding' }]);
  });

  it('skip-invalid: applies nothing from a file the parser cannot finish', async () => {
    const test = harness();
    const big = 'x'.repeat(IMPORT_LIMITS.recordCharacters + 2);
    const { id, listId } = await seedImport(test, `value\nfirst\n${big}\nlater\n`, {
      mode: 'skip-invalid',
    });

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(test.writer.written.get(listId)).toBeUndefined();
    expect(await errorsOf(id)).toEqual([{ row: 3, column: null, code: 'record_too_large' }]);
  });

  it('refuses a missing column, naming it', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'name_first\nJane\n', { kind: 'name' });

    await run(test.deps, id);

    expect(await errorsOf(id)).toEqual([
      { row: null, column: 'name_last', code: 'missing_column' },
    ]);
  });
});

describe('what the writer refuses (C99.1)', () => {
  /** Changes the list in `tx` and refuses one item, so a rollback can be seen. */
  function refusingWriter(index: number): ListItemWriter {
    return {
      async insertItems(tx, { listId, items }) {
        await tx.execute(sql`update lists set version = version + 1 where id = ${listId}`);
        return {
          inserted: items.filter((_, at) => at !== index).map(() => ({ id: testId('lis') })),
          alreadyPresent: 0,
          refused: [{ index, code: 'row_limit_exceeded' }],
        };
      },
    };
  }

  const versionOf = async (listId: string) => {
    const rows = await database.db.execute<{ version: number }>(
      sql`select version from lists where id = ${listId}`,
    );
    return rows.rows[0]?.version;
  };

  it('all-or-nothing: rolls every write back and names the row', async () => {
    const test = harness({ writer: refusingWriter(1) });
    const { id, listId } = await seedImport(test, 'value\nfirst\nsecond\nthird\n');
    const before = await versionOf(listId);

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(await versionOf(listId)).toBe(before);
    expect(await stored(id)).toMatchObject({
      status: 'errored',
      successfulCount: 0,
      alreadyPresentCount: 0,
      errorCount: 1,
    });
    expect(await errorsOf(id)).toEqual([{ row: 3, column: null, code: 'row_limit_exceeded' }]);
    expect(await stagedRows(id)).toBe(0);
  });

  it('skip-invalid: keeps the writes and names the row', async () => {
    const test = harness({ writer: refusingWriter(0) });
    const { id, listId } = await seedImport(test, 'value\nfirst\nsecond\n', {
      mode: 'skip-invalid',
    });
    const before = await versionOf(listId);

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'ready' });

    expect(await versionOf(listId)).toBe((before ?? 0) + 1);
    expect(await stored(id)).toMatchObject({ successfulCount: 1, errorCount: 1 });
    expect(await errorsOf(id)).toEqual([{ row: 2, column: null, code: 'row_limit_exceeded' }]);
  });

  it('skip-invalid: ends errored when the writer refused every row', async () => {
    const writer: ListItemWriter = {
      insertItems: (_tx, { items }) =>
        Promise.resolve({
          inserted: [],
          alreadyPresent: 0,
          refused: items.map((_, index) => ({ index, code: 'invalid_value' as const })),
        }),
    };
    const test = harness({ writer });
    const { id } = await seedImport(test, 'value\nfirst\nsecond\n', { mode: 'skip-invalid' });

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });
  });
});

describe('a run that cannot finish', () => {
  it('leaves an import that already ended', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, 'value\nfirst\n');
    await run(test.deps, id);
    const before = await stored(id);

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'skipped' });

    expect(await stored(id)).toEqual(before);
    expect(test.writer.written.get(listId)).toHaveLength(1);
  });

  it('skips an importer that does not exist', async () => {
    const test = harness();

    await expect(run(test.deps, testId('mprt'))).resolves.toEqual({ status: 'skipped' });
  });

  it('a writer that throws rolls the staged rows back, and a retry succeeds', async () => {
    const test = harness();
    const failing: ListItemWriter = {
      insertItems: () => Promise.reject(new Error('connection lost')),
    };
    const { id, listId } = await seedImport(test, 'value\nfirst\n');

    await expect(run({ ...test.deps, writer: failing }, id)).rejects.toThrow();

    expect(await stored(id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastErrorCode: 'import_failed',
    });
    expect(await stagedRows(id)).toBe(0);

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'ready' });
    expect(await stored(id)).toMatchObject({ attempts: 2, lastErrorCode: null });
    expect(test.writer.written.get(listId)).toHaveLength(1);
  });

  it('the error it throws carries no text from below', async () => {
    const test = harness();
    const failing: ListItemWriter = {
      insertItems: () => Promise.reject(new Error('sentinel-person@example.com')),
    };
    const { id } = await seedImport(test, 'value\nfirst\n');

    const thrown: unknown = await run({ ...test.deps, writer: failing }, id).catch(
      (error: unknown) => error,
    );

    expect(String(thrown)).not.toContain('sentinel-person');
    expect((thrown as Error).cause).toBeUndefined();
  });

  it('a storage failure stays pending for a retry', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\nfirst\n');
    const get = vi.spyOn(test.storage, 'get').mockRejectedValueOnce(new Error('unreachable'));

    await expect(run(test.deps, id)).rejects.toThrow();

    expect(await stored(id)).toMatchObject({
      status: 'pending',
      lastErrorCode: 'object_unavailable',
    });
    get.mockRestore();
    await expect(run(test.deps, id)).resolves.toEqual({ status: 'ready' });
  });

  it('ends errored, with its code, when the object is gone', async () => {
    const test = harness();
    const { id, storageKey } = await seedImport(test, 'value\nfirst\n');
    await test.storage.delete(storageKey);

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(await stored(id)).toMatchObject({
      status: 'errored',
      errorCount: 0,
      lastErrorCode: 'object_missing',
    });
  });

  it('ends errored when the object does not open', async () => {
    const test = harness();
    const { id, storageKey } = await seedImport(test, 'value\nfirst\n');
    await test.storage.put(storageKey, Uint8Array.from([1, 2, 3]));

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(await stored(id)).toMatchObject({ lastErrorCode: 'object_unreadable' });
  });

  it('ends errored when the list was archived after the upload', async () => {
    const test = harness();
    const { id, listId } = await seedImport(test, 'value\nfirst\n');
    await database.db.execute(
      sql`update lists set status = 'archived', archived_at = now() where id = ${listId}`,
    );

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(test.writer.written.get(listId)).toBeUndefined();
    expect(await stored(id)).toMatchObject({ lastErrorCode: 'list_archived' });
  });

  it('ends errored without the blind-index key', async () => {
    const test = harness({ blindIndexKey: undefined });
    const { id } = await seedImport(test, 'value\nfirst\n');

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(await stored(id)).toMatchObject({ lastErrorCode: 'blind_index_key_missing' });
  });

  it('ends errored when the row names no object any more', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\nfirst\n');
    await database.db.execute(
      sql`update importers set storage_key = null, wrapped_dek = null where id = ${id}`,
    );

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(await stored(id)).toMatchObject({ lastErrorCode: 'object_missing' });
  });

  it('stops retrying after its attempts, ending errored', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\nfirst\n');
    await database.db.execute(
      sql`update importers set attempts = ${IMPORT_MAX_ATTEMPTS} where id = ${id}`,
    );

    await expect(run(test.deps, id)).resolves.toEqual({ status: 'errored' });

    expect(await stored(id)).toMatchObject({
      status: 'errored',
      lastErrorCode: 'attempts_exhausted',
    });
  });
});

describe('no value leaves the job (C100.4, rule 11)', () => {
  const SECRET = 'sentinel-person@example.com';

  it.each<[string, string]>([
    ['a refused row', `value,match_type\n${SECRET},nonsense\n`],
    ['a short row', `value,match_type\n${SECRET}\n`],
    ['a wrong header', `${SECRET}\nother\n`],
    ['a clean row', `value,match_type\n${SECRET},email_address\n`],
  ])('%s', async (_name, content) => {
    const test = harness();
    const { id } = await seedImport(test, content, { kind: 'email-address' });

    await run(test.deps, id);

    const errors = await errorsOf(id);
    const audit = await listAuditLogs(database.db, environmentId, { resourceId: id });
    const [entry] = audit;
    expect(entry).toMatchObject({ actorType: 'system', action: 'importer.completed' });
    expect(entry?.metadata).toMatchObject({ 'row-count': expect.any(Number) as number });
    const held = JSON.stringify([test.logger.entries, errors, await stored(id), audit]);
    expect(held).not.toContain('sentinel-person');
  });

  it('logs counts and the reasons, by code', async () => {
    const test = harness();
    const { id } = await seedImport(test, 'value\nnot a phone\n', { kind: 'phone-number' });

    await run(test.deps, id);

    expect(test.logger.entries.at(-1)).toMatchObject({
      level: 'info',
      object: {
        importerId: id,
        status: 'errored',
        rowCount: 1,
        errorCount: 1,
        errorCodes: ['unparseable_phone'],
      },
    });
  });
});
