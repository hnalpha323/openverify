'use client';

import type { RelationSchema } from '@openverify/contracts';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { RELATION_TARGET_WORDS } from './transaction-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

function useSavedAction(action: Action, message: string, resetOnSuccess = false) {
  const { show } = useToast();
  return useFormAction(action, {
    resetOnSuccess,
    onSuccess: () => {
      show({ tone: 'success', message });
    },
  });
}

const Id = ({ id }: { readonly id: string }) => (
  <input type="hidden" name="transaction-id" value={id} />
);

/** Changes a transaction's status to one of its type's (C104.5): `PATCH` with `status`. */
export function StatusForm({
  transactionId,
  status,
  statuses,
  action,
}: {
  readonly transactionId: string;
  readonly status: string;
  readonly statuses: readonly string[];
  readonly action: Action;
}) {
  const form = useSavedAction(action, 'Changed the status.');
  const choices = statuses.includes(status) ? statuses : [status, ...statuses];
  return (
    <form
      {...form.formProps}
      aria-label="Change the status"
      className="flex flex-wrap items-end gap-4"
    >
      <Id id={transactionId} />
      <FormField label="Status" error={fieldErrorOf(form.problem, '/data/attributes/status')}>
        {(control) => (
          <select
            {...control}
            name="status"
            defaultValue={status}
            className={controlClassName(control)}
          >
            {choices.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <SubmitButton pendingLabel="Saving…" pending={form.pending}>
        Change status
      </SubmitButton>
      <ProblemDisplay
        className="w-full"
        problem={withoutFieldErrors(form.problem, ['/data/attributes/status'])}
      />
    </form>
  );
}

/** Adds a label (C105.2): append-only history with its model version and score. */
export function LabelForm({
  transactionId,
  action,
}: {
  readonly transactionId: string;
  readonly action: Action;
}) {
  const form = useSavedAction(action, 'Added the label.', true);
  const shown = ['/meta/label', '/meta/score', '/meta/model-version'];
  return (
    <form {...form.formProps} aria-label="Add a label" className="flex flex-col gap-4">
      <Id id={transactionId} />
      <div className="flex flex-wrap items-start gap-4">
        <FormField
          label="Label"
          required
          description="Not personal data: labels are shown to every operator who reads transactions."
          error={fieldErrorOf(form.problem, '/meta/label')}
        >
          {(control) => (
            <input {...control} name="label" maxLength={64} className={controlClassName(control)} />
          )}
        </FormField>
        <FormField label="Score" error={fieldErrorOf(form.problem, '/meta/score')}>
          {(control) => (
            <input
              {...control}
              type="number"
              step="any"
              name="score"
              className={controlClassName(control)}
            />
          )}
        </FormField>
        <FormField label="Model version" error={fieldErrorOf(form.problem, '/meta/model-version')}>
          {(control) => (
            <input
              {...control}
              name="model-version"
              maxLength={64}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      </div>
      <ProblemDisplay problem={withoutFieldErrors(form.problem, shown)} />
      <div>
        <SubmitButton pendingLabel="Adding…" pending={form.pending}>
          Add label
        </SubmitButton>
      </div>
    </form>
  );
}

/** Attaches inquiries, reports and verifications (C105.2 `add-objects`), at most 100. */
export function AttachObjectsForm({
  transactionId,
  action,
}: {
  readonly transactionId: string;
  readonly action: Action;
}) {
  const form = useSavedAction(action, 'Attached the objects.', true);
  return (
    <form {...form.formProps} aria-label="Attach objects" className="flex flex-col gap-4">
      <Id id={transactionId} />
      <FormField
        label="Object IDs"
        required
        description="Inquiry, report or verification IDs, one per line or separated by commas."
        error={fieldErrorOf(form.problem, '/meta/object-ids')}
      >
        {(control) => (
          <textarea {...control} name="object-ids" rows={3} className={controlClassName(control)} />
        )}
      </FormField>
      <ProblemDisplay problem={withoutFieldErrors(form.problem, ['/meta/object-ids'])} />
      <div>
        <SubmitButton pendingLabel="Attaching…" pending={form.pending}>
          Attach
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Sets or removes a relation (C105.2 `add-relation`, `remove-relation`) declared by the type. A
 * second target of a cardinality-one relation is refused with `relation_cardinality_exceeded`,
 * worded at the relation field.
 */
export function RelationForm({
  transactionId,
  relations,
  add,
  remove,
}: {
  readonly transactionId: string;
  readonly relations: readonly RelationSchema[];
  readonly add: Action;
  readonly remove: Action;
}) {
  const form = useSavedAction(
    (state, formData) =>
      formData.get('intent') === 'remove' ? remove(state, formData) : add(state, formData),
    'Saved the relation.',
  );
  const shown = ['/meta/relation-schema-key', '/meta/target-object-id'];
  return (
    <form {...form.formProps} aria-label="Relations" className="flex flex-col gap-4">
      <Id id={transactionId} />
      <div className="flex flex-wrap items-start gap-4">
        <FormField label="Relation" error={fieldErrorOf(form.problem, '/meta/relation-schema-key')}>
          {(control) => (
            <select
              {...control}
              name="relation-schema-key"
              defaultValue={relations[0]?.key}
              className={controlClassName(control)}
            >
              {relations.map((relation) => (
                <option key={relation.key} value={relation.key}>
                  {`${relation.key} (${RELATION_TARGET_WORDS[relation.target]}, ${relation.cardinality === 'one' ? 'one target' : 'many targets'})`}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          label="Target ID"
          required
          description="An account (acc_…) or a transaction (txn_…) ID."
          error={fieldErrorOf(form.problem, '/meta/target-object-id')}
        >
          {(control) => (
            <input {...control} name="target-object-id" className={controlClassName(control)} />
          )}
        </FormField>
      </div>
      <ProblemDisplay problem={withoutFieldErrors(form.problem, shown)} />
      <div className="flex flex-wrap gap-3">
        <SubmitButton name="intent" value="add" pendingLabel="Saving…" pending={form.pending}>
          Set relation
        </SubmitButton>
        <SubmitButton
          name="intent"
          value="remove"
          variant="secondary"
          pendingLabel="Saving…"
          pending={form.pending}
        >
          Remove relation
        </SubmitButton>
      </div>
    </form>
  );
}
