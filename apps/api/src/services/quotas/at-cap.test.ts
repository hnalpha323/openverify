/**
 * C251.4 (Workflow 11B, `quotas`): a warn line when an environment sits at a queue's cap for more
 * than five minutes, once for each time it reaches the cap; times from the injected clock only.
 */
import { describe, expect, it } from 'vitest';
import { createAtCapWatch, QUEUE_AT_CAP_WARN_AFTER_MS } from './at-cap.js';

const ENV_A = 'env_01J0000000000000000000000A';
const ENV_B = 'env_01J0000000000000000000000B';

function frozenClock(start: string) {
  let now = new Date(start);
  return {
    clock: { now: () => new Date(now) },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

const atCap = (environmentId = ENV_A) =>
  ({ environmentId, queue: 'report-run', inFlight: 50, cap: 50 }) as const;
const below = (environmentId = ENV_A) =>
  ({ environmentId, queue: 'report-run', inFlight: 49, cap: 50 }) as const;

describe('the at-cap watch (C251.4)', () => {
  it('waits five minutes', () => {
    expect(QUEUE_AT_CAP_WARN_AFTER_MS).toBe(300_000);
  });

  it('warns once an environment has sat at its cap for more than five minutes', () => {
    const time = frozenClock('2026-11-13T10:00:00.000Z');
    const watch = createAtCapWatch(time.clock);
    expect(watch.observe(atCap())).toBeNull();
    time.advance(QUEUE_AT_CAP_WARN_AFTER_MS);
    // Exactly five minutes is not more than five.
    expect(watch.observe(atCap())).toBeNull();
    time.advance(1);
    expect(watch.observe(atCap())).toEqual({
      ...atCap(),
      atCapSince: new Date('2026-11-13T10:00:00.000Z'),
      atCapMs: QUEUE_AT_CAP_WARN_AFTER_MS + 1,
    });
  });

  it('warns once for each time the cap is reached', () => {
    const time = frozenClock('2026-11-13T10:00:00.000Z');
    const watch = createAtCapWatch(time.clock);
    watch.observe(atCap());
    time.advance(QUEUE_AT_CAP_WARN_AFTER_MS + 1);
    expect(watch.observe(atCap())).not.toBeNull();
    time.advance(QUEUE_AT_CAP_WARN_AFTER_MS * 3);
    expect(watch.observe(atCap())).toBeNull();
    // A slot frees: the next time at the cap starts its own five minutes.
    expect(watch.observe(below())).toBeNull();
    expect(watch.observe(atCap())).toBeNull();
    time.advance(QUEUE_AT_CAP_WARN_AFTER_MS + 1);
    expect(watch.observe(atCap())?.atCapMs).toBe(QUEUE_AT_CAP_WARN_AFTER_MS + 1);
  });

  it('counts a reading above the cap (a lowered cap) as at the cap', () => {
    const time = frozenClock('2026-11-13T10:00:00.000Z');
    const watch = createAtCapWatch(time.clock);
    watch.observe({ environmentId: ENV_A, queue: 'list-screen', inFlight: 70, cap: 10 });
    time.advance(QUEUE_AT_CAP_WARN_AFTER_MS + 1);
    expect(
      watch.observe({ environmentId: ENV_A, queue: 'list-screen', inFlight: 12, cap: 10 }),
    ).toMatchObject({ queue: 'list-screen', inFlight: 12, cap: 10 });
  });

  it('keeps each environment and queue apart', () => {
    const time = frozenClock('2026-11-13T10:00:00.000Z');
    const watch = createAtCapWatch(time.clock);
    watch.observe(atCap(ENV_A));
    time.advance(QUEUE_AT_CAP_WARN_AFTER_MS);
    watch.observe(atCap(ENV_B));
    watch.observe({ environmentId: ENV_A, queue: 'list-screen', inFlight: 50, cap: 50 });
    expect(watch.size()).toBe(3);
    time.advance(1);
    expect(watch.observe(atCap(ENV_A))).not.toBeNull();
    expect(watch.observe(atCap(ENV_B))).toBeNull();
    expect(
      watch.observe({ environmentId: ENV_A, queue: 'list-screen', inFlight: 50, cap: 50 }),
    ).toBeNull();
    watch.observe(below(ENV_A));
    expect(watch.size()).toBe(2);
  });

  it('forgets the pairs of a queue a sweep did not read, so a later backlog starts afresh', () => {
    const time = frozenClock('2026-11-13T10:00:00.000Z');
    const watch = createAtCapWatch(time.clock);
    watch.observe(atCap(ENV_A));
    watch.observe(atCap(ENV_B));
    watch.observe({ environmentId: ENV_A, queue: 'list-screen', inFlight: 50, cap: 50 });
    watch.retain('report-run', new Set([ENV_B]));
    // Another queue's pairs stay.
    expect(watch.size()).toBe(2);
    time.advance(QUEUE_AT_CAP_WARN_AFTER_MS + 1);
    expect(watch.observe(atCap(ENV_A))).toBeNull();
    expect(watch.observe(atCap(ENV_B))).not.toBeNull();
    expect(
      watch.observe({ environmentId: ENV_A, queue: 'list-screen', inFlight: 50, cap: 50 }),
    ).not.toBeNull();
  });
});
