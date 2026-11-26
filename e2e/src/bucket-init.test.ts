import { describe, expect, it, vi } from 'vitest';
import { waitForBucketInit } from './bucket-init.js';
import { CommandError } from './processes.js';

/** The error a promise rejects with; fails the test when it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (caught) {
    return caught as Error;
  }
  throw new Error('expected a rejection');
}

const LOG_TAIL = 'objectstore-init: versioning on openverify-files is None, expected Enabled';

describe('waitForBucketInit (KP11-68)', () => {
  it('passes when the init exits 0, without reading its log', async () => {
    const saveLog = vi.fn(() => Promise.resolve(''));

    await waitForBucketInit({
      wait: () => Promise.resolve(),
      exitCodes: () => Promise.resolve([0]),
      saveLog,
    });

    expect(saveLog).not.toHaveBeenCalled();
  });

  it("keeps the init's log and quotes its end when `compose wait` fails", async () => {
    const saveLog = vi.fn(() => Promise.resolve(LOG_TAIL));

    const error = await rejectionOf(
      waitForBucketInit({
        wait: () =>
          Promise.reject(new CommandError('docker compose wait failed with exit code 1', 1)),
        exitCodes: () => Promise.resolve([1]),
        saveLog,
      }),
    );

    expect(saveLog).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('docker compose wait failed with exit code 1');
    expect(error.message).toContain(LOG_TAIL);
  });

  it("keeps the init's log when it exited non-zero although `compose wait` returned", async () => {
    const saveLog = vi.fn(() => Promise.resolve(LOG_TAIL));

    const error = await rejectionOf(
      waitForBucketInit({
        wait: () => Promise.resolve(),
        exitCodes: () => Promise.resolve([2]),
        saveLog,
      }),
    );

    expect(saveLog).toHaveBeenCalledOnce();
    expect(error.message).toContain('[2]');
    expect(error.message).toContain(LOG_TAIL);
  });

  it('still fails with the init error when its log cannot be read', async () => {
    const error = await rejectionOf(
      waitForBucketInit({
        wait: () =>
          Promise.reject(new CommandError('docker compose wait failed with exit code 1', 1)),
        exitCodes: () => Promise.resolve([1]),
        saveLog: () => Promise.reject(new Error('no such service')),
      }),
    );

    expect(error.message).toContain('docker compose wait failed with exit code 1');
    expect(error.message).toContain('Its log could not be kept: no such service');
  });
});
