/**
 * The shared graph editor's own words (C155.9; decision 33): the canvas's badges and names, and
 * `@xyflow/react`'s strings through `ariaLabelConfig`, one set per document type, so a later
 * translation of the console changes them here. `dashboard-flow-builder`'s.
 */
import type { AriaLabelConfig } from '@xyflow/react';
import { defineCopy } from './catalog';

const counted = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * The library's strings for a document whose nodes are called `node` ("step") and which is called
 * `noun` ("workflow"). At 12.12.0 the library shows `keyboardDisabled` while its keyboard access is
 * on (the words that name the arrow keys) and `default` when it is off, so the words follow what is
 * shown (Phase 8 C141.3's record of the quirk).
 */
function ariaLabels(node: string, noun: string) {
  return {
    'node.a11yDescription.default': `A ${node} on the canvas. The outline beside the canvas lists every ${node} and edits them by keyboard.`,
    'node.a11yDescription.keyboardDisabled': `A ${node} on the canvas. Enter or Space selects it, and the arrow keys move it. The outline beside the canvas lists every ${node} and edits them by keyboard.`,
    'node.a11yDescription.ariaLiveMessage': ({
      direction,
      x,
      y,
    }: {
      direction: string;
      x: number;
      y: number;
    }) => `Moved the ${node} ${direction}, to ${String(x)}, ${String(y)}.`,
    'edge.a11yDescription.default': `A path between two ${node}s. The outline’s Connect next ${node} to changes where it leads.`,
    'controls.ariaLabel': 'Canvas view',
    'controls.zoomIn.ariaLabel': 'Zoom in',
    'controls.zoomOut.ariaLabel': 'Zoom out',
    'controls.fitView.ariaLabel': `Fit the ${noun} in view`,
    'controls.interactive.ariaLabel': `Turn moving ${node}s on or off`,
    'minimap.ariaLabel': 'Overview of the canvas',
    'handle.ariaLabel': `A port of the ${node}`,
  } satisfies Partial<AriaLabelConfig>;
}

export const GRAPH_EDITOR_COPY = defineCopy({
  canvas: {
    waiting: 'The canvas draws once the page has loaded; the outline lists every step.',
    next: 'Next',
    into: (label: string) => `Into ${label}`,
    portOf: (port: string, label: string) => `${port} of ${label}`,
    errors: (count: number) => counted(count, 'error', 'errors'),
    /** An edge's name; `taken` is `null` when no run is drawn. */
    edge: (port: string, from: string, to: string, taken: boolean | null) =>
      `${port}: from ${from} to ${to}${taken === null ? '' : taken ? ', taken by this run' : ', not taken'}`,
    marks: {
      added: { icon: '+', word: 'Added' },
      changed: { icon: '~', word: 'Changed' },
    },
  },
  ariaLabels: {
    workflow: ariaLabels('step', 'workflow'),
    flow: ariaLabels('step', 'flow'),
  },
});
