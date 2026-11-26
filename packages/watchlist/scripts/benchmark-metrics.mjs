// @ts-check
/**
 * The metrics of the watchlist evaluation (evaluation-6, plan C78.7 and C78.8): recall per variant
 * source, precision and alerts per 1,000 customers, their 95% intervals from a bootstrap over
 * listed identities (never over pairs), and the percentiles and proportions the performance
 * benchmark reports. Pure functions over observations the benchmark collected; they read nothing
 * and print nothing.
 *
 * The bootstrap resamples units, never pairs (resampling pairs would treat the matches of one
 * identity as independent). Owner decision 7 after Workflow 6C (review C002) fixes the list under
 * test: a match to any listed entry counts in every replicate, whatever the replicate drew.
 * - **Recall and precision** resample the listed identities: a replicate draws the listed entries
 *   with replacement, as many as the list holds, and a drawn case counts once per draw, with its
 *   hit and every other match it kept.
 * - **The false-alert rate** resamples the customers: a drawn customer alerts, once per draw, when
 *   it alerted against the whole list.
 * - The two draws are independent, from one stream seeded by the evaluation seed (identities
 *   first, then customers), so the presets of a set and the trees of one seed share them and every
 *   difference stays paired.
 *
 * Workflow 6C counted a match to another resampled identity only when the replicate drew it, which
 * biased the intervals where most matches are to such identities (6C's company rates). A replicate
 * that draws every unit once now reproduces each point estimate (`qualityReplicate`).
 */
import { seededRandom } from '../src/testing/random.js';

/**
 * @typedef {object} CaseObservation
 * @property {string} id The case id.
 * @property {string} identity The listed entry the case should find.
 * @property {string} source The variant source the case is reported under.
 * @property {readonly string[]} matched The entries the screening kept.
 */

/**
 * @typedef {object} CustomerObservation
 * @property {string} id The customer id.
 * @property {readonly string[]} matched The entries the screening kept.
 */

/**
 * @typedef {object} QualityObservations
 * @property {readonly string[]} identities Every listed entry.
 * @property {readonly CaseObservation[]} cases
 * @property {readonly CustomerObservation[]} customers
 */

/**
 * @typedef {object} QualityPoint
 * @property {Record<string, { hits: number, cases: number, value: number | null }>} recall Per source.
 * @property {{ hits: number, cases: number, value: number | null }} overall Every case together.
 * @property {{ expected: number, other: number, value: number | null }} precision
 * @property {{ customers: number, alerted: number, matches: number, perThousand: number | null }} alerts
 */

/**
 * @typedef {readonly [number, number]} Interval
 */

/**
 * @typedef {object} QualityIntervals
 * @property {number} replicates
 * @property {Record<string, Interval | null>} recall
 * @property {Interval | null} overall
 * @property {Interval | null} precision
 * @property {Interval | null} alertsPerThousand
 * @property {{ precision: number[], alertsPerThousand: number[] } | undefined} samples
 */

/**
 * @typedef {object} TimedScreening One screening of the performance benchmark.
 * @property {number} round 1, 2 or 3.
 * @property {'listed' | 'unlisted'} subject
 * @property {number} ms The whole screening.
 * @property {{ state: number, retrieve: number, load: number }} phases Their milliseconds.
 * @property {number} candidates Retrieved, over every search of the screening.
 * @property {boolean} truncated A search was cut short: at the candidate cap, or (Workflow 6C) out
 *   of reach.
 * @property {boolean} [capReached] A search was cut at the cap (absent from round files written
 *   before the member).
 * @property {boolean} [unreachable] A search had a pair of tokens out of reach (likewise).
 * @property {number} kept The matches at or above the preset's minimum.
 * @property {boolean | null} found A listed subject's own entry was kept (`null` when unlisted).
 */

/**
 * @typedef {object} PerformanceSummary
 * @property {number} screenings
 * @property {{ p50: number, p95: number, p99: number, max: number }} ms Over every round.
 * @property {number[]} roundP95 Each round's p95, in round order.
 * @property {number} leastDisturbedRoundP95 The lowest round p95 (what the C78.7 gate reads).
 * @property {{ state: number, retrieve: number, load: number, rest: number }} phaseP95
 * @property {{ p50: number, p95: number, max: number }} candidates In the first round.
 * @property {{ count: number, of: number, share: number, interval: Interval | null }} capBinds
 *   First round: searches cut short (`truncated`: at the cap, or out of reach at a tree with pair
 *   keys).
 * @property {{ count: number, of: number, share: number, interval: Interval | null } | null} capReached
 *   First round: searches the cap cut, apart from those out of reach; `null` when not recorded.
 * @property {{ count: number, of: number, share: number, interval: Interval | null } | null} unreachable
 *   First round: searches with a pair of tokens out of reach; `null` when not recorded.
 * @property {{ count: number, of: number, share: number, interval: Interval | null }} wouldError
 *   First round: cut short with nothing kept (`result_truncated`).
 * @property {{ found: number, of: number }} listedFound First round.
 */

