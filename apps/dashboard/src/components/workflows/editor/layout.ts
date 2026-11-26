/**
 * "Tidy up" (C141.3, editor note 2.2) for a workflow: the shared graph editor's `tidyGraph`
 * (C155.1) over the trigger and every step. Positions go only into the definition's `layout`
 * member, and the editor applies them as one undoable command. A loop body's back-edge and an edge
 * to a node that does not exist are left out of the layout.
 */
import { tidyGraph } from '../../graph-editor/layout';
import type { DraftDefinition, Position } from './document-model';
import { CONTINUE_PORT, TRIGGER_NODE } from './port-rules';

export { NODE_HEIGHT, NODE_WIDTH } from '../../graph-editor/layout';

/** Every node's top-left corner, top to bottom, whatever the layout member held. */
export function tidyLayout(definition: DraftDefinition): Record<string, Position> {
  return tidyGraph(
    [
      ...(definition.trigger === null ? [] : [TRIGGER_NODE]),
      ...definition.steps.map((step) => step.id),
    ],
    definition.edges.filter((edge) => edge['to-port'] !== CONTINUE_PORT),
  );
}
