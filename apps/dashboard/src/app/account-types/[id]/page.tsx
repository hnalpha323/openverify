import { idSchema, type AccountFieldType, type AccountTypeResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DataTable, type Column } from '../../../components/data-table';
import { Detail } from '../../../components/detail';
import { AccountTypeEditForm } from '../../../components/lifecycle/account-type-form';
import { PageSection } from '../../../components/lifecycle/page-section';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Timestamp } from '../../../components/timestamp';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { updateAccountType } from '../actions';
import { ContestRouteWords } from '../../../components/workflows/contest-route';

export const metadata: Metadata = { title: 'Account type' };

export interface AccountTypePageProps {
  readonly params: Promise<{ id: string }>;
}

const FIELD_TYPE_LABELS: Readonly<Record<AccountFieldType, string>> = {
  string: 'Text',
  number: 'Number',
  boolean: 'Yes or no',
  date: 'Date',
};

type Field = readonly [
  key: string,
  definition: AccountTypeResource['attributes']['fields-schema'][string],
];

const FIELD_COLUMNS: readonly Column<Field>[] = [
  {
    id: 'key',
    header: 'Key',
    rowHeader: true,
    cell: ([key]) => <code className="font-mono text-xs">{key}</code>,
  },
  { id: 'label', header: 'Label', cell: ([, field]) => field.label },
  { id: 'type', header: 'Type', cell: ([, field]) => FIELD_TYPE_LABELS[field.type] },
];

/**
 * One account type (C13, C26): its fields, and for `accounts:write` a form that changes its name
 * and adds fields or relabels them (C25.3), bound to the environment the page was rendered in
 * (Workflow 2D F002).
 */
export default async function AccountTypePage({ params }: AccountTypePageProps) {
  const { id } = await params;
  if (!idSchema('acctp').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['accounts:read'] }, async ({ api, session }) => {
    const { data: type } = await api.accountTypes.retrieve(id);
    const { name } = type.attributes;
    const fields = Object.entries(type.attributes['fields-schema']);
    return (
      <PageMain className="gap-8">
        <PageHeader
          title={name}
          description="Account type"
          breadcrumbs={[{ label: 'Account types', href: '/account-types' }, { label: name }]}
        />
        <PageSection id="account-type-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="ID">
              <code className="font-mono text-xs break-all">{type.id}</code>
            </Detail>
            <Detail term="Contest route">
              <ContestRouteWords route={type.attributes['contest-route']} />
            </Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={type.attributes['created-at']} />
            </Detail>
          </dl>
        </PageSection>
        <PageSection
          id="account-type-fields"
          title="Fields"
          description="The fields accounts of this type take."
        >
          {fields.length === 0 ? (
            <p className="text-sm text-ink-muted">This type has no fields yet.</p>
          ) : (
            <DataTable
              caption={`Fields of ${name}`}
              captionHidden
              columns={FIELD_COLUMNS}
              rows={fields}
              getRowKey={([key]) => key}
              emptyMessage="This type has no fields yet."
            />
          )}
        </PageSection>
        {hasPermission(session, 'accounts:write') && (
          <AccountTypeEditForm
            action={updateAccountType}
            environmentId={session.environment.id}
            accountType={type}
          />
        )}
      </PageMain>
    );
  });
}
