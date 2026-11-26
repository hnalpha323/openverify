/**
 * The shared graph editor's one seam (C155.1, verification round V07): what a document type tells
 * the editor about itself. Phase 8's workflow editor and Phase 9's flow builder are two adapters
 * over the same canvas, history, menus and layout, so a rule is written once per document type and
 * every view of that document (outline, canvas, palette, diff badges) asks the adapter.
 *
 * The adapter is pure: given a document it answers what to draw, which connections the format can
 * express, what a connection or a move edits, where a problem's JSON Pointer lands, which paths a
 * condition may read (with their JSON Schema for the picker) and what the palette offers. The API
 * stays the authority at save and publish; these rules only keep the views from offering what the
 * format cannot express.
 */
import type { AriaLabelConfig } from '@xyflow/react';

/** A node's top-left corner on the canvas. */
export interface GraphPosition {
  readonly x: number;
  readonly y: number;
}

/** A step's mark against the version it is compared with (C116.6, C155.7). */
export type DiffMark = 'added' | 'changed';

/** A problem by JSON Pointer (C113.6, C147.8). */
export interface GraphIssue {
  readonly pointer: string;
  readonly detail: string;
}

/** A status as an icon and a word, never colour alone (WCAG 1.4.1). */
export interface StatusBadge {
  readonly icon: string;
  readonly word: string;
}

/** Each node's status on a run, and the edges the run took (C141.6, C156.6). */
export interface GraphPath {
  readonly statuses: Readonly<Record<string, string>>;
  readonly taken: readonly string[];
}

export interface GraphPortView {
  readonly port: string;
  /** The port in words: "Next", "Route minor", "On error". */
  readonly label: string;
}

export interface GraphNodeView {
  readonly id: string;
  readonly position: GraphPosition;
  /** The node's name, as the outline names it. */
  readonly label: string;
  /** The start node has no way in. */
  readonly start: boolean;
  readonly ports: readonly GraphPortView[];
  /** The problems whose pointer falls inside this node, in words. */
  readonly issues: readonly string[];
  readonly mark: DiffMark | null;
  /** On a run's path: the node's status, or "Not reached". */
  readonly status: StatusBadge | null;
}

export interface GraphEdgeView {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
  /** The port in words, or `null` for a plain next. */
  readonly label: string | null;
  /** On a run's path: whether the run took this edge. */
  readonly taken: boolean;
}

export interface GraphView {
  readonly nodes: readonly GraphNodeView[];
  readonly edges: readonly GraphEdgeView[];
}

/** A connection drawn on the canvas, as the library reports it. */
export interface GraphConnection {
  readonly source: string;
  readonly sourceHandle: string | null;
  readonly target: string;
}

/**
 * A path a condition may read where a node stands (C115.3, C150.2): its type and marks, and where
 * it comes from in words. A flow's facts also carry their tier, stage and source (C150.8, C150.10).
 */
export interface ScopePath {
  readonly path: string;
  /** `string`, `number`, `integer`, `boolean`, `datetime`, `date`, `id`, `enum`, `list`, `object` or `any`. */
  readonly type: string;
  /** An enum's values. */
  readonly options: readonly string[];
  readonly nullable: boolean;
  readonly pii: boolean;
  /** Where it comes from, in words: "Trigger", "Input", "Self-asserted", "Client-reported". */
  readonly source: string;
  /** A flow fact's tier (`R`, `H`, `A`) and stage (`ga`, `beta`), when it has them. */
  readonly tier?: string | null;
  readonly stage?: string | null;
}

/** The types an adapter is over. */
export interface GraphAdapterTypes {
  /** The document the editor holds. */
  readonly document: unknown;
  /** What an edit hands the editor (the edited document and what to select). */
  readonly edit: unknown;
  /** What the palette and the condition scope also read (a catalogue, a field list). */
  readonly context: unknown;
  /** The server's diff of two versions. */
  readonly diff: unknown;
  /** One palette entry. */
  readonly palette: unknown;
}

