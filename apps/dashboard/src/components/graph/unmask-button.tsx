'use client';

import { Button } from '@openverify/ui';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ProblemDisplay } from '../problem-display';
import { useFormAction } from '../use-form-action';
import { describeGraphProblem, graphKindLabel, type GraphNodeType } from './graph-words';

/** The server action behind the unmask: `GET /graph-queries/:id/nodes/:nodeId/value`. */
export type UnmaskAction = (
  state: ActionState<{ value: string | null }>,
  formData: FormData,
) => Promise<ActionResult<{ value: string | null }>>;

export interface UnmaskButtonProps {
  readonly queryId: string;
  readonly nodeId: string;
  readonly type: GraphNodeType;
  readonly unmask: UnmaskAction;
}

type Shown = { readonly value: string | null } | null;

/**
 * The audited click-to-unmask of one node (C102.6, P17). The value is asked for only when the
 * operator presses the button (a click, Enter or Space), never on hover or focus; the API checks
 * `pii:view`, applies the `graph-unmask` policy and writes an audit entry. The page renders this
 * only for a principal with `pii:view`; the value lives in this component's state, never in the
 * server-rendered page.
 */
export function UnmaskButton({ queryId, nodeId, type, unmask }: UnmaskButtonProps) {
  const [shown, setShown] = useState<Shown>(null);
  const form = useFormAction(unmask, {
    onSuccess: (data) => {
      setShown(data);
    },
  });
  const label = `Show the value of ${graphKindLabel(type)} ${nodeId}`;

  if (shown !== null) {
    return (
      <span className="flex flex-col gap-0.5">
        {shown.value === null ? (
          <span className="text-ink-muted">No value is held for this node any more.</span>
        ) : (
          <span className="font-mono text-xs break-all text-ink">{shown.value}</span>
        )}
        <span role="status" className="text-xs text-ink-muted">
          Shown and recorded in the audit log.
        </span>
      </span>
    );
  }
  return (
    <form {...form.formProps} className="flex flex-col items-start gap-1">
      <span className="text-ink-muted">Hidden value</span>
      <input type="hidden" name="graph-query-id" value={queryId} />
      <input type="hidden" name="node-id" value={nodeId} />
      <Button type="submit" variant="secondary" disabled={form.pending} aria-label={label}>
        {form.pending ? 'Showing the value…' : 'Show the value'}
      </Button>
      <ProblemDisplay
        problem={form.problem === undefined ? undefined : describeGraphProblem(form.problem)}
      />
    </form>
  );
}
