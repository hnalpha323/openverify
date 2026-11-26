/**
 * C80.1: builds the `wikidata-pep` source from the Wikidata Query Service (or `--import` of a
 * SPARQL answer), with the operator's own contact (`OPENVERIFY_WIKIDATA_USER_AGENT`):
 *
 *   pnpm --filter @openverify/api pep:sync [--import <file>] [--json]
 *
 * Paged per position class, one query in flight, 75 s per query, back-off on 429; the C80.2-C80.4
 * rules for tenures, relatives and retention. Never from CI, never with an end user's name.
 *
 * It exits 1 unless every source applied, stayed unchanged or was re-keyed. The logic lives in
 * `src/watchlists/cli.ts` (tested there); this file only builds the runtime from the environment.
 * Owner: `api-watchlists` (Workflow 6A Stage 3); the command and its package script are frozen by
 * `foundation-6` (Stage 1b).
 */
import { pathToFileURL } from 'node:url';
import { parsePepSyncArgs, runPepSync, watchlistCliExitCode } from '#src/watchlists/cli';
import { runWatchlistCli } from '#src/watchlists/cli-runtime';

/* v8 ignore start -- process entry point */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWatchlistCli(parsePepSyncArgs, runPepSync, watchlistCliExitCode);
}
/* v8 ignore stop */
