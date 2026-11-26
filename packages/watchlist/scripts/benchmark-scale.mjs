// @ts-check
/**
 * The results and comparisons of the watchlist evaluation's observation files (Workflow 6C, owner
 * decisions 1, 4 and 5), and the options every benchmark step shares. Pure functions: the CLIs
 * read the files and write what these return.
 *
 * - **Sets.** The 6B quality set (`persons/names`, `persons/birthdates`, `companies`, with the
 *   person customers) and the scale sets of the held-out population embedded in a performance
 *   table (`persons` with the person customers, `companies` with the company customers).
 * - **Results** per set and preset: the counts, the point estimates with Wilson intervals, the 95%
 *   intervals of a bootstrap over the listed identities and the customers (one stream, so the
 *   presets are paired), and the diagnostics.
 * - **Comparisons** of two runs of one seed (Workflow 6C's base and head): each run's intervals
 *   and the interval of `head - base`, on the same draws.
 * - **Indistinguishable customers** (equal to a listed entry in name and birth date) are left out
 *   of the false-alert rate and counted apart.
 * - **Identity** (owner decision 8 after Workflow 6C): the digest of a query's full created matches,
 *   the identity check of two runs keyed by query and preset, a switch's share from rounds off and
 *   on, and the executed `list_update` runs against the runs a re-screen inserted (below).
 */

import { createHash } from 'node:crypto';
import { percentile } from './benchmark-metrics.mjs';
import { differenceOf, intervalsOf, pairedPoint, pairedSamples } from './benchmark-paired.mjs';

/** @typedef {import('./benchmark-paired.mjs').PairedObservations} PairedObservations */
/** @typedef {import('./benchmark-paired.mjs').PairedPoint} PairedPoint */
/** @typedef {import('./benchmark-paired.mjs').PairedIntervals} PairedIntervals */

/**
 * @typedef {object} PresetRun One preset's screening of a query.
 * @property {string[]} matched The resampled identities kept (all kept entries for the 6B set).
 * @property {number} [fixed] Kept entries of the table under test, outside the resampled list.
 * @property {string[]} limits
 * @property {string[]} errors
 */

/**
 * @typedef {object} Observation One query of an observation file.
 * @property {string} key
 * @property {string} set
 * @property {string | null} identity
 * @property {string | null} source
 * @property {Record<string, PresetRun>} presets
 */

/**
 * @typedef {object} SetSpec Which observations make one set.
 * @property {string} cases The `set` of its cases.
 * @property {string | null} customers The `set` of its customers, or `null`.
 */

/**
 * @typedef {object} Diagnostics
 * @property {number} misses
 * @property {number} missesFlagged Misses whose coverage stated a limit.
 * @property {{ cases: number, customers: number }} truncated
 * @property {{ cases: number, customers: number }} errored
 */

/**
 * @typedef {object} PresetResult
 * @property {PairedPoint} point
 * @property {PairedIntervals} intervals
 * @property {Diagnostics} diagnostics
 * @property {{ customers: number, alerted: number }} indistinguishable
 */

/**
 * @typedef {object} PresetComparison
 * @property {PairedPoint} base
 * @property {PairedPoint} head
 * @property {PairedIntervals} baseIntervals
 * @property {PairedIntervals} headIntervals
 * @property {{ recall: Record<string, number | null>, overall: number | null, precision: number | null, alertsPerThousand: number | null }} difference
 *   `head - base` of the point estimates.
 * @property {PairedIntervals} differenceIntervals
 */

const NAMESPACE = /^[a-z0-9][a-z0-9-]{0,39}$/u;

/**
 * A benchmark container's name: its base name, then the namespace, then `smoke` for a smoke run,
 * so runs in two worktrees or a smoke run never reuse another run's database.
 * @param {string} base
 * @param {{ smoke?: boolean, namespace?: string | undefined }} options
 */
