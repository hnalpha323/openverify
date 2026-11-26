// @ts-check
/**
 * Paired bootstrap intervals of the watchlist evaluation (Workflow 6C, owner decisions 1, 4 and
 * 5): the presets of one set screened on the same queries, or Workflow 6C's base and head on one
 * seed, are compared on the same draws, so their differences carry intervals of their own.
 *
 * A replicate draws the resampled listed identities with replacement, then the customers, from one
 * stream seeded by the evaluation seed, in the order `bootstrapQuality` draws them
 * (`benchmark-metrics.mjs`): with its label, a run's intervals here are that function's. Owner
 * decision 7 after Workflow 6C (review C002) fixes the list under test, as there: a drawn case
 * counts once per draw, with its hit and every other match it kept, and a drawn customer alerts,
 * once per draw, when it alerted against the whole list. Both functions share one replicate
 * (`drawnMeasures`), and drawing every unit once reproduces `pairedPoint` (`pairedReplicate`).
 *
 * The scale sets embed the held-out population in a performance table. Its listed identities are
 * resampled; the table's own entries are never drawn, and a match to one of them (`fixed`, a
 * count) counts like any other match.
 */

import { seededRandom } from '../src/testing/random.js';
import {
  checkedDraws,
  drawnMeasures,
  percentileInterval,
  wilsonInterval,
} from './benchmark-metrics.mjs';

/** @typedef {import('./benchmark-metrics.mjs').Interval} Interval */

/**
 * @typedef {object} PairedCase
 * @property {string} id The case id.
 * @property {string} identity The listed entry the case should find (a resampled identity).
 * @property {string} source The variant source the case is reported under.
 * @property {readonly string[]} matched The resampled identities the screening kept.
 * @property {number} [fixed] The matches to entries that are not resampled.
 */

/**
 * @typedef {object} PairedCustomer
 * @property {string} id The customer id.
 * @property {readonly string[]} matched The resampled identities the screening kept.
 * @property {number} [fixed] The matches to entries that are not resampled.
 */

/**
 * @typedef {object} PairedObservations One run: a preset of a set, at the base or the head.
 * @property {readonly string[]} identities The resampled listed identities.
 * @property {readonly PairedCase[]} cases
 * @property {readonly PairedCustomer[]} customers
 */

/**
 * @typedef {object} Share
 * @property {number} count
 * @property {number} of
 * @property {number | null} value
 * @property {Interval | null} wilson The 95% Wilson interval, for a count of zero or of all.
 */

/**
 * @typedef {object} PairedPoint
 * @property {Record<string, { hits: number, cases: number, value: number | null, wilson: Interval | null }>} recall
 * @property {{ hits: number, cases: number, value: number | null, wilson: Interval | null }} overall
 * @property {{ expected: number, other: number, value: number | null, wilson: Interval | null }} precision
 * @property {{ customers: number, alerted: number, matches: number, perThousand: number | null, wilson: Interval | null }} alerts
 *   `wilson` is per 1,000 customers.
 */

/**
 * @typedef {object} PairedIntervals
 * @property {Record<string, Interval | null>} recall
 * @property {Interval | null} overall
 * @property {Interval | null} precision
 * @property {Interval | null} alertsPerThousand
 */

/**
 * @typedef {object} PairedSamples
 * @property {Record<string, number[]>} recall
 * @property {number[]} overall
 * @property {number[]} precision
 * @property {number[]} alertsPerThousand
 */

/** @param {number} numerator @param {number} denominator */
const ratio = (numerator, denominator) => (denominator === 0 ? null : numerator / denominator);

/**
 * A run as indexes into its identities, checked.
 * @param {PairedObservations} run
 */
function indexed(run) {
  /** @type {Map<string, number>} */
  const position = new Map(run.identities.map((id, index) => [id, index]));
  const at = (/** @type {string} */ id) => {
    const index = position.get(id);
    if (index === undefined) {
      throw new RangeError('an observation names an entry the run does not resample');
    }
    return index;
  };
  /** @type {string[]} */
  const sources = [];
  const cases = run.cases.map((item) => {
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
      fixed: item.fixed ?? 0,
    };
  });
  const customers = run.customers.map((item) => ({
    matched: Int32Array.from(item.matched.map(at)),
    fixed: item.fixed ?? 0,
  }));
  return { size: position.size, sources, cases, customers };
}

/**
 * The point estimates of one run, with the counts behind them and Wilson intervals.
 * @param {PairedObservations} run
 * @returns {PairedPoint}
 */
export function pairedPoint(run) {
  const { sources, cases, customers } = indexed(run);
  /** @type {PairedPoint['recall']} */
  const recall = {};
  for (const [index, source] of sources.entries()) {
    const own = cases.filter((item) => item.source === index);
    const hits = own.filter((item) => item.hit).length;
    recall[source] = {
      hits,
      cases: own.length,
      value: ratio(hits, own.length),
      wilson: wilsonInterval(hits, own.length),
    };
  }
  const hits = cases.filter((item) => item.hit).length;
  const other = cases.reduce((sum, item) => sum + item.others.length + item.fixed, 0);
  const alerted = customers.filter((item) => item.matched.length > 0 || item.fixed > 0).length;
  const matches = customers.reduce((sum, item) => sum + item.matched.length + item.fixed, 0);
  const alertShare = wilsonInterval(alerted, customers.length);
  return {
    recall,
    overall: {
      hits,
      cases: cases.length,
      value: ratio(hits, cases.length),
      wilson: wilsonInterval(hits, cases.length),
    },
    precision: {
      expected: hits,
      other,
      value: ratio(hits, hits + other),
      wilson: wilsonInterval(hits, hits + other),
    },
    alerts: {
      customers: customers.length,
      alerted,
      matches,
      perThousand: customers.length === 0 ? null : (1000 * alerted) / customers.length,
      wilson: alertShare === null ? null : [alertShare[0] * 1000, alertShare[1] * 1000],
    },
  };
}

