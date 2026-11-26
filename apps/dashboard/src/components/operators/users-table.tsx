import type { UserStatus } from '@openverify/contracts';
import Link from 'next/link';
import type { ActionResult, ActionState } from '../../lib/action-state';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { ConfirmActionButton } from '../confirm-action-button';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import type { InvitationAction } from './invite-user-button';
import type { AssignmentScopeOption } from './grantable';
import type { RoleOption } from './role-options';
import { UserRolesButton, type UserRolesButtonProps } from './user-roles-button';
import { StepUpCodeField, type StepUpCodeFieldProps } from './step-up-code-field';
import { UserStatusBadge } from './user-status-badge';

export interface UserRow {
  readonly id: string;
  readonly email: string;
  /** Null until the invitee accepts and chooses one. */
  readonly name: string | null;
  readonly status: UserStatus;
  /** Each role with its name, or a null name when the operator cannot read roles. */
  readonly roles: readonly { readonly id: string; readonly name: string | null }[];
  /** Whether the user has an active MFA factor; null when the API does not say. */
  readonly mfaEnabled: boolean | null;
  /** C168.5: the factor kinds and their counts; null when the API does not say (no users:write). */
  readonly mfaFactors:
    readonly { readonly kind: 'totp' | 'webauthn'; readonly count: number }[] | null;
  /** C168.5: the last sign-in; null when never, undefined when the API does not say. */
  readonly lastSignInAt: string | null | undefined;
  readonly createdAt: string;
}

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

/** What an operator with `users:write` may do from the list. */
export interface UserManagement {
  /** Every role with whether the operator may grant it; null without `roles:read`. */
  readonly roles: readonly RoleOption[] | null;
  /** C167.2: where each role may be assigned, by role id. */
  readonly scopes?: Readonly<Record<string, readonly AssignmentScopeOption[]>>;
  readonly updateRoles: Action;
  readonly setStatus: Action;
  readonly resendInvitation: InvitationAction;
  /** C168.1: `POST /reactivate` (AC2). */
  readonly reactivate: Action;
  /** C168.3: `POST /reset-mfa`, never on oneself. */
  readonly resetMfa: Action;
  /** C245.3 (Workflow 11B): `POST /end-sessions`, never on oneself. */
  readonly endSessions?: Action;
  /** K9-22 (DS8): reads a user's assignments, so the roles dialog starts from them. */
  readonly readAssignments?: UserRolesButtonProps['readAssignments'];
  /** C168.1 (K9-11): the passkey step-up's start, offered in the reset and reactivate dialogs. */
  readonly startStepUpWebauthn?: StepUpCodeFieldProps['startWebauthn'];
}

export interface UsersTableProps {
  readonly users: readonly UserRow[];
  /** The signed-in operator, warned that deactivating themselves signs them out. */
  readonly currentUserId: string;
  /** Null without `users:write`: the list is read-only. */
  readonly manage: UserManagement | null;
  readonly emptyMessage: string;
  /** K9-22 (DS8): where a user's effective permissions are shown, linked from their roles. */
  readonly permissionsHref?: (userId: string) => string;
}

const labelOf = (user: UserRow) => user.name ?? user.email;
const COPY = SETTINGS_COPY.users;

/** C168.5: the factors a user enrolled, in words, never a judgement that the account is secure. */
function MfaCell({ user }: { readonly user: UserRow }) {
  if (user.mfaEnabled === null) {
    return <EmptyValue />;
  }
  const kinds = (user.mfaFactors ?? [])
    .map(({ kind, count }) => `${COPY.factorKinds[kind]} (${String(count)})`)
    .join(', ');
  return (
    <span className="flex flex-col">
      <span>{user.mfaEnabled ? 'On' : 'Off'}</span>
      {kinds !== '' && (
        <span className="text-ink-muted">{kinds.charAt(0).toUpperCase() + kinds.slice(1)}</span>
      )}
    </span>
  );
}

