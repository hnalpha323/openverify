/**
 * V11: the in-memory watchlist reads behave as the frozen contract says, so `api-reports` can
 * build against them before `api-watchlists` lands the SQL. Synthetic values only.
 */
import type { WatchlistSourceState } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import { createInMemoryWatchlists, type FakeWatchlistEntry } from './fakes.js';

const entry = (sourceId: string, entryId: string, extra: Partial<FakeWatchlistEntry> = {}) => ({
  sourceId,
  entryId,
  kind: 'individual' as const,
  contentHash: 'a'.repeat(64),
  riskDataHash: 'b'.repeat(64),
  data: { entry_id: entryId },
  removedAt: null,
  ...extra,
});

const source = (id: string, sandboxOnly = false): WatchlistSourceState => ({
  id,
  enabled: true,
  sandboxOnly,
  keysVersion: 'v1',
  lastSyncId: 1,
  lastPublishedAt: null,
  lastSha256: null,
  lastAppliedAt: null,
  lastCheckedAt: null,
  lastOrigin: 'import',
  lastErrorCode: null,
});

const query = {
  environmentKind: 'sandbox' as const,
  sourceIds: ['synthetic-list', 'openverify-sandbox'],
  keys: [] as string[],
  identifiers: [] as { kind: string; value: string }[],
  cryptoAddresses: [] as string[],
  normalisedName: null,
  cap: 10,
};

