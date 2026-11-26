import type { RoleResource } from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';

/** The organization's roles, each linked to its page, with how much of the console it opens. */
export function RolesTable({ roles }: { readonly roles: readonly RoleResource[] }) {
  return (
    <DataTable
      caption="Roles"
      captionHidden
      rows={roles}
      getRowKey={(role) => role.id}
      emptyMessage="No roles yet."
      columns={[
        {
          id: 'name',
          header: 'Name',
          rowHeader: true,
          cell: (role) => (
            <Link href={`/roles/${role.id}`} className={LINK_CLASS}>
              {role.attributes.name}
            </Link>
          ),
        },
        {
          id: 'type',
          header: 'Type',
          cell: (role) => (role.attributes.builtin ? 'Built-in' : 'Custom'),
        },
        {
          id: 'permissions',
          header: 'Permissions',
          cell: (role) =>
            `${String(role.attributes.permissions.length)} of ${String(PERMISSIONS.length)}`,
        },
        {
          id: 'updated',
          header: 'Updated (UTC)',
          cell: (role) => <Timestamp value={role.attributes['updated-at']} />,
        },
      ]}
    />
  );
}
