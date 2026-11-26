/**
 * The workflow definition (plan C113.1-C113.4): a JSON graph, stored on a version and walked by the
 * engine, never compiled (C113.8). Everything here is a strict object, so an unknown key is refused,
 * and every list carries its cap. The format is ours: the public product does not publish one.
 *
 * Three layers read it, and only the first is here:
 * - this schema: shape, ids, caps, one trigger config per type, one step shape per node type;
 * - `@openverify/workflow-engine`'s graph check (C113.5): edges, reachability, ports, nesting, typing
 *   of every condition and template;
 * - the publish rules (C116.4).
 *
 * An action step's `config` is a JSON object here: the action's own strict schema reads it, because
 * that schema is the registry's (C122.1). A condition is a JSON value here: the dialect's parser and
 * its limits are C114's. A type is a string here: the DSL's parser is C115.3's. So there is one
 * grammar of each, and this file holds none of them.
 *
 * A definition holds configuration, never subject data (C114.5, P37), so nothing in it is PII.
 */
import {
  WORKFLOW_DEFINITION_LIMITS,
  WORKFLOW_LOOP_MODES,
  WORKFLOW_PREDICATE_ON_NULL,
  WORKFLOW_TRIGGER_ON_NULL,
  WORKFLOW_WAIT_MODES,
  WORKFLOW_WAIT_ON_NULL,
  WORKFLOW_WAIT_TIMEOUT_ACTIONS,
  WORKFLOW_WHILE_ON_NULL,
  workflowObjectTypeSchema,
} from '@openverify/core';
import { z } from 'zod';
import { eventNameSchema, type EventName } from './event-names.js';
import { idSchema } from './ids.js';
import { hasDistinctValues } from './json-api.js';
import { verificationResourceTypeSchema } from './verification-types.js';
import { webhookFiltersSchema } from './webhooks.js';

export { WORKFLOW_LOOP_MODES, WORKFLOW_PREDICATE_ON_NULL, WORKFLOW_WAIT_MODES };

/** C113.7: the version this schema reads; `readDefinition` upgrades older ones. */
export const WORKFLOW_SCHEMA_VERSION = 1;

const limit = (name: keyof typeof WORKFLOW_DEFINITION_LIMITS) =>
  WORKFLOW_DEFINITION_LIMITS[name].value;

/** C113.1: a step id reads as a name in a path (`steps.run_watchlist.output`). */
export const WORKFLOW_STEP_ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** C113.1: `trigger` is the trigger's edge endpoint, and `output` the output node's own id. */
export const WORKFLOW_RESERVED_STEP_IDS = ['trigger', 'output'] as const;

const RESERVED: ReadonlySet<string> = new Set(WORKFLOW_RESERVED_STEP_IDS);

/** What an edge or a layout entry names: a step, `trigger` or `output`. */
export const workflowNodeIdSchema = z
  .string()
  .regex(WORKFLOW_STEP_ID_PATTERN, 'must be a lower-case name of at most 40 characters');

/** A step's id, stable across versions, because the diff keys on it (C116.6). */
export const workflowStepIdSchema = workflowNodeIdSchema.refine(
  (id) => !RESERVED.has(id),
  'trigger and output are reserved',
);

/**
 * Names a path or a mapping reads as a member, so none may name the prototype chain. The engine reads
 * own properties only (C114.2); this keeps the name out of the definition as well.
 */
const REFUSED_NAMES: ReadonlySet<string> = new Set(['constructor', 'prototype']);

export const workflowDeclaredNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,79}$/, 'must be a lower-case name of at most 80 characters')
  .refine((name) => !REFUSED_NAMES.has(name), 'must not name the prototype chain');

const nameSchema = z.string().min(1).max(limit('name-length'));

/** A route's or branch's key, part of a port's name. */
const portKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/, 'must be a lower-case key of at most 40 characters');

/**
 * Any JSON value: one schema, because it is recursive, so the OpenAPI document names it once rather
 * than holding a copy of a cycle per use.
 */
export const workflowJsonSchema = z.json();

/** C114: stored as JSON; the dialect's own parser reads it (`expressions/`). */
export const workflowConditionSchema = workflowJsonSchema;

/** C114.4: a path; the dialect's own parser reads it. Bounded here, never interpreted. */
export const workflowPathSchema = z.string().min(1).max(512);

/** C115.1: a JSON value whose string leaves may hold `{{ path }}`. */
export const workflowValueTemplateSchema = workflowJsonSchema;

/** C115.3: `string`, `list<id<inq>>` and the rest of the DSL; `variables/` parses it. */
export const workflowTypeSchema = z.string().min(1).max(512);

