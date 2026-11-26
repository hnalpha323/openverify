// @ts-check
/**
 * Workflow 6C (evaluation-set-6c): the existing benchmark steps keep their output for a given seed.
 * matcher-6c runs them on its development seed and calibration-6c on the evaluation seed, at
 * Workflow 6C's base and head, so what they generate must not move. Each digest below was taken at
 * the base (`94ab63f9`); a change to any pinned output fails here. These are characterization
 * tests: they pass on the code they pin.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fictionalFamilyName, fictionalGivenName } from '../src/testing/names.js';
import { seededRandom } from '../src/testing/random.js';
import {
  bootstrapQuality,
  performanceSummary,
  percentileInterval,
  qualityPoint,
  wilsonInterval,
} from './benchmark-metrics.mjs';
import {
  TABLE_PROFILES,
  listedQuery,
  namePool,
  syntheticEntries,
  unlistedQueries,
  writeNormalisedImport,
  zipfSampler,
} from './benchmark-tables.mjs';

/** @typedef {import('./benchmark-metrics.mjs').QualityObservations} QualityObservations */
/** @typedef {import('./benchmark-metrics.mjs').TimedScreening} TimedScreening */

/** @param {unknown} value */
const digest = (value) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

/** Fictional groups in the held-out generator's shape: Latin spellings and other-script forms. */
function fictionalGroups() {
  const random = seededRandom('benchmark-golden/groups');
  return Array.from({ length: 400 }, (_, index) => {
    const token = index % 2 === 0 ? fictionalGivenName(random) : fictionalFamilyName(random);
    return {
      id: `Q-golden-${String(index)}`,
      forms: [token.latin, `${token.latin}a`, token.cyrillic, token.arabic],
    };
  });
}

/** The digests at Workflow 6C's base (`94ab63f9`), but for the one owner decision 7 re-pinned. */
const PINNED = {
  tables: {
    pool: 'f9c3b4ec2763c6279d2de6907b21c9e0509cb78ff0232cee29206e05af5fae19',
    draws: 'e813b4a08f3f078cb92f4923b55fb7bcc742a06e8b7b853a7f15e3f7c59fa9c8',
    zipf: 'e5463a749ffe16b47b97e33860f608fb37fb94733c20ee2426d21296cc4f9e79',
    sanctions: '68e61b90c8c801b501a77aaf0d6a7a9840b93f2b2a9eef712f1f0f0e6a0379b1',
    pep: '0a0e15febc15718bb4c82176be8ff0def449185316628a528aaaa261b1178ac8',
    listed: '61ec7372b95d806ca687751f50b6586117a9cca76fb7c073e51f58d7c9978292',
    unlisted: 'e2d4a2c519f6f6f3898f942619317919146ed2e0ccd5b22eefd59acdd5e36fac',
    file: '6bf8f679a437bd2110628bb2add5ab2018960e082ca8b1bc9ceaa4cef3e8c439',
  },
  metrics: {
    point: '1d83c187cdecfeabed2243f409783fdfef49d8ca3b2a16df04a97327d6e2308d',
    // Re-pinned by owner decision 7 after Workflow 6C (the list under test is fixed in every
    // replicate); the base's was ec8e95ff30faa723e69bfdd4863cc96fe000dd0cce447008b8e6f1aa902519d2.
    // `intervals` (Wilson and percentile intervals) does not move.
    bootstrap: '74c127e22aed3d835888934b01143401d7b02039233979b14f8c508a326f41d1',
    summary: '82fe3a4f6132132d6ef2faaa824c071c6e348c3a1491709bec636f3cc3d0bdfb',
    intervals: '814d4d02c8c6b28cd9d0fef2112703e68a622bdeba421b53bb9349df704fda5e',
  },
};

