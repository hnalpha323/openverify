/**
 * C240.5 (V04), Workflow 11A: share tokens read and written from the other side. A token row lives
 * in the source environment, so every read by the destination, every write by a counterparty (a
 * deactivation by the destination expiring the source's tokens) and the access export's read of
 * both sides are here. Only `apps/api/src/services/connect/cross-tenant.ts` imports this module
 * (through `@openverify/db/cross-env`), and it calls each function with an environment or connection
 * already bound to the caller.
 *
 * Built by `api-connect` over `foundation-11a`'s stubs.
 */
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { InvalidCursorError } from '../errors.js';
import { connectShareTokens, type ConnectShareToken } from '../tables/connect.js';
import {
  shareTokenFactsWhere,
  type ShareTokenChanges,
  type ShareTokenFacts,
} from './connect-share-tokens.js';
import { pageSize, type Page, type PageRequest } from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

const inbound = (destinationEnvironmentId: string, id: string) =>
  and(
    eq(connectShareTokens.destinationEnvironmentId, destinationEnvironmentId),
    eq(connectShareTokens.id, id),
  );

/** C232.3: a token inbound to the destination environment, or null (the one 404). */
export async function getInboundShareToken(
  db: Db,
  destinationEnvironmentId: string,
  id: string,
): Promise<ConnectShareToken | null> {
  return firstOrNull(
    await db
      .select()
      .from(connectShareTokens)
      .where(inbound(destinationEnvironmentId, id))
      .limit(1),
  );
}

/** C232.2's filters; `direction` absent means both. */
export interface ShareTokenListFilters {
  direction?: 'outbound' | 'inbound' | undefined;
  connectionIds?: readonly string[] | undefined;
  statuses?: readonly ConnectShareToken['status'][] | undefined;
}

/**
 * C232.2: the environment's outbound tokens and the tokens inbound to it, newest first (C1:
 * `created_at DESC, id DESC`). A self-connection's token, whose source and destination environments
 * are the caller's, is listed once. An `after` id that is neither raises {@link InvalidCursorError}.
 */
