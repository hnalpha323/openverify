/**
 * C250.7 (review H13; decision 72; Workflow 11B Stage 1b common, foundation-11b): metrics are
 * structured log events. The repository has no metrics system and none is added (a `/metrics`
 * endpoint is deferred, C286): every metric is a pino event with a stable `metric` field, a
 * numeric `value` and its labels, and every name is registered here with its kind, unit, labels
 * and owner. Labels are an environment id and a queue name only, never PII (rule 11). A test fails
 * when the threat model, the guide's `monitoring.md` or the ASVS checklist names a metric this
 * registry does not hold (11E).
 *
 * platform-ops owns this file after its first version; each 11B agent adds its own metric names as
 * a named borrowed edit, one entry each (rule 20).
 */

export const METRIC_KINDS = ['counter', 'gauge', 'histogram'] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export const METRIC_UNITS = ['count', 'seconds', 'milliseconds', 'bytes'] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

/** The only labels a metric may carry (C250.7: environment id and queue, never PII). */
export const METRIC_LABELS = ['environmentId', 'queue'] as const;
export type MetricLabel = (typeof METRIC_LABELS)[number];

/** One registered metric. */
export interface MetricDefinition {
  /** snake_case, stable: alerting rules match on it. */
  readonly name: string;
  readonly kind: MetricKind;
  readonly unit: MetricUnit;
  /** The labels every event of the metric carries, no more and no fewer. */
  readonly labels: readonly MetricLabel[];
  readonly description: string;
  /** The agent or area that emits it, for the monitoring guide. */
  readonly owner: string;
  /** The contract that names it (for example `C246.2`). */
  readonly contract: string;
}

/** Every metric, in name order. */
export const METRIC_REGISTRY: readonly MetricDefinition[] = [
  // dsar-export (borrowed edit, rule 20): the access export's refusals, per environment (C253).
  {
    name: 'account_export_refused_pending',
    kind: 'counter',
    unit: 'count',
    labels: ['environmentId'],
    description:
      'An account export refused with 409 account_export_pending: the account already had one being prepared.',
    owner: 'dsar-export',
    contract: 'C253.5',
  },
  {
    name: 'account_export_refused_rate_limited',
    kind: 'counter',
    unit: 'count',
    labels: ['environmentId'],
    description:
      'An account export refused with 429 by the account-export policy (10 an hour per environment).',
    owner: 'dsar-export',
    contract: 'C253.7',
  },
  {
    name: 'account_export_refused_too_large',
    kind: 'counter',
    unit: 'count',
    labels: ['environmentId'],
    description:
      'An account export refused with 422 account_export_too_large, or failed with that code by its job: more than 5,000 items.',
    owner: 'dsar-export',
    contract: 'C253.5',
  },
  {
    name: 'account_export_refused_unavailable',
    kind: 'counter',
    unit: 'count',
    labels: ['environmentId'],
    description:
      'An account export refused with 503 account_export_unavailable: the rate-limit store did not answer, so the policy failed closed.',
    owner: 'dsar-export',
    contract: 'C253.7',
  },
  // platform-ops (C250.7, Workflow 7A's C96.3): the handoff send budget fails closed when its store
  // does not answer, so the flow cannot send a handoff link by email or SMS.
  {
    name: 'handoff_send_budget_unavailable',
    kind: 'counter',
    unit: 'count',
    labels: ['environmentId'],
    description:
      'A handoff link send refused with 503 handoff_send_limited because the store behind the send budget or the SMS guards did not answer (the budget fails closed).',
    owner: 'platform-ops',
    contract: 'C96.3',
  },
  // platform-ops (C250.7, Workflow 7A's C92.2-C92.4): the network sources, install-wide.
  {
    name: 'network_sources_stale',
    kind: 'gauge',
    unit: 'count',
    labels: [],
    description:
      'Enabled public network sources whose snapshot is stale, never checked or not loaded, at each re-check of a process (every 60 s); their facts read list_stale or list_unavailable.',
    owner: 'platform-ops',
    contract: 'C92.4',
  },
  {
    name: 'network_sync_failed',
    kind: 'counter',
    unit: 'count',
    labels: [],
    description:
      'A network source sync that ended in an error or a refusal, recorded on the source and counted toward its back-off; the network sync finished line names the source and the code.',
    owner: 'platform-ops',
    contract: 'C92.2',
  },
  // quotas (borrowed edit, rule 20): the quota sweep's figures per environment and capped queue.
  {
    name: 'queue_admission_wait_ms',
    kind: 'gauge',
    unit: 'milliseconds',
    labels: ['environmentId', 'queue'],
    description:
      'The longest time a job the quota sweep admitted on its visit had been held by its environment cap.',
    owner: 'quotas',
    contract: 'C251.4',
  },
  {
    name: 'queue_at_cap_ms',
    kind: 'gauge',
    unit: 'milliseconds',
    labels: ['environmentId', 'queue'],
    description:
      'How long an environment with held work has sat at a queue cap, logged once with a warn line past five minutes.',
    owner: 'quotas',
    contract: 'C251.4',
  },
  {
    name: 'queue_in_flight',
    kind: 'gauge',
    unit: 'count',
    labels: ['environmentId', 'queue'],
    description:
      'Jobs of one environment queued or running on one capped queue, read at the quota sweep visit.',
    owner: 'quotas',
    contract: 'C251.4',
  },
  {
    name: 'queue_in_flight_cap',
    kind: 'gauge',
    unit: 'count',
    labels: ['environmentId', 'queue'],
    description:
      'The in-flight cap in force for one environment and capped queue, at most the install ceiling.',
    owner: 'quotas',
    contract: 'C251.4',
  },
  // auth-sessions (borrowed edit, rule 20)
  {
    name: 'rate_limiter_store_unavailable',
    kind: 'counter',
    unit: 'count',
    labels: [],
    description:
      'A rate-limit store (Valkey) did not answer: the login limiter refused with 503 login_unavailable, or another limit let the request through uncounted.',
    owner: 'auth-sessions',
    contract: 'C246.2',
  },
  // sso-oidc (borrowed edit, rule 20): SSO refusals, organisation-wide, so without a label.
  {
    name: 'sso_sign_in_refused',
    kind: 'counter',
    unit: 'count',
    labels: [],
    description:
      'An SSO start, callback or step-up refused (C248.7): the browser saw one generic problem, and the log line beside the event names the refusal code and the provider id.',
    owner: 'sso-oidc',
    contract: 'C248.7',
  },
  // platform-ops (C250.2, C250.7): the worker's liveness.
  {
    name: 'worker_heartbeat_age_ms',
    kind: 'gauge',
    unit: 'milliseconds',
    labels: [],
    description:
      'The age of the worker heartbeat each write replaces, normally the 10 s interval; a growing value is a stalling event loop, and the exec probe fails past 30 s.',
    owner: 'platform-ops',
    contract: 'C250.2',
  },
];

