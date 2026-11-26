// @ts-check
/**
 * The tables of `docs/calibration/watchlist-phase6.md` (evaluation-6, plan C78.7 and C78.8),
 * rendered as Markdown from the benchmarks' result files, so no number is copied by hand
 * (`benchmark-render.mjs` reads the files and prints these).
 */

/** @typedef {import('./benchmark-metrics.mjs').Interval} Interval */

const COUNT = new Intl.NumberFormat('en-US');
const ONE_DECIMAL = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** @type {readonly ('exact' | 'strict' | 'tolerant')[]} */
const PRESETS = ['exact', 'strict', 'tolerant'];

/** The sets of the quality results, in the report's order, with their titles. */
/** @type {readonly (readonly [string, string])[]} */
const SETS = Object.freeze([
  ['persons/names', 'Persons, names only'],
  ['persons/birthdates', 'Persons, with the listed birth date'],
  ['companies', 'Companies'],
]);

/** The own-transliteration rows by the script the entry is listed in. */
/** @type {readonly (readonly [string, string])[]} */
const REFINED = Object.freeze([
  ['own_transliteration/latin_listed', '`own_transliteration`, Latin-listed'],
  ['own_transliteration/cyrillic_listed', '`own_transliteration`, Cyrillic-listed'],
]);

/** The scales of the performance results, with the names they hold. */
/** @type {readonly (readonly [string, string])[]} */
const SCALES = Object.freeze([
  ['100k', '100,000'],
  ['2m', '2,000,000'],
]);

/** @param {number} value */
const count = (value) => COUNT.format(value);
/** @param {number} value */
const decimal = (value) => ONE_DECIMAL.format(value);

/** @param {readonly string[]} cells */
const row = (cells) => `| ${cells.join(' | ')} |`;

/** @param {readonly string[]} cells */
const table = (cells) => [row(cells), row(cells.map(() => '---'))];

/**
 * A share as a percentage with one decimal (`93.5%`), or `n/a`.
 * @param {number | null | undefined} value
 * @returns {string}
 */
export function formatPercent(value) {
  return value === null || value === undefined ? 'n/a' : `${decimal(value * 100)}%`;
}

/**
 * A share's interval as percentages (`91.2–95.4%`), or `n/a`.
 * @param {Interval | null | undefined} interval
 * @returns {string}
 */
export function formatPercentInterval(interval) {
  return interval === null || interval === undefined
    ? 'n/a'
    : `${decimal(interval[0] * 100)}–${decimal(interval[1] * 100)}%`;
}

/**
 * `hits/cases · share (interval)`.
 * @param {{ hits: number, cases: number, value: number | null } | undefined} point
 * @param {Interval | null | undefined} interval
 */
function shareCell(point, interval) {
  if (point === undefined) {
    return 'n/a';
  }
  return `${count(point.hits)}/${count(point.cases)} · ${formatPercent(point.value)} (${formatPercentInterval(interval)})`;
}

/**
 * The quality tables: recall per variant source, precision, alerts per 1,000 customers and the
 * diagnostics, per set, at each preset.
 * @param {any} results The quality benchmark's `results.json`.
 * @returns {string}
 */
