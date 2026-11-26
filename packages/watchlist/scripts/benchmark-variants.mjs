// @ts-check
/**
 * Workflow 6C (owner decisions 1 and 5): variant cases of the performance benchmark's development
 * tables, so the matcher's owner sees recall at scale without held-out data. Each case varies one
 * listed entry of the table (generated from the development seed) by one source, in turn: the
 * exact name, an order swap, a dropped or an added middle name, the given name as an initial, one
 * letter substituted, inserted or deleted in the family name, or two adjacent letters of it
 * transposed. These rules are written here, apart from the held-out generator
 * (`src/testing/held-out/`), which the matcher's owner never reads.
 */

import { seededRandom } from '../src/testing/random.js';
import { wilsonInterval } from './benchmark-metrics.mjs';

/** @typedef {import('../src/record/index.js').WatchlistRecord} WatchlistRecord */
/** @typedef {import('./benchmark-metrics.mjs').Interval} Interval */

/** The development variant sources, taken in turn. */
export const DEVELOPMENT_SOURCES = Object.freeze(
  /** @type {const} */ ([
    'exact',
    'order_swap',
    'dropped_middle',
    'added_middle',
    'initials',
    'typo',
    'transposition',
  ]),
);

/**
 * @typedef {object} DevelopmentCase
 * @property {string} id
 * @property {(typeof DEVELOPMENT_SOURCES)[number]} source
 * @property {string} entryId The listed entry the case varies.
 * @property {Record<string, string>} query The `watchlist` query, with the entry's birth date.
 */

/**
 * @typedef {object} VariantObservation One screening of the variants step.
 * @property {string} id
 * @property {string | null} source The variant source, `null` for an unlisted subject.
 * @property {string | null} entryId
 * @property {Record<string, { matched: string[], truncated: boolean, errors: string[] }>} presets
 */

/**
 * @typedef {object} Count
 * @property {number} count
 * @property {number} of
 * @property {number | null} share
 * @property {Interval | null} wilson
 */

/**
 * @typedef {object} VariantPresetSummary
 * @property {Record<string, Count>} recall Per source.
 * @property {Count} overall
 * @property {{ expected: number, other: number, value: number | null }} precision
 * @property {Count & { matches: number }} unlisted Unlisted subjects with a kept match.
 * @property {{ cases: number, unlisted: number }} truncated Searches cut at the cap.
 * @property {number} errored Runs that ended with an error.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** @param {number} value @param {number} width */
const pad = (value, width) => String(value).padStart(width, '0');

/**
 * The parts of a record's primary name.
 * @param {WatchlistRecord} record
 */
function partsOf(record) {
  const primary = record.names.find((name) => name.primary) ?? record.names[0];
  const part = (/** @type {string} */ role) =>
    primary?.parts.find((item) => item.role === role)?.value;
  return { given: part('given'), middle: part('middle'), family: part('family') };
}

/**
 * The positions after the first where two adjacent letters differ (a transposition there changes
 * the token and keeps its first letter).
 * @param {string} token
 */
function swappable(token) {
  /** @type {number[]} */
  const positions = [];
  for (let at = 1; at + 1 < token.length; at += 1) {
    if (token.charAt(at) !== token.charAt(at + 1)) {
      positions.push(at);
    }
  }
  return positions;
}

/**
 * Whether a source can vary this record.
 * @param {(typeof DEVELOPMENT_SOURCES)[number]} source
 * @param {WatchlistRecord} record
 */
function fits(source, record) {
  const { given, middle, family } = partsOf(record);
  if (record.kind !== 'individual' || !given || !family) {
    return false;
  }
  switch (source) {
    case 'dropped_middle':
      return middle !== undefined;
    case 'added_middle':
      return middle === undefined;
    case 'typo':
      return family.length >= 3;
    case 'transposition':
      return swappable(family).length > 0;
    default:
      return true;
  }
}

/**
 * One letter substituted, inserted or deleted after the first.
 * @param {import('../src/testing/random.js').SeededRandom} random
 * @param {string} token
 */
function typo(random, token) {
  const kind = random.pick(/** @type {const} */ (['substitute', 'insert', 'delete']));
  if (kind === 'insert') {
    const at = random.between(1, token.length);
    return `${token.slice(0, at)}${random.pick([...LETTERS])}${token.slice(at)}`;
  }
  const at = random.between(1, token.length - 1);
  if (kind === 'delete') {
    return `${token.slice(0, at)}${token.slice(at + 1)}`;
  }
  const letters = [...LETTERS].filter((letter) => letter !== token.charAt(at).toLowerCase());
  return `${token.slice(0, at)}${random.pick(letters)}${token.slice(at + 1)}`;
}

/**
 * Two adjacent letters after the first, transposed.
 * @param {import('../src/testing/random.js').SeededRandom} random
 * @param {string} token
 */
function transposition(random, token) {
  const at = random.pick(swappable(token));
  return `${token.slice(0, at)}${token.charAt(at + 1)}${token.charAt(at)}${token.slice(at + 2)}`;
}