export function containerName(base, options) {
  if (options.namespace !== undefined && !NAMESPACE.test(options.namespace)) {
    throw new RangeError('a namespace is 1 to 40 lower-case letters, digits and hyphens');
  }
  return [base, options.namespace, options.smoke === true ? 'smoke' : undefined]
    .filter((part) => part !== undefined)
    .join('-');
}

/**
 * The names of part `part` of `parts` of a table of `names` (each part a full publication).
 * @param {number} names
 * @param {number} part
 * @param {number} parts
 */
export function partTarget(names, part, parts) {
  if (
    !Number.isInteger(parts) ||
    parts < 1 ||
    !Number.isInteger(part) ||
    part < 1 ||
    part > parts
  ) {
    throw new RangeError(`--part is 1 to ${String(parts)}`);
  }
  return Math.round((names * part) / parts);
}

/**
 * @typedef {object} StepWriter A resumable step's observation lines.
 * @property {(line: string) => Promise<boolean>} add Adds one line; `true` when the step's budget
 *   is spent, every line given so far then written.
 * @property {() => Promise<void>} flush Writes the lines not yet written.
 */

/**
 * The observation file of a resumable step (`screen`, `scale-screen`, `<scale>-variants`): lines
 * appended `batch` at a time, and whether the call's budget is spent, checked after every query
 * (calibration-6c follow-up: checked after each batch only, a batch of slow 2,000,000-name queries
 * carried a call 3 minutes past its 8-minute budget).
 * @param {{ append: (text: string) => Promise<void>, batch: number, budgetMs: number, started: number, now?: () => number }} options
 * @returns {StepWriter}
 */
export function stepWriter(options) {
  const now = options.now ?? (() => performance.now());
  /** @type {string[]} */
  let pending = [];
  const flush = async () => {
    if (pending.length === 0) {
      return;
    }
    const text = `${pending.join('\n')}\n`;
    pending = [];
    await options.append(text);
  };
  return {
    async add(line) {
      pending.push(line);
      if (pending.length >= options.batch) {
        await flush();
      }
      if (now() - options.started <= options.budgetMs) {
        return false;
      }
      await flush();
      return true;
    },
    flush,
  };
}

/**
 * A kept match split into the resampled population and the table under test.
 * @param {readonly string[]} entryIds The kept entries' ids.
 * @param {string} populationPrefix The population's id prefix.
 * @returns {{ matched: string[], fixed: number }}
 */
export function splitMatches(entryIds, populationPrefix) {
  const matched = entryIds.filter((id) => id.startsWith(populationPrefix));
  return { matched, fixed: entryIds.length - matched.length };
}

/**
 * One set's runs, one per preset, ready for the paired bootstrap.
 * @param {readonly Observation[]} observations
 * @param {SetSpec & { presets: readonly string[], identities: readonly string[], excluded?: ReadonlySet<string> }} options
 * @returns {Record<string, PairedObservations>}
 */
export function runsOf(observations, options) {
  const cases = observations.filter((item) => item.set === options.cases);
  const customers = observations.filter(
    (item) =>
      options.customers !== null &&
      item.set === options.customers &&
      options.excluded?.has(item.key) !== true,
  );
  const run = (/** @type {Observation} */ item, /** @type {string} */ preset) =>
    item.presets[preset] ?? { matched: [], fixed: 0, limits: [], errors: [] };
  return Object.fromEntries(
    options.presets.map((preset) => [
      preset,
      {
        identities: options.identities,
        cases: cases.map((item) => ({
          id: item.key,
          identity: item.identity ?? '',
          source: item.source ?? '',
          matched: run(item, preset).matched,
          fixed: run(item, preset).fixed ?? 0,
        })),
        customers: customers.map((item) => ({
          id: item.key,
          matched: run(item, preset).matched,
          fixed: run(item, preset).fixed ?? 0,
        })),
      },
    ]),
  );
}

/**
 * The diagnostics of one set at one preset.
 * @param {readonly Observation[]} observations
 * @param {SetSpec & { excluded?: ReadonlySet<string> }} spec
 * @param {string} preset
 * @returns {Diagnostics}
 */
