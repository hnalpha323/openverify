import type { Metadata } from 'next';
import { RoleForm } from '../../../components/operators/role-form';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { renderPage } from '../../../lib/api/page';
import { getGrantable } from '../../../lib/api/roles';
import { roleEditorRefusals } from '../../../components/operators/grantable';
import { createRole } from '../actions';

export const metadata: Metadata = { title: 'New role' };

/** A new custom role: a name and the permissions it grants, from those the operator holds. */
export default async function NewRolePage() {
  return renderPage({ permissions: ['roles:write'] }, async ({ session }) => (
    <PageMain>
      <PageHeader
        title="New role"
        description="You can grant only permissions you hold yourself."
        breadcrumbs={[{ label: 'Roles', href: '/roles' }, { label: 'New role' }]}
      />
      <RoleForm
        action={createRole}
        held={[...session.permissions]}
        refusals={Object.fromEntries(
          roleEditorRefusals(await getGrantable(), session.environments),
        )}
        submitLabel="Create role"
        pendingLabel="Creating…"
      />
    </PageMain>
  ));
}
