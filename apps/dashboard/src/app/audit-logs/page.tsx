import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import { AuditIpSearch } from '../../components/operators/audit-ip-search';
import { AuditLogFiltersForm } from '../../components/operators/audit-log-filters';
import {
  auditLogFilterQuery,
  parseAuditLogQuery,
} from '../../components/operators/audit-log-query';
import { AuditLogTable } from '../../components/operators/audit-log-table';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { listAuditLogs } from '../../lib/api/audit-logs';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { searchAuditLogsByIp } from './actions';
import { userDirectory } from '../../lib/api/users';
import { cursorFromNextLink } from '../../lib/list-query';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Audit logs' };

export interface AuditLogsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The session environment's audit log (C15, C23), newest first: every change, sign-in, MFA
 * change, environment switch and file view. Filters and the cursor live in the URL; a filter the
 * API could not use is explained instead of sent.
 */
export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const query = parseAuditLogQuery(await searchParams);
  const filtered = Object.keys(query.filters).length > 0;

  return renderPage({ permissions: ['audit-logs:read'] }, async ({ session }) => {
    const header = (
      <>
        <PageHeader
          title="Audit logs"
          description="Who changed what in this environment, newest first. Entries cannot be edited or deleted."
        />
        <AuditLogFiltersForm filters={query.filters} errors={query.errors} />
        {/* C168.6: an address is searched by post with pii:view, never through the URL. */}
        {hasPermission(session, 'pii:view') ? (
          <AuditIpSearch action={searchAuditLogsByIp} />
        ) : (
          <p className="text-sm text-ink-muted">{SETTINGS_COPY.audit.ipNeedsPii}</p>
        )}
      </>
    );
    if (Object.keys(query.errors).length > 0) {
      return (
        <PageMain>
          {header}
          <Alert tone="error" title="Fix the filters to see entries.">
            Each filter that cannot be used says why.
          </Alert>
        </PageMain>
      );
    }
    const page = await listAuditLogs(query.api);
    // Users are named when the operator may read them; otherwise they show by ID.
    const directory =
      hasPermission(session, 'users:read') &&
      page.data.some((entry) => entry.attributes.actor.type === 'user')
        ? await userDirectory()
        : null;
    return (
      <PageMain>
        {header}
        <SavedViewsSlot list="audit-logs" />
        <AuditLogTable
          entries={page.data}
          directory={directory}
          masked={!hasPermission(session, 'pii:view')}
          emptyMessage={
            filtered ? 'No audit entries match these filters.' : 'No audit entries yet.'
          }
        />
        <Pagination
          path="/audit-logs"
          query={auditLogFilterQuery(query.filters)}
          after={query.api.after}
          nextCursor={cursorFromNextLink(page.links.next, 'aud')}
        />
      </PageMain>
    );
  });
}
