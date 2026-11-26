'use client';

/**
 * The sandbox test-run form (C120.7, C141.6, C141.9): the version (the draft by default), the
 * trigger object (an existing id or a synthetic JSON payload), an optional step range, output
 * overrides keyed by step id, the hosts a real request may reach, and the acknowledgements of the
 * steps that need one. Nothing is ticked for the operator; a started run opens below the form.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { listHref } from '../../lib/list-query';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';

/** A version a test run can use; `id` is empty for the draft. */
export interface TestRunVersion {
  readonly id: string;
  readonly label: string;
}

/** An acknowledgement a step needs, with its reason in words (C116.4, C120.7). */
export interface TestRunAcknowledgement {
  readonly key: string;
  readonly label: string;
}

export interface TestRunFormProps {
  readonly workflowId: string;
  readonly versions: readonly TestRunVersion[];
  readonly versionId: string;
  readonly steps: readonly string[];
  readonly startStep: string;
  readonly endStep: string;
  readonly acknowledgements: readonly TestRunAcknowledgement[];
  readonly action: (
    state: ActionState<{ readonly runId: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ readonly runId: string }>>;
}

const POINTERS = ['/data/attributes/trigger-payload', '/data/attributes/overrides'];

export function TestRunForm({
  workflowId,
  versions,
  versionId,
  steps,
  startStep,
  endStep,
  acknowledgements,
  action,
}: TestRunFormProps) {
  const router = useRouter();
  const [source, setSource] = useState<'object' | 'payload'>('object');
  const [range, setRange] = useState({ start: startStep, end: endStep });
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: ({ runId }) => {
      router.push(
        listHref(`/workflows/${workflowId}/test-runs`, {
          run: runId,
          'version-id': versionId,
          'start-step': range.start,
          'end-step': range.end,
        }),
      );
    },
  });
  return (
    <form {...formProps} aria-label="Start a test run" className="flex flex-col gap-5">
      <input type="hidden" name="workflow-id" value={workflowId} />
      <p className="text-sm">
        A test run runs in this sandbox environment only. Its messages go to the recording provider
        whatever their recipient, and an HTTPS step must be overridden unless you name its host and
        acknowledge it.
      </p>
      <FormField label="Version" className="max-w-sm">
        {(control) => (
          <select
            {...control}
            name="version-id"
            defaultValue={versionId}
            className={controlClassName(control)}
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Trigger object</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="trigger-source"
            value="object"
            checked={source === 'object'}
            onChange={() => {
              setSource('object');
            }}
            className="size-6"
          />
          An existing object
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="trigger-source"
            value="payload"
            checked={source === 'payload'}
            onChange={() => {
              setSource('payload');
            }}
            className="size-6"
          />
          A synthetic payload
        </label>
        {source === 'object' ? (
          <FormField
            label="Object id"
            description="An inquiry, account, case or other object of this environment."
            className="max-w-md"
          >
            {(control) => (
              <input
                {...control}
                name="object-id"
                required
                autoComplete="off"
                spellCheck={false}
                className={controlClassName(control)}
              />
            )}
          </FormField>
        ) : (
          <FormField
            label="Payload (JSON)"
            description="Use synthetic values only: what the trigger would have carried."
            error={fieldErrorOf(problem, '/data/attributes/trigger-payload')}
          >
            {(control) => (
              <textarea
                {...control}
                name="trigger-payload"
                rows={6}
                required
                spellCheck={false}
                className={`${controlClassName(control)} font-mono text-xs`}
              />
            )}
          </FormField>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <FormField label="Start step" className="w-56">
          {(control) => (
            <select
              {...control}
              name="start-step"
              value={range.start}
              onChange={(event) => {
                setRange({ ...range, start: event.target.value });
              }}
              className={controlClassName(control)}
            >
              <option value="">From the trigger</option>
              {steps.map((step) => (
                <option key={step} value={step}>
                  {step}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="End step" className="w-56">
          {(control) => (
            <select
              {...control}
              name="end-step"
              value={range.end}
              onChange={(event) => {
                setRange({ ...range, end: event.target.value });
              }}
              className={controlClassName(control)}
            >
              <option value="">To the output</option>
              {steps.map((step) => (
                <option key={step} value={step}>
                  {step}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <FormField
        label="Output overrides (JSON, by step id)"
        description='Stands in for a step’s output, such as {"send_slack": {"delivery": "recorded"}}.'
        error={fieldErrorOf(problem, '/data/attributes/overrides')}
      >
        {(control) => (
          <textarea
            {...control}
            name="overrides"
            rows={4}
            spellCheck={false}
            className={`${controlClassName(control)} font-mono text-xs`}
          />
        )}
      </FormField>
      <FormField
        label="Hosts a real request may reach (one per line)"
        description="Only a user with pii:view may name one, and each step that sends personal data needs its acknowledgement."
      >
        {(control) => (
          <textarea
            {...control}
            name="allow-hosts"
            rows={2}
            spellCheck={false}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      {acknowledgements.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Acknowledgements</legend>
          <p className="text-sm">
            Without its acknowledgement, an irreversible step is simulated: it makes no change and
            no decision record.
          </p>
          {acknowledgements.map((acknowledgement) => (
            <label key={acknowledgement.key} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="acknowledgement"
                value={acknowledgement.key}
                className="size-6"
              />
              {acknowledgement.label}
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="allow-triggers" value="true" className="size-6" />
        Let the events this test run causes start other workflows
      </label>
      <ProblemDisplay problem={withoutFieldErrors(problem, POINTERS)} />
      <div>
        <SubmitButton pendingLabel="Starting…" pending={pending}>
          Start the test run
        </SubmitButton>
      </div>
    </form>
  );
}