/** A mapping from a declared name to a path or a literal, both written as a C115 template. */
const mappingSchema = z.record(workflowDeclaredNameSchema, workflowValueTemplateSchema);

// ---------------------------------------------------------------------------------------------
// Triggers (C118)

/** C118.8: never a trigger, so a run cannot feed itself through its own events. */
export function isTriggerableEvent(name: EventName): boolean {
  return (
    !name.startsWith('workflow-run.') &&
    name !== 'workflow.published' &&
    name !== 'workflow-version.published'
  );
}

const triggerableEventSchema = eventNameSchema.refine(
  isTriggerableEvent,
  'workflow-run and published events never trigger a workflow',
);

const triggerEventsSchema = z
  .array(triggerableEventSchema)
  .min(1)
  .max(50)
  .refine(hasDistinctValues, 'must not contain duplicates');

const triggerOnNullSchema = z.enum(WORKFLOW_TRIGGER_ON_NULL);

/**
 * C118.1: criteria read the event's payload, in the worker, never inside `stage()`. `filter`
 * (K8-10, Workflow 8D; outcome 29, plan amendments 67 and 126) holds the event's subject to the
 * webhook filter keys, as a webhook's filters do (C143.4): publishing writes them to the trigger's
 * index row, and the worker reads them through the webhook subjects before the criteria.
 */
const eventTriggerConfigSchema = z.strictObject({
  events: triggerEventsSchema,
  criteria: workflowConditionSchema.optional(),
  'on-null': triggerOnNullSchema.optional(),
  filter: webhookFiltersSchema.optional(),
});

/** C118.6 (decision 25): an event trigger held to `verification.*`. */
const verificationTriggerConfigSchema = z.strictObject({
  events: triggerEventsSchema.refine(
    (events) => events.every((name) => name.startsWith('verification.')),
    'must name verification events only',
  ),
  /** C118.6's filter. OpenVerify's verifications have a type, not a template of their own. */
  'verification-types': z
    .array(verificationResourceTypeSchema)
    .min(1)
    .refine(hasDistinctValues, 'must not contain duplicates')
    .optional(),
  criteria: workflowConditionSchema.optional(),
  'on-null': triggerOnNullSchema.optional(),
});

/** C118.4 (decisions 8, 9, 24): a cron or an interval in an IANA zone, over one object type. */
const recurringTriggerConfigSchema = z
  .strictObject({
    /** Five fields; `schedules/` parses it in strict mode. */
    cron: z.string().min(1).max(128).optional(),
    'every-minutes': z.int().min(limit('recurring-every-minutes')).optional(),
    /** An IANA zone; `schedules/` checks that it exists. */
    'time-zone': z.string().min(1).max(64),
    'object-type': workflowObjectTypeSchema,
    /** A C114 condition over `trigger`, for `case` too (orchestrator decision 4 after 8A). */
    filter: workflowConditionSchema.optional(),
    'on-null': triggerOnNullSchema.optional(),
    'batch-cap': z.int().min(1).max(limit('recurring-batch')).optional(),
  })
  .refine(
    (config) => (config.cron === undefined) !== (config['every-minutes'] === undefined),
    'takes a cron or an interval, never both',
  );

const noConfig = z.strictObject({});

/**
 * C118.8, C118.9: per-workflow options, ours, on the trigger because a run's start is what they
 * change. Both are off unless set.
 */
const triggerOptions = {
  'allow-self-trigger': z.boolean().optional(),
  'one-run-per-subject': z.boolean().optional(),
};

const trigger = <const Type extends string, Config extends z.ZodType>(type: Type, config: Config) =>
  z.strictObject({ type: z.literal(type), config, ...triggerOptions });

/** C113.1: one strict config per trigger type. */
export const workflowTriggerSchema = z.discriminatedUnion('type', [
  trigger('trigger-event', eventTriggerConfigSchema),
  trigger('trigger-api', noConfig),
  trigger('trigger-schedule', noConfig),
  trigger('trigger-recurring', recurringTriggerConfigSchema),
  /** C118.5: the type of object a manual run names. */
  trigger('trigger-direct', z.strictObject({ 'object-type': workflowObjectTypeSchema })),
  trigger('trigger-account', noConfig),
  /** C140.1: inert in 8A; an action binds it to its case templates. */
  trigger('trigger-case', noConfig),
  trigger('trigger-verification', verificationTriggerConfigSchema),
  /**
   * C152.2 (Phase 9; ours): started only by a flow's `run_workflow` action. The inquiry is the run's
   * subject, and the trigger view is the declared inputs alone, never the inquiry's own data.
   */
  trigger('trigger-flow', noConfig),
]);
export type WorkflowTrigger = z.infer<typeof workflowTriggerSchema>;

