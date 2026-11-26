/**
 * The graph check (plan C113.5, C113.6): pure, run after the schema on save, validate, publish and
 * promote. Each rule answers with a JSON Pointer into the definition and a code, and quotes nothing
 * the definition holds, because a problem body never echoes a received value (C143.5).
 *
 * The structure comes first. A condition or a template is typed only over a graph whose structure
 * holds, because a scope means nothing on a graph with a cycle.
 */
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@openverify/contracts';
import {
  WORKFLOW_DEFINITION_LIMITS,
  actionServesTrigger,
  type WorkflowKind,
  type WorkflowTriggerType,
} from '@openverify/core';
import type { z } from 'zod';
import { isEventName, eventSubject } from '@openverify/contracts';
import { pointerOf, type DefinitionIssue, type JsonValue } from '../expressions/json.js';
import { parseCondition } from '../expressions/parse.js';
import { parsePath } from '../expressions/paths.js';
import { eventViewType } from '../expressions/trigger-view.js';
import { typeCheckCondition } from '../expressions/typing.js';
import { validateSchedule } from '../schedules/cron.js';
import { checkUrlTemplate, parseTemplate, type TemplateReference } from '../templates/render.js';
import { ACTION_SINKS, parseConfigTemplates, type ActionSinkTable } from '../templates/sinks.js';
import { buildNodeScopes, type NodeScopes, type ScopeContext } from '../variables/scope.js';
import { analyzeTaint, type EgressMark } from '../variables/taint.js';
import {
  checkValue,
  objectType,
  parseTypeDsl,
  resolvePath,
  scalarType,
  type ScopeType,
} from '../variables/types.js';
import {
  CONTINUE,
  OUTPUT_NODE,
  TRIGGER_NODE,
  allowedPorts,
  edgeOn,
  edgesFrom,
  enclosureOf,
  forwardOrder,
  indexGraph,
  isBackEdge,
  reachable,
  reaching,
  regionsOf,
  requiredPorts,
  type ActionStep,
  type ConditionalStep,
  type GraphIndex,
  type LoopRegion,
  type LoopStep,
  type ModuleStep,
  type ParallelRegion,
  type Region,
  type WaitStep,
} from './structure.js';

export type DefinitionCheckMode = 'draft' | 'publish';

export interface DefinitionCheckContext extends ScopeContext {
  readonly kind: WorkflowKind;
  /** C113.5: `publish` adds the C116.4 rules; a `draft` may have no trigger yet. */
  readonly mode: DefinitionCheckMode;
  readonly sinks?: ActionSinkTable;
  /** C127.2: a report template's review model, where the caller can say. */
  readonly reportReviewModel?: (templateId: string) => string | undefined;
}

export interface DefinitionCheck {
  readonly errors: readonly DefinitionIssue[];
  /** C113.6: returned beside errors, and they never block publish. */
  readonly warnings: readonly DefinitionIssue[];
  /** C121.4: what the version stores as `egress`. Empty unless the structure held. */
  readonly egress: readonly EgressMark[];
}

class Findings {
  readonly errors: DefinitionIssue[] = [];
  readonly warnings: DefinitionIssue[] = [];

  error(pointer: string, code: string, detail: string): void {
    this.errors.push({ pointer, code, detail });
  }

  warn(pointer: string, code: string, detail: string): void {
    this.warnings.push({ pointer, code, detail });
  }

  under(base: string, issues: readonly DefinitionIssue[]): void {
    for (const { pointer, code, detail } of issues) {
      this.error(`${base}${pointer}`, code, detail);
    }
  }
}

const stepPointer = (index: number, ...tokens: readonly (string | number)[]): string =>
  pointerOf('/steps', index, ...tokens);

const edgePointer = (index: number, ...tokens: readonly (string | number)[]): string =>
  pointerOf('/edges', index, ...tokens);

// ---------------------------------------------------------------------------------------------
// C113.5: start, end, edges, ports

function checkEnds(graph: GraphIndex, context: DefinitionCheckContext, found: Findings): void {
  const { definition } = graph;
  const starts = definition.steps.flatMap((step, index) =>
    step.type === 'module-input' ? [index] : [],
  );
  if (context.kind === 'module') {
    if (definition.trigger !== null) {
      found.error('/trigger', 'start_repeated', 'A module starts at its input node');
    }
    if (starts.length === 0) {
      found.error('/steps', 'module_input_missing', 'A module has one input node');
    }
    for (const index of starts.slice(1)) {
      found.error(stepPointer(index), 'start_repeated', 'A module has one input node');
    }
  } else {
    if (definition.trigger === null && context.mode === 'publish') {
      found.error('/trigger', 'trigger_missing', 'A workflow has one trigger');
    }
    for (const index of starts) {
      found.error(stepPointer(index), 'start_repeated', 'A workflow starts at its trigger');
    }
  }
  if (!definition.steps.some((step) => step.type === 'output')) {
    found.error('/steps', 'output_missing', 'A definition has one output node');
  }
}