export function qualityMarkdown(results) {
  /** @type {string[]} */
  const lines = [];
  for (const [name, title] of SETS) {
    const presets = results.sets?.[name];
    if (presets === undefined) {
      continue;
    }
    const first = presets[PRESETS[0] ?? 'exact'];
    lines.push(
      `#### ${title}`,
      '',
      ...table(['Variant source', 'n', ...PRESETS.map((p) => `\`${p}\``)]),
    );
    for (const [source, recall] of Object.entries(first.point.recall)) {
      const cases = /** @type {{ cases: number }} */ (recall).cases;
      lines.push(
        row([
          `\`${source}\``,
          count(cases),
          ...PRESETS.map((preset) =>
            shareCell(
              presets[preset].point.recall[source],
              presets[preset].intervals.recall[source],
            ),
          ),
        ]),
      );
      if (source === 'own_transliteration') {
        for (const [refined, label] of REFINED) {
          const refinedCases = first.refined?.point?.[refined]?.cases;
          if (refinedCases !== undefined) {
            lines.push(
              row([
                label,
                count(refinedCases),
                ...PRESETS.map((preset) =>
                  shareCell(
                    presets[preset].refined.point[refined],
                    presets[preset].refined.intervals[refined],
                  ),
                ),
              ]),
            );
          }
        }
      }
    }
    lines.push(
      row([
        'All cases (this set’s mix)',
        count(first.point.overall.cases),
        ...PRESETS.map((preset) =>
          shareCell(presets[preset].point.overall, presets[preset].intervals.overall),
        ),
      ]),
      row([
        'Precision (matches to the expected entry)',
        '—',
        ...PRESETS.map((preset) => {
          const { expected, other, value } = presets[preset].point.precision;
          return shareCell(
            { hits: expected, cases: expected + other, value },
            presets[preset].intervals.precision,
          );
        }),
      ]),
    );
    if (first.point.alerts.customers > 0) {
      lines.push(
        row([
          'Alerts per 1,000 customers',
          count(first.point.alerts.customers),
          ...PRESETS.map((preset) => {
            const { alerts } = presets[preset].point;
            const interval = presets[preset].intervals.alertsPerThousand;
            const range =
              interval === null ? 'n/a' : `${decimal(interval[0])}–${decimal(interval[1])}`;
            return `${decimal(alerts.perThousand)} (${range}) · ${count(alerts.alerted)} alerted`;
          }),
        ]),
      );
    }
    const pair = (/** @type {'truncated' | 'errored'} */ key) =>
      PRESETS.map(
        (preset) =>
          `${count(presets[preset].diagnostics[key])}, ${presets[preset].customerDiagnostics === null ? 'n/a' : count(presets[preset].customerDiagnostics[key])}`,
      );
    lines.push(
      '',
      ...table(['Diagnostics', ...PRESETS.map((p) => `\`${p}\``)]),
      row([
        'Misses with an incomplete coverage',
        ...PRESETS.map(
          (preset) =>
            `${count(presets[preset].diagnostics.missesFlagged)} of ${count(presets[preset].diagnostics.misses)}`,
        ),
      ]),
      row(['Searches cut at the cap (cases, customers)', ...pair('truncated')]),
      row(['Errored runs (cases, customers)', ...pair('errored')]),
      '',
    );
  }
  const bridged = Object.entries(results.bridged ?? {});
  if (bridged.length > 0) {
    lines.push(
      '#### Held-out group cases that a surviving group links',
      '',
      ...table([
        'Group cases',
        'n',
        'A given or family pair shares a surviving group',
        'Both pairs do',
      ]),
      ...bridged.map(([source, counts]) =>
        row([
          `\`${source}\``,
          count(counts.cases),
          count(counts.oneToken),
          count(counts.bothTokens),
        ]),
      ),
      '',
    );
  }
  return lines.join('\n');
}

/**
 * `count of total · share (interval)`.
 * @param {{ count: number, of: number, share: number, interval: Interval | null }} share
 */
const firstRound = (share) =>
  `${count(share.count)} of ${count(share.of)} · ${formatPercent(share.share)} (${formatPercentInterval(share.interval)})`;

/**
 * A first-round share a summary may not record (written before the member existed).
 * @param {{ count: number, of: number, share: number, interval: Interval | null } | null | undefined} share
 */
const recorded = (share) =>
  share === null || share === undefined ? 'not recorded' : firstRound(share);

/**
 * The performance tables: the imports, the screenings at each scale and the re-screens.
 * @param {any} performance `{ machine, postgres, scales: { [scale]: { imports, measure } }, rescreen }`.
 * @returns {string}
 */
