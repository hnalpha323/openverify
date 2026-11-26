import { describe, expect, it } from 'vitest';
import { DOCS_TREE } from './docs-tree.js';
import { checkMetricNames, metricDocuments, metricFindings } from './metrics.js';
import { REPOSITORY_ROOT, createMemoryRepository, createRepository } from './repository.js';

describe('metric names in the other documents of the docs tree (C250.7)', () => {
  it('reads every docs-tree document but the three the API suite checks', () => {
    const repo = createMemoryRepository(
      Object.fromEntries(DOCS_TREE.map((item) => [item.path, ''])),
    );
    const read = metricDocuments(repo);

    expect(read).not.toContain('docs/security/threat-model.md');
    expect(read).not.toContain('docs/self-hosting/monitoring.md');
    expect(read).not.toContain('docs/security/asvs-5.0.0-l2.csv');
    expect(read).toContain('docs/self-hosting/sizing.md');
    expect(read).toHaveLength(DOCS_TREE.length - 3);
    expect(metricDocuments(createMemoryRepository({}))).toEqual([]);
  });

  it('refuses a name the registry does not hold, in each of the forms an alert uses', () => {
    expect(
      metricFindings('docs/self-hosting/sizing.md', 'Alert on `metric: queue_in_flight_cap`.'),
    ).toEqual([]);
    expect(
      metricFindings(
        'docs/self-hosting/sizing.md',
        'metric=queue_depth_total and {"metric": "rate_limiter_store_unavailable"}',
      ).map((finding) => finding.message),
    ).toEqual([
      'names the metric queue_depth_total, which apps/api/src/metrics-registry.ts does not hold (C250.7)',
    ]);
  });

  it('holds over the repository', () => {
    expect(checkMetricNames(createRepository(REPOSITORY_ROOT))).toEqual({
      name: 'metric-names',
      status: 'built',
      findings: [],
    });
  });
});
