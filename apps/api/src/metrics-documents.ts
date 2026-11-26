/**
 * C250.7 (review H13; decision 72; Phase 11, Workflow 11B, platform-ops): the documents that cite
 * metrics (the threat model, the self-hosting guide's `monitoring.md` and the ASVS checklist, all
 * Workflow 11E's) may name only metrics `metrics-registry.ts` holds. A document names a metric the
 * way a log-based alert matches the event's `metric` field: `metric: <name>`, `metric=<name>` or
 * `"metric": "<name>"`, quoted or backticked or not.
 */
import type { MetricsRegistry } from './metrics-registry.js';

/** The documents checked, from the repository root; a missing one is skipped. */
export const METRIC_DOCUMENTS = [
  'docs/security/threat-model.md',
  'docs/self-hosting/monitoring.md',
  'docs/security/asvs-5.0.0-l2.csv',
] as const;

/**
 * The word `metric` (any case, a whole word), an optional closing quote, `:` or `=`, then a
 * snake_case name with at least one underscore (every registered name has one), optionally quoted.
 */
const NAMED_METRIC =
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  /\b[Mm][Ee][Tt][Rr][Ii][Cc]\b["'`]?\s*[:=]\s*["'`]?([a-z][a-z0-9]*(?:_[a-z0-9]+)+)/g;

/** The metric names `text` cites, each once, in the order they first appear. */
export function metricsNamedIn(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(NAMED_METRIC)) {
    names.add(match[1] ?? '');
  }
  return [...names];
}

/** The names `text` cites that `registry` does not hold. */
export function unregisteredMetricsIn(text: string, registry: MetricsRegistry): string[] {
  return metricsNamedIn(text).filter((name) => registry.get(name) === undefined);
}
