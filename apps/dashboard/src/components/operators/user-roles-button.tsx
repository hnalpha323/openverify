'use client';

import type { RoleAssignment } from '@openverify/contracts';
import { Button } from '@openverify/ui';
import { useRef, useState } from 'react';
import { fieldErrorOf, type ActionResult, type ActionState } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { Dialog } from '../dialog';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { useToast } from '../toasts';
import { useFormAction } from '../use-form-action';
import { withoutFieldErrors } from '../field-errors';
import { RoleChecklist } from './role-checklist';
import type { AssignmentScopeOption } from './grantable';
import type { RoleOption } from './role-options';

const ROLE_IDS_POINTER = '/data/attributes/role-ids';
const COPY = SETTINGS_COPY.users;

export interface UserRolesButtonProps {
  readonly userId: string;
  /** The user's name, or email when they have none yet. */
  readonly userLabel: string;
  /** Every role, with whether the operator may grant it (`roleOptions`). */
  readonly roles: readonly RoleOption[];
  readonly currentRoleIds: readonly string[];
  /** `updateUserRoles` from `app/users/actions.ts`. */
  readonly action: (state: ActionState, formData: FormData) => Promise<ActionResult>;
  /** C167.2: where each role may be assigned, by role id (`assignmentScopes`). */
  readonly scopes?: Readonly<Record<string, readonly AssignmentScopeOption[]>>;
  /**
   * K9-22 (DS8): reads where each role applies today (`readUserAssignments` from
   * `app/users/actions.ts`), so the dialog starts from the stored assignments.
   */
  readonly readAssignments?: (userId: string) => Promise<ActionResult<readonly RoleAssignment[]>>;
}

/** K9-22 (DS8): what the dialog knows of where each role applies today. */
type CurrentAssignments =
  | { readonly state: 'not-read' | 'reading' | 'unread' }
  | { readonly state: 'read'; readonly assignments: readonly RoleAssignment[] };

/**
 * Where a role's choice starts: its stored scope when one offered, grantable option says it (`all`
 * for every environment, or the one environment), else unchosen; `several` when the role is
 * assigned in more environments than one choice can say.
 */
function startingScope(
  current: CurrentAssignments,
  roleId: string,
  offered: readonly AssignmentScopeOption[],
): { value: string; several: boolean } {
  const stored =
    current.state === 'read'
      ? current.assignments.find((assignment) => assignment['role-id'] === roleId)
      : undefined;
  if (stored === undefined) {
    return { value: '', several: false };
  }
  const environments = stored['environment-ids'];
  if (environments !== null && environments.length > 1) {
    return { value: '', several: true };
  }
  const value = environments === null ? 'all' : (environments[0] ?? '');
  const option = offered.find((scope) => scope.value === value);
  return { value: option?.refusal === null ? value : '', several: false };
}

/** "Admin" or "Admin, Developer": the roles named in an explanation. */
const listed = (names: readonly string[]) => names.join(', ');

/**
 * Replaces a user's roles (C15). The API refuses a role with a permission the operator lacks
 * (403) and demoting the last active admin (409); the dialog shows either refusal. When the user
 * holds a role the operator cannot grant, the operator cannot keep it in a change either, so the
 * dialog explains instead of offering one.
 */
export function UserRolesButton({
  userId,
  userLabel,
  roles,
  currentRoleIds,
  action,
  scopes = {},
  readAssignments,
}: UserRolesButtonProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<CurrentAssignments>({ state: 'not-read' });
  const reading = useRef(0);
  const { show } = useToast();
  const beyondReach = roles
    .filter((role) => !role.grantable && currentRoleIds.includes(role.id))
    .map((role) => role.name);

  const { pending, problem, clearProblem, formProps } = useFormAction(action, {
    onSuccess: () => {
      setOpen(false);
      show({ tone: 'success', message: `The roles of ${userLabel} were updated.` });
    },
  });

  const close = () => {
    setOpen(false);
    clearProblem();
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          if (readAssignments !== undefined) {
            // K9-22 (DS8): start from the stored assignments, read afresh on every opening.
            const request = ++reading.current;
            setCurrent({ state: 'reading' });
            void readAssignments(userId).then(
              (result) => {
                if (request === reading.current) {
                  setCurrent(
                    result.ok ? { state: 'read', assignments: result.data } : { state: 'unread' },
                  );
                }
              },
              () => {
                if (request === reading.current) {
                  setCurrent({ state: 'unread' });
                }
              },
            );
          }
        }}
      >
        {'Edit roles '}
        <span className="sr-only">of {userLabel}</span>
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Roles of ${userLabel}`}
        description="Their permissions are the union of these roles."
        dismissible={!pending}
      >
        {beyondReach.length > 0 ? (
          <>
            <p className="text-sm text-ink">
              {`You cannot change the roles of ${userLabel}: ${listed(beyondReach)} ${
                beyondReach.length === 1 ? 'includes' : 'include'
              } permissions you do not hold.`}
            </p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={close}>
                Close
              </Button>
            </div>
          </>
        ) : current.state === 'reading' ? (
          <p role="status" className="text-sm text-ink-muted">
            {COPY.scopesReading}
          </p>
        ) : (
          <form {...formProps} className="flex flex-col gap-4">
            <input type="hidden" name="user-id" value={userId} />
            <RoleChecklist
              options={roles}
              defaultChecked={currentRoleIds}
              error={fieldErrorOf(problem, ROLE_IDS_POINTER)}
            />
            {/* C167.2: each role everywhere, or in one environment; refused scopes say why. */}
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-sm font-medium text-ink">{COPY.scopesLegend}</legend>
              <p className="text-sm text-ink-muted">
                {current.state === 'read'
                  ? COPY.scopesNoteCurrent
                  : current.state === 'unread'
                    ? COPY.scopesNoteUnread
                    : COPY.scopesNote}
              </p>
              {roles
                .filter((role) => role.grantable)
                .map((role) => {
                  const offered = scopes[role.id] ?? [
                    {
                      value: 'all',
                      label: 'Every environment, current and future',
                      refusal: null,
                    },
                  ];
                  const today = startingScope(current, role.id, offered);
                  return (
                    <FormField
                      key={role.id}
                      label={COPY.scopeLabel(role.name)}
                      error={fieldErrorOf(problem, `/scope-${role.id}`)}
                      {...(today.several ? { description: COPY.scopeSeveral(role.name) } : {})}
                    >
                      {(control) => (
                        <select
                          {...control}
                          name={`scope-${role.id}`}
                          defaultValue={today.value}
                          className={controlClassName(control)}
                        >
                          <option value="">{COPY.scopeChoose}</option>
                          {offered.map((scope) => (
                            <option
                              key={scope.value}
                              value={scope.value}
                              disabled={scope.refusal !== null}
                            >
                              {scope.refusal === null
                                ? scope.label
                                : `${scope.label} (${scope.refusal})`}
                            </option>
                          ))}
                        </select>
                      )}
                    </FormField>
                  );
                })}
            </fieldset>
            <ProblemDisplay
              problem={withoutFieldErrors(problem, [
                ROLE_IDS_POINTER,
                ...roles.map((role) => `/scope-${role.id}`),
              ])}
            />
            <div className="flex justify-end gap-3">
              <Button variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save roles'}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
