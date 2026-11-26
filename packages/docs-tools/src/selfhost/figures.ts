/**
 * The figures the guide quotes, rendered from the repository's own records (C277.7, C277.10,
 * C277.11; Workflow 11E, docs-selfhost): the load report's summary block
 * (`openverify/calibration-summary@1`, read and validated against
 * `contracts/fixtures/calibration/summary.schema.json`, never the prose: Workflow 11D Stage 1a
 * amendment 14), the metric registry and the migration files. Deterministic: no clock, no host.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { MetricDefinition } from '../../../../apps/api/src/metrics-registry.js';

/** The load report sizing.md and database.md quote. */
export const LOAD_REPORT = 'docs/calibration/load-phase11.md';
/** The schema every summary block is valid against. */
export const SUMMARY_SCHEMA = 'contracts/fixtures/calibration/summary.schema.json';
/** The first migration upgrades.md lists (Workflow 7C's). */
export const FIRST_LISTED_MIGRATION = '0025';
/** Where the migrations live. */
export const MIGRATIONS_DIR = 'packages/db/drizzle';

const SUMMARY_START = '<!-- openverify:calibration-summary:start -->';
const SUMMARY_END = '<!-- openverify:calibration-summary:end -->';

export interface SummaryBudget {
  readonly metric: string;
  readonly comparison: string;
  readonly value: number;
  readonly unit: string;
}

export interface SummaryRow {
  readonly id: string;
  readonly title: string;
  readonly contract: string;
  readonly budget: SummaryBudget | null;
  readonly verdict: string;
  readonly median: number | null;
  readonly unit: string | null;
  readonly gap: number | null;
  readonly configuration: string;
}

export interface LoadSummary {
  readonly report: string;
  readonly head: string;
  readonly machine: {
    readonly cpu: string;
    readonly 'logical-cpus': number;
    readonly 'memory-gib': number;
    readonly 'disk-class': string;
  };
  readonly rows: readonly SummaryRow[];
}

/** The report's one summary block, validated against `schema`; errors otherwise. */
export function readSummaryBlock(
  text: string,
  schema: unknown,
): { readonly summary: LoadSummary | null; readonly errors: readonly string[] } {
  const starts = text.split(SUMMARY_START).length - 1;
  if (starts === 0) {
    return { summary: null, errors: ['no calibration summary block'] };
  }
  if (starts > 1) {
    return { summary: null, errors: ['more than one calibration summary block'] };
  }
  const inner = text.slice(text.indexOf(SUMMARY_START) + SUMMARY_START.length);
  const body = inner.slice(0, Math.max(0, inner.indexOf(SUMMARY_END)));
  const json = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return {
      summary: null,
      errors: [`the block is not JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema as object);
  if (!validate(value)) {
    return {
      summary: null,
      errors: (validate.errors ?? []).map(
        (error) => `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? ''}`,
      ),
    };
  }
  return { summary: value as LoadSummary, errors: [] };
}

/** A table cell: one line, pipes escaped. */
function cell(text: string): string {
  return text.replaceAll('\n', ' ').replaceAll('|', '\\|');
}

/** A figure as the guide prints it: integers grouped, then 1, 2 or 4 significant places. */
export function formatFigure(value: number): string {
  if (Number.isInteger(value)) {
    return value.toLocaleString('en-US');
  }
  const magnitude = Math.abs(value);
  if (magnitude >= 100) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  if (magnitude >= 1) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return value.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

const UNIT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  'per-hour': 'an hour',
  'per-s': 'a second',
  ratio: 'times',
  count: '',
  mib: 'MiB',
  percent: 'percent',
});

/** A figure with its unit in words. */
export function withUnit(value: number, unit: string | null): string {
  const word = unit === null ? '' : (UNIT_WORDS[unit] ?? unit);
  return word === '' ? formatFigure(value) : `${formatFigure(value)} ${word}`;
}

function budgetOf(budget: SummaryBudget | null): string {
  if (budget === null) {
    return 'none';
  }
  const comparison =
    budget.comparison === '<='
      ? 'at most'
      : budget.comparison === '>='
        ? 'at least'
        : budget.comparison;
  return `${budget.metric} ${comparison} ${withUnit(budget.value, budget.unit)}`;
}

function gapOf(row: SummaryRow): string {
  if (row.gap === null) {
    return 'none';
  }
  return `${row.gap > 0 ? '+' : ''}${withUnit(row.gap, row.unit)}`;
}

/** The sizing page's table of the load report's rows, every verdict as the block gives it. */
export function renderLoadFigures(summary: LoadSummary): string {
  const machine = summary.machine;
  return [
    `Machine: ${machine.cpu}, ${String(machine['logical-cpus'])} logical CPUs, ${String(machine['memory-gib'])} GiB, ${machine['disk-class']}. Head \`${summary.head.slice(0, 9)}\`; report \`${summary.report}\`. Read from the report's summary block by \`pnpm --filter @openverify/docs-tools docs:selfhost\`, never edited by hand.`,
    '',
    '| Row | What | Contract | Verdict | Median | Budget | Gap | Configuration |',
    '|---|---|---|---|---|---|---|---|',
    ...summary.rows.map(
      (row) =>
        `| \`${row.id}\` | ${cell(row.title)} | ${cell(row.contract)} | ${row.verdict.replaceAll('-', ' ')} | ${row.median === null ? 'none' : withUnit(row.median, row.unit)} | ${budgetOf(row.budget)} | ${gapOf(row)} | ${cell(row.configuration)} |`,
    ),
  ].join('\n');
}

/** The monitoring page's table of every registered metric, each written `metric: <name>`. */
export function renderMetricTable(definitions: readonly MetricDefinition[]): string {
  return [
    '| Metric | Kind | Unit | Labels | What it means | Contract |',
    '|---|---|---|---|---|---|',
    ...[...definitions]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(
        (metric) =>
          `| \`metric: ${metric.name}\` | ${metric.kind} | ${metric.unit} | ${metric.labels.length === 0 ? 'none' : metric.labels.join(', ')} | ${cell(metric.description)} | ${metric.contract} |`,
      ),
  ].join('\n');
}

const MIGRATION_FILE = /^packages\/db\/drizzle\/(\d{4})_[^/]+\.sql$/u;

/** The upgrade page's list of the migrations from {@link FIRST_LISTED_MIGRATION} on, in order. */
export function renderMigrationList(files: readonly string[]): string {
  return files
    .filter((file) => {
      const number = MIGRATION_FILE.exec(file)?.[1];
      return number !== undefined && number >= FIRST_LISTED_MIGRATION;
    })
    .map((file) => file.slice(`${MIGRATIONS_DIR}/`.length, -'.sql'.length))
    .sort()
    .map((name) => `- \`${name}\``)
    .join('\n');
}
