'use client';

/**
 * Manual runs (C118.5, C141.7): one run of the live version per object, as the operator, from ids
 * typed or a CSV file with one `object-id` column. The answer links each run started and says each
 * id or row that started none by its code in words, never with a value (C143.5).
 */
import Link from 'next/link';
import { useState } from 'react';
import type { ManualRunsResult } from '../../app/workflows/actions';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';

/** Why an id or row started no run, in words; an unknown code reads as itself. */
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  object_id_invalid: 'this is not an id of an object this workflow’s trigger takes',
  object_repeated: 'the id was given more than once; only its first appearance counts',
  payload_too_large: 'the object is too large to start a run with',
  object_not_found: 'the object was not found in this environment',
  object_type_unsupported: 'this workflow’s trigger does not take that kind of object',
  rate_limited: 'the run was held back by the rate limit',
  workflow_not_running: 'the workflow is not running',
  subject_redacted: 'the object was redacted',
  duplicate_object: 'the id was given twice',
  row_invalid: 'the row is not an object id',
};

export function refusalWords(code: string): string {
  const words = REFUSAL_WORDS[code];
  return words === undefined ? `refused (${code})` : `${words} (${code})`;
}

export function ManualRunForm({
  workflowId,
  action,
}: {
  readonly workflowId: string;
  readonly action: (
    state: ActionState<ManualRunsResult>,
    formData: FormData,
  ) => Promise<ActionResult<ManualRunsResult>>;
}) {
  const [source, setSource] = useState<'ids' | 'csv'>('ids');
  const [result, setResult] = useState<ManualRunsResult | null>(null);
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: (data) => {
      setResult(data);
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <form {...formProps} aria-label="Start manual runs" className="flex flex-col gap-4">
        <input type="hidden" name="workflow-id" value={workflowId} />
        <p className="text-sm">
          Starts one run of the live version for each object, as you. Each run needs the version’s
          grant, which your role must hold.
        </p>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Objects from</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="source"
              value="ids"
              checked={source === 'ids'}
              onChange={() => {
                setSource('ids');
              }}
              className="size-6"
            />
            Object ids
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="source"
              value="csv"
              checked={source === 'csv'}
              onChange={() => {
                setSource('csv');
              }}
              className="size-6"
            />
            A CSV file of ids
          </label>
        </fieldset>
        {source === 'ids' ? (
          <FormField
            label="Object ids (one per line, or separated by spaces or commas)"
            description="At most 1,000 ids."
          >
            {(control) => (
              <textarea
                {...control}
                name="object-ids"
                rows={4}
                required
                spellCheck={false}
                className={controlClassName(control)}
              />
            )}
          </FormField>
        ) : (
          <FormField
            label="CSV file"
            description="A header row and one column named object-id, at most 1,000 rows."
          >
            {(control) => (
              <input
                {...control}
                type="file"
                name="csv"
                required
                accept=".csv,text/csv"
                className={controlClassName(control)}
              />
            )}
          </FormField>
        )}
        <ProblemDisplay problem={problem} />
        <div>
          <SubmitButton pendingLabel="Starting…" pending={pending}>
            Start the runs
          </SubmitButton>
        </div>
      </form>
      <p role="status" className="text-sm">
        {result === null
          ? ''
          : `${String(result.runIds.length)} ${result.runIds.length === 1 ? 'run' : 'runs'} started; ${String(result.refused.length)} refused.`}
      </p>
      {result !== null && (
        <section aria-label="Manual run results" className="flex flex-col gap-2 text-sm">
          {result.runIds.length > 0 && (
            <ul className="flex flex-wrap gap-3">
              {result.runIds.map((runId) => (
                <li key={runId}>
                  <Link href={`/workflows/runs/${runId}`} className={LINK_CLASS}>
                    <code className="font-mono text-xs">{runId}</code>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {result.refused.length > 0 && (
            <ul className="flex flex-col gap-1">
              {result.refused.map((refusal) => (
                <li key={`${refusal.objectId ?? ''}:${String(refusal.row)}:${refusal.code}`}>
                  {`${refusal.objectId ?? `Row ${String(refusal.row)}`}: ${refusalWords(refusal.code)}`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
