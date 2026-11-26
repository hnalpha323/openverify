// @ts-check
/**
 * C270 (Workflow 11D, matcher-write-11d): the pure helpers of the matcher's write-cost steps
 * (`benchmark-write-steps.mjs`, run through `benchmark:performance`): the step names, the `--tune`
 * flags, the plans of the resumable steps, the publications of the identity sequence, the peak
 * memory of a re-key and the summary of screening during a sync. The method is
 * `docs/calibration/watchlist-phase11.md` (items 7 to 9).
 */

import { percentile } from './benchmark-metrics.mjs';

/** The write steps, each run as `<scale>-<name>`. */
export const WRITE_STEPS = Object.freeze(
  /** @type {const} */ (['snapshot', 'keydf-identity', 'keydf-sync', 'rekey', 'gin-sync']),
);

/** @typedef {(typeof WRITE_STEPS)[number]} WriteStepName */

/**
 * @typedef {object} WriteTunes The `--tune` flags, as `WatchlistWriteTuning`'s members.
 * @property {number} [rekeyBatch]
 * @property {number} [ginPendingListLimitKb]
 * @property {number} [ginCleanEveryBatches]
 */

/** Each `--tune` name and the `WatchlistWriteTuning` member it sets, in the labels' order. */
const TUNES = Object.freeze(
  /** @type {const} */ ([
    ['rekey-batch', 'rekeyBatch'],
    ['gin-pending-list-limit', 'ginPendingListLimitKb'],
    ['gin-clean-every', 'ginCleanEveryBatches'],
  ]),
);

const WRITE_STEP = new RegExp(`^(100k|2m)-(${WRITE_STEPS.join('|')})$`, 'u');

/**
 * The scale and name of a write step (`<scale>-<name>`), or `null` for any other step.
 * @param {string} step
 * @returns {{ scale: '100k' | '2m', name: WriteStepName } | null}
 */
export function writeStepOf(step) {
  const match = WRITE_STEP.exec(step);
  if (match === null) {
    return null;
  }
  return {
    scale: /** @type {'100k' | '2m'} */ (match[1]),
    name: /** @type {WriteStepName} */ (match[2]),
  };
}

/**
 * The `--tune <name>=<n>` flags (Stage 1a amendment 7), each a whole number at most once; the
 * ranges are the registry's, which refuses a value outside them when it is set.
 * @param {readonly string[] | undefined} values
 * @returns {WriteTunes}
 */
export function parseTunes(values) {
  /** @type {WriteTunes} */
  const tunes = {};
  for (const value of values ?? []) {
    const [name = '', given] = value.split('=', 2);
    if (given === undefined) {
      throw new Error(`--tune takes <name>=<n>, not ${value}`);
    }
    const member = TUNES.find(([flag]) => flag === name)?.[1];
    if (member === undefined) {
      throw new Error(`--tune is one of ${TUNES.map(([flag]) => flag).join(', ')}`);
    }
    if (!/^\d+$/u.test(given)) {
      throw new Error(`--tune ${name} takes a whole number`);
    }
    if (tunes[member] !== undefined) {
      throw new Error(`--tune ${name} is given once`);
    }
    tunes[member] = Number(given);
  }
  return tunes;
}

/**
 * A take's configuration, as its file names and records label it: the switch, then each tuning in
 * a fixed order, joined by `+`; `status-quo` without either.
 * @param {{ switch?: string | undefined, tunes: WriteTunes }} input
 * @returns {string}
 */
export function configurationLabel(input) {
  const parts = [
    ...(input.switch === undefined ? [] : [input.switch]),
    ...TUNES.flatMap(([flag, member]) =>
      input.tunes[member] === undefined ? [] : [`${flag}=${String(input.tunes[member])}`],
    ),
  ];
  return parts.length === 0 ? 'status-quo' : parts.join('+');
}

/**
 * @typedef {object} SyncAction One sync of the incremental step's timing.
 * @property {number} take
 * @property {'off' | 'on'} state The switch `incremental-key-df` during the sync.
 * @property {'timed' | 'restore'} kind
 */

/**
 * C270.1's timing (method item 7): per take, the change's sync with the switch off, then on, each
 * followed by a restore (the previous publication again, untimed, with the switch on), so every
 * timed sync starts from the same table.
 * @param {number} takes
 * @returns {SyncAction[]}
 */
