/**
 * C250.7 (review H13; decision 72): metrics are registered pino events with a stable `metric` field,
 * a value and labels that are only an environment id and a queue.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createMetricsRegistry,
  METRIC_KINDS,
  METRIC_LABELS,
  METRIC_REGISTRY,
  METRIC_UNITS,
  metrics,
  type MetricDefinition,
} from './metrics-registry.js';

const IN_FLIGHT: MetricDefinition = {
  name: 'queue_in_flight',
  kind: 'gauge',
  unit: 'count',
  labels: ['environmentId', 'queue'],
  description: 'Jobs of one environment queued or running on one capped queue.',
  owner: 'quotas',
  contract: 'C251.4',
};

const STORE_DOWN: MetricDefinition = {
  name: 'rate_limiter_store_unavailable',
  kind: 'counter',
  unit: 'count',
  labels: [],
  description: 'A limiter call that found Valkey unreachable.',
  owner: 'auth-sessions',
  contract: 'C246.2',
};

const ENVIRONMENT = 'env_01HZZZZZZZZZZZZZZZZZZZZZZZ';

function recorder() {
  return { info: vi.fn<(object: Record<string, unknown>, message: string) => void>() };
}

describe('the metrics registry (C250.7)', () => {
  it('logs one event with the metric name, its value and its labels', () => {
    const registry = createMetricsRegistry([IN_FLIGHT, STORE_DOWN]);
    const logger = recorder();
    registry.emit(logger, 'queue_in_flight', 12, {
      environmentId: ENVIRONMENT,
      queue: 'report-run',
    });
    registry.emit(logger, 'rate_limiter_store_unavailable', 1);
    expect(logger.info.mock.calls).toEqual([
      [
        { metric: 'queue_in_flight', value: 12, environmentId: ENVIRONMENT, queue: 'report-run' },
        'metric',
      ],
      [{ metric: 'rate_limiter_store_unavailable', value: 1 }, 'metric'],
    ]);
  });

  it('answers each definition by name, and nothing for an unknown name', () => {
    const registry = createMetricsRegistry([IN_FLIGHT]);
    expect(registry.get('queue_in_flight')).toBe(IN_FLIGHT);
    expect(registry.get('queue_in_flght')).toBeUndefined();
    expect(registry.definitions).toEqual([IN_FLIGHT]);
  });

  it('refuses an unregistered name, a value that is not finite and labels other than declared', () => {
    const registry = createMetricsRegistry([IN_FLIGHT, STORE_DOWN]);
    const logger = recorder();
    const labels = { environmentId: ENVIRONMENT, queue: 'report-run' };
    expect(() => {
      registry.emit(logger, 'unknown_metric', 1);
    }).toThrow(TypeError);
    expect(() => {
      registry.emit(logger, 'queue_in_flight', Number.NaN, labels);
    }).toThrow(TypeError);
    expect(() => {
      registry.emit(logger, 'queue_in_flight', Infinity, labels);
    }).toThrow(TypeError);
    expect(() => {
      registry.emit(logger, 'queue_in_flight', 1, { queue: 'report-run' });
    }).toThrow(TypeError);
    expect(() => {
      registry.emit(logger, 'rate_limiter_store_unavailable', 1, { queue: 'report-run' });
    }).toThrow(TypeError);
    expect(() => {
      registry.emit(logger, 'queue_in_flight', 1, {
        ...labels,
        email: 'person@example.com',
      } as never);
    }).toThrow(TypeError);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('refuses a label value that is not an environment id or a queue name (never PII)', () => {
    const registry = createMetricsRegistry([IN_FLIGHT]);
    const logger = recorder();
    expect(() => {
      registry.emit(logger, 'queue_in_flight', 1, {
        environmentId: 'person@example.com',
        queue: 'report-run',
      });
    }).toThrow(TypeError);
    expect(() => {
      registry.emit(logger, 'queue_in_flight', 1, {
        environmentId: ENVIRONMENT,
        queue: '203.0.113.7',
      });
    }).toThrow(TypeError);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('refuses a definition that is not snake_case, repeats a name or names an unknown label', () => {
    expect(() => createMetricsRegistry([{ ...IN_FLIGHT, name: 'Queue-In-Flight' }])).toThrow(
      TypeError,
    );
    expect(() => createMetricsRegistry([IN_FLIGHT, IN_FLIGHT])).toThrow(TypeError);
    expect(() =>
      createMetricsRegistry([{ ...IN_FLIGHT, labels: ['environmentId', 'ip'] as never }]),
    ).toThrow(TypeError);
  });

  it("holds the install's metrics once each, in name order, each valid", () => {
    const names = METRIC_REGISTRY.map((definition) => definition.name);
    expect(names).toEqual([...new Set(names)].sort());
    for (const definition of METRIC_REGISTRY) {
      expect(METRIC_KINDS).toContain(definition.kind);
      expect(METRIC_UNITS).toContain(definition.unit);
      expect(definition.labels.every((label) => METRIC_LABELS.includes(label))).toBe(true);
      expect(definition.description.length).toBeGreaterThan(20);
    }
    expect(metrics.definitions).toBe(METRIC_REGISTRY);
  });
});
