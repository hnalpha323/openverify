'use client';

/**
 * A run's path over the read-only canvas (C141.6, C141.9): the version's graph with each node's
 * status as an icon and a word, and the edges the run took drawn heavier and named "taken". Nothing
 * is edited here, and the definition it is given holds the graph's structure only, never a step's
 * configuration. Selecting a node only marks it.
 */
import { useState } from 'react';
import type { RunPath } from './canvas-model';
import type { DraftDefinition } from './document-model';
import { WorkflowCanvas } from './workflow-canvas';

export interface RunPathCanvasProps {
  readonly definition: DraftDefinition;
  readonly path: RunPath;
}

const NO_ISSUES: readonly never[] = [];
const NO_MARKS = {};

export function RunPathCanvas({ definition, path }: RunPathCanvasProps) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <WorkflowCanvas
      definition={definition}
      issues={NO_ISSUES}
      marks={NO_MARKS}
      selectedId={selected}
      onSelect={setSelected}
      path={path}
    />
  );
}
