import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NOTIFICATION_KIND_WORDS } from '../../../components/cases/case-words';
import { NotificationReadButton } from '../../../components/cases/notification-read-button';
import { DataTable } from '../../../components/data-table';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Timestamp, formatUtc } from '../../../components/timestamp';
import { renderPage } from '../../../lib/api/page';
import { listNotifications } from '../../../lib/api/notifications';
import { cursorFromNextLink, parseCursor } from '../../../lib/list-query';
import { markNotificationRead } from '../actions';

export const metadata: Metadata = { title: 'Notifications' };

export interface NotificationsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The operator's case notifications (C134.4, C142.1): a case assigned to them, a case of theirs past
 * its SLA deadline, and a mention, each with its case and nothing of its content (no comment text, no
 * field). Unread ones are marked read one at a time. Reads `GET /dashboard/notifications` with
 * `cases:read`; a notification of a case the operator can no longer see is left out by the API.
 */
export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const unread = params.unread === 'true';
  const after = parseCursor(params.after, 'unot');
  return renderPage({ permissions: ['cases:read'] }, async () => {
    const page = await listNotifications({ unread, after });
    return (
      <PageMain>
        <PageHeader
          breadcrumbs={[{ label: 'Cases', href: '/cases' }, { label: 'Notifications' }]}
          title="Notifications"
          description="Cases assigned to you, cases of yours past their SLA deadline, and comments that mention you. Kept 90 days; no email is sent yet."
          actions={
            unread ? (
              <Link href="/cases/notifications" className={LINK_CLASS}>
                Every notification
              </Link>
            ) : (
              <Link href="/cases/notifications?unread=true" className={LINK_CLASS}>
                Unread only
              </Link>
            )
          }
        />
        <DataTable
          caption="Notifications"
          captionHidden
          rows={page.data}
          getRowKey={(notification) => notification.id}
          emptyMessage={unread ? 'No unread notifications.' : 'No notifications.'}
          columns={[
            {
              id: 'kind',
              header: 'What happened',
              rowHeader: true,
              cell: (notification) => NOTIFICATION_KIND_WORDS[notification.attributes.kind],
            },
            {
              id: 'case',
              header: 'Case',
              cell: (notification) => {
                // C169.7 (Workflow 9B): a webhook failure names its webhook, not a case.
                const caseId = notification.relationships.case?.data.id;
                return caseId === undefined ? (
                  (notification.relationships.webhook?.data.id ?? '')
                ) : (
                  <Link href={`/cases/${caseId}`} className={LINK_CLASS}>
                    {caseId}
                  </Link>
                );
              },
            },
            {
              id: 'when',
              header: 'When (UTC)',
              cell: (notification) => <Timestamp value={notification.attributes['created-at']} />,
            },
            {
              id: 'read',
              header: 'Read',
              cell: (notification) => {
                const readAt = notification.attributes['read-at'];
                return readAt === null ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span>Unread</span>
                    <NotificationReadButton
                      notificationId={notification.id}
                      label={`${NOTIFICATION_KIND_WORDS[notification.attributes.kind]}, ${notification.relationships.case?.data.id ?? notification.relationships.webhook?.data.id ?? ''}`}
                      action={markNotificationRead}
                    />
                  </span>
                ) : (
                  `Read ${formatUtc(readAt)}`
                );
              },
            },
          ]}
        />
        <Pagination
          path="/cases/notifications"
          query={{ unread: unread ? 'true' : undefined }}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'unot')}
        />
      </PageMain>
    );
  });
}