/**
 * A count of the first round, its share and its 95% Wilson interval.
 * @param {number} count
 * @param {number} of
 */
const shareOf = (count, of) => ({
  count,
  of,
  share: of === 0 ? 0 : count / of,
  interval: wilsonInterval(count, of),
});

/**
 * The first round's share of screenings for which `read` is true, or `null` when a screening of
 * the round does not record it.
 * @param {readonly TimedScreening[]} first
 * @param {(item: TimedScreening) => boolean | undefined} read
 */
function recordedShare(first, read) {
  const values = first.map(read);
  return values.some((value) => value === undefined)
    ? null
    : shareOf(values.filter((value) => value === true).length, first.length);
}

/**
 * The performance benchmark's summary of one scale (C78.7): nearest-rank percentiles over every
 * round, each round's p95, the phases, and how often the cap binds in the first round.
 * @param {readonly TimedScreening[]} screenings
 * @returns {PerformanceSummary}
 */
export function performanceSummary(screenings) {
  if (screenings.length === 0) {
    throw new RangeError('no screening');
  }
  const times = screenings.map((item) => item.ms);
  const rounds = [...new Set(screenings.map((item) => item.round))].sort((a, b) => a - b);
  const roundP95 = rounds.map((round) =>
    percentile(
      screenings.filter((item) => item.round === round).map((item) => item.ms),
      0.95,
    ),
  );
  const first = screenings.filter((item) => item.round === rounds[0]);
  const listed = first.filter((item) => item.subject === 'listed');
  const candidates = first.map((item) => item.candidates);
  const p95 = (/** @type {(item: TimedScreening) => number} */ read) =>
    percentile(screenings.map(read), 0.95);
  return {
    screenings: screenings.length,
    ms: {
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      p99: percentile(times, 0.99),
      max: Math.max(...times),
    },
    roundP95,
    leastDisturbedRoundP95: Math.min(...roundP95),
    phaseP95: {
      state: p95((item) => item.phases.state),
      retrieve: p95((item) => item.phases.retrieve),
      load: p95((item) => item.phases.load),
      rest: p95((item) => item.ms - item.phases.state - item.phases.retrieve - item.phases.load),
    },
    candidates: {
      p50: percentile(candidates, 0.5),
      p95: percentile(candidates, 0.95),
      max: Math.max(...candidates),
    },
    capBinds: shareOf(first.filter((item) => item.truncated).length, first.length),
    capReached: recordedShare(first, (item) => item.capReached),
    unreachable: recordedShare(first, (item) => item.unreachable),
    wouldError: shareOf(
      first.filter((item) => item.truncated && item.kept === 0).length,
      first.length,
    ),
    listedFound: { found: listed.filter((item) => item.found === true).length, of: listed.length },
  };
}

/** Rounding slack for `n × fraction`, so 1,000 × 0.025 ranks 25 and not 26. */
const RANK_SLACK = 1e-9;

/** The normal quantile of a two-sided 95% interval. */
const Z95 = 1.959963984540054;

/**
 * The nearest-rank percentile: the smallest value at or above `fraction` of the values.
 * @param {readonly number[]} values
 * @param {number} fraction In (0, 1].
 * @returns {number}
 */
export function percentile(values, fraction) {
  if (values.length === 0) {
    throw new RangeError('no values');
  }
  if (!(fraction > 0 && fraction <= 1)) {
    throw new RangeError('the fraction must be in (0, 1]');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * fraction - RANK_SLACK));
  return /** @type {number} */ (sorted[rank - 1]);
}

/**
 * A proportion's 95% Wilson score interval, or `null` without trials.
 * @param {number} successes
 * @param {number} total
 * @returns {Interval | null}
 */
export function wilsonInterval(successes, total) {
  if (successes < 0 || total < 0 || successes > total) {
    throw new RangeError('impossible counts');
  }
  if (total === 0) {
    return null;
  }
  const share = successes / total;
  const z2 = Z95 * Z95;
  const centre = (share + z2 / (2 * total)) / (1 + z2 / total);
  const half =
    (Z95 / (1 + z2 / total)) * Math.sqrt((share * (1 - share)) / total + z2 / (4 * total * total));
  // At 0 or every success the bound is exactly 0 or 1; the formula reaches it only up to rounding.
  return [
    successes === 0 ? 0 : Math.max(0, centre - half),
    successes === total ? 1 : Math.min(1, centre + half),
  ];
}

