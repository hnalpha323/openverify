import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import * as schema from './schema.js';

export type DbSchema = typeof schema;

/**
 * Any Drizzle Postgres client or transaction that knows the OpenVerify schema:
 * node-postgres in the services, PGlite in unit tests (`@openverify/db/testing`).
 * Every repository takes one, so it can also run inside a caller's transaction.
 */
export type Db = PgDatabase<PgQueryResultHKT, DbSchema>;

/** The node-postgres client used by the API and workers. */
export type Database = NodePgDatabase<DbSchema> & { $client: Pool };

/** Wraps a node-postgres pool in a Drizzle client that knows the OpenVerify schema. */
export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}
