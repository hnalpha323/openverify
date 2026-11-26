/**
 * The action registry contract (plan C122.1). One entry per action version, mirroring the check
 * registry: `key` and `version`, what it touches, its config and output schemas, the grant it needs,
 * the events it can cause, its delivery guarantee, whether it is adverse, its stage. The entries are
 * `apps/api/src/workflows/actions/`'s; this file holds their type, the keys, and the tables the
 * generic actions dispatch through.
 *
 * An output member is marked PII or not, in so many words, because C120.6 masks fail closed by these
 * marks: {@link createActionRegistry} refuses an output with an unmarked member, so a new action
 * cannot leak by omission, and the marks are what a run's reader sees without PII visibility.
 *
 * The tables are data, so Workflow 8B adds cases in its own files (F33, C140.7): it passes its
 * entries to {@link createActionRegistry} and {@link createActionObjectTypeTable} beside these, and
 * edits nothing here. Its eight keys are reserved below.
 */
import {
  ACTION_ADVERSE,
  ACTION_DELIVERIES,
  ACTION_KINDS,
  ACTION_STAGES,
  REPORT_REGISTRY,
  REPORT_TYPES,
  WORKFLOW_DEFINITION_LIMITS,
  type ActionAdverse,
  type ActionDelivery,
  type ActionKind,
  type ActionStage,
  type ApiScope,
  type ReportReviewModel,
  type ReportType,
  type VerificationType,
  type WorkflowTriggerType,
} from '@openverify/core';
import type { EventName } from '@openverify/contracts';
import { z } from 'zod';

export { ACTION_ADVERSE, ACTION_DELIVERIES, ACTION_KINDS, ACTION_STAGES };

/** C122.2: every 8A action, in the catalogue's order. */
export const WORKFLOW_ACTION_KEYS = [
  'approve_inquiry',
  'decline_inquiry',
  'mark_inquiry_for_review',
  'create_inquiry',
  'send_inquiry_link_email',
  'send_inquiry_link_sms',
  'run_report',
  'rerun_report',
  // Workflow 8D (K8-7): the re-screen recipe's own step.
  'rescreen_account_reports',
  'run_verification',
  'get_list_match',
  'add_list_item',
  'add_face_list_item',
  'run_graph_query',
  'sync_graph',
  'find_or_create_account',
  'create_transaction',
  'update_transaction_status',
  'set_relation',
  'unset_relation',
  'trust_device',
  'tag_object',
  'remove_tag',
  'copy_tags',
  'fetch_object',
  'update_object',
  'redact_object',
  'evaluate_code',
  'calculate',
  'update_variable',
  'run_workflow',
  'schedule_workflow',
  'make_https_request',
  'send_email',
  'send_sms',
  'send_slack_message',
] as const;
export type WorkflowActionKey = (typeof WORKFLOW_ACTION_KEYS)[number];

/** C122.2, F33: Workflow 8B's actions, reserved so no 8A key takes one. */
export const RESERVED_CASE_ACTION_KEYS = [
  'create_case',
  'assign_case',
  'update_case_status',
  'add_case_comment',
  'add_case_to_queue',
  'attach_objects_to_case',
  'set_case_sla',
  'clear_case_sla',
] as const;
export type CaseActionKey = (typeof RESERVED_CASE_ACTION_KEYS)[number];

/**
 * C243.1 (Phase 11, Workflow 11A Stage 1a (U); the 8B precedent, F33): Connect's actions, reserved
 * so no other key takes one. Their configs and outputs are `CONNECT_ACTION_CONTRACTS` (`connect.ts`);
 * `workflow-connect` passes their entries to `createActionRegistry` from its own files
 * (`apps/api/src/workflows/actions/connect/`). Until then the API's registry holds none of them and
 * publish answers `action_unknown`: they fail closed. Activating a connection and creating or
 * withdrawing a consent record are not actions (C243.3).
 */
export const RESERVED_CONNECT_ACTION_KEYS = [
  'create_share_token',
  'redeem_share_token',
  'expire_share_token',
] as const;
export type ConnectActionKey = (typeof RESERVED_CONNECT_ACTION_KEYS)[number];

/** Every key the catalogue holds once Workflow 8B's and Workflow 11A's entries are passed in. */
export const ACTION_KEYS = [
  ...WORKFLOW_ACTION_KEYS,
  ...RESERVED_CASE_ACTION_KEYS,
  ...RESERVED_CONNECT_ACTION_KEYS,
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];
export const actionKeySchema = z.enum(ACTION_KEYS);

/** C122.1: the generic actions, which dispatch through the object-type table. */
export const GENERIC_ACTION_KEYS = [
  'tag_object',
  'remove_tag',
  'copy_tags',
  'fetch_object',
  'update_object',
  'redact_object',
] as const satisfies readonly WorkflowActionKey[];
export type GenericActionKey = (typeof GENERIC_ACTION_KEYS)[number];

