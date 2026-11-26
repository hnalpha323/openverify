import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  idempotencyKeys,
  type IdempotencyKeyRow,
  type PrincipalType,
  type StoredResponseHeaders,
} from '../schema.js';
import { openOptional, sealOptional } from '../sealed.js';
import { firstOrNull } from './rows.js';
import { subjectIdsIn } from './subject-ids.js';

/** C12: keys are kept 24 hours. */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 3_600_000;
/** How long a claim holds the key before another request may take it over. */
export const IDEMPOTENCY_LEASE_MS = 120_000;

export interface ClaimIdempotencyKeyInput {
  principalType: PrincipalType;
  /** `key_...` or `usr_...`. */
  principalId: string;
  /** The `Idempotency-Key` header: 1-255 printable ASCII characters. */
  key: string;
  /** SHA-256 hex of method, route and canonical body (C12). */
  fingerprint: string;
  /** Defaults to now. */
  now?: Date;
  /** Defaults to 24 hours. */
  ttlMs?: number;
  /**
   * How long this claim holds the key; afterwards a retry may take it over, so a request
   * that died cannot block its key for 24 hours. Defaults to two minutes.
   */
  leaseMs?: number;
}

/** A completed response, as an idempotent replay returns it. */
export interface StoredResponse {
  status: number;
  headers: StoredResponseHeaders;
  body: string | null;
}

/**
 * - `claimed`: the caller owns the key and must complete or release it (`id`);
 * - `replay`: the same request already completed; answer with the stored response;
 * - `mismatch`: the key was used with another request (422 `idempotency-key-reused`);
 * - `in_progress`: the same request is still running (409 `idempotency-key-in-use`).
 */
export type IdempotencyClaim =
  | {
      outcome: 'claimed';
      id: number;
      /**
       * This claim's lease. Pass it to {@link completeIdempotencyKey} and
       * {@link releaseIdempotencyKey}, so a request that outlived its lease cannot settle a key
       * another request took over (Workflow 2B F014).
       */
      lockedUntil?: Date;
    }
  | { outcome: 'replay'; response: StoredResponse }
  | { outcome: 'mismatch' }
  | { outcome: 'in_progress' };

export interface IdempotentResponse {
  status: number;
  /** `content-type` and `location` (C12). */
  headers: StoredResponseHeaders;
  /** The raw response body; sealed for the row. */
  body: string | null;
  /** The resource the response is about, so C16 redaction can drop this copy. */
  resourceId?: string | null;
}

const inEnvironment = (environmentId: string, id: number) =>
  and(eq(idempotencyKeys.id, id), eq(idempotencyKeys.environmentId, environmentId));

function storedResponse(row: IdempotencyKeyRow): StoredResponse {
  return {
    status: row.responseStatus ?? 0,
    headers: row.responseHeaders ?? {},
    body: openOptional(SEALED.idempotencyResponseBody, String(row.id), row.responseBodySealed),
  };
}

/**
 * C12 claim: insert-or-get of `(environment, principal, key)` in one transaction. A new
 * key, an expired one, or one whose holder's lease ran out is claimed; otherwise the
 * stored state decides (see {@link IdempotencyClaim}). Concurrent claims of a new key are
 * settled by the unique index: exactly one inserts, the others read its row.
 */