describe('createInMemoryWatchlists (V11)', () => {
  const watchlists = createInMemoryWatchlists(
    [
      entry('synthetic-list', 'E1', { keys: ['t:avery', 't:quill'] }),
      entry('synthetic-list', 'E2', { keys: ['t:avery'] }),
      entry('openverify-sandbox', 'S1', { keys: ['t:avery'] }),
      entry('synthetic-list', 'E3', { identifiers: [{ kind: 'imo', value: '9999993' }] }),
      entry('synthetic-list', 'E4', { cryptoAddresses: ['0xdead'] }),
      entry('other-list', 'O1', { keys: ['t:avery'] }),
    ],
    [source('synthetic-list'), source('openverify-sandbox', true), source('other-list')],
  );

  it('retrieves by shared keys, ranked, within the selected sources', async () => {
    const found = await watchlists.retrieveCandidates({} as never, {
      ...query,
      keys: ['t:avery', 't:quill'],
    });

    expect(found.truncated).toBe(false);
    expect(found.candidates.map((c) => `${c.sourceId}:${c.entryId}`)).toEqual([
      'synthetic-list:E1',
      'openverify-sandbox:S1',
      'synthetic-list:E2',
    ]);
  });

  it('leaves out sandbox-only sources for production, and says when the cap binds', async () => {
    const production = await watchlists.retrieveCandidates({} as never, {
      ...query,
      environmentKind: 'production',
      keys: ['t:avery'],
      cap: 8,
    });
    expect(production.candidates.map((c) => c.entryId)).toEqual(['E1', 'E2']);
    expect(production.truncated).toBe(false);

    const cut = await watchlists.retrieveCandidates({} as never, {
      ...query,
      environmentKind: 'production',
      keys: ['t:quill'],
      identifiers: [{ kind: 'imo', value: '9999993' }],
      cap: 1,
    });
    expect(cut.candidates.map((c) => c.entryId)).toEqual(['E1']);
    expect(cut.truncated).toBe(true);
  });

  it('finds exact identifiers and crypto addresses whatever the names say', async () => {
    const found = await watchlists.retrieveCandidates({} as never, {
      ...query,
      identifiers: [{ kind: 'imo', value: '9999993' }],
      cryptoAddresses: ['0xdead'],
    });

    expect(found.candidates).toEqual([
      { sourceId: 'synthetic-list', entryId: 'E3', sharedKeys: 0, via: ['identifier'] },
      { sourceId: 'synthetic-list', entryId: 'E4', sharedKeys: 0, via: ['crypto'] },
    ]);
  });

  it('uses a key alone only when its entries are within the bound of the cap, and says when a pair of tokens is out of reach (owner decision 1 after 6B)', async () => {
    const crowd = createInMemoryWatchlists(
      [
        ...Array.from({ length: 11 }, (_, index) =>
          entry('synthetic-list', `M${String(index)}`, {
            keys: ['t:maria', `t:other${String(index)}`, `p:t:maria+t:other${String(index)}`],
          }),
        ),
        entry('synthetic-list', 'MG', { keys: ['t:maria', 't:garcia', 'p:t:garcia+t:maria'] }),
      ],
      [source('synthetic-list')],
    );
    const reach = [['p:t:garcia+t:maria', 't:garcia', 't:maria']];
    const found = await crowd.retrieveCandidates({} as never, {
      ...query,
      keys: ['p:t:garcia+t:maria', 't:garcia', 't:maria'],
      reach,
      cap: 40,
    });
    expect(found.candidates.map((c) => c.entryId)).toEqual(['MG']);
    expect(found.truncated).toBe(false);

    const out = await crowd.retrieveCandidates({} as never, {
      ...query,
      keys: ['t:maria'],
      reach: [['t:maria']],
      cap: 40,
    });
    expect(out.candidates).toEqual([]);
    expect(out.truncated).toBe(true);
  });

  it('loads a page of the entries a sync changed beside the candidates (owner decision 3 after 6B)', async () => {
    const changed = createInMemoryWatchlists(
      [
        entry('synthetic-list', 'C2', { changedSyncId: 5 }),
        entry('synthetic-list', 'C1', { changedSyncId: 5 }),
        entry('synthetic-list', 'C3', { changedSyncId: 5, removedAt: new Date(0) }),
        entry('synthetic-list', 'C4', { changedSyncId: 6 }),
        entry('openverify-sandbox', 'S9', { changedSyncId: 5 }),
      ],
      [source('synthetic-list'), source('openverify-sandbox', true)],
    );
    const load = (afterEntryId?: string) =>
      changed.loadEntries({} as never, {
        environmentKind: 'production',
        entries: [],
        changedInSync: { syncId: 5, afterEntryId, limit: 1 },
      });

    expect((await load()).map((row) => row.entryId)).toEqual(['C1']);
    expect((await load('C1')).map((row) => row.entryId)).toEqual(['C2']);
    expect(await load('C2')).toEqual([]);
  });

  it('returns a page of changed entries in entry id order, as the database does, so paging after the last one meets each entry once (review C004)', async () => {
    const stored = ['C5', 'C3', 'C9', 'C1', 'C7', 'C2'];
    const changed = createInMemoryWatchlists(
      stored.map((entryId) => entry('synthetic-list', entryId, { changedSyncId: 5 })),
      [source('synthetic-list')],
    );
    const pages: string[][] = [];
    let afterEntryId: string | undefined;
    for (;;) {
      const page = await changed.loadEntries({} as never, {
        environmentKind: 'sandbox',
        entries: [],
        changedInSync: { syncId: 5, afterEntryId, limit: 4 },
      });
      pages.push(page.map((row) => row.entryId));
      if (page.length < 4) {
        break;
      }
      afterEntryId = page.at(-1)?.entryId;
    }

    expect(pages).toEqual([
      ['C1', 'C2', 'C3', 'C5'],
      ['C7', 'C9'],
    ]);
  });

  it('states the scripts of each source’s live names when its state does not (owner decision 13 after 6B)', async () => {
    const scripted = createInMemoryWatchlists(
      [
        entry('synthetic-list', 'A1', {
          data: { entry_id: 'A1', names: [{ script: 'latin' }, { script: 'arabic' }] },
        }),
        entry('synthetic-list', 'A2', {
          data: { entry_id: 'A2', names: [{ script: 'han' }] },
          removedAt: new Date(0),
        }),
      ],
      [source('synthetic-list'), { ...source('openverify-sandbox'), scripts: ['cyrillic'] }],
    );
    const states = await scripted.getWatchlistSourceStates({} as never, [
      'synthetic-list',
      'openverify-sandbox',
    ]);
    expect(states.map((state) => state.scripts)).toEqual([['arabic', 'latin'], ['cyrillic']]);
  });

  it('loads entries and source states', async () => {
    const loaded = await watchlists.loadEntries({} as never, {
      environmentKind: 'production',
      entries: [
        { sourceId: 'synthetic-list', entryId: 'E2' },
        { sourceId: 'openverify-sandbox', entryId: 'S1' },
      ],
    });
    const states = await watchlists.getWatchlistSourceStates({} as never, ['openverify-sandbox']);

    expect(loaded.map((row) => row.entryId)).toEqual(['E2']);
    expect(states.map((state) => state.id)).toEqual(['openverify-sandbox']);
  });
});
