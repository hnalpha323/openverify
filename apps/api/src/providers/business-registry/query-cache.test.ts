/**
 * C61.2 (P08): the registers' query cache keeps only what a query resolved to (a record id, or a
 * miss and whether it was authoritative) for at most an hour, under a SHA-256 of the normalised
 * query, and is skipped when it fails. No name or number lies in a key or a value.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import {
  REGISTRY_QUERY_CACHE_TTL_SECONDS,
  createRegistryQueryCache,
  type RegistryQuery,
} from './query-cache.js';

const QUERY: RegistryQuery = {
  country: 'GB',
  businessName: 'Utopia Synthetic Widgets Ltd',
  registrationNumber: '01234567',
};

describe('the registry query cache (C61.2)', () => {
  it('keeps a resolution for an hour under the source and a SHA-256 of the query', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const queries = createRegistryQueryCache(cache);

    await queries.put('gleif', QUERY, { kind: 'record', recordId: '5493001KJTIIGC8Y1R12' });

    expect(await queries.get('gleif', QUERY)).toEqual({
      kind: 'record',
      recordId: '5493001KJTIIGC8Y1R12',
    });
    expect(REGISTRY_QUERY_CACHE_TTL_SECONDS).toBe(3600);
    const [key] = cache.keys();
    expect(key).toMatch(/^openverify:kyb-registry:gleif:[0-9a-f]{64}$/);
    const stored = await cache.get(key ?? '');
    for (const text of [key, stored]) {
      expect(text).not.toContain('Utopia');
      expect(text).not.toContain('01234567');
    }
    clock.advance(3601 * 1000);
    expect(await queries.get('gleif', QUERY)).toBeNull();
  });

  it('keeps a miss and whether the register said so authoritatively', async () => {
    const queries = createRegistryQueryCache(createInMemoryKeyValueCache());

    await queries.put('companies-house', QUERY, { kind: 'not_found', authoritative: true });

    expect(await queries.get('companies-house', QUERY)).toEqual({
      kind: 'not_found',
      authoritative: true,
    });
  });

  it('reads a query whatever its case and spacing, and keeps sources and queries apart', async () => {
    const queries = createRegistryQueryCache(createInMemoryKeyValueCache());
    await queries.put('gleif', QUERY, { kind: 'record', recordId: 'A' });

    expect(
      await queries.get('gleif', {
        country: 'gb',
        businessName: '  utopia   SYNTHETIC widgets ltd ',
        registrationNumber: '0123 4567',
      }),
    ).toEqual({ kind: 'record', recordId: 'A' });
    expect(await queries.get('sec-edgar', QUERY)).toBeNull();
    expect(await queries.get('gleif', { ...QUERY, registrationNumber: '07654321' })).toBeNull();
    expect(await queries.get('gleif', { ...QUERY, lei: '5493001KJTIIGC8Y1R12' })).toBeNull();
  });

  it('keeps nothing without a cache', async () => {
    const queries = createRegistryQueryCache();

    await queries.put('gleif', QUERY, { kind: 'record', recordId: 'A' });

    expect(await queries.get('gleif', QUERY)).toBeNull();
  });

  it('is skipped, never fatal, while the cache fails, and ignores a value it did not write', async () => {
    const cache = createInMemoryKeyValueCache();
    const queries = createRegistryQueryCache(cache);

    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));
    await expect(
      queries.put('gleif', QUERY, { kind: 'record', recordId: 'A' }),
    ).resolves.toBeUndefined();
    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));
    expect(await queries.get('gleif', QUERY)).toBeNull();

    await queries.put('gleif', QUERY, { kind: 'record', recordId: 'A' });
    const [key] = cache.keys();
    for (const value of ['not json', '{"kind":"record"}', '{"kind":"not_found"}', '[]']) {
      await cache.set(key ?? '', value, 60);
      expect(await queries.get('gleif', QUERY)).toBeNull();
    }
  });
});
