import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmActionButton } from '../../../../../../components/confirm-action-button';
import { Detail } from '../../../../../../components/detail';
import { DraftEditor } from '../../../../../../components/graph/template-forms';
import { VersionStatusBadge } from '../../../../../../components/lifecycle/badges';
import { PageSection } from '../../../../../../components/lifecycle/page-section';
import { EmptyValue } from '../../../../../../components/masked-value';
import { PageHeader } from '../../../../../../components/page-header';
import { PageMain } from '../../../../../../components/page-main';
import { Timestamp } from '../../../../../../components/timestamp';
import { hasPermission } from '../../../../../../lib/api/me';
import { renderPage } from '../../../../../../lib/api/page';
import { publishGraphDraft, updateGraphDraft } from '../../../../actions';

export const metadata: Metadata = { title: 'Query template version' };

export interface TemplateVersionPageProps {
  readonly params: Promise<{ id: string; versionId: string }>;
}

const PUBLISH_DESCRIPTION =
  'It becomes the template’s published version, and new queries run it; the version published now is superseded. Queries already run keep the version they pinned. The API refuses a weak kind without include-weak-kinds (or above 4 hops) and a parameter the template does not declare, saying where. Save your changes first: publishing uses the saved draft.';

/**
 * One graph query template version (C102.1, C108): a draft is edited as JSON and published with
 * `graph:write`; every other version is read-only.
 */
export default async function TemplateVersionPage({
  params,
}: TemplateVersionPageProps): Promise<ReactNode> {
  const { id, versionId } = await params;
  if (!idSchema('grqt').safeParse(id).success || !idSchema('grqtv').safeParse(versionId).success) {
    notFound();
  }
  return renderPage({ permissions: ['graph:read'] }, async ({ session, api }) => {
    const { data: version } = await api.graphQueryTemplates.versions.retrieve(versionId);
    if (version.relationships['graph-query-template'].data.id !== id) {
      notFound();
    }
    const { data: template } = await api.graphQueryTemplates.retrieve(id);
    const { attributes } = version;
    const title = `Version ${String(attributes['version-number'])}`;
    const editable = attributes.status === 'draft' && hasPermission(session, 'graph:write');
    const ids = { 'graph-query-template-id': template.id, 'version-id': version.id };

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Graph', href: '/graph' },
            { label: 'Query templates', href: '/graph/templates' },
            { label: template.attributes.name, href: `/graph/templates/${template.id}` },
            { label: title },
          ]}
          title={title}
          description={<VersionStatusBadge status={attributes.status} />}
          actions={
            editable ? (
              <ConfirmActionButton
                label="Publish"
                variant="primary"
                tone="primary"
                title={`Publish ${title.toLowerCase()}?`}
                description={PUBLISH_DESCRIPTION}
                confirmLabel="Publish version"
                pendingLabel="Publishing…"
                action={publishGraphDraft}
                fields={ids}
                successMessage={`${title} was published.`}
              />
            ) : undefined
          }
        />

        <PageSection id="graph-version-details" title="Details">
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
          </dl>
        </PageSection>

        {editable ? (
          <PageSection id="graph-version-config" title="Configuration">
            <DraftEditor
              templateId={template.id}
              versionId={version.id}
              config={attributes.config}
              action={updateGraphDraft}
            />
          </PageSection>
        ) : (
          <section aria-labelledby="graph-version-config" className="flex flex-col gap-3">
            <h2 id="graph-version-config" className="text-lg font-semibold">
              Configuration (read-only)
            </h2>
            <pre className="overflow-x-auto rounded-xl border border-line bg-canvas p-4 font-mono text-xs">
              {JSON.stringify(attributes.config, null, 2)}
            </pre>
          </section>
        )}
      </PageMain>
    );
  });
}
