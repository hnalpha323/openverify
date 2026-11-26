/**
 * The canvas's pointer gestures as data (C141.3, Workflow 8D review R005), for a workflow: the
 * shared graph editor's `graph-changes` (C155.1) over the workflow adapter. A moved node writes only
 * the layout member, at whole pixels, as one gesture; a connection goes through the same port rules
 * as the outline; nothing here deletes a step.
 */
import {
  graphChangesOf,
  graphConnectionOf,
  type GraphCanvasEdit,
  type GraphChanges,
  type GraphNodeChange,
} from '../../graph-editor/graph-changes';
import type { CanvasConnection } from './canvas-model';
import type { DraftDefinition, Edited } from './document-model';
import { WORKFLOW_ADAPTER } from './workflow-adapter';

/** The members of a node change the canvas reads (the library's `NodeChange` fits it). */
export type CanvasNodeChange = GraphNodeChange;

/** An edit the canvas hands the editor: the edited document, its message and its gesture. */
export type CanvasEdit = GraphCanvasEdit<Edited>;

export type CanvasChanges = GraphChanges<Edited>;

/** What `changes` select, drag and place; a read-only canvas (`editable` false) only selects. */
export function canvasChangesOf(
  definition: DraftDefinition,
  changes: readonly CanvasNodeChange[],
  labels: ReadonlyMap<string, string>,
  editable: boolean,
): CanvasChanges {
  return graphChangesOf(WORKFLOW_ADAPTER, definition, changes, labels, editable);
}

/** The edit a connection drawn on the canvas makes, or `null` where the port rules refuse it. */
export function canvasConnectionOf(
  definition: DraftDefinition,
  connection: CanvasConnection,
  labels: ReadonlyMap<string, string>,
): CanvasEdit | null {
  return graphConnectionOf(WORKFLOW_ADAPTER, definition, connection, labels);
}
