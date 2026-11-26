/**
 * Measures the C42.4 1:N scan (`selfie_repeat_detection`) on a database:
 *
 *   pnpm --filter @openverify/api face-scan:benchmark [--templates=<1-200000>] [--runs=<1-20>]
 *
 * It writes a scratch organization with one environment holding `--templates` synthetic sealed
 * templates (seeded random unit vectors, never a face), times `scanFaceTemplates` over all of them
 * (decrypt and score, newest first in batches, as the worker does) `--runs` times, prints the
 * median, and deletes the scratch organization, whose deletion cascades to everything it wrote.
 * Run it on a development or throwaway database, never a production one. Output is timings and
 * counts only.
 *
 * Reads DATABASE_URL and OPENVERIFY_KEK (with OPENVERIFY_KEK_PREVIOUS) from the environment or the
 * repository's .env; messages name the variables, never their values.
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { FACE_SCAN_FLOOR } from '@openverify/checks';
import { newId, safeUrl } from '@openverify/contracts';
import {
  SEALED,
  createDatabase,
  createEnvironment,
  createInquiry,
  createInquiryTemplate,
  createOrganization,
  encodeFaceTemplate,
  faceTemplates,
  keyringFromEnv,
  organizations,
  sealValue,
  setDefaultKeyring,
  verifications,
  type Db,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { scanFaceTemplates } from '#src/jobs/face-search';

export const DEFAULT_BENCHMARK_TEMPLATES = 50_000;
export const MAX_BENCHMARK_TEMPLATES = 200_000;
export const DEFAULT_BENCHMARK_RUNS = 3;
export const MAX_BENCHMARK_RUNS = 20;
/** Rows written per insert while seeding. */
const SEED_CHUNK = 500;

export interface FaceScanBenchmarkArgs {
  templates: number;
  runs: number;
}

export interface FaceScanBenchmarkResult {
  templates: number;
  searched: number;
  truncated: boolean;
  /** Each run's wall-clock time to decrypt and score every template. */
  timingsMs: number[];
  medianMs: number;
  /** Time to write the synthetic sealed templates. */
  seedMs: number;
}

/** The command line is not valid; the message says what to fix. */
export class FaceScanBenchmarkUsageError extends Error {
  override name = 'FaceScanBenchmarkUsageError';
}

const USAGE = 'usage: face-scan:benchmark [--templates=<1-200000>] [--runs=<1-20>]';

const LIMITS = {
  '--templates': { key: 'templates', max: MAX_BENCHMARK_TEMPLATES },
  '--runs': { key: 'runs', max: MAX_BENCHMARK_RUNS },
} as const;

/**
 * Parses the command line (`--templates=<n>` or `--templates <n>`, and `--runs`).
 * @throws {FaceScanBenchmarkUsageError} for an unknown flag or a value out of range.
 */
export function parseFaceScanBenchmarkArgs(argv: readonly string[]): FaceScanBenchmarkArgs {
  const args: FaceScanBenchmarkArgs = {
    templates: DEFAULT_BENCHMARK_TEMPLATES,
    runs: DEFAULT_BENCHMARK_RUNS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag = '', inline] = (argv[index] ?? '').split(/=(.*)/s, 2);
    if (flag !== '--templates' && flag !== '--runs') {
      throw new FaceScanBenchmarkUsageError(`Unknown argument ${flag}. ${USAGE}`);
    }
    const limit = LIMITS[flag];
    const given = inline ?? argv[(index += 1)];
    const value = Number(given);
    if (
      given === undefined ||
      given === '' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > limit.max
    ) {
      throw new FaceScanBenchmarkUsageError(`${flag} must be 1 to ${String(limit.max)}. ${USAGE}`);
    }
    args[limit.key] = value;
  }
  return args;
}

