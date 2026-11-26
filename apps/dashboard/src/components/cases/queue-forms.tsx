'use client';

import type { CaseAssignmentPolicyResource } from '@openverify/contracts';
import {
  CASE_ASSIGNMENT_DISTRIBUTIONS,
  CASE_ASSIGNMENT_SORTS,
  CASE_LIMITS,
} from '@openverify/core';
import { useRouter } from 'next/navigation';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { EnvironmentField } from '../environment-field';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { DISTRIBUTION_WORDS, SORT_WORDS } from './case-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type IdAction = (
  state: ActionState<{ id: string }>,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;

const ROOT = '/data/attributes';
const NAME = `${ROOT}/name`;

/** Every field error at `pointer` or under it, joined. */
function errorsUnder(problem: DisplayProblem | undefined, pointer: string): string | undefined {
  const details = (problem?.errors ?? [])
    .filter((error) => error.pointer === pointer || error.pointer.startsWith(`${pointer}/`))
    .map((error) =>
      error.pointer === pointer
        ? error.detail
        : `${error.pointer.slice(pointer.length + 1).replace(/^(\d+)/u, (index) => `Line ${String(Number(index) + 1)}`)}: ${error.detail}`,
    );
  return details.length === 0 ? undefined : details.join('. ');
}

/** The problem without the errors the form shows at their fields. */
const unplaced = (problem: DisplayProblem | undefined, pointers: readonly string[]) =>
  withoutFieldErrors(
    problem,
    (problem?.errors ?? [])
      .map((error) => error.pointer)
      .filter((pointer) =>
        pointers.some((each) => pointer === each || pointer.startsWith(`${each}/`)),
      ),
  );

