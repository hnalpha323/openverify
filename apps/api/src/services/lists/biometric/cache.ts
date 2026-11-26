/**
 * C99.7 (Workflow 7B; P08, F39): a worker's decrypted copy of a face list's templates: an LRU of at
 * most 64 MB, keyed by list and version, with a ten-minute idle expiry. A list has one copy: another
 * version evicts it, and so does anything `reconcile` finds changed, archived or gone. Whatever
 * leaves is overwritten first, so a template does not linger until the collector runs.
 *
 * A gallery is safe only while the caller holds no `await` between reading it and scoring it, since
 * another job's eviction wipes it; the matcher scans synchronously. A list larger than the bound is
 * left to the caller, who wipes it.
 *
 * Nothing here is logged: the counters are the only thing that leaves.
 */
import type { ListStatus } from '@openverify/core';
import type { Clock } from '../../../ports.js';

/** One template: its item, the model that made it, and its unit vector. */
export interface GalleryFace {
  itemId: string;
  model: string;
  vector: Float32Array;
}

export type FaceGallery = readonly GalleryFace[];

export interface BiometricCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  entries: number;
  bytes: number;
}

/** What a list must still be for its copy to stay. */
export interface CachedListState {
  version: number;
  status: ListStatus;
}

export interface BiometricCache {
  get(listId: string, version: number): FaceGallery | null;
  /** Holds `gallery`; `false` when it is larger than the bound, and the caller must wipe it. */
  set(listId: string, version: number, gallery: FaceGallery): boolean;
  evict(listId: string): void;
  /** Evicts the lists idle past the expiry; answers how many went. */
  sweepIdle(): number;
  /** Evicts every list whose state differs from `states`, a list not in it included. */
  reconcile(states: ReadonlyMap<string, CachedListState>): void;
  clear(): void;
  listIds(): string[];
  stats(): BiometricCacheStats;
}

export interface BiometricCacheOptions {
  maxBytes: number;
  idleMs: number;
  clock: Clock;
}

/**
 * Each face's object, array slot, typed-array header and two short strings: 297 B measured on
 * Node 22 over 10,000 faces (`docs/tdd/phase7-api-biometric-lists.tdd.md`).
 */
const FACE_OVERHEAD_BYTES = 300;

interface Entry {
  version: number;
  gallery: FaceGallery;
  bytes: number;
  usedAt: number;
}

const galleryBytes = (gallery: FaceGallery): number =>
  gallery.reduce((total, face) => total + face.vector.byteLength + FACE_OVERHEAD_BYTES, 0);

/** Overwrites the templates of `gallery`. */
export function wipeGallery(gallery: FaceGallery): void {
  for (const face of gallery) {
    face.vector.fill(0);
  }
}

export function createBiometricCache(options: BiometricCacheOptions): BiometricCache {
  const { maxBytes, idleMs, clock } = options;
  /** In use order: the first is the least recently used. */
  const entries = new Map<string, Entry>();
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  const now = () => clock.now().getTime();
  const isIdle = (entry: Entry) => now() - entry.usedAt >= idleMs;

  function evict(listId: string): void {
    const entry = entries.get(listId);
    if (entry === undefined) {
      return;
    }
    entries.delete(listId);
    bytes -= entry.bytes;
    evictions += 1;
    wipeGallery(entry.gallery);
  }

  return {
    get(listId, version) {
      const entry = entries.get(listId);
      if (entry?.version !== version || isIdle(entry)) {
        evict(listId);
        misses += 1;
        return null;
      }
      entries.delete(listId);
      entries.set(listId, { ...entry, usedAt: now() });
      hits += 1;
      return entry.gallery;
    },
    set(listId, version, gallery) {
      evict(listId);
      const size = galleryBytes(gallery);
      if (size > maxBytes) {
        return false;
      }
      for (const oldest of entries.keys()) {
        if (bytes + size <= maxBytes) {
          break;
        }
        evict(oldest);
      }
      entries.set(listId, { version, gallery, bytes: size, usedAt: now() });
      bytes += size;
      return true;
    },
    evict,
    sweepIdle() {
      const idle = [...entries].filter(([, entry]) => isIdle(entry));
      idle.forEach(([listId]) => {
        evict(listId);
      });
      return idle.length;
    },
    reconcile(states) {
      for (const [listId, entry] of [...entries]) {
        const state = states.get(listId);
        if (state?.status !== 'active' || state.version !== entry.version) {
          evict(listId);
        }
      }
    },
    clear() {
      [...entries.keys()].forEach(evict);
    },
    listIds: () => [...entries.keys()],
    stats: () => ({ hits, misses, evictions, entries: entries.size, bytes }),
  };
}
