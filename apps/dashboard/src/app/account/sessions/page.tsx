import type { Metadata } from 'next';
import { SessionsTable } from '../../../components/operators/sessions-table';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { renderPage } from '../../../lib/api/page';
import { listMySessions } from '../../../lib/api/sessions';
import { SETTINGS_COPY } from '../../../lib/copy/settings';
import { revokeOtherSessions, revokeSession } from './actions';

export const metadata: Metadata = { title: SETTINGS_COPY.sessions.title };

/**
 * C168.4: "my sessions": the operator's own sessions, a device summary each (never the user agent),
 * when it signed in and was last seen, the current one marked; sign out one, or every other.
 */
export default async function SessionsPage() {
  return renderPage({}, async () => {
    const sessions = await listMySessions();
    return (
      <PageMain width="narrow">
        <PageHeader
          title={SETTINGS_COPY.sessions.title}
          description={SETTINGS_COPY.sessions.description}
          breadcrumbs={[
            { label: 'Account security', href: '/account/security' },
            { label: SETTINGS_COPY.sessions.title },
          ]}
        />
        <SessionsTable
          sessions={sessions}
          revoke={revokeSession}
          revokeOthers={revokeOtherSessions}
        />
        <p className="text-sm text-ink-muted">{SETTINGS_COPY.sessions.enrolmentNote}</p>
      </PageMain>
    );
  });
}
