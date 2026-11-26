import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChecklistsEditor } from '../../../../../components/cases/checklists/checklists-editor';
import {
  saveCaseVersionChecklists,
  saveCaseVersionLayout,
} from '../../../../../components/cases/layout/layout-actions';
import { LayoutEditor } from '../../../../../components/cases/layout/layout-editor';
import { VersionContent, type VersionNames } from '../../../../../components/cases/version-content';
import { VersionEditor, type VersionChoice } from '../../../../../components/cases/version-editor';
import { ConfirmActionButton } from '../../../../../components/confirm-action-button';
import { Detail } from '../../../../../components/detail';
import { PageSection } from '../../../../../components/lifecycle/page-section';
import { EmptyValue } from '../../../../../components/masked-value';
import { PageHeader } from '../../../../../components/page-header';
import { PageMain } from '../../../../../components/page-main';
import { Timestamp } from '../../../../../components/timestamp';
import {
  listAssignmentPolicies,
  listSlaPolicies,
  CASE_POLICY_CHOICES,
} from '../../../../../lib/api/case-policies';
import { CASE_QUEUE_CHOICES, listCaseQueues } from '../../../../../lib/api/case-queues';
import { getCaseTemplate, getCaseTemplateVersion } from '../../../../../lib/api/case-templates';
import { hasPermission, type DashboardSession } from '../../../../../lib/api/me';
import { renderPage } from '../../../../../lib/api/page';
import { CASES_REPORTS_COPY } from '../../../../../lib/copy/cases-reports';
import { publishCaseTemplateDraft, updateCaseTemplateDraft } from '../../../actions';

export const metadata: Metadata = { title: 'Case template version' };

export interface CaseTemplateVersionPageProps {
  readonly params: Promise<{ id: string; versionId: string }>;
}

const STATUS_LABELS = { draft: 'Draft', published: 'Published', superseded: 'Superseded' } as const;

const PUBLISH_DESCRIPTION =
  'It becomes the template’s published version: new cases pin it, and cases already open keep theirs. The API checks the fields, the statuses and the moves between them first, and refuses, with each problem at its place, a version that breaks a rule. Save your changes first: publishing uses the saved draft.';

interface Configuration {
  readonly names: VersionNames;
  readonly choices: {
    readonly queues: readonly VersionChoice[];
    readonly assignmentPolicies: readonly VersionChoice[];
    readonly slaPolicies: readonly VersionChoice[];
  };
}

const choicesOf = (resources: readonly { id: string; attributes: { name: string } }[]) =>
  resources.map((resource) => ({ id: resource.id, name: resource.attributes.name }));

/** The queues and policies a version may name, read with `case-queues:read`; none without it. */
async function configurationFor(session: DashboardSession): Promise<Configuration> {
  if (!hasPermission(session, 'case-queues:read')) {
    return {
      names: { queues: new Map(), assignmentPolicies: new Map(), slaPolicies: new Map() },
      choices: { queues: [], assignmentPolicies: [], slaPolicies: [] },
    };
  }
  const [queues, assignmentPolicies, slaPolicies] = await Promise.all([
    listCaseQueues({ status: 'active' }, { size: CASE_QUEUE_CHOICES }),
    listAssignmentPolicies({ size: CASE_POLICY_CHOICES }),
    listSlaPolicies({ size: CASE_POLICY_CHOICES }),
  ]);
  const choices = {
    queues: choicesOf(queues.data),
    assignmentPolicies: choicesOf(assignmentPolicies.data),
    slaPolicies: choicesOf(slaPolicies.data),
  };
  const mapOf = (list: readonly VersionChoice[]) =>
    new Map(list.map((choice) => [choice.id, choice.name]));
  return {
    choices,
    names: {
      queues: mapOf(choices.queues),
      assignmentPolicies: mapOf(choices.assignmentPolicies),
      slaPolicies: mapOf(choices.slaPolicies),
    },
  };
}

/**
 * One case template version (C130.2, C142.1). A draft is edited with `case-templates:write` and
 * published with `case-templates:publish`; every other version, and a draft for a reader, is shown
 * in words. Reads `GET /case-template-versions/:id`, its template, and the queues and policies it may
 * name with `case-queues:read`.
 */
export default async function CaseTemplateVersionPage({
  params,
}: CaseTemplateVersionPageProps): Promise<ReactNode> {
  const { id, versionId } = await params;
  if (
    !idSchema('ctmpl').safeParse(id).success ||
    !idSchema('ctmplv').safeParse(versionId).success
  ) {
    notFound();
  }
  return renderPage({ permissions: ['case-templates:read'] }, async ({ session }) => {
    const { data: version } = await getCaseTemplateVersion(versionId);
    if (version.relationships['case-template'].data.id !== id) {
      notFound();
    }
    const [{ data: template }, configuration] = await Promise.all([
      getCaseTemplate(id),
      configurationFor(session),
    ]);
    const { attributes } = version;
    const title = `Version ${String(attributes['version-number'])}`;
    const draft = attributes.status === 'draft';
    const canEdit = draft && hasPermission(session, 'case-templates:write');
    const canPublish = draft && hasPermission(session, 'case-templates:publish');
    const ids = { 'case-template-id': template.id, 'version-id': version.id };
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: 'Case templates', href: '/case-templates' },
            { label: template.attributes.name, href: `/case-templates/${template.id}` },
            { label: title },
          ]}
          title={title}
          description={STATUS_LABELS[attributes.status]}
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
                action={publishCaseTemplateDraft}
                fields={ids}
                successMessage={`${title} was published.`}
              />
            ) : undefined
          }
        />
        <PageSection id="case-template-version-details" title="Details">
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
        {canEdit && (
          <>
            <PageSection id="case-template-version-layout" title={CASES_REPORTS_COPY.layout.title}>
              <LayoutEditor
                templateId={template.id}
                versionId={version.id}
                layout={attributes.layout ?? null}
                offered={attributes['layout-modules']}
                held={[...session.permissions]}
                action={saveCaseVersionLayout}
              />
            </PageSection>
            <PageSection
              id="case-template-version-checklists"
              title={CASES_REPORTS_COPY.versionMembers.checklistsTitle}
            >
              <ChecklistsEditor
                templateId={template.id}
                versionId={version.id}
                checklists={attributes.checklists ?? []}
                presetComments={attributes['preset-comments'] ?? []}
                action={saveCaseVersionChecklists}
              />
            </PageSection>
          </>
        )}
        <PageSection id="case-template-version-content" title="Content">
          {canEdit ? (
            <VersionEditor
              templateId={template.id}
              version={version}
              choices={configuration.choices}
              action={updateCaseTemplateDraft}
            />
          ) : (
            <VersionContent attributes={attributes} names={configuration.names} />
          )}
        </PageSection>
      </PageMain>
    );
  });
}