/**
 * @param {string} first
 * @param {string | null | undefined} middle
 * @param {string} last
 * @returns {Record<string, string>}
 */
const nameQuery = (first, middle, last) => ({
  'name-first': first,
  ...(middle === null || middle === undefined ? {} : { 'name-middle': middle }),
  'name-last': last,
});

/**
 * One variant case for each of `count` listed entries spread over the table, sources in turn.
 * @param {readonly WatchlistRecord[]} records The development table.
 * @param {{ seed: string, count: number }} options
 * @returns {DevelopmentCase[]}
 */
export function developmentVariants(records, options) {
  const total = records.length;
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > total) {
    throw new RangeError('the table cannot give that many cases');
  }
  const random = seededRandom(`evaluation-6c/development-variants/${options.seed}`);
  const stride = Math.floor(total / options.count);
  /** @type {Set<string>} */
  const used = new Set();
  /** @param {number} start @param {(record: WatchlistRecord) => boolean} accept */
  const scan = (start, accept) => {
    for (let offset = 0; offset < total; offset += 1) {
      const record = /** @type {WatchlistRecord} */ (records[(start + offset) % total]);
      if (accept(record)) {
        return record;
      }
    }
    return undefined;
  };
  return Array.from({ length: options.count }, (_, index) => {
    const source = /** @type {(typeof DEVELOPMENT_SOURCES)[number]} */ (
      DEVELOPMENT_SOURCES[index % DEVELOPMENT_SOURCES.length]
    );
    const start = index * stride;
    const record = scan(start, (item) => !used.has(item.entry_id) && fits(source, item));
    if (record === undefined) {
      throw new RangeError(`the table has no entry left for ${source}`);
    }
    used.add(record.entry_id);
    const stream = random.fork(`case-${String(index)}`);
    const { given = '', middle, family = '' } = partsOf(record);
    /** @type {Record<string, string>} */
    let query;
    switch (source) {
      case 'order_swap':
        query = nameQuery(family, middle, given);
        break;
      case 'dropped_middle':
        query = nameQuery(given, null, family);
        break;
      case 'added_middle': {
        const other = scan(
          start + Math.max(1, Math.floor(stride / 2)),
          (item) => item !== record && fits('exact', item),
        );
        query = nameQuery(given, partsOf(other ?? record).given ?? given, family);
        break;
      }
      case 'initials':
        query = nameQuery(`${given.charAt(0)}.`, middle, family);
        break;
      case 'typo':
        query = nameQuery(given, middle, typo(stream, family));
        break;
      case 'transposition':
        query = nameQuery(given, middle, transposition(stream, family));
        break;
      default:
        query = nameQuery(given, middle, family);
    }
    const date = record.birth_dates[0]?.value;
    return {
      id: `DV-${pad(index + 1, 5)}`,
      source,
      entryId: record.entry_id,
      query: date === undefined ? query : { ...query, birthdate: date },
    };
  });
}

/**
 * @param {number} count
 * @param {number} of
 * @returns {Count}
 */
const countOf = (count, of) => ({
  count,
  of,
  share: of === 0 ? null : count / of,
  wilson: wilsonInterval(count, of),
});

/**
 * Recall per source, precision and the unlisted subjects' alerts, per preset, with Wilson intervals.
 * @param {readonly VariantObservation[]} observations
 * @param {readonly string[]} presets
 * @returns {Record<string, VariantPresetSummary>}
 */
export function variantSummary(observations, presets) {
  const cases = observations.filter((item) => item.source !== null);
  const unlisted = observations.filter((item) => item.source === null);
  const sources = [...new Set(cases.map((item) => /** @type {string} */ (item.source)))];
  return Object.fromEntries(
    presets.map((preset) => {
      const run = (/** @type {VariantObservation} */ item) =>
        item.presets[preset] ?? { matched: [], truncated: false, errors: [] };
      const hit = (/** @type {VariantObservation} */ item) =>
        item.entryId !== null && run(item).matched.includes(item.entryId);
      const hits = cases.filter(hit).length;
      const other = cases.reduce(
        (sum, item) => sum + run(item).matched.filter((id) => id !== item.entryId).length,
        0,
      );
      const alerted = unlisted.filter((item) => run(item).matched.length > 0).length;
      /** @type {VariantPresetSummary} */
      const summary = {
        recall: Object.fromEntries(
          sources.map((source) => {
            const own = cases.filter((item) => item.source === source);
            return [source, countOf(own.filter(hit).length, own.length)];
          }),
        ),
        overall: countOf(hits, cases.length),
        precision: {
          expected: hits,
          other,
          value: hits + other === 0 ? null : hits / (hits + other),
        },
        unlisted: {
          ...countOf(alerted, unlisted.length),
          matches: unlisted.reduce((sum, item) => sum + run(item).matched.length, 0),
        },
        truncated: {
          cases: cases.filter((item) => run(item).truncated).length,
          unlisted: unlisted.filter((item) => run(item).truncated).length,
        },
        errored: observations.filter((item) => run(item).errors.length > 0).length,
      };
      return [preset, summary];
    }),
  );
}
