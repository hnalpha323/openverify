import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import { EmptyState } from '../../components/empty-state';
import { InquiriesTable } from '../../components/inquiries-table';
import { InquiryFilters } from '../../components/inquiry-filters';
import { inquirySummary } from '../../components/lifecycle/inquiry-summary';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { listInquiries } from '../../lib/api/inquiries';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import {
  hasInquiryFilters,
  inquiryFilterQuery,
  parseInquiryListQuery,
} from '../../lib/inquiry-query';
import { cursorFromNextLink } from '../../lib/list-query';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Inquiries' };

export interface InquiriesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The session environment's inquiries, newest first, with filters for status, tags, account,
 * reference ID and creation range, all kept in the URL (C23), and cursor paging.
 */
export default async function InquiriesPage({ searchParams }: InquiriesPageProps) {
  const query = parseInquiryListQuery(await searchParams);
  return renderPage({ permissions: ['inquiries:read'] }, async ({ session }) => {
    const header = (
      <PageHeader
        title="Inquiries"
        description="Every verification request in this environment, newest first."
      />
    );
    const filters = (
      <InquiryFilters
        values={query.values}
        statuses={query.selected.statuses}
        errors={query.errors}
        canFilterByStep={hasPermission(session, 'pii:view')}
      />
    );
    if (Object.keys(query.errors).length > 0) {
      return (
        <PageMain>
          {header}
          {filters}
          <Alert tone="warning" title="Check the filters">
            Some values cannot be used. Correct them to see the inquiries.
          </Alert>
        </PageMain>
      );
    }

    const page = await listInquiries(query.filters, query.after);
    const filtered = hasInquiryFilters(query.filters);
    return (
      <PageMain>
        {header}
        {filters}
        <SavedViewsSlot list="inquiries" />
        {page.data.length === 0 && !filtered && query.after === undefined ? (
          <EmptyState title="No inquiries yet">
            Inquiries appear here once your backend creates them with the API.
          </EmptyState>
        ) : (
          <InquiriesTable
            inquiries={page.data.map(inquirySummary)}
            linkAccounts={hasPermission(session, 'accounts:read')}
            emptyMessage={filtered ? 'No inquiries match these filters.' : 'No more inquiries.'}
          />
        )}
        <Pagination
          path="/inquiries"
          query={inquiryFilterQuery(query.filters)}
          after={query.after}
          nextCursor={cursorFromNextLink(page.links.next, 'inq')}
        />
      </PageMain>
    );
  });
}
