/**
 * The runtime the watchlist CLIs (`scripts/{watchlists-sync,watchlists-rekey,pep-sync}.ts`) build
 * from the environment: the configuration read as the worker (`loadConfig(env, { process:
 * 'worker' })`, so the EU token and the Wikidata contact are read and checked as the worker reads
 * them), a `pg` pool with one connection per sync, the list clients, the `report-rescreen`
 * producer over its own Valkey connection (a failed enqueue leaves the re-screen to the sweep),
 * the matcher data, and a logger on stderr so stdout holds only the result lines. Owner:
 * `api-watchlists`.
 */
import { createDatabase } from '@openverify/db';
import { Pool } from 'pg';
import { loadConfig } from '../config.js';
import { createOutboundHttp } from '../http/index.js';
import { createWorkerLogger } from '../jobs/logger.js';
import { createReportRescreenQueue } from '../jobs/report-queues.js';
import { systemClock } from '../ports.js';
import type { WatchlistCliRuntime } from './cli.js';
import { loadMatcherData } from './matcher-data.js';
import { poolWatchlistSessions } from './sync-session.js';

/* v8 ignore start -- the CLIs run against a real stack, never in CI; cli.test.ts covers the rest */
/** Runs `run` with the CLI runtime, then closes the pool, the list clients and the producer. */
export async function withWatchlistCliRuntime<T>(
  env: NodeJS.ProcessEnv,
  run: (runtime: WatchlistCliRuntime) => Promise<T>,
): Promise<T> {
  const config = loadConfig(env, { process: 'worker' });
  const pool = new Pool({ connectionString: config.databaseUrl });
  const outboundHttp = createOutboundHttp();
  const rescreens = createReportRescreenQueue({ connection: { url: config.redisUrl } });
  try {
    return await run({
      db: createDatabase(pool),
      connect: poolWatchlistSessions(pool),
      clock: systemClock,
      logger: createWorkerLogger({
        name: 'openverify-watchlists',
        level: config.logLevel,
        destination: process.stderr,
      }),
      // C254.1 (Q10 granted; KP11-31): the reconcile reads the UN opt-in's install switch.
      settings: { ...config.watchlists, unOptInAllowed: config.watchlistUnOptInAllowed },
      outboundHttp,
      rescreens,
      matcherData: () => loadMatcherData(),
      out: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await rescreens.close().catch(() => undefined);
    await outboundHttp.close();
    await pool.end();
  }
}

/** The entry point of one CLI: parse, run, print, and set the exit code; errors on stderr. */
export function runWatchlistCli<A, R>(
  parse: (argv: readonly string[]) => A,
  run: (args: A, runtime: WatchlistCliRuntime) => Promise<R>,
  exitCode: (result: R) => number,
): void {
  Promise.resolve()
    .then(async () => {
      const args = parse(process.argv.slice(2));
      const result = await withWatchlistCliRuntime(process.env, (runtime) => run(args, runtime));
      process.exitCode = exitCode(result);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