function checkEdges(graph: GraphIndex, found: Findings): void {
  const seen = new Set<string>();
  graph.definition.edges.forEach((edge, index) => {
    const from = graph.nodes.get(edge.from);
    if (from === undefined) {
      found.error(edgePointer(index, 'from'), 'edge_endpoint_unknown', 'No node has this id');
    }
    if (!graph.nodes.has(edge.to)) {
      found.error(edgePointer(index, 'to'), 'edge_endpoint_unknown', 'No node has this id');
    }
    if (from !== undefined && !allowedPorts(from.step).includes(edge['from-port'])) {
      found.error(
        edgePointer(index, 'from-port'),
        'edge_port_unknown',
        'This node has no such port',
      );
    }
    const key = `${edge.from} ${edge['from-port']}`;
    if (seen.has(key)) {
      found.error(edgePointer(index, 'from-port'), 'port_repeated', 'A port takes one edge');
    }
    seen.add(key);
    if (edge['to-port'] === CONTINUE && graph.nodes.get(edge.to)?.step?.type !== 'loop') {
      found.error(
        edgePointer(index, 'to-port'),
        'continue_port_invalid',
        'Only a loop has a continue port',
      );
    }
  });
}

function checkPorts(graph: GraphIndex, found: Findings): void {
  for (const node of graph.nodes.values()) {
    for (const port of requiredPorts(node.step)) {
      if (edgeOn(graph, node.id, port) === undefined) {
        const pointer = node.index === -1 ? '/trigger' : stepPointer(node.index);
        found.error(pointer, 'port_unconnected', 'Every port of this node needs an edge');
      }
    }
  }
}

function checkReach(graph: GraphIndex, found: Findings): void {
  if (graph.start === null) {
    return;
  }
  const fromStart = new Set(reachableWithBackEdges(graph, graph.start));
  const toOutput = reaching(graph, [OUTPUT_NODE]);
  for (const node of graph.nodes.values()) {
    if (node.index !== -1) {
      if (!fromStart.has(node.id)) {
        found.error(stepPointer(node.index), 'node_unreachable', 'Nothing leads to this node');
      } else if (!toOutput.has(node.id)) {
        found.error(
          stepPointer(node.index),
          'output_unreachable',
          'This node never reaches output',
        );
      }
    }
  }
}

function reachableWithBackEdges(graph: GraphIndex, start: string): ReadonlySet<string> {
  return reachable(graph, [start]);
}

// ---------------------------------------------------------------------------------------------
// C113.5: parallels and loops

function checkJoins(graph: GraphIndex, found: Findings): void {
  const { steps } = graph.definition;
  const paired = new Map<string, number>();
  steps.forEach((step, index) => {
    if (step.type === 'join') {
      const target = graph.nodes.get(step['join-of'])?.step;
      if (target?.type !== 'parallel') {
        found.error(stepPointer(index, 'join-of'), 'join_of_invalid', 'A join closes a parallel');
      } else if (paired.has(target.id)) {
        found.error(stepPointer(index), 'join_repeated', 'A parallel has one join');
      }
      paired.set(step['join-of'], index);
    }
  });
  steps.forEach((step, index) => {
    if (step.type === 'parallel' && !paired.has(step.id)) {
      found.error(stepPointer(index), 'join_missing', 'A parallel has a paired join');
    }
  });
}

function indexOf(graph: GraphIndex, id: string): number {
  return graph.nodes.get(id)?.index ?? -1;
}

function checkParallel(graph: GraphIndex, region: ParallelRegion, found: Findings): void {
  const { join, branches, body } = region;
  const parallel = indexOf(graph, region.id);
  if (join === null) {
    return;
  }
  const toJoin = reaching(graph, [join]);
  const owner = new Map<string, string>();
  [...branches].forEach(([key, nodes], branch) => {
    const leaves = [...nodes].filter((id) => !toJoin.has(id));
    if (!(edgesReachJoin(graph, nodes, join) || nodes.size === 0)) {
      found.error(
        stepPointer(parallel, 'branches', branch),
        'branch_not_joined',
        'Each branch reaches the paired join',
      );
    }
    for (const id of leaves) {
      found.error(stepPointer(indexOf(graph, id)), 'branch_leaves', 'Nothing leaves a branch');
    }
    for (const id of nodes) {
      if (owner.has(id) && owner.get(id) !== key) {
        found.error(stepPointer(indexOf(graph, id)), 'branch_leaves', 'Branches share no node');
      }
      owner.set(id, key);
    }
  });
  graph.definition.edges.forEach((edge, index) => {
    const entersBody = body.has(edge.to) && !body.has(edge.from) && edge.from !== region.id;
    const entersJoin = edge.to === join && !body.has(edge.from) && edge.from !== region.id;
    if (entersBody || entersJoin) {
      found.error(edgePointer(index), 'branch_entered', 'Only its parallel enters a branch');
    }
  });
}