/**
 * The central `level` interval of bootstrap samples (nearest rank), non-finite samples left out;
 * `null` when none is finite.
 * @param {readonly number[]} samples
 * @param {number} [level]
 * @returns {Interval | null}
 */
export function percentileInterval(samples, level = 0.95) {
  const finite = samples.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return null;
  }
  const tail = (1 - level) / 2;
  return [percentile(finite, tail), percentile(finite, 1 - tail)];
}

/**
 * The observations as indexes into the listed entries, checked.
 * @param {QualityObservations} observations
 */
function indexed(observations) {
  /** @type {Map<string, number>} */
  const position = new Map(observations.identities.map((id, index) => [id, index]));
  const at = (/** @type {string} */ id) => {
    const index = position.get(id);
    if (index === undefined) {
      throw new RangeError('an observation names an entry the list does not hold');
    }
    return index;
  };
  /** @type {string[]} */
  const sources = [];
  const cases = observations.cases.map((item) => {
    const identity = at(item.identity);
    const matched = item.matched.map(at);
    if (!sources.includes(item.source)) {
      sources.push(item.source);
    }
    return {
      identity,
      source: sources.indexOf(item.source),
      hit: matched.includes(identity),
      others: Int32Array.from(matched.filter((index) => index !== identity)),
    };
  });
  const customers = observations.customers.map((item) => ({
    matched: Int32Array.from(item.matched.map(at)),
    fixed: 0,
  }));
  return {
    size: position.size,
    sources,
    cases: cases.map((item) => ({ ...item, fixed: 0 })),
    customers,
  };
}

/** @param {number} numerator @param {number} denominator */
const ratio = (numerator, denominator) => (denominator === 0 ? null : numerator / denominator);

/**
 * The point estimates of one preset's observations, with the counts behind them.
 * @param {QualityObservations} observations
 * @returns {QualityPoint}
 */
export function qualityPoint(observations) {
  const { sources, cases, customers } = indexed(observations);
  /** @type {QualityPoint['recall']} */
  const recall = {};
  for (const [index, source] of sources.entries()) {
    const own = cases.filter((item) => item.source === index);
    const hits = own.filter((item) => item.hit).length;
    recall[source] = { hits, cases: own.length, value: ratio(hits, own.length) };
  }
  const hits = cases.filter((item) => item.hit).length;
  const other = cases.reduce((sum, item) => sum + item.others.length, 0);
  const alerted = customers.filter((item) => item.matched.length > 0).length;
  const matches = customers.reduce((sum, item) => sum + item.matched.length, 0);
  return {
    recall,
    overall: { hits, cases: cases.length, value: ratio(hits, cases.length) },
    precision: { expected: hits, other, value: ratio(hits, hits + other) },
    alerts: {
      customers: customers.length,
      alerted,
      matches,
      perThousand: customers.length === 0 ? null : (1000 * alerted) / customers.length,
    },
  };
}

/**
 * @typedef {object} ReplicateMeasures One bootstrap replicate's measures (owner decision 7 after
 *   Workflow 6C); `NaN` where the replicate has nothing to measure.
 * @property {Record<string, number>} recall Per source.
 * @property {number} overall
 * @property {number} precision
 * @property {number} alertsPerThousand
 */

/**
 * @typedef {object} ReplicateDraws How often one replicate drew each unit, in the observations'
 *   order.
 * @property {ArrayLike<number>} identities One count per listed identity.
 * @property {ArrayLike<number>} customers One count per customer.
 */

/**
 * @typedef {object} IndexedObservations Observations as indexes into the listed identities.
 * @property {number} size The listed identities.
 * @property {readonly string[]} sources
 * @property {readonly { identity: number, source: number, hit: boolean, others: ArrayLike<number>, fixed: number }[]} cases
 *   `others`: the other resampled identities the case kept; `fixed`: its matches to entries that
 *   are not resampled.
 * @property {readonly { matched: ArrayLike<number>, fixed: number }[]} customers
 */

/**
 * Owner decision 7 after Workflow 6C: one replicate's measures, for the number of times it drew
 * each listed identity and each customer. A drawn case counts once per draw, with its hit and every
 * other match it kept (fixed ones included); a drawn customer alerts, once per draw, when it
 * alerted against the whole list. `NaN` where the replicate drew nothing to measure.
 * @param {IndexedObservations} set
 * @param {ArrayLike<number>} drawn One count per listed identity.
 * @param {ArrayLike<number>} customerDraws One count per customer.
 * @returns {{ recall: number[], overall: number, precision: number, alertsPerThousand: number }}
 */