/** The part of a pino logger an emission needs. */
export interface MetricLogger {
  info(object: Record<string, unknown>, message: string): void;
}

export type MetricLabelValues = Partial<Readonly<Record<MetricLabel, string>>>;

/** The registered metrics and the one way to emit them. */
export interface MetricsRegistry {
  readonly definitions: readonly MetricDefinition[];
  /** The definition of `name`, or `undefined` when it is not registered. */
  get(name: string): MetricDefinition | undefined;
  /**
   * Logs one event `{metric, value, ...labels}` at `info`.
   * @throws {TypeError} for an unregistered name, a value that is not a finite number, or labels
   * other than the definition's (a programming error the tests catch, never a data error).
   */
  emit(logger: MetricLogger, name: string, value: number, labels?: MetricLabelValues): void;
}

/**
 * A registry over `definitions`.
 * @throws {TypeError} for a name that is not snake_case, a repeated name or an unknown label.
 */
export function createMetricsRegistry(definitions: readonly MetricDefinition[]): MetricsRegistry {
  const byName = new Map<string, MetricDefinition>();
  for (const definition of definitions) {
    if (!METRIC_NAME.test(definition.name)) {
      throw new TypeError(`Metric ${definition.name} is not snake_case`);
    }
    if (byName.has(definition.name)) {
      throw new TypeError(`Metric ${definition.name} is registered twice`);
    }
    for (const label of definition.labels) {
      if (!(METRIC_LABELS as readonly string[]).includes(label)) {
        throw new TypeError(
          `Metric ${definition.name} names a label outside ${METRIC_LABELS.join(', ')}`,
        );
      }
    }
    byName.set(definition.name, definition);
  }
  return {
    definitions,
    get: (name) => byName.get(name),
    emit(logger, name, value, labels = {}) {
      const definition = byName.get(name);
      if (definition === undefined) {
        throw new TypeError(`Metric ${name} is not registered in metrics-registry.ts`);
      }
      if (!Number.isFinite(value)) {
        throw new TypeError(`Metric ${name} takes a finite number`);
      }
      const given = Object.keys(labels).sort();
      const declared = [...definition.labels].sort();
      if (given.join(',') !== declared.join(',')) {
        throw new TypeError(`Metric ${name} takes the labels ${declared.join(', ') || 'none'}`);
      }
      for (const label of definition.labels) {
        if (!LABEL_VALUE[label].test(labels[label] ?? '')) {
          throw new TypeError(`Metric ${name}: the ${label} label is not an ${label} value`);
        }
      }
      logger.info({ metric: name, value, ...labels }, 'metric');
    },
  };
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const METRIC_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** What each label may hold: an environment id and a queue name, never PII (rule 11). */
const LABEL_VALUE: Readonly<Record<MetricLabel, RegExp>> = {
  environmentId: /^env_[0-9A-HJKMNP-TV-Z]{26}$/,
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  queue: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
};

/** The registry of this install's metrics. */
export const metrics: MetricsRegistry = createMetricsRegistry(METRIC_REGISTRY);