function diagnosticsOf(observations, spec, preset) {
  /** @type {Diagnostics} */
  const out = {
    misses: 0,
    missesFlagged: 0,
    truncated: { cases: 0, customers: 0 },
    errored: { cases: 0, customers: 0 },
  };
  for (const item of observations) {
    const isCase = item.set === spec.cases;
    const isCustomer =
      spec.customers !== null &&
      item.set === spec.customers &&
      spec.excluded?.has(item.key) !== true;
    const run = item.presets[preset];
    if ((!isCase && !isCustomer) || run === undefined) {
      continue;
    }
    const kind = isCase ? 'cases' : 'customers';
    if (isCase && item.identity !== null && !run.matched.includes(item.identity)) {
      out.misses += 1;
      out.missesFlagged += run.limits.length > 0 ? 1 : 0;
    }
    out.truncated[kind] += run.limits.includes('truncated') ? 1 : 0;
    out.errored[kind] += run.errors.length > 0 ? 1 : 0;
  }
  return out;
}

/**
 * The customers of a set left out of its false-alert rate, and how many of them alerted.
 * @param {readonly Observation[]} observations
 * @param {SetSpec & { excluded?: ReadonlySet<string> }} spec
 * @param {string} preset
 */
function indistinguishableOf(observations, spec, preset) {
  const left = observations.filter(
    (item) =>
      spec.customers !== null &&
      item.set === spec.customers &&
      spec.excluded?.has(item.key) === true,
  );
  return {
    customers: left.length,
    alerted: left.filter((item) => {
      const run = item.presets[preset];
      return run !== undefined && (run.matched.length > 0 || (run.fixed ?? 0) > 0);
    }).length,
  };
}

/**
 * The runs of every preset, in the order of `presets`.
 * @param {readonly Observation[]} observations
 * @param {SetSpec & { presets: readonly string[], identities: readonly string[], excluded?: ReadonlySet<string> }} options
 */
function orderedRuns(observations, options) {
  const runs = runsOf(observations, options);
  return options.presets.map((preset) => /** @type {PairedObservations} */ (runs[preset]));
}

/**
 * One set's results at each preset.
 * @param {readonly Observation[]} observations
 * @param {SetSpec & { presets: readonly string[], identities: readonly string[], excluded?: ReadonlySet<string>, replicates: number, seed: string, label?: string }} options
 * @returns {Record<string, PresetResult>}
 */
export function setResults(observations, options) {
  const runs = orderedRuns(observations, options);
  const samples = pairedSamples(runs, options);
  return Object.fromEntries(
    options.presets.map((preset, index) => [
      preset,
      {
        point: pairedPoint(/** @type {PairedObservations} */ (runs[index])),
        intervals: intervalsOf(
          /** @type {import('./benchmark-paired.mjs').PairedSamples} */ (samples[index]),
        ),
        diagnostics: diagnosticsOf(observations, options, preset),
        indistinguishable: indistinguishableOf(observations, options, preset),
      },
    ]),
  );
}

/** @param {number | null} head @param {number | null} base */
const minus = (head, base) => (head === null || base === null ? null : head - base);

/**
 * Two runs of one set (base and head, one seed) at each preset, on the same draws.
 * @param {readonly Observation[]} base
 * @param {readonly Observation[]} head
 * @param {SetSpec & { presets: readonly string[], identities: readonly string[], excluded?: ReadonlySet<string>, replicates: number, seed: string, label?: string }} options
 * @returns {Record<string, PresetComparison>}
 */
