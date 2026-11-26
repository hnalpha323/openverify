/**
 * C101.8, C102.8 (Workflow 7B; F18): the synthetic graph the CI gate (100,000 accounts,
 * `graph-engine.integration.test.ts`) and `graph:benchmark` (1,000,000 accounts, about 6,000,000
 * rows) share. Written in SQL from a seed, a batch of accounts at a time, so a build resumes where
 * it stopped and the same seed gives the same graph. Value keys are `sha256('<seed>|<kind>|<n>')`:
 * no value, no person, nothing from a publisher. Only for tests and the benchmark.
 *
 * Account `n` (0-based) holds, as `account` rows:
 *
 * | Kind | Value | Holders |
 * |---|---|---|
 * | `email_address` (strong) | `n / 10` | rings of 10 |
 * | `phone_number` (strong) | `(n + 5) / 10` | rings shifted by 5, chaining the email rings |
 * | `device_fingerprint` (medium) | `n` | none shared |
 * | `phone_number_unconfirmed` (medium) | one value | the first `hubHolders` accounts: a hub |
 * | `ip_address` (weak) | `hash(n) mod 0.3 n` | about 3.3 on average |
 * | `name` (weak) | `hash(n) mod 0.5 n` | about 2 |
 * | `birthdate` (weak) | `hash(n) mod 0.03 n` | about 33, some past the fan-out cap |
 *
 * Six rows an account and the hub's: 1,000,000 accounts give 6,005,000 rows.
 */
import { createHash } from 'node:crypto';
import { createAccount, type Db } from '@openverify/db';
import { sql, type SQL } from 'drizzle-orm';

export interface SyntheticGraphOptions {
  environmentId: string;
  accounts: number;
  seed: string;
  /** Accounts written per statement; 50,000 by default. */
  batchSize?: number | undefined;
  /**
   * Batches written at once, each in its own transaction on its own connection; 1 by default (the
   * benchmark's sequential build). Every row is a function of `n`, the seed and `accounts`, so
   * concurrent batches write the same rows. A concurrent build may stop with a later batch written
   * and an earlier one not, so it resumes from the first batch (every insert skips what exists).
   * The graph-engine template's build uses it on a fresh database (owner decision 17 after 7B).
   */
  concurrency?: number | undefined;
  /** Holders of the one hub value; `min(5,000, accounts)` by default. */
  hubHolders?: number | undefined;
  /** The kinds to write; all six (and the hub) by default. The CI gate writes the three it reads. */
  kinds?: readonly SyntheticKind[] | undefined;
  /**
   * The accounts `[from, to)` that hold the weak kinds (`ip`, `name`, `birthdate`); every account
   * by default. The CI gate keeps them near its starts: the build is most of its time.
   */
  weakAccounts?: readonly [number, number] | undefined;
  /**
   * Phase 7's R007 (Workflow 11D): `dense` makes the strong rings five times wider (email `n / 50`,
   * phone `(n + 25) / 50`), so a hop reaches about 50 accounts instead of 10: as wide as the default
   * fan-out cap (`GRAPH_LIMITS.defaultFanOut`), past which a value is skipped as a hub (fix-11d:
   * rings of 100 were skipped, so no strong hop left its start). Absent or `default`: the shape
   * above, row for row.
   */
  shape?: SyntheticShape | undefined;
}

/** R007: the graph shapes `graph:benchmark` builds. */
export const SYNTHETIC_SHAPES = ['default', 'dense'] as const;
export type SyntheticShape = (typeof SYNTHETIC_SHAPES)[number];

/** The labels of the table above. */
export const SYNTHETIC_KINDS = ['email', 'phone', 'device', 'ip', 'name', 'birthdate'] as const;
export type SyntheticKind = (typeof SYNTHETIC_KINDS)[number];

export interface SyntheticGraphBuild {
  accounts: number;
  rows: number;
  /** Batches written by this call (a resumed build writes only what was missing). */
  batches: number;
}

async function rowsOf<Row extends Record<string, unknown>>(db: Db, query: SQL): Promise<Row[]> {
  const result: unknown = await db.execute(query);
  return (result as { rows: Row[] }).rows;
}

/** The id of synthetic account `n`: `acc_` and 26 hex digits, all Crockford characters. */
export const syntheticAccountId = (n: number): string =>
  `acc_${n.toString(16).toUpperCase().padStart(26, '0')}`;

/** The SQL id of account `n` in a statement over `generate_series` as `n`. */
const ACCOUNT_ID = sql.raw(`'acc_' || lpad(upper(to_hex(n)), 26, '0')`);

/** The 64-hex value key of `<seed>|<label>|<expression>`. */
const keyOf = (seed: string, label: string, expression: string) =>
  sql`encode(sha256(convert_to(${seed} || ${`|${label}|`} || (${sql.raw(expression)})::text,
    'UTF8')), 'hex')`;

