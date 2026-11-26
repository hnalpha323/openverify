/**
 * The canvas library's own strings (C141.3), replaced through `ariaLabelConfig` by the console's
 * words. They live in the typed English catalog (`lib/copy/graph-editor.ts`, C155.9), so a later
 * translation changes them there with the rest of the console, and a node's description points to
 * the outline, the canvas's keyboard equivalent (C141.2).
 */
import type { AriaLabelConfig } from '@xyflow/react';
import { GRAPH_EDITOR_COPY } from '../../../lib/copy/graph-editor';

export const CANVAS_ARIA_LABELS: Partial<AriaLabelConfig> = GRAPH_EDITOR_COPY.ariaLabels.workflow;
