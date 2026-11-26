'use client';

/**
 * The run-overlay slot (C156.6, K4; verification round V07): the workflow's test-run panel renders
 * it with the selected sandbox test run, over the version's read-only canvas and its outline. Each
 * step's state is an icon and a word (succeeded, failed, skipped, waiting, overridden), never colour
 * alone. It reuses Phase 8's path model and drawing (`runPathOf`, `pathListOf`, `RunPathCanvas`;
 * 8D amendments 23 and 24), and adds the overridden state: a step whose output the test overrode
 * reads "Overridden" whatever it then did. Created by `dashboard-flow-builder` at
 * `[9c-checkpoint:graph-editor]`; filled by `dashboard-preview`.
 */
import { useId } from 'react';
import { PREVIEW_COPY } from '../../../lib/copy/preview';
import {
  pathListOf,
  runPathOf,
  type RunPath,
  type RunStepRow,
  type StatusBadge,
} from '../editor/canvas-model';
import type { DraftDefinition } from '../editor/document-model';
import { RunPathCanvas } from '../editor/run-path-canvas';

/** One step row of the test run, as the overlay reads it. */
export interface OverlayStepRow extends RunStepRow {
  /** The step's output was overridden for the test (C120.7). */
  readonly overridden: boolean;
  /** The step only simulated its effect (C120.7). */
  readonly simulated: boolean;
}

export interface RunOverlayProps {
  /**
   * The version's graph structure only (`structureOf`): ids, types, names, route keys, edges and
   * layout, never a step's configuration.
   */
  readonly definition: DraftDefinition;
  /** The selected sandbox test run with its step rows, oldest first, or `null` before one. */
  readonly run: {
    readonly id: string;
    readonly status: string;
    readonly steps: readonly OverlayStepRow[];
  } | null;
}

/** The status the overlay gives an overridden step, on the list and the canvas. */
export const OVERRIDDEN_STATUS = 'overridden';
const OVERRIDDEN_BADGE: StatusBadge = { icon: '✎', word: PREVIEW_COPY.overlay.states.overridden };

/**
 * The run's path with each overridden step marked overridden. The edges taken are computed from the
 * statuses the run recorded, so an overridden step that led on keeps its edges.
 */
export function overlayPathOf(
  definition: DraftDefinition,
  steps: readonly OverlayStepRow[],
): RunPath {
  const path = runPathOf(definition, steps);
  const overridden = steps.filter((row) => row.overridden).map((row) => row.nodeId);
  return {
    ...path,
    statuses: {
      ...path.statuses,
      ...Object.fromEntries(overridden.map((id) => [id, OVERRIDDEN_STATUS])),
    },
  };
}

export function RunOverlay({ definition, run }: RunOverlayProps) {
  const headingId = useId();
  const copy = PREVIEW_COPY.overlay;
  if (run === null) {
    return <p className="text-sm text-ink-muted">{copy.none}</p>;
  }
  const recorded = runPathOf(definition, run.steps);
  const path = overlayPathOf(definition, run.steps);
  const simulated = new Set(run.steps.filter((row) => row.simulated).map((row) => row.nodeId));
  const items = pathListOf(definition, recorded).map((item) =>
    path.statuses[item.id] === OVERRIDDEN_STATUS ? { ...item, badge: OVERRIDDEN_BADGE } : item,
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-semibold text-ink">
        {copy.heading}
      </h3>
      <p className="text-sm text-ink-muted">{copy.description}</p>
      <ol aria-label={copy.listLabel} className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <li key={item.id}>
            {`${item.label}: `}
            <span aria-hidden="true">{item.badge.icon}</span>
            {` ${item.badge.word}`}
            {simulated.has(item.id) ? ` (${copy.simulatedEffect})` : ''}
          </li>
        ))}
      </ol>
      <RunPathCanvas definition={definition} path={path} />
    </section>
  );
}
