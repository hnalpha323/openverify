'use client';

/**
 * The account page's workflow actions (C118.7, C141.7): one button per action the API lists, each
 * opening its parameter form behind a confirmation, and a status that links the run it started.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { ConfirmActionButton } from '../confirm-action-button';
import { LINK_CLASS } from '../link-styles';
import { ParameterFields, type ParameterInput } from './parameter-fields';

export interface AccountActionItem {
  readonly id: string;
  readonly label: string;
  readonly workflowId: string;
  readonly form: readonly ParameterInput[];
}

export interface StartedRunData {
  readonly runId: string;
}

export function AccountActions({
  accountId,
  items,
  run,
}: {
  readonly accountId: string;
  readonly items: readonly AccountActionItem[];
  readonly run: (
    state: ActionState<StartedRunData>,
    formData: FormData,
  ) => Promise<ActionResult<StartedRunData>>;
}) {
  const [started, setStarted] = useState<{ label: string; runId: string } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Workflow actions of this account">
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3">
              <ConfirmActionButton<StartedRunData>
                label={item.label}
                variant="secondary"
                tone="primary"
                title={`Run “${item.label}”?`}
                description="It starts a run for this account, under the version's grant."
                confirmLabel="Run action"
                pendingLabel="Starting…"
                action={run}
                fields={{ 'account-id': accountId, 'account-action-id': item.id }}
                successMessage="The run was started."
                onSuccess={(data) => {
                  setStarted({ label: item.label, runId: data.runId });
                }}
              >
                <ParameterFields inputs={item.form} />
              </ConfirmActionButton>
              <span className="text-sm text-ink-muted">
                runs workflow{' '}
                <Link href={`/workflows/${item.workflowId}`} className={LINK_CLASS}>
                  {item.workflowId}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p role="status" className="text-sm">
        {started !== null && (
          <>
            {started.label} started run{' '}
            <Link href={`/workflows/runs/${started.runId}`} className={LINK_CLASS}>
              {started.runId}
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}
