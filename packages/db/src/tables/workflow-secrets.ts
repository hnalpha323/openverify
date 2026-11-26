/**
 * C125.1 (Workflow 8A Stage 1b (X)): workflow secrets. `workflow_secrets` holds a key of an
 * organisation with the hosts and placements it is bound to, and no value; `workflow_secret_values`
 * holds one value per environment, sealed for its row (`SEALED.workflowSecretValue`), so a ciphertext
 * copied to another row or environment does not open. The composite foreign keys hold a value to its
 * secret's organisation whatever a caller passes, because a value route acts only on the caller's own
 * environment (C125.2).
 *
 * Neither table is personal data, so redaction and exports skip both; both join the rewrap lists.
 *
 * Plaintext by decision (C143.5): the key, hosts, placements and description are the operator's
 * configuration; `last4` is what a console shows of a value, as a webhook secret's is.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { createdAt, idFormat, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { environments, organizations } from './tenancy.js';

/** C125.1 (P29): where a value may go, in the contract's member names. */
export interface WorkflowSecretPlacements {
  headers: string[];
  'body-pointers': string[];
}

const ACTOR_ID = `^(${idPattern('usr').slice(1, -1)}|${idPattern('key').slice(1, -1)})$`;

export const workflowSecrets = pgTable(
  'workflow_secrets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Snake_case and immutable (C125.1); a reference names it, never the id. */
    key: text('key').notNull(),
    description: text('description'),
    /** C124.3: as `normalizeHost()` leaves them, so they compare as stored. */
    allowedHosts: text('allowed_hosts').array().notNull(),
    allowedPlacements: jsonb('allowed_placements')
      .$type<WorkflowSecretPlacements>()
      .notNull()
      .default(sql`'{"headers":["authorization"],"body-pointers":[]}'::jsonb`),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    idFormat('workflow_secrets', table.id, 'wsec'),
    unique('workflow_secrets_organization_id_key_key').on(table.organizationId, table.key),
    unique('workflow_secrets_organization_id_id_key').on(table.organizationId, table.id),
    check('workflow_secrets_key_format', sql`${table.key} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    check('workflow_secrets_hosts_present', sql`cardinality(${table.allowedHosts}) > 0`),
    check(
      'workflow_secrets_created_by_format',
      sql`${table.createdBy} ~ ${sql.raw(`'${ACTOR_ID}'`)}`,
    ),
  ],
);

export type WorkflowSecretRow = typeof workflowSecrets.$inferSelect;

export const workflowSecretValues = pgTable(
  'workflow_secret_values',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    secretId: text('secret_id').notNull(),
    environmentId: environmentId(),
    /** Sealed for this row; the plaintext leaves only in the request it was resolved for (C125.5). */
    value: sealedColumn('value').notNull(),
    last4: text('last4').notNull(),
    version: integer('version').notNull().default(1),
    /** C125.2: a signing secret's previous value, kept while it still verifies. */
    previousValue: sealedColumn('previous_value'),
    previousExpiresAt: timestamptz('previous_expires_at'),
    rotatedBy: text('rotated_by'),
    rotatedAt: timestamptz('rotated_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    idFormat('workflow_secret_values', table.id, 'wsecv'),
    unique('workflow_secret_values_secret_id_environment_id_key').on(
      table.secretId,
      table.environmentId,
    ),
    index('workflow_secret_values_environment_id_idx').on(table.environmentId),
    foreignKey({
      name: 'workflow_secret_values_secret_fk',
      columns: [table.organizationId, table.secretId],
      foreignColumns: [workflowSecrets.organizationId, workflowSecrets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_secret_values_environment_fk',
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
    }).onDelete('cascade'),
    check('workflow_secret_values_version_positive', sql`${table.version} >= 1`),
    check('workflow_secret_values_last4_length', sql`char_length(${table.last4}) between 1 and 4`),
    check(
      'workflow_secret_values_previous_whole',
      sql`(${table.previousValue} is null) = (${table.previousExpiresAt} is null)`,
    ),
    check(
      'workflow_secret_values_rotated_whole',
      sql`(${table.rotatedBy} is null) = (${table.rotatedAt} is null)`,
    ),
    check(
      'workflow_secret_values_rotated_by_format',
      sql`${table.rotatedBy} is null or ${table.rotatedBy} ~ ${sql.raw(`'${ACTOR_ID}'`)}`,
    ),
  ],
);

export type WorkflowSecretValueRow = typeof workflowSecretValues.$inferSelect;
