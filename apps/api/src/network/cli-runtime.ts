/**
 * The runtime `network:sync` (`apps/api/scripts/network-sync.ts`) builds from the environment: the
 * configuration read as the worker (`loadConfig(env, { process: 'worker' })`), a `pg` pool with
 * one connection per sync, the S3 object storage the snapshots go to, the network-source clients,
 * and a logger on stderr so stdout holds only the result lines. Owner: `api-network`.
 */
import { createDatabase } from '@openverify/db';
import { Pool } from 'pg';
import { loadConfig } from '../config.js';
import { createOutboundHttp } from '../http/index.js';
import { createWorkerLogger } from '../jobs/logger.js';
import { systemClock } from '../ports.js';
import { createFileStorage } from '../storage/index.js';
import { poolWatchlistSessions } from '../watchlists/sync-session.js';
import {
  networkCliExitCode,
  parseNetworkSyncArgs,
  runNetworkSync,
  type NetworkCliRuntime,
} from './cli.js';

/* v8 ignore start -- the CLI runs against a real stack, never in CI; cli.test.ts covers the rest */
/** Runs `run` with the CLI runtime, then closes the pool, the storage and the clients. */
export async function withNetworkCliRuntime<T>(
  env: NodeJS.ProcessEnv,
  run: (runtime: NetworkCliRuntime) => Promise<T>,
): Promise<T> {
  const config = loadConfig(env, { process: 'worker' });
  const pool = new Pool({ connectionString: config.databaseUrl });
  const storage = createFileStorage({ driver: 's3', ...config.s3 });
  const outboundHttp = createOutboundHttp();
  try {
    return await run({
      db: createDatabase(pool),
      connect: poolWatchlistSessions(pool),
      clock: systemClock,
      logger: createWorkerLogger({
        name: 'openverify-network',
        level: config.logLevel,
        destination: process.stderr,
      }),
      network: config.network,
      storage,
      outboundHttp,
      out: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await outboundHttp.close();
    await storage.close();
    await pool.end();
  }
}

/** The entry point: parse, run, print, and set the exit code; errors on stderr. */
export function runNetworkCli(): void {
  Promise.resolve()
    .then(async () => {
      const args = parseNetworkSyncArgs(process.argv.slice(2));
      const results = await withNetworkCliRuntime(process.env, (runtime) =>
        runNetworkSync(args, runtime),
      );
      process.exitCode = networkCliExitCode(results);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
/* v8 ignore stop */
