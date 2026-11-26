'use client';

import type { InquiryFieldValue } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useState, type ReactNode } from 'react';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { Dialog } from '../dialog';
import { JsonEditor } from '../json-editor';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** Where the request carries the fields (`PATCH /inquiries/:id`, `PATCH /accounts/:id`). */
const FIELDS_POINTER = '/data/attributes/fields';

export interface FieldsEditorProps {
  readonly fields: Readonly<Record<string, InquiryFieldValue>>;
  /** Hidden form fields that name the object, such as `{ 'account-id': id }`. */
  readonly hiddenFields: Readonly<Record<string, string>>;
  /** How the API applies the document, such as "merged". */
  readonly description: ReactNode;
  readonly action: Action;
}

/** The problem's errors about the fields, by pointer inside the fields document, and the rest. */
function splitErrors(problem: DisplayProblem | undefined) {
  const errors = problem?.errors ?? [];
  const inside = (pointer: string) =>
    pointer === FIELDS_POINTER || pointer.startsWith(`${FIELDS_POINTER}/`);
  return {
    fields: errors
      .filter((error) => inside(error.pointer))
      .map((error) => ({
        pointer: error.pointer.slice(FIELDS_POINTER.length) || '/',
        detail: error.detail,
      })),
    rest:
      problem === undefined
        ? undefined
        : { ...problem, errors: errors.filter((error) => !inside(error.pointer)) },
  };
}

/** Edits an object's fields as a JSON object; the API validates them and answers by path. */
export function FieldsEditor({ fields, hiddenFields, description, action }: FieldsEditorProps) {
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  // A refusal keeps the fields typed (Workflow 2D K003).
  const { pending, problem, clearProblem, formProps } = useFormAction(action, {
    onSuccess: () => {
      setOpen(false);
      show({ tone: 'success', message: 'Saved the fields.' });
    },
  });
  const errors = splitErrors(problem);

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          clearProblem();
          setOpen(true);
        }}
      >
        Edit fields
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Edit fields"
        description={description}
        dismissible={!pending}
        size="lg"
      >
        <form {...formProps} className="flex flex-col gap-4">
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <JsonEditor
            label="Fields"
            name="fields"
            rows={12}
            defaultValue={JSON.stringify(fields, null, 2)}
            errors={errors.fields}
          />
          <ProblemDisplay problem={errors.rest} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <SubmitButton pendingLabel="Saving…" pending={pending}>
              Save fields
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}
