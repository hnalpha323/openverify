/**
 * C250.7 for the rest of the docs tree (11E decisions item 15): `apps/api/src/metrics-documents.test.ts`
 * (the API suite) checks the threat model, `monitoring.md` and the ASVS checklist; every other
 * document of the docs tree that names a metric (`metric: <name>`, `metric=<name>` or a JSON
 * `"metric"` member) must name one `apps/api/src/metrics-registry.ts` holds. The pattern and the
 * registry are imported from the API (they import nothing at run time), never copied.
 */
import {
  METRIC_DOCUMENTS,
  unregisteredMetricsIn,
} from '../../../apps/api/src/metrics-documents.js';
import { metrics } from '../../../apps/api/src/metrics-registry.js';
import { DOCS_TREE } from './docs-tree.js';
import type { CheckFinding, CheckResult, Repository } from './types.js';

/** The docs-tree documents this check reads: every one the API suite's test does not. */
export function metricDocuments(repo: Repository): readonly string[] {
  const covered = new Set<string>(METRIC_DOCUMENTS);
  return DOCS_TREE.map((item) => item.path).filter(
    (path) => !covered.has(path) && repo.exists(path),
  );
}

/** The unregistered metric names `text` cites, as findings on `path`. */
export function metricFindings(path: string, text: string): readonly CheckFinding[] {
  return unregisteredMetricsIn(text, metrics).map((name) => ({
    rule: 'metric-name',
    path,
    message: `names the metric ${name}, which apps/api/src/metrics-registry.ts does not hold (C250.7)`,
    severity: 'error' as const,
  }));
}

/** C250.7 over the docs tree's other documents. */
export function checkMetricNames(repo: Repository): CheckResult {
  return {
    name: 'metric-names',
    status: 'built',
    findings: metricDocuments(repo).flatMap((path) => metricFindings(path, repo.readText(path))),
  };
}
