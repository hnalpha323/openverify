'use client';

/**
 * Binding a running workflow as an account action (C118.7) or a case action (C140.1), C141.7: the
 * create form (the workflow, what it binds to, a label) and the edit form (the label, the status,
 * and the parameter form's prefill: one path per trigger input, `account.fields.*` or
 * `case.fields.*`, never a value, P38). The bound workflow's trigger inputs are the form a reviewer
 * fills when running the action, through `parameters.ts`.
 */
import { useRouter } from 'next/navigation';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

/** The control of one input's prefill path. */
export const PREFILL_FIELD_PREFIX = 'prefill.';

export type BindingKind = 'account' | 'case';

type Action = (
  state: ActionState<{ readonly id: string }>,
  formData: FormData,
) => Promise<ActionResult<{ readonly id: string }>>;

/** A choice of a select: an id and its words. */
export interface Choice {
  readonly id: string;
  readonly label: string;
}

const WORDS = {
  account: {
    path: '/account-actions',
    target: 'Account type',
    root: 'account.fields',
    description: 'Shown on each account of this type to whoever may run it.',
  },
  case: {
    path: '/case-actions',
    target: 'Case template ids',
    root: 'case.fields',
    description: 'Shown in the header of each case on these templates to whoever may run it.',
  },
} as const;

const LABEL = '/data/attributes/label';
const TARGETS = {
  account: '/data/attributes/account-type-id',
  case: '/data/attributes/case-template-ids',
} as const;

/** C118.7, C140.1: binds a running workflow; the prefill is set on the action's own page. */
export function CreateBindingForm({
  kind,
  workflows,
  targets,
  action,
}: {
  readonly kind: BindingKind;
  /** Running workflows whose trigger fits the kind. */
  readonly workflows: readonly Choice[];
  /** The account types (for an account action); case templates are typed as ids. */
  readonly targets: readonly Choice[];
  readonly action: Action;
}) {
  const router = useRouter();
  const words = WORDS[kind];
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`${words.path}/${id}`);
    },
  });
  const pointers = [LABEL, TARGETS[kind], '/data/attributes/workflow-id'];
  return (
    <form
      {...form.formProps}
      aria-label={kind === 'account' ? 'Bind an account action' : 'Bind a case action'}
      className="flex flex-col gap-4"
    >
      <p className="text-sm">{words.description}</p>
      <FormField
        label="Workflow"
        required
        error={fieldErrorOf(form.problem, '/data/attributes/workflow-id')}
      >
        {(control) => (
          <select
            {...control}
            name="workflow-id"
            defaultValue={workflows[0]?.id ?? ''}
            className={controlClassName(control)}
          >
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.label}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {kind === 'account' ? (
        <FormField
          label={words.target}
          required
          error={fieldErrorOf(form.problem, TARGETS.account)}
        >
          {(control) => (
            <select
              {...control}
              name="account-type-id"
              defaultValue={targets[0]?.id ?? ''}
              className={controlClassName(control)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : (
        <FormField
          label={words.target}
          required
          description="ctmpl_ ids, separated by commas or spaces."
          error={fieldErrorOf(form.problem, TARGETS.case)}
        >
          {(control) => (
            <input
              {...control}
              name="case-template-ids"
              spellCheck={false}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      )}
      <FormField label="Label" required error={fieldErrorOf(form.problem, LABEL)}>
        {(control) => (
          <input {...control} name="label" maxLength={80} className={controlClassName(control)} />
        )}
      </FormField>
      <ProblemDisplay problem={withoutFieldErrors(form.problem, pointers)} />
      <div>
        <SubmitButton pendingLabel="Binding…" pending={form.pending}>
          Bind
        </SubmitButton>
      </div>
    </form>
  );
}

/** C118.7, C140.1: the label, the status and one prefill path per trigger input. */
export function EditBindingForm({
  kind,
  id,
  label,
  status,
  caseTemplateIds,
  inputs,
  prefill,
  action,
}: {
  readonly kind: BindingKind;
  readonly id: string;
  readonly label: string;
  readonly status: 'active' | 'archived';
  /** A case action's templates. */
  readonly caseTemplateIds?: readonly string[];
  /** The bound workflow's live trigger inputs, by name and declared type. */
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly prefill: Readonly<Record<string, string>>;
  readonly action: Action;
}) {
  const { show } = useToast();
  const words = WORDS[kind];
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'The action was saved.' });
    },
  });
  const prefillErrors = (form.problem?.errors ?? [])
    .map((error) => error.pointer)
    .filter((pointer) => pointer.startsWith('/data/attributes/prefill'));
  return (
    <form {...form.formProps} aria-label="Edit the action" className="flex flex-col gap-4">
      <input
        type="hidden"
        name={kind === 'account' ? 'account-action-id' : 'case-action-id'}
        value={id}
      />
      <FormField label="Label" required error={fieldErrorOf(form.problem, LABEL)}>
        {(control) => (
          <input
            {...control}
            name="label"
            maxLength={80}
            defaultValue={label}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      {kind === 'case' && (
        <FormField
          label={words.target}
          required
          description="ctmpl_ ids, separated by commas or spaces."
          error={fieldErrorOf(form.problem, TARGETS.case)}
        >
          {(control) => (
            <input
              {...control}
              name="case-template-ids"
              defaultValue={(caseTemplateIds ?? []).join(', ')}
              spellCheck={false}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      )}
      <FormField label="Status">
        {(control) => (
          <select
            {...control}
            name="status"
            defaultValue={status}
            className={controlClassName(control)}
          >
            <option value="active">Active: offered to whoever may run it</option>
            <option value="archived">Archived: offered to nobody</option>
          </select>
        )}
      </FormField>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Parameter form</legend>
        <p className="text-sm">
          {`Each input of the workflow's trigger is a field of the form. A field may start from a ${words.root}.* path; it is filled under the reader's mask, so a value they may not see stays empty, and the run reads the live value under its grant.`}
        </p>
        {inputs.length === 0 ? (
          <p className="text-sm">The workflow’s live version declares no input.</p>
        ) : (
          inputs.map((input) => (
            <FormField
              key={input.name}
              label={`${input.name} (${input.type})`}
              description={`Prefilled from, such as ${words.root}.${input.name}; empty for none.`}
            >
              {(control) => (
                <input
                  {...control}
                  name={`${PREFILL_FIELD_PREFIX}${input.name}`}
                  defaultValue={prefill[input.name] ?? ''}
                  spellCheck={false}
                  className={controlClassName(control)}
                />
              )}
            </FormField>
          ))
        )}
      </fieldset>
      <ProblemDisplay
        problem={withoutFieldErrors(form.problem, [LABEL, TARGETS.case, ...prefillErrors])}
      />
      {prefillErrors.length > 0 && (
        <p role="alert" className="text-sm text-danger">
          A prefill path was refused: use an existing {words.root}.* path for a declared input.
        </p>
      )}
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          Save
        </SubmitButton>
      </div>
    </form>
  );
}
