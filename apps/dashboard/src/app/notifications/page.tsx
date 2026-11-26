import type { Metadata } from 'next';
import { NotificationPreferencesForm } from '../../components/operators/notification-preferences-form';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { getNotificationPreferences } from '../../lib/api/notifications';
import { renderPage } from '../../lib/api/page';
import { SETTINGS_COPY } from '../../lib/copy/settings';
import { saveNotificationPreferences } from './actions';

export const metadata: Metadata = { title: SETTINGS_COPY.notifications.title };

/**
 * C169.7: the operator's own notification channels, per kind, console and email. A session needs
 * no permission for its own choices; the header's "Notification settings" link opens it.
 */
export default async function NotificationsPage() {
  return renderPage({}, async () => {
    const preferences = await getNotificationPreferences();
    return (
      <PageMain width="narrow">
        <PageHeader
          title={SETTINGS_COPY.notifications.title}
          description={SETTINGS_COPY.notifications.description}
        />
        <NotificationPreferencesForm
          preferences={preferences}
          action={saveNotificationPreferences}
        />
      </PageMain>
    );
  });
}
