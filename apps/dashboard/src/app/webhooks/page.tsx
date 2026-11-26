import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '../../components/empty-state';
import { PRIMARY_LINK_BUTTON } from '../../components/integrations/link-button';
import { WebhooksTable } from '../../components/integrations/webhook-tables';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { listWebhooks } from '../../lib/api/webhooks';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'Webhooks' };

export interface WebhooksPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The environment's webhooks (C14), with a way to add one for `webhooks:write`. */
export default async function WebhooksPage({ searchParams }: WebhooksPageProps) {
  const after = parseCursor((await searchParams).after, 'wbh');
  return renderPage({ permissions: ['webhooks:read'] }, async ({ api, session }) => {
    const page = await listWebhooks(api, after);
    const canWrite = hasPermission(session, 'webhooks:write');
    return (
      <PageMain>
        <PageHeader
          title="Webhooks"
          description="Endpoints OpenVerify sends this environment's events to, signed with their secret."
          {...(canWrite
            ? {
                actions: (
                  <Link href="/webhooks/new" className={PRIMARY_LINK_BUTTON}>
                    New webhook
                  </Link>
                ),
              }
            : {})}
        />
        {/* C165.4: every webhook's deliveries, found by status, event, webhook and time. */}
        <p className="text-sm">
          <Link href="/webhooks/deliveries" className={LINK_CLASS}>
            Search deliveries
          </Link>
        </p>
        {page.data.length === 0 && after === undefined ? (
          <EmptyState
            title="No webhooks yet"
            {...(canWrite
              ? {
                  action: (
                    <Link href="/webhooks/new" className={PRIMARY_LINK_BUTTON}>
                      Add a webhook
                    </Link>
                  ),
                }
              : {})}
          >
            A webhook tells your systems when an inquiry, a verification or an account changes.
          </EmptyState>
        ) : (
          <WebhooksTable webhooks={page.data} />
        )}
        <Pagination
          path="/webhooks"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'wbh')}
        />
      </PageMain>
    );
  });
}
