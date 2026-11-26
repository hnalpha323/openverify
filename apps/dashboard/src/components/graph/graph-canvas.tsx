'use client';

import type cytoscape from 'cytoscape';
import type { Core, Ext } from 'cytoscape';
import { Button } from '@openverify/ui';
import { useEffect, useRef, useState } from 'react';
import {
  CANVAS_OPTIONS,
  INITIAL_LAYOUT,
  asLayout,
  canvasStyle,
  elementsOf,
  layoutAdded,
} from './canvas-model';
import type { ExplorerGraph } from './explorer-model';
import { GRAPH_NODE_STYLES, graphKindLabel, type GraphNodeType } from './graph-words';

/** What the canvas loads on mount: Cytoscape.js and fCoSE. */
export interface CanvasLibrary {
  readonly cytoscape: typeof cytoscape;
  readonly fcose: Ext;
}

export interface GraphCanvasProps {
  readonly graph: ExplorerGraph;
  readonly selected: ReadonlySet<string>;
  readonly onSelectionChange: (next: ReadonlySet<string>) => void;
  /** Loads the library; a dynamic import by default. */
  readonly load?: () => Promise<CanvasLibrary>;
}

/**
 * The library, as its own chunks: imported only here, when the canvas mounts, so no other page
 * (and not the explorer's table view) carries it.
 */
async function loadCanvasLibrary(): Promise<CanvasLibrary> {
  const [core, layout] = await Promise.all([import('cytoscape'), import('cytoscape-fcose')]);
  return { cytoscape: core.default, fcose: layout.default };
}

/**
 * Cytoscape.js inserts `<style id="__________cytoscape_stylesheet">` into the head unless an
 * element of that id exists, and the console's `style-src` (C170.1: a nonce, no
 * `'unsafe-inline'`) refuses it. An empty `<meta>` of that id is put there first, and the
 * container is positioned by its own `relative` class, which is all that stylesheet did.
 */
const CYTOSCAPE_STYLESHEET_ID = '__________cytoscape_stylesheet';

function claimCytoscapeStylesheet(document: Document): void {
  if (document.getElementById(CYTOSCAPE_STYLESHEET_ID) === null) {
    const marker = document.createElement('meta');
    marker.id = CYTOSCAPE_STYLESHEET_ID;
    document.head.append(marker);
  }
}

/** The factories fCoSE was registered with: Cytoscape.js refuses a second registration. */
const registered = new WeakSet<object>();

const ZOOM_STEP = 1.25;
const PAN_STEP = 80;

type Phase = 'loading' | 'ready' | 'failed';

const CONTROLS = [
  'Zoom in',
  'Zoom out',
  'Pan left',
  'Pan right',
  'Pan up',
  'Pan down',
  'Fit the graph',
] as const;
type Control = (typeof CONTROLS)[number];

const count = (value: number, one: string, many: string) =>
  `${String(value)} ${value === 1 ? one : many}`;

/**
 * The canvas view of a graph result (C108): Cytoscape.js on its canvas renderer, WebGL off, laid
 * out by fCoSE without animation, at most 2,000 nodes (the API's node limit and the merge's).
 * Selection is shared with the table view; an expansion merged into `graph` is drawn without
 * moving what was drawn. A text alternative, a legend naming each kind's shape, and buttons to
 * zoom, pan and fit go with it, so nothing needs a drag and nothing is told by colour alone; the
 * table view stays the default and lists the same result.
 */
