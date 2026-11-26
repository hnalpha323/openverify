/**
 * C92.2 (F35): the sync runner's steps, shared by the watchlist and network syncs. The download
 * goes through a fake stream client with our own synthetic body; no request leaves the process.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '@openverify/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboundStreamClient } from '../http/index.js';
import {
  FUTURE_PUBLICATION_MS,
  STALE_DIRECTORY_MS,
  applyUnderSourceLocks,
  checkPublicationGuards,
  hashFile,
  inSourceTransaction,
  privateDirectory,
  streamToFile,
  withPrivateFile,
  withSourceSessionLock,
  type SyncSession,
} from './runner.js';

const bases: string[] = [];

afterEach(async () => {
  for (const base of bases.splice(0)) {
    await rm(base, { recursive: true, force: true });
  }
});

async function base(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openverify-runner-test-'));
  bases.push(directory);
  return directory;
}

const NOW = new Date('2026-10-30T08:00:00.000Z');
const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('privateDirectory and withPrivateFile (C76.2 step 3)', () => {
  it('makes a 0700 directory and removes the stale ones of crashed runs, only with its prefix', async () => {
    const root = await base();
    const stale = join(root, 'openverify-network-old');
    const fresh = join(root, 'openverify-network-recent');
    const other = join(root, 'someone-else');
    for (const path of [stale, fresh, other]) {
      await mkdir(path);
    }
    const old = new Date(Date.now() - STALE_DIRECTORY_MS - 60_000);
    await utimes(stale, old, old);
    await utimes(other, old, old);
    const directory = await privateDirectory(root, new Date(), 'openverify-network-');
    expect(((await stat(directory)).mode & 0o777).toString(8)).toBe('700');
    const names = await readdir(root);
    expect(names).not.toContain('openverify-network-old');
    expect(names).toContain('openverify-network-recent');
    expect(names).toContain('someone-else');
  });

  it('opens a 0600 file there and removes the directory afterwards, also on a failure', async () => {
    const root = await base();
    let seen = '';
    await withPrivateFile(
      { base: root, now: NOW, prefix: 'openverify-network-', name: 'source.download' },
      async (handle) => {
        await handle.write('synthetic');
        seen = ((await handle.stat()).mode & 0o777).toString(8);
      },
    );
    expect(seen).toBe('600');
    await expect(
      withPrivateFile(
        { base: root, now: NOW, prefix: 'openverify-network-', name: 'source.download' },
        () => Promise.reject(new Error('the parse failed')),
      ),
    ).rejects.toThrow('the parse failed');
    expect(await readdir(root)).toEqual([]);
  });
});

describe('streamToFile and hashFile (C76.2 steps 3-4, C85.1)', () => {
  it('writes the streamed body to the file and hashes it as it arrives', async () => {
    const root = await base();
    const client: OutboundStreamClient = {
      async stream(_request, sink) {
        await sink.write(new TextEncoder().encode('synthetic '));
        await sink.write(new TextEncoder().encode('body'));
        return { status: 200, contentType: 'text/plain', headers: { etag: '"x"' }, bytes: 14 };
      },
    };
    const handle = await open(join(root, 'file'), 'w+', 0o600);
    try {
      const streamed = await streamToFile(
        client,
        { method: 'GET', url: 'https://example.org/list' },
        handle,
      );
      expect(streamed).toEqual({
        status: 200,
        sha256: sha256('synthetic body'),
        bytes: 14,
        headers: { etag: '"x"' },
      });
      expect(await hashFile(handle)).toBe(sha256('synthetic body'));
    } finally {
      await handle.close();
    }
  });

  it('hashes the whole file from its start, whatever was read before', async () => {
    const root = await base();
    await writeFile(join(root, 'file'), 'abc');
    const handle = await open(join(root, 'file'), 'r');
    try {
      await handle.read(Buffer.alloc(2), 0, 2, 0);
      expect(await hashFile(handle)).toBe(sha256('abc'));
    } finally {
      await handle.close();
    }
  });
});

function fakeSession() {
  const calls: string[] = [];
  const session: SyncSession = {
    db: {} as Db,
    release: () => {
      calls.push('release');
      return Promise.resolve();
    },
  };
  return { session, calls };
}

describe('withSourceSessionLock (C76.2 step 1)', () => {
  it('runs the sync under the session lock, then unlocks and releases the connection', async () => {
    const { session, calls } = fakeSession();
    const locks = {
      trySession: vi.fn(() => {
        calls.push('lock');
        return Promise.resolve(true);
      }),
      unlockSession: vi.fn(() => {
        calls.push('unlock');
        return Promise.resolve();
      }),
    };
    const result = await withSourceSessionLock(() => Promise.resolve(session), locks, 'source', {
      busy: () => Promise.resolve('busy'),
      locked: () => {
        calls.push('run');
        return Promise.resolve('ran');
      },
    });
    expect(result).toBe('ran');
    expect(calls).toEqual(['lock', 'run', 'unlock', 'release']);
    expect(locks.trySession).toHaveBeenCalledWith(session.db, 'source');
  });

  it('answers busy without running when another sync holds the lock, and still releases', async () => {
    const { session, calls } = fakeSession();
    const result = await withSourceSessionLock(
      () => Promise.resolve(session),
      {
        trySession: () => Promise.resolve(false),
        unlockSession: () => Promise.reject(new Error()),
      },
      'source',
      { busy: () => Promise.resolve('busy'), locked: () => Promise.resolve('ran') },
    );
    expect(result).toBe('busy');
    expect(calls).toEqual(['release']);
  });

  it('unlocks and releases when the sync throws, keeping its error', async () => {
    const { session, calls } = fakeSession();
    await expect(
      withSourceSessionLock(
        () => Promise.resolve(session),
        {
          trySession: () => Promise.resolve(true),
          unlockSession: () => {
            calls.push('unlock');
            return Promise.reject(new Error('the connection is gone'));
          },
        },
        'source',
        { busy: () => Promise.resolve('busy'), locked: () => Promise.reject(new Error('boom')) },
      ),
    ).rejects.toThrow('boom');
    expect(calls).toEqual(['unlock', 'release']);
  });
});

describe('inSourceTransaction and applyUnderSourceLocks (C76.2 step 6)', () => {
  function fakeDb() {
    const calls: string[] = [];
    const tx = { name: 'tx' } as unknown as Db;
    const db = {
      transaction: <T>(run: (inner: Db) => Promise<T>) => {
        calls.push('begin');
        return run(tx).then(
          (value) => {
            calls.push('commit');
            return value;
          },
          (error: unknown) => {
            calls.push('rollback');
            throw error;
          },
        );
      },
    } as unknown as Db;
    return { db, tx, calls };
  }

  it('takes the transaction lock first, then locks the row, then applies', async () => {
    const { db, tx, calls } = fakeDb();
    const result = await applyUnderSourceLocks(
      db,
      {
        transaction: (inner, id) => {
          calls.push(`xact ${id}`);
          expect(inner).toBe(tx);
          return Promise.resolve();
        },
        row: (_inner, id) => {
          calls.push(`row ${id}`);
          return Promise.resolve({ id });
        },
      },
      'source',
      (inner, row) => {
        calls.push(`apply ${String(row?.id)}`);
        expect(inner).toBe(tx);
        return Promise.resolve(7);
      },
    );
    expect(result).toBe(7);
    expect(calls).toEqual(['begin', 'xact source', 'row source', 'apply source', 'commit']);
  });

  it('rolls back what the apply wrote when it refuses', async () => {
    const { db, calls } = fakeDb();
    await expect(
      inSourceTransaction(db, { transaction: () => Promise.resolve() }, 'source', () =>
        Promise.reject(new Error('refused')),
      ),
    ).rejects.toThrow('refused');
    expect(calls).toEqual(['begin', 'rollback']);
  });
});

describe('checkPublicationGuards (C76.2, C92.2 step 6)', () => {
  const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
  const guards = (input: Partial<Parameters<typeof checkPublicationGuards>[0]>) =>
    checkPublicationGuards({
      publishedAt: at(0),
      lastPublishedAt: at(-1),
      now: NOW,
      acceptOlderPublication: false,
      ...input,
    });

  it('passes a newer publication with no override', () => {
    expect(guards({})).toEqual({ refusal: null, overrides: [] });
    expect(guards({ lastPublishedAt: null, publishedAt: null })).toEqual({
      refusal: null,
      overrides: [],
    });
  });

  it('refuses a publication more than a day ahead, whatever the overrides', () => {
    expect(FUTURE_PUBLICATION_MS).toBe(24 * 3_600_000);
    expect(guards({ publishedAt: at(24) }).refusal).toBeNull();
    expect(guards({ publishedAt: at(25), acceptOlderPublication: true }).refusal?.outcome).toBe(
      'refused_future',
    );
  });

  it('refuses an older publication unless told to accept it, and records the override', () => {
    expect(guards({ publishedAt: at(-2) }).refusal?.outcome).toBe('refused_rollback');
    expect(guards({ publishedAt: at(-2), acceptOlderPublication: true })).toEqual({
      refusal: null,
      overrides: ['accept-older-publication'],
    });
  });

  it('refuses a mass removal or addition unless allowed, each override recorded in order', () => {
    expect(guards({ massRemoval: { exceeded: true, allowed: false } }).refusal?.outcome).toBe(
      'refused_mass_removal',
    );
    expect(guards({ massAddition: { exceeded: true, allowed: false } }).refusal?.outcome).toBe(
      'refused_mass_addition',
    );
    expect(
      guards({
        publishedAt: at(-2),
        acceptOlderPublication: true,
        massRemoval: { exceeded: true, allowed: true },
        massAddition: { exceeded: true, allowed: true },
      }),
    ).toEqual({
      refusal: null,
      overrides: ['accept-older-publication', 'allow-mass-removal', 'allow-mass-addition'],
    });
    expect(guards({ massRemoval: { exceeded: false, allowed: true } }).overrides).toEqual([]);
  });

  it('names a rule, never a value', () => {
    const { refusal } = guards({ publishedAt: at(-2) });
    expect(refusal?.rule).toBe('the publication is older than the last applied one');
  });
});
