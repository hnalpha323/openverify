/**
 * C61.2 (P08): the registers' query cache. It keeps, for at most an hour, what a query resolved to:
 * the id of the record a search found, or that the register does not hold the business (and
 * whether it said so authoritatively). It never keeps a record, an address, an officer or a person
 * with significant control: a record is always fetched by its id, so officers and PSCs are
 * re-queried on every lookup. Keys are `openverify:kyb-registry:<source>:<sha256 of the normalised
 * query>`, so no name or number lies in a key. A cache that fails is skipped, never fatal.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CACHE_KEY_NAMESPACE } from '../../cache/index.js';
import type { KeyValueCache } from '../../ports.js';

/** C61.2: at most an hour. */
export const REGISTRY_QUERY_CACHE_TTL_SECONDS = 3600;

/** What a query resolved to: a record by its id, or none. */
export type RegistryResolution =
  { kind: 'record'; recordId: string } | { kind: 'not_found'; authoritative: boolean };

/** The parts of a query that decide its answer. */
export interface RegistryQuery {
  country: string;
  businessName?: string | undefined;
  registrationNumber?: string | undefined;
  lei?: string | undefined;
}

export interface RegistryQueryCache {
  /** The cached resolution of `query` at `source`, or `null`. */
  get(source: string, query: RegistryQuery): Promise<RegistryResolution | null>;
  /** Keeps `resolution` for an hour. */
  put(source: string, query: RegistryQuery, resolution: RegistryResolution): Promise<void>;
}

const resolutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('record'), recordId: z.string().min(1).max(100) }),
  z.strictObject({ kind: z.literal('not_found'), authoritative: z.boolean() }),
]);

/** The query as its answer reads it: case, spacing and separators do not matter. */
function normalised(query: RegistryQuery): string {
  const text = (value: string | undefined) =>
    (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const compact = (value: string | undefined) =>
    (value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  return JSON.stringify([
    compact(query.country),
    text(query.businessName),
    compact(query.registrationNumber),
    compact(query.lei),
  ]);
}

const keyOf = (source: string, query: RegistryQuery) =>
  `${CACHE_KEY_NAMESPACE}kyb-registry:${source}:${createHash('sha256').update(normalised(query)).digest('hex')}`;

/** The query cache over `cache`; one that keeps nothing without it. */
export function createRegistryQueryCache(cache?: KeyValueCache): RegistryQueryCache {
  return {
    async get(source, query) {
      if (cache === undefined) {
        return null;
      }
      try {
        const stored = await cache.get(keyOf(source, query));
        if (stored === null) {
          return null;
        }
        const parsed = resolutionSchema.safeParse(JSON.parse(stored));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async put(source, query, resolution) {
      if (cache === undefined) {
        return;
      }
      try {
        await cache.set(
          keyOf(source, query),
          JSON.stringify(resolution),
          REGISTRY_QUERY_CACHE_TTL_SECONDS,
        );
      } catch {
        // C61.2: a cache that fails costs a request next time, nothing more.
      }
    },
  };
}
