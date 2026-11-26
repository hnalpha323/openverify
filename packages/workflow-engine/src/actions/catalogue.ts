/**
 * The catalogue of C122.2 as data: one entry per action, each pairing the contract of `contracts.ts`
 * with its grant, delivery, flags and the events it can cause. The implementations are
 * `apps/api/src/workflows/actions/`'s, keyed by `key@version`.
 *
 * A grant holds API scopes only (C121.2). What a step's rendered values carry off the platform is
 * C115.6's taint, computed at publish over the whole graph, so an egress entry's own `pii` is false
 * and publish sets it; a child run's grant is the target's, added at publish (C121.3).
 *
 * A generic action's scope comes from the object-type table, so the entries are built from a table:
 * Workflow 8B passes its case row to {@link createWorkflowActionEntries} and edits nothing here.
 */
import type { ApiScope } from '@openverify/core';
import { EVENT_NAMES, REPORT_EVENT_NAMES, type EventName } from '@openverify/contracts';
import { z } from 'zod';
import { WORKFLOW_ACTION_CONTRACTS, type ActionContract } from './contracts.js';
import {
  ActionRegistryError,
  type ActionAdapter,
  type ActionAdverseRule,
  type ActionGrant,
  type ActionObjectTypeEntry,
  type ActionObjectTypeTable,
  type ActionRegistryEntry,
  type ActionRequirement,
  type ActionRetry,
  type AnyActionRegistryEntry,
} from './registry.js';

type ConfigOf = Readonly<Record<string, unknown>>;

const NO_RETRY: ActionRetry = Object.freeze({ allowed: false, defaultIntervalsSeconds: [] });
/** C117.6: the step's own `retry` decides; with none, there is no retry. */
const STEP_RETRY: ActionRetry = Object.freeze({ allowed: true, defaultIntervalsSeconds: [] });

interface Row {
  readonly kind: ActionRegistryEntry['kind'];
  readonly grant: (config: ConfigOf) => ActionGrant;
  readonly grantDependsOnConfig?: boolean;
  readonly emits?: readonly EventName[];
  readonly delivery: ActionRegistryEntry['delivery'];
  readonly retry?: ActionRetry;
  readonly availability?: ActionAdapter;
  readonly requires?: readonly ActionRequirement[];
  readonly adverse?: ActionRegistryEntry['adverse'];
  readonly adverseRule?: ActionAdverseRule;
  readonly biometric?: boolean;
  readonly irreversible?: boolean;
  readonly causeChecked?: boolean;
  readonly stage?: ActionRegistryEntry['stage'];
  /** Narrows the contract's config by the object-type table. */
  readonly config?: z.ZodType;
}

const scopes =
  (...names: readonly ApiScope[]) =>
  (): ActionGrant => ({
    scopes: names,
    pii: false,
  });
const withPii =
  (...names: readonly ApiScope[]) =>
  (): ActionGrant => ({
    scopes: names,
    pii: true,
  });

const DECISION_EVENTS = (status: EventName): readonly EventName[] => [
  status,
  'inquiry.transitioned',
];

/** C118.8: a report's terminal events, of every type, because the template picks the type. */
const REPORT_TERMINAL_EVENTS: readonly EventName[] = REPORT_EVENT_NAMES.filter(
  (name) => name.endsWith('.ready') || name.endsWith('.errored'),
);
const TAG_EVENTS: readonly EventName[] = EVENT_NAMES.filter((name) =>
  name.endsWith('.updated-tags'),
);

/** Built here, so a config with a type the table does not hold never reaches a grant. */
function objectTypeRefinement(
  table: ActionObjectTypeTable,
  allowed: (entry: ActionObjectTypeEntry) => boolean,
  member = 'object-type',
) {
  return (config: unknown): boolean => {
    const type = (config as ConfigOf)[member];
    const entry = typeof type === 'string' ? table.get(type) : undefined;
    return entry !== undefined && allowed(entry);
  };
}