// ---------------------------------------------------------------------------------------------
// Declarations (C113.1, C115.3)

/** C113.1, C118.2: the public `{ name, type, required }`, and `file` for a trigger's file value. */
export const workflowInputSchema = z.strictObject({
  name: workflowDeclaredNameSchema,
  type: workflowTypeSchema,
  required: z.boolean(),
  pii: z.boolean().optional(),
});
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

/** C115.3. */
export const workflowVariableSchema = z.strictObject({
  name: workflowDeclaredNameSchema,
  type: workflowTypeSchema,
  default: workflowJsonSchema.optional(),
  pii: z.boolean().optional(),
});
export type WorkflowVariable = z.infer<typeof workflowVariableSchema>;

/** C113.1, C115.6: a run output not declared PII refuses a tainted value at publish. */
export const workflowOutputSchema = z.strictObject({
  name: workflowDeclaredNameSchema,
  pii: z.boolean(),
});
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;

// ---------------------------------------------------------------------------------------------
// Nodes (C113.2)

const stepBase = { id: workflowStepIdSchema, name: nameSchema };

/** C113.2: where the action allows retries; the registry says which do. */
export const workflowRetrySchema = z.strictObject({
  'intervals-seconds': z
    .array(z.int().min(1).max(limit('retry-interval-seconds')))
    .min(1)
    .max(limit('retry-intervals')),
});

/** C122.1: an action's key. */
export const workflowActionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case key');

const actionStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('action'),
  'action-key': workflowActionKeySchema,
  'action-version': z.int().min(1),
  config: z.record(z.string(), workflowJsonSchema),
  'continue-on-error': z.boolean().optional(),
  retry: workflowRetrySchema.optional(),
});

const waitSeconds = z.int().min(1).max(limit('wait-seconds'));

const waitEventsStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('wait'),
  mode: z.literal(WORKFLOW_WAIT_MODES[0]),
  /** A path to an object id: ids are not personal data, so the wait stores it plain (C119.3). */
  subject: workflowPathSchema,
  events: z
    .array(eventNameSchema)
    .min(1)
    .max(50)
    .refine(hasDistinctValues, 'must not contain duplicates'),
  filter: workflowConditionSchema.optional(),
  'on-null': z.enum(WORKFLOW_WAIT_ON_NULL).optional(),
  'timeout-seconds': waitSeconds,
  'on-timeout': z.enum(WORKFLOW_WAIT_TIMEOUT_ACTIONS),
});

const waitTimeStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('wait'),
  mode: z.literal(WORKFLOW_WAIT_MODES[1]),
  seconds: waitSeconds,
});

const parallelStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('parallel'),
  branches: z
    .array(z.strictObject({ key: portKeySchema }))
    .min(limit('parallel-branches-min'))
    .max(limit('parallel-branches')),
});

const joinStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('join'),
  'join-of': workflowStepIdSchema,
});

/** C114.6: `error`, `skip-route` or `route:<key>`, with no default. */
export const workflowRouteOnNullSchema = z
  .string()
  .regex(
    /^(?:error|skip-route|route:[a-z][a-z0-9_-]{0,39})$/,
    'must be error, skip-route or a route',
  );

/** C113.2: a route without a condition is a catch-all. */
export const workflowRouteSchema = z.strictObject({
  key: portKeySchema,
  label: nameSchema,
  condition: workflowConditionSchema.optional(),
  'on-null': workflowRouteOnNullSchema.optional(),
});

const conditionalStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('conditional'),
  routes: z.array(workflowRouteSchema).min(1).max(limit('edges')),
  'continue-on-error': z.boolean().optional(),
});

const loopBase = {
  ...stepBase,
  type: z.literal('loop'),
  concurrency: z.int().min(1).max(limit('loop-concurrency')).optional(),
  'continue-on-error': z.boolean().optional(),
};

const loopForEachStepSchema = z.strictObject({
  ...loopBase,
  mode: z.literal(WORKFLOW_LOOP_MODES[0]),
  items: workflowPathSchema,
});

const loopWhileStepSchema = z.strictObject({
  ...loopBase,
  mode: z.literal(WORKFLOW_LOOP_MODES[1]),
  condition: workflowConditionSchema,
  'on-null': z.enum(WORKFLOW_WHILE_ON_NULL).optional(),
  'max-iterations': z.int().min(1).max(limit('loop-iterations')),
});

