'use client';

/**
 * The dismissal and review dialogs of a report's matches (C75.2, C75.5, C86). Each opens a form
 * in a dialog: focus moves in, Escape or Cancel closes it, and focus returns to its button. A
 * dismissal needs a reason, and a review a comment (C86; a false positive is a dismissal). A
 * refusal shows on its field, tied to it (`aria-invalid` and its description), and is not
 * repeated in the summary above the buttons. The server action checks every value again.
 */
import {
  REPORT_REVIEW_COMMENT_MAX_LENGTH,
  REPORT_DISMISS_REASON_MAX_LENGTH,
} from '@openverify/contracts';
import { REPORT_REVIEW_STATUSES, REPORT_RISK_LEVELS } from '@openverify/core';
import { Button, Checkbox } from '@openverify/ui';
import { useState, type ReactNode } from 'react';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import {
  REPORT_REVIEW_STATUS_LABELS,
  REPORT_RISK_LEVEL_LABELS,
} from '../../lib/report-match-words';
import { Dialog } from '../dialog';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface DismissMatchesButtonProps {
  readonly reportId: string;
  /** The button's text, such as "Dismiss" or "Dismiss all open matches". */
  readonly label: string;
  /** Names what the button acts on, starting with `label` (WCAG 2.4.6, 2.5.3). */
  readonly accessibleLabel?: string;
  readonly title: string;
  /** One entry's key, or one article's with `dismissType: media`; every open match without. */
  readonly entityId?: string;
  readonly dismissType?: 'entity' | 'media';
  readonly action: Action;
}

export interface ReviewMatchesButtonProps {
  readonly reportId: string;
  readonly label: string;
  readonly accessibleLabel?: string;
  readonly title: string;
  /** One match's id (`record`); every open match without (`all_records`). */
  readonly recordToken?: string;
  readonly action: Action;
}

const REASON = '/data/attributes/reason';
const COMMENT = '/data/attributes/comment';
const REVIEW_POINTERS = [
  '/data/attributes/review-status',
  '/data/attributes/risk-level',
  COMMENT,
  '/data/attributes/record-token',
];

interface DialogButtonProps {
  readonly label: string;
  readonly accessibleLabel: string | undefined;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly successMessage: string;
  readonly action: Action;
  /** Hidden fields; an `undefined` value is left out. */
  readonly fields: Readonly<Record<string, string | undefined>>;
  /** The pointers its fields show their errors at, left out of the summary. */
  readonly pointers: readonly string[];
  readonly children: (problem: DisplayProblem | undefined) => ReactNode;
}

function DialogButton({
  label,
  accessibleLabel,
  title,
  description,
  submitLabel,
  pendingLabel,
  successMessage,
  action,
  fields,
  pointers,
  children,
}: DialogButtonProps) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  const submit = useFormAction(action, {
    onSuccess: () => {
      setOpen(false);
      show({ tone: 'success', message: successMessage });
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        {...(accessibleLabel === undefined ? {} : { 'aria-label': accessibleLabel })}
        onClick={() => {
          submit.clearProblem();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={title}
        description={description}
        dismissible={!submit.pending}
      >
        <form {...submit.formProps} noValidate className="flex flex-col gap-4">
          {Object.entries(fields).map(([name, value]) =>
            value === undefined ? null : (
              <input key={name} type="hidden" name={name} value={value} />
            ),
          )}
          {children(submit.problem)}
          <ProblemDisplay problem={withoutFieldErrors(submit.problem, pointers)} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              disabled={submit.pending}
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submit.pending}>
              {submit.pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Dismisses one entry's open matches, one article, or every open match, with a reason. */
export function DismissMatchesButton({
  reportId,
  label,
  accessibleLabel,
  title,
  entityId,
  dismissType,
  action,
}: DismissMatchesButtonProps) {
  return (
    <DialogButton
      label={label}
      accessibleLabel={accessibleLabel}
      title={title}
      description="A dismissed match leaves has-match and stays suppressed until the list entry changes. The reason is kept in the report's history."
      submitLabel="Dismiss"
      pendingLabel="Dismissing…"
      successMessage="Dismissed."
      action={action}
      fields={{ 'report-id': reportId, 'entity-id': entityId, 'dismiss-type': dismissType }}
      pointers={[REASON]}
    >
      {(problem) => (
        <FormField
          label="Reason"
          required
          description={`Why this is not the subject, up to ${String(REPORT_DISMISS_REASON_MAX_LENGTH)} characters.`}
          error={fieldErrorOf(problem, REASON)}
        >
          {(control) => (
            <textarea
              {...control}
              name="reason"
              rows={3}
              maxLength={REPORT_DISMISS_REASON_MAX_LENGTH}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      )}
    </DialogButton>
  );
}

/** Reviews one match, or every open match: a status, a risk level, notify-on-change, a comment. */
export function ReviewMatchesButton({
  reportId,
  label,
  accessibleLabel,
  title,
  recordToken,
  action,
}: ReviewMatchesButtonProps) {
  return (
    <DialogButton
      label={label}
      accessibleLabel={accessibleLabel}
      title={title}
      description="A review records your decision on the match. A false positive dismisses it."
      submitLabel="Save review"
      pendingLabel="Saving…"
      successMessage="Review saved."
      action={action}
      fields={{
        'report-id': reportId,
        'review-type': recordToken === undefined ? 'all_records' : 'record',
        'record-token': recordToken,
      }}
      pointers={REVIEW_POINTERS}
    >
      {(problem) => (
        <>
          <FormField
            label="Review status"
            error={fieldErrorOf(problem, '/data/attributes/review-status')}
          >
            {(control) => (
              <select
                {...control}
                name="review-status"
                defaultValue="indeterminate"
                className={controlClassName(control)}
              >
                {REPORT_REVIEW_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {REPORT_REVIEW_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            label="Risk level"
            error={fieldErrorOf(problem, '/data/attributes/risk-level')}
          >
            {(control) => (
              <select
                {...control}
                name="risk-level"
                defaultValue=""
                className={controlClassName(control)}
              >
                <option value="">Not set</option>
                {REPORT_RISK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {REPORT_RISK_LEVEL_LABELS[level]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <Checkbox
            name="notify-on-change"
            value="true"
            label="Alert me again when the entry or its risk data changes"
            description="A reviewed match returns to Not reviewed, and alerts, when the list entry's identity, programmes, positions or relations change."
          />
          <FormField
            label="Comment"
            required
            description={`Why you decided this, up to ${REPORT_REVIEW_COMMENT_MAX_LENGTH.toLocaleString('en-US')} characters. A false positive dismisses the match.`}
            error={fieldErrorOf(problem, COMMENT)}
          >
            {(control) => (
              <textarea
                {...control}
                name="comment"
                rows={3}
                maxLength={REPORT_REVIEW_COMMENT_MAX_LENGTH}
                className={controlClassName(control)}
              />
            )}
          </FormField>
        </>
      )}
    </DialogButton>
  );
}
