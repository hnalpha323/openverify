import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmActionButton } from '../../../../components/confirm-action-button';
import { Detail } from '../../../../components/detail';
import {
  NewDraftForm,
  RenameTemplateForm,
  RunQueryForm,
  STARTER_CONFIG,
} from '../../../../components/graph/template-forms';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { VersionsTable } from '../../../../components/lifecycle/versions-table';
import { LINK_CLASS } from '../../../../components/link-styles';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { Pagination } from '../../../../components/pagination';
import { Badge } from '../../../../components/status-badge';
import { Timestamp } from '../../../../components/timestamp';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../../lib/list-query';
import {
  archiveGraphTemplate,
  createGraphDraft,
  renameGraphTemplate,
  runGraphQuery,
} from '../../actions';

export const metadata: Metadata = { title: 'Query template' };

const VERSIONS_PAGE_SIZE = 25;

export interface TemplatePageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * One graph query template (C102.1, C108): every version newest first, its published version and
 * configuration, read with `graph:read`; with `graph:write`, a run of the published version, the
 * latest draft (by the template's `latest-version` relationship) or a new one, a rename and the
 * archive.
 */
export default async function TemplatePage({
  params,
  searchParams,
}: TemplatePageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('grqt').safeParse(id).success) {
    notFound();
  }
  const after = parseCursor((await searchParams).after, 'grqtv');
  return renderPage({ permissions: ['graph:read'] }, async ({ session, api }) => {
    const [{ data: template }, versions] = await Promise.all([
      api.graphQueryTemplates.retrieve(id),
      api.graphQueryTemplateVersions.list({
        filter: { 'graph-query-template-id': id },
        page: { size: VERSIONS_PAGE_SIZE, ...(after === undefined ? {} : { after }) },
      }),
    ]);
    const publishedId = template.relationships['published-version'].data?.id ?? null;
    const published =
      publishedId === null
        ? null
        : (await api.graphQueryTemplates.versions.retrieve(publishedId)).data;
    const { attributes } = template;
    const active = attributes.status === 'active';
    const write = hasPermission(session, 'graph:write') && active;
    const latestId = template.relationships['latest-version']?.data.id;
    const latest =
      write && latestId !== undefined
        ? (await api.graphQueryTemplates.versions.retrieve(latestId)).data
        : null;
    const versionHref = (versionId: string) =>
      `/graph/templates/${template.id}/versions/${versionId}`;

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Graph', href: '/graph' },
            { label: 'Query templates', href: '/graph/templates' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description={
            <Badge
              status={attributes.status}
              label={active ? 'Active' : 'Archived'}
              tone="neutral"
            />
          }
          actions={
            write ? (
              <ConfirmActionButton
                label="Archive"
                title="Archive this template?"
                description="It can no longer run or change. Queries it already ran stay, with their results."
                confirmLabel="Archive template"
                pendingLabel="Archiving…"
                action={archiveGraphTemplate}
                fields={{ 'graph-query-template-id': template.id }}
                successMessage="The template was archived."
              />
            ) : undefined
          }
        />

        <PageSection id="graph-template-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Published version">
              {published === null ? (
                'Not published'
              ) : (
                <Link href={versionHref(published.id)} className={LINK_CLASS}>
                  {`Version ${String(published.attributes['version-number'])}`}
                </Link>
              )}
            </Detail>
            <Detail term="Latest version">{`Version ${String(attributes['latest-version'])}`}</Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
        </PageSection>

        <PageSection id="graph-template-versions" title="Version history">
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
            path={`/graph/templates/${template.id}`}
            query={{}}
            after={after}
            nextCursor={cursorFromNextLink(versions.links.next, 'grqtv')}
          />
        </PageSection>

        <PageSection id="graph-template-run" title="Run a query">
          {published === null ? (
            <p className="text-sm text-ink-muted">
              This template has no published version, so it cannot run yet.
            </p>
          ) : write ? (
            <RunQueryForm
              templateId={template.id}
              parameters={published.attributes.config.parameters}
              piiView={hasPermission(session, 'pii:view')}
              action={runGraphQuery}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              Running a query needs graph:write on an active template.
            </p>
          )}
        </PageSection>

        {published !== null && (
          <section aria-labelledby="graph-template-config" className="flex flex-col gap-3">
            <h2 id="graph-template-config" className="text-lg font-semibold">
              Published configuration
            </h2>
            <pre className="overflow-x-auto rounded-xl border border-line bg-canvas p-4 font-mono text-xs">
              {JSON.stringify(published.attributes.config, null, 2)}
            </pre>
          </section>
        )}

        {latest?.attributes.status === 'draft' ? (
          <PageSection id="graph-template-draft" title="Latest draft">
            <p className="text-sm">
              <Link href={versionHref(latest.id)} className={LINK_CLASS}>
                Open the latest draft
              </Link>
            </p>
          </PageSection>
        ) : (
          write && (
            <PageSection
              id="graph-template-draft"
              title="New draft"
              description="A new version, starting from the configuration below; edit and publish it on its page."
            >
              <NewDraftForm
                templateId={template.id}
                config={published?.attributes.config ?? STARTER_CONFIG}
                action={createGraphDraft}
              />
            </PageSection>
          )
        )}

        {write && (
          <PageSection id="graph-template-rename" title="Rename">
            <RenameTemplateForm
              templateId={template.id}
              name={attributes.name}
              action={renameGraphTemplate}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
