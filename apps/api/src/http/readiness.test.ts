/**
 * C250.1: `/ready`'s check over fake stores. Both stores are asked at once, each within its own
 * deadline (`READINESS_CHECK_TIMEOUT_MS`, driven by fake timers), and a refusal names only the
 * store, never the error's text. The real stores are `ready.integration.test.ts`'s.
 */
import {
  notReadyResponseSchema,
  READINESS_CHECK_TIMEOUT_MS,
  readyResponseSchema,
} from '@openverify/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkReadiness, type ReadinessProbe } from './readiness.js';

afterEach(() => {
  vi.useRealTimers();
});

const ok: ReadinessProbe = () => Promise.resolve('PONG');
const refused: ReadinessProbe = () =>
  Promise.reject(new Error('synthetic: connect ECONNREFUSED 192.0.2.10:5432'));
const hanging: ReadinessProbe = () => new Promise<never>(() => undefined);

describe('checkReadiness (C250.1)', () => {
  it('answers 200 ready when both stores answer', async () => {
    const answer = await checkReadiness({ postgres: ok, valkey: ok });

    expect(answer).toEqual({ statusCode: 200, body: { status: 'ready' } });
    expect(readyResponseSchema.parse(answer.body)).toEqual(answer.body);
  });

  it('answers 503 naming each store that failed, and no error text', async () => {
    for (const [probes, checks] of [
      [
        { postgres: refused, valkey: ok },
        { postgres: 'unavailable', valkey: 'ok' },
      ],
      [
        { postgres: ok, valkey: refused },
        { postgres: 'ok', valkey: 'unavailable' },
      ],
      [
        { postgres: refused, valkey: refused },
        { postgres: 'unavailable', valkey: 'unavailable' },
      ],
    ] as const) {
      const answer = await checkReadiness(probes);

      expect(answer).toEqual({ statusCode: 503, body: { status: 'not_ready', checks } });
      expect(notReadyResponseSchema.parse(answer.body)).toEqual(answer.body);
      expect(JSON.stringify(answer)).not.toContain('ECONNREFUSED');
    }
  });

  it('counts a store that does not answer within its deadline as unavailable', async () => {
    vi.useFakeTimers();
    const answer = checkReadiness({ postgres: ok, valkey: hanging });
    let settled = false;
    void answer.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(READINESS_CHECK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await answer).toEqual({
      statusCode: 503,
      body: { status: 'not_ready', checks: { postgres: 'ok', valkey: 'unavailable' } },
    });
  });

  it('asks both stores at once, so two slow stores cost one deadline', async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const answer = checkReadiness(
      {
        postgres: () => {
          asked.push('postgres');
          return hanging();
        },
        valkey: () => {
          asked.push('valkey');
          return hanging();
        },
      },
      250,
    );

    expect(asked).toEqual(['postgres', 'valkey']);
    await vi.advanceTimersByTimeAsync(250);
    expect((await answer).statusCode).toBe(503);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves no timer behind when the stores answer first', async () => {
    vi.useFakeTimers();
    await checkReadiness({ postgres: ok, valkey: ok });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts a probe that throws before it returns a promise as unavailable', async () => {
    const answer = await checkReadiness({
      postgres: () => {
        throw new Error('synthetic: pool closed');
      },
      valkey: ok,
    });
    expect(answer.statusCode).toBe(503);
  });
});
