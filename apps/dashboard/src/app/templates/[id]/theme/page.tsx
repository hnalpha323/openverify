import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { VersionStatusBadge } from '../../../../components/lifecycle/badges';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { TemplateTabs } from '../../../../components/template-tabs';
import { BuilderThemePanel } from '../../../../components/themes/builder-theme-panel';
import { TemplateThemeForm } from '../../../../components/themes/template-theme-form';
import { tabVersionOf } from '../../../../components/translations/tab-version';
import { retrieveTemplateVersion } from '../../../../lib/api/inquiry-template-versions';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { COPY_COPY } from '../../../../lib/copy/themes-copy';
import { saveTemplateTheme } from './actions';

const copy = COPY_COPY.themeTab;

export const metadata: Metadata = { title: copy.metadataTitle };

export interface TemplateThemePageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** At most this many active sets are offered (ours, provisional: one API page). */
const ACTIVE_SETS = 100;

/**
 * The template's theme tab (C160.7): which theme set the template's draft, else its current
 * version, renders, among the environment's active sets. An editor changes the draft's choice,
 * saved with `If-Match`; a published version is read-only. Needs `inquiry-templates:read` and
 * `theme-sets:read`; saving needs `inquiry-templates:write`.
 */
export default async function TemplateThemePage({ params }: TemplateThemePageProps) {
  const { id } = await params;
  if (!idSchema('itmpl').safeParse(id).success) {
    notFound();
  }
  return renderPage(
    { permissions: ['inquiry-templates:read', 'theme-sets:read'] },
    async ({ session, api }) => {
      const { data: template } = await api.inquiryTemplates.retrieve(id);
      const [shown, sets] = await Promise.all([
        tabVersionOf(api, id, template.attributes['current-version'].id),
        api.themeSets.list({ filter: { status: ['active'] }, page: { size: ACTIVE_SETS } }),
      ]);
      const draft = shown.attributes.status === 'draft';
      const canWrite = hasPermission(session, 'inquiry-templates:write');
      const etag = draft && canWrite ? (await retrieveTemplateVersion(shown.id)).etag : null;
      const choices = sets.data.map((set) => ({
        id: set.id,
        name: set.attributes.name,
        revision: set.attributes.revision,
        isDefault: set.attributes['is-default'],
      }));
      const value = shown.attributes['theme-set-id'] ?? null;
      return (
        <PageMain className="gap-8">
          <PageHeader
            breadcrumbs={[
              { label: 'Templates', href: '/templates' },
              { label: template.attributes.name, href: `/templates/${id}` },
              { label: copy.title },
            ]}
            title={copy.title}
            description={copy.description}
          />
          <TemplateTabs templateId={id} current="theme" />
          <p className="flex flex-wrap items-center gap-3 text-sm text-ink">
            {copy.versionHeading(shown.attributes['version-number'])}
            <VersionStatusBadge status={shown.attributes.status} />
          </p>
          {etag !== null ? (
            <TemplateThemeForm
              templateId={id}
              versionId={shown.id}
              etag={etag}
              themeSets={choices}
              value={value}
              action={saveTemplateTheme}
            />
          ) : (
            <>
              <BuilderThemePanel themeSets={choices} value={value} />
              <p className="text-sm text-ink-muted">{canWrite ? copy.noDraft : copy.readOnly}</p>
            </>
          )}
        </PageMain>
      );
    },
  );
}