const edgesReachJoin = (graph: GraphIndex, nodes: ReadonlySet<string>, join: string): boolean =>
  [...nodes].some((id) => edgesFrom(graph, id).some(({ edge }) => edge.to === join));

function checkLoop(graph: GraphIndex, region: LoopRegion, found: Findings): void {
  const { id, body } = region;
  const loop = indexOf(graph, id);
  const step = graph.nodes.get(id)?.step as LoopStep;
  const backEdges = graph.definition.edges.filter(
    (edge) => isBackEdge(edge) && edge.to === id && body.has(edge.from),
  );
  if (body.size > 0 && backEdges.length === 0) {
    found.error(stepPointer(loop), 'loop_body_open', 'A loop body ends at its continue port');
    return;
  }
  const toContinue = reachingWithin(
    graph,
    backEdges.map(({ from }) => from),
  );
  for (const member of body) {
    if (!toContinue.has(member)) {
      found.error(
        stepPointer(indexOf(graph, member)),
        'loop_body_escapes',
        'A loop body stays inside',
      );
    }
  }
  graph.definition.edges.forEach((edge, index) => {
    if (body.has(edge.to) && !body.has(edge.from) && edge.from !== id) {
      found.error(edgePointer(index), 'loop_body_entered', 'Only its loop enters a body');
    }
  });
  if (step.mode === 'map') {
    checkMapOutput(graph, step, loop, backEdges, found);
  }
  if (step.mode === 'while' && (step.concurrency ?? 1) > 1) {
    found.error(
      stepPointer(loop, 'concurrency'),
      'loop_concurrency_refused',
      'A while loop runs one iteration at a time',
    );
  }
}

function reachingWithin(graph: GraphIndex, to: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const stack = [...to];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (!seen.has(id)) {
      seen.add(id);
      for (const { edge } of graph.incoming.get(id) ?? []) {
        if (!isBackEdge(edge)) {
          stack.push(edge.from);
        }
      }
    }
  }
  return seen;
}

function checkMapOutput(
  graph: GraphIndex,
  step: LoopStep,
  loop: number,
  backEdges: readonly { readonly from: string }[],
  found: Findings,
): void {
  const everyEnd = backEdges.every(({ from }) => {
    const end = graph.nodes.get(from)?.step;
    return end?.type === 'array-map-output' && end['map-of'] === step.id;
  });
  if (!everyEnd || backEdges.length === 0) {
    found.error(stepPointer(loop), 'map_output_missing', 'A map body ends at its array-map-output');
  }
}

function checkMapOf(graph: GraphIndex, regions: readonly Region[], found: Findings): void {
  graph.definition.steps.forEach((step, index) => {
    if (step.type === 'array-map-output') {
      const target = graph.nodes.get(step['map-of'])?.step;
      const inBody = regions.some(
        (region) => region.id === step['map-of'] && region.body.has(step.id),
      );
      if (target?.type !== 'loop' || target.mode !== 'map' || !inBody) {
        found.error(stepPointer(index, 'map-of'), 'map_of_invalid', 'This node closes a map loop');
      }
    }
  });
}

function checkNesting(graph: GraphIndex, regions: readonly Region[], found: Findings): void {
  const enclosure = enclosureOf(regions);
  const limit = WORKFLOW_DEFINITION_LIMITS['nesting-depth'].value;
  for (const region of regions) {
    if ((enclosure.get(region.id)?.length ?? 0) + 1 > limit) {
      found.error(
        stepPointer(indexOf(graph, region.id)),
        'nesting_too_deep',
        'Parallel and loop nesting is at most 3',
      );
    }
  }
}

function checkStructure(graph: GraphIndex, context: DefinitionCheckContext, found: Findings): void {
  checkEnds(graph, context, found);
  checkEdges(graph, found);
  checkPorts(graph, found);
  checkJoins(graph, found);
  if (forwardOrder(graph) === null) {
    found.error('/edges', 'cycle_refused', 'Only a loop body may lead back, to its continue port');
    return;
  }
  checkReach(graph, found);
  const regions = regionsOf(graph);
  for (const region of regions) {
    if (region.kind === 'parallel') {
      checkParallel(graph, region, found);
    } else {
      checkLoop(graph, region, found);
    }
  }
  checkMapOf(graph, regions, found);
  checkNesting(graph, regions, found);
}

// ---------------------------------------------------------------------------------------------
// C113.5, C122.3: actions and modules

/** C115 cap of a node, measured without the three members that have caps of their own. */
const CONFIG_MEMBERS_WITH_OWN_CAPS: ReadonlySet<string> = new Set(['source', 'body', 'html']);

const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

