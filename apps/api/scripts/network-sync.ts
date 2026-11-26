/**
 * C92.2 (ADR 0006): syncs the network sources of `network/sources.json` into the install-wide
 * tables and the snapshot objects:
 *
 *   pnpm --filter @openverify/api network:sync [--source <id>] [--import <file> --source <id>]
 *     [--allow-mass-removal] [--allow-mass-addition] [--accept-older-publication] [--json]
 *
 * It reconciles the source rows first (C92.5), then, per source on the sync runner
 * (`src/sync/runner.ts`): the per-source advisory lock, the download through the C85.1 stream
 * client (DB-IP: this UTC month, then the last) or `--import` (no request), gunzip under the
 * inflated cap, DB-IP's page digest, the strict parse, the rollback, future, mass-removal,
 * mass-addition and empty guards under the lock, the snapshot object and the audit row, and the
 * purge of week-old superseded snapshots. It never runs in CI, prints counts and outcomes only,
 * and reads as the worker (`loadConfig(env, { process: 'worker' })`, `S3_*` for the snapshots).
 *
 * It exits 1 unless every source applied or stayed unchanged. The logic lives in
 * `src/network/cli.ts` (tested there); this file only starts it. Owner: `api-network`.
 */
import { pathToFileURL } from 'node:url';
import { runNetworkCli } from '#src/network/cli-runtime';

/* v8 ignore start -- process entry point */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNetworkCli();
}
/* v8 ignore stop */
