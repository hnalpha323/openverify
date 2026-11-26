/**
 * C240.5 (V04), Workflow 11A: the connection repository's cross-environment functions, which read
 * the counterparty organisation's rows (its environments, its name, its opt-in). Only
 * `apps/api/src/services/connect/cross-tenant.ts` imports this module (through
 * `@openverify/db/cross-env`), as the ESLint rule and the source test hold.
 *
 * Built by `api-connect` over `foundation-11a`'s stubs. Every function here takes a connection
 * already bound to the caller, or (for the create) the organisation the caller named.
 */
import { and, asc, eq, or } from 'drizzle-orm';
import type { Db } from '../client.js';
import { connectConnections } from '../tables/connect.js';
import { environments, organizations } from '../tables/tenancy.js';
import { firstOrNull } from './rows.js';

export interface CounterpartyEnvironment {
  id: string;
  kind: 'sandbox' | 'production';
}

/**
 * C239.1: the environments of an organisation that is a side of the connection, where its events
 * and audit entries go; empty when the organisation is not a side of it.
 */
export async function counterpartyEnvironments(
  db: Db,
  connectionId: string,
  counterpartyOrganizationId: string,
): Promise<CounterpartyEnvironment[]> {
  const rows = await db
    .select({ id: environments.id, kind: environments.kind })
    .from(environments)
    .innerJoin(
      connectConnections,
      and(
        eq(connectConnections.id, connectionId),
        or(
          eq(connectConnections.sourceOrganizationId, counterpartyOrganizationId),
          eq(connectConnections.destinationOrganizationId, counterpartyOrganizationId),
        ),
      ),
    )
    .where(eq(environments.organizationId, counterpartyOrganizationId))
    .orderBy(asc(environments.createdAt), asc(environments.id));
  return rows;
}

/** C232.1 (connect R13): the destination organisation's environment of the caller's kind, or null. */
export async function destinationEnvironmentOfKind(
  db: Db,
  connectionId: string,
  kind: 'sandbox' | 'production',
): Promise<string | null> {
  const row = firstOrNull(
    await db
      .select({ id: environments.id })
      .from(connectConnections)
      .innerJoin(
        environments,
        and(
          eq(environments.organizationId, connectConnections.destinationOrganizationId),
          eq(environments.kind, kind),
        ),
      )
      .where(eq(connectConnections.id, connectionId))
      .limit(1),
  );
  return row?.id ?? null;
}

/** C230.2: both sides' organisation names of a connection the caller is a side of. */
export async function connectionOrganizationNames(
  db: Db,
  connectionId: string,
): Promise<{ source: string; destination: string } | null> {
  const source = await db
    .select({ name: organizations.name })
    .from(connectConnections)
    .innerJoin(organizations, eq(organizations.id, connectConnections.sourceOrganizationId))
    .where(eq(connectConnections.id, connectionId))
    .limit(1);
  const destination = await db
    .select({ name: organizations.name })
    .from(connectConnections)
    .innerJoin(organizations, eq(organizations.id, connectConnections.destinationOrganizationId))
    .where(eq(connectConnections.id, connectionId))
    .limit(1);
  const [sourceRow] = source;
  const [destinationRow] = destination;
  return sourceRow === undefined || destinationRow === undefined
    ? null
    : { source: sourceRow.name, destination: destinationRow.name };
}

/**
 * C231.1, C231.10: the organisation a create names, if it exists and has opted in to inbound
 * connections; `null` otherwise (the caller answers one byte-identical 422 for both).
 */
export async function inboundOrganization(
  db: Db,
  organizationId: string,
): Promise<{ id: string } | null> {
  const row = firstOrNull(
    await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), eq(organizations.connectInbound, true)))
      .limit(1),
  );
  return row;
}
