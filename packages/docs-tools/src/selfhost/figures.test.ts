/** The figures the guide quotes: the load report's summary block, the metrics and the migrations. */
import { describe, expect, it } from 'vitest';
import { metricsNamedIn } from '../../../../apps/api/src/metrics-documents.js';
import {
  METRIC_REGISTRY,
  type MetricDefinition,
} from '../../../../apps/api/src/metrics-registry.js';
import { REPOSITORY_ROOT, createRepository } from '../repository.js';
import {
  LOAD_REPORT,
  readSummaryBlock,
  renderLoadFigures,
  renderMetricTable,
  renderMigrationList,
  type LoadSummary,
} from './figures.js';

const repo = createRepository(REPOSITORY_ROOT);
const schema: unknown = JSON.parse(
  repo.readText('contracts/fixtures/calibration/summary.schema.json'),
);

const SUMMARY = {
  schema: 'openverify/calibration-summary@1',
  report: 'docs/calibration/load-phase11.md',
  workflow: '11D',
  status: 'published',
  'method-commit': 'ac3fc15583558d1ad256c44fb9e39eee7ebce871',
  base: 'd44e537dba0f84a4eafc45b313264de74c2b31a4',
  head: '2d3134755c0fd4412b052faa0f2c357dfb729a4d',
  machine: {
    cpu: 'A synthetic CPU (6 cores)',
    'logical-cpus': 12,
    'memory-gib': 31,
    'disk-class': 'a synthetic disk',
  },
  rows: [
    {
      id: 'api-reads',
      title: 'API reads at 100 requests/s',
      contract: 'C269.1',
      owner: 'calibration-load-11d',
      budget: { metric: 'p95', comparison: '<=', value: 150, unit: 'ms' },
      verdict: 'missed',
      median: 390.048,
      unit: 'ms',
      gap: 240.048,
      configuration: 'default',
      takes: [{ value: 390.048, status: 'valid', 'load-start': 2.59, 'load-end': 2.14 }],
    },
    {
      id: 'flow-upload',
      title: 'Flow upload | at 10 uploads/s',
      contract: 'C269.1',
      owner: 'calibration-load-11d',
      budget: { metric: 'p95', comparison: '<=', value: 1.5, unit: 's' },
      verdict: 'not-measured',
      median: null,
      unit: 's',
      gap: null,
      configuration: 'default',
      takes: [],
    },
    {
      id: 'jit-comparison',
      title: 'Runtime role jit off against on',
      contract: 'C272.1',
      owner: 'calibration-load-11d',
      budget: { metric: 'ratio', comparison: '<=', value: 1.05, unit: 'ratio' },
      verdict: 'missed',
      median: 3.933,
      unit: 'ratio',
      gap: 2.883,
      configuration: 'default',
      takes: [],
    },
    {
      id: 'network-lookup',
      title: 'Network lookup',
      contract: 'C93.2',
      owner: 'calibration-load-11d',
      budget: { metric: 'mean', comparison: '<=', value: 1, unit: 'ms' },
      verdict: 'met',
      median: 0.006406,
      unit: 'ms',
      gap: -0.994,
      configuration: 'default',
      takes: [],
    },
    {
      id: 'screening-throughput-2m',
      title: 'Screenings per hour',
      contract: 'C269.1',
      owner: 'calibration-load-11d',
      budget: { metric: 'rate', comparison: '>=', value: 10000, unit: 'per-hour' },
      verdict: 'met',
      median: 14592,
      unit: 'per-hour',
      gap: 4592,
      configuration: 'concurrency 1',
      takes: [],
    },
  ],
};

const block = (value: unknown): string =>
  [
    '# Report',
    '',
    '<!-- openverify:calibration-summary:start -->',
    '```json',
    JSON.stringify(value, null, 2),
    '```',
    '<!-- openverify:calibration-summary:end -->',
    '',
  ].join('\n');

function summaryOf(value: unknown): LoadSummary {
  const read = readSummaryBlock(block(value), schema);
  expect(read.errors).toEqual([]);
  if (read.summary === null) {
    throw new Error('no summary');
  }
  return read.summary;
}

