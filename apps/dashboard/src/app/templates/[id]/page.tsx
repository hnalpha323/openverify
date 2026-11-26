import { idSchema, type InquiryTemplateVersionResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { DataTable, type Column } from '../../../components/data-table';
import { Detail } from '../../../components/detail';
import { TemplateStatusBadge, VersionStatusBadge } from '../../../components/lifecycle/badges';
import { PageSection } from '../../../components/lifecycle/page-section';
import { NewDraftButton } from '../../../components/lifecycle/new-draft-button';
import { TemplateSettingsList } from '../../../components/lifecycle/template-settings-list';
import { LINK_CLASS } from '../../../components/link-styles';
import { EmptyValue } from '../../../components/masked-value';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { TemplateTabs } from '../../../components/template-tabs';
import { Pagination } from '../../../components/pagination';
import { Timestamp } from '../../../components/timestamp';
import {
  copyTemplateAction,
  promoteTemplateAction,
} from '../../../components/flow-builder/template-operations-actions';
import {
  CopyTemplateButton,
  PromoteTemplateButton,
} from '../../../components/flow-builder/template-operations';
import { VersionDiffList } from '../../../components/flow-builder/version-diff-list';
import { listTemplateDeployments } from '../../../lib/api/deployments';
import { diffTemplateVersions } from '../../../lib/api/inquiry-template-versions';
import { templateUsedBy } from '../../../lib/api/inquiry-templates';
import { hasPermission } from '../../../lib/api/me';
import { FLOW_BUILDER_COPY } from '../../../lib/copy/flow-builder';
import { renderPage } from '../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import { createDraftVersion, restoreVersion, updateTemplateStatus } from '../actions';

export const metadata: Metadata = { title: 'Template' };

const PAGE_SIZE = 25;

export interface TemplatePageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const versionCopy = FLOW_BUILDER_COPY.versions;

function versionColumns(
  templateId: string,
  canWrite: boolean,
): readonly Column<InquiryTemplateVersionResource>[] {
  return [
    {
      id: 'version',
      header: 'Version',
      rowHeader: true,
      cell: (version) => (
        <Link href={`/templates/${templateId}/versions/${version.id}`} className={LINK_CLASS}>
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
    ...(canWrite
      ? [
          {
            id: 'restore',
            header: versionCopy.actions,
            cell: (version: InquiryTemplateVersionResource) => {
              const number = version.attributes['version-number'];
              return version.attributes.status === 'draft' ? (
                <EmptyValue />
              ) : (
                <ConfirmActionButton
                  label={versionCopy.restore(number)}
                  variant="secondary"
                  tone="primary"
                  title={versionCopy.restoreTitle(number)}
                  description={versionCopy.restoreDescription}
                  confirmLabel={versionCopy.restoreConfirm}
                  action={restoreVersion}
                  fields={{ 'inquiry-template-id': templateId, 'version-id': version.id }}
                  successMessage={versionCopy.restored(number)}
                />
              );
            },
          },
        ]
      : []),
  ];
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const versionIdOf = (value: string | string[] | undefined): string | null => {
  const id = single(value);
  return id !== undefined && idSchema('itmplv').safeParse(id).success ? id : null;
};

/**
 * One template (C11, C23): its current version and settings, its version history, and with
 * `inquiry-templates:write` a new draft and archiving.
 */
export default async function TemplatePage({ params, searchParams }: TemplatePageProps) {
  const { id } = await params;
  if (!idSchema('itmpl').safeParse(id).success) {
    notFound();
  }
  const query = await searchParams;
  const after = parseCursor(query.after, 'itmplv');
  const compare = versionIdOf(query.compare);
  const against = versionIdOf(query.against);
  return renderPage({ permissions: ['inquiry-templates:read'] }, async ({ session, api }) => {
    const [{ data: template }, versions, usage, deployments, diff] = await Promise.all([
      api.inquiryTemplates.retrieve(id),
      api.inquiryTemplateVersions.list({
        filter: { 'inquiry-template-id': id },
        page: { size: PAGE_SIZE, ...(after === undefined ? {} : { after }) },
      }),
      templateUsedBy(id),
      hasPermission(session, 'deployments:read') ? listTemplateDeployments(id) : null,
      compare !== null && against !== null && compare !== against
        ? diffTemplateVersions(compare, against)
        : null,
    ]);
    const { attributes } = template;
    const status = attributes.status ?? 'active';
    const current = attributes['current-version'];
    const canWrite = hasPermission(session, 'inquiry-templates:write');

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Templates', href: '/templates' }, { label: attributes.name }]}
          title={attributes.name}
          description={
            <span className="flex flex-wrap items-center gap-3">
              <TemplateStatusBadge status={status} />
              <code className="font-mono text-xs">{template.id}</code>
            </span>
          }
          actions={
            canWrite ? (
              <div className="flex flex-wrap gap-3">
                <div role="group" aria-label="Template actions" className="flex flex-wrap gap-3">
                  <NewDraftButton templateId={template.id} action={createDraftVersion} />
                  <ConfirmActionButton
                    label={status === 'active' ? 'Archive' : 'Activate'}
                    variant="secondary"
                    tone={status === 'active' ? 'danger' : 'primary'}
                    title={
                      status === 'active' ? 'Archive this template?' : 'Activate this template?'
                    }
                    description={
                      status === 'active'
                        ? 'No new inquiry can use it (creating one answers 422). Existing inquiries are not affected.'
                        : 'New inquiries can use it again.'
                    }
                    confirmLabel={status === 'active' ? 'Archive template' : 'Activate template'}
                    action={updateTemplateStatus}
                    fields={{
                      'inquiry-template-id': template.id,
                      status: status === 'active' ? 'archived' : 'active',
                    }}
                    successMessage={
                      status === 'active'
                        ? 'The template was archived.'
                        : 'The template was activated.'
                    }
                  />
                </div>
                {/* C155.7 (Workflow 9D): copy and promote the current version. */}
                <div
                  role="group"
                  aria-label={FLOW_BUILDER_COPY.operations.group}
                  className="flex flex-wrap gap-3"
                >
                  <CopyTemplateButton
                    templateId={template.id}
                    templateName={attributes.name}
                    versionId={current.id}
                    action={copyTemplateAction}
                  />
                  <PromoteTemplateButton
                    templateId={template.id}
                    versionId={current.id}
                    versionNumber={current['version-number']}
                    current={session.environment}
                    environments={session.environments}
                    action={promoteTemplateAction}
                  />
                </div>
              </div>
            ) : undefined
          }
        />
        <TemplateTabs templateId={template.id} current="overview" />

        <PageSection
          id="template-current"
          title="Current version"
          description="New inquiries use it. Each inquiry keeps the version it was created with."
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Version">
              <Link
                href={`/templates/${template.id}/versions/${current.id}`}
                className={LINK_CLASS}
              >
                Version {String(current['version-number'])}
              </Link>
            </Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={current['created-at']} />
            </Detail>
            {current.settings !== undefined && <TemplateSettingsList settings={current.settings} />}
          </dl>
        </PageSection>

        <PageSection
          id="template-versions"
          title="Version history"
          description="Drafts can be edited, then published; publishing supersedes the version in use."
        >
          <DataTable
            caption="Versions"
            captionHidden
            columns={versionColumns(template.id, canWrite)}
            rows={versions.data}
            getRowKey={(version) => version.id}
            emptyMessage="No more versions."
          />
          <Pagination
            path={`/templates/${template.id}`}
            query={{}}
            after={after}
            nextCursor={cursorFromNextLink(versions.links.next, 'itmplv')}
          />
        </PageSection>

        <PageSection
          id="template-compare"
          title={versionCopy.compare}
          description={versionCopy.compareDescription}
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            {(['compare', 'against'] as const).map((name) => (
              <label key={name} className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">
                  {name === 'compare' ? versionCopy.version : versionCopy.against}
                </span>
                <select
                  name={name}
                  defaultValue={(name === 'compare' ? compare : against) ?? ''}
                  className="min-h-11 rounded-md border border-control bg-surface px-3"
                >
                  {versions.data.map((version) => (
                    <option key={version.id} value={version.id}>
                      Version {String(version.attributes['version-number'])}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="submit"
              className="min-h-11 rounded-md border border-line px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {versionCopy.compareSubmit}
            </button>
          </form>
          {diff !== null && <VersionDiffList diff={diff} />}
        </PageSection>

        <PageSection id="template-used-by" title={versionCopy.usedBy}>
          <ul className="flex flex-col gap-1 text-sm">
            {(
              [
                ['workflows', usage.workflows, usage['workflows-hidden']],
                ['report templates', usage['report-templates'], usage['report-templates-hidden']],
                ['case templates', usage['case-templates'], usage['case-templates-hidden']],
              ] as const
            ).map(([kind, named, hidden]) => (
              <li key={kind}>
                {named.length === 0
                  ? versionCopy.noneNamed(kind)
                  : named.map((item) => item.name).join(', ')}
                {hidden > 0 && `; ${versionCopy.hidden(hidden, kind)}`}
              </li>
            ))}
            {usage['embed-origins'].length > 0 && (
              <li>{versionCopy.embedOrigins(usage['embed-origins'].join(', '))}</li>
            )}
          </ul>
        </PageSection>

        {deployments !== null && (
          <PageSection id="template-deployments" title={versionCopy.deployments}>
            {deployments.data.length === 0 ? (
              <p className="text-sm">{versionCopy.noDeployments}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {deployments.data.map((deployment) => (
                  <li key={deployment.id}>
                    <Timestamp value={deployment.attributes['created-at']} />{' '}
                    <code className="font-mono text-xs">{deployment.id}</code>
                  </li>
                ))}
              </ul>
            )}
          </PageSection>
        )}
      </PageMain>
    );
  });
}