export function GraphCanvas({
  graph,
  selected,
  onSelectionChange,
  load = loadCanvasLibrary,
}: GraphCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const drawn = useRef<ExplorerGraph>(graph);
  const syncing = useRef(false);
  const latest = useRef({ graph, selected, onSelectionChange });
  const [phase, setPhase] = useState<Phase>('loading');

  useEffect(() => {
    latest.current = { graph, selected, onSelectionChange };
  });

  const applySelection = (cy: Core, ids: ReadonlySet<string>) => {
    syncing.current = true;
    try {
      cy.nodes().forEach((node) => {
        if (ids.has(node.id())) {
          node.select();
        } else {
          node.unselect();
        }
      });
    } finally {
      syncing.current = false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    load().then(
      ({ cytoscape: factory, fcose }) => {
        if (cancelled || container.current === null) {
          return;
        }
        if (!registered.has(factory)) {
          factory.use(fcose);
          registered.add(factory);
        }
        const start = latest.current.graph;
        claimCytoscapeStylesheet(container.current.ownerDocument);
        const cy = factory({
          container: container.current,
          elements: elementsOf(start),
          style: canvasStyle(),
          layout: asLayout(INITIAL_LAYOUT),
          ...CANVAS_OPTIONS,
          autoungrabify: true,
          boxSelectionEnabled: false,
          selectionType: 'additive',
          minZoom: 0.05,
          maxZoom: 4,
        } as cytoscape.CytoscapeOptions);
        drawn.current = start;
        applySelection(cy, latest.current.selected);
        cy.on('select unselect', 'node', () => {
          if (!syncing.current) {
            latest.current.onSelectionChange(
              new Set(cy.nodes(':selected').map((node) => node.id())),
            );
          }
        });
        cyRef.current = cy;
        setPhase('ready');
      },
      () => {
        if (!cancelled) {
          setPhase('failed');
        }
      },
    );
    return () => {
      cancelled = true;
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [load]);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null || phase !== 'ready' || graph === drawn.current) {
      return;
    }
    layoutAdded(cy, drawn.current, graph);
    drawn.current = graph;
    applySelection(cy, latest.current.selected);
  }, [graph, phase]);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy !== null && phase === 'ready') {
      applySelection(cy, selected);
    }
  }, [selected, phase]);

  const accounts = graph.nodes.filter((node) => node.type === 'account').length;
  const values = graph.nodes.length - accounts;
  const types = (Object.keys(GRAPH_NODE_STYLES) as GraphNodeType[]).filter((type) =>
    graph.nodes.some((node) => node.type === type),
  );

  /** Runs `move` on the drawing, once it is ready; called from a button, never in render. */
  function move(run: (cy: Core) => void) {
    const cy = cyRef.current;
    if (cy !== null) {
      run(cy);
    }
  }
  function zoomBy(factor: number) {
    move((cy) => {
      cy.zoom({
        level: cy.zoom() * factor,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      });
    });
  }
  function panBy(x: number, y: number) {
    move((cy) => {
      cy.panBy({ x, y });
    });
  }
  function onControl(control: Control) {
    switch (control) {
      case 'Zoom in':
        zoomBy(ZOOM_STEP);
        break;
      case 'Zoom out':
        zoomBy(1 / ZOOM_STEP);
        break;
      case 'Pan left':
        panBy(PAN_STEP, 0);
        break;
      case 'Pan right':
        panBy(-PAN_STEP, 0);
        break;
      case 'Pan up':
        panBy(0, PAN_STEP);
        break;
      case 'Pan down':
        panBy(0, -PAN_STEP);
        break;
      case 'Fit the graph':
        move((cy) => {
          cy.fit(undefined, 24);
        });
        break;
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Canvas controls">
        {CONTROLS.map((control) => (
          <Button
            key={control}
            variant="secondary"
            disabled={phase !== 'ready'}
            onClick={() => {
              onControl(control);
            }}
          >
            {control}
          </Button>
        ))}
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {phase === 'loading' ? 'Loading the canvas…' : ''}
      </p>
      {phase === 'failed' && (
        <p className="text-sm text-ink">
          The canvas could not be loaded. The table view shows the same result.
        </p>
      )}
      <div
        ref={container}
        role="img"
        aria-label={`Graph of ${count(accounts, 'account', 'accounts')} and ${count(values, 'shared value', 'shared values')}. The table view lists the same result.`}
        className="relative h-[32rem] w-full rounded-xl border border-line bg-white"
      />
      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {types.map((type) => (
          <li key={type} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-3 rounded-sm"
              style={{ backgroundColor: GRAPH_NODE_STYLES[type].colour }}
            />
            {`${graphKindLabel(type)}: ${GRAPH_NODE_STYLES[type].shapeName}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
