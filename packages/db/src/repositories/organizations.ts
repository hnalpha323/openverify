import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  environments,
  organizations,
  type Environment,
  type EnvironmentKind,
  type EnvironmentSettings,
  type Organization,
} from '../schema.js';
import { firstOrNull, inserted } from './rows.js';

export interface NewOrganizationInput {
  id: string;
  name: string;
  /**
   * C168.2 (Workflow 9B Stage 1b (U); decision 45): left out, the column default, `true`: an
   * organisation created from Phase 9 on requires MFA. `seed:dev` and the test tenant pass `false`.
   */
  requireMfa?: boolean;
}

export interface NewEnvironmentInput {
  id: string;
  organizationId: string;
  kind: EnvironmentKind;
}

export async function createOrganization(
  db: Db,
  input: NewOrganizationInput,
): Promise<Organization> {
  const rows = await db
    .insert(organizations)
    .values({
      id: input.id,
      name: input.name,
      ...(input.requireMfa === undefined ? {} : { requireMfa: input.requireMfa }),
    })
    .returning();
  return inserted(rows, 'createOrganization');
}

export async function getOrganization(db: Db, id: string): Promise<Organization | null> {
  return firstOrNull(
    await db.select().from(organizations).where(eq(organizations.id, id)).limit(1),
  );
}

export async function createEnvironment(db: Db, input: NewEnvironmentInput): Promise<Environment> {
  const rows = await db
    .insert(environments)
    .values({ id: input.id, organizationId: input.organizationId, kind: input.kind })
    .returning();
  return inserted(rows, 'createEnvironment');
}

export async function getEnvironment(db: Db, id: string): Promise<Environment | null> {
  return firstOrNull(await db.select().from(environments).where(eq(environments.id, id)).limit(1));
}

/** The organization's sandbox or production environment, e.g. for a new dashboard session. */
export async function findEnvironmentByKind(
  db: Db,
  organizationId: string,
  kind: EnvironmentKind,
): Promise<Environment | null> {
  return firstOrNull(
    await db
      .select()
      .from(environments)
      .where(and(eq(environments.organizationId, organizationId), eq(environments.kind, kind)))
      .limit(1),
  );
}

/** C15 `require-mfa`. `null` when the organization does not exist. */
export async function setOrganizationRequireMfa(
  db: Db,
  id: string,
  requireMfa: boolean,
): Promise<Organization | null> {
  return firstOrNull(
    await db.update(organizations).set({ requireMfa }).where(eq(organizations.id, id)).returning(),
  );
}

/**
 * C231.10 (Workflow 11A; decision 71) `connect-inbound`: whether the organisation receives Connect
 * connections. `null` when the organization does not exist.
 */
export async function setOrganizationConnectInbound(
  db: Db,
  id: string,
  connectInbound: boolean,
): Promise<Organization | null> {
  return firstOrNull(
    await db
      .update(organizations)
      .set({ connectInbound })
      .where(eq(organizations.id, id))
      .returning(),
  );
}

/**
 * C16 `PATCH /dashboard/settings`: merges the given keys into the environment's settings
 * (a `null` value is stored, meaning "keep forever" for `inquiry-retention-days`). Defaults
 * are applied when reading (`resolveRetentionSettings`). `null` when it does not exist.
 */
export async function updateEnvironmentSettings(
  db: Db,
  id: string,
  changes: EnvironmentSettings,
): Promise<Environment | null> {
  return firstOrNull(
    await db
      .update(environments)
      .set({ settings: sql`${environments.settings} || ${JSON.stringify(changes)}::jsonb` })
      .where(eq(environments.id, id))
      .returning(),
  );
}

/** The organization's environments, oldest first (C15 environment switcher). */
export async function listEnvironments(db: Db, organizationId: string): Promise<Environment[]> {
  return db
    .select()
    .from(environments)
    .where(eq(environments.organizationId, organizationId))
    .orderBy(asc(environments.createdAt), asc(environments.id));
}