export function syncTakesPlan(takes) {
  if (!Number.isInteger(takes) || takes < 1) {
    throw new RangeError('--takes is a whole number from 1');
  }
  /** @type {SyncAction[]} */
  const plan = [];
  for (let take = 1; take <= takes; take += 1) {
    for (const state of /** @type {const} */ (['off', 'on'])) {
      plan.push({ take, state, kind: 'timed' }, { take, state: 'on', kind: 'restore' });
    }
  }
  return plan;
}

/**
 * @typedef {object} IdentityAction One action of the identity sequence.
 * @property {'sync' | 'check' | 'screen' | 'rebuild'} action
 * @property {number} op The sync it follows (0 for the screenings and the rebuild).
 * @property {'shipped' | 'none'} [groups] The variant groups a sync keys with.
 * @property {'incremental' | 'rebuilt'} [tree] The table a screening reads.
 */

/**
 * @typedef {object} IdentityOp One sync of the identity sequence, by position in the table.
 * @property {'shipped' | 'none'} groups `none` re-keys the source with no variant group first.
 * @property {readonly (readonly [number, number])[]} removed Positions `i` with `i % step == at`.
 * @property {readonly (readonly [number, number])[]} renamed Positions given another name.
 * @property {number} added The fraction of the added entries listed.
 * @property {number} addedRemovedEvery Every n-th added entry is left out (0: none).
 */

/** C270.1's sequence (method item 7): adds, removals, renames, re-listings, a group change. */
const IDENTITY_OPS = Object.freeze(
  /** @type {readonly IdentityOp[]} */ ([
    { groups: 'shipped', removed: [[97, 3]], renamed: [[53, 7]], added: 0.5, addedRemovedEvery: 0 },
    {
      groups: 'shipped',
      // Every 194th from 3 keeps half of op 1's removals: the other half is listed again.
      removed: [
        [194, 3],
        [101, 50],
      ],
      renamed: [[59, 13]],
      added: 1,
      addedRemovedEvery: 0,
    },
    {
      groups: 'none',
      removed: [
        [194, 3],
        [101, 50],
        [89, 11],
      ],
      renamed: [[61, 5]],
      added: 1,
      addedRemovedEvery: 4,
    },
    {
      groups: 'none',
      removed: [
        [194, 3],
        [89, 11],
      ],
      renamed: [],
      added: 1,
      addedRemovedEvery: 4,
    },
  ]),
);

/**
 * The identity step's actions (method item 7): each sync with `incremental-key-df` on, then a
 * check of the table against a full rebuild; after the last, the scale's subjects screened on the
 * incremental table, a full rebuild committed, and the subjects screened again (the 6D digests).
 * @returns {IdentityAction[]}
 */
export function identityPlan() {
  return [
    ...IDENTITY_OPS.flatMap((op, index) => [
      { action: /** @type {const} */ ('sync'), op: index + 1, groups: op.groups },
      { action: /** @type {const} */ ('check'), op: index + 1 },
    ]),
    { action: 'screen', op: 0, tree: 'incremental' },
    { action: 'rebuild', op: 0 },
    { action: 'screen', op: 0, tree: 'rebuilt' },
  ];
}

/** @param {readonly (readonly [number, number])[]} rules @param {number} index */
const hits = (rules, index) => rules.some(([step, at]) => index % step === at % step);

/**
 * The publication of sync `op` of the identity sequence: the table without its removed positions,
 * the renamed positions taken from `others` (the same ids, other names), then the added entries
 * it lists, every list in its own order.
 * @template T
 * @param {{ table: readonly T[], others: readonly T[], added: readonly T[], op: number }} input
 * @returns {T[]}
 */
export function identityPublication(input) {
  const op = IDENTITY_OPS[input.op - 1];
  if (op === undefined) {
    throw new RangeError(`the identity sequence has syncs 1 to ${String(IDENTITY_OPS.length)}`);
  }
  /** @type {T[]} */
  const records = [];
  input.table.forEach((record, index) => {
    if (!hits(op.removed, index)) {
      records.push(hits(op.renamed, index) ? (input.others[index] ?? record) : record);
    }
  });
  const listed = input.added.slice(0, Math.round(input.added.length * op.added));
  listed.forEach((record, index) => {
    if (op.addedRemovedEvery === 0 || index % op.addedRemovedEvery !== 0) {
      records.push(record);
    }
  });
  return records;
}

