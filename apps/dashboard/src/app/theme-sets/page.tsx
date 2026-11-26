import { themeSetStatusSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { EmptyState } from '../../components/empty-state';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { CreateThemeSetForm } from '../../components/themes/create-theme-set-form';
import { ThemeSetFilters } from '../../components/themes/theme-set-filters';
import { ThemeSetsTable } from '../../components/themes/theme-sets-table';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { listThemeSets } from '../../lib/api/theme-sets';
import { THEMES_COPY } from '../../lib/copy/themes-copy';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
import { createThemeSet } from './actions';

export const metadata: Metadata = { title: THEMES_COPY.list.title };

export interface ThemeSetsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const copy = THEMES_COPY.list;

/**
 * The environment's theme sets (C160.1), newest first as the API orders them, filtered by status in
 * the URL (C23), with cursor paging; creating one with `theme-sets:write`. Reads `GET /theme-sets`
 * with `theme-sets:read`. A filter value the API would refuse is left out.
 */
export default async function ThemeSetsPage({ searchParams }: ThemeSetsPageProps) {
  const params = await searchParams;
  const status = themeSetStatusSchema.safeParse(params.status).data;
  const after = parseCursor(params.after, 'theset');
  return renderPage({ permissions: ['theme-sets:read'] }, async ({ session, api }) => {
    const page = await listThemeSets(api, { status }, after);
    const filtered = status !== undefined;
    return (
      <PageMain className="gap-8">
        <PageHeader title={copy.title} description={copy.description} />
        <p className="text-sm text-ink-muted">{copy.builtInNote}</p>
        <ThemeSetFilters status={status} />
        {page.data.length === 0 && !filtered && after === undefined ? (
          <EmptyState title={copy.emptyTitle}>{copy.emptyBody}</EmptyState>
        ) : (
          <ThemeSetsTable
            sets={page.data}
            emptyMessage={filtered ? copy.emptyFiltered : copy.emptyMore}
          />
        )}
        <Pagination
          path="/theme-sets"
          query={{ status }}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'theset')}
        />
        {hasPermission(session, 'theme-sets:write') && (
          <CreateThemeSetForm environmentId={session.environment.id} action={createThemeSet} />
        )}
      </PageMain>
    );
  });
}
