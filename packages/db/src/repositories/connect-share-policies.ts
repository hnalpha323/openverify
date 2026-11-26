/**
 * C230.3, C231.6 (Workflow 11A): a connection's policy versions, own-organisation side. Rows are
 * never updated: a change writes version n+1.
 *
 * Built by `api-connect` over `foundation-11a`'s stubs.
 */
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  connectConnections,
  connectSharePolicies,
  type ConnectSharePolicy,
  type NewConnectSharePolicy,
} from '../tables/connect.js';
import { firstOrNull, inserted } from './rows.js';

/** C231.6: version n+1 of a connection (the caller holds the connection FOR UPDATE). */
export async function createSharePolicyVersion(
  tx: Db,
  input: NewConnectSharePolicy,
): Promise<ConnectSharePolicy> {
  return inserted(
    await tx.insert(connectSharePolicies).values(input).returning(),
    'createSharePolicyVersion',
  );
}

/** A version of a connection the organisation is a side of, or null. */
export async function getSharePolicyVersion(
  db: Db,
  organizationId: string,
  policyId: string,
): Promise<ConnectSharePolicy | null> {
  const rows = await db
    .select({ policy: connectSharePolicies })
    .from(connectSharePolicies)
    .innerJoin(connectConnections, eq(connectConnections.id, connectSharePolicies.connectionId))
    .where(
      and(
        eq(connectSharePolicies.id, policyId),
        or(
          eq(connectConnections.sourceOrganizationId, organizationId),
          eq(connectConnections.destinationOrganizationId, organizationId),
        ),
      ),
    )
    .limit(1);
  return firstOrNull(rows)?.policy ?? null;
}

/**
 * The versions of one connection with these ids (the current, the accepted, a token's), for a
 * connection the caller already holds. Ids of another connection are not returned.
 */
export async function getSharePoliciesOfConnection(
  db: Db,
  connectionId: string,
  policyIds: readonly string[],
): Promise<ConnectSharePolicy[]> {
  if (policyIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(connectSharePolicies)
    .where(
      and(
        eq(connectSharePolicies.connectionId, connectionId),
        inArray(connectSharePolicies.id, [...policyIds]),
      ),
    );
}

/** C242.1: every version of a connection, oldest first, for the console's diff. */
export async function listSharePolicyVersions(
  db: Db,
  organizationId: string,
  connectionId: string,
): Promise<ConnectSharePolicy[]> {
  const rows = await db
    .select({ policy: connectSharePolicies })
    .from(connectSharePolicies)
    .innerJoin(connectConnections, eq(connectConnections.id, connectSharePolicies.connectionId))
    .where(
      and(
        eq(connectSharePolicies.connectionId, connectionId),
        or(
          eq(connectConnections.sourceOrganizationId, organizationId),
          eq(connectConnections.destinationOrganizationId, organizationId),
        ),
      ),
    )
    .orderBy(asc(connectSharePolicies.version));
  return rows.map((row) => row.policy);
}