/** Creates a queue by its name; its page opens to add members (C132.1). */
export function CreateQueueForm({
  environmentId,
  action,
}: {
  readonly environmentId: string;
  readonly action: IdAction;
}) {
  const router = useRouter();
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/case-queues/${id}`);
    },
  });
  return (
    <form
      {...form.formProps}
      aria-label="Create a queue"
      className="flex flex-wrap items-end gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
        {(control) => (
          <input {...control} name="name" maxLength={80} className={controlClassName(control)} />
        )}
      </FormField>
      <SubmitButton pendingLabel="Creating…" pending={form.pending}>
        Create queue
      </SubmitButton>
      <ProblemDisplay className="w-full" problem={withoutFieldErrors(form.problem, [NAME])} />
    </form>
  );
}

export interface PolicyChoice {
  readonly id: string;
  readonly name: string;
}

/** A queue's name and the policy that assigns its cases. */
export function QueueSettingsForm({
  queueId,
  name,
  policyId,
  policies,
  action,
}: {
  readonly queueId: string;
  readonly name: string;
  readonly policyId: string | null;
  readonly policies: readonly PolicyChoice[];
  readonly action: Action;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the queue.' });
    },
  });
  const POLICY = `${ROOT}/case-assignment-policy-id`;
  return (
    <form {...form.formProps} aria-label="Queue settings" className="flex flex-col gap-4">
      <input type="hidden" name="case-queue-id" value={queueId} />
      <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
        {(control) => (
          <input
            {...control}
            name="name"
            defaultValue={name}
            maxLength={80}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Assignment policy"
        description="Assigns a case that enters this queue at once when an agent is eligible; otherwise the case waits to be pulled."
        error={fieldErrorOf(form.problem, POLICY)}
      >
        {(control) => (
          <select
            {...control}
            name="case-assignment-policy-id"
            defaultValue={policyId ?? ''}
            className={controlClassName(control)}
          >
            <option value="">None: pulled or assigned by hand</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.name}
              </option>
            ))}
            {policyId !== null && !policies.some((policy) => policy.id === policyId) && (
              <option value={policyId}>{policyId}</option>
            )}
          </select>
        )}
      </FormField>
      <ProblemDisplay problem={withoutFieldErrors(form.problem, [NAME, POLICY])} />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * An assignment policy's form (C132.2), to create one or edit it: its distribution, the order in
 * which waiting cases are taken, its agents (none: the members of the queue a case is in), the open
 * cases each takes at most (none: each member's own limit), and its sources in priority order.
 */
export function AssignmentPolicyForm({
  environmentId,
  policy,
  action,
}: {
  readonly environmentId: string;
  /** The policy edited, or `undefined` to create one. */
  readonly policy?: CaseAssignmentPolicyResource;
  readonly action: Action | IdAction;
}) {
  const router = useRouter();
  const { show } = useToast();
  const form = useFormAction<{ id: string } | undefined>(
    action as (
      state: ActionState<{ id: string } | undefined>,
      formData: FormData,
    ) => Promise<ActionResult<{ id: string } | undefined>>,
    {
      onSuccess: (data) => {
        if (policy === undefined && data !== undefined) {
          router.push(`/case-queues/policies/${data.id}`);
        } else {
          show({ tone: 'success', message: 'Saved the policy.' });
        }
      },
    },
  );
  const attributes = policy?.attributes;
  const fields = ['name', 'distribution', 'sort', 'agents', 'max-capacity', 'sources'].map(
    (member) => `${ROOT}/${member}`,
  );
  return (
    <form
      {...form.formProps}
      aria-label={policy === undefined ? 'Create an assignment policy' : 'Edit the policy'}
      className="flex flex-col gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      {policy !== undefined && (
        <input type="hidden" name="case-assignment-policy-id" value={policy.id} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
          {(control) => (
            <input
              {...control}
              name="name"
              defaultValue={attributes?.name}
              maxLength={80}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <FormField label="Distribution" error={fieldErrorOf(form.problem, `${ROOT}/distribution`)}>
          {(control) => (
            <select
              {...control}
              name="distribution"
              defaultValue={attributes?.distribution ?? 'round-robin'}
              className={controlClassName(control)}
            >
              {CASE_ASSIGNMENT_DISTRIBUTIONS.map((each) => (
                <option key={each} value={each}>
                  {DISTRIBUTION_WORDS[each]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          label="Order of waiting cases"
          error={fieldErrorOf(form.problem, `${ROOT}/sort`)}
        >
          {(control) => (
            <select
              {...control}
              name="sort"
              defaultValue={attributes?.sort ?? 'created-at'}
              className={controlClassName(control)}
            >
              {CASE_ASSIGNMENT_SORTS.map((each) => (
                <option key={each} value={each}>
                  {SORT_WORDS[each]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          label="Open cases per agent"
          description={`1 to ${String(CASE_LIMITS['member-max-open'].value)}, never above a member’s own limit. Leave it empty for each member’s own.`}
          error={fieldErrorOf(form.problem, `${ROOT}/max-capacity`)}
        >
          {(control) => (
            <input
              {...control}
              type="number"
              name="max-capacity"
              min={1}
              max={CASE_LIMITS['member-max-open'].value}
              defaultValue={attributes?.['max-capacity'] ?? ''}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      </div>
      <FormField
        label="Agents"
        description="User IDs, separated by spaces, commas or lines. Leave it empty for the members of the queue a case is in."
        error={errorsUnder(form.problem, `${ROOT}/agents`)}
      >
        {(control) => (
          <textarea
            {...control}
            name="agents"
            rows={2}
            defaultValue={(attributes?.agents ?? []).join('\n')}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Sources"
        required
        description={`Case templates (ctmpl_…) and queues (cqueue_…), one per line, in priority order: 1 to ${String(CASE_LIMITS['policy-sources'].value)}.`}
        error={errorsUnder(form.problem, `${ROOT}/sources`)}
      >
        {(control) => (
          <textarea
            {...control}
            name="sources"
            rows={3}
            defaultValue={(attributes?.sources ?? []).map((source) => source.id).join('\n')}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <ProblemDisplay problem={unplaced(form.problem, fields)} />
      <div>
        <SubmitButton
          pendingLabel={policy === undefined ? 'Creating…' : 'Saving…'}
          pending={form.pending}
        >
          {policy === undefined ? 'Create policy' : 'Save policy'}
        </SubmitButton>
      </div>
    </form>
  );
}