function scopeOf(
  table: ActionObjectTypeTable,
  config: ConfigOf,
  member: string,
  read: (entry: ActionObjectTypeEntry) => ApiScope | null,
): ApiScope {
  const type = config[member];
  const entry = typeof type === 'string' ? table.get(type) : undefined;
  const scope = entry === undefined ? null : read(entry);
  if (scope === null) {
    throw new ActionRegistryError(`No run may do this to ${String(type)}`);
  }
  return scope;
}

function rowsFor(table: ActionObjectTypeTable): Readonly<Record<string, Row>> {
  const write = (entry: ActionObjectTypeEntry) => entry.writeScope;
  const taggable = (entry: ActionObjectTypeEntry) => entry.tags && entry.writeScope !== null;
  const writes = (config: ConfigOf): ActionGrant => ({
    scopes: [scopeOf(table, config, 'object-type', write)],
    pii: false,
  });
  const narrowed = (
    key: keyof typeof WORKFLOW_ACTION_CONTRACTS,
    rule: (config: unknown) => boolean,
  ) =>
    (WORKFLOW_ACTION_CONTRACTS[key].config as z.ZodType).refine(
      rule,
      'an object type this action can reach',
    );
  return {
    approve_inquiry: {
      kind: 'internal',
      grant: scopes('inquiries:write'),
      emits: DECISION_EVENTS('inquiry.approved'),
      delivery: 'exactly-once',
      causeChecked: true,
    },
    decline_inquiry: {
      kind: 'internal',
      grant: scopes('inquiries:write'),
      emits: DECISION_EVENTS('inquiry.declined'),
      delivery: 'exactly-once',
      adverse: 'always',
      causeChecked: true,
    },
    mark_inquiry_for_review: {
      kind: 'internal',
      grant: scopes('inquiries:write'),
      emits: DECISION_EVENTS('inquiry.marked-for-review'),
      delivery: 'exactly-once',
    },
    create_inquiry: {
      kind: 'internal',
      grant: (config) => ({
        scopes:
          config['account-id'] === undefined
            ? ['inquiries:write']
            : ['inquiries:write', 'accounts:read'],
        pii: false,
      }),
      grantDependsOnConfig: true,
      emits: ['inquiry.created'],
      delivery: 'exactly-once',
    },
    send_inquiry_link_email: {
      kind: 'egress',
      grant: scopes('inquiries:write', 'inquiry-sessions:write'),
      delivery: 'at-most-once',
      retry: STEP_RETRY,
      availability: 'mailer',
    },
    send_inquiry_link_sms: {
      kind: 'egress',
      grant: scopes('inquiries:write', 'inquiry-sessions:write'),
      delivery: 'at-most-once',
      retry: STEP_RETRY,
      availability: 'sms',
    },
    run_report: {
      kind: 'internal',
      // Phase 6 decision 39: a report needs the read scope of what it links.
      grant: (config) => ({
        scopes: [
          'reports:write',
          ...(config['inquiry-id'] === undefined ? [] : (['inquiries:read'] as const)),
          ...(config['account-id'] === undefined ? [] : (['accounts:read'] as const)),
        ],
        pii: false,
      }),
      grantDependsOnConfig: true,
      emits: REPORT_TERMINAL_EVENTS,
      delivery: 'exactly-once',
      stage: 'beta',
    },
    rerun_report: {
      kind: 'internal',
      grant: scopes('reports:write'),
      emits: REPORT_TERMINAL_EVENTS,
      delivery: 'exactly-once',
    },
    // K8-7: it reads the account (Phase 6 decision 39) and makes reports linked to it.
    rescreen_account_reports: {
      kind: 'internal',
      grant: scopes('reports:write', 'accounts:read'),
      emits: REPORT_TERMINAL_EVENTS,
      delivery: 'exactly-once',
    },
    run_verification: {
      kind: 'internal',
      grant: scopes('inquiries:write'),
      emits: ['verification.created', 'verification.passed', 'verification.failed'],
      delivery: 'exactly-once',
    },
    get_list_match: {
      kind: 'internal',
      grant: withPii('lists:read'),
      delivery: 'pure',
      stage: 'beta',
    },
    add_list_item: {
      kind: 'internal',
      grant: withPii('lists:write'),
      emits: ['list.updated'],
      delivery: 'exactly-once',
      adverse: 'by-config',
      adverseRule: 'list-purpose',
      causeChecked: true,
    },
    add_face_list_item: {
      kind: 'internal',
      grant: withPii('lists:write'),
      emits: ['list.updated'],
      delivery: 'exactly-once',
      requires: ['inquiry-in-scope', 'not-in-loop'],
      adverse: 'by-config',
      adverseRule: 'list-purpose',
      biometric: true,
      causeChecked: true,
    },
    run_graph_query: {
      kind: 'internal',
      // C122.2: `pii` for a PII-kind parameter. The kinds are the template's, so a step that cannot
      // say fails closed; publish may read the template and say more.
      grant: withPii('graph:write'),
      emits: ['graph-query.submitted', 'graph-query.completed', 'graph-query.errored'],
      delivery: 'exactly-once',
    },
    // C127.5: a claimed step that polls, so it is no control node (C117.3) and changes nothing.
    sync_graph: { kind: 'internal', grant: scopes('graph:read'), delivery: 'pure' },
    find_or_create_account: {
      kind: 'internal',
      grant: scopes('accounts:write'),
      emits: ['account.created'],
      delivery: 'exactly-once',
    },
    create_transaction: {
      kind: 'internal',
      grant: scopes('transactions:write'),
      emits: ['transaction.created'],
      delivery: 'exactly-once',
    },
    update_transaction_status: {
      kind: 'internal',
      grant: scopes('transactions:write'),
      emits: ['transaction.status-updated'],
      delivery: 'exactly-once',
      adverse: 'by-config',
      adverseRule: 'transaction-adverse-status',
      causeChecked: true,
    },
    set_relation: {
      kind: 'internal',
      grant: writes,
      grantDependsOnConfig: true,
      emits: ['transaction.added-relation'],
      delivery: 'exactly-once',
    },
    unset_relation: {
      kind: 'internal',
      grant: writes,
      grantDependsOnConfig: true,
      emits: ['transaction.removed-relation'],
      delivery: 'exactly-once',
    },
    trust_device: { kind: 'internal', grant: scopes('devices:write'), delivery: 'exactly-once' },
    tag_object: {
      kind: 'internal',
      grant: writes,
      grantDependsOnConfig: true,
      emits: TAG_EVENTS,
      delivery: 'exactly-once',
      config: narrowed('tag_object', objectTypeRefinement(table, taggable)),
    },
    remove_tag: {
      kind: 'internal',
      grant: writes,
      grantDependsOnConfig: true,
      emits: TAG_EVENTS,
      delivery: 'exactly-once',
      config: narrowed('remove_tag', objectTypeRefinement(table, taggable)),
    },
    copy_tags: {
      kind: 'internal',
      grant: (config) => ({
        scopes: [
          scopeOf(table, config, 'from-object-type', ({ readScope }) => readScope),
          scopeOf(table, config, 'object-type', write),
        ],
        pii: false,
      }),
      grantDependsOnConfig: true,
      emits: TAG_EVENTS,
      delivery: 'exactly-once',
      config: narrowed(
        'copy_tags',
        (config) =>
          objectTypeRefinement(table, taggable)(config) &&
          objectTypeRefinement(table, ({ tags }) => tags, 'from-object-type')(config),
      ),
    },
    fetch_object: {
      kind: 'internal',
      grant: (config) => ({
        scopes: [scopeOf(table, config, 'object-type', ({ readScope }) => readScope)],
        pii: true,
      }),
      grantDependsOnConfig: true,
      delivery: 'pure',
      config: narrowed(
        'fetch_object',
        objectTypeRefinement(table, () => true),
      ),
    },
    update_object: {
      kind: 'internal',
      grant: writes,
      grantDependsOnConfig: true,
      emits: [
        ...TAG_EVENTS,
        'account.archived',
        'account.updated-fields',
        'transaction.updated-fields',
      ],
      delivery: 'exactly-once',
      adverse: 'by-config',
      adverseRule: 'account-archive',
      causeChecked: true,
      config: narrowed(
        'update_object',
        objectTypeRefinement(table, ({ writeScope }) => writeScope !== null),
      ),
    },
    redact_object: {
      kind: 'internal',
      grant: (config) => ({
        scopes: [scopeOf(table, config, 'object-type', ({ redactScope }) => redactScope)],
        pii: false,
      }),
      grantDependsOnConfig: true,
      emits: ['inquiry.redacted', 'account.redacted', 'transaction.redacted'],
      delivery: 'exactly-once',
      irreversible: true,
      causeChecked: true,
      config: narrowed(
        'redact_object',
        objectTypeRefinement(table, ({ redactScope }) => redactScope !== null),
      ),
    },
    evaluate_code: {
      kind: 'compute',
      grant: scopes(),
      delivery: 'pure',
      retry: STEP_RETRY,
      availability: 'code-runner',
    },
    calculate: { kind: 'control', grant: scopes(), delivery: 'control' },
    update_variable: { kind: 'control', grant: scopes(), delivery: 'control' },
    run_workflow: {
      kind: 'internal',
      grant: scopes('workflows:trigger'),
      emits: ['workflow-run.created'],
      delivery: 'exactly-once',
    },
    schedule_workflow: {
      kind: 'internal',
      grant: scopes('workflows:trigger'),
      delivery: 'exactly-once',
    },
    make_https_request: {
      kind: 'egress',
      grant: scopes(),
      delivery: 'at-least-once',
      retry: STEP_RETRY,
    },
    send_email: {
      kind: 'egress',
      grant: scopes(),
      delivery: 'at-most-once',
      retry: STEP_RETRY,
      availability: 'mailer',
    },
    send_sms: {
      kind: 'egress',
      grant: scopes(),
      delivery: 'at-most-once',
      retry: STEP_RETRY,
      availability: 'sms',
    },
    send_slack_message: {
      kind: 'egress',
      grant: scopes(),
      delivery: 'at-most-once',
      retry: STEP_RETRY,
      availability: 'slack',
    },
  };
}