/** C122.5: the adapter an action needs; unbound, it is listed `available: false`. */
export const ACTION_ADAPTERS = ['none', 'mailer', 'sms', 'slack', 'code-runner'] as const;
export type ActionAdapter = (typeof ACTION_ADAPTERS)[number];

/**
 * C122.3: what must hold before a step, beyond its trigger type. The graph check refuses a misplaced
 * step: `inquiry-in-scope` needs an inquiry event, or an earlier `create_inquiry` or `fetch_object`
 * of an inquiry (public WA20); `not-in-loop` refuses the step inside a loop (C127.4).
 */
export const ACTION_REQUIREMENTS = ['inquiry-in-scope', 'not-in-loop'] as const;
export type ActionRequirement = (typeof ACTION_REQUIREMENTS)[number];

/**
 * C122.1: what makes a `by-config` action adverse, decided from data the config names: the target
 * list's `purpose`, the transaction type's `adverse-statuses`, or an account being archived.
 */
export const ACTION_ADVERSE_RULES = [
  'list-purpose',
  'transaction-adverse-status',
  'account-archive',
] as const;
export type ActionAdverseRule = (typeof ACTION_ADVERSE_RULES)[number];

/** C121.2: API scopes only; operator permissions are publish-time requirements, never a grant. */
export interface ActionGrant {
  readonly scopes: readonly ApiScope[];
  readonly pii: boolean;
}

/** C117.6: whether a step may retry, and what it does with no `retry` of its own. */
export interface ActionRetry {
  readonly allowed: boolean;
  readonly defaultIntervalsSeconds: readonly number[];
}

/** C122.1: one action version. */
export interface ActionRegistryEntry<Config = unknown, Output = unknown> {
  /** snake_case; the public product documents only `run_report`, so the rest are ours. */
  readonly key: string;
  /** A change to `config` or `output` is a new version, and old ones stay while any reference them. */
  readonly version: number;
  readonly kind: ActionKind;
  /** The action's own strict schema. */
  readonly config: z.ZodType<Config>;
  /** Every top-level member marked `.meta({ pii: true | false })`. */
  readonly output: z.ZodType<Output>;
  readonly grant: (config: Config) => ActionGrant;
  /** Whether `grant` reads the config, so the catalogue can say so. */
  readonly grantDependsOnConfig: boolean;
  /** C118.8: the events it can cause, for the warning that a graph emits its own trigger. */
  readonly emits: readonly EventName[];
  readonly delivery: ActionDelivery;
  readonly retry: ActionRetry;
  readonly availability: ActionAdapter;
  /**
   * C122.3: the trigger types it serves. `null` serves every one but `trigger-flow`, which an
   * action serves only when it lists it (C152.2, Workflow 9A Stage 1a amendment 3;
   * `actionServesTrigger` of `@openverify/core`).
   */
  readonly triggers: readonly WorkflowTriggerType[] | null;
  readonly requires: readonly ActionRequirement[];
  /** C122.1 (P42, V10; decision 80). */
  readonly adverse: ActionAdverse;
  /** Set exactly when `adverse` is `by-config`. */
  readonly adverseRule: ActionAdverseRule | null;
  /** C128.4: adverse and biometric whatever the path reads. */
  readonly biometric: boolean;
  /** C116.4: needs `irreversible:<step id>`. */
  readonly irreversible: boolean;
  /** C121.3: a causing principal must hold this step's scope. */
  readonly causeChecked: boolean;
  /** `beta` where the output carries H-tier results (H10). */
  readonly stage: ActionStage;
}

/** An entry of any action, as a registry holds it. */
export type AnyActionRegistryEntry = ActionRegistryEntry<never>;

/** Read-only, so a run can never change what a step means. */
export interface ActionRegistry {
  /** One version, or `undefined`, which publish answers with a `definition_invalid`. */
  get(key: string, version: number): AnyActionRegistryEntry | undefined;
  /** The newest version of a key, what the editor offers. */
  latest(key: string): AnyActionRegistryEntry | undefined;
  /** Every version of every action, by key then version. */
  list(): readonly AnyActionRegistryEntry[];
}

/** Why an entry or a table was refused: a bug in code, so it throws at start. */
export class ActionRegistryError extends Error {
  override readonly name = 'ActionRegistryError';
}

type MarkedOutput = Readonly<Record<string, boolean>>;

interface WithOptions {
  readonly options: readonly unknown[];
}

const hasOptions = (schema: unknown): schema is WithOptions =>
  typeof schema === 'object' &&
  schema !== null &&
  Array.isArray((schema as Partial<WithOptions>).options);

/** The objects an output is: itself, or each variant of its union. */
function outputObjects(schema: unknown): z.ZodObject[] {
  if (schema instanceof z.ZodObject) {
    return [schema];
  }
  return hasOptions(schema) ? schema.options.flatMap(outputObjects) : [];
}

