/**
 * The in-memory network snapshots (Workflow 7A Stage 1b (N), C92.3, H26), which the API's tests and
 * the Stage 3 owners build against: production never sees a sandbox-only source, a swap gives a
 * new immutable view and keeps the old one as it was, and closing releases everything.
 */
import { describe, expect, it } from 'vitest';
import type { NetworkSnapshot } from '../ports.js';
import { createInMemoryNetworkSnapshots } from './fakes.js';

const snapshot = (sourceId: string, overrides: Partial<NetworkSnapshot> = {}): NetworkSnapshot => ({
  sourceId,
  sandboxOnly: false,
  syncId: 1,
  publishedAt: new Date('2026-10-01T00:00:00.000Z'),
  sha256: 'a'.repeat(64),
  checkedAt: new Date('2026-10-02T00:00:00.000Z'),
  bytes: 64,
  data: { synthetic: sourceId },
  ...overrides,
});

describe('createInMemoryNetworkSnapshots (C92.3)', () => {
  it('serves sandbox environments every source and production none of the sandbox-only ones (H26)', () => {
    const snapshots = createInMemoryNetworkSnapshots([
      snapshot('tor-exit-addresses'),
      snapshot('openverify-sandbox-network', { sandboxOnly: true }),
    ]);

    expect(snapshots.current('sandbox').map((held) => held.sourceId)).toEqual([
      'tor-exit-addresses',
      'openverify-sandbox-network',
    ]);
    expect(snapshots.current('production').map((held) => held.sourceId)).toEqual([
      'tor-exit-addresses',
    ]);
  });

  it('swaps one source atomically: the old view stays as it was, the new one has the new snapshot', () => {
    const snapshots = createInMemoryNetworkSnapshots([
      snapshot('tor-exit-addresses'),
      snapshot('aws-ip-ranges'),
    ]);
    const before = snapshots.current('production');

    snapshots.swap(snapshot('tor-exit-addresses', { syncId: 2, sha256: 'b'.repeat(64) }));
    const after = snapshots.current('production');

    expect(before.map((held) => [held.sourceId, held.syncId])).toEqual([
      ['tor-exit-addresses', 1],
      ['aws-ip-ranges', 1],
    ]);
    expect(after.map((held) => [held.sourceId, held.syncId])).toEqual([
      ['tor-exit-addresses', 2],
      ['aws-ip-ranges', 1],
    ]);
    expect(Object.isFrozen(after)).toBe(true);
  });

  it('adds a source it did not hold', () => {
    const snapshots = createInMemoryNetworkSnapshots();

    snapshots.swap(snapshot('gcp-cloud'));

    expect(snapshots.current('sandbox').map((held) => held.sourceId)).toEqual(['gcp-cloud']);
  });

  it('records start and close, and holds nothing once closed', async () => {
    const snapshots = createInMemoryNetworkSnapshots([snapshot('tor-exit-addresses')]);

    expect(snapshots.started).toBe(false);
    await snapshots.start();
    expect(snapshots.started).toBe(true);
    await snapshots.close();
    await snapshots.close();

    expect(snapshots.closed).toBe(true);
    expect(snapshots.current('sandbox')).toEqual([]);
  });
});
