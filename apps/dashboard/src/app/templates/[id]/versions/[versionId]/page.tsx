import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../../../components/confirm-action-button';
import { Detail } from '../../../../../components/detail';
import { VersionStatusBadge } from '../../../../../components/lifecycle/badges';
import { PageSection } from '../../../../../components/lifecycle/page-section';
import { TemplateSettingsList } from '../../../../../components/lifecycle/template-settings-list';
import { VersionEditor } from '../../../../../components/lifecycle/version-editor';
import { EmptyValue } from '../../../../../components/masked-value';
import { LINK_CLASS } from '../../../../../components/link-styles';
import { PageHeader } from '../../../../../components/page-header';
import { PageMain } from '../../../../../components/page-main';
import { Timestamp } from '../../../../../components/timestamp';
import { hasPermission } from '../../../../../lib/api/me';
import { FLOW_BUILDER_COPY } from '../../../../../lib/copy/flow-builder';
import { renderPage } from '../../../../../lib/api/page';
import { publishVersion, updateDraftVersion } from '../../../actions';

export const metadata: Metadata = { title: 'Template version' };

export interface VersionPageProps {
  readonly params: Promise<{ id: string; versionId: string }>;
}

function JsonBlock({ id, title, value }: { id: string; title: string; value: unknown }) {
  return (
    <PageSection id={id} title={title}>
      {/* A region a keyboard can focus and scroll (WCAG 2.1.1; axe scrollable-region-focusable). */}
      <div
        role="region"
        aria-label={`${title} as JSON`}
        tabIndex={0}
        className="max-h-96 overflow-auto rounded-lg border border-line bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <pre className="p-4 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
      </div>
    </PageSection>
  );
}

/**
 * One template version (C11, C23). A draft is edited as JSON with `inquiry-templates:write` and
 * published with `inquiry-templates:publish`; every other version is read-only.
 */
export default async function VersionPage({ params }: VersionPageProps) {
  const { id, versionId } = await params;
  if (
    !idSchema('itmpl').safeParse(id).success ||
    !idSchema('itmplv').safeParse(versionId).success
  ) {
    notFound();
  }
  return renderPage({ permissions: ['inquiry-templates:read'] }, async ({ session, api }) => {
    const { data: version } = await api.inquiryTemplateVersions.retrieve(versionId);
    if (version.relationships['inquiry-template'].data.id !== id) {
      notFound();
    }
    const { data: template } = await api.inquiryTemplates.retrieve(id);
    const { attributes } = version;
    const title = `Version ${String(attributes['version-number'])}`;
    const draft = attributes.status === 'draft';
    const canEdit = draft && hasPermission(session, 'inquiry-templates:write');
    const canPublish = draft && hasPermission(session, 'inquiry-templates:publish');
    const ids = { 'inquiry-template-id': template.id, 'version-id': version.id };

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Templates', href: '/templates' },
            { label: template.attributes.name, href: `/templates/${template.id}` },
            { label: title },
          ]}
          title={title}
          description={
            <span className="flex flex-wrap items-center gap-3">
              <VersionStatusBadge status={attributes.status} />
              <Link
                href={`/templates/${encodeURIComponent(template.id)}/preview?version=${encodeURIComponent(version.id)}`}
                className={LINK_CLASS}
              >
                {FLOW_BUILDER_COPY.version.preview}
              </Link>
            </span>
          }
          actions={
            canPublish ? (
              <ConfirmActionButton
                label="Publish"
                variant="primary"
                tone="primary"
                title={`Publish ${title.toLowerCase()}?`}
                description="It becomes the template's current version and new inquiries use it; the version in use now is superseded. Existing inquiries keep their version. Save your changes first: publishing uses the saved draft."
                confirmLabel="Publish version"
                pendingLabel="Publishing…"
                action={publishVersion}
                fields={ids}
                successMessage={`${title} was published.`}
              />
            ) : undefined
          }
        />

        <PageSection id="version-details" title="Details">
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
            <TemplateSettingsList settings={attributes.settings} />
          </dl>
        </PageSection>

        {canEdit ? (
          <PageSection id="version-editor" title="Draft">
            <VersionEditor
              templateId={template.id}
              versionId={version.id}
              flow={attributes.flow}
              verificationConfig={attributes['verification-config']}
              settings={attributes.settings}
              signalConfig={attributes['signal-config']}
              listConfig={attributes['list-config']}
              action={updateDraftVersion}
            />
          </PageSection>
        ) : (
          <>
            <JsonBlock id="version-flow" title="Flow" value={attributes.flow} />
            <JsonBlock
              id="version-verification-config"
              title="Verification config"
              value={attributes['verification-config']}
            />
            <JsonBlock id="version-settings" title="Settings" value={attributes.settings} />
            {attributes['signal-config'] !== undefined && (
              <JsonBlock
                id="version-signal-config"
                title="Signal config"
                value={attributes['signal-config']}
              />
            )}
            {attributes['list-config'] !== undefined && (
              <JsonBlock
                id="version-list-config"
                title="List config"
                value={attributes['list-config']}
              />
            )}
          </>
        )}
      </PageMain>
    );
  });
}
