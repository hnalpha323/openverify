// @ts-check
import { describe, expect, it } from 'vitest';
import { READ_PHASES, reuseReads, timeReads } from './benchmark-reads.mjs';

/** A clock the fake reads advance, so each read takes a known time. */
function fakeReads() {
  let now = 0;
  /** @type {string[]} */
  const calls = [];
  const wait = async (/** @type {number} */ ms) => {
    now += ms;
    await Promise.resolve();
  };
  const reads = {
    getWatchlistSourceStates: async (/** @type {unknown} */ _db, /** @type {string[]} */ ids) => {
      calls.push(`state:${ids.join(',')}`);
      await wait(2);
      return ids.map((id) => ({ id }));
    },
    retrieveCandidates: async (
      /** @type {unknown} */ _db,
      /** @type {{ cap: number }} */ query,
    ) => {
      calls.push(`retrieve:${String(query.cap)}`);
      await wait(30);
      return {
        candidates: Array.from({ length: query.cap }, (_, index) => index),
        truncated: true,
      };
    },
    loadEntries: async (/** @type {unknown} */ _db, /** @type {{ entries: string[] }} */ input) => {
      calls.push(`load:${String(input.entries.length)}`);
      await wait(5);
      return input.entries;
    },
  };
  return { reads, calls, clock: () => now };
}

describe('timeReads (every member, by phase)', () => {
  it('adds each read’s duration to its phase and records each retrieval', async () => {
    const fake = fakeReads();
    const realNow = performance.now.bind(performance);
    performance.now = fake.clock;
    try {
      const timed = timeReads(fake.reads);
      await timed.reads.getWatchlistSourceStates({}, ['a', 'b']);
      await timed.reads.retrieveCandidates({}, { cap: 3 });
      await timed.reads.retrieveCandidates({}, { cap: 2 });
      await timed.reads.loadEntries({}, { entries: ['x'] });

      expect(timed.take()).toEqual({
        phases: { state: 2, retrieve: 60, load: 5 },
        retrievals: [
          { candidates: 3, truncated: true, capReached: true, unreachable: false },
          { candidates: 2, truncated: true, capReached: true, unreachable: false },
        ],
      });
      expect(timed.take()).toEqual({ phases: { state: 0, retrieve: 0, load: 0 }, retrievals: [] });
      expect(Object.keys(timed.take().phases)).toEqual(['state', 'retrieve', 'load']);
    } finally {
      performance.now = realNow;
    }
  });

  it('records whether a retrieval was cut at the cap or out of reach, beside truncated (calibration-6c follow-up)', async () => {
    const answers = [
      { candidates: [1], truncated: true, capReached: false, unreachable: true },
      { candidates: [1, 2], truncated: true, capReached: true, unreachable: false },
      { candidates: [], truncated: false, capReached: false, unreachable: false },
      // A tree before Workflow 6C answers without the members: its truncated is the cap.
      { candidates: [1, 2, 3], truncated: true },
    ];
    let next = 0;
    const timed = timeReads({ retrieveCandidates: async () => answers[next++] });

    for (const answer of answers) {
      expect(await timed.reads.retrieveCandidates()).toBe(answer);
    }

    expect(timed.take().retrievals).toEqual([
      { candidates: 1, truncated: true, capReached: false, unreachable: true },
      { candidates: 2, truncated: true, capReached: true, unreachable: false },
      { candidates: 0, truncated: false, capReached: false, unreachable: false },
      { candidates: 3, truncated: true, capReached: true, unreachable: false },
    ]);
  });

  it('passes the arguments and answers through, and keeps a non-function member as it is', async () => {
    const fake = fakeReads();
    const timed = timeReads({ ...fake.reads, version: 'v1' });

    await expect(timed.reads.getWatchlistSourceStates({}, ['s1'])).resolves.toEqual([{ id: 's1' }]);
    await expect(timed.reads.loadEntries({}, { entries: ['e1', 'e2'] })).resolves.toEqual([
      'e1',
      'e2',
    ]);
    expect(timed.reads.version).toBe('v1');
    expect(fake.calls).toEqual(['state:s1', 'load:2']);
  });

  it('wraps a member it does not know and reports its time under its own name', async () => {
    const fake = fakeReads();
    const realNow = performance.now.bind(performance);
    performance.now = fake.clock;
    try {
      const timed = timeReads({
        ...fake.reads,
        listSourceScripts: async () => {
          await Promise.resolve();
          performance.now = () => fake.clock() + 7;
          return ['latin'];
        },
      });

      await expect(timed.reads.listSourceScripts()).resolves.toEqual(['latin']);
      expect(timed.take().phases).toEqual({ state: 0, retrieve: 0, load: 0, listSourceScripts: 7 });
    } finally {
      performance.now = realNow;
    }
  });

  it('names the three phases of the frozen reads', () => {
    expect(READ_PHASES).toEqual({
      getWatchlistSourceStates: 'state',
      retrieveCandidates: 'retrieve',
      loadEntries: 'load',
    });
  });
});

describe('reuseReads (one query’s answers across the presets)', () => {
  it('answers a repeated read from the first call until cleared, whatever the database handle', async () => {
    const fake = fakeReads();
    const reused = reuseReads(fake.reads);

    const first = reused.reads.retrieveCandidates({ handle: 1 }, { cap: 2 });
    const again = reused.reads.retrieveCandidates({ handle: 2 }, { cap: 2 });
    await reused.reads.retrieveCandidates({}, { cap: 3 });
    await reused.reads.loadEntries({}, { entries: ['a'] });
    await reused.reads.loadEntries({}, { entries: ['a'] });

    expect(again).toBe(first);
    expect(fake.calls).toEqual(['retrieve:2', 'retrieve:3', 'load:1']);
    reused.clear();
    await reused.reads.retrieveCandidates({}, { cap: 2 });
    expect(fake.calls).toEqual(['retrieve:2', 'retrieve:3', 'load:1', 'retrieve:2']);
  });

  it('keeps the answers of each member apart, and reuses a member it does not know', async () => {
    let scripts = 0;
    const fake = fakeReads();
    const reused = reuseReads({
      ...fake.reads,
      listSourceScripts: async (/** @type {unknown} */ _db, /** @type {string} */ id) => {
        scripts += 1;
        await Promise.resolve();
        return [id];
      },
      label: 'kept',
    });

    await reused.reads.getWatchlistSourceStates({}, ['x']);
    await reused.reads.loadEntries({}, { entries: ['x'] });
    await reused.reads.listSourceScripts({}, 'x');
    await reused.reads.listSourceScripts({}, 'x');

    expect(fake.calls).toEqual(['state:x', 'load:1']);
    expect(scripts).toBe(1);
    expect(reused.reads.label).toBe('kept');
  });
});
