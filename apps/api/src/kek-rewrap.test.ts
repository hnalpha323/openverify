/**
 * `pnpm --filter @openverify/api kek:rewrap` (C16, `scripts/kek-rewrap.ts`): rewraps every
 * stored DEK under the current KEK, in batches, resumably, with `--dry-run`, printing counts
 * only. Vitest runs `src/**` tests, so the script's tests live here. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId } from '@openverify/contracts';
import {
  createAccount,
  createKeyring,
  getAccount,
  needsRewrap,
  setDefaultKeyring,
  type Db,
  type Keyring,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_STATE_FILE,
  fileStateStore,
  KekRewrapUsageError,
  memoryStateStore,
  parseKekRewrapArgs,
  runKekRewrap,
  type KekRewrapState,
  type KekRewrapStateStore,
} from '../scripts/kek-rewrap.js';

const MARKER = 'Zyxw-synthetic-kek';

let database: TestDatabase;
let db: Db;
let oldKek: Uint8Array;
let oldKeyring: Keyring;
let newKek: Uint8Array;
let newKeyring: Keyring;
let lines: string[];
const out = (line: string) => {
  lines.push(line);
};

beforeEach(async () => {
  oldKek = randomBytes(32);
  oldKeyring = createKeyring(oldKek);
  newKek = randomBytes(32);
  newKeyring = createKeyring(newKek, [oldKek]);
  database = await createTestDatabase({ keyring: oldKeyring });
  db = database.db;
  lines = [];
  const { environment } = await createTestTenant(db);
  for (let index = 0; index < 3; index += 1) {
    await createAccount(db, environment.id, {
      id: newId('acc'),
      fields: { name_first: `${MARKER} ${String(index)}` },
    });
  }
  await createTestInquiry(db, environment.id, { fields: { name_first: MARKER } });
});

afterEach(async () => {
  setDefaultKeyring(oldKeyring);
  await database.close();
});

afterAll(() => {
  setDefaultKeyring(undefined);
});

/** The rows of a raw query, as both drivers return them. */
const rowsOf = <T>(result: unknown): T[] => (result as { rows: T[] }).rows;

/** Ciphertexts of the account fields and inquiry fields still wrapped by an old KEK. */
async function staleValues(keyring: Keyring): Promise<number> {
  const rows = rowsOf<{ value: string }>(
    await db.execute(sql`
      select fields::text as value from accounts where fields is not null
      union all select fields::text from inquiries`),
  );
  return rows.filter((row) => needsRewrap(row.value, keyring)).length;
}

describe('parseKekRewrapArgs', () => {
  it('has defaults', () => {
    expect(parseKekRewrapArgs([])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_BATCH_SIZE,
      stateFile: DEFAULT_STATE_FILE,
      restart: false,
    });
    expect(DEFAULT_BATCH_SIZE).toBe(500);
  });

  it('reads --dry-run, --batch-size, --state-file and --restart', () => {
    expect(
      parseKekRewrapArgs([
        '--dry-run',
        '--batch-size=50',
        '--state-file=/tmp/state.json',
        '--restart',
      ]),
    ).toEqual({ dryRun: true, batchSize: 50, stateFile: '/tmp/state.json', restart: true });
    expect(parseKekRewrapArgs(['--batch-size', '20', '--state-file', 'state.json'])).toMatchObject({
      batchSize: 20,
      stateFile: 'state.json',
    });
  });

  it.each([
    [['--unknown']],
    [['--batch-size=0']],
    [['--batch-size=abc']],
    [['--batch-size=10001']],
    [['--batch-size']],
    [['--state-file=']],
  ])('refuses %j with a usage error', (argv) => {
    expect(() => parseKekRewrapArgs(argv)).toThrow(KekRewrapUsageError);
  });
});

