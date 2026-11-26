import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../../../components/confirm-action-button';
import { Detail } from '../../../../../components/detail';
import { VersionStatusBadge } from '../../../../../components/lifecycle/badges';
import { PageSection } from '../../../../../components/lifecycle/page-section';
import { EmptyValue } from '../../../../../components/masked-value';
import { PageHeader } from '../../../../../components/page-header';
import { PageMain } from '../../../../../components/page-main';
import { ConfigEditor } from '../../../../../components/report-config/config-editor';
import { ReportDraftForm } from '../../../../../components/report-config/report-config-forms';
import { readListChoices } from '../../../../../components/schema-form/list-choices';
import { configRecord, explicitConfig } from '../../../../../components/report-config/config-words';
import { ResolvedConfig } from '../../../../../components/report-config/resolved-config';
import { Timestamp } from '../../../../../components/timestamp';
import { hasPermission } from '../../../../../lib/api/me';
import { renderPage } from '../../../../../lib/api/page';
import { publishReportDraft, updateReportDraft } from '../../../actions';

export const metadata: Metadata = { title: 'Report template version' };

export interface ReportTemplateVersionPageProps {
  readonly params: Promise<{ id: string; versionId: string }>;
}

const PUBLISH_DESCRIPTION =
  'It becomes the template’s current version and new reports use it; the version in use now is superseded. Reports already created keep the version they were created from. The API checks the lists first and refuses, with the reason here, an empty list, a source it does not know, a sandbox-only list in production, or a list age below a selected source’s refresh interval. Save your changes first: publishing uses the saved draft.';

/**
 * One report template version (C71, C86). A draft is edited as JSON with
 * `report-templates:write`, beside its saved resolved configuration, and published with
 * `report-templates:publish`; every other version is read-only.
 */
export default async function ReportTemplateVersionPage({
  params,
}: ReportTemplateVersionPageProps) {
  const { id, versionId } = await params;
  if (!idSchema('rptp').safeParse(id).success || !idSchema('rptpv').safeParse(versionId).success) {
    notFound();
  }
  return renderPage({ permissions: ['report-templates:read'] }, async ({ session, api }) => {
    const { data: version } = await api.reportTemplateVersions.retrieve(versionId);
    if (version.relationships['report-template'].data.id !== id) {
      notFound();
    }
    const { data: template } = await api.reportTemplates.retrieve(id);
    const { attributes } = version;
    const type = attributes['report-type'];
    const config = configRecord(attributes.config);
    const title = `Version ${String(attributes['version-number'])}`;
    const draft = attributes.status === 'draft';
    const canEdit = draft && hasPermission(session, 'report-templates:write');
    const canPublish = draft && hasPermission(session, 'report-templates:publish');
    const ids = { 'report-template-id': template.id, 'version-id': version.id };

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Report templates', href: '/report-templates' },
            { label: template.attributes.name, href: `/report-templates/${template.id}` },
            { label: title },
          ]}
          title={title}
          description={<VersionStatusBadge status={attributes.status} />}
          actions={
            canPublish ? (
              <ConfirmActionButton
                label="Publish"
                variant="primary"
                tone="primary"
                title={`Publish ${title.toLowerCase()}?`}
                description={PUBLISH_DESCRIPTION}
                confirmLabel="Publish version"
                pendingLabel="Publishing…"
                action={publishReportDraft}
                fields={ids}
                successMessage={`${title} was published.`}
              />
            ) : undefined
          }
        />

        <PageSection id="report-template-version-details" title="Details">
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

        <PageSection id="report-template-version-config" title="Configuration">
          {canEdit ? (
            <div className="flex flex-col gap-8">
              <ReportDraftForm
                reportType={type}
                templateId={template.id}
                versionId={version.id}
                config={explicitConfig(type, config)}
                lists={
                  type === 'custom-list' && hasPermission(session, 'lists:read')
                    ? await readListChoices(api)
                    : []
                }
                action={updateReportDraft}
              />
              <div className="grid gap-6 lg:grid-cols-2">
                <ConfigEditor
                  templateId={template.id}
                  versionId={version.id}
                  config={explicitConfig(type, config)}
                  action={updateReportDraft}
                />
                <ResolvedConfig
                  type={type}
                  caption="Resolved configuration (saved)"
                  config={config}
                />
              </div>
            </div>
          ) : (
            <ResolvedConfig type={type} config={config} />
          )}
        </PageSection>
      </PageMain>
    );
  });
}
