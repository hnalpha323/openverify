/**
 * The editor's one document model (C141.2 to C141.4): immutable workflow definitions (C113.1) and
 * the pure commands that edit them. The outline, the canvas and the raw JSON all edit through
 * these commands, so each view reads the same document and an undo returns all three to it. A
 * command never mutates its input; it answers the next definition and the item to select, or
 * `null` when it does not apply. Each command keeps the graph connected where it can (a new
 * step's ports lead on to where the old edge led), so the draft check (8A amendment 49) refuses
 * only what is still unfinished, never what the editor broke.
 */
import {
  CONTINUE_PORT,
  OUTPUT_NODE,
  TRIGGER_NODE,
  canConnect,
  edgeOn,
  portsOf,
} from './port-rules';
import { decisionTemplateDefinition, type DecisionTemplateKey } from '../decision-templates';
import { renameStepReferences } from './step-references';

/** A step as the editor reads it: its id, type and name, and every other member kept as it is. */
export interface DraftStep {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly [member: string]: unknown;
}

export interface DraftEdge {
  readonly id: string;
  readonly from: string;
  readonly 'from-port': string;
  readonly to: string;
  readonly 'to-port'?: string;
}

export interface DraftTrigger {
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly [member: string]: unknown;
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

/** C113.1. Members the editor does not read (inputs, variables, outputs) are kept as they are. */
export interface DraftDefinition {
  readonly 'schema-version': unknown;
  readonly trigger: DraftTrigger | null;
  readonly inputs: readonly unknown[];
  readonly variables: readonly unknown[];
  readonly steps: readonly DraftStep[];
  readonly edges: readonly DraftEdge[];
  readonly outputs: readonly unknown[];
  readonly layout: Readonly<Record<string, Position>>;
}

/** What "add a step" adds: an action from the catalogue, or a step type of C113.2. */
export type StepTemplate =
  | { readonly kind: 'action'; readonly key: string; readonly version: number }
  | { readonly kind: 'wait-time' }
  | { readonly kind: 'wait-events' }
  | { readonly kind: 'conditional' }
  | { readonly kind: 'parallel' }
  | { readonly kind: 'loop-for-each' }
  | { readonly kind: 'loop-while' }
  | { readonly kind: 'loop-map' }
  | { readonly kind: 'module'; readonly workflowId: string; readonly name: string }
  | { readonly kind: 'decision-template'; readonly key: DecisionTemplateKey };

/** A port of a node: where a step is added, or what a connection starts from. */
export interface Place {
  readonly from: string;
  readonly port: string;
}

/** A command's answer: the next definition and the outline item to select. */
export interface Edited {
  readonly definition: DraftDefinition;
  readonly select: string;
}

export type Direction = 'up' | 'down';

/** C113.4: a parallel has at most ten branches. */
const MAX_BRANCHES = 10;
/** C113.4: a name is 1 to 80 characters. */
const MAX_NAME = 80;
/** C113.1: a step id is at most 40 characters. */
const MAX_ID = 40;

const OUTPUT_STEP: DraftStep = { id: OUTPUT_NODE, name: 'Output', type: 'output', mappings: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string';

const isStep = (value: unknown): value is DraftStep =>
  isRecord(value) && isText(value.id) && isText(value.type) && isText(value.name);

const isEdge = (value: unknown): value is DraftEdge =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.from) &&
  isText(value['from-port']) &&
  isText(value.to) &&
  (value['to-port'] === undefined || isText(value['to-port']));

const isPosition = (value: unknown): value is Position =>
  isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';

const listOr = (value: unknown): readonly unknown[] | null =>
  value === undefined ? [] : Array.isArray(value) ? value : null;

/**
 * The definition the editor can edit, or `null` when `value` does not have its shape: every step
 * with a text id, type and name, every edge with its endpoints and port, and a trigger with a text
 * type when there is one. Anything else the editor leaves to the raw JSON.
 */
export function readDraft(value: unknown): DraftDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  const { steps, edges, trigger, layout } = value;
  const inputs = listOr(value.inputs);
  const variables = listOr(value.variables);
  const outputs = listOr(value.outputs);
  if (
    !Array.isArray(steps) ||
    !steps.every(isStep) ||
    !Array.isArray(edges) ||
    !edges.every(isEdge) ||
    inputs === null ||
    variables === null ||
    outputs === null
  ) {
    return null;
  }
  const readTrigger =
    trigger === null || trigger === undefined
      ? null
      : isRecord(trigger) && isText(trigger.type)
        ? ({ ...trigger, config: isRecord(trigger.config) ? trigger.config : {} } as DraftTrigger)
        : undefined;
  const readLayout =
    layout === undefined
      ? {}
      : isRecord(layout) && Object.values(layout).every(isPosition)
        ? (layout as Record<string, Position>)
        : undefined;
  if (readTrigger === undefined || readLayout === undefined) {
    return null;
  }
  return {
    ...value,
    'schema-version': value['schema-version'],
    trigger: readTrigger,
    inputs,
    variables,
    steps,
    edges,
    outputs,
    layout: readLayout,
  };
}