export async function listShareTokensOfEnvironment(
  db: Db,
  environmentId: string,
  filters: ShareTokenListFilters,
  page: PageRequest,
): Promise<Page<ConnectShareToken>> {
  const outbound = eq(connectShareTokens.environmentId, environmentId);
  const inboundToIt = eq(connectShareTokens.destinationEnvironmentId, environmentId);
  const side =
    filters.direction === 'outbound'
      ? outbound
      : filters.direction === 'inbound'
        ? inboundToIt
        : sql`(${outbound} or ${inboundToIt})`;
  const conditions = allFilters([
    side,
    equalsAny(connectShareTokens.connectionId, filters.connectionIds),
    equalsAny(connectShareTokens.status, filters.statuses),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  const size = pageSize(page.size);
  const { after } = page;
  const afterCondition =
    after === undefined
      ? undefined
      : sql`(${connectShareTokens.createdAt}, ${connectShareTokens.id}) < (
          select t.created_at, t.id from connect_share_tokens as t
           where t.id = ${after}
             and (t.environment_id = ${environmentId}
               or t.destination_environment_id = ${environmentId}))`;
  const rows = await db
    .select()
    .from(connectShareTokens)
    .where(and(...conditions, afterCondition))
    .orderBy(desc(connectShareTokens.createdAt), desc(connectShareTokens.id))
    .limit(size + 1);
  if (rows.length === 0 && after !== undefined) {
    const found = await db
      .select({ id: connectShareTokens.id })
      .from(connectShareTokens)
      .where(and(eq(connectShareTokens.id, after), or(outbound, inboundToIt)))
      .limit(1);
    if (found.length === 0) {
      throw new InvalidCursorError();
    }
  }
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, next: rows.length > size && last !== undefined ? last.id : null };
}

/** C233.5, C234.1: FOR UPDATE by the destination (peek count, redemption's synchronous part). */
export async function lockInboundShareTokenForUpdate(
  tx: Db,
  destinationEnvironmentId: string,
  id: string,
): Promise<ConnectShareToken | null> {
  return firstOrNull(
    await tx
      .select()
      .from(connectShareTokens)
      .where(inbound(destinationEnvironmentId, id))
      .for('update'),
  );
}

/** C233.5, C234: a change the destination makes to an inbound token (peek count, status). */
export async function updateInboundShareToken(
  tx: Db,
  destinationEnvironmentId: string,
  id: string,
  changes: ShareTokenChanges,
): Promise<ConnectShareToken> {
  return inserted(
    await tx
      .update(connectShareTokens)
      .set(changes)
      .where(inbound(destinationEnvironmentId, id))
      .returning(),
    'updateInboundShareToken',
  );
}

/**
 * C231.4: a deactivation, by either side, expires the connection's `created` tokens (both
 * environment kinds) with `expiry-reason: connection_deactivated`. The caller holds the connection
 * FOR UPDATE (the lock order: connection, consent records, token); the tokens are taken FOR UPDATE
 * here, so a redemption holding one finishes first.
 */
export async function expireCreatedTokensOfConnection(
  tx: Db,
  connectionId: string,
  now: Date,
): Promise<ConnectShareToken[]> {
  const created = await tx
    .select({ id: connectShareTokens.id })
    .from(connectShareTokens)
    .where(
      and(
        eq(connectShareTokens.connectionId, connectionId),
        eq(connectShareTokens.status, 'created'),
      ),
    )
    .for('update');
  if (created.length === 0) {
    return [];
  }
  return tx
    .update(connectShareTokens)
    .set({
      status: 'expired',
      expiryReason: 'connection_deactivated',
      expiredAt: now,
      updatedAt: now,
    })
    .where(
      and(
        inArray(
          connectShareTokens.id,
          created.map((row) => row.id),
        ),
        eq(connectShareTokens.status, 'created'),
      ),
    )
    .returning();
}

/**
 * C237.2: a withdrawal of a consent record of `environmentId` expires the `created` token that
 * cites it, with `expiry-reason: consent_withdrawn`: a source record cited as the token's
 * `consent-record-id` (the token lives in the same environment), or a destination record about an
 * inbound token (its `share-token-id`; the token lives in the source environment). The caller holds
 * the record FOR UPDATE; the token is taken FOR UPDATE here. Returns the token it expired, if any.
 */
export async function expireCreatedTokenCitingConsentRecord(
  tx: Db,
  environmentId: string,
  consentRecordId: string,
  now: Date,
): Promise<ConnectShareToken | null> {
  const cited = firstOrNull(
    await tx
      .select({ id: connectShareTokens.id })
      .from(connectShareTokens)
      .where(
        and(
          eq(connectShareTokens.status, 'created'),
          or(
            and(
              eq(connectShareTokens.environmentId, environmentId),
              eq(connectShareTokens.consentRecordId, consentRecordId),
            ),
            and(
              eq(connectShareTokens.destinationEnvironmentId, environmentId),
              sql`${connectShareTokens.id} = (
                select r.share_token_id from consent_records as r
                 where r.environment_id = ${environmentId}
                   and r.id = ${consentRecordId}
                   and r.side = 'destination')`,
            ),
          ),
        ),
      )
      .for('update'),
  );
  if (cited === null) {
    return null;
  }
  return inserted(
    await tx
      .update(connectShareTokens)
      .set({
        status: 'expired',
        expiryReason: 'consent_withdrawn',
        expiredAt: now,
        updatedAt: now,
      })
      .where(eq(connectShareTokens.id, cited.id))
      .returning(),
    'expireCreatedTokenCitingConsentRecord',
  );
}

/** {@link ShareTokenFacts} of tokens inbound to the destination environment (C232.3). */
export function inboundShareTokenFacts(
  db: Db,
  destinationEnvironmentId: string,
  ids: readonly string[],
): Promise<Map<string, ShareTokenFacts>> {
  return shareTokenFactsWhere(
    db,
    eq(connectShareTokens.destinationEnvironmentId, destinationEnvironmentId),
    ids,
  );
}

/**
 * C253.2 (11B's access export; C240.5): the tokens touching these objects on either side: a source
 * of the environment, a destination copy in it, or an inquiry reserved for a client-side redemption
 * in it. Newest first.
 */
export async function listSharesTouching(
  db: Db,
  environmentId: string,
  objectIds: readonly string[],
): Promise<ConnectShareToken[]> {
  if (objectIds.length === 0) {
    return [];
  }
  const ids = [...objectIds];
  return db
    .select()
    .from(connectShareTokens)
    .where(
      or(
        and(
          eq(connectShareTokens.environmentId, environmentId),
          inArray(connectShareTokens.sourceId, ids),
        ),
        and(
          eq(connectShareTokens.destinationEnvironmentId, environmentId),
          or(
            inArray(connectShareTokens.destinationId, ids),
            inArray(connectShareTokens.reservedInquiryId, ids),
          ),
        ),
      ),
    )
    .orderBy(desc(connectShareTokens.createdAt), desc(connectShareTokens.id));
}
