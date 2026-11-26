/**
 * C125 (Workflow 8A): `workflow_secrets` and `workflow_secret_values`. Owner: `api-egress`;
 * `foundation-8a` (Stage 1b (X)) froze the signatures.
 *
 * Everything but {@link openWorkflowSecretValue} answers metadata: no other function returns a value,
 * so a reader of this file can tell where one comes out. A value is sealed for its row
 * (`SEALED.workflowSecretValue`, `SEALED.workflowSecretPreviousValue`), and a value function acts on
 * the one environment it is given (C125.2).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  environments,
  workflowSecrets,
  workflowSecretValues,
  workflowVersions,
  type WorkflowSecretPlacements,
  type WorkflowSecretRow,
} from '../schema.js';
import { openValue, sealValue } from '../sealed.js';
import { paginate, type CursorTable, type Page, type PageRequest } from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

export interface WorkflowSecret {
  id: string;
  organizationId: string;
  key: string;
  description: string | null;
  allowedHosts: readonly string[];
  allowedPlacements: WorkflowSecretPlacements;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewWorkflowSecret {
  id: string;
  key: string;
  description?: string | null | undefined;
  allowedHosts: readonly string[];
  /** Left out, the table's default holds: `authorization` and no pointer (P29). */
  allowedPlacements?: WorkflowSecretPlacements | undefined;
  createdBy: string;
}

export interface WorkflowSecretChanges {
  description?: string | null | undefined;
  allowedHosts?: readonly string[] | undefined;
  allowedPlacements?: WorkflowSecretPlacements | undefined;
}

