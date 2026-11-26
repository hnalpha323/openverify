'use client';

import { Button } from '@openverify/ui';
import { useId, useState } from 'react';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { Dialog } from '../dialog';
import { FormField, controlClassName } from '../form-field';
import { withoutFieldErrors } from '../field-errors';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { TAG_CLASS } from './tag-list';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface TagEditorProps {
  readonly tags: readonly string[];
  /** Hidden fields that name the object, such as `{ 'inquiry-id': id }`. */
  readonly fields: Readonly<Record<string, string>>;
  /** The operator may change the tags (`inquiries:write` or `accounts:write`). */
  readonly canEdit: boolean;
  readonly addTag: Action;
  readonly removeTag: Action;
  readonly setTags: Action;
}

function HiddenFields({ fields }: { readonly fields: Readonly<Record<string, string>> }) {
  return Object.entries(fields).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
}

/** A problem as one line, for a toast. */
export function problemSentence(problem: DisplayProblem): string {
  return problem.detail === undefined ? problem.title : `${problem.title}: ${problem.detail}`;
}

function RemoveTagButton({
  tag,
  fields,
  action,
}: {
  readonly tag: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly action: Action;
}) {
  const { show } = useToast();
  // No room to show a refusal next to the button: it goes to a toast, which stays (F011).
  const { pending, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: `Removed the tag ${tag}.` });
    },
    onProblem: (problem) => {
      show({ tone: 'error', message: problemSentence(problem) });
    },
  });
  return (
    <form {...formProps} className="inline-flex">
      <HiddenFields fields={fields} />
      <input type="hidden" name="tag-name" value={tag} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove tag ${tag}`}
        className="ms-1 rounded px-1 font-semibold text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
      >
        <span aria-hidden="true">×</span>
      </button>
    </form>
  );
}

function AddTagForm({
  fields,
  action,
}: {
  readonly fields: Readonly<Record<string, string>>;
  readonly action: Action;
}) {
  const { show } = useToast();
  // A refusal keeps the tag typed; a success empties the field for the next one (Workflow 2D K003).
  const { pending, problem, formProps } = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({ tone: 'success', message: 'Added the tag.' });
    },
  });
  const fieldError = fieldErrorOf(problem, '/meta/tag-name');
  return (
    <form {...formProps} className="flex flex-col gap-2">
      <HiddenFields fields={fields} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="New tag" error={fieldError} className="min-w-48 flex-1">
          {(control) => (
            <input
              {...control}
              name="tag-name"
              required
              maxLength={64}
              autoComplete="off"
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <SubmitButton variant="secondary" pendingLabel="Adding…" pending={pending}>
          Add tag
        </SubmitButton>
      </div>
      <ProblemDisplay problem={withoutFieldErrors(problem, ['/meta/tag-name'])} />
    </form>
  );
}

function EditAllTags({
  tags,
  fields,
  action,
}: {
  readonly tags: readonly string[];
  readonly fields: Readonly<Record<string, string>>;
  readonly action: Action;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { show } = useToast();
  // A refusal keeps the list typed (Workflow 2D K003).
  const { pending, problem, clearProblem, formProps } = useFormAction(action, {
    onSuccess: () => {
      setOpen(false);
      show({ tone: 'success', message: 'Saved the tags.' });
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          clearProblem();
          setOpen(true);
        }}
      >
        Edit all tags
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Edit all tags"
        description="The list replaces every tag. Up to 50 tags."
        dismissible={!pending}
      >
        <form {...formProps} className="flex flex-col gap-4">
          <HiddenFields fields={fields} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-tags`} className="text-sm font-medium text-ink">
              Tags, one per line
            </label>
            <textarea
              id={`${id}-tags`}
              name="tag-names"
              rows={8}
              defaultValue={tags.join('\n')}
              spellCheck={false}
              className={`${controlClassName({})} font-mono text-sm`}
            />
          </div>
          <ProblemDisplay problem={problem} />
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
              Save tags
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/**
 * An object's tags (C9): listed, and with the write permission removed one by one, added, or
 * replaced as a whole list (`set-tags`).
 */
export function TagEditor({ tags, fields, canEdit, addTag, removeTag, setTags }: TagEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      {tags.length === 0 ? (
        <p className="text-sm text-ink-muted">No tags.</p>
      ) : (
        <ul aria-label="Tags" className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag} className={TAG_CLASS}>
              {tag}
              {canEdit && <RemoveTagButton tag={tag} fields={fields} action={removeTag} />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-4">
          <AddTagForm fields={fields} action={addTag} />
          <EditAllTags tags={tags} fields={fields} action={setTags} />
        </div>
      )}
    </div>
  );
}
