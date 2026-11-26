/**
 * Re-indexes every stored identification number (C31.8), OTP destination and wallet address
 * (C53.4), chip read (C53.3: the SOD signature and the document number), device HMAC (C94.4)
 * list key (C98.2), transaction field key (C105.4), case field key (C136.4), audit entry address
 * (C168.6), graph row (C101.5) and report index (C73.4) under the current blind index key:
 *
 *   pnpm --filter @openverify/api blind-index:rebuild [--batch-size=<1-10000>]
 *
 * Run it after changing `OPENVERIFY_BLIND_INDEX_KEY`, before the worker processes more
 * government IDs: every unredacted extraction of every environment is decrypted (with the KEK),
 * and its index recomputed from its issuer code, class group and number. Redacted extractions
 * have no index and stay as they are. Output is counts only, never ids or data.
 *
 * Reads DATABASE_URL, OPENVERIFY_KEK (and OPENVERIFY_KEK_PREVIOUS) and
 * OPENVERIFY_BLIND_INDEX_KEY from the environment or the repository's .env; messages name the
 * variables, never their values.
 */
import { pathToFileURL } from 'node:url';
import { safeUrl } from '@openverify/contracts';
import {
  blindIndexKeyFromEnv,
  createDatabase,
  keyringFromEnv,
  rebuildChipReadIndexes,
  rebuildCryptoAddressIndexes,
  rebuildDeviceIndexes,
  rebuildIdentificationNumberIndexes,
  rebuildOtpDestinationIndexes,
  rebuildReportIndexes,
  setDefaultKeyring,
  type Db,
  type RebuildIndexesResult,
  type ReportIndexesRebuild,
} from '@openverify/db';
import { Pool } from 'pg';
import { rebuildAuditLogIpIndex } from '#src/services/access/audit-ip-index';
import { rebuildCaseFieldKeys } from '#src/services/cases/rebuild';
import { rebuildGraphIndexes } from '#src/services/graph/rebuild';
import { rebuildListIndexes } from '#src/services/lists/rebuild';
import { rebuildTransactionFieldKeys } from '#src/services/transactions/rebuild';

export const DEFAULT_REBUILD_BATCH_SIZE = 100;
export const MAX_REBUILD_BATCH_SIZE = 10_000;

export interface BlindIndexRebuildArgs {
  batchSize: number;
}

/** The command line is not valid; the message says what to fix. */
export class BlindIndexRebuildUsageError extends Error {
  override name = 'BlindIndexRebuildUsageError';
}

const USAGE = 'usage: blind-index:rebuild [--batch-size=<1-10000>]';

/**
 * Parses the command line (`--batch-size=<n>` or `--batch-size <n>`).
 * @throws {BlindIndexRebuildUsageError} for an unknown flag or a bad value.
 */
export function parseBlindIndexRebuildArgs(argv: readonly string[]): BlindIndexRebuildArgs {
  const args: BlindIndexRebuildArgs = { batchSize: DEFAULT_REBUILD_BATCH_SIZE };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    if (flag !== '--batch-size') {
      throw new BlindIndexRebuildUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
    const given = inline ?? argv[(index += 1)];
    const size = Number(given);
    if (given === undefined || given === '' || !Number.isInteger(size) || size < 1) {
      throw new BlindIndexRebuildUsageError(
        `--batch-size must be 1 to ${String(MAX_REBUILD_BATCH_SIZE)}. ${USAGE}`,
      );
    }
    args.batchSize = Math.min(size, MAX_REBUILD_BATCH_SIZE);
  }
  return args;
}

export interface RunBlindIndexRebuildOptions {
  db: Db;
  key: Uint8Array;
  args: BlindIndexRebuildArgs;
  /** Prints one line; counts only. */
  out: (line: string) => void;
}

/** The extractions' counts, and those of the Workflow 5A and 5B indexes (C53.4). */
export interface BlindIndexRebuildResult extends RebuildIndexesResult {
  otpDestinations: RebuildIndexesResult;
  walletAddresses: RebuildIndexesResult;
  chipReads: RebuildIndexesResult;
  /** C94.4 (Workflow 7A): the device HMACs, from their sealed components while retained. */
  devices: RebuildIndexesResult;
  /** C98.2 (Workflow 7B): the list keys, from their sealed values. */
  lists: RebuildIndexesResult;
  /** C105.4 (Workflow 7B): the searchable field keys, from their sealed fields. */
  transactions: RebuildIndexesResult;
  /** C136.4 (Workflow 8B): the searchable case field keys, from their sealed fields. */
  cases: RebuildIndexesResult;
  /** C168.6 (Workflow 9B): the audit entries' address index, from their encrypted addresses. */
  auditLogAddresses: RebuildIndexesResult;
  /** C101.5 (Workflow 7B): the graph rows, from their sources' plaintext. */
  graph: RebuildIndexesResult;
  /** C73.4: the report crypto-address indexes and the match entry indexes and evidence hashes. */
  reports: ReportIndexesRebuild;
}