describe('the table generator keeps its output for a given seed', () => {
  it('the pool, its draws, the entries of both profiles and the queries', async () => {
    const pool = namePool({ seed: 'benchmark-golden', groups: fictionalGroups(), fictional: 300 });
    const random = seededRandom('benchmark-golden/draws');
    const draws = Array.from({ length: 200 }, () => [
      pool.given(random).latin[0],
      pool.family(random).latin[0],
    ]);
    const zipf = zipfSampler(500, 1);
    const zipfRandom = seededRandom('benchmark-golden/zipf');
    const sanctions = [
      ...syntheticEntries({
        seed: 'benchmark-golden/s',
        pool,
        names: 3000,
        profile: TABLE_PROFILES.sanctions,
        idPrefix: 'BS-',
      }),
    ];
    const pep = [
      ...syntheticEntries({
        seed: 'benchmark-golden/p',
        pool,
        names: 6000,
        profile: TABLE_PROFILES.pep,
        idPrefix: 'BP-',
      }),
    ];
    const directory = await mkdtemp(join(tmpdir(), 'openverify-benchmark-golden-'));
    try {
      const path = join(directory, 'table.json');
      const written = await writeNormalisedImport(path, {
        source: 'openverify-sandbox',
        publishedAt: '2026-10-01T00:01:00.000Z',
        records: pep,
      });
      const bytes = await readFile(path);
      expect(written.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));

      expect({
        pool: digest(pool.items),
        draws: digest(draws),
        zipf: digest(Array.from({ length: 1000 }, () => zipf(zipfRandom))),
        sanctions: digest(sanctions),
        pep: digest(pep),
        listed: digest([...sanctions, ...pep].map(listedQuery)),
        unlisted: digest(unlistedQueries({ seed: 'benchmark-golden/u', pool, count: 100 })),
        file: written.sha256,
      }).toEqual(PINNED.tables);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** A fixed set of quality observations drawn from a seed (identities, cases and customers). */
function observations() {
  const random = seededRandom('benchmark-golden/observations');
  const identities = Array.from({ length: 60 }, (_, index) => `E${String(index)}`);
  const sources = ['exact', 'typo', 'order_swap', 'initials'];
  /** @type {QualityObservations} */
  const set = {
    identities,
    cases: Array.from({ length: 90 }, (_, index) => {
      const identity = random.pick(identities);
      const matched = [
        ...(random.chance(0.7) ? [identity] : []),
        ...(random.chance(0.2) ? [random.pick(identities)] : []),
      ];
      return { id: `c${String(index)}`, identity, source: random.pick(sources), matched };
    }),
    customers: Array.from({ length: 80 }, (_, index) => ({
      id: `k${String(index)}`,
      matched: random.chance(0.15) ? [random.pick(identities)] : [],
    })),
  };
  return set;
}

describe('the metrics keep their output for given observations and a seed', () => {
  it('the point estimates, the bootstrap, the performance summary and the intervals', () => {
    const set = observations();
    const random = seededRandom('benchmark-golden/timings');
    /** @type {TimedScreening[]} */
    const timings = Array.from({ length: 3 * 40 }, (_, index) => {
      const ms = random.between(5, 400) + random.next();
      return {
        round: 1 + Math.floor(index / 40),
        subject: index % 2 === 0 ? 'listed' : 'unlisted',
        ms,
        phases: { state: ms * 0.05, retrieve: ms * 0.4, load: ms * 0.2 },
        candidates: random.between(0, 2000),
        truncated: random.chance(0.2),
        kept: random.between(0, 3),
        found: index % 2 === 0 ? random.chance(0.9) : null,
      };
    });

    // Calibration-6c follow-up: the summary gained `capReached` and `unreachable` after the pin.
    // The pin keeps every member it held at the base; these timings record neither member.
    const { capReached, unreachable, ...summary } = performanceSummary(timings);
    expect({ capReached, unreachable }).toEqual({ capReached: null, unreachable: null });

    expect({
      point: digest(qualityPoint(set)),
      bootstrap: digest(
        bootstrapQuality(set, { replicates: 300, seed: 'benchmark-golden', keepSamples: true }),
      ),
      summary: digest(summary),
      intervals: digest([
        wilsonInterval(0, 150),
        wilsonInterval(37, 150),
        wilsonInterval(150, 150),
        percentileInterval(timings.map((item) => item.ms)),
      ]),
    }).toEqual(PINNED.metrics);
  });
});
