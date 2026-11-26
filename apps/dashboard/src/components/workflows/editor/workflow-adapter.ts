/**
 * The workflow document type of the shared graph editor (C141, C155.1): Phase 8's rules behind the
 * `GraphAdapter` seam, so the canvas, the outline and the palette of a workflow ask the same
 * functions they always did (`canvas-model`, `port-rules`, `variable-scope`, `palette-model`).
 */
import {
  scopePathsSchema,
  type GraphAdapter,
  type GraphAdapterTypes,
} from '../../graph-editor/graph-adapter';
import { canvasOf, connectionOf, diffMarksOf } from './canvas-model';
import { CANVAS_ARIA_LABELS } from './canvas-words';
import { placeNode, type DraftDefinition, type Edited } from './document-model';
import { paletteOf, type CatalogueAction, type PaletteEntry } from './palette-model';
import { TRIGGER_NODE, portWords, portsOf, validTargets } from './port-rules';
import { scopeAt, type ScopePath } from './variable-scope';

/** What the workflow's palette and condition scope also read. */
export interface WorkflowAdapterContext {
  readonly actions: readonly CatalogueAction[];
  readonly triggerPaths: readonly ScopePath[];
}

export interface WorkflowAdapterTypes extends GraphAdapterTypes {
  readonly document: DraftDefinition;
  readonly edit: Edited;
  readonly context: WorkflowAdapterContext;
  readonly diff: {
    readonly steps: {
      readonly added: readonly string[];
      readonly changed: readonly { readonly id: string }[];
    };
  };
  readonly palette: PaletteEntry;
}

const STEP_POINTER = /^\/steps\/(\d+)(?:\/|$)/;

export const WORKFLOW_ADAPTER: GraphAdapter<WorkflowAdapterTypes> = {
  noun: 'workflow',
  ariaLabels: CANVAS_ARIA_LABELS,
  viewOf(definition, issues, marks, path) {
    const { nodes, edges } = canvasOf(definition, issues, marks, path);
    return {
      nodes: nodes.map((node) => ({ id: node.id, position: node.position, ...node.data })),
      edges,
    };
  },
  portsOf(definition, nodeId) {
    if (nodeId === TRIGGER_NODE) {
      return portsOf(null);
    }
    const step = definition.steps.find((candidate) => candidate.id === nodeId);
    return step === undefined ? [] : portsOf(step);
  },
  portWords,
  isValidConnection: (definition, connection) => connectionOf(definition, connection) !== null,
  validTargets,
  connect: connectionOf,
  place: (definition, nodeId, position) => ({
    definition: placeNode(definition, nodeId, position),
    select: nodeId,
  }),
  problemNode(definition, pointer) {
    if (
      definition.trigger !== null &&
      (pointer === '/trigger' || pointer.startsWith('/trigger/'))
    ) {
      return TRIGGER_NODE;
    }
    const match = STEP_POINTER.exec(pointer);
    return match === null ? null : (definition.steps[Number(match[1])]?.id ?? null);
  },
  conditionScope: (definition, nodeId, context) =>
    scopeAt(definition, nodeId, context.actions, context.triggerPaths),
  conditionScopeSchema: (definition, nodeId, context) =>
    scopePathsSchema(scopeAt(definition, nodeId, context.actions, context.triggerPaths)),
  paletteOf: (definition, _nodeId, context) =>
    paletteOf(context.actions, definition.trigger?.type ?? null),
  diffMarksOf,
};