/**
 * C120.6: the PII mark of each top-level output member.
 * @throws {ActionRegistryError} for an output that is no object, or a member with no mark.
 */
export function actionOutputMarks(key: string, output: z.ZodType): MarkedOutput {
  const objects = outputObjects(output);
  if (objects.length === 0) {
    throw new ActionRegistryError(`The output of ${key} is not an object`);
  }
  const marks: Record<string, boolean> = {};
  for (const object of objects) {
    for (const [member, schema] of Object.entries<z.ZodType>(object.shape)) {
      const pii = (schema.meta() as { pii?: unknown } | undefined)?.pii;
      if (typeof pii !== 'boolean') {
        throw new ActionRegistryError(`The output member ${member} of ${key} has no PII mark`);
      }
      // A member PII in one variant is PII in all, which is the side that fails closed.
      marks[member] = pii || marks[member] === true;
    }
  }
  return Object.freeze(marks);
}

const ACTION_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** C113.2: a step's own intervals and an action's default share these caps. */
const retryFits = ({ allowed, defaultIntervalsSeconds: intervals }: ActionRetry): boolean =>
  (allowed || intervals.length === 0) &&
  intervals.length <= WORKFLOW_DEFINITION_LIMITS['retry-intervals'].value &&
  intervals.every(
    (seconds) =>
      Number.isInteger(seconds) &&
      seconds >= 1 &&
      seconds <= WORKFLOW_DEFINITION_LIMITS['retry-interval-seconds'].value,
  );

function refuseEntry(entry: AnyActionRegistryEntry): string | null {
  if (!ACTION_KEY.test(entry.key)) {
    return 'its key is not snake_case';
  }
  if (!Number.isInteger(entry.version) || entry.version < 1) {
    return 'its version is not a positive integer';
  }
  if ((entry.adverse === 'by-config') !== (entry.adverseRule !== null)) {
    return 'a by-config action names its rule, and no other does';
  }
  if (entry.biometric && entry.adverse === 'never') {
    return 'a biometric action is adverse';
  }
  if (entry.kind === 'egress' && entry.delivery === 'exactly-once') {
    return 'nothing that leaves the platform is exactly once';
  }
  if (!retryFits(entry.retry)) {
    return 'its retry is outside the caps';
  }
  return null;
}

const versionKey = (key: string, version: number): string => `${key}@${String(version)}`;

/**
 * C122.1: a registry of `entries`.
 * @throws {ActionRegistryError} for an entry the contract refuses, or a key and version given twice.
 */
export function createActionRegistry(entries: readonly AnyActionRegistryEntry[]): ActionRegistry {
  const byVersion = new Map<string, AnyActionRegistryEntry>();
  const latest = new Map<string, AnyActionRegistryEntry>();
  for (const entry of entries) {
    const id = versionKey(entry.key, entry.version);
    const refusal = refuseEntry(entry);
    if (refusal !== null) {
      throw new ActionRegistryError(`${id}: ${refusal}`);
    }
    if (byVersion.has(id)) {
      throw new ActionRegistryError(`${id} is registered twice`);
    }
    actionOutputMarks(entry.key, entry.output);
    byVersion.set(id, entry);
    const newest = latest.get(entry.key);
    if (newest === undefined || newest.version < entry.version) {
      latest.set(entry.key, entry);
    }
  }
  const listed = Object.freeze(
    [...byVersion.values()].sort(
      (left, right) => left.key.localeCompare(right.key) || left.version - right.version,
    ),
  );
  const registry: ActionRegistry = {
    get: (key, version) => byVersion.get(versionKey(key, version)),
    latest: (key) => latest.get(key),
    list: () => listed,
  };
  return Object.freeze(registry);
}

// ---------------------------------------------------------------------------------------------
// The per-type tables (C122.1, F33)

/** C122.1: the object types 8A fills. Workflow 8B adds `case` in its own files. */
export const ACTION_OBJECT_TYPES = [
  'inquiry',
  'account',
  'report',
  'transaction',
  'verification',
] as const;
export type ActionObjectType = (typeof ACTION_OBJECT_TYPES)[number];

/** One object type of the generic actions: what each may do to it, and under which scope. */
export interface ActionObjectTypeEntry {
  /** `case` is Workflow 8B's, so this is a string rather than {@link ActionObjectType}. */
  readonly type: string;
  /** The ids of this type, without the underscore. */
  readonly idPrefix: string;
  readonly readScope: ApiScope;
  /** `null`: no run writes it. */
  readonly writeScope: ApiScope | null;
  /** `null`: no run redacts it by itself. */
  readonly redactScope: ApiScope | null;
  /** Verifications hold no tags. */
  readonly tags: boolean;
  /** C127.8: what `update_object` may set, beyond custom fields and tags. */
  readonly writableAttributes: readonly string[];
}

