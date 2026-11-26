/**
 * Runs the C16 retention pass once, now, instead of waiting for the daily `retention` job:
 *
 *   pnpm --filter @openverify/api retention:run [--now=<ISO-8601>] [--batch-size=<1-10000>]
 *                                              [--json]
 *
 * It does what the job does (`services/retention.ts`): redacts terminal inquiries past their
 * retention, deletes leftover storage objects, then API logs, finished webhook deliveries,
 * idempotency keys and events past their windows. Redaction events are delivered by the worker
 * as usual.
 *
 * - `--now` evaluates retention as of that time instead of the current one: an inquiry is due
 *   when its `updated-at` is older than `--now` minus its retention. Use it to see what a
 *   future run will remove (on a test stack: everything is really removed). Redactions are
 *   still stamped with the real time.
 * - Output is counts only, never ids or data; `--json` prints one JSON line.
 *
 * Reads the API's settings (DATABASE_URL, REDIS_URL, S3_*, OPENVERIFY_KEK, ...) from the
 * environment or the repository's .env; messages name the variables, never their values.
 */
import { pathToFileURL } from 'node:url';
import type { Db } from '@openverify/db';
import { loadConfig } from '#src/config';
import { createContainer } from '#src/container';
import { systemClock, type Clock, type FileStorage, type RedactionService } from '#src/ports';
import { createRedactionService } from '#src/services/redaction';
import { isRetentionIncomplete, runRetention, type RetentionReport } from '#src/services/retention';

export const DEFAULT_RETENTION_BATCH_SIZE = 500;
export const MAX_RETENTION_BATCH_SIZE = 10_000;

export interface RetentionRunArgs {
  /** Evaluate retention as of this time; `null` means the current time. */
  now: Date | null;
  batchSize: number;
  json: boolean;
}

/** The command line is not valid; the message says what to fix. */
export class RetentionRunUsageError extends Error {
  override name = 'RetentionRunUsageError';
}

const USAGE = 'usage: retention:run [--now=<ISO-8601>] [--batch-size=<1-10000>] [--json]';
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parses the command line (`--name=value` or `--name value`).
 * @throws {RetentionRunUsageError} for an unknown flag or a bad value.
 */
export function parseRetentionRunArgs(argv: readonly string[]): RetentionRunArgs {
  const args: RetentionRunArgs = {
    now: null,
    batchSize: DEFAULT_RETENTION_BATCH_SIZE,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    const value = (): string => {
      const given = inline ?? argv[(index += 1)];
      if (given === undefined || given === '') {
        throw new RetentionRunUsageError(`${flag} needs a value. ${USAGE}`);
      }
      return given;
    };
    switch (flag) {
      case '--json':
        args.json = true;
        break;
      case '--now': {
        const text = value();
        const now = new Date(text);
        if (!ISO_8601.test(text) || Number.isNaN(now.getTime())) {
          throw new RetentionRunUsageError(
            '--now must be an ISO-8601 time such as 2027-01-01T00:00:00Z.',
          );
        }
        args.now = now;
        break;
      }
      case '--batch-size': {
        const size = Number(value());
        if (!Number.isInteger(size) || size < 1 || size > MAX_RETENTION_BATCH_SIZE) {
          throw new RetentionRunUsageError(
            `--batch-size must be 1 to ${String(MAX_RETENTION_BATCH_SIZE)}.`,
          );
        }
        args.batchSize = size;
        break;
      }
      default:
        throw new RetentionRunUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
  }
  return args;
}

export interface RunRetentionCommandOptions {
  db: Db;
  storage: FileStorage;
  /** Stamps redactions with the real time (its own clock), whatever `--now` says. */
  redaction: RedactionService;
  args: RetentionRunArgs;
  /** Prints one line; counts only. */
  out: (line: string) => void;
  /** The current time when `--now` is absent; defaults to the system clock. */
  clock?: Clock;
  logger?: {
    info(object: object, message: string): void;
    warn(object: object, message: string): void;
  };
}

/** One retention run as of `args.now` (or the clock's time), reported through `out`. */
export async function runRetentionCommand(
  options: RunRetentionCommandOptions,
): Promise<RetentionReport> {
  const { args, out } = options;
  const now = args.now ?? (options.clock ?? systemClock).now();
  const report = await runRetention({
    db: options.db,
    storage: options.storage,
    redaction: options.redaction,
    clock: { now: () => now },
    batchSize: args.batchSize,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  if (args.json) {
    out(JSON.stringify({ now: now.toISOString(), report }));
    return report;
  }
  out(`retention:run: as of ${now.toISOString()}`);
  for (const [name, count] of Object.entries(report)) {
    out(`retention:run: ${name} ${String(count)}`);
  }
  if (isRetentionIncomplete(report)) {
    out(
      `retention:run: incomplete: ${String(report.failedRedactions)} inquiries could not be ` +
        `redacted and ${String(report.failedPurges)} files could not be deleted`,
    );
  }
  out('retention:run: done');
  return report;
}

/* v8 ignore start -- the entry point runs against a real stack (the e2e retention spec) */
async function main(): Promise<void> {
  const args = parseRetentionRunArgs(process.argv.slice(2));
  const container = createContainer(loadConfig(process.env));
  const warn = (object: object, message: string) => {
    process.stderr.write(`${JSON.stringify({ level: 'warn', msg: message, ...object })}\n`);
  };
  try {
    const report = await runRetentionCommand({
      db: container.db,
      storage: container.storage,
      redaction: createRedactionService({
        db: container.db,
        storage: container.storage,
        events: container.events,
        clock: systemClock,
        logger: { warn },
      }),
      args,
      out: (line) => process.stdout.write(`${line}\n`),
      logger: { info: () => undefined, warn },
    });
    // A run that left PII behind fails the command, so scripts and operators notice (2B F031).
    if (isRetentionIncomplete(report)) {
      process.exitCode = 1;
    }
  } finally {
    await container.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
