'use client';

import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

const copy = THEMES_COPY.set;

/** Renames a theme set (C160.1); the name is 1 to 100 characters. */
export function RenameThemeSetForm({
  themeSetId,
  name,
  action,
}: {
  readonly themeSetId: string;
  readonly name: string;
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: copy.renamed });
    },
  });
  return (
    <form
      {...form.formProps}
      aria-label={copy.renameHeading}
      className="flex max-w-xl items-end gap-3"
    >
      <input type="hidden" name="theme-set-id" value={themeSetId} />
      <FormField
        label={copy.renameHeading}
        error={fieldErrorOf(form.problem, '/name')}
        className="grow"
      >
        {(control) => (
          <input
            {...control}
            name="name"
            defaultValue={name}
            maxLength={100}
            autoComplete="off"
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <SubmitButton
        pending={form.pending}
        pendingLabel={THEMES_COPY.editor.saving}
        variant="secondary"
      >
        {copy.renameSubmit}
      </SubmitButton>
      <ProblemDisplay problem={form.problem} />
    </form>
  );
}