/** What a reader sees of a value: never the value (C125.2). */
export interface WorkflowSecretValueMeta {
  id: string;
  secretId: string;
  environmentId: string;
  last4: string;
  version: number;
  rotatedBy: string | null;
  rotatedAt: Date | null;
  previousExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowSecretValueInput {
  /** The row a new value is sealed to; an existing row keeps its own. */
  id: string;
  organizationId: string;
  secretId: string;
  environmentId: string;
  value: string;
  actorId: string;
}

/** C125.2: the old value keeps verifying until `previousExpiresAt`, for a signing secret. */
export interface WorkflowSecretRotation extends WorkflowSecretValueInput {
  rotatedAt: Date;
  previousExpiresAt: Date;
}

/** C125.3: what publishing reads of a secret. */
export interface WorkflowSecretFacts {
  allowedHosts: readonly string[];
  /** Lower-cased header names. */
  headers: readonly string[];
  bodyPointers: readonly string[];
  hasValue: boolean;
}

/** C124.6: every value a request may be signed with, the previous one while it still holds. */
export interface OpenedWorkflowSecretValue {
  value: string;
  previousValue: string | null;
}

/**
 * What a console shows of a value. A short value is not shown at all, because its last four would be
 * most of it, or all of it (C125.1: ours, as a value of 8 characters shows half at most).
 */
const SHORT_VALUE_MASK = '****';
const SHOWN_FROM_LENGTH = 8;

const last4Of = (value: string): string =>
  value.length < SHOWN_FROM_LENGTH ? SHORT_VALUE_MASK : value.slice(-4);

const secretOf = (row: WorkflowSecretRow): WorkflowSecret => ({
  id: row.id,
  organizationId: row.organizationId,
  key: row.key,
  description: row.description,
  allowedHosts: row.allowedHosts,
  allowedPlacements: row.allowedPlacements,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const META_COLUMNS = {
  id: workflowSecretValues.id,
  secretId: workflowSecretValues.secretId,
  environmentId: workflowSecretValues.environmentId,
  last4: workflowSecretValues.last4,
  version: workflowSecretValues.version,
  rotatedBy: workflowSecretValues.rotatedBy,
  rotatedAt: workflowSecretValues.rotatedAt,
  previousExpiresAt: workflowSecretValues.previousExpiresAt,
  createdAt: workflowSecretValues.createdAt,
  updatedAt: workflowSecretValues.updatedAt,
};

const byKey = (organizationId: string, key: string) =>
  and(eq(workflowSecrets.organizationId, organizationId), eq(workflowSecrets.key, key));

export async function createWorkflowSecret(
  tx: Db,
  organizationId: string,
  input: NewWorkflowSecret,
): Promise<WorkflowSecret> {
  const rows = await tx
    .insert(workflowSecrets)
    .values({
      id: input.id,
      organizationId,
      key: input.key,
      description: input.description ?? null,
      allowedHosts: [...input.allowedHosts],
      ...(input.allowedPlacements === undefined
        ? {}
        : { allowedPlacements: input.allowedPlacements }),
      createdBy: input.createdBy,
    })
    .returning();
  return secretOf(inserted(rows, 'workflow secret'));
}

/** By its key, which is what a route and a reference name; `null` when the organisation has none. */
export async function getWorkflowSecret(
  db: Db,
  organizationId: string,
  key: string,
): Promise<WorkflowSecret | null> {
  const rows = await db.select().from(workflowSecrets).where(byKey(organizationId, key)).limit(1);
  const row = firstOrNull(rows);
  return row === null ? null : secretOf(row);
}

/** As {@link getWorkflowSecret}, holding the row for a change, a delete or a value write. */
export async function lockWorkflowSecret(
  tx: Db,
  organizationId: string,
  key: string,
): Promise<WorkflowSecret | null> {
  const rows = await tx
    .select()
    .from(workflowSecrets)
    .where(byKey(organizationId, key))
    .for('update');
  const row = firstOrNull(rows);
  return row === null ? null : secretOf(row);
}

const SECRET_CURSOR: CursorTable = {
  table: workflowSecrets,
  id: workflowSecrets.id,
  scope: workflowSecrets.organizationId,
  createdAt: workflowSecrets.createdAt,
};

export async function listWorkflowSecrets(
  db: Db,
  organizationId: string,
  page: PageRequest,
): Promise<Page<WorkflowSecret>> {
  return paginate(db, SECRET_CURSOR, organizationId, page, async (after, limit) => {
    const rows = await db
      .select()
      .from(workflowSecrets)
      .where(and(eq(workflowSecrets.organizationId, organizationId), after))
      .orderBy(desc(workflowSecrets.createdAt), desc(workflowSecrets.id))
      .limit(limit);
    return rows.map(secretOf);
  });
}

export async function updateWorkflowSecret(
  tx: Db,
  organizationId: string,
  secretId: string,
  changes: WorkflowSecretChanges,
): Promise<WorkflowSecret> {
  const rows = await tx
    .update(workflowSecrets)
    .set({
      ...(changes.description === undefined ? {} : { description: changes.description }),
      ...(changes.allowedHosts === undefined ? {} : { allowedHosts: [...changes.allowedHosts] }),
      ...(changes.allowedPlacements === undefined
        ? {}
        : { allowedPlacements: changes.allowedPlacements }),
    })
    .where(
      and(eq(workflowSecrets.organizationId, organizationId), eq(workflowSecrets.id, secretId)),
    )
    .returning();
  return secretOf(inserted(rows, 'workflow secret'));
}

/** Its values go with it. Whether a published version references it is the service's check. */
export async function deleteWorkflowSecret(
  tx: Db,
  organizationId: string,
  secretId: string,
): Promise<void> {
  await tx
    .delete(workflowSecrets)
    .where(
      and(eq(workflowSecrets.organizationId, organizationId), eq(workflowSecrets.id, secretId)),
    );
}

const valueOf = (environmentId: string, secretId: string) =>
  and(
    eq(workflowSecretValues.environmentId, environmentId),
    eq(workflowSecretValues.secretId, secretId),
  );

/** The metadata of `environmentId`'s value, `null` when it holds none. */
export async function getWorkflowSecretValueMeta(
  db: Db,
  environmentId: string,
  secretId: string,
): Promise<WorkflowSecretValueMeta | null> {
  const rows = await db
    .select(META_COLUMNS)
    .from(workflowSecretValues)
    .where(valueOf(environmentId, secretId))
    .limit(1);
  return firstOrNull(rows);
}

/** The same for a page of secrets, so a list reads its values in one query. */
export async function listWorkflowSecretValueMetas(
  db: Db,
  environmentId: string,
  secretIds: readonly string[],
): Promise<WorkflowSecretValueMeta[]> {
  if (secretIds.length === 0) {
    return [];
  }
  return db
    .select(META_COLUMNS)
    .from(workflowSecretValues)
    .where(
      and(
        eq(workflowSecretValues.environmentId, environmentId),
        inArray(workflowSecretValues.secretId, [...secretIds]),
      ),
    );
}

/**
 * C125.2: every environment holding a value of the secret, whose audit logs a change of its hosts or
 * placements reaches, and which says whether a production value exists.
 */
export async function listWorkflowSecretValueEnvironments(
  db: Db,
  secretId: string,
): Promise<{ environmentId: string }[]> {
  return db
    .select({ environmentId: workflowSecretValues.environmentId })
    .from(workflowSecretValues)
    .where(eq(workflowSecretValues.secretId, secretId));
}

/** Sets the environment's value: a new row at version 1, or the next version of its row. */
export async function putWorkflowSecretValue(
  tx: Db,
  input: WorkflowSecretValueInput,
): Promise<WorkflowSecretValueMeta> {
  const held = await getWorkflowSecretValueMeta(tx, input.environmentId, input.secretId);
  if (held === null) {
    const rows = await tx
      .insert(workflowSecretValues)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        secretId: input.secretId,
        environmentId: input.environmentId,
        value: sealValue(SEALED.workflowSecretValue, input.id, input.value),
        last4: last4Of(input.value),
      })
      .returning(META_COLUMNS);
    return inserted(rows, 'workflow secret value');
  }
  const rows = await tx
    .update(workflowSecretValues)
    .set({
      value: sealValue(SEALED.workflowSecretValue, held.id, input.value),
      last4: last4Of(input.value),
      version: sql`${workflowSecretValues.version} + 1`,
      previousValue: null,
      previousExpiresAt: null,
    })
    .where(eq(workflowSecretValues.id, held.id))
    .returning(META_COLUMNS);
  return inserted(rows, 'workflow secret value');
}

/**
 * Moves the current value to `previous_value` and seals the new one.
 * @throws {Error} with no value to rotate; the service answers 404 before that.
 */
export async function rotateWorkflowSecretValue(
  tx: Db,
  input: WorkflowSecretRotation,
): Promise<WorkflowSecretValueMeta> {
  const held = firstOrNull(
    await tx
      .select({ id: workflowSecretValues.id, value: workflowSecretValues.value })
      .from(workflowSecretValues)
      .where(valueOf(input.environmentId, input.secretId))
      .for('update'),
  );
  if (held === null) {
    throw new Error('No value to rotate');
  }
  const current = openValue(SEALED.workflowSecretValue, held.id, held.value);
  const rows = await tx
    .update(workflowSecretValues)
    .set({
      value: sealValue(SEALED.workflowSecretValue, held.id, input.value),
      last4: last4Of(input.value),
      version: sql`${workflowSecretValues.version} + 1`,
      previousValue: sealValue(SEALED.workflowSecretPreviousValue, held.id, current),
      previousExpiresAt: input.previousExpiresAt,
      rotatedBy: input.actorId,
      rotatedAt: input.rotatedAt,
    })
    .where(eq(workflowSecretValues.id, held.id))
    .returning(META_COLUMNS);
  return inserted(rows, 'workflow secret value');
}

/**
 * C125.5: the one read of a value, resolved last and only for the request it goes into. A previous
 * value past its expiry at `at` reads `null`.
 */
export async function openWorkflowSecretValue(
  db: Db,
  environmentId: string,
  secretId: string,
  at: Date,
): Promise<OpenedWorkflowSecretValue | null> {
  const row = firstOrNull(
    await db
      .select({
        id: workflowSecretValues.id,
        value: workflowSecretValues.value,
        previousValue: workflowSecretValues.previousValue,
        previousExpiresAt: workflowSecretValues.previousExpiresAt,
      })
      .from(workflowSecretValues)
      .where(valueOf(environmentId, secretId))
      .limit(1),
  );
  if (row === null) {
    return null;
  }
  const live =
    row.previousValue !== null &&
    row.previousExpiresAt !== null &&
    row.previousExpiresAt.getTime() > at.getTime();
  return {
    value: openValue(SEALED.workflowSecretValue, row.id, row.value),
    previousValue:
      live && row.previousValue !== null
        ? openValue(SEALED.workflowSecretPreviousValue, row.id, row.previousValue)
        : null,
  };
}

/** C125.3, C116.4: every secret of the organisation as publishing reads it, by key. */
export async function listWorkflowSecretFacts(
  db: Db,
  organizationId: string,
  environmentId: string,
): Promise<ReadonlyMap<string, WorkflowSecretFacts>> {
  const rows = await db
    .select({
      key: workflowSecrets.key,
      allowedHosts: workflowSecrets.allowedHosts,
      allowedPlacements: workflowSecrets.allowedPlacements,
      valueId: workflowSecretValues.id,
    })
    .from(workflowSecrets)
    .leftJoin(
      workflowSecretValues,
      and(
        eq(workflowSecretValues.secretId, workflowSecrets.id),
        eq(workflowSecretValues.environmentId, environmentId),
      ),
    )
    .where(eq(workflowSecrets.organizationId, organizationId));
  return new Map(
    rows.map((row) => [
      row.key,
      {
        allowedHosts: row.allowedHosts,
        headers: row.allowedPlacements.headers.map((name) => name.toLowerCase()),
        bodyPointers: row.allowedPlacements['body-pointers'],
        hasValue: row.valueId !== null,
      },
    ]),
  );
}

const SECRET_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * C125.2: whether a published version of any environment of the organisation names `key`, in either
 * written form. A draft or an archived version does not hold it back.
 */
export async function findWorkflowSecretReference(
  db: Db,
  organizationId: string,
  key: string,
): Promise<boolean> {
  if (!SECRET_KEY.test(key)) {
    return false;
  }
  const reference = `\\{\\{\\s*(current_run\\.environment\\.)?secrets\\.${key}\\s*\\}\\}`;
  const rows = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .innerJoin(environments, eq(environments.id, workflowVersions.environmentId))
    .where(
      and(
        eq(environments.organizationId, organizationId),
        eq(workflowVersions.status, 'published'),
        sql`${workflowVersions.definition}::text ~ ${reference}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
