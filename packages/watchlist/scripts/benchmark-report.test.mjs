// @ts-check
import { describe, expect, it } from 'vitest';
import {
  compactMarkdown,
  compareMarkdown,
  formatPercent,
  formatPercentInterval,
  performanceMarkdown,
  qualityMarkdown,
  scaleMarkdown,
  typoKindsMarkdown,
  unlistedMarkdown,
  variantsMarkdown,
} from './benchmark-report.mjs';

describe('formatPercent and formatPercentInterval', () => {
  it('writes shares as percentages with one decimal, and n/a for none', () => {
    expect(formatPercent(0.935)).toBe('93.5%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(null)).toBe('n/a');
    expect(formatPercentInterval([0.912, 0.954])).toBe('91.2–95.4%');
    expect(formatPercentInterval(null)).toBe('n/a');
  });
});

/** @param {number} hits @param {number} cases */
const point = (hits, cases) => ({ hits, cases, value: cases === 0 ? null : hits / cases });

const preset = () => ({
  point: {
    recall: { exact: point(2, 2), typo: point(1, 2), own_transliteration: point(1, 2) },
    overall: point(4, 6),
    precision: { expected: 4, other: 1, value: 0.8 },
    alerts: { customers: 4, alerted: 2, matches: 3, perThousand: 500 },
  },
  intervals: {
    replicates: 100,
    recall: { exact: [1, 1], typo: [0, 1], own_transliteration: [0, 1] },
    overall: [0.5, 0.8333],
    precision: [0.6, 1],
    alertsPerThousand: [0, 1000],
  },
  refined: {
    point: {
      exact: point(2, 2),
      typo: point(1, 2),
      'own_transliteration/latin_listed': point(1, 1),
      'own_transliteration/cyrillic_listed': point(0, 1),
    },
    intervals: {
      exact: [1, 1],
      typo: [0, 1],
      'own_transliteration/latin_listed': [1, 1],
      'own_transliteration/cyrillic_listed': [0, 0],
    },
  },
  diagnostics: { misses: 2, missesFlagged: 1, truncated: 0, errored: 0 },
  customerDiagnostics: { misses: 0, missesFlagged: 0, truncated: 1, errored: 0 },
});

const RESULTS = {
  seed: 'x',
  replicates: 100,
  sets: { 'persons/names': { exact: preset(), strict: preset(), tolerant: preset() } },
  bridged: { held_out_group_cross_script: { cases: 10, oneToken: 3, bothTokens: 1 } },
};

describe('qualityMarkdown', () => {
  const lines = () => qualityMarkdown(RESULTS).split('\n');

  it('renders recall per variant source, the own transliterations apart, at each preset', () => {
    expect(lines()).toContain('#### Persons, names only');
    expect(lines()).toContain('| Variant source | n | `exact` | `strict` | `tolerant` |');
    expect(lines()).toContain(
      '| `typo` | 2 | 1/2 · 50.0% (0.0–100.0%) | 1/2 · 50.0% (0.0–100.0%) | 1/2 · 50.0% (0.0–100.0%) |',
    );
    expect(lines()).toContain(
      '| `own_transliteration`, Cyrillic-listed | 1 | 0/1 · 0.0% (0.0–0.0%) | 0/1 · 0.0% (0.0–0.0%) | 0/1 · 0.0% (0.0–0.0%) |',
    );
    expect(lines()).toContain(
      '| All cases (this set’s mix) | 6 | 4/6 · 66.7% (50.0–83.3%) | 4/6 · 66.7% (50.0–83.3%) | 4/6 · 66.7% (50.0–83.3%) |',
    );
  });

  it('renders precision, alerts per 1,000 customers and the diagnostics with their counts', () => {
    expect(lines()).toContain(
      '| Precision (matches to the expected entry) | — | 4/5 · 80.0% (60.0–100.0%) | 4/5 · 80.0% (60.0–100.0%) | 4/5 · 80.0% (60.0–100.0%) |',
    );
    expect(lines()).toContain(
      '| Alerts per 1,000 customers | 4 | 500.0 (0.0–1,000.0) · 2 alerted | 500.0 (0.0–1,000.0) · 2 alerted | 500.0 (0.0–1,000.0) · 2 alerted |',
    );
    expect(lines()).toContain('| Misses with an incomplete coverage | 1 of 2 | 1 of 2 | 1 of 2 |');
    expect(lines()).toContain(
      '| Searches cut at the cap (cases, customers) | 0, 1 | 0, 1 | 0, 1 |',
    );
    expect(lines()).toContain('| Errored runs (cases, customers) | 0, 0 | 0, 0 | 0, 0 |');
  });

  it('renders the group cases a surviving group links', () => {
    expect(lines()).toContain('| `held_out_group_cross_script` | 10 | 3 | 1 |');
  });
});

describe('performanceMarkdown', () => {
  const measure = (/** @type {number} */ p95, /** @type {number} */ budgetMs) => ({
    budgetMs,
    screenings: 900,
    ms: { p50: 20.04, p95, p99: p95 * 2, max: p95 * 3 },
    roundP95: [p95 - 1, p95, p95 + 1],
    leastDisturbedRoundP95: p95 - 1,
    phaseP95: { state: 1.04, retrieve: 30.26, load: 9.5, rest: 40 },
    candidates: { p50: 120, p95: 1900, max: 2000 },
    capBinds: { count: 3, of: 300, share: 0.01, interval: [0.0034, 0.029] },
    wouldError: { count: 0, of: 300, share: 0, interval: [0, 0.0126] },
    listedFound: { found: 150, of: 150 },
    erroredRuns: 0,
    rounds: [
      { round: 1, before: [1.5, 1, 1], after: [2, 1, 1], seconds: 10 },
      { round: 2, before: [2, 1, 1], after: [2.5, 1, 1], seconds: 10 },
      { round: 3, before: [2.5, 1, 1], after: [3, 1, 1], seconds: 10 },
    ],
  });
  const text = () =>
    performanceMarkdown({
      machine: {
        cpu: 'Example CPU @ 3.50GHz',
        coresPerSocket: '6',
        sockets: '1',
        logicalCpus: 12,
        memoryGiB: 31.3,
        kernel: '6.18.40.1-microsoft-standard-WSL2',
        node: 'v22.22.1',
        docker: '29.7.2',
        postgresImage: 'pgvector/pgvector:pg17',
      },
      postgres: 'PostgreSQL 17.11',
      scales: {
        '100k': {
          imports: [
            {
              part: 1,
              file: { entries: 60549, names: 100000, bytes: 36080086 },
              syncSeconds: 52.8,
              vacuumSeconds: 1.8,
            },
          ],
          measure: measure(85.7, 100),
        },
        '2m': {
          imports: [
            {
              part: 1,
              file: { entries: 51512, names: 250000, bytes: 56287683 },
              syncSeconds: 92.4,
              vacuumSeconds: null,
            },
            {
              part: 2,
              file: { entries: 103142, names: 500000, bytes: 112605195 },
              syncSeconds: 123.7,
              vacuumSeconds: 9.5,
            },
          ],
          measure: measure(312.25, 250),
        },
      },
      rescreen: {
        seed: { reports: 200000, seconds: 269.4 },
        runs: [
          {
            added: 100,
            syncSeconds: 23.9,
            rescreenMs: 29226,
            budgetMs: 60000,
            result: { environments: 1, subjects: 200000, runsInserted: 3654 },
          },
        ],
      },
    });
  const lines = () => text().split('\n');

  it('states the machine', () => {
    expect(text()).toContain(
      'Example CPU @ 3.50GHz, 6 cores and 12 logical CPUs (1 socket), 31.3 GiB, Linux 6.18.40.1-microsoft-standard-WSL2, Docker 29.7.2, `pgvector/pgvector:pg17` (PostgreSQL 17.11), Node v22.22.1.',
    );
  });

  it('renders the imports, and the screening at each scale against its budget', () => {
    expect(lines()).toContain('| 100,000 | 1 | 60,549 | 100,000 | 36.1 MB | 52.8 | 1.8 |');
    expect(lines()).toContain('| 2,000,000 | 2 | 103,142 | 500,000 | 112.6 MB | 216.1 | 9.5 |');
    expect(lines()).toContain(
      '| 100,000 | 100 ms | 20.0 | **85.7** | 171.4 | 84.7 / 85.7 / 86.7 | yes | 1.0 / 30.3 / 9.5 / 40.0 | 120 / 1,900 | 3 of 300 · 1.0% (0.3–2.9%) | not recorded | not recorded | 0 of 300 · 0.0% (0.0–1.3%) | 150 of 150 |',
    );
    expect(lines()).toContain(
      '| 2,000,000 | 250 ms | 20.0 | **312.3** | 624.5 | 311.3 / 312.3 / 313.3 | **no** | 1.0 / 30.3 / 9.5 / 40.0 | 120 / 1,900 | 3 of 300 · 1.0% (0.3–2.9%) | not recorded | not recorded | 0 of 300 · 0.0% (0.0–1.3%) | 150 of 150 |',
    );
  });

  it('renders each re-screen against the 60 s budget', () => {
    expect(lines()).toContain('| 100 | 23.9 | 29.2 | yes | 3,654 | 200,000 |');
  });

  it('renders the searches cut at the cap apart from those out of reach (calibration-6c follow-up)', () => {
    const rendered = performanceMarkdown({
      machine: {},
      postgres: 'PostgreSQL 17',
      scales: {
        '2m': {
          imports: [],
          measure: {
            ...measure(399.4, 250),
            capBinds: { count: 15, of: 300, share: 0.05, interval: [0.031, 0.081] },
            capReached: { count: 6, of: 300, share: 0.02, interval: [0.009, 0.043] },
            unreachable: { count: 9, of: 300, share: 0.03, interval: [0.016, 0.056] },
          },
        },
      },
    }).split('\n');

    expect(rendered).toContainEqual(
      expect.stringContaining(
        '| Candidates p50 / p95 | Truncated (first round) | Cut at the cap | Out of reach | Would end `result_truncated` |',
      ),
    );
    expect(rendered).toContainEqual(
      expect.stringContaining(
        '| 120 / 1,900 | 15 of 300 · 5.0% (3.1–8.1%) | 6 of 300 · 2.0% (0.9–4.3%) | 9 of 300 · 3.0% (1.6–5.6%) | 0 of 300 · 0.0% (0.0–1.3%) |',
      ),
    );
  });
});

describe('the renderer when a value is missing', () => {
  it('writes n/a for a company set without customers, a missing interval and a missing vacuum', () => {
    const company = preset();
    const presets = {
      exact: {
        ...company,
        point: {
          ...company.point,
          alerts: { customers: 0, alerted: 0, matches: 0, perThousand: null },
        },
        customerDiagnostics: null,
      },
    };
    const text = qualityMarkdown({
      sets: { companies: { exact: presets.exact, strict: presets.exact, tolerant: presets.exact } },
    });

    expect(text).toContain('#### Companies');
    expect(text).not.toContain('Alerts per 1,000 customers');
    expect(text).toContain(
      '| Searches cut at the cap (cases, customers) | 0, n/a | 0, n/a | 0, n/a |',
    );
    expect(text).not.toContain('Held-out group cases');
    expect(qualityMarkdown({ sets: {} })).toBe('');
  });

  it('writes several sockets, an over-budget re-screen and a scale without results', () => {
    const text = performanceMarkdown({
      machine: {
        cpu: 'Example CPU',
        coresPerSocket: '4',
        sockets: '2',
        logicalCpus: 16,
        memoryGiB: 64,
        kernel: '6.1',
        node: 'v22',
        docker: '29',
        postgresImage: 'pgvector/pgvector:pg17',
      },
      postgres: 'PostgreSQL 17',
      scales: {
        '100k': {
          imports: [
            {
              part: 1,
              file: { entries: 10, names: 20, bytes: 1000 },
              syncSeconds: 1,
              vacuumSeconds: null,
            },
          ],
        },
      },
      rescreen: {
        runs: [
          {
            added: 1000,
            syncSeconds: 26.5,
            rescreenMs: 129701,
            budgetMs: 60000,
            result: { environments: 1, subjects: 200000, runsInserted: 12763 },
          },
        ],
      },
    });

    expect(text).toContain('(2 sockets), 64.0 GiB');
    expect(text).toContain('| 100,000 | 1 | 10 | 20 | 0.0 MB | 1.0 | n/a |');
    expect(text).not.toContain('| 2,000,000 |');
    expect(text).toContain('| 1,000 | 26.5 | 129.7 | **no** | 12,763 | 200,000 |');
  });
});

/** @param {number} count @param {number} of @param {[number, number] | null} wilson */
const share = (count, of, wilson) => ({ count, of, share: of === 0 ? null : count / of, wilson });

describe('scaleMarkdown (the held-out population in each table)', () => {
  /** @param {number} alerted */
  const result = (alerted) => ({
    point: {
      recall: {
        exact: { hits: 10, cases: 10, value: 1, wilson: [0.7225, 1] },
        typo: { hits: 3, cases: 10, value: 0.3, wilson: [0.1078, 0.6032] },
      },
      overall: { hits: 13, cases: 20, value: 0.65, wilson: [0.4329, 0.8188] },
      precision: { expected: 13, other: 0, value: 1, wilson: [0.7719, 1] },
      alerts: {
        customers: 40,
        alerted,
        matches: alerted * 2,
        perThousand: (1000 * alerted) / 40,
        wilson: alerted === 0 ? [0, 87.6] : [70, 260],
      },
    },
    intervals: {
      recall: { exact: [1, 1], typo: [0.1, 0.6] },
      overall: [0.45, 0.85],
      precision: [1, 1],
      alertsPerThousand: alerted === 0 ? [0, 0] : [50, 250],
    },
    diagnostics: {
      misses: 7,
      missesFlagged: 2,
      truncated: { cases: 1, customers: 3 },
      errored: { cases: 0, customers: 2 },
    },
    indistinguishable: { customers: 2, alerted: 1 },
  });
  const text = () =>
    scaleMarkdown({
      '100k': {
        sets: {
          persons: { exact: result(0), strict: result(4), tolerant: result(6) },
        },
      },
    });
  const lines = () => text().split('\n');

  it('renders recall per source, with the Wilson interval beside a count of zero or of all', () => {
    expect(lines()).toContain('#### Held-out population in the 100,000-name table: persons');
    expect(lines()).toContain(
      '| `exact` | 10 | 10/10 · 100.0% (100.0–100.0%; Wilson 72.3–100.0%) | 10/10 · 100.0% (100.0–100.0%; Wilson 72.3–100.0%) | 10/10 · 100.0% (100.0–100.0%; Wilson 72.3–100.0%) |',
    );
    expect(lines()).toContain(
      '| `typo` | 10 | 3/10 · 30.0% (10.0–60.0%) | 3/10 · 30.0% (10.0–60.0%) | 3/10 · 30.0% (10.0–60.0%) |',
    );
    expect(lines()).toContain(
      '| All cases | 20 | 13/20 · 65.0% (45.0–85.0%) | 13/20 · 65.0% (45.0–85.0%) | 13/20 · 65.0% (45.0–85.0%) |',
    );
  });

  it('renders precision, false alerts per 1,000 and the indistinguishable customers apart', () => {
    expect(lines()).toContain(
      '| Precision (matches to the expected entry) | — | 13/13 · 100.0% (100.0–100.0%; Wilson 77.2–100.0%) | 13/13 · 100.0% (100.0–100.0%; Wilson 77.2–100.0%) | 13/13 · 100.0% (100.0–100.0%; Wilson 77.2–100.0%) |',
    );
    expect(lines()).toContain(
      '| False alerts per 1,000 customers | 40 | 0.0 (0.0–0.0; Wilson 0.0–87.6) · 0 alerted | 100.0 (50.0–250.0) · 4 alerted | 150.0 (50.0–250.0) · 6 alerted |',
    );
    expect(lines()).toContain(
      '| Customers equal to a listed entry in name and birth date (left out of the rate) | 2 | 1 alerted | 1 alerted | 1 alerted |',
    );
    expect(lines()).toContain('| Misses with an incomplete coverage | 2 of 7 | 2 of 7 | 2 of 7 |');
    expect(lines()).toContain(
      '| Searches cut at the cap (cases, customers) | 1, 3 | 1, 3 | 1, 3 |',
    );
    expect(lines()).toContain('| Errored runs (cases, customers) | 0, 2 | 0, 2 | 0, 2 |');
    expect(scaleMarkdown({})).toBe('');
  });

  it('marks a bootstrap interval that excludes its own point, with the Wilson interval beside it, as a flag (review C002, owner decision 7 after 6C)', () => {
    const company = result(120);
    const biased = {
      ...company,
      point: {
        ...company.point,
        precision: { expected: 200, other: 336, value: 200 / 536, wilson: [0.3333, 0.4152] },
        alerts: {
          customers: 484,
          alerted: 120,
          matches: 336,
          perThousand: (1000 * 120) / 484,
          wilson: [210.8, 288.5],
        },
      },
      intervals: {
        ...company.intervals,
        precision: [0.394, 0.607],
        alertsPerThousand: [148.8, 235.5],
      },
    };

    const rendered = scaleMarkdown({
      '100k': { sets: { companies: { exact: result(4), strict: biased, tolerant: result(6) } } },
    }).split('\n');

    expect(rendered).toContainEqual(
      expect.stringContaining(
        '| 200/536 · 37.3% (39.4–60.7%, which excludes the point; Wilson 33.3–41.5%) |',
      ),
    );
    expect(rendered).toContainEqual(
      expect.stringContaining(
        '| 247.9 (148.8–235.5, which excludes the point; Wilson 210.8–288.5) · 120 alerted |',
      ),
    );
    expect(rendered).toContain(
      'An interval marked “which excludes the point” does not contain its own point estimate. The list under test is fixed in every replicate (owner decision 7 after Workflow 6C), and a percentile interval of a ratio still need not contain its point; the mark is a flag. Read the Wilson interval beside it.',
    );
    // The persons' table above has no such interval, and no such line.
    expect(lines().join('\n')).not.toContain('excludes the point');
  });
});

describe('compareMarkdown (base and head on one seed)', () => {
  const point = (/** @type {number} */ overall, /** @type {number} */ alerts) => ({
    recall: { typo: { hits: 1, cases: 2, value: overall, wilson: null } },
    overall: { hits: 1, cases: 2, value: overall, wilson: null },
    precision: { expected: 1, other: 0, value: 1, wilson: null },
    alerts: { customers: 10, alerted: 1, matches: 1, perThousand: alerts, wilson: null },
  });
  const text = () =>
    compareMarkdown({
      sets: [
        {
          key: 'scale-100k/persons',
          title: 'held-out population, 100,000 names, persons',
          presets: {
            tolerant: {
              base: point(0.5, 200),
              head: point(0.55, 230),
              difference: {
                recall: { typo: 0.05 },
                overall: 0.05,
                precision: 0,
                alertsPerThousand: 30,
              },
              differenceIntervals: {
                recall: { typo: [-0.01, 0.1] },
                overall: [-0.012, 0.1],
                precision: [0, 0],
                alertsPerThousand: [10, 50],
              },
            },
          },
        },
      ],
    });

  it('renders each measure of each preset: base, head and head minus base with its interval', () => {
    expect(text()).toContain('#### Base and head: held-out population, 100,000 names, persons');
    expect(text()).toContain(
      '| `tolerant` | Recall, all cases | 50.0% | 55.0% | +5.0 pp (-1.2 to +10.0) |',
    );
    expect(text()).toContain(
      '| `tolerant` | Recall, `typo` | 50.0% | 55.0% | +5.0 pp (-1.0 to +10.0) |',
    );
    expect(text()).toContain(
      '| `tolerant` | Precision | 100.0% | 100.0% | +0.0 pp (+0.0 to +0.0) |',
    );
    expect(text()).toContain(
      '| `tolerant` | False alerts per 1,000 customers | 200.0 | 230.0 | +30.0 (+10.0 to +50.0); +15.0% of the base rate |',
    );
    expect(compareMarkdown({ sets: [] })).toBe('');
  });
});

describe('the post-hoc tables (owner decision 7)', () => {
  it('renders the typo kinds by set, kind and token length', () => {
    const text = typoKindsMarkdown({
      presets: ['exact', 'strict', 'tolerant'],
      rows: [
        {
          subject: 'persons/names',
          kind: 'transpose',
          length: 'long',
          presets: {
            exact: { found: 0, of: 55, share: 0, wilson: [0, 0.0653] },
            strict: { found: 0, of: 55, share: 0, wilson: [0, 0.0653] },
            tolerant: { found: 0, of: 55, share: 0, wilson: [0, 0.0653] },
          },
        },
      ],
    });

    expect(text).toContain('| Set | Kind | Token length | n | `exact` | `strict` | `tolerant` |');
    expect(text).toContain(
      '| persons/names | transpose | 5 or more | 55 | 0/55 · 0.0% (Wilson 0.0–6.5%) | 0/55 · 0.0% (Wilson 0.0–6.5%) | 0/55 · 0.0% (Wilson 0.0–6.5%) |',
    );
  });

  it('renders the unlisted alerts and the compacted round per scale', () => {
    expect(
      unlistedMarkdown({
        '100k': {
          round: 1,
          alerted: 37,
          of: 150,
          share: 37 / 150,
          interval: [0.185, 0.321],
          matches: 120,
        },
      }),
    ).toContain('| 100,000 | 37 of 150 · 24.7% (Wilson 18.5–32.1%) | 120 |');
    const compact = compactMarkdown({
      '2m': {
        vacuumSeconds: 87.54,
        before: { tables: { watchlist_entries: 3e9, watchlist_names: 1e8 } },
        after: { tables: { watchlist_entries: 6e8, watchlist_names: 8e7 } },
        summary: {
          ms: { p50: 542.04, p95: 1444.04, p99: 2000, max: 3000 },
          phaseP95: { state: 3, retrieve: 808.04, load: 90, rest: 400 },
          capBinds: { count: 143, of: 300, share: 143 / 300, interval: [0.421, 0.533] },
        },
        loadAverage: { before: [2.06, 1, 1], after: [2.31, 1, 1] },
      },
    });
    expect(compact).toContain(
      '| 2,000,000 | 3,100.0 MB → 680.0 MB | 87.5 | 542.0 | 1,444.0 | 808.0 | 143 of 300 · 47.7% (42.1–53.3%) | not recorded | not recorded | 2.1, 2.3 |',
    );
    expect(unlistedMarkdown({})).toBe('');
    expect(compactMarkdown({})).toBe('');
  });

  it('renders the development variants per scale', () => {
    const preset = {
      recall: { exact: share(43, 43, [0.918, 1]) },
      overall: share(43, 43, [0.918, 1]),
      precision: { expected: 43, other: 7, value: 0.86 },
      unlisted: { ...share(12, 150, [0.046, 0.135]), matches: 30 },
      truncated: { cases: 0, unlisted: 1 },
      errored: 0,
    };
    const text = variantsMarkdown({
      '2m': { summary: { exact: preset, strict: preset, tolerant: preset } },
    });

    expect(text).toContain('#### Development variants in the 2,000,000-name table');
    expect(text).toContain(
      '| `exact` | 43 | 43/43 · 100.0% (Wilson 91.8–100.0%) | 43/43 · 100.0% (Wilson 91.8–100.0%) | 43/43 · 100.0% (Wilson 91.8–100.0%) |',
    );
    expect(text).toContain('| Precision | — | 43/50 · 86.0% | 43/50 · 86.0% | 43/50 · 86.0% |');
    expect(text).toContain(
      '| Unlisted subjects with a kept match | 150 | 12 of 150 · 8.0% (Wilson 4.6–13.5%) | 12 of 150 · 8.0% (Wilson 4.6–13.5%) | 12 of 150 · 8.0% (Wilson 4.6–13.5%) |',
    );
    expect(text).toContain('| Searches cut at the cap (cases, unlisted) | 0, 1 | 0, 1 | 0, 1 |');
    expect(variantsMarkdown({})).toBe('');
  });
});
