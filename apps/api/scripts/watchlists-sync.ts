/**
 * C76.2: syncs the watchlist sources of `watchlists/sources.json` into the install-wide tables:
 *
 *   pnpm --filter @openverify/api watchlists:sync [--source <id>] [--import <file> --source <id>]
 *     [--allow-mass-removal] [--accept-older-publication] [--allow-normalised] [--json]
 *
 * It reconciles the source rows first (C76.4), re-keys a source keyed by another matcher version
 * (C78.3), takes the per-source advisory lock, checks the change signal, downloads through the
 * list client (C85.1) or reads `--import`, parses under the C77.2 guards, applies under the
 * re-checked rollback and mass-removal guards, and enqueues the re-screen of a sync left
 * `pending` (C74.4). It never runs in CI, prints counts and outcomes only, never names, and reads
 * as the worker (`loadConfig(env, { process: 'worker' })`: the EU token, the Wikidata contact).
 *
 * It exits 1 unless every source applied, stayed unchanged or was re-keyed. The logic lives in
 * `src/watchlists/cli.ts` (tested there); this file only builds the runtime from the environment.
 * Owner: `api-watchlists` (Workflow 6A Stage 3); the command and its package script are frozen by
 * `foundation-6` (Stage 1b).
 */
import { pathToFileURL } from 'node:url';
import {
  parseWatchlistsSyncArgs,
  runWatchlistsSync,
  watchlistCliExitCode,
} from '#src/watchlists/cli';
import { runWatchlistCli } from '#src/watchlists/cli-runtime';

/* v8 ignore start -- process entry point */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatchlistCli(parseWatchlistsSyncArgs, runWatchlistsSync, watchlistCliExitCode);
}
/* v8 ignore stop */
