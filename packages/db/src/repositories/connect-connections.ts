/**
 * C230.5, C231 (Workflow 11A): the connection repository, own-organisation side. A connection is
 * organisation-scoped and either side reads it through its own organisation id; nothing here takes
 * another organisation's environment id. Those functions are in `connect-connections.cross-env.ts`,
 * which only `apps/api/src/services/connect/cross-tenant.ts` imports (C240.5, V04).
 *
 * The agreement reference is sealed for its row (`connect_connections.agreement_reference#<id>`) on
 * write and opened on read, so callers hold plaintext only ({@link ConnectConnectionRecord}).
 *
 * Built by `api-connect` over `foundation-11a`'s stubs.
 */
import { and, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { InvalidCursorError } from '../errors.js';
import { SEALED } from '../encrypted-columns.js';
import { openOptional, sealOptional } from '../sealed.js';
import {
  connectConnections,
  connectSharePolicies,
  type ConnectConnection,
  type ConnectSharePolicy,
} from '../tables/connect.js';
import { pageSize, type Page, type PageRequest } from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted } from './rows.js';

/** A connection with its agreement reference opened (plaintext, or `null` before activation). */
export type ConnectConnectionRecord = Omit<ConnectConnection, 'agreementReference'> & {
  agreementReference: string | null;
};

export type ConnectionStatusValue = ConnectConnection['status'];

/** What C231.1's create writes: the connection, then its version 1, in one transaction. */
export interface NewConnectionInput {
  id: string;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  creatorType: ConnectConnection['creatorType'];
  creatorId: string;
  policyId: string;
  /** The version-1 body (`storedSharePolicySchema`). */
  policy: Record<string, unknown>;
  /** Tests stamp it; the default is the database's `now()`. */
  createdAt?: Date | undefined;
}

/** C231.3-C231.6: a status change with its times, sides and accepted policy. */
export interface ConnectionChanges {
  status?: ConnectConnection['status'];
  currentPolicyId?: string;
  acceptedPolicyId?: string | null;
  /** Plaintext; sealed here for the row. */
  agreementReference?: string | null;
  activatedAt?: Date | null;
  activatedByUserId?: string | null;
  deactivatedAt?: Date | null;
  deactivatedBy?: ConnectConnection['deactivatedBy'];
  updatedAt: Date;
}

/** C231.2's filters (both directions; `archived` is never listed, C230.2). */
export interface ConnectionFilters {
  statuses?: readonly ConnectConnection['status'][] | undefined;
  destinationOrganizationIds?: readonly string[] | undefined;
}

const AGREEMENT = SEALED.connectAgreementReference;

const opened = (row: ConnectConnection): ConnectConnectionRecord => ({
  ...row,
  agreementReference: openOptional(AGREEMENT, row.id, row.agreementReference),
});

/** The organisation is a side of the connection. */
const sideOf = (organizationId: string): SQL =>
  sql`(${connectConnections.sourceOrganizationId} = ${organizationId}
    or ${connectConnections.destinationOrganizationId} = ${organizationId})`;

/** C231.1: a `pending` connection with its policy version 1, in `tx`. */
export async function createConnection(
  tx: Db,
  input: NewConnectionInput,
): Promise<{ connection: ConnectConnectionRecord; policy: ConnectSharePolicy }> {
  await tx.insert(connectConnections).values({
    id: input.id,
    sourceOrganizationId: input.sourceOrganizationId,
    destinationOrganizationId: input.destinationOrganizationId,
    status: 'pending',
    creatorType: input.creatorType,
    creatorId: input.creatorId,
    ...(input.createdAt === undefined
      ? {}
      : { createdAt: input.createdAt, updatedAt: input.createdAt }),
  });
  const policy = inserted(
    await tx
      .insert(connectSharePolicies)
      .values({
        id: input.policyId,
        connectionId: input.id,
        version: 1,
        body: input.policy,
        createdByType: input.creatorType,
        createdById: input.creatorId,
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      })
      .returning(),
    'createConnection: policy',
  );
  const connection = inserted(
    await tx
      .update(connectConnections)
      .set({ currentPolicyId: policy.id })
      .where(eq(connectConnections.id, input.id))
      .returning(),
    'createConnection',
  );
  return { connection: opened(connection), policy };
}

