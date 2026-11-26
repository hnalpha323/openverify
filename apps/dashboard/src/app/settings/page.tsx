import type { Metadata } from 'next';
import Link from 'next/link';
import { CONNECT_SETTINGS_PATH } from '../../components/connect/connections-table';
import { LINK_CLASS } from '../../components/link-styles';
import { CollectionChanges } from '../../components/operators/collection-changes';
import { SettingsForm } from '../../components/operators/settings-form';
import { SettingsView } from '../../components/operators/settings-view';
import { OptionalSection } from '../../components/lifecycle/optional-section';
import { loadSection } from '../../components/lifecycle/section-data';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { QueuePanel } from '../../components/quotas/queue-panel';
import { listSettingsChanges } from '../../lib/api/audit-logs';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { getSettings } from '../../lib/api/settings';
import { saveSettings } from './actions';
import { SSO_SETTINGS_PATH } from './security/sso/sso-form-input';

export const metadata: Metadata = { title: 'Settings' };

/**
 * The organization's `require-mfa`, and the retention and Phase 7 settings of the session's
 * environment (C15, C16, C23, C107.7). The environment is the one the banner names; switching it
 * shows the other's. With `audit-logs:read`, the trail of collection tier changes follows.
 */
export default async function SettingsPage() {
  return renderPage({ permissions: ['settings:read'] }, async ({ session }) => {
    const settings = await getSettings();
    const environment = session.environment.kind;
    // C107.7: only a server that reports the collection tiers has a trail of them.
    const trail = await loadSection(
      settings['signal-collection'] !== undefined && hasPermission(session, 'audit-logs:read'),
      async () => (await listSettingsChanges(session.environment.id)).data,
    );
    return (
      <PageMain width="narrow">
        <PageHeader
          title="Settings"
          description="Who must use a second factor, how long this environment keeps its data, and what it collects."
          // C242.1 (Workflow 11A console-connect, a named borrowed edit): Settings → Connect.
          // C248.3 (Workflow 11B sso-oidc, a named borrowed edit): Settings → Security → SSO.
          actions={
            <div className="flex flex-wrap gap-4">
              <Link href={SSO_SETTINGS_PATH} className={LINK_CLASS}>
                Single sign-on
              </Link>
              {hasPermission(session, 'connect-connections:read') && (
                <Link href={CONNECT_SETTINGS_PATH} className={LINK_CLASS}>
                  Connect settings
                </Link>
              )}
            </div>
          }
        />
        {hasPermission(session, 'settings:write') ? (
          <SettingsForm
            settings={settings}
            environment={environment}
            environmentId={session.environment.id}
            canPrivacy={hasPermission(session, 'settings:privacy')}
            timeZones={Intl.supportedValuesOf('timeZone')}
            action={saveSettings}
          />
        ) : (
          <SettingsView
            settings={settings}
            environment={environment}
            canPrivacy={hasPermission(session, 'settings:privacy')}
          />
        )}
        {/* C251.3 (Workflow 11B quotas, a named borrowed edit): in flight against cap per queue. */}
        <QueuePanel settings={settings} environment={environment} />
        <OptionalSection
          id="settings-collection-changes"
          title="Collection tier changes"
          description="Who changed what the flow collects, and when, from the audit log."
          data={trail}
        >
          {(entries) => <CollectionChanges entries={entries} />}
        </OptionalSection>
      </PageMain>
    );
  });
}
