import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { Detail } from '../../../components/detail';
import { PageSection } from '../../../components/lifecycle/page-section';
import { VersionsTable } from '../../../components/lifecycle/versions-table';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Timestamp } from '../../../components/timestamp';
import { TypeContent } from '../../../components/transaction-types/type-content';
import {
  NewTypeDraftButton,
  RenameTypeForm,
} from '../../../components/transaction-types/type-forms';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { getTransactionType, getTransactionTypeVersion } from '../../../lib/api/transactions';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import {
  archiveTransactionType,
  createTransactionTypeDraft,
  renameTransactionType,
  setTransactionTypeDecisions,
} from '../actions';
import { TypeDecisionsForm } from '../../../components/transaction-types/type-decisions-form';
import { ContestRouteWords } from '../../../components/workflows/contest-route';

export const metadata: Metadata = { title: 'Transaction type' };

export interface TransactionTypePageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const VERSIONS_PAGE_SIZE = 25;

/**
 * One transaction type (C104, C108): every version newest first, the published version's fields,
 * statuses and relations, and with `transaction-types:write` the latest draft (by the type's
 * `latest-version` relationship) or a new one, the name and archiving. Reads
 * `GET /transaction-types/:id` and `GET /transaction-type-versions`.
 */
export default async function TransactionTypePage({
  params,
  searchParams,
}: TransactionTypePageProps) {
  const { id } = await params;
  if (!idSchema('txntp').safeParse(id).success) {
    notFound();
  }
  const after = parseCursor((await searchParams).after, 'txntpv');
  return renderPage({ permissions: ['transactions:read'] }, async ({ session, api }) => {
    const [{ data: type }, versions] = await Promise.all([
      getTransactionType(id),
      api.transactionTypeVersions.list({
        filter: { 'transaction-type-id': id },
        page: { size: VERSIONS_PAGE_SIZE, ...(after === undefined ? {} : { after }) },
      }),
    ]);
    const { attributes } = type;
    const canWrite = hasPermission(session, 'transaction-types:write');
    const published = attributes['published-version'];
    const latestId = type.relationships?.['latest-version'].data.id;
    const latest =
      canWrite && latestId !== undefined ? (await getTransactionTypeVersion(latestId)).data : null;
    const versionHref = (versionId: string) =>
      `/transaction-types/${type.id}/versions/${versionId}`;
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Transaction types', href: '/transaction-types' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description={
            attributes.status === 'active' ? 'Active' : 'Archived: it takes no new transaction.'
          }
          actions={
            canWrite ? (
              <>
                {latest?.attributes.status === 'draft' ? (
                  <Link href={versionHref(latest.id)} className={LINK_CLASS}>
                    Open the latest draft
                  </Link>
                ) : (
                  <NewTypeDraftButton typeId={type.id} action={createTransactionTypeDraft} />
                )}
                {attributes.status === 'active' && (
                  <ConfirmActionButton
                    label="Archive type"
                    title="Archive this transaction type?"
                    description="It takes no new transaction. Existing transactions keep their version and stay readable."
                    confirmLabel="Archive type"
                    pendingLabel="Archiving…"
                    action={archiveTransactionType}
                    fields={{ 'transaction-type-id': type.id }}
                    successMessage="Archived the type."
                  />
                )}
              </>
            ) : undefined
          }
        />
        <PageSection id="transaction-type-versions" title="Version history">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Latest version">{`v${String(attributes['latest-version'])}`}</Detail>
            <Detail term="Published version">
              {published === null ? 'None' : `v${String(published)}`}
            </Detail>
            <Detail term="Adverse statuses">
              {attributes['adverse-statuses'].length === 0
                ? 'None: no status of this type is adverse'
                : attributes['adverse-statuses'].join(', ')}
            </Detail>
            <Detail term="Contest route">
              <ContestRouteWords route={attributes['contest-route']} />
            </Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
          <VersionsTable
            rows={versions.data.map((version) => ({
              id: version.id,
              href: versionHref(version.id),
              versionNumber: version.attributes['version-number'],
              status: version.attributes.status,
              createdAt: version.attributes['created-at'],
              publishedAt: version.attributes['published-at'],
            }))}
          />
          <Pagination
            path={`/transaction-types/${type.id}`}
            query={{}}
            after={after}
            nextCursor={cursorFromNextLink(versions.links.next, 'txntpv')}
          />
        </PageSection>
        <PageSection id="transaction-type-published" title="Published version">
          {published === null ? (
            <p className="text-sm text-ink-muted">
              No version is published yet, so no transaction can be created with this type.
            </p>
          ) : (
            <TypeContent
              fieldSchemas={attributes['field-schemas']}
              statuses={attributes.statuses}
              relationSchemas={attributes['relation-schemas']}
            />
          )}
        </PageSection>
        {canWrite && (
          <PageSection id="transaction-type-decisions" title="Decisions">
            <TypeDecisionsForm
              typeId={type.id}
              statuses={latest?.attributes.statuses ?? attributes.statuses}
              adverse={attributes['adverse-statuses']}
              route={attributes['contest-route']}
              action={setTransactionTypeDecisions}
            />
          </PageSection>
        )}
        {canWrite && (
          <PageSection id="transaction-type-name" title="Name">
            <RenameTypeForm
              typeId={type.id}
              name={attributes.name}
              action={renameTransactionType}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
