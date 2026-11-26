/**
 * Workflow 11B Stage 1b common (foundation-11b; review F30): every hook is a call in a shared file
 * to a stub in its owner's file, and each stub keeps today's behaviour until its owner builds it.
 * These tests hold that behaviour; each owner replaces its stub's test with its own, test-first.
 */
import { describe, expect, it, vi } from 'vitest';
import { logStartupWarnings } from './config/startup-warnings.js';
import { drainWorkers } from './worker-health/drain.js';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("the platform-ops stubs keep today's behaviour", () => {
  it('closes the workers, as the worker did (worker-health/drain.ts)', async () => {
    const close = vi.fn(() => Promise.resolve());
    await drainWorkers({ close }, { logger: silent });
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('the start-up warnings (C249.1, C249.2)', () => {
  it('logs each at warn with its code and its store or variable, never a value', () => {
    const logger = { warn: vi.fn() };
    logStartupWarnings(logger, [
      { code: 'insecure_transport', store: 'postgres', reason: 'Postgres is plain text.' },
      { code: 'secret_file_readable', variable: 'OPENVERIFY_KEK_FILE', reason: 'world-readable' },
    ]);
    expect(logger.warn.mock.calls).toEqual([
      [{ code: 'insecure_transport', store: 'postgres' }, 'Postgres is plain text.'],
      [{ code: 'secret_file_readable', variable: 'OPENVERIFY_KEK_FILE' }, 'world-readable'],
    ]);
  });
});
