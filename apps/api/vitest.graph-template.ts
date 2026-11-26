/**
 * C102.8, owner decision 17 after Workflow 7B: the global setup of the integration config's `graph`
 * project, which holds `graph-engine.integration.test.ts` alone, so it runs only when that file
 * does. It builds the file's synthetic graph of 100,000 accounts once, with the benchmark's builder
 * (`buildSyntheticGraph`, the same rows from the same seed, its batches written concurrently), into
 * a template database of its own container, before the run's test files start. The file's `beforeAll` copies it
 * (`CREATE DATABASE ... TEMPLATE`, about a second) instead of building it under the suite's
 * parallel load, where the build took 140 to 177 s of the hook's 180 s guard (2026-11-01). The
 * build keeps that guard: past 180 s the setup fails. Every value key is a hash of the seed.
 */
import { randomBytes } from 'node:crypto';
import { createDatabase, createKeyring, runMigrations, setDefaultKeyring } from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { buildSyntheticGraph } from './src/services/graph/synthetic.js';

/** What the graph-engine file reads with `inject('graphTemplate')`. */
export interface GraphTemplate {
  /** The container's own database, from which the file creates its copy. */
  adminUri: string;
  /** The template database: connections refused, so a copy never waits for one. */
  database: string;
  environmentId: string;
  accounts: number;
  seed: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    graphTemplate: GraphTemplate;
  }
}

const DATABASE = 'graph_engine_template';
const ACCOUNTS = 100_000;
const SEED = 'graph-ci-1';
/**
 * Batches written at once: each its own backend, so under the suite's load the build is not one
 * process among dozens. The rows do not depend on it (`synthetic.test.ts`).
 */
const CONCURRENCY = 8;
/** The graph-engine file's hook guard, which the build kept until decision 17. */
const GUARD_MS = 180_000;

const uriOf = (connectionUri: string, database: string) => {
  const url = new URL(connectionUri);
  url.pathname = `/${database}`;
  return url.toString();
};

async function onAdmin(adminUri: string, statement: string): Promise<void> {
  const client = new Client({ connectionString: adminUri });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** Migrates the template database and builds the graph in it; its environment and row count. */
async function buildTemplate(adminUri: string): Promise<{ environmentId: string; rows: number }> {
  await onAdmin(adminUri, `create database ${DATABASE}`);
  const pool = createIntegrationPool(uriOf(adminUri, DATABASE), { max: CONCURRENCY });
  // The graph seals nothing; the keyring is only the repositories' default.
  setDefaultKeyring(createKeyring(randomBytes(32)));
  try {
    const db = createDatabase(pool);
    await runMigrations(db);
    const environmentId = (await createTestTenant(db)).environment.id;
    // The kinds the cases read: the strong kinds of every account, IP addresses for 20,000, the hub.
    const { rows } = await buildSyntheticGraph(db, {
      environmentId,
      accounts: ACCOUNTS,
      seed: SEED,
      kinds: ['email', 'phone', 'ip'],
      weakAccounts: [40_000, 60_000],
      batchSize: ACCOUNTS / CONCURRENCY,
      concurrency: CONCURRENCY,
    });
    return { environmentId, rows };
  } finally {
    setDefaultKeyring(undefined);
    await pool.end();
  }
}

/** `work`, or a rejection once `GUARD_MS` passes. */
async function guarded<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the graph template build passed its ${String(GUARD_MS / 1000)} s guard`));
    }, GUARD_MS);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    clearTimeout(timer);
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const started = Date.now();
  const container = await startIntegrationPostgres();
  const adminUri = container.getConnectionUri();
  try {
    const { environmentId, rows } = await guarded(buildTemplate(adminUri));
    await onAdmin(
      adminUri,
      `alter database ${DATABASE} with is_template true allow_connections false`,
    );
    project.provide('graphTemplate', {
      adminUri,
      database: DATABASE,
      environmentId,
      accounts: ACCOUNTS,
      seed: SEED,
    });
    process.stderr.write(
      `graph template: ${String(rows)} rows of ${String(ACCOUNTS)} accounts built in ${String(Date.now() - started)} ms\n`,
    );
  } catch (error) {
    await container.stop();
    throw error;
  }
  return async () => {
    await container.stop();
  };
}
