'use client';

import { MAX_INQUIRY_NOTE_LENGTH } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { FormField, controlClassName } from '../form-field';
import { EmptyValue, HiddenValue } from '../masked-value';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { RedactedValue } from './redacted-value';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface NoteEditorProps {
  readonly inquiryId: string;
  readonly note: string | null;
  /** `hidden` when the API masked the note (no `pii:view`); `redacted` after a redaction. */
  readonly state: 'visible' | 'hidden' | 'redacted';
  /** `inquiries:write` and `pii:view`, on an inquiry that is not redacted. */
  readonly canEdit: boolean;
  readonly action: Action;
}

function NoteText({ note, state }: Pick<NoteEditorProps, 'note' | 'state'>) {
  if (state === 'redacted') {
    return <RedactedValue />;
  }
  if (state === 'hidden') {
    return <HiddenValue />;
  }
  return note === null || note === '' ? (
    <EmptyValue />
  ) : (
    <p className="text-sm break-words whitespace-pre-wrap">{note}</p>
  );
}

/**
 * The operator's note on an inquiry (C10: at most 2,000 characters, encrypted at rest). Opening
 * the editor moves focus into the note; closing it (Cancel or a save) moves focus back to Edit
 * note, so focus never falls to the page when the control that had it goes (WCAG 2.4.3).
 */
export function NoteEditor({ inquiryId, note, state, canEdit, action }: NoteEditorProps) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  // Set before `editing` changes, so the effect knows the change came from the operator.
  const moveFocus = useRef(false);
  const { show } = useToast();
  // A refusal keeps the note typed (Workflow 2D K003).
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      close();
      show({ tone: 'success', message: 'Saved the note.' });
    },
  });
  const noteError = fieldErrorOf(problem, '/data/attributes/note');

  // A layout effect, so focus moves in the commit that shows the control: a save answers outside
  // any event, and a passive effect would leave focus on the page until it ran.
  useLayoutEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      (editing ? noteField : editButton).current?.focus();
    }
  }, [editing]);

  function close() {
    moveFocus.current = true;
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex flex-col items-start gap-3">
        <NoteText note={note} state={state} />
        {canEdit && (
          <Button
            ref={editButton}
            variant="secondary"
            onClick={() => {
              moveFocus.current = true;
              setEditing(true);
            }}
          >
            Edit note
          </Button>
        )}
      </div>
    );
  }
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="inquiry-id" value={inquiryId} />
      <FormField
        label="Note"
        description="At most 2,000 characters. Only operators who may see personal data can read it. Leave it empty to remove the note."
        error={noteError}
      >
        {(control) => (
          <textarea
            {...control}
            ref={noteField}
            name="note"
            rows={5}
            maxLength={MAX_INQUIRY_NOTE_LENGTH}
            defaultValue={note ?? ''}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <ProblemDisplay problem={withoutFieldErrors(problem, ['/data/attributes/note'])} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel="Saving…" pending={pending}>
          Save note
        </SubmitButton>
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
