/**
 * The canvas's pointer gestures as data (C141.3, C155.1): what a batch of node changes from
 * `@xyflow/react` selects, keeps dragging, or places (a moved node writes only the layout member,
 * at whole pixels, as one gesture), and what a connection drawn on the canvas edits, through the
 * adapter's port rules, the ones the outline uses. Nothing here deletes a node.
 */
import type {
  GraphAdapter,
  GraphAdapterTypes,
  GraphConnection,
  GraphPosition,
} from './graph-adapter';

/** The members of a node change the canvas reads (the library's `NodeChange` fits it). */
export interface GraphNodeChange {
  readonly type: string;
  readonly id?: string;
  readonly selected?: boolean;
  readonly position?: GraphPosition;
  readonly dragging?: boolean;
}

/** An edit the canvas hands the editor: the edit, its message and its gesture. */
export interface GraphCanvasEdit<Edit> {
  readonly edited: Edit;
  readonly message: string;
  readonly gesture?: string;
}

export interface GraphChanges<Edit> {
  /** The nodes selected, in order. */
  readonly select: readonly string[];
  /** The nodes still being dragged, at their place now. */
  readonly dragging: Readonly<Record<string, GraphPosition>>;
  /** The nodes released, whose drag place is dropped. */
  readonly released: readonly string[];
  /** One edit per node released, each placing it. */
  readonly edits: readonly GraphCanvasEdit<Edit>[];
}

/** What `changes` select, drag and place; a read-only canvas (`editable` false) only selects. */
export function graphChangesOf<T extends GraphAdapterTypes>(
  adapter: GraphAdapter<T>,
  document: T['document'],
  changes: readonly GraphNodeChange[],
  labels: ReadonlyMap<string, string>,
  editable: boolean,
): GraphChanges<T['edit']> {
  const select: string[] = [];
  const dragging: Record<string, GraphPosition> = {};
  const released: string[] = [];
  const edits: GraphCanvasEdit<T['edit']>[] = [];
  for (const change of changes) {
    const { id } = change;
    if (id === undefined) {
      continue;
    }
    if (change.type === 'select' && change.selected === true) {
      select.push(id);
    }
    if (change.type !== 'position' || change.position === undefined || !editable) {
      continue;
    }
    const { position } = change;
    if (change.dragging === true) {
      dragging[id] = position;
      continue;
    }
    released.push(id);
    edits.push({
      edited: adapter.place(document, id, {
        x: Math.round(position.x),
        y: Math.round(position.y),
      }),
      message: `Moved ${labels.get(id) ?? id} on the canvas.`,
      gesture: `move:${id}`,
    });
  }
  return { select, dragging, released, edits };
}

/** The edit a connection drawn on the canvas makes, or `null` where the port rules refuse it. */
export function graphConnectionOf<T extends GraphAdapterTypes>(
  adapter: GraphAdapter<T>,
  document: T['document'],
  connection: GraphConnection,
  labels: ReadonlyMap<string, string>,
): GraphCanvasEdit<T['edit']> | null {
  if (connection.sourceHandle === null) {
    return null;
  }
  const edited = adapter.connect(document, connection);
  return edited === null
    ? null
    : {
        edited,
        message: `Connected ${labels.get(connection.source) ?? connection.source} to ${labels.get(connection.target) ?? connection.target}.`,
      };
}