/** Whether the ordered pair already has a connection, whatever its status (C231.1). */
export async function connectionExistsForPair(
  db: Db,
  sourceOrganizationId: string,
  destinationOrganizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: connectConnections.id })
    .from(connectConnections)
    .where(
      and(
        eq(connectConnections.sourceOrganizationId, sourceOrganizationId),
        eq(connectConnections.destinationOrganizationId, destinationOrganizationId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** C231.2: a connection the organisation is a side of, or null (the caller answers the one 404). */
export async function getConnectionOfOrganization(
  db: Db,
  organizationId: string,
  id: string,
): Promise<ConnectConnectionRecord | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(connectConnections)
      .where(and(eq(connectConnections.id, id), sideOf(organizationId)))
      .limit(1),
  );
  return row === null ? null : opened(row);
}

/**
 * C231.2: both directions, newest first (C1: `created_at DESC, id DESC`), never `archived`. An
 * `after` id that is not a connection of the organisation raises {@link InvalidCursorError}.
 */
export async function listConnectionsOfOrganization(
  db: Db,
  organizationId: string,
  filters: ConnectionFilters,
  page: PageRequest,
): Promise<Page<ConnectConnectionRecord>> {
  const conditions = allFilters([
    sideOf(organizationId),
    ne(connectConnections.status, 'archived'),
    equalsAny(connectConnections.status, filters.statuses),
    equalsAny(connectConnections.destinationOrganizationId, filters.destinationOrganizationIds),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  const size = pageSize(page.size);
  const { after } = page;
  const afterCondition =
    after === undefined
      ? undefined
      : sql`(${connectConnections.createdAt}, ${connectConnections.id}) < (
          select c.created_at, c.id from connect_connections as c
           where c.id = ${after}
             and (c.source_organization_id = ${organizationId}
               or c.destination_organization_id = ${organizationId}))`;
  const rows = await db
    .select()
    .from(connectConnections)
    .where(and(...conditions, afterCondition))
    .orderBy(desc(connectConnections.createdAt), desc(connectConnections.id))
    .limit(size + 1);
  if (rows.length === 0 && after !== undefined) {
    const found = await db
      .select({ id: connectConnections.id })
      .from(connectConnections)
      .where(and(eq(connectConnections.id, after), sideOf(organizationId)))
      .limit(1);
    if (found.length === 0) {
      throw new InvalidCursorError();
    }
  }
  const items = rows.slice(0, size).map(opened);
  const last = items.at(-1);
  return { items, next: rows.length > size && last !== undefined ? last.id : null };
}

/** C231.4 (C287.2's lock order: connection, then consent records, then token): FOR UPDATE. */
export async function lockConnectionForUpdate(
  tx: Db,
  organizationId: string,
  id: string,
): Promise<ConnectConnectionRecord | null> {
  const row = firstOrNull(
    await tx
      .select()
      .from(connectConnections)
      .where(and(eq(connectConnections.id, id), sideOf(organizationId)))
      .for('update'),
  );
  return row === null ? null : opened(row);
}

/**
 * C232.1, C234.2: FOR SHARE, so a deactivation (FOR UPDATE) waits for a token create or a
 * redemption's commit, and they wait for it.
 */
export async function lockConnectionForShare(
  tx: Db,
  organizationId: string,
  id: string,
): Promise<ConnectConnectionRecord | null> {
  const row = firstOrNull(
    await tx
      .select()
      .from(connectConnections)
      .where(and(eq(connectConnections.id, id), sideOf(organizationId)))
      .for('share'),
  );
  return row === null ? null : opened(row);
}

/** C231.3-C231.6: a status change with its times, sides and accepted policy. */
export async function updateConnection(
  tx: Db,
  id: string,
  changes: ConnectionChanges,
): Promise<ConnectConnectionRecord> {
  const { agreementReference, ...rest } = changes;
  const row = inserted(
    await tx
      .update(connectConnections)
      .set({
        ...rest,
        ...(agreementReference === undefined
          ? {}
          : { agreementReference: sealOptional(AGREEMENT, id, agreementReference) }),
      })
      .where(eq(connectConnections.id, id))
      .returning(),
    'updateConnection',
  );
  return opened(row);
}
