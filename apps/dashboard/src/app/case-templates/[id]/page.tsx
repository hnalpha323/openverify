import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  NewTemplateDraftButton,
  TemplateSettingsForm,
} from '../../../components/cases/template-forms';
import { VersionContent } from '../../../components/cases/version-content';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { Detail } from '../../../components/detail';
import { PageSection } from '../../../components/lifecycle/page-section';
import { VersionsTable } from '../../../components/lifecycle/versions-table';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Timestamp } from '../../../components/timestamp';
import {
  getCaseTemplate,
  getCaseTemplateVersion,
  listCaseTemplateVersions,
} from '../../../lib/api/case-templates';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import { archiveCaseTemplate, createCaseTemplateDraft, updateCaseTemplate } from '../actions';

export const metadata: Metadata = { title: 'Case template' };

/** The template page names configuration by id; the version page reads the names. */
const NO_NAMES = {
  queues: new Map<string, string>(),
  assignmentPolicies: new Map<string, string>(),
  slaPolicies: new Map<string, string>(),
};

export interface CaseTemplatePageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * One case template (C130, C142.1): its key and who sees its cases, every version newest first, the
 * published version in words, and with `case-templates:write` the open draft (by the template's
 * `draft-version` relationship) or a new one, the name, the roles and archiving. Reads
 * `GET /case-templates/:id`, `GET /case-template-versions` and the published version.
 */
export default async function CaseTemplatePage({
  params,
  searchParams,
}: CaseTemplatePageProps): Promise<ReactNode> {
  const { id } = await params;
  if (!idSchema('ctmpl').safeParse(id).success) {
    notFound();
  }
  const after = parseCursor((await searchParams).after, 'ctmplv');
  return renderPage({ permissions: ['case-templates:read'] }, async ({ session }) => {
    const [{ data: template }, versions] = await Promise.all([
      getCaseTemplate(id),
      listCaseTemplateVersions(id, after),
    ]);
    const { attributes } = template;
    const canWrite = hasPermission(session, 'case-templates:write');
    const publishedId = template.relationships['published-version'].data?.id;
    const draftId = template.relationships['draft-version'].data?.id;
    const published = publishedId === undefined ? null : await getCaseTemplateVersion(publishedId);
    const versionHref = (versionId: string) =>
      `/case-templates/${template.id}/versions/${versionId}`;
    const roles = attributes['visible-to-roles'];
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Case templates', href: '/case-templates' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description={
            attributes.status === 'active'
              ? 'Active'
              : 'Archived: it takes no new case. Its cases keep their version and stay readable.'
          }
          actions={
            canWrite ? (
              <>
                {draftId === undefined ? (
                  <NewTemplateDraftButton
                    templateId={template.id}
                    action={createCaseTemplateDraft}
                  />
                ) : (
                  <Link href={versionHref(draftId)} className={LINK_CLASS}>
                    Open the latest draft
                  </Link>
                )}
                {attributes.status === 'active' && (
                  <ConfirmActionButton
                    label="Archive template"
                    title="Archive this case template?"
                    description="It takes no new case, permanently. Existing cases keep their version and stay readable."
                    confirmLabel="Archive template"
                    pendingLabel="Archiving…"
                    action={archiveCaseTemplate}
                    fields={{ 'case-template-id': template.id }}
                    successMessage="Archived the template."
                  />
                )}
              </>
            ) : undefined
          }
        />
        <PageSection id="case-template-details" title="Details">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail term="Key">
              <code className="font-mono text-xs">{attributes.key}</code>
            </Detail>
            <Detail term="Who sees its cases">
              {roles.length === 0
                ? 'Every role that holds cases:read sees its cases.'
                : `Only these roles: ${roles.join(', ')}`}
            </Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            <Detail term="Updated (UTC)">
              <Timestamp value={attributes['updated-at']} />
            </Detail>
          </dl>
        </PageSection>
        <PageSection id="case-template-versions" title="Version history">
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
            path={`/case-templates/${template.id}`}
            query={{}}
            after={after}
            nextCursor={cursorFromNextLink(versions.links.next, 'ctmplv')}
          />
        </PageSection>
        <PageSection id="case-template-published" title="Published version">
          {published === null ? (
            <p className="text-sm text-ink-muted">
              No version is published yet, so no case can be created with this template.
            </p>
          ) : (
            <VersionContent attributes={published.data.attributes} names={NO_NAMES} />
          )}
        </PageSection>
        {canWrite && (
          <PageSection id="case-template-settings" title="Settings">
            <TemplateSettingsForm
              templateId={template.id}
              name={attributes.name}
              roles={roles}
              action={updateCaseTemplate}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