/** A new definition: no trigger yet and the output node a draft needs (C113.5). */
export function emptyDefinition(): DraftDefinition {
  return {
    'schema-version': 1,
    trigger: null,
    inputs: [],
    variables: [],
    steps: [OUTPUT_STEP],
    edges: [],
    outputs: [],
    layout: {},
  };
}

/** The definition as the raw editor shows it. */
export function serialise(definition: DraftDefinition): string {
  return JSON.stringify(definition, null, 2);
}

// ---------------------------------------------------------------------------------------------
// Names and ids

const stepOf = (definition: DraftDefinition, id: string): DraftStep | undefined =>
  definition.steps.find((step) => step.id === id);

/** A step id free in `definition`, from `base` (C113.1's pattern, never a reserved id). */
function freeStepId(definition: DraftDefinition, base: string): string {
  const cleaned = base.toLowerCase().replaceAll(/[^a-z0-9_]/g, '_');
  const stem = (/^[a-z]/.test(cleaned) ? cleaned : `step_${cleaned}`).slice(0, MAX_ID - 4);
  const taken = (id: string) =>
    id === TRIGGER_NODE || id === OUTPUT_NODE || definition.steps.some((step) => step.id === id);
  if (!taken(stem)) {
    return stem;
  }
  let suffix = 2;
  while (taken(`${stem}_${String(suffix)}`)) {
    suffix += 1;
  }
  return `${stem}_${String(suffix)}`;
}

/** A name no step has yet: `name`, else `name 2`, `name 3`, and so on. */
function freeName(definition: DraftDefinition, name: string): string {
  const taken = (candidate: string) => definition.steps.some((step) => step.name === candidate);
  if (!taken(name)) {
    return name;
  }
  let suffix = 2;
  while (taken(`${name} ${String(suffix)}`)) {
    suffix += 1;
  }
  return `${name} ${String(suffix)}`;
}

/** Fresh edge ids, `edge_<n>`, none of them taken in `definition`. */
function edgeIds(definition: DraftDefinition): () => string {
  const taken = new Set(definition.edges.map((edge) => edge.id));
  let next = definition.edges.length;
  return () => {
    while (taken.has(`edge_${String(next)}`)) {
      next += 1;
    }
    const id = `edge_${String(next)}`;
    taken.add(id);
    return id;
  };
}

