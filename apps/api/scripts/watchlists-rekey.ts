/**
 * C78.3 (V04): recomputes every derived column (the names' normalised forms and keys, the key
 * frequencies, the identifiers' and crypto addresses' normalised forms) from
 * `watchlist_entries.data` with this version's `keysVersion()`:
 *
 *   pnpm --filter @openverify/api watchlists:rekey [--source <id>] [--json]
 *
 * In batches under the source's advisory lock; then it sets the source's `keys_version` and
 * writes a `rekeyed` row in `watchlist_syncs`. Refused without the filtered variant-group file
 * or with another hash (`refused_matcher_data`).
 *
 * It exits 1 unless every source applied, stayed unchanged or was re-keyed. The logic lives in
 * `src/watchlists/cli.ts` (tested there); this file only builds the runtime from the environment.
 * Owner: `api-watchlists` (Workflow 6A Stage 3); the command and its package script are frozen by
 * `foundation-6` (Stage 1b).
 */
import { pathToFileURL } from 'node:url';
import {
  parseWatchlistsRekeyArgs,
  runWatchlistsRekey,
  watchlistCliExitCode,
} from '#src/watchlists/cli';
import { runWatchlistCli } from '#src/watchlists/cli-runtime';

/* v8 ignore start -- process entry point */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatchlistCli(parseWatchlistsRekeyArgs, runWatchlistsRekey, watchlistCliExitCode);
}
/* v8 ignore stop */
