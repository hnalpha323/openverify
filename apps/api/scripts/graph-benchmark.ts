/**
 * C101.8 (Workflow 7B; F18): the graph benchmark, reported and not gated, as Phase 6 treats its
 * 2,000,000-name case:
 *
 *   pnpm --filter @openverify/api graph:benchmark [--accounts=<1000-2000000>] [--runs=<1-200>]
 *     [--seed=<text>] [--shape=<default|dense>] [--database-url=<postgres URL>]
 *
 * It builds 1,000,000 synthetic accounts (about 6,000,000 `graph_attributes` rows with the hub)
 * from a seed, runs the C102.3 engine itself in each scenario (`services/graph/benchmark.ts`), and
 * prints the report as JSON with the load average before and after. Its synthetic-graph builder is
 * shared with the CI gate of 100,000 accounts (C102.8).
 *
 * Without `--database-url` it starts a Testcontainers Postgres 17 (`startIntegrationPostgres`),
 * migrates it, and stops it at the end. With one (a throwaway database, never a production one) it
 * first refuses a target holding any organization but its own scratch one (K7C-R008), then
 * migrates it and keeps the graph between calls: the build resumes batch by batch, so a run that
 * does not fit one call is split into resumable steps by calling it again. Output is counts and
 * times only.
 */
