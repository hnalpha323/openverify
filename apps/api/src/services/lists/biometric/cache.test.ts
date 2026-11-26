/**
 * C99.7 (Workflow 7B; P08, F39): the decrypted cache: keyed by list and version, bounded in bytes,
 * idle out after ten minutes, and wiped on every way out. Vectors are seeded numbers.
 */
import { describe, expect, it } from 'vitest';
import { createBiometricCache, type FaceGallery } from './cache.js';
import { BIOMETRIC_CACHE_BYTES, BIOMETRIC_CACHE_IDLE_MS } from './thresholds.js';

const IDLE_MS = 600_000;

function gallery(items: number): FaceGallery {
  return Array.from({ length: items }, (_, index) => ({
    itemId: `lifc_${String(index)}`,
    model: 'sface-synthetic',
    vector: new Float32Array(128).fill(1 / Math.sqrt(128)),
  }));
}

function cache(maxBytes = 1_000_000) {
  let now = 0;
  const instance = createBiometricCache({
    maxBytes,
    idleMs: IDLE_MS,
    clock: { now: () => new Date(now) },
  });
  return {
    instance,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the bounds', () => {
  it('holds the bounds of C99.7: 64 MB and ten minutes', () => {
    expect(BIOMETRIC_CACHE_BYTES).toBe(64 * 1024 * 1024);
    expect(BIOMETRIC_CACHE_IDLE_MS).toBe(IDLE_MS);
  });
});

describe('a read', () => {
  it('finds what it holds, under the same list and version', () => {
    const { instance } = cache();
    const faces = gallery(2);
    instance.set('lst_a', 3, faces);
    expect(instance.get('lst_a', 3)).toBe(faces);
    expect(instance.stats()).toMatchObject({ hits: 1, misses: 0, entries: 1 });
  });

  it('misses on an unknown list', () => {
    const { instance } = cache();
    expect(instance.get('lst_a', 3)).toBeNull();
    expect(instance.stats()).toMatchObject({ hits: 0, misses: 1 });
  });

  it('evicts and wipes the copy of another version (C99.7)', () => {
    const { instance } = cache();
    const faces = gallery(1);
    instance.set('lst_a', 3, faces);
    expect(instance.get('lst_a', 4)).toBeNull();
    expect(faces[0]?.vector.every((value) => value === 0)).toBe(true);
    expect(instance.stats()).toMatchObject({ entries: 0, bytes: 0, evictions: 1 });
  });

  it('keeps one copy per list', () => {
    const { instance } = cache();
    instance.set('lst_a', 3, gallery(1));
    instance.set('lst_a', 4, gallery(1));
    expect(instance.stats().entries).toBe(1);
    expect(instance.get('lst_a', 4)).not.toBeNull();
  });
});

describe('the byte bound', () => {
  it('counts each vector and its overhead', () => {
    const { instance } = cache();
    instance.set('lst_a', 1, gallery(10));
    expect(instance.stats().bytes).toBeGreaterThanOrEqual(10 * 512);
    expect(instance.stats().bytes).toBeLessThan(10 * 1024);
  });

  it('evicts the least recently used list first', () => {
    const size = cache().instance;
    size.set('lst_a', 1, gallery(10));
    const { bytes } = size.stats();
    const { instance } = cache(bytes * 2);
    const first = gallery(10);
    instance.set('lst_a', 1, first);
    instance.set('lst_b', 1, gallery(10));
    expect(instance.get('lst_a', 1)).toBe(first);
    instance.set('lst_c', 1, gallery(10));
    expect(instance.get('lst_b', 1)).toBeNull();
    expect(instance.get('lst_a', 1)).toBe(first);
    expect(instance.stats().bytes).toBeLessThanOrEqual(bytes * 2);
  });

  it('never holds a list larger than the bound, and wipes nothing the caller still reads', () => {
    const { instance } = cache(100);
    const faces = gallery(10);
    instance.set('lst_a', 1, faces);
    expect(instance.stats()).toMatchObject({ entries: 0, bytes: 0 });
    expect(faces[0]?.vector.some((value) => value !== 0)).toBe(true);
  });
});

describe('the idle expiry', () => {
  it('drops a list ten minutes after its last read', () => {
    const { instance, advance } = cache();
    const faces = gallery(1);
    instance.set('lst_a', 1, faces);
    advance(IDLE_MS - 1);
    expect(instance.get('lst_a', 1)).toBe(faces);
    advance(IDLE_MS - 1);
    expect(instance.get('lst_a', 1)).toBe(faces);
    advance(IDLE_MS);
    expect(instance.get('lst_a', 1)).toBeNull();
    expect(faces[0]?.vector.every((value) => value === 0)).toBe(true);
  });

  it('drops idle lists on a sweep, with no read', () => {
    const { instance, advance } = cache();
    instance.set('lst_a', 1, gallery(1));
    advance(IDLE_MS / 2);
    instance.set('lst_b', 1, gallery(1));
    advance(IDLE_MS / 2);
    expect(instance.sweepIdle()).toBe(1);
    expect(instance.listIds()).toEqual(['lst_b']);
  });
});

describe('eviction', () => {
  it('evicts and wipes one list', () => {
    const { instance } = cache();
    const faces = gallery(1);
    instance.set('lst_a', 1, faces);
    instance.set('lst_b', 1, gallery(1));
    instance.evict('lst_a');
    expect(faces[0]?.vector.every((value) => value === 0)).toBe(true);
    expect(instance.listIds()).toEqual(['lst_b']);
  });

  it('asks nothing of a list it does not hold', () => {
    const { instance } = cache();
    instance.evict('lst_a');
    expect(instance.stats().evictions).toBe(0);
  });

  it('reconciles with the lists as they stand: changed, archived or gone (C99.7)', () => {
    const { instance } = cache();
    instance.set('lst_same', 2, gallery(1));
    instance.set('lst_moved', 2, gallery(1));
    instance.set('lst_archived', 2, gallery(1));
    instance.set('lst_gone', 2, gallery(1));
    instance.reconcile(
      new Map([
        ['lst_same', { version: 2, status: 'active' as const }],
        ['lst_moved', { version: 3, status: 'active' as const }],
        ['lst_archived', { version: 2, status: 'archived' as const }],
      ]),
    );
    expect(instance.listIds()).toEqual(['lst_same']);
  });

  it('clears everything, wiped', () => {
    const { instance } = cache();
    const faces = gallery(1);
    instance.set('lst_a', 1, faces);
    instance.clear();
    expect(instance.stats()).toMatchObject({ entries: 0, bytes: 0 });
    expect(faces[0]?.vector.every((value) => value === 0)).toBe(true);
  });
});

describe('the hit rate', () => {
  it('counts hits and misses for the record', () => {
    const { instance } = cache();
    instance.get('lst_a', 1);
    instance.set('lst_a', 1, gallery(1));
    instance.get('lst_a', 1);
    instance.get('lst_a', 1);
    expect(instance.stats()).toMatchObject({ hits: 2, misses: 1 });
  });
});