const loopMapStepSchema = z.strictObject({
  ...loopBase,
  mode: z.literal(WORKFLOW_LOOP_MODES[2]),
  items: workflowPathSchema,
});

/** C113.2: the node at the end of a `map` body, whose value is collected. */
const arrayMapOutputStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('array-map-output'),
  'map-of': workflowStepIdSchema,
  value: workflowValueTemplateSchema,
});

/** C119.8: `latest-published` resolves when the step starts, and is recorded. */
export const workflowModuleVersionSchema = z.union([
  z.literal('latest-published'),
  idSchema('wfv'),
]);

const moduleStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('module'),
  'module-workflow-id': idSchema('wfl'),
  version: workflowModuleVersionSchema,
  inputs: mappingSchema,
  'continue-on-error': z.boolean().optional(),
});

/** C113.1, C119.10: its id is the reserved `output`, and there is one per definition. */
const outputStepSchema = z.strictObject({
  id: z.literal('output'),
  name: nameSchema,
  type: z.literal('output'),
  mappings: mappingSchema,
});

/** C113.2: a module's start node, instead of a trigger. */
const moduleInputStepSchema = z.strictObject({ ...stepBase, type: z.literal('module-input') });

/** C113.2: one strict shape per node type. */
export const workflowStepSchema = z.discriminatedUnion('type', [
  actionStepSchema,
  z.discriminatedUnion('mode', [waitEventsStepSchema, waitTimeStepSchema]),
  parallelStepSchema,
  joinStepSchema,
  conditionalStepSchema,
  z.discriminatedUnion('mode', [loopForEachStepSchema, loopWhileStepSchema, loopMapStepSchema]),
  moduleStepSchema,
  outputStepSchema,
  moduleInputStepSchema,
  arrayMapOutputStepSchema,
]);
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

// ---------------------------------------------------------------------------------------------
// Edges (C113.3)

/** C113.3: the output ports. `route:<key>` and `branch:<key>` name a key of their step. */
export const workflowPortSchema = z
  .string()
  .regex(
    /^(?:next|error|else|body|done|(?:route|branch):[a-z][a-z0-9_-]{0,39})$/,
    'must be an output port',
  );

export const workflowEdgeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'must be a lower-case id'),
  from: workflowNodeIdSchema,
  'from-port': workflowPortSchema,
  to: workflowNodeIdSchema,
  /** C113.3: a loop body's back-edge ends at its loop's `continue` port. */
  'to-port': z.literal('continue').optional(),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

/** C113.1: positions only; left out of the hash, so moving a node changes no behaviour. */
export const workflowLayoutSchema = z.record(
  workflowNodeIdSchema,
  z.strictObject({ x: z.number(), y: z.number() }),
);

// ---------------------------------------------------------------------------------------------
// The definition (C113.1, C113.4)

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

function repeated(values: readonly string[]): number[] {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    if (seen.has(value)) {
      return [index];
    }
    seen.add(value);
    return [];
  });
}

/** C113.1: the definition, with a nullable trigger, because a draft has none until one is set. */
export const workflowDefinitionSchema = z
  .strictObject({
    'schema-version': z.literal(WORKFLOW_SCHEMA_VERSION),
    trigger: workflowTriggerSchema.nullable(),
    inputs: z.array(workflowInputSchema).max(limit('inputs')),
    variables: z.array(workflowVariableSchema).max(limit('variables')),
    steps: z.array(workflowStepSchema).max(limit('nodes')),
    edges: z.array(workflowEdgeSchema).max(limit('edges')),
    outputs: z.array(workflowOutputSchema).max(limit('outputs')),
    layout: workflowLayoutSchema,
  })
  .superRefine((definition, context) => {
    const unique = (member: 'inputs' | 'variables' | 'steps' | 'edges' | 'outputs') => {
      const items: readonly { readonly id?: string; readonly name?: string }[] = definition[member];
      const keys = items.map((item) =>
        member === 'steps' || member === 'edges' ? item.id : item.name,
      );
      for (const index of repeated(keys.map(String))) {
        context.addIssue({
          code: 'custom',
          message: 'must be unique in the definition',
          path: [member, index],
        });
      }
    };
    unique('inputs');
    unique('variables');
    unique('steps');
    unique('edges');
    unique('outputs');
    if (utf8Bytes(JSON.stringify(definition)) > limit('definition-bytes')) {
      context.addIssue({ code: 'custom', message: 'must be at most 256 KiB', path: [] });
    }
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