/** "send_slack_message" -> "Send slack message". */
function humanised(key: string): string {
  const words = key.replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

// ---------------------------------------------------------------------------------------------
// The trigger

/** C118: the config each trigger type's schema needs, which its panel then changes. */
function triggerConfigOf(type: string): Readonly<Record<string, unknown>> {
  switch (type) {
    case 'trigger-event':
      return { events: ['inquiry.completed'] };
    case 'trigger-verification':
      return { events: ['verification.passed'] };
    case 'trigger-recurring':
      return { 'every-minutes': 60, 'time-zone': 'UTC', 'object-type': 'inquiry' };
    case 'trigger-direct':
      return { 'object-type': 'inquiry' };
    default:
      return {};
  }
}

/**
 * Sets the trigger (C118), with the config its type needs and the per-workflow options it held,
 * and leads it to the output when its port has no edge yet, adding the output node when missing.
 */
export function setTrigger(definition: DraftDefinition, type: string): Edited {
  const options = definition.trigger ?? {};
  const trigger: DraftTrigger = { ...options, type, config: triggerConfigOf(type) };
  const steps =
    stepOf(definition, OUTPUT_NODE) === undefined
      ? [...definition.steps, OUTPUT_STEP]
      : definition.steps;
  const edges =
    edgeOn(definition, TRIGGER_NODE, 'next') === undefined
      ? [
          ...definition.edges,
          { id: edgeIds(definition)(), from: TRIGGER_NODE, 'from-port': 'next', to: OUTPUT_NODE },
        ]
      : definition.edges;
  return { definition: { ...definition, trigger, steps, edges }, select: TRIGGER_NODE };
}

// ---------------------------------------------------------------------------------------------
// Adding steps

/** The new step (and a parallel's join) a template makes, with the ports that lead on. */
function stepsOfTemplate(
  definition: DraftDefinition,
  template: StepTemplate,
): { readonly steps: readonly DraftStep[]; readonly onward: readonly Place[] } {
  switch (template.kind) {
    case 'action': {
      const id = freeStepId(definition, template.key);
      return {
        steps: [
          {
            id,
            name: freeName(definition, humanised(template.key)),
            type: 'action',
            'action-key': template.key,
            'action-version': template.version,
            config: {},
          },
        ],
        onward: [{ from: id, port: 'next' }],
      };
    }
    case 'wait-time': {
      const id = freeStepId(definition, 'wait');
      return {
        steps: [
          {
            id,
            name: freeName(definition, 'Wait for a time'),
            type: 'wait',
            mode: 'time',
            seconds: 3600,
          },
        ],
        onward: [{ from: id, port: 'next' }],
      };
    }
    case 'wait-events': {
      const id = freeStepId(definition, 'wait_for_event');
      return {
        steps: [
          {
            id,
            name: freeName(definition, 'Wait for an event'),
            type: 'wait',
            mode: 'events',
            subject: 'trigger.id',
            events: ['inquiry.completed'],
            'timeout-seconds': 86_400,
            'on-timeout': 'continue',
          },
        ],
        onward: [{ from: id, port: 'next' }],
      };
    }
    case 'conditional': {
      const id = freeStepId(definition, 'conditional');
      return {
        steps: [
          {
            id,
            name: freeName(definition, 'Conditional'),
            type: 'conditional',
            routes: [{ key: 'route-1', label: 'Route 1' }],
          },
        ],
        onward: [
          { from: id, port: 'route:route-1' },
          { from: id, port: 'else' },
        ],
      };
    }
    case 'parallel': {
      const id = freeStepId(definition, 'parallel');
      const join = freeStepId(
        { ...definition, steps: [...definition.steps, { id, name: id, type: 'parallel' }] },
        `${id}_join`,
      );
      return {
        steps: [
          {
            id,
            name: freeName(definition, 'Parallel'),
            type: 'parallel',
            branches: [{ key: 'a' }, { key: 'b' }],
          },
          { id: join, name: 'Join', type: 'join', 'join-of': id },
        ],
        onward: [{ from: join, port: 'next' }],
      };
    }
    case 'loop-for-each':
    case 'loop-map': {
      const mode = template.kind === 'loop-map' ? 'map' : 'for-each';
      const id = freeStepId(definition, mode === 'map' ? 'map' : 'loop');
      return {
        steps: [
          {
            id,
            name: freeName(definition, mode === 'map' ? 'Map a list' : 'Loop over a list'),
            type: 'loop',
            mode,
            // A placeholder the author replaces in the step's form; the check refuses an unknown
            // path, so nothing runs over it.
            items: 'trigger.items',
          },
        ],
        onward: [{ from: id, port: 'done' }],
      };
    }
    case 'loop-while': {
      const id = freeStepId(definition, 'while');
      return {
        steps: [
          {
            id,
            name: freeName(definition, 'Loop while'),
            type: 'loop',
            mode: 'while',
            // `false` until the author writes the condition: the body never runs by default.
            condition: false,
            // Provisional, ours: a small bound the author raises within the contract's limit.
            'max-iterations': 10,
          },
        ],
        onward: [{ from: id, port: 'done' }],
      };
    }
    case 'module': {
      const id = freeStepId(definition, 'module');
      return {
        steps: [
          {
            id,
            name: freeName(definition, `Module: ${template.name}`.slice(0, MAX_NAME)),
            type: 'module',
            'module-workflow-id': template.workflowId,
            version: 'latest-published',
            inputs: {},
          },
        ],
        onward: [{ from: id, port: 'next' }],
      };
    }
    case 'decision-template':
      // A whole subgraph: `insertTemplate` places it.
      return { steps: [], onward: [] };
  }
}

/** Every `steps.<from>` in a value's string leaves read as `steps.<to>` (a scan, C252.1). */
function renamedReferences(value: unknown, renames: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    let text = value;
    for (const [from, to] of renames) {
      text = renameStepReferences(text, from, to);
    }
    return text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => renamedReferences(item, renames));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renamedReferences(item, renames)]),
    );
  }
  return value;
}

