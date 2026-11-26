/**
 * C232 (Workflow 11A): share tokens, source-environment side (outbound). Every function takes the
 * caller's own environment id; the inbound side (the destination's reads and writes of a row that
 * lives in the source environment) is `connect-share-tokens.cross-env.ts`. The one exception is the
 * minute sweep ({@link expireDueShareTokens}), an install-wide system pass over every environment.
 *
 * Built by `api-connect` over `foundation-11a`'s stubs.
 */
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  connectSharePolicies,
  connectShareTokens,
  consentRecords,
  type ConnectConsentRecord,
  type ConnectShareToken,
  type NewConnectShareToken,
} from '../tables/connect.js';
import { firstOrNull, inserted } from './rows.js';

/** A token's changes; `updatedAt` always moves with them. */
export type ShareTokenChanges = Partial<
  Omit<NewConnectShareToken, 'id' | 'environmentId' | 'createdAt'>
> & { updatedAt: Date };

/**
 * What both sides see beside the token row (C232.3): the policy version it was created under and
 * the source-side consent record's method, categories, biometric flag and text digest. Never the
 * record's evidence or subject.
 */
export interface ShareTokenFacts {
  policyVersion: number;
  consentMethod: ConnectConsentRecord['method'];
  consentCategories: string[];
  consentExplicitBiometric: boolean;
  consentTextSha256: string;
}

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(connectShareTokens.environmentId, environmentId), eq(connectShareTokens.id, id));

/** C232.1: a `created` token with the categories computed at creation. */
export async function createShareToken(
  tx: Db,
  environmentId: string,
  input: Omit<NewConnectShareToken, 'environmentId' | 'status'>,
): Promise<ConnectShareToken> {
  return inserted(
    await tx
      .insert(connectShareTokens)
      .values({
        ...input,
        environmentId,
        status: 'created',
        ...(input.createdAt === undefined ? {} : { updatedAt: input.createdAt }),
      })
      .returning(),
    'createShareToken',
  );
}

/** C232.3: an outbound token of the environment, or null (the caller answers the one 404). */
export async function getOutboundShareToken(
  db: Db,
  environmentId: string,
  id: string,
): Promise<ConnectShareToken | null> {
  return firstOrNull(
    await db.select().from(connectShareTokens).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/** C232.4, C237.2: FOR UPDATE, last in the lock order (connection, consent records, token). */
export async function lockOutboundShareTokenForUpdate(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<ConnectShareToken | null> {
  return firstOrNull(
    await tx
      .select()
      .from(connectShareTokens)
      .where(inEnvironment(environmentId, id))
      .for('update'),
  );
}

/** C232.4-C232.6: a status change with its time and reason. */
export async function updateOutboundShareToken(
  tx: Db,
  environmentId: string,
  id: string,
  changes: ShareTokenChanges,
): Promise<ConnectShareToken> {
  return inserted(
    await tx
      .update(connectShareTokens)
      .set(changes)
      .where(inEnvironment(environmentId, id))
      .returning(),
    'updateOutboundShareToken',
  );
}

/**
 * C232.5: the minute sweep. `created` tokens past `expires-at` become `expired` with
 * `expiry-reason: time`, at most `limit` of them, oldest expiry first, each taken `FOR UPDATE SKIP
 * LOCKED` so a row another transaction holds (a redemption, a deactivation, a withdrawal) is left for
 * the next pass. Returns the tokens it expired.
 */
export async function expireDueShareTokens(
  tx: Db,
  now: Date,
  limit: number,
): Promise<ConnectShareToken[]> {
  const due = await tx
    .select({ id: connectShareTokens.id })
    .from(connectShareTokens)
    .where(and(eq(connectShareTokens.status, 'created'), lte(connectShareTokens.expiresAt, now)))
    .orderBy(asc(connectShareTokens.expiresAt), asc(connectShareTokens.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  if (due.length === 0) {
    return [];
  }
  return tx
    .update(connectShareTokens)
    .set({ status: 'expired', expiryReason: 'time', expiredAt: now, updatedAt: now })
    .where(
      and(
        inArray(
          connectShareTokens.id,
          due.map((row) => row.id),
        ),
        eq(connectShareTokens.status, 'created'),
      ),
    )
    .returning();
}

/** The token that cites a source-side consent record, if any (C232.1's `already_used`). */
export async function shareTokenCitingConsentRecord(
  db: Db,
  environmentId: string,
  consentRecordId: string,
): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ id: connectShareTokens.id })
      .from(connectShareTokens)
      .where(
        and(
          eq(connectShareTokens.environmentId, environmentId),
          eq(connectShareTokens.consentRecordId, consentRecordId),
        ),
      )
      .limit(1),
  );
  return row?.id ?? null;
}

/**
 * C232.1 (lock order: connection, then consent records, then token): the source-side consent
 * record a create cites, FOR UPDATE in the source environment, so a withdrawal (which takes it FOR
 * UPDATE too) and a second create citing it wait for this one. Only the columns coverage reads.
 */
export async function lockConsentRecordForNewShareToken(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<ConnectConsentRecord | null> {
  return firstOrNull(
    await tx
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.environmentId, environmentId), eq(consentRecords.id, id)))
      .for('update'),
  );
}

/** {@link ShareTokenFacts} of tokens of a token-holding column (the source's or the destination's). */
export async function shareTokenFactsWhere(
  db: Db,
  condition: ReturnType<typeof eq>,
  ids: readonly string[],
): Promise<Map<string, ShareTokenFacts>> {
  const facts = new Map<string, ShareTokenFacts>();
  if (ids.length === 0) {
    return facts;
  }
  const rows = await db
    .select({
      id: connectShareTokens.id,
      version: connectSharePolicies.version,
      method: consentRecords.method,
      categories: consentRecords.dataCategories,
      explicitBiometric: consentRecords.explicitBiometric,
      textSha256: consentRecords.textSha256,
    })
    .from(connectShareTokens)
    .innerJoin(
      connectSharePolicies,
      and(
        eq(connectSharePolicies.connectionId, connectShareTokens.connectionId),
        eq(connectSharePolicies.id, connectShareTokens.policyId),
      ),
    )
    .innerJoin(
      consentRecords,
      and(
        eq(consentRecords.environmentId, connectShareTokens.environmentId),
        eq(consentRecords.id, connectShareTokens.consentRecordId),
      ),
    )
    .where(and(condition, inArray(connectShareTokens.id, [...ids])));
  for (const row of rows) {
    facts.set(row.id, {
      policyVersion: row.version,
      consentMethod: row.method,
      consentCategories: row.categories,
      consentExplicitBiometric: row.explicitBiometric,
      consentTextSha256: row.textSha256,
    });
  }
  return facts;
}

/** {@link ShareTokenFacts} of the environment's outbound tokens. */
export function outboundShareTokenFacts(
  db: Db,
  environmentId: string,
  ids: readonly string[],
): Promise<Map<string, ShareTokenFacts>> {
  return shareTokenFactsWhere(db, eq(connectShareTokens.environmentId, environmentId), ids);
}
