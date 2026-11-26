'use client';

/**
 * The messages a sandbox test run recorded (C126.4, C141.9): a recipient (an email address, a phone
 * number or a Slack secret id) is posted to a server action, never put in a URL, and the answer
 * lists this run's records. Each reads "Recorded (sandbox)", never "sent" or "delivered" (C126.5),
 * and a body the console withholds without `pii:view` says so.
 */
import { useState } from 'react';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { Timestamp } from '../timestamp';
import { useFormAction } from '../use-form-action';

export interface RecordedMessageRow {
  readonly messageRef: string;
  readonly stepId: string;
  readonly recordedAt: string;
  /** `null` when withheld without `pii:view`. */
  readonly subject: string | null;
  readonly text: string | null;
}

interface Records {
  readonly records: readonly RecordedMessageRow[];
}

const HIDDEN = 'Hidden without pii:view';

const KINDS = [
  { value: 'email', label: 'Email (by recipient address)' },
  { value: 'workflow-sms', label: 'SMS (by phone number)' },
  { value: 'slack', label: 'Slack (by the webhook secret’s id)' },
] as const;

export function RecordedMessages({
  runId,
  action,
}: {
  readonly runId: string;
  readonly action: (
    state: ActionState<Records>,
    formData: FormData,
  ) => Promise<ActionResult<Records>>;
}) {
  const [records, setRecords] = useState<readonly RecordedMessageRow[] | null>(null);
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: (data) => {
      setRecords(data.records);
    },
  });
  const count = records?.length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <form
        {...formProps}
        aria-label="Find recorded messages"
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="run-id" value={runId} />
        <FormField label="Kind" className="w-72">
          {(control) => (
            <select
              {...control}
              name="kind"
              defaultValue="email"
              className={controlClassName(control)}
            >
              {KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Recipient" className="min-w-72">
          {(control) => (
            <input
              {...control}
              name="recipient"
              required
              autoComplete="off"
              spellCheck={false}
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <SubmitButton variant="secondary" pendingLabel="Finding…" pending={pending}>
          Find messages
        </SubmitButton>
      </form>
      <ProblemDisplay problem={problem} />
      <p role="status" className="text-sm">
        {records === null
          ? ''
          : count === 0
            ? 'This run recorded no message for that recipient.'
            : `${String(count)} ${count === 1 ? 'message' : 'messages'} recorded by this run.`}
      </p>
      {records !== null && count > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Recorded messages</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Outcome</th>
                <th scope="col">Recorded (UTC)</th>
                <th scope="col">Subject</th>
                <th scope="col">Text</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.messageRef} className="align-top">
                  <th scope="row" className="font-mono text-xs">
                    {record.stepId}
                  </th>
                  <td>Recorded (sandbox)</td>
                  <td>
                    <Timestamp value={record.recordedAt} />
                  </td>
                  <td>{record.subject ?? (record.text === null ? HIDDEN : 'None')}</td>
                  <td className="whitespace-pre-wrap">{record.text ?? HIDDEN}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
