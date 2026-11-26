import { idSchema, type ReportTemplateVersionResource } from '@openverify/contracts';
import { REPORT_REGISTRY, toReportResourceType } from '@openverify/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { DataTable, type Column } from '../../../components/data-table';
import { Detail } from '../../../components/detail';
import { TemplateStatusBadge, VersionStatusBadge } from '../../../components/lifecycle/badges';
import { PageSection } from '../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../components/link-styles';
import { EmptyValue } from '../../../components/masked-value';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { configRecord } from '../../../components/report-config/config-words';
import { NewReportDraftButton } from '../../../components/report-config/new-draft-button';
import { ResolvedConfig } from '../../../components/report-config/resolved-config';
import { Badge } from '../../../components/status-badge';
import { Timestamp } from '../../../components/timestamp';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { REPORT_TYPE_LABELS } from '../../../lib/labels';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import { createReportDraft, updateReportTemplateStatus } from '../actions';

export const metadata: Metadata = { title: 'Report template' };

const PAGE_SIZE = 25;

export interface ReportTemplatePageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function versionColumns(templateId: string): readonly Column<ReportTemplateVersionResource>[] {
  return [
    {
      id: 'version',
      header: 'Version',
      rowHeader: true,
      cell: (version) => (
        <Link
          href={`/report-templates/${templateId}/versions/${version.id}`}
          className={LINK_CLASS}
        >
          Version {String(version.attributes['version-number'])}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (version) => <VersionStatusBadge status={version.attributes.status} />,
    },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (version) => <Timestamp value={version.attributes['created-at']} />,
    },
    {
      id: 'published',
      header: 'Published (UTC)',
      cell: (version) => {
        const published = version.attributes['published-at'];
        return published === null ? <EmptyValue /> : <Timestamp value={published} />;
      },
    },
  ];
}

/**
 * One report template (C71, C86): its type with its tiers and stage, its current version's
 * resolved configuration, its versions, and with `report-templates:write` a new draft and
 * archiving.
 */
export default async function ReportTemplatePage({
  params,
  searchParams,
}: ReportTemplatePageProps) {
  const { id } = await params;
  if (!idSchema('rptp').safeParse(id).success) {
    notFound();
  }
  const after = parseCursor((await searchParams).after, 'rptpv');
  return renderPage({ permissions: ['report-templates:read'] }, async ({ session, api }) => {
    const [{ data: template }, versions] = await Promise.all([
      api.reportTemplates.retrieve(id),
      api.reportTemplateVersions.list({
        filter: { 'report-template-id': id },
        page: { size: PAGE_SIZE, ...(after === undefined ? {} : { after }) },
      }),
    ]);
    const { attributes } = template;
    const type = attributes['report-type'];
    const definition = REPORT_REGISTRY[type];
    const current = attributes['current-version'];
    const active = attributes.status === 'active';
    const canWrite = hasPermission(session, 'report-templates:write');

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Report templates', href: '/report-templates' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description={
            <span className="flex flex-wrap items-center gap-3">
              <TemplateStatusBadge status={attributes.status} />
              <code className="font-mono text-xs">{template.id}</code>
            </span>
          }
          actions={
            canWrite ? (
              <div role="group" aria-label="Template actions" className="flex flex-wrap gap-3">
                <NewReportDraftButton templateId={template.id} action={createReportDraft} />
                <ConfirmActionButton
                  label={active ? 'Archive' : 'Activate'}
                  variant="secondary"
                  tone={active ? 'danger' : 'primary'}
                  title={active ? 'Archive this template?' : 'Activate this template?'}
                  description={
                    active
                      ? 'No new report can be created from it (creating one answers 422 report_template_not_published). Reports already created keep running, and an inquiry template that lists it still runs it on completion.'
                      : 'New reports can be created from it again.'
                  }
                  confirmLabel={active ? 'Archive template' : 'Activate template'}
                  action={updateReportTemplateStatus}
                  fields={{
                    'report-template-id': template.id,
                    status: active ? 'archived' : 'active',
                  }}
                  successMessage={
                    active ? 'The template was archived.' : 'The template was activated.'
                  }
                />
              </div>
            ) : undefined
          }
        />

        <PageSection id="report-template-type" title="Report type">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Detail term="Type">{REPORT_TYPE_LABELS[toReportResourceType(type)]}</Detail>
            <Detail term="Stage">
              <Badge
                status={definition.stage}
                label={definition.stage === 'ga' ? 'GA' : 'Beta'}
                tone={definition.stage === 'ga' ? 'success' : 'attention'}
              />
            </Detail>
            <Detail term="Tiers">{definition.tierNote}</Detail>
          </dl>
        </PageSection>

        <PageSection
          id="report-template-current"
          title="Current version"
          description="New reports use it. Each report keeps the version it was created from."
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Version">
              <Link
                href={`/report-templates/${template.id}/versions/${current.id}`}
                className={LINK_CLASS}
              >
                Version {String(current['version-number'])}
              </Link>
            </Detail>
            <Detail term="Published (UTC)">
              <Timestamp value={current['published-at']} />
            </Detail>
          </dl>
          <ResolvedConfig
            type={type}
            caption={`Configuration of version ${String(current['version-number'])}`}
            config={configRecord(current.config)}
          />
        </PageSection>

        <PageSection
          id="report-template-versions"
          title="Version history"
          description="Drafts can be edited, then published; publishing supersedes the version in use."
        >
          <DataTable
            caption="Versions"
            captionHidden
            columns={versionColumns(template.id)}
            rows={versions.data}
            getRowKey={(version) => version.id}
            emptyMessage="No more versions."
          />
          <Pagination
            path={`/report-templates/${template.id}`}
            query={{}}
            after={after}
            nextCursor={cursorFromNextLink(versions.links.next, 'rptpv')}
          />
        </PageSection>
      </PageMain>
    );
  });
}