/**
 * C122.2: every entry of the catalogue, its generic actions held to `table`.
 * @throws {ActionRegistryError} from a grant, for a config the table does not admit.
 */
export function createWorkflowActionEntries(
  table: ActionObjectTypeTable,
): readonly AnyActionRegistryEntry[] {
  const rows = rowsFor(table);
  return Object.freeze(
    Object.entries(WORKFLOW_ACTION_CONTRACTS as Readonly<Record<string, ActionContract>>).map(
      ([key, contract]): AnyActionRegistryEntry => {
        const row = rows[key];
        if (row === undefined) {
          throw new ActionRegistryError(`The action ${key} has no catalogue row`);
        }
        const entry: ActionRegistryEntry<ConfigOf> = {
          key,
          version: 1,
          kind: row.kind,
          config: (row.config ?? contract.config) as z.ZodType<ConfigOf>,
          output: contract.output,
          grant: row.grant,
          grantDependsOnConfig: row.grantDependsOnConfig ?? false,
          emits: row.emits ?? [],
          delivery: row.delivery,
          retry: row.retry ?? NO_RETRY,
          availability: row.availability ?? 'none',
          triggers: null,
          requires: row.requires ?? [],
          adverse: row.adverse ?? 'never',
          adverseRule: row.adverseRule ?? null,
          biometric: row.biometric ?? false,
          irreversible: row.irreversible ?? false,
          causeChecked: row.causeChecked ?? false,
          stage: row.stage ?? 'ga',
        };
        return entry as unknown as AnyActionRegistryEntry;
      },
    ),
  );
}