function UserActions({
  user,
  manage,
  isCurrentUser,
}: {
  readonly user: UserRow;
  readonly manage: UserManagement;
  readonly isCurrentUser: boolean;
}) {
  const label = labelOf(user);
  // The API refuses a status change by an operator who lacks a permission the user holds
  // (Workflow 2D K002), so it is explained instead of offered. Without roles:read it is unknown.
  const beyondReach = (manage.roles ?? [])
    .filter((role) => !role.grantable && user.roles.some(({ id }) => id === role.id))
    .map((role) => role.name);
  const statusChangeable = beyondReach.length === 0;
  return (
    <div className="flex flex-wrap gap-2">
      {manage.roles !== null && (
        <UserRolesButton
          userId={user.id}
          userLabel={label}
          roles={manage.roles}
          currentRoleIds={user.roles.map(({ id }) => id)}
          action={manage.updateRoles}
          {...(manage.scopes === undefined ? {} : { scopes: manage.scopes })}
          {...(manage.readAssignments === undefined
            ? {}
            : { readAssignments: manage.readAssignments })}
        />
      )}
      {user.status !== 'invited' && !statusChangeable && (
        <p className="text-sm text-ink-muted">
          {`You cannot deactivate or reactivate ${label}: ${beyondReach.join(', ')} ${
            beyondReach.length === 1 ? 'includes' : 'include'
          } permissions you do not hold.`}
        </p>
      )}
      {user.status === 'active' && statusChangeable && (
        <ConfirmActionButton
          label={`Deactivate ${label}`}
          variant="secondary"
          title={`Deactivate ${label}?`}
          description={
            isCurrentUser
              ? 'This is you: you are signed out at once and can no longer sign in.'
              : 'They are signed out at once and can no longer sign in. You can reactivate them later.'
          }
          confirmLabel="Deactivate"
          pendingLabel="Deactivating…"
          action={manage.setStatus}
          fields={{ 'user-id': user.id, status: 'deactivated' }}
          successMessage={`${label} was deactivated.`}
        />
      )}
      {user.status === 'deactivated' && statusChangeable && (
        <ConfirmActionButton
          label={COPY.reactivateLabel(label)}
          variant="secondary"
          tone="primary"
          title={COPY.reactivateTitle(label)}
          description={COPY.reactivateDescription}
          confirmLabel={COPY.reactivateConfirm}
          pendingLabel="Sending…"
          action={manage.reactivate}
          fields={{ 'user-id': user.id }}
          successMessage={COPY.reactivated(label)}
        >
          <StepUpCodeField
            {...(manage.startStepUpWebauthn === undefined
              ? {}
              : { startWebauthn: manage.startStepUpWebauthn })}
          />
        </ConfirmActionButton>
      )}
      {user.status === 'active' && user.mfaEnabled === true && !isCurrentUser && (
        <ConfirmActionButton
          label={COPY.resetLabel(label)}
          variant="secondary"
          title={COPY.resetTitle(label)}
          description={COPY.resetDescription}
          confirmLabel={COPY.resetConfirm}
          pendingLabel="Resetting…"
          action={manage.resetMfa}
          fields={{ 'user-id': user.id }}
          successMessage={COPY.resetDone(label)}
        >
          <StepUpCodeField
            {...(manage.startStepUpWebauthn === undefined
              ? {}
              : { startWebauthn: manage.startStepUpWebauthn })}
          />
        </ConfirmActionButton>
      )}
      {user.status === 'active' && !isCurrentUser && manage.endSessions !== undefined && (
        <ConfirmActionButton
          label={COPY.endSessionsLabel(label)}
          variant="secondary"
          title={COPY.endSessionsTitle(label)}
          description={COPY.endSessionsDescription}
          confirmLabel={COPY.endSessionsConfirm}
          pendingLabel="Ending…"
          action={manage.endSessions}
          fields={{ 'user-id': user.id }}
          successMessage={COPY.endSessionsDone(label)}
        />
      )}
      {user.status === 'invited' && (
        <ConfirmActionButton
          label={`Resend the invitation to ${user.email}`}
          variant="secondary"
          tone="primary"
          title={`Send a new invitation to ${user.email}?`}
          description="The new link works for 7 days. The link sent before stops working."
          confirmLabel="Send invitation"
          pendingLabel="Sending…"
          action={manage.resendInvitation}
          fields={{ 'user-id': user.id }}
          successMessage={`A new invitation was sent to ${user.email}.`}
        />
      )}
    </div>
  );
}

/** The organization's operators: who, their status and roles, and what the operator may change. */
export function UsersTable({
  users,
  currentUserId,
  manage,
  emptyMessage,
  permissionsHref,
}: UsersTableProps) {
  const columns: Column<UserRow>[] = [
    {
      id: 'user',
      header: 'User',
      rowHeader: true,
      cell: (user) =>
        user.name === null ? (
          <span className="font-medium">{user.email}</span>
        ) : (
          <span className="flex flex-col">
            <span className="font-medium">{user.name}</span>
            <span className="text-ink-muted">{user.email}</span>
          </span>
        ),
    },
    { id: 'status', header: 'Status', cell: (user) => <UserStatusBadge status={user.status} /> },
    {
      id: 'roles',
      header: 'Roles',
      cell: (user) => (
        <span className="flex flex-col gap-1">
          {user.roles.length === 0 ? (
            <EmptyValue />
          ) : (
            <ul className="flex flex-col gap-0.5">
              {user.roles.map((role) => (
                <li key={role.id}>
                  {role.name ?? <code className="font-mono text-xs">{role.id}</code>}
                </li>
              ))}
            </ul>
          )}
          {permissionsHref !== undefined && (
            <Link href={permissionsHref(user.id)} className={`text-sm ${LINK_CLASS}`}>
              {`${COPY.effectiveLink} `}
              <span className="sr-only">of {labelOf(user)}</span>
            </Link>
          )}
        </span>
      ),
    },
  ];
  // C168.5: MFA status and the last sign-in only for holders of users:write, as the API serves them.
  if (manage !== null) {
    columns.push(
      { id: 'mfa', header: 'MFA', cell: (user) => <MfaCell user={user} /> },
      {
        id: 'last-sign-in',
        header: COPY.lastSignInColumn,
        cell: (user) =>
          user.lastSignInAt === undefined ? (
            <EmptyValue />
          ) : user.lastSignInAt === null ? (
            COPY.never
          ) : (
            <Timestamp value={user.lastSignInAt} />
          ),
      },
    );
  }
  columns.push({
    id: 'added',
    header: 'Added (UTC)',
    cell: (user) => <Timestamp value={user.createdAt} />,
  });
  if (manage !== null) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (user) => (
        <UserActions user={user} manage={manage} isCurrentUser={user.id === currentUserId} />
      ),
    });
  }
  return (
    <DataTable
      caption="Users"
      captionHidden
      columns={columns}
      rows={users}
      getRowKey={(user) => user.id}
      emptyMessage={emptyMessage}
    />
  );
}
