/**
 * C250.7 (review H13; decision 72): the threat model, `monitoring.md` and the ASVS checklist name
 * only registered metrics. The documents are Workflow 11E's; the check reads whichever exist and
 * passes while none does.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { METRIC_DOCUMENTS, metricsNamedIn, unregisteredMetricsIn } from './metrics-documents.js';
import { createMetricsRegistry, metrics, type MetricDefinition } from './metrics-registry.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const HEARTBEAT: MetricDefinition = {
  name: 'worker_heartbeat_age_ms',
  kind: 'gauge',
  unit: 'milliseconds',
  labels: [],
  description: 'The age of the worker heartbeat each write replaces.',
  owner: 'platform-ops',
  contract: 'C250.2',
};

describe('the metrics a document names (C250.7)', () => {
  it('reads every way an alert names the metric field, each name once in order', () => {
    const text = [
      'Alert when `metric: worker_heartbeat_age_ms` exceeds 30000.',
      '| queue | `metric=queue_at_cap_ms` |',
      'A rule on {"metric": "rate_limiter_store_unavailable"} and metric="queue_in_flight".',
      "metric:'queue_in_flight_cap', METRIC = account_export_refused_pending",
      'Again: metric: worker_heartbeat_age_ms.',
    ].join('\n');

    expect(metricsNamedIn(text)).toEqual([
      'worker_heartbeat_age_ms',
      'queue_at_cap_ms',
      'rate_limiter_store_unavailable',
      'queue_in_flight',
      'queue_in_flight_cap',
      'account_export_refused_pending',
    ]);
  });

  it('reads a CSV row of the ASVS checklist the same way', () => {
    const row =
      'v5.0.0-16.3.1,2,met,apps/api/src/metrics-registry.ts,"alert on metric: queue_at_cap_ms",B7,2026-11-13,abc';
    expect(metricsNamedIn(row)).toEqual(['queue_at_cap_ms']);
  });

  it('takes no other word for a metric: prose, a problem code, a log event', () => {
    const text = [
      'Metrics are log events; the 503 login_unavailable is a problem code.',
      'The event `insecure_transport` is a warning line, not a metric.',
      'metrics: none here, and metricName: not_this_one.',
    ].join('\n');
    expect(metricsNamedIn(text)).toEqual([]);
  });

  it('answers the names the registry does not hold', () => {
    const registry = createMetricsRegistry([HEARTBEAT]);
    const text = 'metric: worker_heartbeat_age_ms and metric: worker_heartbeat_age_seconds';
    expect(unregisteredMetricsIn(text, registry)).toEqual(['worker_heartbeat_age_seconds']);
    expect(unregisteredMetricsIn('metric: worker_heartbeat_age_ms', registry)).toEqual([]);
  });

  it('checks the threat model, monitoring.md and the ASVS checklist, whichever exist', () => {
    expect(METRIC_DOCUMENTS).toEqual([
      'docs/security/threat-model.md',
      'docs/self-hosting/monitoring.md',
      'docs/security/asvs-5.0.0-l2.csv',
    ]);
    for (const document of METRIC_DOCUMENTS) {
      const path = `${REPOSITORY_ROOT}${document}`;
      if (!existsSync(path)) {
        continue;
      }
      expect(unregisteredMetricsIn(readFileSync(path, 'utf8'), metrics), document).toEqual([]);
    }
  });
});
