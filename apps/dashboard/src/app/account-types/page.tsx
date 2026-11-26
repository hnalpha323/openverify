import type { AccountTypeResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, type Column } from '../../components/data-table';
import { EmptyState } from '../../components/empty-state';
import { LINK_CLASS } from '../../components/link-styles';
import { AccountTypeForm } from '../../components/lifecycle/account-type-form';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { Timestamp } from '../../components/timestamp';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
import { createAccountType } from './actions';

export const metadata: Metadata = { title: 'Account types' };

const PAGE_SIZE = 25;

export interface AccountTypesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const COLUMNS: readonly Column<AccountTypeResource>[] = [
  {
    id: 'name',
    header: 'Name',
    rowHeader: true,
    cell: (type) => (
      <Link href={`/account-types/${type.id}`} className={LINK_CLASS}>
        {type.attributes.name}
      </Link>
    ),
  },
  {
    id: 'id',
    header: 'ID',
    cell: (type) => <code className="font-mono text-xs">{type.id}</code>,
  },
  {
    id: 'fields',
    header: 'Fields',
    cell: (type) => {
      const fields = Object.entries(type.attributes['fields-schema']);
      return fields.length === 0 ? (
        <span className="text-ink-muted">No fields</span>
      ) : (
        <ul aria-label={`Fields of ${type.attributes.name}`} className="flex flex-col gap-0.5">
          {fields.map(([key, field]) => (
            <li key={key}>
              {field.label} ({key}, {field.type})
            </li>
          ))}
        </ul>
      );
    },
  },
  {
    id: 'created',
    header: 'Created (UTC)',
    cell: (type) => <Timestamp value={type.attributes['created-at']} />,
  },
];

/**
 * The environment's account types (C13): the kinds of account and the fields each takes, each
 * linked to its page, where it can be changed (C26), and a form to create one with
 * `accounts:write`.
 */
export default async function AccountTypesPage({ searchParams }: AccountTypesPageProps) {
  const after = parseCursor((await searchParams).after, 'acctp');
  return renderPage({ permissions: ['accounts:read'] }, async ({ session, api }) => {
    const page = await api.accountTypes.list({
      page: { size: PAGE_SIZE, ...(after === undefined ? {} : { after }) },
    });
    return (
      <PageMain>
        <PageHeader
          title="Account types"
          description="The kinds of account in this environment and the fields each one takes. Open a type to add fields or change their labels."
        />
        {page.data.length === 0 && after === undefined ? (
          <EmptyState title="No account types yet">
            Every environment starts with the type user; create others below.
          </EmptyState>
        ) : (
          <DataTable
            caption="Account types"
            captionHidden
            columns={COLUMNS}
            rows={page.data}
            getRowKey={(type) => type.id}
            emptyMessage="No more account types."
          />
        )}
        <Pagination
          path="/account-types"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'acctp')}
        />
        {hasPermission(session, 'accounts:write') && (
          <AccountTypeForm action={createAccountType} environmentId={session.environment.id} />
        )}
      </PageMain>
    );
  });
}