/**
 * C128.5 (decision 51): a review-first decision template's steps on `place`, leading on to where
 * the place led. A step whose id is taken gets a free one, and every path that reads it follows.
 * The template's own trigger is not applied: it fits an inquiry event trigger, which the check
 * says when the definition has another.
 */
function insertTemplate(
  definition: DraftDefinition,
  place: Place,
  key: DecisionTemplateKey,
): Edited | null {
  const template = decisionTemplateDefinition(key) as unknown as DraftDefinition;
  const renames = new Map<string, string>();
  let current = definition;
  const added: DraftStep[] = [];
  for (const step of template.steps) {
    if (step.id === OUTPUT_NODE) {
      continue;
    }
    const id = freeStepId(current, step.id);
    renames.set(step.id, id);
    const placed = { ...step, id, name: freeName(current, step.name) };
    added.push(placed);
    current = { ...current, steps: [...current.steps, placed] };
  }
  const steps = added.map((step) => renamedReferences(step, renames) as DraftStep);
  const [first] = steps;
  if (first === undefined) {
    return null;
  }
  const existing = edgeOn(definition, place.from, place.port);
  const onward = existing?.to ?? OUTPUT_NODE;
  const nextId = edgeIds(definition);
  const edges: DraftEdge[] = definition.edges.map((edge) =>
    edge === existing ? { ...edge, to: first.id } : edge,
  );
  if (existing === undefined) {
    edges.push({ id: nextId(), from: place.from, 'from-port': place.port, to: first.id });
  }
  for (const edge of template.edges) {
    if (edge.from === TRIGGER_NODE) {
      continue;
    }
    edges.push({
      id: nextId(),
      from: renames.get(edge.from) ?? edge.from,
      'from-port': edge['from-port'],
      to: edge.to === OUTPUT_NODE ? onward : (renames.get(edge.to) ?? edge.to),
    });
  }
  return {
    definition: { ...definition, steps: [...definition.steps, ...steps], edges },
    select: first.id,
  };
}

/**
 * Adds a step on `place` (C141.2): the edge that sat on the port now leads to the new step, and
 * each of the new step's onward ports leads to where that edge led. A parallel's branches lead to
 * its join. `null` when the place is not a port of a node.
 */
export function insertStep(
  definition: DraftDefinition,
  place: Place,
  template: StepTemplate,
): Edited | null {
  const source = place.from === TRIGGER_NODE ? null : stepOf(definition, place.from);
  if (
    source === undefined ||
    (place.from === TRIGGER_NODE && definition.trigger === null) ||
    !portsOf(source).includes(place.port)
  ) {
    return null;
  }
  if (template.kind === 'decision-template') {
    return insertTemplate(definition, place, template.key);
  }
  const { steps, onward } = stepsOfTemplate(definition, template);
  const [added] = steps;
  if (added === undefined) {
    return null;
  }
  const nextId = edgeIds(definition);
  const existing = edgeOn(definition, place.from, place.port);
  const edges: DraftEdge[] = definition.edges.map((edge) =>
    edge === existing ? { ...edge, to: added.id } : edge,
  );
  if (existing === undefined) {
    edges.push({ id: nextId(), from: place.from, 'from-port': place.port, to: added.id });
  }
  if (template.kind === 'parallel') {
    const join = steps[1];
    for (const port of portsOf(added)) {
      edges.push({ id: nextId(), from: added.id, 'from-port': port, to: join?.id ?? added.id });
    }
  }
  if (existing !== undefined) {
    for (const port of onward) {
      edges.push({ id: nextId(), from: port.from, 'from-port': port.port, to: existing.to });
    }
  }
  return {
    definition: { ...definition, steps: [...definition.steps, ...steps], edges },
    select: added.id,
  };
}

