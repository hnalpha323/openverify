/**
 * C100.2, C100.5, C100.7: what only real Postgres locks and transactions can show (Testcontainers,
 * started without bind-parameter logging, C73.8): two uploads of one file become one import; a second
 * run of one job leaves the row to the first; a refusal rolls back real writes; a crash leaves no
 * staged row; and a reader is never held up by a running import. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { LIST_LIMITS, type ImporterMode } from '@openverify/contracts';
import {
  createDatabase,
  createImporter as insertImporter,
  createKeyring,
  encryptBytes,
  getImporter,
  listImporterErrors,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  seedList,
  testId,
  startIntegrationPostgres,
  ifSet,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulidIdGenerator, type ListItemWriter } from '../../ports.js';
import { createImporter } from '../../services/importers/importers.js';
import { createListItemWriter } from '../../services/lists/item-writer.js';
import type { ListActing } from '../../services/lists/lists.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createAllowAllRateLimiter,
  createFakeListItemWriter,
  createRecordingAuditLogger,
  fixedClock,
  createRecordingEventPublisher,
} from '../../test-support/fakes.js';
import { createCapturingLogger, createMemoryStorage } from '../testing.js';
import { processListImport, type ListImportDeps } from './process.js';

const keyring = createKeyring(randomBytes(32));
const blindIndexKey = randomBytes(32);
/** Long enough for a run that takes no lock to answer. */
const WAIT_MS = 5_000;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let organizationId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const sleep = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const jobDeps = (writer: ListItemWriter, storage = createMemoryStorage()): ListImportDeps => ({
  events: createRecordingEventPublisher(),
  db,
  clock: fixedClock(),
  logger: createCapturingLogger(),
  storage,
  keyring,
  blindIndexKey,
  writer,
});

async function seedImport(
  storage: ListImportDeps['storage'],
  content: string,
  options: { listId?: string; mode?: ImporterMode } = {},
) {
  const listId = options.listId ?? (await seedList(db, environmentId)).id;
  const bytes = new TextEncoder().encode(content);
  const id = testId('mprt');
  const sealed = encryptBytes(bytes, keyring, { context: id });
  const storageKey = `${environmentId}/${id}`;
  await storage.put(storageKey, sealed.ciphertext);
  await insertImporter(db, environmentId, {
    id,
    listId,
    mode: options.mode ?? 'all-or-nothing',
    encoding: 'utf-8',
    fileSha256: 'a'.repeat(64),
    fileBytes: bytes.byteLength,
    storageKey,
    wrappedDek: sealed.wrappedDek,
  });
  return { id, listId };
}

async function count(statement: ReturnType<typeof sql>): Promise<number> {
  const rows = await db.execute<{ count: number }>(statement);
  return rows.rows[0]?.count ?? -1;
}

const stagedRows = (id: string) =>
  count(sql`select count(*)::int as count from list_import_rows where importer_id = ${id}`);

describe('two uploads of one file at once (C100.5)', () => {
  it('store one import and one object', async () => {
    const { id: listId } = await seedList(db, environmentId);
    const storage = createMemoryStorage();
    const deps = {
      db,
      clock: fixedClock(),
      ids: ulidIdGenerator,
      storage,
      keyring,
      audit: createRecordingAuditLogger(),
      rateLimiter: createAllowAllRateLimiter(),
    } as unknown as ApiDependencies;
    const acting: ListActing = {
      ctx: { environmentId, organizationId },
      actor: { type: 'api-key', id: testId('key') },
      mask: undefined as never,
    };
    const body = {
      data: {
        attributes: {
          'list-id': listId,
          file: Buffer.from(`value\n${testId('lis')}\n`).toString('base64'),
        },
      },
    };

    const answers = await Promise.all(
      Array.from({ length: 6 }, () =>
        createImporter(deps, acting, 'string', body, 'application/json'),
      ),
    );

    expect(new Set(answers.map(({ data }) => data.id)).size).toBe(1);
    expect(storage.objects.size).toBe(1);
    expect(
      await count(sql`select count(*)::int as count from importers where list_id = ${listId}`),
    ).toBe(1);
  });
});