import { randomBytes } from 'node:crypto';
import { loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
import { newId, safeUrl } from '@openverify/contracts';
import {
  createDatabase,
  createEnvironment,
  createKeyring,
  createOrganization,
  runMigrations,
  setDefaultKeyring,
  type Db,
} from '@openverify/db';
import { startIntegrationPostgres } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { runGraphBenchmark, type GraphBenchmarkReport } from '../src/services/graph/benchmark.js';
import type { SyntheticShape } from '../src/services/graph/synthetic.js';

export const DEFAULT_BENCHMARK_ACCOUNTS = 1_000_000;
export const MAX_BENCHMARK_ACCOUNTS = 2_000_000;
export const DEFAULT_BENCHMARK_RUNS = 50;
export const MAX_BENCHMARK_RUNS = 200;
export const DEFAULT_BENCHMARK_SEED = 'graph-benchmark-1';

/** The scratch organization's name, by which a `--database-url` run finds its graph again. */
const ORGANIZATION = 'Graph benchmark (synthetic)';

const USAGE =
  'usage: graph:benchmark [--accounts=<1000-2000000>] [--runs=<1-200>] [--seed=<text>] ' +
  '[--shape=<default|dense>] [--database-url=<postgres URL>]';

export interface GraphBenchmarkArgs {
  accounts: number;
  runs: number;
  seed: string;
  databaseUrl?: string | undefined;
  /** R007 (Workflow 11D): `--shape dense`; absent, the default shape. */
  shape?: SyntheticShape | undefined;
}

/** The command line is not valid; the message says what to fix. */
export class GraphBenchmarkUsageError extends Error {
  override name = 'GraphBenchmarkUsageError';
}

function integer(flag: string, given: string | undefined, min: number, max: number): number {
  const value = Number(given);
  if (
    given === undefined ||
    given === '' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new GraphBenchmarkUsageError(
      `${flag} must be ${String(min)} to ${String(max)}. ${USAGE}`,
    );
  }
  return value;
}

/**
 * Parses the command line (`--flag=<value>` or `--flag <value>`).
 * @throws {GraphBenchmarkUsageError} for an unknown flag or a bad value.
 */
export function parseGraphBenchmarkArgs(argv: readonly string[]): GraphBenchmarkArgs {
  const args: GraphBenchmarkArgs = {
    accounts: DEFAULT_BENCHMARK_ACCOUNTS,
    runs: DEFAULT_BENCHMARK_RUNS,
    seed: DEFAULT_BENCHMARK_SEED,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    const given = inline ?? argv[(index += 1)];
    switch (flag) {
      case '--accounts':
        args.accounts = integer(flag, given, 1000, MAX_BENCHMARK_ACCOUNTS);
        break;
      case '--runs':
        args.runs = integer(flag, given, 1, MAX_BENCHMARK_RUNS);
        break;
      case '--seed':
        if (given === undefined || !/^[\w-]{1,64}$/u.test(given)) {
          throw new GraphBenchmarkUsageError(`--seed must be 1 to 64 letters or digits. ${USAGE}`);
        }
        args.seed = given;
        break;
      case '--shape':
        if (given !== 'default' && given !== 'dense') {
          throw new GraphBenchmarkUsageError(`--shape is default or dense. ${USAGE}`);
        }
        args.shape = given;
        break;
      case '--database-url': {
        const protocol = safeUrl(given ?? '')?.protocol;
        if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
          throw new GraphBenchmarkUsageError(`--database-url must be a postgres:// URL. ${USAGE}`);
        }
        args.databaseUrl = given;
        break;
      }
      default:
        throw new GraphBenchmarkUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
  }
  return args;
}

/**
 * K7C-R008 (Phase 11, Workflow 11B, platform-ops): a `--database-url` target must hold no
 * organization but the benchmark's scratch one, checked before any migration or write.
 */
export class GraphBenchmarkTargetError extends Error {
  override name = 'GraphBenchmarkTargetError';
}

/**
 * Refuses a target holding any organization but the scratch one. A database with no
 * `organizations` table yet (empty, never migrated) is accepted. The message names no
 * organization, only the rule.
 * @throws {GraphBenchmarkTargetError}
 */
async function refuseInstallDatabase(db: Db): Promise<void> {
  const table = (await db.execute(
    sql`select to_regclass('public.organizations') is not null as present`,
  )) as { rows: { present: boolean }[] };
  if (table.rows[0]?.present !== true) {
    return;
  }
  const others = (await db.execute(
    sql`select exists (select 1 from organizations where name <> ${ORGANIZATION}) as found`,
  )) as { rows: { found: boolean }[] };
  if (others.rows[0]?.found === true) {
    throw new GraphBenchmarkTargetError(
      'graph:benchmark: --database-url holds an organization other than the benchmark’s own ' +
        'scratch organization; it writes only into a throwaway database, never an install’s. ' +
        'Nothing was migrated or written.',
    );
  }
}

/**
 * Readies a target: refuses an install's database (K7C-R008), then migrates it and finds or makes
 * the scratch environment.
 * @returns the scratch environment's id.
 * @throws {GraphBenchmarkTargetError} before any migration or write.
 */
export async function prepareBenchmarkTarget(
  db: Db,
  migrate: (db: Db) => Promise<void> = runMigrations,
): Promise<string> {
  await refuseInstallDatabase(db);
  await migrate(db);
  return scratchEnvironment(db);
}

/** The scratch environment of an earlier call, or a new one. */
async function scratchEnvironment(db: Db): Promise<string> {
  const found: unknown = await db.execute(sql`
    select e.id from environments e join organizations o on o.id = e.organization_id
    where o.name = ${ORGANIZATION} limit 1`);
  const existing = (found as { rows: { id: string }[] }).rows[0]?.id;
  if (existing !== undefined) {
    return existing;
  }
  const organization = await createOrganization(db, { id: newId('org'), name: ORGANIZATION });
  return (
    await createEnvironment(db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'sandbox',
    })
  ).id;
}

const load = () =>
  loadavg()
    .map((value) => value.toFixed(2))
    .join(' ');

/** The command: a database, the build, the scenarios, and the report on `out`. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  out: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<GraphBenchmarkReport> {
  const args = parseGraphBenchmarkArgs(argv);
  const container = args.databaseUrl === undefined ? await startIntegrationPostgres() : undefined;
  const pool = new Pool({ connectionString: args.databaseUrl ?? container?.getConnectionUri() });
  // The graph seals nothing; the keyring is only the migrations' and the repositories' default.
  setDefaultKeyring(createKeyring(randomBytes(32)));
  try {
    const db = createDatabase(pool);
    const environmentId = await prepareBenchmarkTarget(db);
    const loadBefore = load();
    const report = await runGraphBenchmark(db, {
      environmentId,
      accounts: args.accounts,
      runs: args.runs,
      seed: args.seed,
      ...(args.shape === undefined ? {} : { shape: args.shape }),
    });
    out(JSON.stringify({ ...report, loadBefore, loadAfter: load() }, null, 2));
    return report;
  } finally {
    setDefaultKeyring(undefined);
    await pool.end();
    await container?.stop();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
