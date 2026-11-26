/**
 * C253.5, C253.7, C250.7 (Workflow 11B, `dsar-export`): the access export's rate gate fails closed
 * through the one helper, and each refusal is counted by its registered metric, labelled by the
 * environment only.
 */
import { RATE_LIMIT_DEFAULTS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { AppError, RateLimitedError } from '../../errors.js';
import { metrics } from '../../metrics-registry.js';
import type { RateLimitDecision, RateLimiter, RateLimitRule } from '../../ports.js';
import {
  accountExportItemRedacted,
  accountExportPending,
  accountExportTooLarge,
  accountExportUnavailable,
} from './problems.js';
import {
  accountExportRefusalOf,
  countAccountExportRefusal,
  enforceAccountExportRate,
} from './refusals.js';

const ENVIRONMENT = 'env_01M5CN0000000000000011BD01';

function recordingLogger() {
  const lines: { object: Record<string, unknown>; message: string }[] = [];
  return {
    lines,
    logger: {
      info: (object: Record<string, unknown>, message: string) => {
        lines.push({ object, message });
      },
    },
  };
}

function limiter(answer: () => Promise<RateLimitDecision>) {
  const calls: { key: string; rule: RateLimitRule }[] = [];
  const port: RateLimiter = {
    consume: (key, rule) => {
      calls.push({ key, rule });
      return answer();
    },
  };
  return { port, calls };
}

const decision = (allowed: boolean): RateLimitDecision => ({
  allowed,
  limit: 10,
  remaining: allowed ? 9 : 0,
  resetAt: new Date('2026-11-13T12:00:00.000Z'),
  retryAfterSeconds: allowed ? 0 : 120,
});

describe('enforceAccountExportRate (C253.7)', () => {
  it('counts one use of account-export under the environment id and emits nothing when allowed', async () => {
    const { port, calls } = limiter(() => Promise.resolve(decision(true)));
    const { logger, lines } = recordingLogger();

    await enforceAccountExportRate(port, logger, ENVIRONMENT);

    expect(calls).toEqual([
      {
        key: ENVIRONMENT,
        rule: expect.objectContaining({
          name: 'account-export',
          limit: RATE_LIMIT_DEFAULTS['account-export'],
        }) as RateLimitRule,
      },
    ]);
    expect(lines).toEqual([]);
  });

  it('answers 429 past the limit and counts account_export_refused_rate_limited', async () => {
    const { port } = limiter(() => Promise.resolve(decision(false)));
    const { logger, lines } = recordingLogger();

    await expect(enforceAccountExportRate(port, logger, ENVIRONMENT)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    expect(lines).toEqual([
      {
        object: {
          metric: 'account_export_refused_rate_limited',
          value: 1,
          environmentId: ENVIRONMENT,
        },
        message: 'metric',
      },
    ]);
  });

  it('fails closed with 503 account_export_unavailable when the store does not answer, counted', async () => {
    const { port } = limiter(() => Promise.reject(new Error('synthetic store outage')));
    const { logger, lines } = recordingLogger();

    const refused = enforceAccountExportRate(port, logger, ENVIRONMENT);

    await expect(refused).rejects.toBeInstanceOf(AppError);
    await expect(refused).rejects.toMatchObject({
      status: 503,
      code: 'account_export_unavailable',
    });
    expect(lines.map((line) => line.object)).toEqual([
      { metric: 'account_export_refused_unavailable', value: 1, environmentId: ENVIRONMENT },
    ]);
  });
});

describe('the refusal counters (C250.7)', () => {
  it('names the refusal of each access export problem, and none for any other error', () => {
    expect(accountExportRefusalOf(accountExportPending())).toBe('pending');
    expect(accountExportRefusalOf(accountExportTooLarge(5001))).toBe('too_large');
    expect(accountExportRefusalOf(accountExportUnavailable())).toBe('unavailable');
    expect(accountExportRefusalOf(new RateLimitedError('synthetic', 60))).toBe('rate_limited');
    expect(accountExportRefusalOf(accountExportItemRedacted())).toBeNull();
    expect(accountExportRefusalOf(new Error('synthetic'))).toBeNull();
    expect(accountExportRefusalOf('synthetic')).toBeNull();
  });

  it('emits each registered counter with the environment as its only label', () => {
    for (const refusal of ['pending', 'rate_limited', 'too_large', 'unavailable'] as const) {
      const { logger, lines } = recordingLogger();

      countAccountExportRefusal(logger, ENVIRONMENT, refusal);

      const name = `account_export_refused_${refusal}`;
      expect(metrics.get(name)?.labels).toEqual(['environmentId']);
      expect(lines).toEqual([
        { object: { metric: name, value: 1, environmentId: ENVIRONMENT }, message: 'metric' },
      ]);
    }
  });
});