export function compareSet(base, head, options) {
  const baseRuns = orderedRuns(base, options);
  const headRuns = orderedRuns(head, options);
  const samples = pairedSamples([...baseRuns, ...headRuns], options);
  const count = options.presets.length;
  return Object.fromEntries(
    options.presets.map((preset, index) => {
      const basePoint = pairedPoint(/** @type {PairedObservations} */ (baseRuns[index]));
      const headPoint = pairedPoint(/** @type {PairedObservations} */ (headRuns[index]));
      const baseSamples = /** @type {import('./benchmark-paired.mjs').PairedSamples} */ (
        samples[index]
      );
      const headSamples = /** @type {import('./benchmark-paired.mjs').PairedSamples} */ (
        samples[count + index]
      );
      /** @type {PresetComparison} */
      const comparison = {
        base: basePoint,
        head: headPoint,
        baseIntervals: intervalsOf(baseSamples),
        headIntervals: intervalsOf(headSamples),
        difference: {
          recall: Object.fromEntries(
            Object.entries(basePoint.recall).map(([source, value]) => [
              source,
              minus(headPoint.recall[source]?.value ?? null, value.value),
            ]),
          ),
          overall: minus(headPoint.overall.value, basePoint.overall.value),
          precision: minus(headPoint.precision.value, basePoint.precision.value),
          alertsPerThousand: minus(headPoint.alerts.perThousand, basePoint.alerts.perThousand),
        },
        differenceIntervals: intervalsOf(differenceOf(baseSamples, headSamples)),
      };
      return [preset, comparison];
    }),
  );
}

/**
 * Owner decision 8 after Workflow 6C: Workflow 6D's calibration measures performance and checks
 * that quality is identical instead of re-deciding it. In 6D no C78.4 constant, rule, threshold,
 * preset or cap changes, and every matcher change keeps the created matches identical, so:
 *
 * - **The digest.** Each observation line carries, per preset, a SHA-256 of the query's full
 *   created matches, every member the run returns (`matchDigest`).
 * - **The identity check.** Base and head are compared keyed by query and preset (steps resume, so
 *   lines are not compared in order): the kept ids, `fixed`, `limits`, `errors` and the digest
 *   (`identityCheck`).
 * - **The shares.** A switchable change is measured off and on alternately in one process
 *   (`switchShare`).
 * - **The executed runs.** After each `rescreen-<n>`, the inserted `list_update` runs are executed
 *   with nothing persisted, and every one must keep a match on an entry its trigger sync changed
 *   (`executedRunsCheck`), which tests review C004 at scale.
 *
 * Pure functions over what the CLIs collected; they read nothing and print nothing.
 */

/**
 * @typedef {object} IdentityLine One query's observation: its key and, per preset, the members
 *   the identity check compares.
 * @property {string} key
 * @property {Readonly<Record<string, Readonly<Record<string, unknown>>>>} presets
 */

/**
 * @typedef {object} IdentityResult
 * @property {{ base: number, head: number, both: number }} queries
 * @property {number} compared The (query, preset) pairs of the queries both runs hold, a preset
 *   held by one run alone included (it differs).
 * @property {number} identical
 * @property {number} differing
 * @property {Record<string, number>} byField How many pairs differ in each field.
 * @property {{ base: number, head: number }} only Queries held by one run alone.
 * @property {number} undigested Pairs without a digest on either side.
 * @property {{ key: string, preset: string, fields: string[] }[]} examples The first differences.
 * @property {boolean} same Every query on both sides, every pair digested and identical.
 */

/**
 * @typedef {object} ShareRound One round of a share measurement.
 * @property {'off' | 'on'} state
 * @property {number} p95
 */

/**
 * @typedef {object} SwitchShare
 * @property {{ off: number, on: number, worse: number }[]} takes Each pair of rounds; `worse` is
 *   on − off (negative when the change saves time).
 * @property {number} medianOff
 * @property {number} medianOn
 * @property {number} medianWorse The median of the takes' `worse`.
 * @property {readonly [number, number]} range The least and the most `worse`.
 * @property {number} relativeWorse `medianWorse` over `medianOff`.
 */

/**
 * @typedef {object} ExecutedRun One executed `list_update` run's line (counts and codes only).
 * @property {string} reportId
 * @property {number} changed Kept matches on an entry the trigger sync added or changed.
 * @property {number} kept Kept matches in all.
 * @property {string[]} errors
 * @property {string} [subject] A digest of the subject the run screened (its query), the same at
 *   two trees of one seed whatever the report ids.
 */

