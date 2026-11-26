'use client';

import { Checkbox } from '@openverify/ui';
import type { ListResource } from '@openverify/contracts';
import { LIST_KIND_REGISTRY, LIST_LIMITS } from '@openverify/core';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { retentionDescription } from './create-list-form';
import { kindOfListType } from './list-words';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

const pointer = (member: string) => `/data/attributes/${member}`;
const POINTERS = ['name', 'item-retention-days'].map(pointer);

/**
 * A list's settings (C97.1 `PATCH`): its name, item retention, screening at completion and, for
 * government ID numbers, the compromised-ID check. The kind's matching settings never change.
 */
export function ListSettingsForm({
  list,
  faceTemplateRetentionDays,
  action,
}: {
  readonly list: ListResource;
  readonly faceTemplateRetentionDays: number | undefined;
  readonly action: Action;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    onSuccess: () => {
      show({ tone: 'success', message: 'Saved the list.' });
    },
  });
  const { problem } = form;
  const kind = kindOfListType(list.type);
  const biometric = LIST_KIND_REGISTRY[kind].biometric;
  const { attributes } = list;
  const retention = attributes['item-retention-days'];
  const compromised =
    'use-for-compromised-ids' in attributes ? attributes['use-for-compromised-ids'] : undefined;

  return (
    <form {...form.formProps} aria-label="Edit the list" className="flex max-w-xl flex-col gap-4">
      <input type="hidden" name="list-id" value={list.id} />
      <input type="hidden" name="kind" value={kind} />
      <FormField label="Name" required error={fieldErrorOf(problem, pointer('name'))}>
        {(control) => (
          <input
            {...control}
            name="name"
            defaultValue={attributes.name}
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
            type="number"
            name="item-retention-days"
            min={1}
            max={
              biometric
                ? (faceTemplateRetentionDays ?? LIST_LIMITS.itemRetentionDays)
                : LIST_LIMITS.itemRetentionDays
            }
            defaultValue={retention ?? ''}
            className={controlClassName(control)}
          />
        )}
      </FormField>
      <FormField
        label="Purpose"
        description="What adding an item means to a workflow: a block list's add is an adverse step, recorded and gated like a decline."
      >
        {(control) => (
          <select
            {...control}
            name="purpose"
            defaultValue={attributes.purpose}
            className={controlClassName(control)}
          >
            <option value="block">Block</option>
            <option value="allow">Allow</option>
            <option value="watch">Watch</option>
          </select>
        )}
      </FormField>
      <Checkbox
        name="screen-at-completion"
        defaultChecked={attributes['screen-at-completion']}
        label="Screen at inquiry completion"
      />
      {compromised !== undefined && (
        <Checkbox
          name="use-for-compromised-ids"
          defaultChecked={compromised}
          label="Use for the compromised ID check"
          description="A listed ID number fails id_compromised_detection, the one check a list can fail."
        />
      )}
      <ProblemDisplay problem={withoutFieldErrors(problem, POINTERS)} />
      <div>
        <SubmitButton pendingLabel="Saving…" pending={form.pending}>
          Save list
        </SubmitButton>
      </div>
    </form>
  );
}