/** Writes the synthetic graph, or what is missing of it. */
export async function buildSyntheticGraph(
  db: Db,
  options: SyntheticGraphOptions,
): Promise<SyntheticGraphBuild> {
  const { environmentId, accounts, seed } = options;
  const batchSize = options.batchSize ?? 50_000;
  const hub = Math.min(options.hubHolders ?? 5000, accounts);
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('buildSyntheticGraph: concurrency must be a whole number of at least 1');
  }
  // The environment's `user` account type, made by the repository with the first account.
  const typeRows = await rowsOf<{ id: string }>(
    db,
    sql`select id from account_types where environment_id = ${environmentId} limit 1`,
  );
  const typeId =
    typeRows[0]?.id ??
    (await createAccount(db, environmentId, { id: syntheticAccountId(0) })).accountTypeId;
  const existing = await rowsOf<{ n: number }>(
    db,
    sql`select count(*)::int as n from accounts where environment_id = ${environmentId}`,
  );
  const writeBatch = async (start: number) => {
    const end = Math.min(start + batchSize, accounts) - 1;
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into accounts (id, environment_id, account_type_id)
        select ${ACCOUNT_ID}, ${environmentId}, ${typeId}
        from generate_series(${start}::int, ${end}::int) as n
        on conflict do nothing`);
      // R007: the dense shape widens the strong rings; the default keeps its exact expressions.
      const dense = options.shape === 'dense';
      const kinds: [number, SyntheticKind, string][] = [
        [4, 'email', dense ? 'n / 50' : 'n / 10'],
        [5, 'phone', dense ? '(n + 25) / 50' : '(n + 5) / 10'],
        [11, 'device', 'n'],
        [14, 'ip', `abs(hashtext(n::text)) % ${String(Math.max(1, Math.floor(accounts * 0.3)))}`],
        [
          15,
          'name',
          `abs(hashtext('x' || n::text)) % ${String(Math.max(1, Math.floor(accounts / 2)))}`,
        ],
        [
          16,
          'birthdate',
          `abs(hashtext('y' || n::text)) % ${String(Math.max(1, Math.floor(accounts * 0.03)))}`,
        ],
      ];
      const wanted = new Set(options.kinds ?? SYNTHETIC_KINDS);
      for (const [kind, label, expression] of kinds.filter(([, label]) => wanted.has(label))) {
        const [from, to] =
          label === 'ip' || label === 'name' || label === 'birthdate'
            ? (options.weakAccounts ?? [0, accounts])
            : [0, accounts];
        const first = Math.max(start, from);
        const last = Math.min(end, to - 1);
        if (first > last) {
          continue;
        }
        await tx.execute(sql`
          insert into graph_attributes (environment_id, kind, value_key, key_id, account_id,
            source_type, source_id)
          select ${environmentId}, ${kind}, ${keyOf(seed, label, expression)}, 'synthetic-1',
            ${ACCOUNT_ID}, 'account', ${ACCOUNT_ID}
          from generate_series(${first}::int, ${last}::int) as n
          on conflict do nothing`);
      }
      if (start < hub) {
        await tx.execute(sql`
          insert into graph_attributes (environment_id, kind, value_key, key_id, account_id,
            source_type, source_id)
          select ${environmentId}, 7, ${keyOf(seed, 'hub', '0')}, 'synthetic-1', ${ACCOUNT_ID},
            'account', ${ACCOUNT_ID}
          from generate_series(${start}::int, ${Math.min(end, hub - 1)}::int) as n
          on conflict do nothing`);
      }
    });
  };
  const starts: number[] = [];
  for (
    let start = concurrency === 1 ? Math.floor((existing[0]?.n ?? 0) / batchSize) * batchSize : 0;
    start < accounts;
    start += batchSize
  ) {
    starts.push(start);
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, starts.length) }, async () => {
      while (next < starts.length) {
        const start = starts[next] ?? 0;
        next += 1;
        await writeBatch(start);
      }
    }),
  );
  const batches = starts.length;
  await db.execute(sql`analyze graph_attributes`);
  const rows = await rowsOf<{ n: number }>(
    db,
    sql`select count(*)::int as n from graph_attributes where environment_id = ${environmentId}`,
  );
  return { accounts, rows: rows[0]?.n ?? 0, batches };
}

/** The value key a synthetic account holds of `label` (`email`, `phone`, ...), for a start. */
export function syntheticValueKey(seed: string, label: string, value: number): string {
  // The same text the SQL hashes: `<seed>|<label>|<value>`.
  return createHash('sha256')
    .update(`${seed}|${label}|${String(value)}`, 'utf8')
    .digest('hex');
}