function checkConfigSize(step: ActionStep, index: number, found: Findings): void {
  const measured = Object.fromEntries(
    Object.entries(step.config).filter(([name]) => !CONFIG_MEMBERS_WITH_OWN_CAPS.has(name)),
  );
  if (utf8Bytes(JSON.stringify(measured)) > WORKFLOW_DEFINITION_LIMITS['config-bytes'].value) {
    found.error(stepPointer(index, 'config'), 'config_too_large', 'A config is at most 16 KiB');
  }
}

function checkConfigSchema(
  schema: z.ZodType,
  step: ActionStep,
  index: number,
  found: Findings,
): void {
  const parsed = schema.safeParse(step.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const tokens = issue.path.map((token) => (typeof token === 'symbol' ? '' : token));
      found.error(
        stepPointer(index, 'config', ...tokens),
        'config_invalid',
        'This member does not fit the action',
      );
    }
  }
}

const inquiryEvent = (name: string): boolean =>
  isEventName(name) && eventSubject(name) === 'inquiry';

/** C122.3: an inquiry event, or an earlier step that brought an inquiry in. */
function inquiryInScope(graph: GraphIndex, step: ActionStep): boolean {
  const { trigger } = graph.definition;
  if (trigger?.type === 'trigger-event' && trigger.config.events.every(inquiryEvent)) {
    return true;
  }
  const before = reaching(graph, [step.id]);
  return graph.definition.steps.some(
    (other) =>
      other.id !== step.id &&
      before.has(other.id) &&
      other.type === 'action' &&
      (other['action-key'] === 'create_inquiry' ||
        (other['action-key'] === 'fetch_object' && other.config['object-type'] === 'inquiry')),
  );
}

function checkAction(
  graph: GraphIndex,
  step: ActionStep,
  index: number,
  context: DefinitionCheckContext,
  enclosure: ReadonlyMap<string, readonly Region[]>,
  found: Findings,
): void {
  const entry = context.registry.get(step['action-key'], step['action-version']);
  checkConfigSize(step, index, found);
  if (entry === undefined) {
    found.error(
      stepPointer(index, 'action-key'),
      'action_unknown',
      'No action has this key and version',
    );
    return;
  }
  checkConfigSchema(entry.config, step, index, found);
  const trigger: WorkflowTriggerType | undefined = graph.definition.trigger?.type;
  // C122.3, C152.2 (Workflow 9A Stage 1a amendment 3): `null` serves every type but trigger-flow.
  if (trigger !== undefined && !actionServesTrigger(entry.triggers, trigger)) {
    found.error(
      stepPointer(index, 'action-key'),
      'action_trigger_refused',
      'This action does not serve this trigger',
    );
  }
  if (step.retry !== undefined && !entry.retry.allowed) {
    found.error(stepPointer(index, 'retry'), 'retry_refused', 'This action does not retry');
  }
  if (
    entry.requires.includes('not-in-loop') &&
    (enclosure.get(step.id) ?? []).some(({ kind }) => kind === 'loop')
  ) {
    found.error(stepPointer(index), 'action_refused_in_loop', 'This action never runs in a loop');
  }
  if (entry.requires.includes('inquiry-in-scope') && !inquiryInScope(graph, step)) {
    found.error(
      stepPointer(index),
      'action_requires_inquiry',
      'This action needs an inquiry in scope',
    );
  }
}

function checkModuleStep(
  graph: GraphIndex,
  step: ModuleStep,
  index: number,
  context: DefinitionCheckContext,
  found: Findings,
): void {
  if (context.kind === 'module') {
    found.error(stepPointer(index), 'module_nested', 'A module has no module step');
    return;
  }
  const trigger = graph.definition.trigger?.type;
  if (trigger === 'trigger-account' || trigger === 'trigger-case') {
    found.error(
      stepPointer(index),
      'module_refused_for_trigger',
      'Account and case actions use no module',
    );
  }
  if (context.modules === undefined) {
    return;
  }
  const module = context.modules(step['module-workflow-id'], step.version);
  if (module === undefined) {
    found.error(
      stepPointer(index, 'module-workflow-id'),
      'module_unknown',
      'No published module of this environment has this id',
    );
    return;
  }
  const declared = new Set(module.inputs.map(({ name }) => name));
  for (const name of Object.keys(step.inputs)) {
    if (!declared.has(name)) {
      found.error(
        stepPointer(index, 'inputs', name),
        'module_input_unknown',
        'The module declares no such input',
      );
    }
  }
  for (const { name, required } of module.inputs) {
    if (required && !Object.hasOwn(step.inputs, name)) {
      found.error(
        stepPointer(index, 'inputs'),
        'module_input_missing',
        'A required module input needs a mapping',
      );
    }
  }
}

