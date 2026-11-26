import { idSchema } from '@openverify/contracts';
import {
  EXPORT_LIMITS,
  EXPORT_OBJECT_TYPES,
  EXPORT_PERMISSIONS,
  type ExportObjectType,
} from '@openverify/core';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ExportList } from '../../components/analytics/export-list';
import { NewExportForm } from '../../components/analytics/new-export-form';
import { ForbiddenPanel } from '../../components/forbidden-panel';
import { PageSection } from '../../components/lifecycle/page-section';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { listExports } from '../../lib/api/exports';
import { hasPermission } from '../../lib/api/me';
import { listSavedViews } from '../../lib/api/saved-views';
import { renderPage } from '../../lib/api/page';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
import { createExportAction } from './actions';

export const metadata: Metadata = { title: 'Exports' };

export interface ExportsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const COPY = ANALYTICS_COPY.exports;

/** The types a saved view can be exported from (their lists have saved views, C165.1). */
const VIEW_TYPES: ReadonlySet<ExportObjectType> = new Set([
  'inquiries',
  'accounts',
  'reports',
  'transactions',
]);

/** `?view=svw_…&type=inquiries`: a saved view chosen on its list page, by id only. */
function chosenView(
  params: Record<string, string | string[] | undefined>,
): { id: string; type: 'inquiries' | 'accounts' | 'reports' | 'transactions' } | undefined {
  const { view, type } = params;
  return typeof view === 'string' &&
    idSchema('svw').safeParse(view).success &&
    typeof type === 'string' &&
    VIEW_TYPES.has(type as ExportObjectType)
    ? { id: view, type: type as 'inquiries' }
    : undefined;
}

/**
 * The caller's exports (C166.1, C166.6): each with its type, state, the filter's shape, when it was
 * cut, its row count and whether personal data was included, and its download while kept. Only the
 * creator lists, reads and downloads an export; a reader holding no `:export` permission sees which
 * would let them export.
 */
export default async function ExportsPage({ searchParams }: ExportsPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const after = parseCursor(params.after, 'exp');
  const chosen = chosenView(params);
  return renderPage({}, async ({ session }) => {
    const exportable = Object.values(EXPORT_PERMISSIONS).filter((permission) =>
      session.permissions.has(permission),
    );
    if (exportable.length === 0) {
      return (
        <PageMain width="narrow">
          <ForbiddenPanel headingLevel={1} />
          <p className="text-sm text-ink-muted">
            {fillCopy(COPY.noPermission, {
              permissions: Object.values(EXPORT_PERMISSIONS).join(', '),
            })}
          </p>
        </PageMain>
      );
    }
    const types = EXPORT_OBJECT_TYPES.filter((type) =>
      session.permissions.has(EXPORT_PERMISSIONS[type]),
    );
    const [page, savedView] = await Promise.all([
      listExports(after),
      chosen !== undefined && types.includes(chosen.type)
        ? listSavedViews(chosen.type).then((views) => {
            const view = views.data.find((each) => each.id === chosen.id);
            return view === undefined
              ? undefined
              : { id: view.id, name: view.attributes.name, type: chosen.type };
          })
        : Promise.resolve(undefined),
    ]);
    return (
      <PageMain className="gap-8">
        <PageHeader title={COPY.title} description={COPY.description} />
        <PageSection id="export-new" title={COPY.newTitle}>
          <NewExportForm
            environmentId={session.environment.id}
            types={types}
            canIncludePersonalData={hasPermission(session, 'pii:view')}
            {...(savedView === undefined ? {} : { savedView })}
            action={createExportAction}
          />
        </PageSection>
        <PageSection id="export-list" title={COPY.listTitle}>
          <p className="text-sm text-ink-muted">{COPY.redactionNote}</p>
          <p className="text-sm text-ink-muted">
            {fillCopy(COPY.tooLarge, { rows: EXPORT_LIMITS.rows.toLocaleString('en-US') })}
          </p>
          <ExportList exports={page.data} />
          <Pagination
            path="/exports"
            query={{}}
            after={after}
            nextCursor={cursorFromNextLink(page.links.next, 'exp')}
          />
        </PageSection>
      </PageMain>
    );
  });
}
