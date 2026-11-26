import { idSchema } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { VerificationConfigForm } from '../../../../components/check-panels/verification-config-form';
import { VersionStatusBadge } from '../../../../components/lifecycle/badges';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { readListChoices } from '../../../../components/schema-form/list-choices';
import { MemberForm, type SavedProblem } from '../../../../components/schema-form/member-form';
import {
  FORM_MEMBER_KEYS,
  memberPointer,
  memberValueOf,
  type FormMemberKey,
} from '../../../../components/schema-form/template-members';
import { TemplateTabs } from '../../../../components/template-tabs';
import { retrieveTemplateVersion } from '../../../../lib/api/inquiry-template-versions';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { TEMPLATE_FORMS_COPY } from '../../../../lib/copy/template-forms';
import { saveTemplateMember } from './actions';

const COPY = TEMPLATE_FORMS_COPY.settingsPage;

export const metadata: Metadata = { title: COPY.metadataTitle };

export interface TemplateSettingsPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The version the tab shows: the one `?version=` names, else the template's draft, else its
 * current version.
 */
async function versionIdOf(
  api: OpenVerifyClient,
  templateId: string,
  currentId: string,
  asked: string | undefined,
): Promise<string> {
  if (asked !== undefined) {
    return asked;
  }
  const drafts = await api.inquiryTemplateVersions.list({
    filter: { 'inquiry-template-id': templateId, status: 'draft' },
    page: { size: 1 },
  });
  return drafts.data[0]?.id ?? currentId;
}

/**
 * The template's settings tab (C153.3): the draft's settings, verification checks, links,
 * embedding and redirects, reports, signals and list screening as forms generated from the
 * contracts, each saved to the draft with its ETag (C154.3); any other version, or a reader
 * without `inquiry-templates:write`, read-only. The saved draft's own publish problems show at
 * their fields. Field schemas, copy and theme are other tabs', so none of them reaches the browser.
 */
export default async function TemplateSettingsPage({
  params,
  searchParams,
}: TemplateSettingsPageProps) {
  const { id } = await params;
  if (!idSchema('itmpl').safeParse(id).success) {
    notFound();
  }
  const asked = idSchema('itmplv').safeParse((await searchParams).version).data;
  return renderPage({ permissions: ['inquiry-templates:read'] }, async ({ session, api }) => {
    const { data: template } = await api.inquiryTemplates.retrieve(id);
    const { version, etag } = await retrieveTemplateVersion(
      await versionIdOf(api, id, template.attributes['current-version'].id, asked),
    );
    if (version.relationships['inquiry-template'].data.id !== id) {
      notFound();
    }
    const { attributes } = version;
    const number = attributes['version-number'];
    const draft = attributes.status === 'draft';
    const canEdit = draft && hasPermission(session, 'inquiry-templates:write');
    const lead = !draft
      ? COPY.versionReadOnly(number)
      : canEdit
        ? COPY.versionDraft(number)
        : COPY.versionNoWrite(number);
    const lists = canEdit && hasPermission(session, 'lists:read') ? await readListChoices(api) : [];
    const ids = { templateId: template.id, versionId: version.id, etag };
    const problems = attributes.validation?.problems ?? [];
    const savedIn = (member: FormMemberKey): SavedProblem[] =>
      problems.flatMap((problem) => {
        const pointer = memberPointer(member, problem.pointer);
        return pointer === null ? [] : [{ ...problem, pointer }];
      });
    const memberSection = (member: FormMemberKey) => (
      <PageSection
        key={member}
        id={`template-settings-${member}`}
        title={TEMPLATE_FORMS_COPY.members[member]}
        description={TEMPLATE_FORMS_COPY.sections[member]}
      >
        <MemberForm
          member={member}
          initial={memberValueOf(member, attributes)}
          ids={ids}
          action={saveTemplateMember}
          readOnly={!canEdit}
          lists={lists}
          saved={savedIn(member)}
        />
      </PageSection>
    );
    const [settings, ...rest] = FORM_MEMBER_KEYS;

    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: COPY.breadcrumbTemplates, href: '/templates' },
            { label: template.attributes.name, href: `/templates/${template.id}` },
            { label: COPY.breadcrumbSettings },
          ]}
          title={COPY.title}
          description={
            <span className="flex flex-col gap-2">
              <VersionStatusBadge status={attributes.status} />
              <span>{lead}</span>
            </span>
          }
        />
        <TemplateTabs templateId={template.id} current="settings" />
        {memberSection(settings)}
        <PageSection
          id="template-settings-verification-config"
          title={TEMPLATE_FORMS_COPY.verificationConfig.legend}
          description={TEMPLATE_FORMS_COPY.verificationConfig.description}
        >
          <VerificationConfigForm
            config={attributes['verification-config']}
            flow={attributes.flow}
            ids={ids}
            action={saveTemplateMember}
            readOnly={!canEdit}
          />
        </PageSection>
        {rest.map(memberSection)}
      </PageMain>
    );
  });
}