describe('the load report summary block (Workflow 11D Stage 1a amendment 14)', () => {
  it('reads a valid block', () => {
    const summary = summaryOf(SUMMARY);
    expect(summary.head).toBe(SUMMARY.head);
    expect(summary.rows.map((row) => row.id)).toEqual(SUMMARY.rows.map((row) => row.id));
  });

  it('refuses a missing, doubled or invalid block, naming why', () => {
    expect(readSummaryBlock('# Report\n', schema)).toEqual({
      summary: null,
      errors: ['no calibration summary block'],
    });
    expect(readSummaryBlock(`${block(SUMMARY)}${block(SUMMARY)}`, schema).errors).toEqual([
      'more than one calibration summary block',
    ]);
    const invalid = readSummaryBlock(block({ ...SUMMARY, status: 'nearly' }), schema);
    expect(invalid.summary).toBeNull();
    expect(invalid.errors.join(' ')).toContain('/status');
    expect(
      readSummaryBlock(block(SUMMARY).replace('"rows"', '"rows" oops'), schema).errors[0],
    ).toMatch(/^the block is not JSON/);
  });

  it('reads the committed load report', () => {
    const read = readSummaryBlock(repo.readText(LOAD_REPORT), schema);
    expect(read.errors).toEqual([]);
    expect(read.summary?.rows.find((row) => row.id === 'api-reads')?.verdict).toBe('missed');
  });
});

describe('the sizing page figures (C277.11)', () => {
  const figures = (): string => renderLoadFigures(summaryOf(SUMMARY));

  it('states the machine, the head and the report', () => {
    expect(figures()).toContain(
      'A synthetic CPU (6 cores), 12 logical CPUs, 31 GiB, a synthetic disk',
    );
    expect(figures()).toContain('`2d3134755`');
    expect(figures()).toContain('`docs/calibration/load-phase11.md`');
  });

  it('renders one row a figure, every verdict as the block gives it, with its gap', () => {
    const rows = figures()
      .split('\n')
      .filter((line) => line.startsWith('| `'));
    expect(rows).toEqual([
      '| `api-reads` | API reads at 100 requests/s | C269.1 | missed | 390.0 ms | p95 at most 150 ms | +240.0 ms | default |',
      '| `flow-upload` | Flow upload \\| at 10 uploads/s | C269.1 | not measured | none | p95 at most 1.5 s | none | default |',
      '| `jit-comparison` | Runtime role jit off against on | C272.1 | missed | 3.93 times | ratio at most 1.05 times | +2.88 times | default |',
      '| `network-lookup` | Network lookup | C93.2 | met | 0.006406 ms | mean at most 1 ms | -0.994 ms | default |',
      '| `screening-throughput-2m` | Screenings per hour | C269.1 | met | 14,592 an hour | rate at least 10,000 an hour | +4,592 an hour | concurrency 1 |',
    ]);
  });
});

describe('the monitoring page metric table (C250.7, C277.10)', () => {
  const definition: MetricDefinition = {
    name: 'queue_in_flight',
    kind: 'gauge',
    unit: 'count',
    labels: ['environmentId', 'queue'],
    description: 'Jobs | in flight.',
    owner: 'quotas',
    contract: 'C251.4',
  };

  it('writes each metric as `metric: <name>` with its kind, unit, labels and meaning', () => {
    expect(renderMetricTable([definition]).split('\n').at(-1)).toBe(
      '| `metric: queue_in_flight` | gauge | count | environmentId, queue | Jobs \\| in flight. | C251.4 |',
    );
    expect(renderMetricTable([{ ...definition, labels: [] }])).toContain('| count | none |');
  });

  it('names every registered metric and nothing else', () => {
    expect(metricsNamedIn(renderMetricTable(METRIC_REGISTRY)).sort()).toEqual(
      METRIC_REGISTRY.map((metric) => metric.name).sort(),
    );
  });
});

describe('the upgrade page migration list', () => {
  it('lists the migrations from 0025 on, in order, leaving out the others and the snapshots', () => {
    expect(
      renderMigrationList([
        'packages/db/drizzle/0026_b.sql',
        'packages/db/drizzle/0024_phase7b.sql',
        'packages/db/drizzle/0025_a.sql',
        'packages/db/drizzle/meta/0025_snapshot.json',
      ]),
    ).toBe('- `0025_a`\n- `0026_b`');
  });
});