export function drawnMeasures(set, drawn, customerDraws) {
  const sourceHits = new Float64Array(set.sources.length);
  const sourceCases = new Float64Array(set.sources.length);
  let expected = 0;
  let falseMatches = 0;
  let weight = 0;
  for (const item of set.cases) {
    const times = drawn[item.identity] ?? 0;
    if (times === 0) {
      continue;
    }
    const hit = item.hit ? times : 0;
    sourceHits[item.source] = (sourceHits[item.source] ?? 0) + hit;
    sourceCases[item.source] = (sourceCases[item.source] ?? 0) + times;
    expected += hit;
    weight += times;
    falseMatches += times * (item.others.length + item.fixed);
  }
  let alerted = 0;
  for (const [index, customer] of set.customers.entries()) {
    if (customer.fixed > 0 || customer.matched.length > 0) {
      alerted += customerDraws[index] ?? 0;
    }
  }
  return {
    recall: Array.from(sourceHits, (hits, index) => hits / (sourceCases[index] ?? 0)),
    overall: expected / weight,
    precision: expected / (expected + falseMatches),
    alertsPerThousand:
      set.customers.length === 0 ? Number.NaN : (1000 * alerted) / set.customers.length,
  };
}

/**
 * Draw counts checked against the observations they draw.
 * @param {IndexedObservations} set
 * @param {ReplicateDraws} draws
 */
export function checkedDraws(set, draws) {
  if (draws.identities.length !== set.size || draws.customers.length !== set.customers.length) {
    throw new RangeError('one draw count per listed identity and per customer');
  }
  return draws;
}

/**
 * The measures of one replicate of {@link bootstrapQuality} for the given draws (owner decision 7
 * after Workflow 6C): drawing every unit once gives {@link qualityPoint}'s values exactly.
 * @param {QualityObservations} observations
 * @param {ReplicateDraws} draws
 * @returns {ReplicateMeasures}
 */
export function qualityReplicate(observations, draws) {
  const set = indexed(observations);
  const { identities, customers } = checkedDraws(set, draws);
  const measures = drawnMeasures(set, identities, customers);
  return {
    ...measures,
    recall: Object.fromEntries(
      set.sources.map((source, index) => [source, measures.recall[index] ?? Number.NaN]),
    ),
  };
}

/**
 * The 95% intervals of {@link qualityPoint}'s values from a bootstrap over the listed identities
 * and the customers (owner decision 7 after Workflow 6C: the list under test is fixed).
 * @param {QualityObservations} observations
 * @param {{ replicates: number, seed: string, keepSamples?: boolean }} options
 * @returns {QualityIntervals}
 */
export function bootstrapQuality(observations, options) {
  if (!Number.isInteger(options.replicates) || options.replicates < 1) {
    throw new RangeError('at least one replicate');
  }
  const set = indexed(observations);
  const { size, sources, customers } = set;
  const random = seededRandom(`evaluation-6/bootstrap/${options.seed}`);
  /** @type {number[][]} */
  const recall = sources.map(() => []);
  /** @type {number[]} */
  const overall = [];
  /** @type {number[]} */
  const precision = [];
  /** @type {number[]} */
  const alerts = [];
  const drawn = new Uint32Array(size);
  const customerDraws = new Uint32Array(customers.length);
  for (let replicate = 0; replicate < options.replicates; replicate += 1) {
    drawn.fill(0);
    for (let left = size; left > 0; left -= 1) {
      const at = random.int(size);
      drawn[at] = (drawn[at] ?? 0) + 1;
    }
    customerDraws.fill(0);
    for (let left = customers.length; left > 0; left -= 1) {
      const at = random.int(customers.length);
      customerDraws[at] = (customerDraws[at] ?? 0) + 1;
    }
    const measures = drawnMeasures(set, drawn, customerDraws);
    for (const [index, samples] of recall.entries()) {
      samples.push(measures.recall[index] ?? Number.NaN);
    }
    overall.push(measures.overall);
    precision.push(measures.precision);
    alerts.push(measures.alertsPerThousand);
  }
  return {
    replicates: options.replicates,
    recall: Object.fromEntries(
      sources.map((source, index) => [source, percentileInterval(recall[index] ?? [])]),
    ),
    overall: percentileInterval(overall),
    precision: percentileInterval(precision),
    alertsPerThousand: percentileInterval(alerts),
    samples: options.keepSamples === true ? { precision, alertsPerThousand: alerts } : undefined,
  };
}
