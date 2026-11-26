'use client';

/**
 * The workflow canvas (C141.1, C141.3, C141.5): the shared graph editor's canvas (C155.1) over the
 * workflow adapter, drawing the one document model the outline edits. Everything the canvas does
 * (client-only rendering, the bundled stylesheet, named nodes with their problem badges, the port
 * rules on every connection, moves that write only the layout member, nothing deleted) is
 * `graph-editor/graph-canvas.tsx`'s; the workflow's rules are `workflow-adapter.ts`'.
 */
import { GraphCanvas } from '../../graph-editor/graph-canvas';
import type { CanvasIssue, DiffMark, RunPath } from './canvas-model';
import type { DraftDefinition, Edited } from './document-model';
import { WORKFLOW_ADAPTER } from './workflow-adapter';

export interface WorkflowCanvasProps {
  readonly definition: DraftDefinition;
  readonly issues: readonly CanvasIssue[];
  readonly marks: Readonly<Record<string, DiffMark>>;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** `undefined` read-only. A connection made on the canvas, or a node moved (one gesture). */
  readonly onEdit?: (edited: Edited, message: string, gesture?: string) => void;
  /** C141.6: a run's path, drawn over the read-only canvas. */
  readonly path?: RunPath;
}

/** The canvas (C141.1, C141.3), rendered on the client only. */
export function WorkflowCanvas({ definition, ...props }: WorkflowCanvasProps) {
  return <GraphCanvas adapter={WORKFLOW_ADAPTER} document={definition} {...props} />;
}
