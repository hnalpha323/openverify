'use client';

import { Checkbox } from '@openverify/ui';
import type { TransactionTypeVersionResource } from '@openverify/contracts';
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
import { JsonEditor } from '../json-editor';
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

/** Creates a type by its name; its draft version 1 comes with the default statuses (C104.5). */
export function CreateTypeForm({
  environmentId,
  action,
}: {
  readonly environmentId: string;
  readonly action: IdAction;
}) {
  const router = useRouter();
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/transaction-types/${id}`);
    },
  });
  return (
    <form
      {...form.formProps}
      aria-label="Create a transaction type"
      className="flex flex-wrap items-end gap-4"
    >
      <EnvironmentField environmentId={environmentId} />
      <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
        {(control) => (
          <input {...control} name="name" maxLength={255} className={controlClassName(control)} />
        )}
      </FormField>
      <SubmitButton pendingLabel="Creating…" pending={form.pending}>
        Create type
      </SubmitButton>
      <ProblemDisplay className="w-full" problem={withoutFieldErrors(form.problem, [NAME])} />
    </form>
  );
}

/** Renames a type: the one thing of a type that is not a version's. */
export function RenameTypeForm({
  typeId,
  name,
  action,
}: {
  readonly typeId: string;
  readonly name: string;
  readonly action: Action;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Renamed the type.' });
    },
  });
  return (
    <form
      {...form.formProps}
      aria-label="Rename the type"
      className="flex flex-wrap items-end gap-4"
    >
      <input type="hidden" name="transaction-type-id" value={typeId} />
      <FormField label="Name" required error={fieldErrorOf(form.problem, NAME)}>
        {(control) => (
          <input
            {...control}
            name="name"
            defaultValue={name}
            maxLength={255}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <SubmitButton pendingLabel="Saving…" pending={form.pending}>
        Rename
      </SubmitButton>
      <ProblemDisplay className="w-full" problem={withoutFieldErrors(form.problem, [NAME])} />
    </form>
  );
}

/** Makes a draft from the latest version and opens it; a refusal shows as a toast. */
export function NewTypeDraftButton({
  typeId,
  action,
}: {
  readonly typeId: string;
  readonly action: IdAction;
}) {
  const router = useRouter();
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/transaction-types/${typeId}/versions/${id}`);
    },
    onProblem: (problem) => {
      show({ tone: 'error', message: problemSentence(problem) });
    },
  });
  return (
    <form {...form.formProps}>
      <input type="hidden" name="transaction-type-id" value={typeId} />
      <SubmitButton pendingLabel="Drafting…" pending={form.pending}>
        New draft
      </SubmitButton>
    </form>
  );
}

const DOCUMENTS = [
  { name: 'field-schemas', label: 'Fields', rows: 18 },
  { name: 'statuses', label: 'Statuses', rows: 6 },
  { name: 'relation-schemas', label: 'Relations', rows: 6 },
] as const;

/** The problem's errors inside one document, by pointer within it. */
function errorsIn(problem: DisplayProblem | undefined, member: string) {
  const root = `/data/attributes/${member}`;
  return (problem?.errors ?? [])
    .filter((error) => error.pointer === root || error.pointer.startsWith(`${root}/`))
    .map((error) => ({ pointer: error.pointer.slice(root.length) || '/', detail: error.detail }));
}

/**
 * A draft version's editor (C104.1, C104.2): its fields, statuses and relations as JSON documents,
 * which the API validates at publish and on save, each error shown under its document at its
 * pointer; and the card-number opt-out (C104.4). A refusal keeps the text as typed.
 */
export function DraftEditor({
  typeId,
  version,
  action,
}: {
  readonly typeId: string;
  readonly version: TransactionTypeVersionResource;
  readonly action: Action;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the draft.' });
    },
  });
  const shown = form.problem;
  const { attributes } = version;
  const values: Readonly<Record<string, unknown>> = {
    'field-schemas': attributes['field-schemas'],
    statuses: attributes.statuses,
    'relation-schemas': attributes['relation-schemas'],
  };
  const inside = DOCUMENTS.map((document) => `/data/attributes/${document.name}`);
  return (
    <form {...form.formProps} aria-label="Edit the draft" className="flex flex-col gap-6">
      <input type="hidden" name="transaction-type-id" value={typeId} />
      <input type="hidden" name="version-id" value={version.id} />
      {DOCUMENTS.map((document) => (
        <JsonEditor
          key={document.name}
          label={document.label}
          name={document.name}
          rows={document.rows}
          defaultValue={JSON.stringify(values[document.name], null, 2)}
          errors={errorsIn(shown, document.name)}
        />
      ))}
      <Checkbox
        name="allow-card-like-strings"
        defaultChecked={attributes['allow-card-like-strings']}
        label="Allow card-like values in fields"
        description="Lifts the card-number guard for this version’s fields only, never for the reference, tags or labels. Send a processor’s token, never a card number: storing one brings the installation into PCI DSS scope."
      />
      <ProblemDisplay
        problem={withoutFieldErrors(
          shown,
          (shown?.errors ?? [])
            .map((error) => error.pointer)
            .filter((pointer) =>
              inside.some((root) => pointer === root || pointer.startsWith(`${root}/`)),
            ),
        )}
      />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          Save draft
        </SubmitButton>
      </div>
    </form>
  );
}
