/**
 * C101.8 (Workflow 7B; F18): the graph benchmark's run, reported and not gated, as Phase 6 treats
 * its 2,000,000-name case. It builds the seeded synthetic graph (`synthetic.ts`, the CI gate's
 * builder), then times the C102.3 engine itself in each scenario from `runs` start accounts drawn
 * from the seed, and reports the median, p95 and largest time with the mean result size, the
 * timeouts, the node-limit stops and the skipped hubs. Counts and times only, never an id.
 */
import { createHash } from 'node:crypto';
import type { GraphQueryTemplateConfig } from '@openverify/contracts';
import { GRAPH_LIMITS } from '@openverify/core';
import type { Db } from '@openverify/db';
import { searchGraph } from './query.js';
import { buildSyntheticGraph, syntheticAccountId, type SyntheticShape } from './synthetic.js';

export interface GraphBenchmarkOptions {
  environmentId: string;
  accounts: number;
  runs: number;
  seed: string;
  /** R007 (Workflow 11D): the synthetic graph's shape; the default shape when absent. */
  shape?: SyntheticShape | undefined;
}

export interface GraphBenchmarkScenario {
  name: string;
  runs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanAccounts: number;
  meanNodes: number;
  timedOut: number;
  nodeLimitReached: number;
  skippedHubValues: number;
}

export interface GraphBenchmarkReport {
  accounts: number;
  rows: number;
  buildMs: number;
  scenarios: GraphBenchmarkScenario[];
}

const STRONG: GraphQueryTemplateConfig['connect-kinds'] = ['email_address', 'phone_number'];

const scenario = (
  name: string,
  config: Partial<GraphQueryTemplateConfig>,
  options: { hubStart?: boolean } = {},
) => ({
  name,
  hubStart: options.hubStart === true,
  config: {
    parameters: [{ name: 'account_id', kind: 'account_id' as const }],
    start: [{ kind: 'account_id' as const, value: '{{account_id}}' }],
    'connect-kinds': STRONG,
    'node-limit': GRAPH_LIMITS.nodeLimit,
    ...config,
  } satisfies GraphQueryTemplateConfig,
});

/** The scenarios a run times, each from seeded start accounts. */
export const GRAPH_BENCHMARK_SCENARIOS = Object.freeze([
  scenario('strong, 2 hops', { 'max-hops': 2 }),
  scenario('strong, 4 hops', { 'max-hops': 4 }),
  scenario('strong, 6 hops', { 'max-hops': 6 }),
  scenario('strong and weak, 4 hops', {
    'max-hops': 4,
    'connect-kinds': [...STRONG, 'device_fingerprint', 'ip_address', 'name'],
    'include-weak-kinds': true,
  }),
  scenario(
    'hub start, 4 hops',
    { 'max-hops': 4, 'connect-kinds': [...STRONG, 'phone_number_unconfirmed'] },
    { hubStart: true },
  ),
]);

/** The `index`-th start account of the seed, below `limit`. */
function startOf(seed: string, index: number, limit: number): number {
  const digest = createHash('sha256')
    .update(`${seed}|start|${String(index)}`)
    .digest();
  return digest.readUInt32BE(0) % limit;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

const round = (value: number) => Math.round(value * 10) / 10;

export async function runGraphBenchmark(
  db: Db,
  options: GraphBenchmarkOptions,
): Promise<GraphBenchmarkReport> {
  const { environmentId, accounts, runs, seed } = options;
  const building = performance.now();
  const build = await buildSyntheticGraph(db, {
    environmentId,
    accounts,
    seed,
    ...(options.shape === undefined ? {} : { shape: options.shape }),
  });
  const buildMs = performance.now() - building;
  const hubHolders = Math.min(5000, accounts);
  const scenarios: GraphBenchmarkScenario[] = [];
  for (const { name, config, hubStart } of GRAPH_BENCHMARK_SCENARIOS) {
    const times: number[] = [];
    let accountsSeen = 0;
    let nodes = 0;
    let timedOut = 0;
    let nodeLimitReached = 0;
    let skippedHubValues = 0;
    for (let run = 0; run < runs; run += 1) {
      const start = startOf(`${seed}|${name}`, run, hubStart ? hubHolders : accounts);
      const began = performance.now();
      const result = await searchGraph(
        db,
        {
          environmentId,
          config,
          startAccounts: [syntheticAccountId(start)],
          startValues: [],
          filters: {},
          deadline: Date.now() + GRAPH_LIMITS.timeoutSeconds * 1000,
        },
        { now: () => Date.now() },
      );
      times.push(performance.now() - began);
      accountsSeen += result?.accountIds.length ?? 0;
      nodes += result?.nodes.length ?? 0;
      timedOut += result?.timedOut === true ? 1 : 0;
      nodeLimitReached += result?.nodeLimitReached === true ? 1 : 0;
      skippedHubValues += result?.skippedHubValues ?? 0;
    }
    const sorted = [...times].sort((a, b) => a - b);
    scenarios.push({
      name,
      runs,
      p50Ms: round(percentile(sorted, 0.5)),
      p95Ms: round(percentile(sorted, 0.95)),
      maxMs: round(sorted.at(-1) ?? 0),
      meanAccounts: round(accountsSeen / runs),
      meanNodes: round(nodes / runs),
      timedOut,
      nodeLimitReached,
      skippedHubValues,
    });
  }
  return { accounts, rows: build.rows, buildMs: Math.round(buildMs), scenarios };
}
