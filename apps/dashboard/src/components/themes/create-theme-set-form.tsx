'use client';

import { useRouter } from 'next/navigation';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { EnvironmentField } from '../environment-field';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';

const copy = THEMES_COPY.list;

/** Creates a theme set with every cell built in (C160.1), then opens it. */
export function CreateThemeSetForm({
  environmentId,
  action,
}: {
  readonly environmentId: string;
  readonly action: (
    state: ActionState<{ id: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ id: string }>>;
}) {
  const router = useRouter();
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/theme-sets/${id}`);
    },
  });
  return (
    <form
      {...form.formProps}
      aria-label={copy.createHeading}
      className="flex max-w-xl flex-col gap-4"
    >
      <h2 className="text-base font-semibold text-ink">{copy.createHeading}</h2>
      <EnvironmentField environmentId={environmentId} />
      <FormField
        label={copy.createName}
        description={copy.createHint}
        error={fieldErrorOf(form.problem, '/data/attributes/name')}
        required
      >
        {(control) => (
          <input
            {...control}
            name="name"
            maxLength={100}
            autoComplete="off"
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <ProblemDisplay problem={form.problem} />
      <div>
        <SubmitButton pending={form.pending} pendingLabel={THEMES_COPY.editor.saving}>
          {copy.createSubmit}
        </SubmitButton>
      </div>
    </form>
  );
}