export interface GraphAdapter<T extends GraphAdapterTypes> {
  /** The document in words, for the canvas's fit-view control: "workflow", "flow". */
  readonly noun: string;
  /** `@xyflow/react`'s strings for this document, from the typed catalog (C155.9). */
  readonly ariaLabels: Partial<AriaLabelConfig>;
  /** Node kinds and ports: what the canvas draws, each node's problems and marks. */
  viewOf(
    document: T['document'],
    issues: readonly GraphIssue[],
    marks: Readonly<Record<string, DiffMark>>,
    path?: GraphPath,
  ): GraphView;
  /** Every output port of a node, in order. */
  portsOf(document: T['document'], nodeId: string): readonly string[];
  portWords(port: string): string;
  /** Whether the format can express this connection (`isValidConnection`). */
  isValidConnection(document: T['document'], connection: GraphConnection): boolean;
  /** The targets a port may lead to, in document order: the outline's "Connect to" list. */
  validTargets(document: T['document'], from: string, port: string): readonly string[];
  /** The edit a connection makes, or `null` where the rules refuse it. */
  connect(document: T['document'], connection: GraphConnection): T['edit'] | null;
  /** The edit a move makes: the layout member only. */
  place(document: T['document'], nodeId: string, position: GraphPosition): T['edit'];
  /** The problem mapper: the node a JSON Pointer falls inside, or `null` for the document. */
  problemNode(document: T['document'], pointer: string): string | null;
  /** The paths a condition at `nodeId` may read. */
  conditionScope(
    document: T['document'],
    nodeId: string,
    context: T['context'],
  ): readonly ScopePath[];
  /** The condition scope's JSON Schema (C115.3, C150.2), which the picker is built from. */
  conditionScopeSchema(
    document: T['document'],
    nodeId: string,
    context: T['context'],
  ): Readonly<Record<string, unknown>>;
  /** What the palette offers at `nodeId` (`null`: the document's end), each refusal in words. */
  paletteOf(
    document: T['document'],
    nodeId: string | null,
    context: T['context'],
  ): readonly T['palette'][];
  /** The diff renderer: each node the server diff added or changed. */
  diffMarksOf(diff: T['diff']): Readonly<Record<string, DiffMark>>;
}

type JsonSchema = Record<string, unknown>;

const JSON_TYPES: Readonly<Record<string, JsonSchema>> = {
  string: { type: 'string' },
  id: { type: 'string' },
  enum: { type: 'string' },
  datetime: { type: 'string', format: 'date-time' },
  date: { type: 'string', format: 'date' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  list: { type: 'array' },
  object: { type: 'object' },
};

/** One path's schema: its type, `null` allowed where nullable, its marks as `x-` members. */
function leafSchema(path: ScopePath): JsonSchema {
  const base = JSON_TYPES[path.type];
  if (base === undefined) {
    return {};
  }
  const schema: JsonSchema = {
    ...base,
    ...(path.nullable ? { type: [base.type, 'null'] } : {}),
    ...(path.type === 'enum'
      ? { enum: path.nullable ? [...path.options, null] : [...path.options] }
      : {}),
  };
  if (path.pii) {
    schema['x-pii'] = true;
  }
  if (path.tier !== undefined && path.tier !== null) {
    schema['x-tier'] = path.tier;
  }
  if (path.stage !== undefined && path.stage !== null) {
    schema['x-stage'] = path.stage;
  }
  return schema;
}

/**
 * The JSON Schema of a list of scope paths (C115.3, C150.2), which the picker is built from: an
 * object per root and per dotted segment, each leaf typed, `null` allowed where the fact can be
 * unknown, and its PII mark, tier and stage as `x-pii`, `x-tier` and `x-stage`.
 */
export function scopePathsSchema(paths: readonly ScopePath[]): Readonly<Record<string, unknown>> {
  const root: JsonSchema = { type: 'object', properties: {} };
  for (const path of paths) {
    const segments = path.path.split('.');
    let node = root;
    segments.forEach((segment, index) => {
      const properties = node.properties as Record<string, JsonSchema>;
      if (index === segments.length - 1) {
        properties[segment] = leafSchema(path);
        return;
      }
      const next = properties[segment] ?? { type: 'object', properties: {} };
      properties[segment] = next;
      node = next;
    });
  }
  return root;
}

/** The problems whose pointer falls inside `prefix`, in words (C113.6). */
export function issuesUnder(issues: readonly GraphIssue[], prefix: string): string[] {
  return issues
    .filter((issue) => issue.pointer === prefix || issue.pointer.startsWith(`${prefix}/`))
    .map((issue) => issue.detail);
}