/** A deterministic 128-dimension unit vector (a seeded LCG): a synthetic embedding, no face. */
function syntheticEmbedding(seed: number): number[] {
  let state = (seed * 2_654_435_761) >>> 0;
  const values = Array.from({ length: 128 }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32 - 0.5;
  });
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** An internal `ftpl_` id in the C1 format (the benchmark writes its rows directly). */
function templateId(): string {
  return `ftpl_${Array.from(randomBytes(26), (byte) => CROCKFORD.charAt(byte % 32)).join('')}`;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * Seeds a scratch organization with `templates` sealed templates, times the scan `runs` times,
 * then deletes the organization (and, by cascade, everything written). The default keyring must
 * be set (`setDefaultKeyring`).
 */
export async function measureFaceScan(
  db: Db,
  args: FaceScanBenchmarkArgs,
): Promise<FaceScanBenchmarkResult> {
  const organizationId = newId('org');
  await createOrganization(db, { id: organizationId, name: 'face-scan benchmark (synthetic)' });
  try {
    const environmentId = newId('env');
    await createEnvironment(db, { id: environmentId, organizationId, kind: 'sandbox' });
    const template = await createInquiryTemplate(db, environmentId, {
      id: newId('itmpl'),
      name: 'face-scan benchmark',
      version: { id: newId('itmplv'), flow: {}, verificationConfig: {} },
    });
    const inquiry = await createInquiry(db, environmentId, {
      id: newId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
      referenceId: null,
      fields: {},
    });
    const seedStart = performance.now();
    for (let start = 0; start < args.templates; start += SEED_CHUNK) {
      const ids = Array.from({ length: Math.min(SEED_CHUNK, args.templates - start) }, () =>
        newId('ver'),
      );
      await db
        .insert(verifications)
        .values(
          ids.map((id) => ({ id, environmentId, inquiryId: inquiry.id, type: 'selfie' as const })),
        );
      await db.insert(faceTemplates).values(
        ids.map((verificationId, index) => {
          const id = templateId();
          return {
            id,
            environmentId,
            verificationId,
            inquiryId: inquiry.id,
            model: 'sface-2021dec',
            templateSealed: sealValue(
              SEALED.faceTemplate,
              id,
              encodeFaceTemplate(syntheticEmbedding(start + index + 1)),
            ),
          };
        }),
      );
    }
    const seedMs = performance.now() - seedStart;
    const probe = syntheticEmbedding(0);
    const timingsMs: number[] = [];
    let scan = { searched: 0, truncated: false };
    for (let run = 0; run < args.runs; run += 1) {
      const started = performance.now();
      scan = await scanFaceTemplates(db, environmentId, {
        embedding: probe,
        excludeInquiryIds: [],
        maxTemplates: args.templates,
        floor: FACE_SCAN_FLOOR,
      });
      timingsMs.push(performance.now() - started);
    }
    return {
      templates: args.templates,
      searched: scan.searched,
      truncated: scan.truncated,
      timingsMs,
      medianMs: median(timingsMs),
      seedMs,
    };
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
}

/** The line the command prints: timings and counts only. */
export function describeFaceScanBenchmark(result: FaceScanBenchmarkResult): string {
  const ms = (value: number) => String(Math.round(value));
  const runs = [...result.timingsMs]
    .sort((a, b) => a - b)
    .map(ms)
    .join(', ');
  return (
    `face-scan:benchmark: decrypted and scored ${String(result.searched)} sealed templates in ` +
    `${ms(result.medianMs)} ms (median of ${String(result.timingsMs.length)} runs: ${runs} ms; ` +
    `seeding took ${ms(result.seedMs)} ms).`
  );
}

/* v8 ignore start -- process entry point: a real database, run by hand or in CI */
/** The command: settings from the environment, then one measurement. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const args = parseFaceScanBenchmarkArgs(argv);
  const url = env.DATABASE_URL?.trim() ?? '';
  const protocol = safeUrl(url)?.protocol;
  if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL: must be a postgres:// URL');
  }
  setDefaultKeyring(keyringFromEnv(env));
  const pool = new Pool({ connectionString: url });
  try {
    const result = await measureFaceScan(createDatabase(pool), args);
    process.stdout.write(`${describeFaceScanBenchmark(result)}\n`);
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
/* v8 ignore stop */