/**
 * Where "Add a step after" puts a step after the outline item `id` (C141.2): the trigger's and a
 * step's `next`, a loop's `done`, a parallel's join's `next`, or the port a group item names
 * (`<step id>/<port>`). `null` for the output and a conditional, whose steps go inside a route.
 */
export function insertionPlaceOf(definition: DraftDefinition, id: string): Place | null {
  if (id === TRIGGER_NODE) {
    return definition.trigger === null ? null : { from: TRIGGER_NODE, port: 'next' };
  }
  const separator = id.indexOf('/');
  if (separator !== -1) {
    const from = id.slice(0, separator);
    const port = id.slice(separator + 1);
    const step = from === TRIGGER_NODE ? null : stepOf(definition, from);
    return step !== undefined && portsOf(step).includes(port) ? { from, port } : null;
  }
  const step = stepOf(definition, id);
  if (step === undefined) {
    return null;
  }
  switch (step.type) {
    case 'output':
    case 'conditional':
      return null;
    case 'loop':
      return { from: step.id, port: 'done' };
    case 'parallel': {
      const join = definition.steps.find(
        (candidate) => candidate.type === 'join' && candidate['join-of'] === step.id,
      );
      return join === undefined ? null : { from: join.id, port: 'next' };
    }
    default:
      return portsOf(step).includes('next') ? { from: step.id, port: 'next' } : null;
  }
}

const replaceStep = (definition: DraftDefinition, step: DraftStep): readonly DraftStep[] =>
  definition.steps.map((candidate) => (candidate.id === step.id ? step : candidate));

/**
 * Adds a branch (C141.2): a route to a conditional, leading where its else leads, or a branch to
 * a parallel, leading to its join (at most ten, C113.4). `null` for any other step.
 */
