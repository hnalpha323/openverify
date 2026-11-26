/**
 * Workflow 8C review K8-8 (C124.7, plan amendments 92, 126): the per-host concurrency of five holds per
 * install, not per process. Two module instances stand in for two workers that share the store; the
 * store being down fails the step closed, retryable. Synthetic hosts only; nothing is sent.
 */
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryKeyValueCache } from '../../../test-support/fakes.js';

describe('withHostSlot across workers (K8-8)', () => {
  it('holds five per install: a second worker sharing the store sees the first’s', async () => {
    const release: (() => void)[] = [];
    const cache = createInMemoryKeyValueCache();
    const first = await import('./handler.js');
    vi.resetModules();
    const second = await import('./handler.js');
    expect(second.withHostSlot).not.toBe(first.withHostSlot);
    const held = Array.from({ length: 5 }, () =>
      first.withHostSlot(
        cache,
        'env_a',
        'fleet.example.com',
        () =>
          new Promise((resolve) => {
            release.push(() => {
              resolve('held');
            });
          }),
      ),
    );
    await expect(
      second.withHostSlot(cache, 'env_a', 'fleet.example.com', () => Promise.resolve('sixth')),
    ).rejects.toMatchObject({ code: 'rate_limited', options: { retryable: true } });
    release.forEach((done) => {
      done();
    });
    await Promise.all(held);
    await expect(
      second.withHostSlot(cache, 'env_a', 'fleet.example.com', () => Promise.resolve('freed')),
    ).resolves.toBe('freed');
  });

  it('fails closed, retryable, when the store cannot answer', async () => {
    const cache = createInMemoryKeyValueCache();
    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));
    const { withHostSlot } = await import('./handler.js');
    let ran = false;
    await expect(
      withHostSlot(cache, 'env_a', 'down.example.com', () => {
        ran = true;
        return Promise.resolve('sent');
      }),
    ).rejects.toMatchObject({ code: 'rate_limited', options: { retryable: true } });
    expect(ran).toBe(false);
  });

  it('gives its place back when the work fails', async () => {
    const cache = createInMemoryKeyValueCache();
    const { withHostSlot } = await import('./handler.js');
    for (let index = 0; index < 6; index += 1) {
      await expect(
        withHostSlot(cache, 'env_a', 'fails.example.com', () =>
          Promise.reject(new Error('synthetic failure')),
        ),
      ).rejects.toThrow('synthetic failure');
    }
    await expect(
      withHostSlot(cache, 'env_a', 'fails.example.com', () => Promise.resolve('sent')),
    ).resolves.toBe('sent');
  });
});
