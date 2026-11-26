'use client';

/**
 * A transaction type's adverse statuses and contest route (C122.1, C128.3). Moving a transaction
 * into an adverse status from a workflow is an adverse step, recorded and gated like a decline; the
 * contest route reaches the person when the step names none of its own.
 */
import type { ContestRoute } from '@openverify/contracts';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { ContestRouteFields } from '../workflows/contest-route';

const ROUTE = '/data/attributes/contest-route';

export function TypeDecisionsForm({
  typeId,
  statuses,
  adverse,
  route,
  action,
}: {
  readonly typeId: string;
  /** The newest version's statuses, which the API holds the adverse ones to. */
  readonly statuses: readonly string[];
  readonly adverse: readonly string[];
  readonly route: ContestRoute | null;
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the type’s decisions.' });
    },
  });
  return (
    <form {...formProps} aria-label="Decisions on this type" className="flex flex-col gap-4">
      <input type="hidden" name="transaction-type-id" value={typeId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold">Adverse statuses</legend>
        <p className="text-sm">
          A workflow that moves a transaction into one of these makes an adverse decision: it is
          recorded and needs a basis and a contest route in production.
        </p>
        {statuses.length === 0 ? (
          <p className="text-sm">The type has no status yet.</p>
        ) : (
          statuses.map((status) => (
            <label key={status} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="adverse-status"
                value={status}
                defaultChecked={adverse.includes(status)}
                className="size-6"
              />
              <code className="font-mono text-xs">{status}</code>
            </label>
          ))
        )}
      </fieldset>
      <ContestRouteFields route={route} problem={problem} pointer={ROUTE} />
      <ProblemDisplay problem={withoutFieldErrors(problem, [`${ROUTE}/url`, `${ROUTE}/contact`])} />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={pending}>
          Save decisions
        </SubmitButton>
      </div>
    </form>
  );
}