/** C122.1: 8A's rows. A report's and a verification's fields are their own and never set here. */
export const ACTION_OBJECT_TYPE_ENTRIES: readonly ActionObjectTypeEntry[] = Object.freeze([
  {
    type: 'inquiry',
    idPrefix: 'inq',
    readScope: 'inquiries:read',
    writeScope: 'inquiries:write',
    redactScope: 'inquiries:redact',
    tags: true,
    writableAttributes: ['fields', 'reference-id', 'note'],
  },
  {
    type: 'account',
    idPrefix: 'acc',
    readScope: 'accounts:read',
    writeScope: 'accounts:write',
    redactScope: 'accounts:redact',
    tags: true,
    writableAttributes: ['fields', 'reference-id', 'status'],
  },
  {
    type: 'report',
    idPrefix: 'rep',
    readScope: 'reports:read',
    writeScope: 'reports:write',
    redactScope: 'reports:redact',
    tags: true,
    writableAttributes: [],
  },
  {
    type: 'transaction',
    idPrefix: 'txn',
    readScope: 'transactions:read',
    writeScope: 'transactions:write',
    redactScope: 'transactions:redact',
    tags: true,
    writableAttributes: ['fields', 'reference-id', 'status'],
  },
  {
    type: 'verification',
    idPrefix: 'ver',
    readScope: 'verifications:read',
    writeScope: null,
    redactScope: null,
    tags: false,
    writableAttributes: [],
  },
] as const satisfies readonly ActionObjectTypeEntry[]);

/** Read-only, as a registry is. */
export interface ActionObjectTypeTable {
  get(type: string): ActionObjectTypeEntry | undefined;
  /** The type of an object id, by its prefix: how `tag_object` reads a path to an id. */
  ofId(id: string): ActionObjectTypeEntry | undefined;
  list(): readonly ActionObjectTypeEntry[];
}

/**
 * A table of `entries`; 8B passes its case row beside {@link ACTION_OBJECT_TYPE_ENTRIES}.
 * @throws {ActionRegistryError} for a type or a prefix given twice.
 */
export function createActionObjectTypeTable(
  entries: readonly ActionObjectTypeEntry[],
): ActionObjectTypeTable {
  const byType = new Map<string, ActionObjectTypeEntry>();
  const byPrefix = new Map<string, ActionObjectTypeEntry>();
  for (const entry of entries) {
    if (byType.has(entry.type) || byPrefix.has(entry.idPrefix)) {
      throw new ActionRegistryError(`The object type ${entry.type} is registered twice`);
    }
    byType.set(entry.type, entry);
    byPrefix.set(entry.idPrefix, entry);
  }
  const listed = Object.freeze([...entries]);
  const table: ActionObjectTypeTable = {
    get: (type) => byType.get(type),
    ofId: (id) => byPrefix.get(id.slice(0, Math.max(id.indexOf('_'), 0))),
    list: () => listed,
  };
  return Object.freeze(table);
}

/** One report type as `run_report` reads it (C127.2, outcomes 14 and 15). */
export interface ActionReportTypeEntry {
  readonly type: ReportType;
  readonly review: ReportReviewModel;
  /** `has-match` means something here; on the others, reading it is refused at publish. */
  readonly hasMatch: boolean;
  /** The type's own result where `has-match` means nothing, such as `ip-address`'s `flagged`. */
  readonly flag: string | null;
  /** Its output can carry H-tier results, so a decision on it needs `heuristic:<step id>`. */
  readonly heuristic: boolean;
}

/** The types whose answer is a flag of their own. A test holds it to every `none` type. */
const REPORT_FLAGS: Readonly<Partial<Record<ReportType, string>>> = Object.freeze({
  'ip-address': 'flagged',
});

/** C127.2: one row per report type, walked from `REPORT_TYPES`, so a new type joins by itself. */
export const ACTION_REPORT_TYPE_TABLE: Readonly<Record<ReportType, ActionReportTypeEntry>> =
  Object.freeze(
    Object.fromEntries(
      REPORT_TYPES.map((type) => {
        const definition = REPORT_REGISTRY[type];
        return [
          type,
          Object.freeze({
            type,
            review: definition.review,
            hasMatch: definition.review === 'matches',
            flag: REPORT_FLAGS[type] ?? null,
            heuristic: definition.tiers.includes('H'),
          }),
        ];
      }),
    ) as Record<ReportType, ActionReportTypeEntry>,
  );

/** Stage 1a amendment 8: the verification types `run_verification` can run, with no end user. */
export const VERIFICATION_RUNNABLE_WITHOUT_CAPTURE = Object.freeze([
  'database',
  'aamva',
  'database_business',
  'business_website',
] as const satisfies readonly VerificationType[]);
