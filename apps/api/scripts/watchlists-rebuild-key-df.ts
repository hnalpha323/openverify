/**
 * C270.1 (Workflow 11D; decision 14 before 11D): rebuilds one source's key frequencies in full
 * (`rebuildWatchlistKeyDf`: the keys two or more live entries hold, `#names` and the per-script
 * counts, then the GIN pending-list clean), beside the sync's incremental update behind the switch
 * `incremental-key-df`:
 *
 *   pnpm --filter @openverify/api watchlists:rebuild-key-df [--source <id>] [--json]
 *
 * An operator command, compiled to `dist/commands/watchlists-rebuild-key-df.js`. It runs as the
 * runtime role (`DATABASE_URL`): ANALYZE on two of `RUNTIME_MAINTAIN_TABLES` and 11B's SECURITY
 * DEFINER `openverify_gin_clean_pending_lists`, under the source's advisory lock (`busy` while a
 * sync or a re-key holds it). Without `--source` it rebuilds every source that holds keys.
 *
 * It exits 1 unless every source was rebuilt. The logic lives in `src/watchlists/cli.ts` and
 * `src/watchlists/rebuild-key-df.ts` (tested there); this file only builds the runtime from the
 * environment. Owner: `matcher-write-11d` (Workflow 11D).
 */
import { pathToFileURL } from 'node:url';
import {
  parseWatchlistsRebuildKeyDfArgs,
  runWatchlistsRebuildKeyDf,
  watchlistRebuildKeyDfExitCode,
} from '#src/watchlists/cli';
import { runWatchlistCli } from '#src/watchlists/cli-runtime';

/* v8 ignore start -- process entry point */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatchlistCli(
    parseWatchlistsRebuildKeyDfArgs,
    runWatchlistsRebuildKeyDf,
    watchlistRebuildKeyDfExitCode,
  );
}
/* v8 ignore stop */
