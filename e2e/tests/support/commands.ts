/**
 * Operator commands of `@openverify/api`, run against the e2e stack with the run's settings
 * (`e2e/.env.e2e`), as a self-hoster runs them.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnvFile } from '../../src/env.js';
import { ENV_FILE, REPO_ROOT } from '../../src/paths.js';
import { childEnvironment, runCommand } from '../../src/processes.js';

const API_DIR = path.join(REPO_ROOT, 'apps', 'api');

/** The stack's settings (`e2e/.env.e2e`) for a command run beside it. */
async function stackEnvironment(): Promise<NodeJS.ProcessEnv> {
  return childEnvironment(parseEnvFile(await readFile(ENV_FILE, 'utf8')));
}

export interface RetentionRunOutput {
  now: string;
  report: Record<string, number>;
}

/**
 * `pnpm --filter @openverify/api retention:run --now=<now> --json`: the C16 retention job,
 * evaluated as of `now` (an injected clock).
 */
export async function runRetentionAsOf(now: Date): Promise<RetentionRunOutput> {
  const { stdout } = await runCommand(
    'pnpm',
    [
      'exec',
      'tsx',
      '--conditions=@openverify/source',
      'scripts/retention-run.ts',
      `--now=${now.toISOString()}`,
      '--json',
    ],
    { cwd: API_DIR, env: await stackEnvironment(), timeoutMs: 120_000, label: 'retention:run' },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as RetentionRunOutput;
}

/** One source's line of `watchlists:sync --json` (C76.2, C76.5): counts and codes only. */
export interface WatchlistSyncOutput {
  sourceId: string;
  outcome: string;
  syncId: number | null;
  rekeyed: boolean;
  entryCount: number;
  added: number;
  changed: number;
  removed: number;
  rescreen: 'none' | 'enqueued' | 'pending';
  errorCode: string | null;
}

/**
 * `pnpm --filter @openverify/api watchlists:sync --import <file> --source <id> --json`: an
 * operator's import of a list file into the stack (C76.2). It makes no request, so the run needs no
 * token or User-Agent, and it enqueues the re-screen of an applied change (C74.4).
 */
export async function importWatchlist(
  file: string,
  sourceId: string,
): Promise<WatchlistSyncOutput> {
  const { stdout } = await runCommand(
    'pnpm',
    [
      'exec',
      'tsx',
      '--conditions=@openverify/source',
      'scripts/watchlists-sync.ts',
      '--import',
      file,
      '--source',
      sourceId,
      '--json',
    ],
    { cwd: API_DIR, env: await stackEnvironment(), timeoutMs: 120_000, label: 'watchlists:sync' },
  );
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as WatchlistSyncOutput;
}