describe('one job run twice (C100.2)', () => {
  it('the second run leaves the row to the first, and every row is written once', async () => {
    const storage = createMemoryStorage();
    const { id, listId } = await seedImport(storage, 'value\nfirst\nsecond\n');
    const reached = deferred();
    const released = deferred();
    const fake = createFakeListItemWriter();
    const held: ListItemWriter = {
      insertItems: async (tx, input) => {
        reached.resolve();
        await released.promise;
        return fake.insertItems(tx, input);
      },
    };

    const first = processListImport({ environmentId, importerId: id }, jobDeps(held, storage));
    await reached.promise;

    const second = processListImport({ environmentId, importerId: id }, jobDeps(fake, storage));
    const answer = await Promise.race([second, sleep(WAIT_MS).then(() => 'still waiting')]);
    released.resolve();

    expect(answer).toEqual({ status: 'skipped' });
    await expect(first).resolves.toEqual({ status: 'ready' });
    expect(fake.written.get(listId)).toHaveLength(2);
    expect(await getImporter(db, environmentId, id)).toMatchObject({
      status: 'ready',
      attempts: 1,
    });
  });

  it('a running import holds up no reader, and shows no staged row', async () => {
    const storage = createMemoryStorage();
    const { id } = await seedImport(storage, 'value\nfirst\n');
    const reached = deferred();
    const released = deferred();
    const held: ListItemWriter = {
      insertItems: async () => {
        reached.resolve();
        await released.promise;
        return { inserted: [{ id: testId('lis') }], alreadyPresent: 0, refused: [] };
      },
    };

    const running = processListImport({ environmentId, importerId: id }, jobDeps(held, storage));
    await reached.promise;

    expect(await getImporter(db, environmentId, id)).toMatchObject({ status: 'pending' });
    expect(await stagedRows(id)).toBe(0);

    released.resolve();
    await running;
    expect(await stagedRows(id)).toBe(0);
  });
});

describe('rollback (C100.2, C100.7)', () => {
  /** Really writes to the list in `tx`, then answers `answer`. */
  const writing = (answer: Awaited<ReturnType<ListItemWriter['insertItems']>>): ListItemWriter => ({
    insertItems: async (tx, { listId }) => {
      await tx.execute(sql`update lists set version = version + 1 where id = ${listId}`);
      return answer;
    },
  });

  const versionOf = (listId: string) =>
    count(sql`select version as count from lists where id = ${listId}`);

  it('all-or-nothing: a refusal undoes the writes and still records the outcome', async () => {
    const storage = createMemoryStorage();
    const { id, listId } = await seedImport(storage, 'value\nfirst\nsecond\n');
    const before = await versionOf(listId);

    await expect(
      processListImport(
        { environmentId, importerId: id },
        jobDeps(
          writing({
            inserted: [],
            alreadyPresent: 0,
            refused: [{ index: 1, code: 'invalid_value' }],
          }),
          storage,
        ),
      ),
    ).resolves.toEqual({ status: 'errored' });

    expect(await versionOf(listId)).toBe(before);
    expect(await stagedRows(id)).toBe(0);
    expect(await getImporter(db, environmentId, id)).toMatchObject({
      status: 'errored',
      successfulCount: 0,
      errorCount: 1,
    });
    expect(await listImporterErrors(db, environmentId, id, { afterRow: 0, limit: 10 })).toEqual([
      { row: 3, column: null, code: 'invalid_value' },
    ]);
  });

  it('a writer that dies mid-file leaves no write and no staged row, and a retry finishes', async () => {
    const storage = createMemoryStorage();
    const rows = Array.from({ length: 1500 }, (_, index) => `v${String(index)}`);
    const { id, listId } = await seedImport(storage, `value\n${rows.join('\n')}\n`);
    const before = await versionOf(listId);
    let calls = 0;
    const dying: ListItemWriter = {
      insertItems: async (tx, { listId: list }) => {
        calls += 1;
        await tx.execute(sql`update lists set version = version + 1 where id = ${list}`);
        if (calls === 2) {
          throw new Error('connection lost');
        }
        return { inserted: [], alreadyPresent: 0, refused: [] };
      },
    };

    await expect(
      processListImport({ environmentId, importerId: id }, jobDeps(dying, storage)),
    ).rejects.toThrow();

    expect(await versionOf(listId)).toBe(before);
    expect(await stagedRows(id)).toBe(0);
    expect(await getImporter(db, environmentId, id)).toMatchObject({
      status: 'pending',
      lastErrorCode: 'import_failed',
    });

    const fake = createFakeListItemWriter();
    await expect(
      processListImport({ environmentId, importerId: id }, jobDeps(fake, storage)),
    ).resolves.toEqual({ status: 'ready' });
    expect(fake.written.get(listId)).toHaveLength(1500);
  });
});

