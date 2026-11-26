import { idSchema, type RoleResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { PermissionList } from '../../../components/operators/permission-list';
import { RoleForm } from '../../../components/operators/role-form';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import type { DashboardSession } from '../../../lib/api/me';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { getGrantable, getRole } from '../../../lib/api/roles';
import { roleHolderCount } from '../../../lib/api/users';
import { roleEditorRefusals } from '../../../components/operators/grantable';
import type { Permission } from '@openverify/core';
import { deleteRole, updateRole } from '../actions';

export const metadata: Metadata = { title: 'Role' };

export interface RolePageProps {
  readonly params: Promise<{ id: string }>;
}

function Permissions({ role }: { readonly role: RoleResource }) {
  return (
    <section aria-labelledby="role-permissions" className="flex flex-col gap-3">
      <h2 id="role-permissions" className="text-lg font-semibold">
        Permissions
      </h2>
      <PermissionList permissions={role.attributes.permissions} />
    </section>
  );
}

function CustomRole({
  role,
  session,
  refusals,
  holders,
}: {
  readonly role: RoleResource;
  readonly session: DashboardSession;
  readonly refusals: Readonly<Partial<Record<Permission, string>>>;
  readonly holders: number | null;
}) {
  if (!hasPermission(session, 'roles:write')) {
    return <Permissions role={role} />;
  }
  const beyondReach = role.attributes.permissions.filter(
    (permission) => !session.permissions.has(permission),
  );
  return (
    <>
      {beyondReach.length === 0 ? (
        <RoleForm
          action={updateRole}
          held={[...session.permissions]}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          successMessage="The role was saved."
          refusals={refusals}
          holders={holders}
          role={{
            id: role.id,
            name: role.attributes.name,
            permissions: role.attributes.permissions,
          }}
        />
      ) : (
        <>
          <p className="text-sm text-ink">
            {`You cannot change this role: it grants permissions you do not hold (${beyondReach.join(', ')}).`}
          </p>
          <Permissions role={role} />
        </>
      )}
      <section
        aria-labelledby="delete-role"
        className="flex flex-col items-start gap-3 border-t border-line pt-6"
      >
        <h2 id="delete-role" className="text-lg font-semibold">
          Delete this role
        </h2>
        {beyondReach.length === 0 ? (
          <ConfirmActionButton
            label="Delete role"
            title={`Delete ${role.attributes.name}?`}
            description="A role that users still hold cannot be deleted: give them other roles first."
            confirmLabel="Delete role"
            pendingLabel="Deleting…"
            action={deleteRole}
            fields={{ 'role-id': role.id }}
          />
        ) : (
          // The API refuses it too (Workflow 2D K002).
          <p className="text-sm text-ink">
            {`You cannot delete this role: it grants permissions you do not hold (${beyondReach.join(', ')}).`}
          </p>
        )}
      </section>
    </>
  );
}

/**
 * One role (C15): a built-in role's permissions, read-only; a custom role's name and permission
 * checklist, and its deletion, for an operator with `roles:write`. The role is read with
 * `GET /dashboard/roles/:id` (C25.2); its 404 renders not found.
 */
export default async function RolePage({ params }: RolePageProps) {
  const { id } = await params;
  if (!idSchema('role').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['roles:read'] }, async ({ session }) => {
    const role = await getRole(id);
    const { builtin, name } = role.attributes;
    // C167.4: what the API would grant, and how many users a removal reaches.
    const editable = !builtin && hasPermission(session, 'roles:write');
    const refusals = editable
      ? Object.fromEntries(roleEditorRefusals(await getGrantable(), session.environments))
      : {};
    const holders =
      editable && hasPermission(session, 'users:read') ? await roleHolderCount(id) : null;
    return (
      <PageMain className="gap-8">
        <PageHeader
          title={name}
          description={
            builtin
              ? 'Built-in role. It cannot be changed or deleted.'
              : 'Custom role. Its permissions apply to every user who holds it.'
          }
          breadcrumbs={[{ label: 'Roles', href: '/roles' }, { label: name }]}
        />
        {builtin ? (
          <Permissions role={role} />
        ) : (
          <CustomRole role={role} session={session} refusals={refusals} holders={holders} />
        )}
      </PageMain>
    );
  });
}
