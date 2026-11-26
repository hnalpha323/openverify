import { idSchema, type InquiryTemplateVersionResource } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { previewFlowOrigin } from '../../../../components/flow-preview/flow-origin';
import { PreviewBanner } from '../../../../components/flow-preview/preview-banner';
import { PreviewWorkbench } from '../../../../components/flow-preview/preview-workbench';
import { SimulatePanel } from '../../../../components/flow-preview/simulate-panel';
import { simulationSubjectsOf } from '../../../../components/flow-preview/simulation-subjects';
import { VersionStatusBadge } from '../../../../components/lifecycle/badges';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { TemplateTabs } from '../../../../components/template-tabs';
import { PREVIEW_COPY } from '../../../../lib/copy/preview';
import { renderPage } from '../../../../lib/api/page';
import { listSimulationPresets } from '../../../../lib/api/simulation-presets';
import { removePreset, resolvePreview, runSimulation, savePreset } from './actions';

export const metadata: Metadata = { title: PREVIEW_COPY.page.metadataTitle };

export interface TemplatePreviewPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The version id a URL names, `undefined` for none, `null` for a malformed one. */
function versionIdOf(value: string | string[] | undefined): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && idSchema('itmplv').safeParse(value).success ? value : null;
}

/**
 * The version a preview opens: the one the URL names (of this template only), else the newest
 * draft, else the newest version (the API lists newest first).
 */
async function versionToPreview(
  api: OpenVerifyClient,
  templateId: string,
  versionId: string | undefined,
): Promise<InquiryTemplateVersionResource> {
  if (versionId !== undefined) {
    const { data } = await api.inquiryTemplateVersions.retrieve(versionId);
    if (data.relationships['inquiry-template'].data.id !== templateId) {
      notFound();
    }
    return data;
  }
  const { data } = await api.inquiryTemplateVersions.list({
    filter: { 'inquiry-template-id': templateId },
    page: { size: 25 },
  });
  const chosen = data.find((version) => version.attributes.status === 'draft') ?? data[0];
  if (chosen === undefined) {
    notFound();
  }
  return chosen;
}

/**
 * C156 (Workflow 9C, `dashboard-preview`): a template version's preview. It holds configuration
 * and synthetic values only: no inquiry, no provider call, no stored run (C156.5).
 */
export default async function TemplatePreviewPage({
  params,
  searchParams,
}: TemplatePreviewPageProps) {
  const { id } = await params;
  const versionId = versionIdOf((await searchParams).version);
  if (!idSchema('itmpl').safeParse(id).success || versionId === null) {
    notFound();
  }
  return renderPage({ permissions: ['inquiry-templates:read'] }, async ({ api }) => {
    const [{ data: template }, version, presets] = await Promise.all([
      api.inquiryTemplates.retrieve(id),
      versionToPreview(api, id, versionId),
      listSimulationPresets(),
    ]);
    return (
      <PageMain className="gap-6">
        <PageHeader
          breadcrumbs={[
            { label: 'Templates', href: '/templates' },
            { label: template.attributes.name, href: `/templates/${template.id}` },
            { label: PREVIEW_COPY.page.breadcrumb },
          ]}
          title={PREVIEW_COPY.page.title}
          description={
            <span className="flex flex-wrap items-center gap-3">
              <span>{PREVIEW_COPY.page.versionNumber(version.attributes['version-number'])}</span>
              <VersionStatusBadge status={version.attributes.status} />
              <span>{PREVIEW_COPY.page.description}</span>
            </span>
          }
        />
        <TemplateTabs templateId={template.id} current="preview" />
        <PreviewBanner />
        <PreviewWorkbench
          templateId={template.id}
          versionId={version.id}
          flowOrigin={previewFlowOrigin()}
          locales={version.attributes['enabled-locales'] ?? ['en']}
          defaultLocale={version.attributes['default-locale'] ?? 'en'}
          resolve={resolvePreview}
        />
        <SimulatePanel
          versionId={version.id}
          subjects={simulationSubjectsOf(version.attributes.flow)}
          presets={presets}
          simulate={runSimulation}
          save={savePreset}
          remove={removePreset}
        />
      </PageMain>
    );
  });
}