export function addBranch(definition: DraftDefinition, stepId: string): Edited | null {
  const step = stepOf(definition, stepId);
  if (step?.type === 'conditional') {
    const routes = Array.isArray(step.routes) ? (step.routes as readonly unknown[]) : [];
    let number = routes.length + 1;
    while (portsOf(step).includes(`route:route-${String(number)}`)) {
      number += 1;
    }
    const key = `route-${String(number)}`;
    const target = edgeOn(definition, stepId, 'else')?.to;
    return {
      definition: {
        ...definition,
        steps: replaceStep(definition, {
          ...step,
          routes: [...routes, { key, label: `Route ${String(number)}` }],
        }),
        edges:
          target === undefined
            ? definition.edges
            : [
                ...definition.edges,
                {
                  id: edgeIds(definition)(),
                  from: stepId,
                  'from-port': `route:${key}`,
                  to: target,
                },
              ],
      },
      select: `${stepId}/route:${key}`,
    };
  }
  if (step?.type === 'parallel') {
    const branches = Array.isArray(step.branches) ? (step.branches as readonly unknown[]) : [];
    const key = 'abcdefghij'
      .split('')
      .find((letter) => !portsOf(step).includes(`branch:${letter}`));
    if (branches.length >= MAX_BRANCHES || key === undefined) {
      return null;
    }
    const join = definition.steps.find(
      (candidate) => candidate.type === 'join' && candidate['join-of'] === stepId,
    );
    return {
      definition: {
        ...definition,
        steps: replaceStep(definition, { ...step, branches: [...branches, { key }] }),
        edges:
          join === undefined
            ? definition.edges
            : [
                ...definition.edges,
                {
                  id: edgeIds(definition)(),
                  from: stepId,
                  'from-port': `branch:${key}`,
                  to: join.id,
                },
              ],
      },
      select: `${stepId}/branch:${key}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Moving, connecting, deleting, renaming

/** A step with one way on (`next`), the shape that can swap places in a chain. */
const isChainStep = (step: DraftStep | undefined): step is DraftStep =>
  step !== undefined &&
  step.type !== 'output' &&
  step.type !== 'join' &&
  step.type !== 'module-input' &&
  portsOf(step).includes('next');

const incoming = (definition: DraftDefinition, id: string): readonly DraftEdge[] =>
  definition.edges.filter((edge) => edge.to === id && edge['to-port'] !== CONTINUE_PORT);

/** The edges of an upward move of `stepId`: what leads into its predecessor, and the two links. */
function upwardMove(
  definition: DraftDefinition,
  stepId: string,
): { into: DraftEdge; link: DraftEdge; after: DraftEdge | undefined } | null {
  const step = stepOf(definition, stepId);
  const intoStep = incoming(definition, stepId);
  const [link] = intoStep;
  if (!isChainStep(step) || intoStep.length !== 1 || link?.['from-port'] !== 'next') {
    return null;
  }
  const previous = stepOf(definition, link.from);
  const intoPrevious = incoming(definition, link.from);
  const [into] = intoPrevious;
  if (!isChainStep(previous) || intoPrevious.length !== 1 || into === undefined) {
    return null;
  }
  return { into, link, after: edgeOn(definition, stepId, 'next') };
}

export function canMove(
  definition: DraftDefinition,
  stepId: string,
  direction: Direction,
): boolean {
  return moveStep(definition, stepId, direction) !== null;
}

/**
 * Moves a step one place up or down its chain (C141.2) by rewiring the three edges around it, so
 * the steps around it keep their ids. Only a step with one way in and one way on moves, past a
 * neighbour of the same shape; anything else answers `null`.
 */
export function moveStep(
  definition: DraftDefinition,
  stepId: string,
  direction: Direction,
): Edited | null {
  if (direction === 'down') {
    const next = edgeOn(definition, stepId, 'next')?.to;
    const moved = next === undefined ? null : moveStep(definition, next, 'up');
    return moved === null ? null : { ...moved, select: stepId };
  }
  const move = upwardMove(definition, stepId);
  if (move === null) {
    return null;
  }
  const { into, link, after } = move;
  const previous = link.from;
  const edges = definition.edges.map((edge) => {
    if (edge === into) {
      return { ...edge, to: stepId };
    }
    if (edge === link) {
      return { ...edge, from: stepId, to: previous };
    }
    if (edge === after) {
      return { ...edge, from: previous };
    }
    return edge;
  });
  return { definition: { ...definition, edges }, select: stepId };
}

/** Leads `place` to `to` (C141.2), replacing the edge on the port; `null` when the rules refuse. */
export function connectPort(definition: DraftDefinition, place: Place, to: string): Edited | null {
  if (!canConnect(definition, place.from, place.port, to)) {
    return null;
  }
  const existing = edgeOn(definition, place.from, place.port);
  const edges =
    existing === undefined
      ? [
          ...definition.edges,
          { id: edgeIds(definition)(), from: place.from, 'from-port': place.port, to },
        ]
      : definition.edges.map((edge) => (edge === existing ? { ...edge, to } : edge));
  return { definition: { ...definition, edges }, select: place.from };
}

/**
 * R005 (Workflow 9D; C113.3): the loops whose body reaches `stepId` along forward edges (never
 * through the loop itself), nearest first, so a body step can lead back into one's `continue`.
 */
export function continueTargets(definition: DraftDefinition, stepId: string): readonly string[] {
  const found: { readonly id: string; readonly distance: number }[] = [];
  for (const loop of definition.steps) {
    const start = loop.type === 'loop' ? edgeOn(definition, loop.id, 'body')?.to : undefined;
    if (start === undefined || stepId === loop.id) {
      continue;
    }
    const distance = new Map<string, number>([[start, 0]]);
    const queue = [start];
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      for (const edge of definition.edges) {
        if (
          edge.from === current &&
          edge['to-port'] !== CONTINUE_PORT &&
          edge.to !== loop.id &&
          !distance.has(edge.to)
        ) {
          distance.set(edge.to, (distance.get(current) ?? 0) + 1);
          queue.push(edge.to);
        }
      }
    }
    const reached = distance.get(stepId);
    if (reached !== undefined) {
      found.push({ id: loop.id, distance: reached });
    }
  }
  return found.sort((a, b) => a.distance - b.distance).map((loop) => loop.id);
}

/** R005: `stepId`'s `next` leads back into `loopId`'s `continue` port, the body's back-edge. */
export function connectContinue(
  definition: DraftDefinition,
  stepId: string,
  loopId: string,
): Edited | null {
  const step = stepOf(definition, stepId);
  if (
    step === undefined ||
    !portsOf(step).includes('next') ||
    !continueTargets(definition, stepId).includes(loopId)
  ) {
    return null;
  }
  const existing = edgeOn(definition, stepId, 'next');
  const back: DraftEdge = {
    id: existing?.id ?? edgeIds(definition)(),
    from: stepId,
    'from-port': 'next',
    to: loopId,
    'to-port': CONTINUE_PORT,
  };
  const edges =
    existing === undefined
      ? [...definition.edges, back]
      : definition.edges.map((edge) => (edge === existing ? back : edge));
  return { definition: { ...definition, edges }, select: stepId };
}

export function canDelete(definition: DraftDefinition, stepId: string): boolean {
  const step = stepOf(definition, stepId);
  return (
    step !== undefined &&
    step.type !== 'output' &&
    step.type !== 'join' &&
    step.type !== 'module-input'
  );
}

/** Where what led into a deleted step leads now, and every node that goes with it. */
function removalOf(
  definition: DraftDefinition,
  step: DraftStep,
): { readonly removed: ReadonlySet<string>; readonly onward: string | undefined } {
  switch (step.type) {
    case 'conditional':
      return { removed: new Set([step.id]), onward: edgeOn(definition, step.id, 'else')?.to };
    case 'loop':
      return { removed: new Set([step.id]), onward: edgeOn(definition, step.id, 'done')?.to };
    case 'parallel': {
      const join = definition.steps.find(
        (candidate) => candidate.type === 'join' && candidate['join-of'] === step.id,
      );
      return join === undefined
        ? { removed: new Set([step.id]), onward: undefined }
        : { removed: new Set([step.id, join.id]), onward: edgeOn(definition, join.id, 'next')?.to };
    }
    default:
      return { removed: new Set([step.id]), onward: edgeOn(definition, step.id, 'next')?.to };
  }
}

/**
 * Deletes a step (C141.2; the outline confirms first): what led into it leads to where it led on
 * (a conditional's else, a loop's done, a parallel's join's next), and a parallel goes with its
 * join. Steps only it reached stay, listed as not connected, for the operator to delete or
 * connect. The output, a join on its own and the start cannot be deleted.
 */
export function deleteStep(definition: DraftDefinition, stepId: string): Edited | null {
  const step = stepOf(definition, stepId);
  if (step === undefined || !canDelete(definition, stepId)) {
    return null;
  }
  const { removed, onward } = removalOf(definition, step);
  const leadsOn = onward !== undefined && !removed.has(onward);
  const edges = definition.edges.flatMap((edge) => {
    if (removed.has(edge.from)) {
      return [];
    }
    if (removed.has(edge.to)) {
      // Only what led into the step itself leads on; a branch's way into a join ends with it.
      return leadsOn && edge.to === stepId && edge['to-port'] !== CONTINUE_PORT
        ? [{ ...edge, to: onward }]
        : [];
    }
    return [edge];
  });
  const layout = Object.fromEntries(
    Object.entries(definition.layout).filter(([id]) => !removed.has(id)),
  );
  return {
    definition: {
      ...definition,
      steps: definition.steps.filter((candidate) => !removed.has(candidate.id)),
      edges,
      layout,
    },
    select: leadsOn ? onward : TRIGGER_NODE,
  };
}

/** Renames a step to a trimmed name of 1 to 80 characters (C113.4). */
export function renameStep(
  definition: DraftDefinition,
  stepId: string,
  name: string,
): Edited | null {
  const step = stepOf(definition, stepId);
  const trimmed = name.trim();
  if (step === undefined || trimmed.length === 0 || trimmed.length > MAX_NAME) {
    return null;
  }
  return {
    definition: { ...definition, steps: replaceStep(definition, { ...step, name: trimmed }) },
    select: stepId,
  };
}

/** Positions live only in `layout` (C113.1, C141.3). */
export function placeNode(
  definition: DraftDefinition,
  id: string,
  position: Position,
): DraftDefinition {
  return {
    ...definition,
    layout: { ...definition.layout, [id]: { x: position.x, y: position.y } },
  };
}

export function replaceLayout(
  definition: DraftDefinition,
  layout: Readonly<Record<string, Position>>,
): DraftDefinition {
  return { ...definition, layout };
}

// ---------------------------------------------------------------------------------------------
// Settings: step forms, routes, the trigger and the declarations (C141.4, C141.9)

export type DeclarationMember = 'inputs' | 'variables' | 'outputs';

/** `patch` applied to `value`: a member set to `undefined` is removed. */
function patched(
  value: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...value, ...patch };
  return Object.fromEntries(Object.entries(merged).filter(([, item]) => item !== undefined));
}

/**
 * A step form's change (C141.4): `patch` sets members and removes those set to `undefined`. A
 * step's id and type never change through a form (the diff keys on the id, C113.1).
 */
export function updateStep(
  definition: DraftDefinition,
  stepId: string,
  patch: Readonly<Record<string, unknown>>,
): Edited | null {
  const step = stepOf(definition, stepId);
  if (step === undefined || 'id' in patch || 'type' in patch) {
    return null;
  }
  const next = patched(step, patch) as unknown as DraftStep;
  return { definition: { ...definition, steps: replaceStep(definition, next) }, select: stepId };
}

type Route = Readonly<Record<string, unknown>> & { readonly key: string };

const routesOf = (step: DraftStep | undefined): readonly Route[] =>
  step?.type === 'conditional' && Array.isArray(step.routes)
    ? (step.routes as readonly unknown[]).filter(
        (route): route is Route =>
          isRecord(route) && typeof (route as { key?: unknown }).key === 'string',
      )
    : [];

const withRoutes = (
  definition: DraftDefinition,
  step: DraftStep,
  routes: readonly Route[],
  select: string,
  edges: readonly DraftEdge[] = definition.edges,
): Edited => ({
  definition: { ...definition, steps: replaceStep(definition, { ...step, routes }), edges },
  select,
});

/** A route's label, condition or on-null (C113.2, C114.6); its key never changes. */
export function updateRoute(
  definition: DraftDefinition,
  stepId: string,
  key: string,
  patch: Readonly<Record<string, unknown>>,
): Edited | null {
  const step = stepOf(definition, stepId);
  const routes = routesOf(step);
  if (step === undefined || 'key' in patch || !routes.some((route) => route.key === key)) {
    return null;
  }
  return withRoutes(
    definition,
    step,
    routes.map((route) => (route.key === key ? (patched(route, patch) as Route) : route)),
    `${stepId}/route:${key}`,
  );
}

/** Moves a route one place in the order its conditions are tried (C119.5). */
export function moveRoute(
  definition: DraftDefinition,
  stepId: string,
  key: string,
  direction: Direction,
): Edited | null {
  const step = stepOf(definition, stepId);
  const routes = [...routesOf(step)];
  const index = routes.findIndex((route) => route.key === key);
  const other = direction === 'up' ? index - 1 : index + 1;
  const [moving, swapped] = [routes[index], routes[other]];
  if (step === undefined || moving === undefined || swapped === undefined || other < 0) {
    return null;
  }
  routes[index] = swapped;
  routes[other] = moving;
  return withRoutes(definition, step, routes, `${stepId}/route:${key}`);
}

/** Removes a route with the edge on its port; a conditional keeps at least one route. */
export function removeRoute(
  definition: DraftDefinition,
  stepId: string,
  key: string,
): Edited | null {
  const step = stepOf(definition, stepId);
  const routes = routesOf(step);
  if (step === undefined || routes.length <= 1 || !routes.some((route) => route.key === key)) {
    return null;
  }
  return withRoutes(
    definition,
    step,
    routes.filter((route) => route.key !== key),
    stepId,
    definition.edges.filter(
      (edge) => !(edge.from === stepId && edge['from-port'] === `route:${key}`),
    ),
  );
}

/**
 * The trigger panel's change (C118, C141.9): `patch` sets the per-workflow options and `config`
 * the type's config, each member set to `undefined` removed. Its type changes only through
 * `setTrigger`.
 */
export function updateTrigger(
  definition: DraftDefinition,
  patch: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>,
): Edited | null {
  const { trigger } = definition;
  if (trigger === null || 'type' in patch || 'config' in patch) {
    return null;
  }
  const next = {
    ...patched(trigger, patch),
    config: patched(trigger.config, config),
  } as unknown as DraftTrigger;
  return { definition: { ...definition, trigger: next }, select: TRIGGER_NODE };
}

/** The inputs, variables or outputs panel's list, replaced whole (C113.1, C141.9). */
export function setDeclarations(
  definition: DraftDefinition,
  member: DeclarationMember,
  list: readonly unknown[],
): Edited {
  return { definition: { ...definition, [member]: list }, select: TRIGGER_NODE };
}