function checkDeclarations(
  graph: GraphIndex,
  context: DefinitionCheckContext,
  found: Findings,
): void {
  const { definition } = graph;
  definition.inputs.forEach(({ type }, index) => {
    if (!parseTypeDsl(type).ok) {
      found.error(
        pointerOf('/inputs', index, 'type'),
        'type_invalid',
        'This type is not in the type grammar',
      );
    }
  });
  definition.variables.forEach(({ type, default: value }, index) => {
    const parsed = parseTypeDsl(type);
    if (!parsed.ok) {
      found.error(
        pointerOf('/variables', index, 'type'),
        'type_invalid',
        'This type is not in the type grammar',
      );
    } else if (value !== undefined && checkValue(parsed.type, value).length > 0) {
      found.error(
        pointerOf('/variables', index, 'default'),
        'variable_default_invalid',
        'This default does not fit the declared type',
      );
    }
  });
  if (context.kind === 'module' && definition.variables.length > 0) {
    found.error(
      '/variables',
      'module_variables_refused',
      'A module reads parent variables as inputs',
    );
  }
}

function checkOutputNode(graph: GraphIndex, found: Findings): void {
  const { steps, outputs } = graph.definition;
  const index = steps.findIndex(({ type }) => type === 'output');
  const step = steps[index];
  if (step?.type !== 'output') {
    return;
  }
  const declared = new Set(outputs.map(({ name }) => name));
  for (const name of Object.keys(step.mappings)) {
    if (!declared.has(name)) {
      found.error(
        stepPointer(index, 'mappings', name),
        'output_mapping_unknown',
        'The definition declares no such output',
      );
    }
  }
  for (const { name } of outputs) {
    if (!Object.hasOwn(step.mappings, name)) {
      found.error(
        stepPointer(index, 'mappings'),
        'output_mapping_missing',
        'Each declared output has a mapping',
      );
    }
  }
}

function checkVariableUpdates(
  graph: GraphIndex,
  context: DefinitionCheckContext,
  found: Findings,
): void {
  const { definition } = graph;
  const declared = new Set(definition.variables.map(({ name }) => name));
  definition.steps.forEach((step, index) => {
    if (step.type === 'action' && step['action-key'] === 'update_variable') {
      if (context.kind === 'module') {
        found.error(
          stepPointer(index),
          'variable_read_only',
          'A variable is read-only in a module',
        );
      } else if (typeof step.config.name === 'string' && !declared.has(step.config.name)) {
        found.error(
          stepPointer(index, 'config', 'name'),
          'variable_unknown',
          'The definition declares no such variable',
        );
      }
    }
  });
}

const updatedVariables = (
  graph: GraphIndex,
  nodes: ReadonlySet<string>,
): ReadonlyMap<string, string> =>
  new Map(
    [...nodes].flatMap((id) => {
      const step = graph.nodes.get(id)?.step;
      return step?.type === 'action' &&
        step['action-key'] === 'update_variable' &&
        typeof step.config.name === 'string'
        ? [[step.config.name, id] as const]
        : [];
    }),
  );

const CONFLICT = 'Parallel branches never update one variable';