export function performanceMarkdown(performance) {
  const { machine } = performance;
  const sockets = Number(machine.sockets);
  /** @type {string[]} */
  const lines = [
    `${machine.cpu}, ${machine.coresPerSocket} cores and ${count(machine.logicalCpus)} logical CPUs (${String(sockets)} socket${sockets === 1 ? '' : 's'}), ${decimal(machine.memoryGiB)} GiB, Linux ${machine.kernel}, Docker ${machine.docker}, \`${machine.postgresImage}\` (${performance.postgres}), Node ${machine.node}.`,
    '',
    ...table([
      'List names',
      'Syncs',
      'Entries',
      'Names in the file',
      'File',
      'Sync time (s)',
      'VACUUM ANALYZE (s)',
    ]),
  ];
  for (const [scale, label] of SCALES) {
    const imports = performance.scales?.[scale]?.imports;
    if (imports === undefined || imports.length === 0) {
      continue;
    }
    const last = imports.at(-1);
    const seconds = imports.reduce(
      (/** @type {number} */ sum, /** @type {{ syncSeconds: number }} */ item) =>
        sum + item.syncSeconds,
      0,
    );
    lines.push(
      row([
        label,
        count(imports.length),
        count(last.file.entries),
        count(last.file.names),
        `${decimal(last.file.bytes / 1e6)} MB`,
        decimal(seconds),
        last.vacuumSeconds === null ? 'n/a' : decimal(last.vacuumSeconds),
      ]),
    );
  }
  lines.push(
    '',
    ...table([
      'List names',
      'Budget',
      'p50 (ms)',
      'p95 (ms)',
      'p99 (ms)',
      'Round p95s (ms)',
      'Within budget',
      'p95 of state / retrieval / loads / the rest (ms)',
      'Candidates p50 / p95',
      'Truncated (first round)',
      'Cut at the cap',
      'Out of reach',
      'Would end `result_truncated`',
      'Listed subjects found',
    ]),
  );
  for (const [scale, label] of SCALES) {
    const summary = performance.scales?.[scale]?.measure;
    if (summary === undefined) {
      continue;
    }
    lines.push(
      row([
        label,
        `${count(summary.budgetMs)} ms`,
        decimal(summary.ms.p50),
        `**${decimal(summary.ms.p95)}**`,
        decimal(summary.ms.p99),
        summary.roundP95.map((/** @type {number} */ value) => decimal(value)).join(' / '),
        summary.ms.p95 <= summary.budgetMs ? 'yes' : '**no**',
        [
          summary.phaseP95.state,
          summary.phaseP95.retrieve,
          summary.phaseP95.load,
          summary.phaseP95.rest,
        ]
          .map((value) => decimal(value))
          .join(' / '),
        `${count(summary.candidates.p50)} / ${count(summary.candidates.p95)}`,
        firstRound(summary.capBinds),
        recorded(summary.capReached),
        recorded(summary.unreachable),
        firstRound(summary.wouldError),
        `${count(summary.listedFound.found)} of ${count(summary.listedFound.of)}`,
      ]),
    );
  }
  const runs = performance.rescreen?.runs ?? [];
  if (runs.length > 0) {
    lines.push(
      '',
      ...table([
        'Entries added',
        'Sync (s)',
        'Re-screen (s)',
        'Within 60 s',
        'Runs inserted',
        'Subjects',
      ]),
      ...runs.map((/** @type {any} */ run) =>
        row([
          count(run.added),
          decimal(run.syncSeconds),
          decimal(run.rescreenMs / 1000),
          run.rescreenMs <= run.budgetMs ? 'yes' : '**no**',
          count(run.result.runsInserted),
          count(run.result.subjects),
        ]),
      ),
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Where a scale table marks an interval that {@link excludesPoint}. */
const EXCLUDES_POINT = ', which excludes the point';

/**
 * What the scale tables say under a table with a marked interval (review C002; owner decision 7
 * after Workflow 6C fixed the bootstrap's list under test and keeps the mark as a flag).
 */
export const EXCLUDED_POINT_NOTE =
  'An interval marked “which excludes the point” does not contain its own point estimate. The list under test is fixed in every replicate (owner decision 7 after Workflow 6C), and a percentile interval of a ratio still need not contain its point; the mark is a flag. Read the Wilson interval beside it.';

/**
 * Whether a bootstrap interval leaves out its own point estimate.
 * @param {number | null} value
 * @param {Interval | null | undefined} interval
 */
function excludesPoint(value, interval) {
  const slack = 1e-9;
  return (
    value !== null &&
    interval !== null &&
    interval !== undefined &&
    (value < interval[0] - slack || value > interval[1] + slack)
  );
}

/** A share with its count, its bootstrap interval and, at a count of zero or of all, its Wilson
 * interval: a bootstrap interval is degenerate there. An interval that excludes its own point is
 * marked, with the Wilson interval beside it (review C002).
 * @param {{ hits: number, cases: number, value: number | null, wilson: Interval | null }} point
 * @param {Interval | null | undefined} interval
 */
function shareWithWilson(point, interval) {
  const extreme = point.cases > 0 && (point.hits === 0 || point.hits === point.cases);
  const excluded = excludesPoint(point.value, interval);
  const mark = excluded ? EXCLUDES_POINT : '';
  const wilson = extreme || excluded ? `; Wilson ${formatPercentInterval(point.wilson)}` : '';
  return `${count(point.hits)}/${count(point.cases)} · ${formatPercent(point.value)} (${formatPercentInterval(interval)}${mark}${wilson})`;
}

/** @param {Interval | null | undefined} interval */
const decimalInterval = (interval) =>
  interval === null || interval === undefined
    ? 'n/a'
    : `${decimal(interval[0])}–${decimal(interval[1])}`;

/** The labels of the scale sets. */
/** @type {readonly string[]} */
const SCALE_SETS = Object.freeze(['persons', 'companies']);

/**
 * The held-out population embedded in each performance table (owner decision 5): recall per
 * variant source, precision and alerts per 1,000 customers, per set and preset, with the
 * indistinguishable customers counted apart.
 * @param {any} scales `{ [scale]: results.json of the scale-report step }`.
 * @returns {string}
 */
export function scaleMarkdown(scales) {
  /** @type {string[]} */
  const lines = [];
  for (const [scale, label] of SCALES) {
    for (const set of SCALE_SETS) {
      const presets = scales[scale]?.sets?.[set];
      if (presets === undefined) {
        continue;
      }
      const first = presets[PRESETS[0] ?? 'exact'];
      const start = lines.length;
      lines.push(
        `#### Held-out population in the ${label}-name table: ${set}`,
        '',
        ...table(['Variant source', 'n', ...PRESETS.map((p) => `\`${p}\``)]),
      );
      for (const [source, recall] of Object.entries(first.point.recall)) {
        lines.push(
          row([
            `\`${source}\``,
            count(/** @type {{ cases: number }} */ (recall).cases),
            ...PRESETS.map((preset) =>
              shareWithWilson(
                presets[preset].point.recall[source],
                presets[preset].intervals.recall[source],
              ),
            ),
          ]),
        );
      }
      lines.push(
        row([
          'All cases',
          count(first.point.overall.cases),
          ...PRESETS.map((preset) =>
            shareWithWilson(presets[preset].point.overall, presets[preset].intervals.overall),
          ),
        ]),
        row([
          'Precision (matches to the expected entry)',
          '—',
          ...PRESETS.map((preset) => {
            const { expected, other, value, wilson } = presets[preset].point.precision;
            return shareWithWilson(
              { hits: expected, cases: expected + other, value, wilson },
              presets[preset].intervals.precision,
            );
          }),
        ]),
      );
      if (first.point.alerts.customers > 0) {
        lines.push(
          row([
            'False alerts per 1,000 customers',
            count(first.point.alerts.customers),
            ...PRESETS.map((preset) => {
              const { alerts } = presets[preset].point;
              const interval = presets[preset].intervals.alertsPerThousand;
              const extreme = alerts.alerted === 0 || alerts.alerted === alerts.customers;
              const excluded = excludesPoint(alerts.perThousand, interval);
              const mark = excluded ? EXCLUDES_POINT : '';
              const wilson =
                extreme || excluded ? `; Wilson ${decimalInterval(alerts.wilson)}` : '';
              return `${decimal(alerts.perThousand)} (${decimalInterval(interval)}${mark}${wilson}) · ${count(alerts.alerted)} alerted`;
            }),
          ]),
          row([
            'Customers equal to a listed entry in name and birth date (left out of the rate)',
            count(first.indistinguishable.customers),
            ...PRESETS.map(
              (preset) => `${count(presets[preset].indistinguishable.alerted)} alerted`,
            ),
          ]),
        );
      }
      if (lines.slice(start).some((line) => line.includes(EXCLUDES_POINT))) {
        lines.push('', EXCLUDED_POINT_NOTE);
      }
      const pair = (/** @type {'truncated' | 'errored'} */ key) =>
        PRESETS.map(
          (preset) =>
            `${count(presets[preset].diagnostics[key].cases)}, ${count(presets[preset].diagnostics[key].customers)}`,
        );
      lines.push(
        '',
        ...table(['Diagnostics', ...PRESETS.map((p) => `\`${p}\``)]),
        row([
          'Misses with an incomplete coverage',
          ...PRESETS.map(
            (preset) =>
              `${count(presets[preset].diagnostics.missesFlagged)} of ${count(presets[preset].diagnostics.misses)}`,
          ),
        ]),
        row(['Searches cut at the cap (cases, customers)', ...pair('truncated')]),
        row(['Errored runs (cases, customers)', ...pair('errored')]),
        '',
      );
    }
  }
  return lines.join('\n');
}

/** @param {number} value */
const signed = (value) => `${value < 0 ? '-' : '+'}${decimal(Math.abs(value))}`;

/**
 * A difference of shares in percentage points with its interval.
 * @param {number | null | undefined} value
 * @param {Interval | null | undefined} interval
 */
function pointsCell(value, interval) {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  const range =
    interval === null || interval === undefined
      ? 'n/a'
      : `${signed(interval[0] * 100)} to ${signed(interval[1] * 100)}`;
  return `${signed(value * 100)} pp (${range})`;
}

/**
 * Base and head on one seed: each run's value and `head - base` with its paired 95% interval.
 * @param {any} comparison The compare step's `compare.json`.
 * @returns {string}
 */
export function compareMarkdown(comparison) {
  /** @type {string[]} */
  const lines = [];
  for (const set of comparison.sets ?? []) {
    lines.push(
      `#### Base and head: ${String(set.title)}`,
      '',
      ...table(['Preset', 'Measure', 'Base', 'Head', 'Head − base (95% paired interval)']),
    );
    for (const [preset, item] of Object.entries(set.presets ?? {})) {
      const { base, head, difference, differenceIntervals } = /** @type {any} */ (item);
      const name = `\`${preset}\``;
      lines.push(
        row([
          name,
          'Recall, all cases',
          formatPercent(base.overall.value),
          formatPercent(head.overall.value),
          pointsCell(difference.overall, differenceIntervals.overall),
        ]),
        ...Object.keys(base.recall).map((source) =>
          row([
            name,
            `Recall, \`${source}\``,
            formatPercent(base.recall[source]?.value),
            formatPercent(head.recall[source]?.value),
            pointsCell(difference.recall[source], differenceIntervals.recall[source]),
          ]),
        ),
        row([
          name,
          'Precision',
          formatPercent(base.precision.value),
          formatPercent(head.precision.value),
          pointsCell(difference.precision, differenceIntervals.precision),
        ]),
      );
      if (base.alerts.customers > 0) {
        const change = difference.alertsPerThousand;
        const interval = differenceIntervals.alertsPerThousand;
        const relative =
          change === null || !(base.alerts.perThousand > 0)
            ? ''
            : `; ${signed((100 * change) / base.alerts.perThousand)}% of the base rate`;
        lines.push(
          row([
            name,
            'False alerts per 1,000 customers',
            decimal(base.alerts.perThousand),
            decimal(head.alerts.perThousand),
            change === null
              ? 'n/a'
              : `${signed(change)} (${interval === null ? 'n/a' : `${signed(interval[0])} to ${signed(interval[1])}`})${relative}`,
          ]),
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** The token-length labels of the typo-kind breakdown (C79.1's 5-character budget). */
const TYPO_LENGTHS = Object.freeze({ all: 'all', short: 'under 5', long: '5 or more' });

/**
 * The typo-kind breakdown (owner decision 7).
 * @param {any} typoKinds The typo-kinds step's `typo-kinds.json`.
 * @returns {string}
 */
export function typoKindsMarkdown(typoKinds) {
  /** @type {string[]} */
  const presets = typoKinds.presets ?? PRESETS;
  /** @type {any[]} */
  const rows = typoKinds.rows ?? [];
  if (rows.length === 0) {
    return '';
  }
  return [
    '#### Typo cases by kind (persons: the family name; companies: the first word)',
    '',
    ...table(['Set', 'Kind', 'Token length', 'n', ...presets.map((p) => `\`${p}\``)]),
    ...rows.map((item) =>
      row([
        String(item.subject),
        String(item.kind),
        TYPO_LENGTHS[/** @type {'all' | 'short' | 'long'} */ (item.length)],
        count(item.presets[presets[0] ?? 'exact'].of),
        ...presets.map((preset) => {
          const cell = item.presets[preset];
          return `${count(cell.found)}/${count(cell.of)} · ${formatPercent(cell.share)} (Wilson ${formatPercentInterval(cell.wilson)})`;
        }),
      ]),
    ),
    '',
  ].join('\n');
}

/**
 * The unlisted subjects' alerts of the measure step's first round, per scale (owner decision 7).
 * @param {any} scales `{ [scale]: unlisted.json }`.
 * @returns {string}
 */
export function unlistedMarkdown(scales) {
  const present = SCALES.filter(([scale]) => scales[scale] !== undefined);
  if (present.length === 0) {
    return '';
  }
  return [
    ...table([
      'List names',
      'Unlisted subjects with a kept `tolerant` match (first round)',
      'Kept matches',
    ]),
    ...present.map(([scale, label]) => {
      const item = scales[scale];
      return row([
        label,
        `${count(item.alerted)} of ${count(item.of)} · ${formatPercent(item.share)} (Wilson ${formatPercentInterval(item.interval)})`,
        count(item.matches),
      ]);
    }),
    '',
  ].join('\n');
}

/** @param {Record<string, number>} tables */
const megabytes = (tables) =>
  `${decimal(Object.values(tables).reduce((sum, bytes) => sum + bytes, 0) / 1e6)} MB`;

/**
 * The compacted-table round, per scale (owner decision 7).
 * @param {any} scales `{ [scale]: compact.json }`.
 * @returns {string}
 */
export function compactMarkdown(scales) {
  const present = SCALES.filter(([scale]) => scales[scale] !== undefined);
  if (present.length === 0) {
    return '';
  }
  return [
    ...table([
      'List names',
      'List tables before → after VACUUM FULL',
      'VACUUM FULL (s)',
      'p50 (ms)',
      'p95 (ms)',
      'p95 of retrieval (ms)',
      'Truncated',
      'Cut at the cap',
      'Out of reach',
      'Load average (before, after)',
    ]),
    ...present.map(([scale, label]) => {
      const item = scales[scale];
      return row([
        label,
        `${megabytes(item.before.tables)} → ${megabytes(item.after.tables)}`,
        decimal(item.vacuumSeconds),
        decimal(item.summary.ms.p50),
        decimal(item.summary.ms.p95),
        decimal(item.summary.phaseP95.retrieve),
        firstRound(item.summary.capBinds),
        recorded(item.summary.capReached),
        recorded(item.summary.unreachable),
        `${decimal(item.loadAverage.before[0])}, ${decimal(item.loadAverage.after[0])}`,
      ]);
    }),
    '',
  ].join('\n');
}

/** @param {{ count: number, of: number, share: number | null, wilson: Interval | null }} cell */
const countCell = (cell) =>
  `${count(cell.count)}/${count(cell.of)} · ${formatPercent(cell.share)} (Wilson ${formatPercentInterval(cell.wilson)})`;

/**
 * The development tables' variant cases, per scale (for the matcher's owner; never held out).
 * @param {any} scales `{ [scale]: variants.json }`.
 * @returns {string}
 */
export function variantsMarkdown(scales) {
  /** @type {string[]} */
  const lines = [];
  for (const [scale, label] of SCALES) {
    const summary = scales[scale]?.summary;
    if (summary === undefined) {
      continue;
    }
    const first = summary[PRESETS[0] ?? 'exact'];
    lines.push(
      `#### Development variants in the ${label}-name table`,
      '',
      ...table(['Variant source', 'n', ...PRESETS.map((p) => `\`${p}\``)]),
      ...Object.keys(first.recall).map((source) =>
        row([
          `\`${source}\``,
          count(first.recall[source].of),
          ...PRESETS.map((preset) => countCell(summary[preset].recall[source])),
        ]),
      ),
      row([
        'All cases',
        count(first.overall.of),
        ...PRESETS.map((preset) => countCell(summary[preset].overall)),
      ]),
      row([
        'Precision',
        '—',
        ...PRESETS.map((preset) => {
          const { expected, other, value } = summary[preset].precision;
          return `${count(expected)}/${count(expected + other)} · ${formatPercent(value)}`;
        }),
      ]),
      row([
        'Unlisted subjects with a kept match',
        count(first.unlisted.of),
        ...PRESETS.map((preset) => {
          const cell = summary[preset].unlisted;
          return `${count(cell.count)} of ${count(cell.of)} · ${formatPercent(cell.share)} (Wilson ${formatPercentInterval(cell.wilson)})`;
        }),
      ]),
      row([
        'Searches cut at the cap (cases, unlisted)',
        ...PRESETS.map(
          (preset) =>
            `${count(summary[preset].truncated.cases)}, ${count(summary[preset].truncated.unlisted)}`,
        ),
      ]),
      '',
    );
  }
  return lines.join('\n');
}
