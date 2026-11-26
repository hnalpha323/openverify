'use client';

import { useRouter } from 'next/navigation';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { EnvironmentField } from '../environment-field';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { problemSentence } from '../lifecycle/tag-editor';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;
type IdAction = (
  state: ActionState<{ id: string }>,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;

const NAME = '/data/attributes/name';
const KEY = '/data/attributes/key';
const ROLES = '/data/attributes/visible-to-roles';

/** Every field error under `root` (the member, or an item of it), joined. */
function errorsUnder(problem: DisplayProblem | undefined, root: string): string | undefined {
  const details = (problem?.errors ?? [])
    .filter((error) => error.pointer === root || error.pointer.startsWith(`${root}/`))
    .map((error) => error.detail);
  return details.length === 0 ? undefined : details.join('. ');
}

/**
 * Creates a template by its name and key (C130.1); its first draft comes with the default statuses
 * and resolutions (C130.2), and the template's page opens.
 */
export function CreateTemplateForm({
  environmentId,
  action,
}: {
  readonly environmentId: string;
  readonly action: IdAction;
}) {
  const router = useRouter();
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/case-templates/${id}`);
    },
  });
  return (
    <form
      {...form.formProps}
      aria-label="Create a case template"
      className="flex flex-wrap items-end gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
        {(control) => (
          <input {...control} name="name" maxLength={80} className={controlClassName(control)} />
        )}
      </FormField>
      <FormField
        label="Key"
        required
        description="2 to 10 capital letters and digits, starting with a letter, such as KYC. It prefixes the name of every case (KYC-6) and never changes."
        error={fieldErrorOf(form.problem, KEY)}
      >
        {(control) => (
          <input
            {...control}
            name="key"
            maxLength={10}
            autoCapitalize="characters"
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <SubmitButton pendingLabel="Creating…" pending={form.pending}>
        Create template
      </SubmitButton>
      <ProblemDisplay className="w-full" problem={withoutFieldErrors(form.problem, [NAME, KEY])} />
    </form>
  );
}

/** A template's name and the roles that see its cases (C130.1, P14): the template's own members. */
export function TemplateSettingsForm({
  templateId,
  name,
  roles,
  action,
}: {
  readonly templateId: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly action: Action;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the template.' });
    },
  });
  return (
    <form {...form.formProps} aria-label="Name and visibility" className="flex flex-col gap-4">
      <input type="hidden" name="case-template-id" value={templateId} />
      <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
        {(control) => (
          <input
            {...control}
            name="name"
            defaultValue={name}
            maxLength={80}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Roles that see its cases"
        description="Role IDs, separated by spaces or commas. Leave it empty for every role that holds cases:read. An API key sees a restricted template’s cases only when it was minted with the template."
        error={errorsUnder(form.problem, ROLES)}
      >
        {(control) => (
          <textarea
            {...control}
            name="visible-to-roles"
            rows={2}
            defaultValue={roles.join(' ')}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <ProblemDisplay
        problem={withoutFieldErrors(
          form.problem,
          (form.problem?.errors ?? [])
            .map((error) => error.pointer)
            .filter((pointer) => pointer === NAME || pointer.startsWith(ROLES)),
        )}
      />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

/** Makes a draft from the latest version and opens it; a refusal shows as a toast. */
export function NewTemplateDraftButton({
  templateId,
  action,
}: {
  readonly templateId: string;
  readonly action: IdAction;
}) {
  const router = useRouter();
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/case-templates/${templateId}/versions/${id}`);
    },
    onProblem: (problem) => {
      show({ tone: 'error', message: problemSentence(problem) });
    },
  });
  return (
    <form {...form.formProps}>
      <input type="hidden" name="case-template-id" value={templateId} />
      <SubmitButton pendingLabel="Drafting…" pending={form.pending}>
        New draft
      </SubmitButton>
    </form>
  );
}
