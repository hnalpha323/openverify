/**
 * C92.2: one `network-refresh` tick, over PGlite, in-memory storage and a fake publisher with
 * synthetic bodies: each enabled source that downloads is synced when its refresh interval has
 * passed since its last check and its back-off after failed checks (the watchlists' rule, owner
 * decision 6 after Workflow 6A) has passed since the last failure. No request leaves the process.
 */
import { listNetworkSourceStates } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { syntheticTorExitList } from '@openverify/signals/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NO_NETWORK_SETTINGS } from '../../config.js';
import type { OutboundHttp } from '../../http/index.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { sharedWatchlistSession } from '../../watchlists/sync-session.js';
import { createWorkerLogger } from '../logger.js';
import { runNetworkRefresh, type NetworkRefreshDeps } from './network.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.client.query('truncate network_syncs, network_sources');
});

const TOR = 'https://check.torproject.org/exit-addresses';

function publisher(answers: Record<string, string>) {
  const requested: string[] = [];
  const http: OutboundHttp = {
    client: () => {
      throw new Error('not used');
    },
    streamClient: () => ({
      async stream(request, sink) {
        requested.push(request.url);
        const body = answers[request.url];
        if (body === undefined) {
          return { status: 503, contentType: null, headers: {}, bytes: 0 };
        }
        await sink.write(Buffer.from(body));
        return { status: 200, contentType: null, headers: {}, bytes: Buffer.byteLength(body) };
      },
    }),
    close: () => Promise.resolve(),
  };
  return { http, requested };
}

let now = new Date('2026-10-30T08:00:00Z');
const at = (minutes: number) => new Date(Date.parse('2026-10-30T08:00:00Z') + minutes * 60_000);

function deps(http: OutboundHttp, storage = createInMemoryFileStorage()): NetworkRefreshDeps {
  return {
    db: database.db,
    clock: { now: () => now },
    logger: createWorkerLogger({ name: 'network-refresh-test', level: 'silent' }),
    outboundHttp: http,
    storage,
    network: { ...NO_NETWORK_SETTINGS, refresh: true },
    connect: sharedWatchlistSession(database.db),
  };
}

describe('runNetworkRefresh', () => {
  it('syncs every enabled downloading source that is due, and nothing that is not', async () => {
    now = at(0);
    const tor = syntheticTorExitList({ seed: 'tick', publishedAt: at(-30) });
    const fake = publisher({ [TOR]: tor });
    const storage = createInMemoryFileStorage();
    const first = await runNetworkRefresh(deps(fake.http, storage));
    // Nine sources download by default; the publisher answers only the exit list.
    expect(first).toEqual({ due: 9, applied: 1, unchanged: 0, refused: 0, failed: 8 });
    expect(fake.requested).toContain(TOR);
    expect(fake.requested.some((url) => url.includes('azure'))).toBe(false);

    // Ten minutes later nothing is due: the exit list's hour has not passed, and every failed
    // source waits out its first 15-minute back-off.
    now = at(10);
    fake.requested.length = 0;
    expect(await runNetworkRefresh(deps(fake.http, storage))).toEqual({
      due: 0,
      applied: 0,
      unchanged: 0,
      refused: 0,
      failed: 0,
    });
    expect(fake.requested).toEqual([]);

    // After the back-off the failed sources are due again; after its hour, the exit list too.
    now = at(61);
    const later = await runNetworkRefresh(deps(fake.http, storage));
    expect(later).toEqual({ due: 9, applied: 0, unchanged: 1, refused: 0, failed: 8 });
    const states = await listNetworkSourceStates(database.db);
    expect(states.find((state) => state.id === 'aws-ip-ranges')?.checkFailures).toBe(2);
  });

  it('counts a refusal apart from a failure', async () => {
    now = at(0);
    const fake = publisher({ [TOR]: 'not an exit list\n' });
    const result = await runNetworkRefresh(deps(fake.http));
    expect(result.refused).toBe(1);
    expect(result.failed).toBe(8);
  });
});
