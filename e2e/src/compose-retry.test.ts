import { describe, expect, it } from 'vitest';
import { composeUpWithRetry, isPortAllocationError } from './compose-retry.js';
import { CommandError } from './processes.js';

const failed = (lines: string) =>
  new CommandError(`docker compose up failed with exit code 1. Last lines:\n${lines}`, 1);

const ALLOCATED = failed(
  'Error response from daemon: driver failed programming external connectivity on endpoint ' +
    'openverify-e2e-postgres-1: Bind for 127.0.0.1:54321 failed: port is already allocated',
);
const UNAVAILABLE = failed(
  'Error response from daemon: Ports are not available: exposing port TCP 127.0.0.1:54322 -> ' +
    '0.0.0.0:0: listen tcp 127.0.0.1:54322: bind: address already in use',
);

function steps(failures: Error[]) {
  const calls: string[] = [];
  return {
    calls,
    up: () => {
      calls.push('up');
      const failure = failures.shift();
      return failure === undefined ? Promise.resolve() : Promise.reject(failure);
    },
    down: () => {
      calls.push('down');
      return Promise.resolve();
    },
    pause: () => {
      calls.push('pause');
      return Promise.resolve();
    },
    log: (message: string) => calls.push(`log: ${message}`),
  };
}

describe('isPortAllocationError (P5-5)', () => {
  it('knows the Docker port-allocation refusals', () => {
    expect(isPortAllocationError(ALLOCATED)).toBe(true);
    expect(isPortAllocationError(UNAVAILABLE)).toBe(true);
  });

  it('knows nothing else', () => {
    expect(
      isPortAllocationError(failed('dependency failed to start: container is unhealthy')),
    ).toBe(false);
    expect(isPortAllocationError(new Error('port is already allocated'))).toBe(false);
    expect(isPortAllocationError('port is already allocated')).toBe(false);
  });
});

describe('composeUpWithRetry (P5-5)', () => {
  it('takes the project down and runs up once more after a port-allocation error', async () => {
    const run = steps([ALLOCATED]);
    await composeUpWithRetry(run);
    expect(run.calls).toEqual([
      'up',
      'log: compose up met a port-allocation error; taking the project down and trying once more',
      'down',
      'pause',
      'up',
    ]);
  });

  it('fails the run when the second up fails too, with the second error', async () => {
    const run = steps([ALLOCATED, UNAVAILABLE]);
    await expect(composeUpWithRetry(run)).rejects.toBe(UNAVAILABLE);
    expect(run.calls.filter((call) => call === 'up')).toHaveLength(2);
  });

  it('never retries another failure', async () => {
    const unhealthy = failed('dependency failed to start: container is unhealthy');
    const run = steps([unhealthy]);
    await expect(composeUpWithRetry(run)).rejects.toBe(unhealthy);
    expect(run.calls).toEqual(['up']);
  });
});
