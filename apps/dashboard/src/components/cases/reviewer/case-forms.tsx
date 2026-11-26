'use client';

import type { CasePresetComments } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useRef, useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../../lib/action-state';
import { withoutFieldErrors } from '../../field-errors';
import { FormField, controlClassName } from '../../form-field';
import { ProblemDisplay } from '../../problem-display';
import { SubmitButton } from '../../submit-button';
import { useToast } from '../../toasts';
import { useFormAction } from '../../use-form-action';
import { CASES_REPORTS_COPY } from '../../../lib/copy/cases-reports';

const PRESETS = CASES_REPORTS_COPY.presetComments;

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** A person the case page can name: an id, and an email when the reader may read users. */
export interface Person {
  readonly id: string;
  readonly label: string;
}

function CaseField({ caseId }: { readonly caseId: string }) {
  return <input type="hidden" name="case-id" value={caseId} />;
}

/**
 * Assignment (C132.3): "Assign to me" for `cases:write`, a person from the queue for
 * `cases:assign`, and unassigning. The API checks that the person may hold the case
 * (`case_assignee_ineligible`), and each change is announced politely (4.1.3).
 */
export function AssignmentControl({
  caseId,
  lockVersion,
  viewerId,
  assigneeId,
  people,
  canAssignOthers,
  action,
}: {
  readonly caseId: string;
  readonly lockVersion: number;
  readonly viewerId: string;
  readonly assigneeId: string | null;
  readonly people: readonly Person[];
  readonly canAssignOthers: boolean;
  readonly action: Action;
}) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'The assignment was saved.' });
    },
  });
  const others = people.filter((person) => person.id !== assigneeId);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {assigneeId !== viewerId && (
          <form {...formProps}>
            <CaseField caseId={caseId} />
            <input type="hidden" name="lock-version" value={String(lockVersion)} />
            <input type="hidden" name="user-id" value={viewerId} />
            <SubmitButton variant="secondary" pendingLabel="Assigning…" pending={pending}>
              Assign to me
            </SubmitButton>
          </form>
        )}
        {canAssignOthers && others.length > 0 && (
          <form {...formProps} className="flex flex-wrap items-end gap-3">
            <CaseField caseId={caseId} />
            <input type="hidden" name="lock-version" value={String(lockVersion)} />
            <FormField label="Assign to" className="min-w-56">
              {(control) => (
                <select
                  {...control}
                  name="user-id"
                  required
                  defaultValue=""
                  className={controlClassName(control)}
                >
                  <option value="" disabled>
                    Choose a person
                  </option>
                  {others.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <SubmitButton variant="secondary" pendingLabel="Assigning…" pending={pending}>
              Assign
            </SubmitButton>
          </form>
        )}
        {assigneeId !== null && (assigneeId === viewerId || canAssignOthers) && (
          <form {...formProps}>
            <CaseField caseId={caseId} />
            <input type="hidden" name="lock-version" value={String(lockVersion)} />
            <input type="hidden" name="user-id" value="" />
            <SubmitButton variant="secondary" pendingLabel="Unassigning…" pending={pending}>
              Unassign
            </SubmitButton>
          </form>
        )}
      </div>
      <ProblemDisplay problem={problem} />
    </div>
  );
}

/**
 * A new comment (C134.1, C134.3): plain text, with mentions picked from the people who can read
 * the case and inserted as `@[usr_…]` tokens at the caret. The API checks each mention.
 */
export function CommentForm({
  caseId,
  people,
  action,
  presets = [],
}: {
  readonly caseId: string;
  readonly people: readonly Person[];
  readonly action: Action;
  /** C172.4: the version's preset comments, inserted into the box and edited before posting. */
  readonly presets?: CasePresetComments;
}) {
  const [preset, setPreset] = useState('');
  const insertPreset = () => {
    const area = text.current;
    const chosen = presets.find((each) => each.key === preset);
    if (area === null || chosen === undefined) {
      return;
    }
    area.setRangeText(chosen.text, area.selectionStart, area.selectionEnd, 'end');
    area.focus();
  };
  const { show } = useToast();
  const text = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState('');
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({ tone: 'success', message: 'The comment was added.' });
    },
  });
  const insertMention = () => {
    const area = text.current;
    if (area === null || mention === '') {
      return;
    }
    const token = `@[${mention}] `;
    const start = area.selectionStart;
    area.setRangeText(token, start, area.selectionEnd, 'end');
    area.focus();
  };
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <CaseField caseId={caseId} />
      <FormField
        label="New comment"
        description="Plain text. A mention notifies the person; web addresses stay text."
        error={fieldErrorOf(problem, '/meta/message')}
      >
        {(control) => (
          <textarea
            {...control}
            ref={text}
            data-shortcut-target="comment"
            name="message"
            rows={4}
            required
            maxLength={10_000}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      {presets.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={PRESETS.label} description={PRESETS.description} className="min-w-56">
            {(control) => (
              <select
                {...control}
                value={preset}
                onChange={(event) => {
                  setPreset(event.target.value);
                }}
                className={controlClassName(control)}
              >
                <option value="">{PRESETS.choose}</option>
                {presets.map((each) => (
                  <option key={each.key} value={each.key}>
                    {each.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <Button variant="secondary" disabled={preset === ''} onClick={insertPreset}>
            {PRESETS.insert}
          </Button>
        </div>
      )}
      {people.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Mention" className="min-w-56">
            {(control) => (
              <select
                {...control}
                value={mention}
                onChange={(event) => {
                  setMention(event.target.value);
                }}
                className={controlClassName(control)}
              >
                <option value="">Choose a person</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <Button variant="secondary" disabled={mention === ''} onClick={insertMention}>
            Insert mention
          </Button>
        </div>
      )}
      <ProblemDisplay problem={withoutFieldErrors(problem, ['/meta/message'])} />
      <div>
        <SubmitButton pendingLabel="Adding…" pending={pending}>
          Add comment
        </SubmitButton>
      </div>
    </form>
  );
}

/** The case's queue (C132.1): one of the active queues, or none. */
export function QueueForm({
  caseId,
  queueId,
  queues,
  action,
}: {
  readonly caseId: string;
  readonly queueId: string | null;
  readonly queues: readonly Person[];
  readonly action: Action;
}) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'The queue was changed.' });
    },
  });
  return (
    <form {...formProps} className="flex flex-wrap items-end gap-3">
      <CaseField caseId={caseId} />
      <FormField label="Queue" className="min-w-56">
        {(control) => (
          <select
            {...control}
            name="case-queue-id"
            defaultValue={queueId ?? ''}
            className={controlClassName(control)}
          >
            <option value="">No queue</option>
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>
                {queue.label}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <SubmitButton variant="secondary" pendingLabel="Moving…" pending={pending}>
        Move
      </SubmitButton>
      <ProblemDisplay problem={problem} className="basis-full" />
    </form>
  );
}

/**
 * The public SLA (C133.1): a wall-clock deadline from now, in minutes, hours or days, or cleared.
 * A policy's business-time SLA is set by the template, not here.
 */
export function SlaForm({
  caseId,
  hasSla,
  action,
}: {
  readonly caseId: string;
  readonly hasSla: boolean;
  readonly action: Action;
}) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'The SLA was saved.' });
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <form {...formProps} className="flex flex-wrap items-end gap-3">
        <CaseField caseId={caseId} />
        <FormField label="Due in" className="w-32" error={fieldErrorOf(problem, '/amount')}>
          {(control) => (
            <input
              {...control}
              name="amount"
              type="number"
              min={1}
              step={1}
              required
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <FormField label="Unit" className="w-36">
          {(control) => (
            <select
              {...control}
              name="unit"
              defaultValue="hours"
              className={controlClassName(control)}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          )}
        </FormField>
        <SubmitButton variant="secondary" pendingLabel="Saving…" pending={pending}>
          Set SLA
        </SubmitButton>
      </form>
      {hasSla && (
        <form {...formProps}>
          <CaseField caseId={caseId} />
          <input type="hidden" name="clear" value="true" />
          <SubmitButton variant="secondary" pendingLabel="Clearing…" pending={pending}>
            Clear SLA
          </SubmitButton>
        </form>
      )}
      <ProblemDisplay problem={withoutFieldErrors(problem, ['/amount'])} />
    </div>
  );
}

/** Held objects added by id (C136.1); the API refuses a kind the case cannot hold. */
export function AddObjectsForm({
  caseId,
  action,
}: {
  readonly caseId: string;
  readonly action: Action;
}) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({ tone: 'success', message: 'The objects were added.' });
    },
  });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <CaseField caseId={caseId} />
      <FormField
        label="Object ids to add"
        description="Inquiry, account, report, report run, transaction, verification or graph query ids, separated by spaces or commas."
        error={fieldErrorOf(problem, '/meta/object-ids')}
      >
        {(control) => (
          <textarea
            {...control}
            name="object-ids"
            rows={2}
            required
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <ProblemDisplay problem={withoutFieldErrors(problem, ['/meta/object-ids'])} />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Adding…" pending={pending}>
          Add objects
        </SubmitButton>
      </div>
    </form>
  );
}
