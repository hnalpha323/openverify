/** Column and constraint helpers shared by the tables. */
import { sql } from 'drizzle-orm';
import { check, text, timestamp, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { idPattern, type IdPrefix } from '../ids.js';

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Bumped by the `openverify_set_updated_at` trigger unless the update sets it itself. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** `<table>_id_format`: the primary key must be a C1 id with this table's prefix. */
export const idFormat = (table: string, id: AnyPgColumn, prefix: IdPrefix) =>
  check(`${table}_id_format`, sql`${id} ~ ${sql.raw(`'${idPattern(prefix)}'`)}`);

/** A check that a non-key column holds a C1 id with the given prefix. */
export const idColumnFormat = (name: string, column: AnyPgColumn, prefix: IdPrefix) =>
  check(name, sql`${column} ~ ${sql.raw(`'${idPattern(prefix)}'`)}`);

/**
 * C117.5: the step of a run that created a row. Plain, with no foreign key, because the object
 * outlives the run's skeleton (C120.8).
 */
export const workflowRunStepId = () => text('workflow_run_step_id');

/** C117.5: a repeated attempt finds the first result, by the step that made it. */
export const workflowRunStepKey = (
  table: string,
  environmentIdColumn: AnyPgColumn,
  stepId: AnyPgColumn,
) => [
  uniqueIndex(`${table}_workflow_run_step_key`)
    .on(environmentIdColumn, stepId)
    .where(sql`${stepId} is not null`),
  idColumnFormat(`${table}_workflow_run_step_id_format`, stepId, 'wfst'),
];

/** C127.7, C127.9, C128.1: who may stand as a decider. Never the system. */
export const deciderIdFormat = (
  name: string,
  typeColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  // Further actor types and their id prefixes (C150.7: `inquiry-flow` on inquiry decisions).
  more: readonly (readonly [type: string, prefix: IdPrefix])[] = [],
) =>
  check(
    name,
    sql`(${typeColumn} is distinct from 'user' or ${idColumn} ~ ${sql.raw(`'${idPattern('usr')}'`)})
      and (${typeColumn} is distinct from 'api-key' or ${idColumn} ~ ${sql.raw(`'${idPattern('key')}'`)})
      and (${typeColumn} is distinct from 'workflow-run' or ${idColumn} ~ ${sql.raw(`'${idPattern('wfr')}'`)})${sql.join(
        more.map(
          ([type, prefix]) =>
            sql`
      and (${typeColumn} is distinct from ${sql.raw(`'${type}'`)} or ${idColumn} ~ ${sql.raw(`'${idPattern(prefix)}'`)})`,
        ),
        sql.raw(''),
      )}`,
  );

/**
 * C9 tags as a database backstop: at most 50, each 1-64 characters after trimming, unique
 * ignoring case (`openverify_tags_valid`, created by migration 0003). The character set is
 * checked by the API (`@openverify/core`), since it depends on Unicode classes.
 */
export const validTags = (name: string, column: AnyPgColumn) =>
  check(name, sql`openverify_tags_valid(${column})`);

/** `openverify_lower_tags(tags)`: the tags lowercased, for case-insensitive tag filters. */
export const lowerTags = (column: AnyPgColumn) => sql`openverify_lower_tags(${column})`;

/** C12 date-versioned API version, e.g. `2026-10-01`. */
export const API_VERSION_DEFAULT = '2026-10-01';
export const apiVersionFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`);

/** The column must hold a SHA-256 digest as 64 lowercase hex characters. */
export const hexDigest = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[0-9a-f]{64}$'`);

/**
 * Dotted lowercase names such as `inquiry.created`, `inquiry.marked-for-review` or
 * `report/watchlist.matched` (one `/` subtype in the first segment).
 */
export const dottedName = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z_-]*(/[a-z][a-z_-]*)?(\\.[a-z][a-z_-]*)+$'`);

/** `<column> is null or <column>`: a flag that is `true` or `null`, never `false` (C90.3, H13). */
export const trueOrNull = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} is null or ${column}`);

/** An ISO 3166-1 alpha-2 code in upper case (C93.3; `ZZ` in the sandbox). */
export const countryCodeFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[A-Z]{2}$'`);

/** `<column> in (<values>)`, for a text column with a closed vocabulary. */
export const oneOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;