const MIB = 2 ** 20;

/**
 * The largest RSS and V8 heap of a re-key's samples, in MiB (one decimal).
 * @param {readonly { rss: number, heapUsed: number }[]} samples
 * @returns {{ rssMiB: number, heapMiB: number }}
 */
export function peakMemory(samples) {
  if (samples.length === 0) {
    throw new RangeError('no memory samples');
  }
  const mib = (/** @type {number} */ bytes) => Math.round((bytes / MIB) * 10) / 10;
  return {
    rssMiB: mib(Math.max(...samples.map((sample) => sample.rss))),
    heapMiB: mib(Math.max(...samples.map((sample) => sample.heapUsed))),
  };
}

/** @typedef {{ count: number, p50: number | null, p95: number | null }} TimingSummary */

/**
 * @typedef {object} DuringSyncSummary
 * @property {TimingSummary} idle
 * @property {TimingSummary} during
 * @property {number | null} ratio The p95 during the sync over the idle p95.
 * @property {boolean | null} withinTwiceIdle C270.3's rule: the ratio at most 2.
 * @property {number} syncSeconds
 */

/** @param {readonly number[]} values @returns {TimingSummary} */
const timingSummary = (values) => ({
  count: values.length,
  p50: values.length === 0 ? null : percentile(values, 0.5),
  p95: values.length === 0 ? null : percentile(values, 0.95),
});

/**
 * C270.3 and C269.4 (method item 9): the screening p95 during a sync against idle, and whether it
 * stays within twice idle, beside the sync's own time.
 * @param {{ idle: readonly number[], during: readonly number[], syncSeconds: number }} input
 * @returns {DuringSyncSummary}
 */
export function duringSyncSummary(input) {
  const idle = timingSummary(input.idle);
  const during = timingSummary(input.during);
  const ratio =
    idle.p95 === null || during.p95 === null || idle.p95 === 0 ? null : during.p95 / idle.p95;
  return {
    idle,
    during,
    ratio,
    withinTwiceIdle: ratio === null ? null : ratio <= 2,
    syncSeconds: input.syncSeconds,
  };
}

/**
 * Where the snapshots' dumps are kept inside the benchmark's container (Workflow 11D review,
 * fix-11d; docs/calibration/watchlist-phase11.md finding 1): `CREATE DATABASE … TEMPLATE` ended the
 * backend with exit code 2 part-way through the 2.3 GB 2,000,000-name database, so a snapshot is a
 * `pg_dump` file and each take's database is restored from it into an empty database.
 */
export const SNAPSHOT_DIRECTORY = '/var/lib/postgresql/openverify-snapshots';

/** A database name the write steps make (the dump file is named after it). */
const SNAPSHOT_NAME = /^[a-z][a-z0-9_]{0,62}$/u;

/**
 * The dump file of snapshot database `snapshot`.
 * @param {string} snapshot
 * @returns {string}
 */
export function snapshotDumpPath(snapshot) {
  if (!SNAPSHOT_NAME.test(snapshot)) {
    throw new Error(`${snapshot} is not a database name the write steps make`);
  }
  return `${SNAPSHOT_DIRECTORY}/${snapshot}.dump`;
}

/**
 * The command that dumps a database to a snapshot's file (custom format, uncompressed: the dump is
 * read back on the same disk, so compression would only cost time).
 * @param {{ user: string, database: string, file: string }} input
 * @returns {string[]}
 */
export function dumpCommand(input) {
  return [
    'pg_dump',
    `--username=${input.user}`,
    `--dbname=${input.database}`,
    '--format=custom',
    '--compress=0',
    `--file=${input.file}`,
  ];
}

/**
 * The command that restores a snapshot's file into an empty database, `jobs` at a time, stopping at
 * the first error (a partial copy is never a take's database).
 * @param {{ user: string, database: string, file: string, jobs: number }} input
 * @returns {string[]}
 */
export function restoreCommand(input) {
  return [
    'pg_restore',
    `--username=${input.user}`,
    `--dbname=${input.database}`,
    `--jobs=${String(input.jobs)}`,
    '--exit-on-error',
    input.file,
  ];
}