/** One run over every unredacted extraction, OTP destination, wallet address and chip read. */
export async function runBlindIndexRebuild(
  options: RunBlindIndexRebuildOptions,
): Promise<BlindIndexRebuildResult> {
  const batch = { batchSize: options.args.batchSize };
  const result = await rebuildIdentificationNumberIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(result.scanned)} extractions, ` +
      `re-indexed ${String(result.updated)}.`,
  );
  // C53.4: the Workflow 5A indexes, recomputed from their sealed values.
  const otpDestinations = await rebuildOtpDestinationIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(otpDestinations.scanned)} OTP destinations, ` +
      `re-indexed ${String(otpDestinations.updated)}.`,
  );
  const walletAddresses = await rebuildCryptoAddressIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(walletAddresses.scanned)} wallet addresses, ` +
      `re-indexed ${String(walletAddresses.updated)}.`,
  );
  // C53.3, C53.4: the Workflow 5B chip read indexes.
  const chipReads = await rebuildChipReadIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(chipReads.scanned)} chip reads, ` +
      `re-indexed ${String(chipReads.updated)}.`,
  );
  // C94.4 (Workflow 7A): the device HMACs and their key id (`api-signals`).
  const devices = await rebuildDeviceIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(devices.scanned)} devices, ` +
      `re-indexed ${String(devices.updated)}.`,
  );
  // C98.2 (Workflow 7B): the list keys, recomputed in the API, which holds the key inputs.
  const lists = await rebuildListIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(lists.scanned)} list items, ` +
      `re-indexed ${String(lists.updated)}.`,
  );
  // C105.4 (Workflow 7B): the searchable field keys, recomputed in the API, which reads the pinned
  // versions' field schemas.
  const transactions = await rebuildTransactionFieldKeys(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(transactions.scanned)} transaction field keys, ` +
      `re-indexed ${String(transactions.updated)}.`,
  );
  // C136.4 (Workflow 8B; P25): the searchable case field keys, from the pinned versions' schemas.
  const cases = await rebuildCaseFieldKeys(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(cases.scanned)} case field keys, ` +
      `re-indexed ${String(cases.updated)}.`,
  );
  // C168.6 (Workflow 9B Stage 1b (U); P23): the audit IP index, recomputed in the API from each
  // entry's encrypted address, never updating `audit_logs` (`api-access`).
  const auditLogAddresses = await rebuildAuditLogIpIndex(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(auditLogAddresses.scanned)} audit log addresses, ` +
      `re-indexed ${String(auditLogAddresses.updated)}.`,
  );
  // C101.5 (Workflow 7B): the graph rows, recomputed in the API from their sources (`api-graph`).
  const graph = await rebuildGraphIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(graph.scanned)} graph rows, ` +
      `re-indexed ${String(graph.updated)}.`,
  );
  // C73.4: the report indexes, from the sealed query and snapshot (`api-reports`).
  const reports = await rebuildReportIndexes(options.db, options.key, batch);
  options.out(
    `blind-index:rebuild: done: scanned ${String(reports.reports.scanned)} reports and ` +
      `${String(reports.matches.scanned)} matches, re-indexed ` +
      `${String(reports.reports.updated + reports.matches.updated)}.`,
  );
  return {
    ...result,
    otpDestinations,
    walletAddresses,
    chipReads,
    devices,
    lists,
    transactions,
    cases,
    auditLogAddresses,
    graph,
    reports,
  };
}

/** The command: settings from the environment, then one run. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseBlindIndexRebuildArgs(argv);
  const url = env.DATABASE_URL?.trim() ?? '';
  const protocol = safeUrl(url)?.protocol;
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL: must be a postgres:// URL');
  }
  // The index key is a separate secret from the KEK the fields are sealed under (C31.8).
  const key = blindIndexKeyFromEnv(env);
  setDefaultKeyring(keyringFromEnv(env));
  const pool = new Pool({ connectionString: url });
  try {
    await runBlindIndexRebuild({
      db: createDatabase(pool),
      key,
      args,
      out: (line) => process.stdout.write(`${line}\n`),
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
