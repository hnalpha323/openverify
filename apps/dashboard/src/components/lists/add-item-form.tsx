'use client';

import { ID_CLASSES, LIST_EMAIL_MATCH_TYPES, type ListKind } from '@openverify/core';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

interface ItemField {
  readonly name: string;
  readonly label: string;
  readonly type?: 'number';
  readonly description?: string;
  readonly required?: boolean;
  readonly step?: string;
}

const VALUE_LABELS: Readonly<Partial<Record<ListKind, string>>> = {
  'browser-fingerprint': 'Fingerprint',
  'device-fingerprint': 'Fingerprint',
  'ip-address': 'IP address or CIDR range',
  'phone-number': 'Phone number',
  string: 'Value',
};

/** The fields an item of `kind` takes (C97.1), beside the selects of emails and ID numbers. */
function fieldsOf(kind: ListKind): readonly ItemField[] {
  switch (kind) {
    case 'country':
      return [
        { name: 'country-code', label: 'Country code', description: 'Two letters, such as NL.' },
      ];
    case 'email-address':
      return [{ name: 'value', label: 'Email address' }];
    case 'face':
    case 'selfie-background':
      return [
        {
          name: 'inquiry-id',
          label: 'Inquiry ID',
          description:
            'The inquiry whose centre selfie becomes the item. It needs that inquiry’s biometric matching consent.',
        },
      ];
    case 'geolocation':
      return [
        { name: 'latitude', label: 'Latitude', type: 'number', step: 'any' },
        { name: 'longitude', label: 'Longitude', type: 'number', step: 'any' },
        { name: 'radius-meters', label: 'Radius (meters)', type: 'number', step: 'any' },
      ];
    case 'government-id-number':
      return [{ name: 'id-number', label: 'ID number' }];
    case 'field':
      return [{ name: 'field-value', label: 'Field value' }];
    case 'name':
      return [
        { name: 'name-first', label: 'First name' },
        { name: 'name-last', label: 'Last name' },
      ];
    default:
      return [
        {
          name: 'value',
          label: VALUE_LABELS[kind] ?? 'Value',
          ...(kind === 'browser-fingerprint' || kind === 'device-fingerprint'
            ? { description: 'The 64 hexadecimal characters a device resource shows.' }
            : {}),
        },
      ];
  }
}

const pointer = (name: string) => `/data/attributes/${name}`;

const classLabel = (idClass: string) =>
  `${idClass.charAt(0).toUpperCase()}${idClass.slice(1).replaceAll('_', ' ')}`;

/**
 * Adds one item to a list (C97.1, C108). The values typed are personal data: they go to the
 * server action only, and the form empties after a success.
 */
export function AddItemForm({
  listId,
  kind,
  action,
}: {
  readonly listId: string;
  readonly kind: ListKind;
  readonly action: Action;
}) {
  const { show } = useToast();
  const form = useFormAction(action, {
    resetOnSuccess: true,
    onSuccess: () => {
      show({ tone: 'success', message: 'Added the item.' });
    },
  });
  const { problem } = form;
  const fields = fieldsOf(kind);
  const shown = [...fields.map((field) => field.name), 'match-type', 'id-class'].map(pointer);

  return (
    <form {...form.formProps} aria-label="Add an item" className="flex flex-col gap-4">
      <input type="hidden" name="list-id" value={listId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="flex flex-wrap items-start gap-4">
        {fields.map((field) => (
          <FormField
            key={field.name}
            label={field.label}
            required={field.required ?? true}
            {...(field.description === undefined ? {} : { description: field.description })}
            error={fieldErrorOf(problem, pointer(field.name))}
          >
            {(control) => (
              <input
                {...control}
                name={field.name}
                autoComplete="off"
                {...(field.type === undefined ? {} : { type: field.type, step: field.step })}
                className={controlClassName(control)}
              />
            )}
          </FormField>
        ))}
        {kind === 'email-address' && (
          <FormField label="Match" error={fieldErrorOf(problem, pointer('match-type'))}>
            {(control) => (
              <select
                {...control}
                name="match-type"
                defaultValue="email_address"
                className={controlClassName(control)}
              >
                {LIST_EMAIL_MATCH_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'domain' ? 'Domain' : 'Whole address'}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        {kind === 'government-id-number' && (
          <FormField label="ID class" error={fieldErrorOf(problem, pointer('id-class'))}>
            {(control) => (
              <select
                {...control}
                name="id-class"
                defaultValue=""
                className={controlClassName(control)}
              >
                <option value="">Any class</option>
                {ID_CLASSES.map((idClass) => (
                  <option key={idClass} value={idClass}>
                    {classLabel(idClass)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
      </div>
      <ProblemDisplay problem={withoutFieldErrors(problem, shown)} />
      <div>
        <SubmitButton pendingLabel="Adding…" pending={form.pending}>
          Add item
        </SubmitButton>
      </div>
    </form>
  );
}
