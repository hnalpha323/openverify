import { idSchema } from '@openverify/contracts';
import { isFlowV2, migrateFlow } from '@openverify/flow-spec';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LINK_CLASS } from '../../../../components/link-styles';
import { FlowBuilder } from '../../../../components/flow-builder/flow-builder';
import { PageHeader } from '../../../../components/page-header';
import { BuilderCopyPanel } from '../../../../components/translations/builder-copy-panel';
import { localeReviewStatuses } from '../../../../components/translations/copy-key-catalog';
import { PageMain } from '../../../../components/page-main';
import { TemplateTabs, templateTabHref } from '../../../../components/template-tabs';
import { FLOW_BUILDER_COPY } from '../../../../lib/copy/flow-builder';
import {
  diffTemplateVersions,
  retrieveTemplateVersion,
} from '../../../../lib/api/inquiry-template-versions';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { checkFlowPublish, publishFlowDraft, saveFlowDraft } from './actions';

export const metadata: Metadata = { title: 'Template flow' };

export interface FlowPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const copy = FLOW_BUILDER_COPY.page;

/**
 * The template's flow (C155): its draft, which the builder edits. Without a draft it says where one
 * is made (the overview's "New draft"), since a published version is never edited (C154).
 */
export default async function FlowPage({ params }: FlowPageProps) {
  const { id } = await params;
  if (!idSchema('itmpl').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['inquiry-templates:read'] }, async ({ session, api }) => {
    const [{ data: template }, versions] = await Promise.all([
      api.inquiryTemplates.retrieve(id),
      api.inquiryTemplateVersions.list({
        filter: { 'inquiry-template-id': id },
        page: { size: 25 },
      }),
    ]);
    const listed = versions.data.find((version) => version.attributes.status === 'draft') ?? null;
    // The draft with its ETag, which every save sends as If-Match (C154.3).
    const current = template.attributes['current-version'];
    const [draft, sets, diff] = await Promise.all([
      listed === null ? null : retrieveTemplateVersion(listed.id),
      // C155.8: the theme picker lists the environment's active sets (`theme-sets:read`).
      listed !== null && hasPermission(session, 'theme-sets:read')
        ? api.themeSets.list({ filter: { status: ['active'] }, page: { size: 100 } })
        : null,
      // C155.7: the draft against the version new inquiries use, drawn as badges and listed.
      listed === null || listed.id === current.id
        ? null
        : diffTemplateVersions(listed.id, current.id),
    ]);
    return (
      <PageMain className="gap-6">
        <PageHeader
          breadcrumbs={[
            { label: 'Templates', href: '/templates' },
            { label: template.attributes.name, href: templateTabHref(template.id, 'overview') },
            { label: copy.title },
          ]}
          title={copy.title}
          description={copy.description}
        />
        <TemplateTabs templateId={template.id} current="flow" />
        {draft === null ? (
          <p className="text-sm">
            {copy.noDraft}{' '}
            <Link href={templateTabHref(template.id, 'overview')} className={LINK_CLASS}>
              {copy.overviewLink}
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-sm">{copy.draft(draft.version.attributes['version-number'])}</p>
            <FlowBuilder
              versionId={draft.version.id}
              flow={migrateFlow(draft.version.attributes.flow)}
              etag={draft.etag}
              migrated={!isFlowV2(draft.version.attributes.flow)}
              verificationConfig={draft.version.attributes['verification-config']}
              canEdit={hasPermission(session, 'inquiry-templates:write')}
              canPublish={hasPermission(session, 'inquiry-templates:publish')}
              actions={{
                save: saveFlowDraft,
                check: checkFlowPublish,
                publish: publishFlowDraft,
              }}
              theme={
                sets === null
                  ? null
                  : {
                      sets: sets.data.map((set) => ({
                        id: set.id,
                        name: set.attributes.name,
                        revision: set.attributes.revision,
                        isDefault: set.attributes['is-default'],
                      })),
                      value: draft.version.attributes['theme-set-id'] ?? null,
                    }
              }
              fieldSchemas={(draft.version.attributes['field-schemas'] ?? []).map((field) => ({
                key: field.key,
                type: field.type,
                pii: field.pii,
              }))}
              comparison={diff === null ? null : { versionNumber: current['version-number'], diff }}
              copyPanel={
                <BuilderCopyPanel
                  templateId={template.id}
                  enabledLocales={draft.version.attributes['enabled-locales'] ?? ['en']}
                  defaultLocale={draft.version.attributes['default-locale'] ?? 'en'}
                  copy={draft.version.attributes.copy}
                  reviewStatus={localeReviewStatuses()}
                />
              }
            />
          </>
        )}
      </PageMain>
    );
  });
}
