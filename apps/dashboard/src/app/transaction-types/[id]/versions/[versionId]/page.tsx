import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../../../components/confirm-action-button';
import { Detail } from '../../../../../components/detail';
import { PageSection } from '../../../../../components/lifecycle/page-section';
import { EmptyValue } from '../../../../../components/masked-value';
import { PageHeader } from '../../../../../components/page-header';
import { PageMain } from '../../../../../components/page-main';
import { Timestamp } from '../../../../../components/timestamp';
import { TypeContent } from '../../../../../components/transaction-types/type-content';
import { DraftEditor } from '../../../../../components/transaction-types/type-forms';
import { hasPermission } from '../../../../../lib/api/me';
import { renderPage } from '../../../../../lib/api/page';
import { getTransactionType, getTransactionTypeVersion } from '../../../../../lib/api/transactions';
import { publishTransactionTypeDraft, updateTransactionTypeDraft } from '../../../actions';

export const metadata: Metadata = { title: 'Transaction type version' };

export interface TransactionTypeVersionPageProps {
  readonly params: Promise<{ id: string; versionId: string }>;
}

const STATUS_LABELS = { draft: 'Draft', published: 'Published', superseded: 'Superseded' } as const;

const PUBLISH_DESCRIPTION =
  'It becomes the type’s published version: new transactions pin it, and transactions already created keep theirs. The API checks every field first and refuses, with each problem at its place, a version that breaks a rule. Save your changes first: publishing uses the saved draft.';

/**
 * One transaction type version (C104.1, C108). A draft is edited as JSON documents with
 * `transaction-types:write` and published; every other version is read-only. Reads
 * `GET /transaction-type-versions/:id` and its type.
 */
export default async function TransactionTypeVersionPage({
  params,
}: TransactionTypeVersionPageProps) {
  const { id, versionId } = await params;
  if (
    !idSchema('txntp').safeParse(id).success ||
    !idSchema('txntpv').safeParse(versionId).success
  ) {
    notFound();
  }
  return renderPage({ permissions: ['transactions:read'] }, async ({ session }) => {
    const { data: version } = await getTransactionTypeVersion(versionId);
    if (version.relationships['transaction-type'].data.id !== id) {
      notFound();
    }
    const { data: type } = await getTransactionType(id);
    const { attributes } = version;
    const title = `Version ${String(attributes['version-number'])}`;
    const draft = attributes.status === 'draft';
    const canEdit = draft && hasPermission(session, 'transaction-types:write');
    const ids = { 'transaction-type-id': type.id, 'version-id': version.id };
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Transaction types', href: '/transaction-types' },
            { label: type.attributes.name, href: `/transaction-types/${type.id}` },
            { label: title },
          ]}
          title={title}
          description={STATUS_LABELS[attributes.status]}
          actions={
            canEdit ? (
              <ConfirmActionButton
                label="Publish"
                variant="primary"
                tone="primary"
                title={`Publish ${title.toLowerCase()}?`}
                description={PUBLISH_DESCRIPTION}
                confirmLabel="Publish version"
                pendingLabel="Publishing…"
                action={publishTransactionTypeDraft}
                fields={ids}
                successMessage={`${title} was published.`}
              />
            ) : undefined
          }
        />
        <PageSection id="transaction-type-version-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Published (UTC)">
              {attributes['published-at'] === null ? (
                <EmptyValue />
              ) : (
                <Timestamp value={attributes['published-at']} />
              )}
            </Detail>
            <Detail term="Card-like values">
              {attributes['allow-card-like-strings'] ? 'Allowed in fields' : 'Refused'}
            </Detail>
          </dl>
        </PageSection>
        <PageSection id="transaction-type-version-content" title="Content">
          {canEdit ? (
            <DraftEditor typeId={type.id} version={version} action={updateTransactionTypeDraft} />
          ) : (
            <TypeContent
              fieldSchemas={attributes['field-schemas']}
              statuses={attributes.statuses}
              relationSchemas={attributes['relation-schemas']}
            />
          )}
        </PageSection>
      </PageMain>
    );
  });
}
