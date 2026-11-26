/**
 * C240.5 (V04), Workflow 11A: the policy repository's cross-environment read. Only
 * `apps/api/src/services/connect/cross-tenant.ts` imports this module.
 *
 * Built by `api-connect` over `foundation-11a`'s stubs.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  connectSharePolicies,
  connectShareTokens,
  type ConnectSharePolicy,
} from '../tables/connect.js';
import { firstOrNull } from './rows.js';

/** C233.4, C234.2: the version an inbound token was created under, read by its destination. */
export async function getInboundTokenPolicy(
  db: Db,
  destinationEnvironmentId: string,
  shareTokenId: string,
): Promise<ConnectSharePolicy | null> {
  const rows = await db
    .select({ policy: connectSharePolicies })
    .from(connectShareTokens)
    .innerJoin(
      connectSharePolicies,
      and(
        eq(connectSharePolicies.connectionId, connectShareTokens.connectionId),
        eq(connectSharePolicies.id, connectShareTokens.policyId),
      ),
    )
    .where(
      and(
        eq(connectShareTokens.id, shareTokenId),
        eq(connectShareTokens.destinationEnvironmentId, destinationEnvironmentId),
      ),
    )
    .limit(1);
  return firstOrNull(rows)?.policy ?? null;
}