/** C115.4: the public product leaves their order undefined; ours refuses rather than races. */
function checkVariableRaces(graph: GraphIndex, regions: readonly Region[], found: Findings): void {
  for (const region of regions) {
    if (region.kind === 'parallel') {
      const seen = new Set<string>();
      for (const nodes of region.branches.values()) {
        for (const [name, id] of updatedVariables(graph, nodes)) {
          if (seen.has(name)) {
            found.error(stepPointer(indexOf(graph, id)), 'parallel_variable_conflict', CONFLICT);
          }
          seen.add(name);
        }
      }
    } else {
      const step = graph.nodes.get(region.id)?.step as LoopStep;
      if ((step.concurrency ?? 1) > 1) {
        for (const id of updatedVariables(graph, region.body).values()) {
          found.error(stepPointer(indexOf(graph, id)), 'parallel_variable_conflict', CONFLICT);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// C113.5: conditions and templates at their nodes

const READS_NULLABLE = 'This condition reads a nullable path, so it declares on-null';

class TypedCheck {
  readonly read = new Set<string>();
  /** Which nodes read each path, for the rules that depend on where a read stands. */
  readonly readers = new Map<string, Set<string>>();
  private node = TRIGGER_NODE;

  constructor(
    private readonly graph: GraphIndex,
    private readonly scopes: NodeScopes,
    private readonly context: DefinitionCheckContext,
    private readonly found: Findings,
  ) {}

  private get sinks(): ActionSinkTable {
    return this.context.sinks ?? ACTION_SINKS;
  }

  private note(text: string): void {
    this.read.add(text);
    const readers = this.readers.get(text) ?? new Set<string>();
    readers.add(this.node);
    this.readers.set(text, readers);
  }

  /** One condition: its parse, its types, and whether its position must declare `on-null`. */
  private condition(raw: JsonValue, pointer: string, scope: ScopeType): boolean {
    const parsed = parseCondition(raw);
    if (!parsed.ok) {
      this.found.under(pointer, parsed.issues);
      return false;
    }
    const { issues, reads, readsNullable } = typeCheckCondition(parsed.expression, scope);
    this.found.under(pointer, issues);
    for (const { path } of reads) {
      this.note(path.text);
    }
    return readsNullable;
  }

  /** One value template, of a node that has no config: no secret stands here (C125.3). */
  private template(raw: JsonValue, pointer: string, scope: ScopeType): void {
    const parsed = parseTemplate(raw);
    if (parsed.ok) {
      this.references(parsed.template.references, pointer, scope, null);
    } else {
      this.found.under(pointer, parsed.issues);
    }
  }

  /** Every reference resolved in `scope`, and where a secret or a literal may stand. */
  private references(
    references: readonly TemplateReference[],
    pointer: string,
    scope: ScopeType,
    actionKey: string | null,
  ): void {
    for (const { path, secret, pointer: member } of references) {
      const at = `${pointer}${member}`;
      if (actionKey !== null && this.sinks.sinkOf(actionKey, member).literal) {
        this.found.error(
          at,
          'literal_member_refused',
          'This member is a literal, because it decides a gate',
        );
        // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
      } else if (secret !== null) {
        if (actionKey === null || !this.sinks.sinkOf(actionKey, member).secret) {
          this.found.error(at, 'secret_placement_refused', 'A secret cannot stand here');
        }
      } else {
        this.resolve(path.segments, path.text, at, scope);
      }
    }
  }

  private resolve(
    segments: readonly (string | number)[],
    text: string,
    pointer: string,
    scope: ScopeType,
  ): void {
    const resolved = resolvePath(scope, segments);
    if (resolved.ok) {
      this.note(text);
    } else if (segments[0] === 'current_case' && resolved.at === 0) {
      this.found.error(pointer, 'current_case_unavailable', 'current_case has no provider yet');
    } else {
      this.found.error(pointer, 'path_unknown', 'This path is not in scope at this node');
    }
  }

  private checkConditional(step: ConditionalStep, index: number, scope: ScopeType): void {
    const keys = new Set(step.routes.map(({ key }) => key));
    step.routes.forEach((route, position) => {
      const pointer = stepPointer(index, 'routes', position);
      const onNull = route['on-null'];
      if (route.condition !== undefined) {
        const needs = this.condition(route.condition, `${pointer}/condition`, scope);
        if (needs && onNull === undefined) {
          this.found.error(pointer, 'on_null_missing', READS_NULLABLE);
        }
      }
      if (onNull?.startsWith('route:') === true && !keys.has(onNull.slice('route:'.length))) {
        this.found.error(
          `${pointer}/on-null`,
          'on_null_route_unknown',
          'on-null names a route of this step',
        );
      }
    });
  }

  private checkLoopStep(step: LoopStep, index: number, scope: ScopeType): void {
    if (step.mode === 'while') {
      const inside =
        scope.kind === 'object'
          ? objectType({ ...scope.members, loop: objectType({ index: scalarType('integer') }) })
          : scope;
      const needs = this.condition(step.condition, stepPointer(index, 'condition'), inside);
      if (needs && step['on-null'] === undefined) {
        this.found.error(stepPointer(index), 'on_null_missing', READS_NULLABLE);
      }
      return;
    }
    const pointer = stepPointer(index, 'items');
    const path = parsePath(step.items);
    if (path === null) {
      this.found.error(pointer, 'path_invalid', 'This path is not in the path grammar');
      return;
    }
    const resolved = resolvePath(scope, path.segments);
    this.resolve(path.segments, path.text, pointer, scope);
    if (resolved.ok && resolved.type.kind !== 'list' && resolved.type.kind !== 'any') {
      this.found.error(pointer, 'loop_items_invalid', 'A loop reads a list');
    }
  }

  private checkWait(step: WaitStep, index: number, scope: ScopeType): void {
    if (step.mode === 'time') {
      return;
    }
    const pointer = stepPointer(index, 'subject');
    const path = parsePath(step.subject);
    if (path === null) {
      this.found.error(pointer, 'path_invalid', 'This path is not in the path grammar');
      return;
    }
    this.resolve(path.segments, path.text, pointer, scope);
    const resolved = resolvePath(scope, path.segments);
    if (
      resolved.ok &&
      resolved.type.kind !== 'id' &&
      resolved.type.kind !== 'any' &&
      resolved.type.kind !== 'string'
    ) {
      this.found.error(pointer, 'wait_subject_invalid', 'A wait reads an object id');
    }
    if (step.filter !== undefined) {
      const views = step.events.flatMap((event) => eventViewType(event) ?? []);
      const [first] = views;
      const withEvent =
        first === undefined || scope.kind !== 'object'
          ? scope
          : objectType({ ...scope.members, event: first });
      const needs = this.condition(step.filter, stepPointer(index, 'filter'), withEvent);
      if (needs && step['on-null'] === undefined) {
        this.found.error(stepPointer(index), 'on_null_missing', READS_NULLABLE);
      }
    }
  }

  private checkActionStep(step: ActionStep, index: number, scope: ScopeType): void {
    const key = step['action-key'];
    const pointer = stepPointer(index, 'config');
    const { members, references, issues } = parseConfigTemplates(step.config);
    this.found.under(pointer, issues);
    this.references(references, pointer, scope, key);
    const url = members.get('url');
    if (key === 'make_https_request' && url !== undefined) {
      this.found.under(`${pointer}/url`, checkUrlTemplate(url));
    }
  }

  private checkStep(step: WorkflowStep, index: number, scope: ScopeType): void {
    switch (step.type) {
      case 'action':
        this.checkActionStep(step, index, scope);
        break;
      case 'conditional':
        this.checkConditional(step, index, scope);
        break;
      case 'loop':
        this.checkLoopStep(step, index, scope);
        break;
      case 'wait':
        this.checkWait(step, index, scope);
        break;
      case 'module':
        this.template(step.inputs, stepPointer(index, 'inputs'), scope);
        break;
      case 'output':
        this.template(step.mappings, stepPointer(index, 'mappings'), scope);
        break;
      case 'array-map-output':
        this.template(step.value, stepPointer(index, 'value'), scope);
        break;
      default:
        break;
    }
  }

  private checkTrigger(): void {
    const { trigger } = this.graph.definition;
    const scope = this.scopes.at.get(TRIGGER_NODE);
    if (trigger === null || scope === undefined) {
      return;
    }
    const triggerScope =
      scope.kind === 'object'
        ? objectType({ trigger: scope.members.trigger ?? objectType({}) })
        : scope;
    const config = trigger.config as Readonly<Record<string, unknown>>;
    const criteria = (config.criteria ?? config.filter) as JsonValue | undefined;
    if (criteria !== undefined) {
      const member = config.criteria === undefined ? 'filter' : 'criteria';
      const needs = this.condition(criteria, `/trigger/config/${member}`, triggerScope);
      if (needs && config['on-null'] === undefined) {
        this.found.error('/trigger/config', 'on_null_missing', READS_NULLABLE);
      }
    }
  }

  walk(): void {
    this.checkTrigger();
    this.graph.definition.steps.forEach((step, index) => {
      const scope = this.scopes.at.get(step.id);
      if (scope !== undefined) {
        this.node = step.id;
        this.checkStep(step, index, scope);
      }
    });
    this.checkReads();
  }

  /** C127.2: a report type with no review has no `has-match`. */
  private checkHasMatch(step: ActionStep, index: number): void {
    const template = step.config['report-template-id'];
    const literal = typeof template === 'string' && !template.includes('{{');
    const review = literal ? this.context.reportReviewModel?.(template) : undefined;
    if (review === 'none' && this.readers.has(`steps.${step.id}.output.has-match`)) {
      this.found.error(
        stepPointer(index),
        'has_match_refused',
        'This report type has no match to read',
      );
    }
  }

  /** C127.5: an asynchronous query has a count only behind a wait on that query. */
  private checkAccountCount(step: ActionStep, index: number): void {
    const readers = this.readers.get(`steps.${step.id}.output.account-count`) ?? [];
    const subject = `steps.${step.id}.output.graph-query-id`;
    const waits = this.graph.definition.steps.flatMap((other) =>
      other.type === 'wait' && other.mode === 'events' && other.subject === subject
        ? [other.id]
        : [],
    );
    for (const reader of readers) {
      if (!waits.some((wait) => this.scopes.before.get(reader)?.has(wait) === true)) {
        this.found.error(
          stepPointer(index),
          'account_count_refused',
          'An asynchronous query has no count until a wait on it',
        );
      }
    }
  }

  private checkReads(): void {
    this.graph.definition.steps.forEach((step, index) => {
      if (step.type === 'action' && step['action-key'] === 'run_report') {
        this.checkHasMatch(step, index);
      } else if (
        step.type === 'action' &&
        step['action-key'] === 'run_graph_query' &&
        step.config.mode === 'asynchronous'
      ) {
        this.checkAccountCount(step, index);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// C113.6, C127: warnings

const readsOf = (read: ReadonlySet<string>, id: string): readonly string[] => {
  const prefix = `steps.${id}.output.`;
  return [...read].flatMap((text) => (text.startsWith(prefix) ? [text.slice(prefix.length)] : []));
};

function warnUnused(graph: GraphIndex, read: ReadonlySet<string>, found: Findings): void {
  const texts = [...read];
  graph.definition.variables.forEach(({ name }, index) => {
    const path = `vars.${name}`;
    if (
      !texts.some(
        (text) => text === path || text.startsWith(`${path}.`) || text.startsWith(`${path}[`),
      )
    ) {
      found.warn(pointerOf('/variables', index), 'variable_unused', 'Nothing reads this variable');
    }
  });
}

/** C127.2, C127.5, C127.10: an answer whose honesty another member states. */
const COMPANIONS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  run_report: { 'has-match': ['coverage'] },
  calculate: { value: ['defaulted'] },
  run_graph_query: { 'account-count': ['index-complete', 'node-limit-reached'] },
};

function warnSteps(graph: GraphIndex, read: ReadonlySet<string>, found: Findings): void {
  graph.definition.steps.forEach((step, index) => {
    if (step.type === 'action') {
      const members = readsOf(read, step.id);
      const heads = new Set(members.map((member) => member.split(/[.[]/, 1)[0]));
      const whole = read.has(`steps.${step.id}.output`);
      if (members.length === 0 && !whole) {
        found.warn(stepPointer(index), 'output_unread', 'Nothing reads this step output');
      }
      for (const [member, companions] of Object.entries(COMPANIONS[step['action-key']] ?? {})) {
        if (heads.has(member) && companions.some((companion) => !heads.has(companion))) {
          found.warn(
            stepPointer(index),
            'read_without_companion',
            'This answer is read without what qualifies it',
          );
        }
      }
    }
  });
}

function warnSelfTrigger(
  graph: GraphIndex,
  context: DefinitionCheckContext,
  found: Findings,
): void {
  const { trigger, steps } = graph.definition;
  const listened: readonly string[] =
    trigger?.type === 'trigger-event' || trigger?.type === 'trigger-verification'
      ? trigger.config.events
      : [];
  steps.forEach((step, index) => {
    if (step.type === 'action') {
      const entry = context.registry.get(step['action-key'], step['action-version']);
      if (entry?.emits.some((name) => listened.includes(name)) === true) {
        found.warn(
          stepPointer(index),
          'trigger_self_emitted',
          'This step can emit the trigger event of its own workflow',
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------

function checkSchedule(graph: GraphIndex, found: Findings): void {
  const { trigger } = graph.definition;
  if (trigger?.type === 'trigger-recurring') {
    const { cron, 'every-minutes': everyMinutes, 'time-zone': timeZone } = trigger.config;
    const code = validateSchedule({
      ...(cron === undefined ? {} : { cron }),
      ...(everyMinutes === undefined ? {} : { everyMinutes }),
      timeZone,
    });
    if (code !== null) {
      found.error('/trigger/config', code, 'This schedule cannot fire');
    }
  }
}

function checkAccess(graph: GraphIndex, context: DefinitionCheckContext, found: Findings): void {
  const enclosure = enclosureOf(regionsOf(graph));
  graph.definition.steps.forEach((step, index) => {
    if (step.type === 'action') {
      checkAction(graph, step, index, context, enclosure, found);
    } else if (step.type === 'module') {
      checkModuleStep(graph, step, index, context, found);
    }
  });
}

/**
 * C113.5, C113.6: the check of a definition the schema already read. `publish` adds the taint rules
 * of C115.6 and the schedule of C118.4; `draft` is what a save and a validate answer.
 */
export function checkDefinition(
  definition: WorkflowDefinition,
  context: DefinitionCheckContext,
): DefinitionCheck {
  const graph = indexGraph(definition);
  const found = new Findings();
  checkDeclarations(graph, context, found);
  checkStructure(graph, context, found);
  checkOutputNode(graph, found);
  checkAccess(graph, context, found);
  checkVariableUpdates(graph, context, found);
  if (found.errors.length > 0) {
    return { errors: found.errors, warnings: found.warnings, egress: [] };
  }
  checkVariableRaces(graph, regionsOf(graph), found);
  const scopes = buildNodeScopes(graph, context);
  if (scopes === null) {
    return { errors: found.errors, warnings: found.warnings, egress: [] };
  }
  const typed = new TypedCheck(graph, scopes, context, found);
  typed.walk();
  warnUnused(graph, typed.read, found);
  warnSteps(graph, typed.read, found);
  warnSelfTrigger(graph, context, found);
  if (context.mode === 'draft') {
    return { errors: found.errors, warnings: found.warnings, egress: [] };
  }
  checkSchedule(graph, found);
  const taint = analyzeTaint(graph, scopes, context.registry, context.sinks ?? ACTION_SINKS);
  found.errors.push(...taint.issues);
  return { errors: found.errors, warnings: found.warnings, egress: taint.egress };
}

/** C113.5: the schema, then the check, for a body that may hold anything. */
export function validateDefinition(raw: unknown, context: DefinitionCheckContext): DefinitionCheck {
  const parsed = workflowDefinitionSchema.safeParse(raw);
  if (parsed.success) {
    return checkDefinition(parsed.data, context);
  }
  const errors = parsed.error.issues.map(({ path }) => ({
    pointer: pointerOf('', ...path.map((token) => (typeof token === 'symbol' ? '' : token))),
    code: 'definition_shape_invalid',
    detail: 'This member does not match the definition format',
  }));
  return { errors, warnings: [], egress: [] };
}