describe('through the real writer (C99.1, C100.5)', () => {
  const writer = () => createListItemWriter({ blindIndexKey });
  const itemsOf = (listId: string) =>
    count(sql`select count(*)::int as count from list_items where list_id = ${listId}`);

  it('a second file meets the first at the row: the partial unique index counts the repeat', async () => {
    const storage = createMemoryStorage();
    const first = await seedImport(storage, 'value\nFirst\nsecond\n');
    await processListImport({ environmentId, importerId: first.id }, jobDeps(writer(), storage));
    const second = await seedImport(storage, 'value\nfirst\nthird\nTHIRD\n', {
      listId: first.listId,
    });

    await expect(
      processListImport({ environmentId, importerId: second.id }, jobDeps(writer(), storage)),
    ).resolves.toEqual({ status: 'ready' });

    expect(await getImporter(db, environmentId, second.id)).toMatchObject({
      rowCount: 3,
      successfulCount: 1,
      alreadyPresentCount: 1,
      duplicateCount: 1,
    });
    expect(await itemsOf(first.listId)).toBe(3);
    expect(
      await count(
        sql`select count(*)::int as count from list_items
            where list_id = ${first.listId} and created_by_type = 'importer'
              and created_by_id = ${first.id}`,
      ),
    ).toBe(2);
  });

  it('all-or-nothing: a list with no room for every row takes none of them', async () => {
    const storage = createMemoryStorage();
    const { id, listId } = await seedImport(storage, 'value\nfirst\nsecond\nthird\n');
    await db.execute(
      sql`update lists set item_count = ${LIST_LIMITS.itemsPerList - 1} where id = ${listId}`,
    );

    await expect(
      processListImport({ environmentId, importerId: id }, jobDeps(writer(), storage)),
    ).resolves.toEqual({ status: 'errored' });

    expect(await itemsOf(listId)).toBe(0);
    expect(await getImporter(db, environmentId, id)).toMatchObject({
      successfulCount: 0,
      errorCount: 2,
    });
    expect(await listImporterErrors(db, environmentId, id, { afterRow: 0, limit: 10 })).toEqual([
      { row: 3, column: null, code: 'row_limit_exceeded' },
      { row: 4, column: null, code: 'row_limit_exceeded' },
    ]);
  });

  it('skip-invalid: the room is filled and the rest named', async () => {
    const storage = createMemoryStorage();
    const { id, listId } = await seedImport(storage, 'value\nfirst\nsecond\n', {
      mode: 'skip-invalid',
    });
    await db.execute(
      sql`update lists set item_count = ${LIST_LIMITS.itemsPerList - 1} where id = ${listId}`,
    );

    await expect(
      processListImport({ environmentId, importerId: id }, jobDeps(writer(), storage)),
    ).resolves.toEqual({ status: 'ready' });

    expect(await itemsOf(listId)).toBe(1);
    expect(await getImporter(db, environmentId, id)).toMatchObject({
      successfulCount: 1,
      errorCount: 1,
    });
  });
});
