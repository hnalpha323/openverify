/**
 * Workflow 11A Stage 1b (R) (C230.5, review F08; C235): the columns Connect adds to existing tables,
 * declared once so each table names them the same way. Plain jsonb (the db package cannot import the
 * contracts' `provenanceSchema`); `api-redeem` writes them, and each is `null` on every row that is
 * not a copy.
 *
 * - `provenance` on inquiries, verifications and files (and `connect_provenance` on the check rows,
 *   whose `provenance` is ADR 0002's): `{kind: 'connect-clone', share-token-id, ...}` or
 *   `{kind: 'connect-hydrate', ...}` (C235.1), held to the two kinds.
 * - `hydrated_fields` on accounts, inquiries and transactions: the hydrated field keys with their
 *   token (`[{share-token-id, fields[], hydrated-at}]`, keys only, never a value; C235.1), held to a
 *   JSON array.
 */
import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, jsonb } from 'drizzle-orm/pg-core';

/** The two provenance kinds of C235.1 (`PROVENANCE_KINDS` in the contracts). */
export const CONNECT_PROVENANCE_KIND_VALUES = ['connect-clone', 'connect-hydrate'] as const;

/** A copy's provenance as stored; the contracts' `provenanceSchema` is its served form. */
export type StoredConnectProvenance = {
  kind: (typeof CONNECT_PROVENANCE_KIND_VALUES)[number];
} & Record<string, unknown>;

/** One redemption's hydrated keys (keys only). */
export type StoredHydratedFields = Record<string, unknown>[];

export const connectProvenanceColumn = (name = 'provenance') =>
  jsonb(name).$type<StoredConnectProvenance>();

export const hydratedFieldsColumn = () => jsonb('hydrated_fields').$type<StoredHydratedFields>();

/** `<name>`: null, or an object whose `kind` is one of the two. */
export const provenanceKindValid = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`${column} is null or (jsonb_typeof(${column}) = 'object' and ${column}->>'kind' in ('connect-clone', 'connect-hydrate'))`,
  );

/** `<name>`: null, or a JSON array. */
export const hydratedFieldsList = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} is null or jsonb_typeof(${column}) = 'array'`);