/**
 * Whether two runs hold the same identities, cases and customers, in the same order.
 * @param {PairedObservations} left
 * @param {PairedObservations} right
 */
function paired(left, right) {
  return (
    left.identities.length === right.identities.length &&
    left.identities.every((id, index) => right.identities[index] === id) &&
    left.cases.length === right.cases.length &&
    left.cases.every((item, index) => {
      const other = right.cases[index];
      return (
        other !== undefined &&
        other.id === item.id &&
        other.identity === item.identity &&
        other.source === item.source
      );
    }) &&
    left.customers.length === right.customers.length &&
    left.customers.every((item, index) => right.customers[index]?.id === item.id)
  );
}

/**
 * The measures of one replicate of {@link pairedSamples} for the given draws (owner decision 7
 * after Workflow 6C): drawing every unit once gives {@link pairedPoint}'s values exactly.
 * @param {PairedObservations} run
 * @param {import('./benchmark-metrics.mjs').ReplicateDraws} draws
 * @returns {import('./benchmark-metrics.mjs').ReplicateMeasures}
 */
export function pairedReplicate(run, draws) {
  const set = indexed(run);
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
 * The bootstrap samples of every run on the same draws. The runs must hold the same identities,
 * cases (id, identity, source) and customers (id), in the same order.
 * @param {readonly PairedObservations[]} runs
 * @param {{ replicates: number, seed: string, label?: string }} options `label` names the stream
 *   (default `evaluation-6/bootstrap/<seed>`, `bootstrapQuality`'s).
 * @returns {PairedSamples[]}
 */
export function pairedSamples(runs, options) {
  if (!Number.isInteger(options.replicates) || options.replicates < 1) {
    throw new RangeError('at least one replicate');
  }
  const [first] = runs;
  if (first === undefined) {
    throw new RangeError('at least one run');
  }
  if (runs.some((run) => !paired(first, run))) {
    throw new RangeError('the runs are not paired: identities, cases and customers must agree');
  }
  const data = runs.map(indexed);
  const { size, sources } = data[0] ?? indexed(first);
  const customerCount = first.customers.length;
  const random = seededRandom(options.label ?? `evaluation-6/bootstrap/${options.seed}`);
  /** @type {PairedSamples[]} */
  const samples = runs.map(() => ({
    recall: Object.fromEntries(sources.map((source) => [source, /** @type {number[]} */ ([])])),
    overall: [],
    precision: [],
    alertsPerThousand: [],
  }));
  const drawn = new Uint32Array(size);
  const customerDraws = new Uint32Array(customerCount);
  for (let replicate = 0; replicate < options.replicates; replicate += 1) {
    drawn.fill(0);
    for (let left = size; left > 0; left -= 1) {
      const at = random.int(size);
      drawn[at] = (drawn[at] ?? 0) + 1;
    }
    customerDraws.fill(0);
    for (let left = customerCount; left > 0; left -= 1) {
      const at = random.int(customerCount);
      customerDraws[at] = (customerDraws[at] ?? 0) + 1;
    }
    for (const [index, run] of data.entries()) {
      const out = /** @type {PairedSamples} */ (samples[index]);
      const measures = drawnMeasures(run, drawn, customerDraws);
      for (const [position, source] of sources.entries()) {
        out.recall[source]?.push(measures.recall[position] ?? Number.NaN);
      }
      out.overall.push(measures.overall);
      out.precision.push(measures.precision);
      out.alertsPerThousand.push(measures.alertsPerThousand);
    }
  }
  return samples;
}

/**
 * The 95% intervals of samples (nearest rank, non-finite samples left out).
 * @param {PairedSamples} samples
 * @returns {PairedIntervals}
 */
export function intervalsOf(samples) {
  return {
    recall: Object.fromEntries(
      Object.entries(samples.recall).map(([source, values]) => [
        source,
        percentileInterval(values),
      ]),
    ),
    overall: percentileInterval(samples.overall),
    precision: percentileInterval(samples.precision),
    alertsPerThousand: percentileInterval(samples.alertsPerThousand),
  };
}

/**
 * The samples of `head - base`, replicate by replicate.
 * @param {PairedSamples} base
 * @param {PairedSamples} head
 * @returns {PairedSamples}
 */
export function differenceOf(base, head) {
  const minus = (/** @type {number[]} */ left, /** @type {number[] | undefined} */ right) =>
    left.map((value, index) => (right?.[index] ?? Number.NaN) - value);
  return {
    recall: Object.fromEntries(
      Object.entries(base.recall).map(([source, values]) => [
        source,
        minus(values, head.recall[source]),
      ]),
    ),
    overall: minus(base.overall, head.overall),
    precision: minus(base.precision, head.precision),
    alertsPerThousand: minus(base.alertsPerThousand, head.alertsPerThousand),
  };
}
