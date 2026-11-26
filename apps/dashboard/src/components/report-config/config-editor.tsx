'use client';

import { useState } from 'react';
import type { ActionResult, ActionState, DisplayProblem } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { JsonEditor } from '../json-editor';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { configPointerLabel } from './config-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface ConfigEditorProps {
  readonly templateId: string;
  readonly versionId: string;
  /** What the version sets: its resolved configuration less the keys at their default. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly action: Action;
}

const CONFIG_POINTER = '/data/attributes/config';

const inside = (pointer: string) =>
  pointer === CONFIG_POINTER || pointer.startsWith(`${CONFIG_POINTER}/`);

/** The source ids a submitted configuration lists, to name an item an error points at. */
function listsOf(text: FormDataEntryValue | null): string[] {
  try {
    const lists: unknown = (
      JSON.parse(typeof text === 'string' ? text : '') as Record<string, unknown> | null
    )?.['search-lists'];
    // Every item keeps its index; one that is not a string is named as its JSON.
    return Array.isArray(lists)
      ? lists.map((id: unknown) => (typeof id === 'string' ? id : JSON.stringify(id)))
      : [];
  } catch {
    return [];
  }
}

/** The problem's errors inside the configuration, by pointer within it and named in words. */
function configErrors(problem: DisplayProblem | undefined, searchLists: readonly string[]) {
  return (problem?.errors ?? [])
    .filter((error) => inside(error.pointer))
    .map((error) => {
      const pointer = error.pointer.slice(CONFIG_POINTER.length) || '/';
      return { pointer, detail: error.detail, label: configPointerLabel(pointer, searchLists) };
    });
}

/**
 * The draft editor (C71.2, C86): the version's configuration as JSON, which the API checks
 * against the template's type (422 with pointers). Each error shows under the document at its
 * place, named in words; anything else in the alert below. A refusal keeps the text as typed.
 */
export function ConfigEditor({ templateId, versionId, config, action }: ConfigEditorProps) {
  const { show } = useToast();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the draft.' });
    },
  });
  // The errors are about the text submitted, so its lists name the items they point at.
  const [submitted, setSubmitted] = useState<readonly string[]>([]);
  const errors = configErrors(problem, submitted);

  return (
    <form
      {...formProps}
      onSubmit={(event) => {
        setSubmitted(listsOf(new FormData(event.currentTarget).get('config')));
        formProps.onSubmit(event);
      }}
      aria-label="Edit the draft configuration"
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="report-template-id" value={templateId} />
      <input type="hidden" name="version-id" value={versionId} />
      <JsonEditor
        label="Configuration"
        name="config"
        rows={18}
        defaultValue={JSON.stringify(config, null, 2)}
        description="What this version sets. Keys you leave out take their default, shown beside with its basis. Leave out search-lists to pin every enabled source of the type’s kind when you save."
        errors={errors}
      />
      <ProblemDisplay
        problem={withoutFieldErrors(
          problem,
          (problem?.errors ?? [])
            .filter((error) => inside(error.pointer))
            .map((error) => error.pointer),
        )}
      />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={pending}>
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}
