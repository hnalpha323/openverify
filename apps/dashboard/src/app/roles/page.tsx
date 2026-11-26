import type { Metadata } from 'next';
import Link from 'next/link';
import { PRIMARY_LINK_BUTTON_CLASS } from '../../components/operators/link-button';
import { RolesTable } from '../../components/operators/roles-table';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { listRoles } from '../../lib/api/roles';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'Roles' };

export interface RolesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The organization's roles (C15, C23), newest first: the four built-in roles, which cannot be
 * changed, and custom roles. Each opens its permissions.
 */
export default async function RolesPage({ searchParams }: RolesPageProps) {
  const after = parseCursor((await searchParams).after, 'role');
  return renderPage({ permissions: ['roles:read'] }, async ({ session }) => {
    const page = await listRoles({ after });
    return (
      <PageMain>
        <PageHeader
          title="Roles"
          description="A role is a set of permissions. An operator holds every permission of each of their roles."
          {...(hasPermission(session, 'roles:write')
            ? {
                actions: (
                  <Link href="/roles/new" className={PRIMARY_LINK_BUTTON_CLASS}>
                    New role
                  </Link>
                ),
              }
            : {})}
        />
        <RolesTable roles={page.data} />
        <Pagination
          path="/roles"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'role')}
        />
      </PageMain>
    );
  });
}