/**
 * @typedef {object} ExecutedRunsCheck
 * @property {number} runs The `list_update` runs the re-screen inserted.
 * @property {number} executed
 * @property {number} missing Runs without a line.
 * @property {number} keptChanged Runs keeping a match on a changed entry.
 * @property {number} missed Runs keeping none: a forward-screen hit its run did not keep.
 * @property {number} errored
 * @property {string[]} errorCodes
 * @property {number} matchesOnChangedEntries
 * @property {{ subjects: number, covered: number, short: number } | null} full Against the no-miss
 *   check's full screenings, when given: of the run reports whose full screening keeps a match on
 *   a changed entry, those whose run keeps at least as many (`covered`) and fewer (`short`).
 * @property {string | null} subjects The SHA-256 of the runs' subject digests, sorted, one a line
 *   (`subject`); `null` when a line has none.
 * @property {boolean} pass No run missing and none missed.
 */

/**
 * Canonical JSON: object members sorted by key, arrays in their order, `undefined` members left
 * out as `JSON.stringify` leaves them.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, /** @type {Record<string, unknown>} */ (item)[key]]),
        )
      : item,
  );
}

/**
 * The SHA-256 of a screening's full created matches, in the run's order: every member the run
 * returns of each (the entry key, the score, the content and risk-data hashes, the matched name,
 * and the snapshot's entity with its alias type, match types, qualifiers and components with the
 * list name, the name level and the methods), as canonical JSON.
 * @param {readonly unknown[]} matches
 * @returns {string}
 */
export function matchDigest(matches) {
  return createHash('sha256').update(canonicalJson(matches), 'utf8').digest('hex');
}

/** The members the identity check compares per query and preset (owner decision 8). */
export const IDENTITY_FIELDS = Object.freeze(['matched', 'fixed', 'limits', 'errors', 'digest']);

/**
 * Base and head keyed by query and preset: each field of {@link IDENTITY_FIELDS} compared as
 * canonical JSON. A query screened twice (a resumed step) counts by its last line.
 * @param {readonly IdentityLine[]} base
 * @param {readonly IdentityLine[]} head
 * @param {{ fields?: readonly string[], examples?: number }} [options]
 * @returns {IdentityResult}
 */
export function identityCheck(base, head, options = {}) {
  const fields = options.fields ?? IDENTITY_FIELDS;
  const most = options.examples ?? 20;
  const byKey = (/** @type {readonly IdentityLine[]} */ lines) =>
    new Map(lines.map((item) => [item.key, item]));
  const left = byKey(base);
  const right = byKey(head);
  /** @type {Record<string, number>} */
  const byField = Object.fromEntries(fields.map((field) => [field, 0]));
  /** @type {IdentityResult['examples']} */
  const examples = [];
  let both = 0;
  let compared = 0;
  let identical = 0;
  let undigested = 0;
  for (const [key, ours] of left) {
    const theirs = right.get(key);
    if (theirs === undefined) {
      continue;
    }
    both += 1;
    const presets = [...new Set([...Object.keys(ours.presets), ...Object.keys(theirs.presets)])];
    for (const preset of presets.sort()) {
      compared += 1;
      const one = ours.presets[preset];
      const other = theirs.presets[preset];
      /** @type {string[]} */
      let differs;
      if (one === undefined || other === undefined) {
        differs = ['preset'];
      } else {
        undigested += one.digest === undefined || other.digest === undefined ? 1 : 0;
        differs = fields.filter(
          (field) => canonicalJson(one[field]) !== canonicalJson(other[field]),
        );
        for (const field of differs) {
          byField[field] = (byField[field] ?? 0) + 1;
        }
      }
      if (differs.length === 0) {
        identical += 1;
      } else if (examples.length < most) {
        examples.push({ key, preset, fields: differs });
      }
    }
  }
  const only = { base: left.size - both, head: right.size - both };
  return {
    queries: { base: left.size, head: right.size, both },
    compared,
    identical,
    differing: compared - identical,
    byField,
    only,
    undigested,
    examples,
    same:
      compared > 0 &&
      identical === compared &&
      undigested === 0 &&
      only.base === 0 &&
      only.head === 0,
  };
}