export async function claimIdempotencyKey(
  db: Db,
  environmentId: string,
  input: ClaimIdempotencyKeyInput,
): Promise<IdempotencyClaim> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? IDEMPOTENCY_KEY_TTL_MS));
  const lockedUntil = new Date(now.getTime() + (input.leaseMs ?? IDEMPOTENCY_LEASE_MS));
  const claim = {
    fingerprint: input.fingerprint,
    state: 'in_progress' as const,
    lockedUntil,
    responseStatus: null,
    responseHeaders: null,
    responseBodySealed: null,
    resourceId: null,
    subjectIds: [],
    expiresAt,
  };
  return db.transaction(async (tx) => {
    const created = firstOrNull(
      await tx
        .insert(idempotencyKeys)
        .values({
          environmentId,
          principalType: input.principalType,
          principalId: input.principalId,
          key: input.key,
          ...claim,
        })
        .onConflictDoNothing({
          target: [
            idempotencyKeys.environmentId,
            idempotencyKeys.principalType,
            idempotencyKeys.principalId,
            idempotencyKeys.key,
          ],
        })
        .returning({ id: idempotencyKeys.id }),
    );
    if (created !== null) {
      return { outcome: 'claimed' as const, id: created.id, lockedUntil };
    }
    const existing = firstOrNull(
      await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.environmentId, environmentId),
            eq(idempotencyKeys.principalType, input.principalType),
            eq(idempotencyKeys.principalId, input.principalId),
            eq(idempotencyKeys.key, input.key),
          ),
        )
        .for('update'),
    );
    if (existing === null) {
      // Released between the insert and the read: the next attempt will claim it.
      return { outcome: 'in_progress' as const };
    }
    const expired = existing.expiresAt.getTime() <= now.getTime();
    const abandoned =
      existing.state === 'in_progress' &&
      existing.fingerprint === input.fingerprint &&
      (existing.lockedUntil?.getTime() ?? 0) <= now.getTime();
    if (expired || abandoned) {
      await tx.update(idempotencyKeys).set(claim).where(inEnvironment(environmentId, existing.id));
      return { outcome: 'claimed' as const, id: existing.id, lockedUntil };
    }
    if (existing.fingerprint !== input.fingerprint) {
      return { outcome: 'mismatch' as const };
    }
    if (existing.state === 'in_progress') {
      return { outcome: 'in_progress' as const };
    }
    return { outcome: 'replay' as const, response: storedResponse(existing) };
  });
}

/** Which claim settles a key: the lease its claim returned. */
export interface IdempotencyHolder {
  /** The claim's `lockedUntil`; when given, only that claim can settle the key. */
  lockedUntil?: Date | undefined;
}

/** The key is still held by the claim whose lease is `holder.lockedUntil`, when given. */
const heldBy = (holder: IdempotencyHolder) =>
  holder.lockedUntil === undefined
    ? undefined
    : eq(idempotencyKeys.lockedUntil, holder.lockedUntil);

/**
 * Stores the response of a claimed key (a non-5xx answer), so retries replay it. Returns
 * `false` when the key is not held here, or no longer by `holder`.
 */
export async function completeIdempotencyKey(
  db: Db,
  environmentId: string,
  id: number,
  response: IdempotentResponse,
  holder: IdempotencyHolder = {},
): Promise<boolean> {
  const rows = await db
    .update(idempotencyKeys)
    .set({
      state: 'completed',
      lockedUntil: null,
      responseStatus: response.status,
      responseHeaders: response.headers,
      responseBodySealed: sealOptional(SEALED.idempotencyResponseBody, String(id), response.body),
      resourceId: response.resourceId ?? null,
      subjectIds: subjectIdsIn(response.resourceId, response.body),
    })
    .where(
      and(
        inEnvironment(environmentId, id),
        eq(idempotencyKeys.state, 'in_progress'),
        heldBy(holder),
      ),
    )
    .returning({ id: idempotencyKeys.id });
  return rows.length > 0;
}

/**
 * C12 5xx: the response is not stored and the key is released for a retry. `false` when the
 * key is not held here, or no longer by `holder`.
 */
export async function releaseIdempotencyKey(
  db: Db,
  environmentId: string,
  id: number,
  holder: IdempotencyHolder = {},
): Promise<boolean> {
  const rows = await db
    .delete(idempotencyKeys)
    .where(
      and(
        inEnvironment(environmentId, id),
        eq(idempotencyKeys.state, 'in_progress'),
        heldBy(holder),
      ),
    )
    .returning({ id: idempotencyKeys.id });
  return rows.length > 0;
}
