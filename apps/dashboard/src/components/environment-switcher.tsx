'use client';

import type { EnvironmentKind } from '@openverify/contracts';
import type { ActionResult, ActionState } from '../lib/action-state';
import { ProblemDisplay } from './problem-display';
import { SubmitButton } from './submit-button';
import { useFormAction } from './use-form-action';

export interface EnvironmentOption {
  readonly id: string;
  readonly kind: EnvironmentKind;
}

export interface EnvironmentSwitcherProps {
  readonly current: EnvironmentOption;
  /** The other environments the operator may enter (`switchableEnvironments`). */
  readonly targets: readonly EnvironmentOption[];
  /** `switchEnvironment` from `app/actions/environment.ts`. */
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}

const NAMES: Record<EnvironmentKind, string> = { sandbox: 'Sandbox', production: 'Production' };

/** The header's environment switch (C21): `PUT /sessions/current/environment` via a server action. */
export function EnvironmentSwitcher({ current, targets, action }: EnvironmentSwitcherProps) {
  // Each button posts its environment (the submitter's name and value).
  const { pending, problem, formProps } = useFormAction(action);

  if (targets.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        Environment: <span className="font-medium text-ink">{NAMES[current.kind]}</span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <form aria-label="Environment" {...formProps} className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink-muted">
          Environment: <span className="font-medium text-ink">{NAMES[current.kind]}</span>
        </p>
        {targets.map((target) => (
          <SubmitButton
            key={target.id}
            variant="secondary"
            pendingLabel="Switching…"
            pending={pending}
            name="environment-id"
            value={target.id}
          >
            Switch to {target.kind}
          </SubmitButton>
        ))}
      </form>
      <ProblemDisplay problem={problem} />
    </div>
  );
}
