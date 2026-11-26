import { permissionLevel, type Permission } from '@openverify/core';
import { Checkbox } from '@openverify/ui';
import { Fragment, useId } from 'react';
import { isSensitivePermission } from './grantable';
import { permissionAreas, permissionLabel } from './permissions';

const SENSITIVE = 'Sensitive.';
const ORGANISATION = 'Organisation level: takes effect only in an organisation-wide assignment.';
const NOT_HELD = 'You do not hold it, so you cannot grant it.';

/** The sentences after a permission's name: why it is refused, and its marks (C167.4). */
function sentencesOf(
  permission: Permission,
  grantable: boolean,
  refusal: string | undefined,
): string[] {
  return [
    ...(refusal !== undefined ? [refusal] : grantable ? [] : [NOT_HELD]),
    ...(isSensitivePermission(permission) ? [SENSITIVE] : []),
    ...(permissionLevel(permission) === 'organization' ? [ORGANISATION] : []),
  ];
}

export interface PermissionChecklistProps {
  /** The permissions checked at first, such as the role's. */
  readonly checked: readonly Permission[];
  /** The operator's own permissions: only these can be granted (C12), the rest are disabled. */
  readonly held: readonly Permission[];
  /** A validation message for the whole checklist. */
  readonly error?: string | undefined;
  /** C167.4: the grants the API would refuse, each with its reason (`roleEditorRefusals`). */
  readonly refusals?: Readonly<Partial<Record<Permission, string>>>;
}

/**
 * Every permission as a checkbox named `permissions`, grouped by area in nested fieldsets. A
 * permission the operator does not hold is disabled, with the reason as its description.
 */
export function PermissionChecklist({
  checked,
  held,
  error,
  refusals = {},
}: PermissionChecklistProps) {
  const errorId = useId();
  const invalid = error !== undefined && error !== '';
  return (
    <fieldset aria-describedby={invalid ? errorId : undefined} className="flex flex-col gap-4">
      <legend className="mb-2 text-sm font-medium text-ink">Permissions</legend>
      {invalid && (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {permissionAreas().map((area) => (
          <fieldset key={area.id} className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <legend className="px-1 text-sm font-semibold text-ink">{area.label}</legend>
            {area.permissions.map((permission) => {
              const refusal = refusals[permission];
              const grantable = held.includes(permission) && refusal === undefined;
              return (
                <Checkbox
                  key={permission}
                  name="permissions"
                  value={permission}
                  label={permissionLabel(permission)}
                  defaultChecked={checked.includes(permission)}
                  disabled={!grantable}
                  description={
                    <>
                      <code className="font-mono text-xs">{permission}</code>
                      {sentencesOf(permission, grantable, refusal).length > 0 && '. '}
                      {sentencesOf(permission, grantable, refusal).map((sentence, index) => (
                        <Fragment key={sentence}>
                          {index > 0 ? ' ' : ''}
                          <span
                            className={
                              sentence === SENSITIVE ? 'font-semibold text-ink' : undefined
                            }
                          >
                            {sentence === SENSITIVE && <span aria-hidden="true">⚠ </span>}
                            {sentence}
                          </span>
                        </Fragment>
                      ))}
                    </>
                  }
                />
              );
            })}
          </fieldset>
        ))}
      </div>
    </fieldset>
  );
}
