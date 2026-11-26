/**
 * C250.1 (Phase 11, Workflow 11B, platform-ops): the readiness check behind `GET /ready`. Postgres
 * `SELECT 1` and Valkey `PING` run at once, each within `READINESS_CHECK_TIMEOUT_MS`; the answer is
 * 200 `{status: 'ready'}`, or 503 naming each store `ok` or `unavailable` and never an error's
 * text. Readiness only, never liveness: it says the process reaches its stores now, nothing about
 * the vision service or a provider (C250.6).
 */
import {
  READINESS_CHECK_TIMEOUT_MS,
  type NotReadyResponse,
  type readyResponseSchema,
} from '@openverify/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ApiDependencies } from '../services/context.js';

/** One store's check: resolves when the store answered, rejects otherwise. */
export type ReadinessProbe = () => Promise<unknown>;

/** The stores `/ready` asks. */
export interface ReadinessProbes {
  readonly postgres: ReadinessProbe;
  readonly valkey: ReadinessProbe;
}

/** What `/ready` answers. */
export type ReadinessAnswer =
  | { readonly statusCode: 200; readonly body: z.infer<typeof readyResponseSchema> }
  | { readonly statusCode: 503; readonly body: NotReadyResponse };

type CheckState = NotReadyResponse['checks']['postgres'];

/** `ok` when `probe` answers within `timeoutMs`, else `unavailable`; the timer never outlives it. */
async function stateOf(probe: ReadinessProbe, timeoutMs: number): Promise<CheckState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<CheckState>((resolve) => {
    timer = setTimeout(() => {
      resolve('unavailable');
    }, timeoutMs);
  });
  const answered = (async (): Promise<CheckState> => {
    try {
      await probe();
      return 'ok';
    } catch {
      // A store's error text never reaches the answer (C250.1).
      return 'unavailable';
    }
  })();
  try {
    return await Promise.race([answered, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Asks every store at once, each within `timeoutMs`. */
export async function checkReadiness(
  probes: ReadinessProbes,
  timeoutMs: number = READINESS_CHECK_TIMEOUT_MS,
): Promise<ReadinessAnswer> {
  const [postgres, valkey] = await Promise.all([
    stateOf(probes.postgres, timeoutMs),
    stateOf(probes.valkey, timeoutMs),
  ]);
  if (postgres === 'ok' && valkey === 'ok') {
    return { statusCode: 200, body: { status: 'ready' } };
  }
  return { statusCode: 503, body: { status: 'not_ready', checks: { postgres, valkey } } };
}

/**
 * The key `/ready` reads: one round trip to Valkey through the API's cache client (the API holds no
 * other client of its own), never written, so the answer is always `null`.
 */
export const READINESS_CACHE_KEY = 'openverify:ready';

/** The API's own stores: Postgres through its pool (`SELECT 1`), Valkey through its cache client. */
export function readinessProbesOf(api: Pick<ApiDependencies, 'db' | 'cache'>): ReadinessProbes {
  return {
    postgres: () => api.db.execute(sql`select 1`),
    valkey: () => api.cache.get(READINESS_CACHE_KEY),
  };
}

/** An app built without stores reaches none: both checks fail. */
export const NO_STORES: ReadinessProbes = Object.freeze({
  postgres: () => Promise.reject(new Error('no Postgres configured')),
  valkey: () => Promise.reject(new Error('no Valkey configured')),
});
