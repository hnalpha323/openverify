import { idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConfirmActionButton } from '../../../components/confirm-action-button';
import { PageSection } from '../../../components/lifecycle/page-section';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { RenameThemeSetForm } from '../../../components/themes/rename-theme-set-form';
import { RevisionsTable } from '../../../components/themes/revisions-table';
import { DefaultSetBadge, ThemeSetStatusBadge } from '../../../components/themes/theme-set-badges';
import { ThemeEditor } from '../../../components/themes/theme-editor';
import { previewFlowOrigin } from '../../../components/flow-preview/flow-origin';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { getSettings } from '../../../lib/api/settings';
import { listThemeSetRevisions } from '../../../lib/api/theme-sets';
import { THEMES_COPY } from '../../../lib/copy/themes-copy';
import {
  archiveThemeSet,
  clearDefaultThemeSet,
  duplicateThemeSet,
  makeDefaultThemeSet,
  previewThemeStyles,
  renameThemeSet,
  restoreThemeSetRevision,
  saveThemeStyles,
  uploadThemeAssetAction,
} from '../actions';

const copy = THEMES_COPY.set;

export const metadata: Metadata = { title: copy.metadataTitle };

export interface ThemeSetPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Templates offered for the real-screen preview (ours, provisional: one page). */
const PREVIEW_TEMPLATES = 25;

const beforeOf = (value: string | string[] | undefined): number | undefined =>
  typeof value === 'string' && /^[1-9][0-9]{0,8}$/u.test(value) && Number(value) >= 2
    ? Number(value)
    : undefined;

/**
 * One theme set (C160): its status, the revision flows render, the editor with live contrast, the
 * asset uploads, its revisions with restore, and with the right scopes the default set,
 * duplicating and archiving. An archived set is read-only. Reads `GET /theme-sets/:id` and its
 * revisions with `theme-sets:read`; the organisation's display name with `settings:read` only.
 */
export default async function ThemeSetPage({ params, searchParams }: ThemeSetPageProps) {
  const { id } = await params;
  if (!idSchema('theset').safeParse(id).success) {
    notFound();
  }
  const before = beforeOf((await searchParams).before);
  return renderPage({ permissions: ['theme-sets:read'] }, async ({ session, api }) => {
    const canRead = (permission: Parameters<typeof hasPermission>[1]) =>
      hasPermission(session, permission);
    const [{ data: set }, revisions, settings, templates] = await Promise.all([
      api.themeSets.retrieve(id),
      listThemeSetRevisions(api, id, before),
      canRead('settings:read') ? getSettings() : Promise.resolve(null),
      canRead('inquiry-templates:read')
        ? api.inquiryTemplates.list({ page: { size: PREVIEW_TEMPLATES } })
        : Promise.resolve(null),
    ]);
    const { attributes } = set;
    const active = attributes.status === 'active';
    const canWrite = active && canRead('theme-sets:write');
    const canDefault = active && canRead('settings:write');
    const nextBefore = revisions.data.at(-1)?.attributes.revision;
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[
            { label: THEMES_COPY.list.title, href: '/theme-sets' },
            { label: attributes.name },
          ]}
          title={attributes.name}
          description={
            <span className="flex flex-wrap items-center gap-3">
              <ThemeSetStatusBadge status={attributes.status} />
              {attributes['is-default'] && <DefaultSetBadge />}
              <code className="font-mono text-xs">{set.id}</code>
            </span>
          }
          actions={
            canWrite || canDefault ? (
              <div role="group" aria-label={copy.actionsLabel} className="flex flex-wrap gap-3">
                {canDefault &&
                  (attributes['is-default'] ? (
                    <ConfirmActionButton
                      label={copy.clearDefault}
                      variant="secondary"
                      tone="primary"
                      title={copy.clearDefaultTitle}
                      description={copy.clearDefaultBody}
                      confirmLabel={copy.clearDefault}
                      action={clearDefaultThemeSet}
                      fields={{ 'theme-set-id': set.id }}
                      successMessage={copy.clearedDefault}
                    />
                  ) : (
                    <ConfirmActionButton
                      label={copy.makeDefault}
                      variant="secondary"
                      tone="primary"
                      title={copy.makeDefaultTitle}
                      description={copy.makeDefaultBody}
                      confirmLabel={copy.makeDefault}
                      action={makeDefaultThemeSet}
                      fields={{ 'theme-set-id': set.id }}
                      successMessage={copy.madeDefault}
                    />
                  ))}
                {canWrite && (
                  <ConfirmActionButton
                    label={copy.duplicate}
                    variant="secondary"
                    tone="primary"
                    title={copy.duplicateTitle}
                    description={copy.duplicateBody}
                    confirmLabel={copy.duplicate}
                    action={duplicateThemeSet}
                    fields={{ 'theme-set-id': set.id }}
                    successMessage={copy.duplicated}
                  />
                )}
                {canWrite && (
                  <ConfirmActionButton
                    label={copy.archive}
                    variant="secondary"
                    title={copy.archiveTitle}
                    description={copy.archiveBody}
                    confirmLabel={copy.archive}
                    action={archiveThemeSet}
                    fields={{ 'theme-set-id': set.id }}
                    successMessage={copy.archived}
                  />
                )}
              </div>
            ) : undefined
          }
        />
        <p className="text-sm text-ink">{copy.revisionLine(attributes.revision)}</p>
        {!active && <p className="text-sm text-ink">{copy.archivedNote}</p>}
        {canWrite && (
          <RenameThemeSetForm themeSetId={set.id} name={attributes.name} action={renameThemeSet} />
        )}
        <PageSection id="theme-set-styles" title={THEMES_COPY.editor.heading}>
          <ThemeEditor
            themeSetId={set.id}
            styles={attributes.styles}
            organizationName={settings?.['organization-display-name'] ?? null}
            {...(templates === null
              ? {}
              : {
                  preview: {
                    flowOrigin: previewFlowOrigin(),
                    templates: templates.data.map((template) => ({
                      id: template.id,
                      name: template.attributes.name,
                      versionId: template.attributes['current-version'].id,
                    })),
                    action: previewThemeStyles,
                  },
                })}
            {...(canWrite
              ? { saveAction: saveThemeStyles, uploadAction: uploadThemeAssetAction }
              : {})}
          />
        </PageSection>
        <PageSection
          id="theme-set-revisions"
          title={THEMES_COPY.revisions.heading}
          description={THEMES_COPY.revisions.description}
        >
          <RevisionsTable
            themeSetId={set.id}
            revisions={revisions.data}
            current={attributes.revision}
            {...(canWrite ? { restoreAction: restoreThemeSetRevision } : {})}
          />
          {revisions.links.next !== null && nextBefore !== undefined && nextBefore >= 2 && (
            <a
              href={`/theme-sets/${set.id}?before=${String(nextBefore)}`}
              className="text-sm underline"
            >
              {THEMES_COPY.revisions.older}
            </a>
          )}
        </PageSection>
      </PageMain>
    );
  });
}