/**
 * A switch's share from its rounds, run off then on, alternately, in one process: each off round
 * and the on round after it make a take, whose `worse` is on − off. The share is the median of the
 * takes' `worse`, with its range.
 * @param {readonly ShareRound[]} rounds
 * @returns {SwitchShare}
 */
export function switchShare(rounds) {
  if (
    rounds.length === 0 ||
    rounds.length % 2 !== 0 ||
    rounds.some((round, index) => round.state !== (index % 2 === 0 ? 'off' : 'on'))
  ) {
    throw new RangeError('the rounds alternate off then on, in pairs');
  }
  /** @type {SwitchShare['takes']} */
  const takes = [];
  for (let index = 0; index < rounds.length; index += 2) {
    const off = /** @type {ShareRound} */ (rounds[index]).p95;
    const on = /** @type {ShareRound} */ (rounds[index + 1]).p95;
    takes.push({ off, on, worse: on - off });
  }
  const median = (/** @type {number[]} */ values) => percentile(values, 0.5);
  const worse = takes.map((take) => take.worse);
  const medianOff = median(takes.map((take) => take.off));
  const medianWorse = median(worse);
  return {
    takes,
    medianOff,
    medianOn: median(takes.map((take) => take.on)),
    medianWorse,
    range: [Math.min(...worse), Math.max(...worse)],
    relativeWorse: medianWorse / medianOff,
  };
}

/**
 * The executed `list_update` runs of one re-screen against the runs it inserted: every one must
 * have a line and keep a match on an entry its trigger sync changed (a forward-screen hit its run
 * keeps). A run executed twice (a resumed call) counts by its last line. With the no-miss check's
 * full screenings, the run reports whose full screening keeps a match on a changed entry are set
 * against their runs: a run screens its trigger's changed entries beside retrieval, so it keeps at
 * least as many.
 * @param {{ runs: readonly string[], lines: readonly ExecutedRun[], full?: readonly { reportId: string, changed: number }[] }} input
 * @returns {ExecutedRunsCheck}
 */
export function executedRunsCheck(input) {
  const runs = new Set(input.runs);
  /** @type {Map<string, ExecutedRun>} */
  const byReport = new Map(
    input.lines.filter((item) => runs.has(item.reportId)).map((item) => [item.reportId, item]),
  );
  const lines = [...byReport.values()];
  const missing = [...runs].filter((reportId) => !byReport.has(reportId)).length;
  const missed = lines.filter((item) => item.changed === 0).length;
  let full = null;
  if (input.full !== undefined) {
    const subjects = input.full.filter((item) => item.changed > 0 && runs.has(item.reportId));
    const covered = subjects.filter(
      (item) => (byReport.get(item.reportId)?.changed ?? 0) >= item.changed,
    ).length;
    full = { subjects: subjects.length, covered, short: subjects.length - covered };
  }
  return {
    runs: runs.size,
    executed: lines.length,
    missing,
    keptChanged: lines.length - missed,
    missed,
    errored: lines.filter((item) => item.errors.length > 0).length,
    errorCodes: [...new Set(lines.flatMap((item) => item.errors))].sort(),
    matchesOnChangedEntries: lines.reduce((sum, item) => sum + item.changed, 0),
    full,
    subjects: lines.every((item) => typeof item.subject === 'string')
      ? createHash('sha256')
          .update(
            lines
              .map((item) => /** @type {string} */ (item.subject))
              .sort()
              .join('\n'),
            'utf8',
          )
          .digest('hex')
      : null,
    pass: missing === 0 && missed === 0,
  };
}
