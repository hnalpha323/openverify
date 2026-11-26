'use client';

import { Checkbox } from '@openverify/ui';
import { LIST_KINDS, LIST_KIND_REGISTRY, LIST_LIMITS, type ListKind } from '@openverify/core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { EnvironmentField } from '../environment-field';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';
import { LIST_KIND_LABELS } from './list-words';

type Action = (
  state: ActionState<{ id: string }>,
  formData: FormData,
) => Promise<ActionResult<{ id: string }>>;

const pointer = (member: string) => `/data/attributes/${member}`;
const POINTERS = [
  '/kind',
  ...['name', 'item-retention-days', 'field-key', 'default-region'].map(pointer),
];

/** The description of the retention field, which a face or background list must set (P08). */
export function retentionDescription(biometric: boolean, faceDays: number | undefined): string {
  if (!biometric) {
    return 'Leave empty to keep items until they are removed.';
  }
  return faceDays === undefined
    ? 'Required for a face or background list: at most the face template retention of this environment, which the source consent promises.'
    : `Required for a face or background list: at most ${String(faceDays)} days, the face template retention of this environment, which the source consent promises.`;
}

/**
 * Creates a list of any kind (C97.1, C108): the kind decides which settings it asks. On success the
 * list's page opens. The API is the judge; its field errors show at their fields.
 */
export function CreateListForm({
  environmentId,
  initialKind,
  faceTemplateRetentionDays,
  action,
}: {
  readonly environmentId: string;
  readonly initialKind: ListKind;
  readonly faceTemplateRetentionDays: number | undefined;
  readonly action: Action;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ListKind>(initialKind);
  const form = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/lists/${id}`);
    },
  });
  const { problem } = form;
  const biometric = LIST_KIND_REGISTRY[kind].biometric;
  const maxDays = biometric
    ? (faceTemplateRetentionDays ?? LIST_LIMITS.itemRetentionDays)
    : LIST_LIMITS.itemRetentionDays;

  return (
    <form {...form.formProps} aria-label="Create a list" className="flex max-w-xl flex-col gap-5">
      <EnvironmentField environmentId={environmentId} />
      <FormField label="Type" error={fieldErrorOf(problem, '/kind')}>
        {(control) => (
          <select
            {...control}
            name="kind"
            value={kind}
            onChange={(event) => {
              setKind(event.currentTarget.value as ListKind);
            }}
            className={controlClassName(control)}
          >
            {LIST_KINDS.map((each) => (
              <option key={each} value={each}>
                {LIST_KIND_LABELS[each]}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField
        label="Name"
        required
        description="Not personal data: list names are shown to every operator who reads lists."
        error={fieldErrorOf(problem, pointer('name'))}
      >
        {(control) => (
          <input
            {...control}
            name="name"
            maxLength={LIST_LIMITS.nameLength}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Item retention (days)"
        required={biometric}
        description={retentionDescription(biometric, faceTemplateRetentionDays)}
        error={fieldErrorOf(problem, pointer('item-retention-days'))}
      >
        {(control) => (
          <input
            {...control}
            key={biometric ? 'biometric' : 'plain'}
            type="number"
            name="item-retention-days"
            min={1}
            max={maxDays}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <Checkbox
        name="screen-at-completion"
        defaultChecked
        label="Screen at inquiry completion"
        description="A template that screens every list reads this one when an inquiry completes."
      />
      {kind === 'field' && (
        <FormField
          label="Field key"
          required
          description="The key of the inquiry fields this list compares."
          error={fieldErrorOf(problem, pointer('field-key'))}
        >
          {(control) => (
            <input
              {...control}
              name="field-key"
              maxLength={64}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      )}
      {kind === 'name' && (
        <Checkbox
          name="allow-fuzzy-name-first"
          label="Match first names fuzzily"
          description="A beta, H-tier method: last names still match exactly, and each match carries its score."
        />
      )}
      {kind === 'phone-number' && (
        <FormField
          label="Default region"
          description="A two-letter country code for numbers given without an international prefix."
          error={fieldErrorOf(problem, pointer('default-region'))}
        >
          {(control) => (
            <input
              {...control}
              name="default-region"
              maxLength={2}
              className={controlClassName(control)}
            />
          )}
        </FormField>
      )}
      {kind === 'string' && <Checkbox name="case-sensitive" label="Case-sensitive" />}
      {kind === 'government-id-number' && (
        <Checkbox
          name="use-for-compromised-ids"
          label="Use for the compromised ID check"
          description="The one list a match can fail a check on: a listed ID number fails id_compromised_detection. Keep the check advisory if a person must review it."
        />
      )}
      <ProblemDisplay problem={withoutFieldErrors(problem, POINTERS)} />
      <div>
        <SubmitButton pendingLabel="Creating…" pending={form.pending}>
          Create list
        </SubmitButton>
      </div>
    </form>
  );
}
