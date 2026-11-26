'use client';

import type { Permission } from '@openverify/core';
import { Button, Field, Input } from '@openverify/ui';
import { useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { withoutFieldErrors } from '../field-errors';
import { ConfirmDialog } from '../confirm-dialog';
import { PermissionChecklist } from './permission-checklist';
import { permissionLabel } from './permissions';

const NAME_POINTER = '/data/attributes/name';
const PERMISSIONS_POINTER = '/data/attributes/permissions';

const removalTitle = (count: number, name: string) =>
  `Remove ${String(count)} ${count === 1 ? 'permission' : 'permissions'} from ${name}?`;

/** What a change removes and from how many users (C167.4); the count is unknown without users:read. */
function removalDescription(removed: readonly Permission[], holders: number | null): string {
  const listed = removed
    .map((permission) => `${permissionLabel(permission)} (${permission})`)
    .join(', ');
  const who =
    holders === null
      ? 'Every user with this role loses'
      : `${String(holders)} ${holders === 1 ? 'user' : 'users'} with this role lose`;
  return `${who} ${removed.length === 1 ? 'it' : 'them'}: ${listed}.`;
}

export interface RoleFormProps {
  /** `createRole` or `updateRole` from `app/roles/actions.ts`. */
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  /** The operator's permissions: a role can grant only these (C12). */
  readonly held: readonly Permission[];

  readonly submitLabel: string;
  readonly pendingLabel: string;
  /** The custom role being edited; a new role without it. */
  readonly role?: {
    readonly id: string;
    readonly name: string;
    readonly permissions: readonly Permission[];
  };
  /** A toast once saved (an edit stays on the page; a creation opens the new role). */
  readonly successMessage?: string;
  /** C167.4: the grants the API would refuse, each with its reason. */
  readonly refusals?: Readonly<Partial<Record<Permission, string>>>;
  /** C167.4: how many users hold the role being edited; `null` when the editor cannot tell. */
  readonly holders?: number | null;
}

/** A custom role's name and permissions (C15). */
export function RoleForm({
  action,
  held: heldPermissions,
  submitLabel,
  pendingLabel,
  role,
  successMessage,
  refusals = {},
  holders = null,
}: RoleFormProps) {
  const { show } = useToast();
  const [held, setHeld] = useState<{ formData: FormData; removed: Permission[] } | null>(null);
  const { pending, problem, formProps, submit } = useFormAction(action, {
    onSuccess: () => {
      if (successMessage !== undefined) {
        show({ tone: 'success', message: successMessage });
      }
    },
  });

  return (
    <>
      <form
        action={formProps.action}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          // C167.4: a change that removes permissions says what, and from how many users, first.
          const kept = new Set(formData.getAll('permissions'));
          const removed = (role?.permissions ?? []).filter((permission) => !kept.has(permission));
          if (removed.length > 0) {
            setHeld({ formData, removed });
          } else {
            submit(formData);
          }
        }}
        className="flex flex-col gap-6"
      >
        {role !== undefined && <input type="hidden" name="role-id" value={role.id} />}
        <Field label="Name" error={fieldErrorOf(problem, NAME_POINTER)} className="max-w-md">
          <Input name="name" defaultValue={role?.name ?? ''} maxLength={100} autoComplete="off" />
        </Field>
        <PermissionChecklist
          checked={role?.permissions ?? []}
          held={heldPermissions}
          refusals={refusals}
          error={fieldErrorOf(problem, PERMISSIONS_POINTER)}
        />
        <ProblemDisplay
          problem={withoutFieldErrors(problem, [NAME_POINTER, PERMISSIONS_POINTER])}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={held !== null}
        title={removalTitle(held?.removed.length ?? 0, role?.name ?? '')}
        description={removalDescription(held?.removed ?? [], holders)}
        confirmLabel="Remove and save"
        onCancel={() => {
          setHeld(null);
        }}
        onConfirm={() => {
          if (held !== null) {
            submit(held.formData);
          }
          setHeld(null);
        }}
      />
    </>
  );
}
