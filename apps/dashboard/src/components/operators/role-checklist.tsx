import { Checkbox } from '@openverify/ui';
import { useId } from 'react';
import type { RoleOption } from './role-options';

export interface RoleChecklistProps {
  readonly options: readonly RoleOption[];
  /** The role IDs checked at first, such as a user's current roles. */
  readonly defaultChecked: readonly string[];
  /** A validation message for the group (`fieldErrorOf(problem, '/role-ids')`). */
  readonly error?: string | undefined;
  readonly legend?: string;
}

/**
 * The roles of an invitation or a user, as checkboxes named `role-ids`. A role the operator may
 * not grant is offered disabled, with the reason as its description.
 */
export function RoleChecklist({
  options,
  defaultChecked,
  error,
  legend = 'Roles',
}: RoleChecklistProps) {
  const errorId = useId();
  const invalid = error !== undefined && error !== '';
  return (
    <fieldset
      aria-describedby={invalid ? errorId : undefined}
      className="flex flex-col gap-3 rounded-lg border border-line p-4"
    >
      <legend className="px-1 text-sm font-medium text-ink">{legend}</legend>
      {options.map((option) => (
        <Checkbox
          key={option.id}
          name="role-ids"
          value={option.id}
          label={option.name}
          defaultChecked={defaultChecked.includes(option.id)}
          disabled={!option.grantable}
          description={`${option.builtin ? 'Built-in role' : 'Custom role'}${
            option.grantable
              ? ''
              : '. You cannot grant it: it includes permissions you do not hold.'
          }`}
        />
      ))}
      {invalid && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