describe('runKekRewrap', () => {
  it('rewraps every stored value under the current KEK and prints counts only', async () => {
    expect(await staleValues(newKeyring)).toBe(4);

    const summary = await runKekRewrap({
      db,
      keyring: newKeyring,
      args: parseKekRewrapArgs([]),
      state: memoryStateStore(),
      out,
    });

    expect(summary.rewrapped).toBeGreaterThanOrEqual(4);
    expect(await staleValues(newKeyring)).toBe(0);
    expect(lines.at(-1)).toBe(
      `kek:rewrap: done: scanned ${String(summary.scanned)} rows, rewrapped ${String(summary.rewrapped)} values.`,
    );
    // Three accounts with fields, plus the inquiry's own account, which has none.
    expect(lines).toContain('kek:rewrap: accounts: scanned 4 rows, rewrapped 3 values');
    for (const line of lines) {
      expect(line).toMatch(/^kek:rewrap: /);
      expect(line).not.toContain(MARKER);
      expect(line).not.toMatch(/(acc|inq|env|org)_[0-9A-Z]{26}/);
    }
  });

  it('leaves the values readable with only the new KEK once done', async () => {
    const [first] = rowsOf<{ id: string; environment_id: string }>(
      await db.execute(sql`select id, environment_id from accounts order by id limit 1`),
    );

    await runKekRewrap({
      db,
      keyring: newKeyring,
      args: parseKekRewrapArgs([]),
      state: memoryStateStore(),
      out,
    });

    setDefaultKeyring(createKeyring(newKek));
    const account = await getAccount(db, first?.environment_id ?? '', first?.id ?? '');
    expect(JSON.stringify(account?.fields)).toContain(MARKER);
  });

  it('counts but writes nothing with --dry-run', async () => {
    const state = memoryStateStore();

    const summary = await runKekRewrap({
      db,
      keyring: newKeyring,
      args: parseKekRewrapArgs(['--dry-run']),
      state,
      out,
    });

    expect(summary.rewrapped).toBeGreaterThanOrEqual(4);
    expect(await staleValues(newKeyring)).toBe(4);
    expect(await state.read()).toBeNull();
    expect(lines.at(-1)).toMatch(/\(dry run: nothing was written\)$/);
  });

  it('finds nothing to do when every value is already under the current KEK', async () => {
    await runKekRewrap({
      db,
      keyring: newKeyring,
      args: parseKekRewrapArgs([]),
      state: memoryStateStore(),
      out,
    });
    lines = [];

    const again = await runKekRewrap({
      db,
      keyring: newKeyring,
      args: parseKekRewrapArgs(['--dry-run']),
      state: memoryStateStore(),
      out,
    });

    expect(again.rewrapped).toBe(0);
  });

  it('resumes from the saved position after an interruption, then clears it', async () => {
    const saved: KekRewrapState[] = [];
    let writes = 0;
    const inner = memoryStateStore();
    const interrupting: KekRewrapStateStore = {
      read: () => inner.read(),
      clear: () => inner.clear(),
      async write(state) {
        writes += 1;
        if (writes === 3) {
          throw new Error('interrupted');
        }
        saved.push(state);
        await inner.write(state);
      },
    };

    await expect(
      runKekRewrap({
        db,
        keyring: newKeyring,
        args: parseKekRewrapArgs(['--batch-size=1']),
        state: interrupting,
        out,
      }),
    ).rejects.toThrow('interrupted');
    expect(saved).toEqual([
      { table: 'accounts', after: expect.any(String) as unknown },
      { table: 'accounts', after: expect.any(String) as unknown },
    ]);
    expect(await staleValues(newKeyring)).toBeGreaterThan(0);
    lines = [];

    await runKekRewrap({
      db,
      keyring: newKeyring,
      args: parseKekRewrapArgs(['--batch-size=1']),
      state: inner,
      out,
    });

    expect(lines[0]).toBe('kek:rewrap: resuming at table accounts');
    expect(await staleValues(newKeyring)).toBe(0);
    expect(await inner.read()).toBeNull();
  });

  it('starts over with --restart', async () => {
    const state = memoryStateStore();
    await state.write({ table: 'webhooks', after: null });

    await runKekRewrap({
      db,
      keyring: newKeyring,
      args: parseKekRewrapArgs(['--restart']),
      state,
      out,
    });

    expect(lines[0]).not.toMatch(/resuming/);
    expect(await staleValues(newKeyring)).toBe(0);
  });

  it('ignores a saved position for a table it does not know', async () => {
    const state = memoryStateStore();
    await state.write({ table: 'not_a_table' as never, after: null });

    await runKekRewrap({ db, keyring: newKeyring, args: parseKekRewrapArgs([]), state, out });

    expect(await staleValues(newKeyring)).toBe(0);
  });
});

describe('fileStateStore', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openverify-kek-rewrap-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes, reads and clears the position as JSON', async () => {
    const path = join(directory, 'nested', 'state.json');
    const store = fileStateStore(path);

    expect(await store.read()).toBeNull();
    await store.write({ table: 'events', after: 'evt_01M5CJXHG0000000000000000A' });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      table: 'events',
      after: 'evt_01M5CJXHG0000000000000000A',
    });
    expect(await store.read()).toEqual({
      table: 'events',
      after: 'evt_01M5CJXHG0000000000000000A',
    });
    await store.clear();
    expect(await store.read()).toBeNull();
    await store.clear();
  });

  it('treats an unreadable file as no position', async () => {
    const path = join(directory, 'state.json');
    await writeFile(path, 'not json', 'utf8');

    expect(await fileStateStore(path).read()).toBeNull();
  });
});
