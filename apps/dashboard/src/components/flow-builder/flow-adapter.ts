/**
 * The flow document type of the shared graph editor (C155.1): flow-spec v2 behind the
 * `GraphAdapter` seam. Its nodes are the steps and its ports those of C147.4; every connection
 * runs `connectionProblem` (the canvas never draws a graph the format cannot express, C155.11); a
 * condition reads `flowScopeAt`'s paths (the same function the publish analysis types against),
 * each with its tier, stage and source in words (C150.8, C150.10), and never a path the flow cannot
 * read (`lists.*`, a signal that is not flow-provisional; C150.2).
 */
import {
  VERIFICATION_STEP_TYPES,
  flowScopeAt,
  type FlowScopeContext,
  type FlowV2,
  type FlowV2StepType,
} from '@openverify/flow-spec';
import type { TemplateVersionDiff } from '../../lib/api/inquiry-template-versions';
import { FLOW_BUILDER_COPY } from '../../lib/copy/flow-builder';
import { GRAPH_EDITOR_COPY } from '../../lib/copy/graph-editor';
import {
  issuesUnder,
  scopePathsSchema,
  type GraphAdapter,
  type GraphAdapterTypes,
  type GraphNodeView,
  type GraphPosition,
  type ScopePath,
  type StatusBadge,
} from '../graph-editor/graph-adapter';
import { tidyGraph } from '../graph-editor/layout';
import {
  BUILDER_STEP_TYPES,
  connectFlowPort,
  connectionProblem,
  idsOf,
  opaqueId,
  placeFlowStep,
  stepOf,
  stepPorts,
  validFlowTargets,
} from './flow-model';
import { flowPortLabel, flowProblemStep, flowStepLabel } from './flow-outline-model';

export interface FlowEdit {
  readonly flow: FlowV2;
  readonly select?: string;
}

export interface FlowPaletteEntry {
  readonly type: FlowV2StepType;
  readonly label: string;
  /** Why it cannot be added here, else `null`. */
  readonly refusal: string | null;
}

/** What the scope reads besides the flow: the version's fields, checks, signals and outputs. */
export type FlowAdapterContext = FlowScopeContext;

export interface FlowAdapterTypes extends GraphAdapterTypes {
  readonly document: FlowV2;
  readonly edit: FlowEdit;
  readonly context: FlowAdapterContext;
  readonly diff: Pick<TemplateVersionDiff, 'steps'>;
  readonly palette: FlowPaletteEntry;
}

const copy = FLOW_BUILDER_COPY;

const VERIFICATION_TYPES: ReadonlySet<string> = new Set(VERIFICATION_STEP_TYPES);

/** One draw in [0, 1) from the platform's cryptographic source, for opaque ids. */
function randomUnit(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 2 ** 32;
}

/** A status on a run's path, as an icon and a word (C156.6 draws the flow's). */
function statusOf(status: string | undefined): StatusBadge {
  return status === undefined ? { icon: '–', word: 'Not reached' } : { icon: '•', word: status };
}

function positionsOf(flow: FlowV2): (id: string) => GraphPosition {
  const layout = flow.layout ?? {};
  const missing = flow.steps.some((step) => layout[step.id] === undefined);
  const tidy = missing
    ? tidyGraph(
        flow.steps.map((step) => step.id),
        flow.edges,
      )
    : {};
  return (id) => layout[id] ?? tidy[id] ?? { x: 0, y: 0 };
}

function scopeOf(flow: FlowV2, nodeId: string, context: FlowAdapterContext): ScopePath[] {
  return flowScopeAt(flow, nodeId, context)
    .paths.filter((path) => path.availableInFlow !== false)
    .map((path) => ({
      path: path.path,
      type: path.type,
      options: path.options ?? [],
      nullable: path.nullable,
      pii: path.pii,
      source: copy.sources[path.source],
      tier: path.tier,
      stage: path.stage,
    }));
}

export const FLOW_ADAPTER: GraphAdapter<FlowAdapterTypes> = {
  noun: 'flow',
  ariaLabels: GRAPH_EDITOR_COPY.ariaLabels.flow,
  viewOf(flow, issues, marks, path) {
    const at = positionsOf(flow);
    const nodes = flow.steps.map((step, index): GraphNodeView => ({
      id: step.id,
      position: at(step.id),
      label: flowStepLabel(flow, step),
      start: step.id === flow.entry,
      ports: stepPorts(step).map((port) => ({ port, label: flowPortLabel(step, port) })),
      issues: [
        ...issuesUnder(issues, `/steps/${String(index)}`),
        ...issuesUnder(issues, `/flow/steps/${String(index)}`),
      ],
      mark: marks[step.id] ?? null,
      status: path === undefined ? null : statusOf(path.statuses[step.id]),
    }));
    const edges = flow.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      sourceHandle: edge.port,
      target: edge.to,
      targetHandle: 'in',
      label: edge.port === 'next' ? null : flowPortLabel(stepOf(flow, edge.from), edge.port),
      taken: path?.taken.includes(edge.id) ?? false,
    }));
    return { nodes, edges };
  },
  portsOf: (flow, nodeId) => {
    const step = stepOf(flow, nodeId);
    return step === undefined ? [] : stepPorts(step);
  },
  portWords: (port) => flowPortLabel(undefined, port),
  isValidConnection: (flow, connection) =>
    connection.sourceHandle !== null &&
    connectionProblem(flow, connection.source, connection.sourceHandle, connection.target) === null,
  validTargets: validFlowTargets,
  connect(flow, connection) {
    if (
      connection.sourceHandle === null ||
      connectionProblem(flow, connection.source, connection.sourceHandle, connection.target) !==
        null
    ) {
      return null;
    }
    const edgeId = opaqueId('e', randomUnit, idsOf(flow));
    return {
      flow: connectFlowPort(
        flow,
        connection.source,
        connection.sourceHandle,
        connection.target,
        edgeId,
      ),
      select: connection.target,
    };
  },
  place: (flow, nodeId, position) => ({
    flow: placeFlowStep(flow, nodeId, position),
    select: nodeId,
  }),
  problemNode: flowProblemStep,
  conditionScope: scopeOf,
  conditionScopeSchema: (flow, nodeId, context) => scopePathsSchema(scopeOf(flow, nodeId, context)),
  paletteOf(flow, nodeId) {
    const at = nodeId === null ? undefined : stepOf(flow, nodeId);
    const ends = at !== undefined && stepPorts(at).length === 0;
    return BUILDER_STEP_TYPES.map((type) => {
      const label = copy.stepTypes[type];
      const taken = VERIFICATION_TYPES.has(type) && flow.steps.some((step) => step.type === type);
      return {
        type,
        label,
        refusal: ends
          ? copy.palette.endsTheFlow(copy.stepTypes[at.type])
          : taken
            ? copy.palette.oneOfEachVerification(label)
            : null,
      };
    });
  },
  diffMarksOf: (diff) =>
    Object.fromEntries([
      ...diff.steps.added.map((id) => [id, 'added'] as const),
      ...diff.steps.changed.map((change) => [change['step-id'], 'changed'] as const),
    ]),
};
