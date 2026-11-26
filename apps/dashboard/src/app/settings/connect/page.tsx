import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@openverify/ui';
import { listConnections, type ConnectionsPage } from '../../../components/connect/connect-api';
import { ConnectSettingsForm } from '../../../components/connect/connect-settings-form';
import {
  CONNECT_SETTINGS_PATH,
  ConnectionsTable,
} from '../../../components/connect/connections-table';
import { PageSection } from '../../../components/lifecycle/page-section';
import { LINK_CLASS } from '../../../components/link-styles';
import { ENVIRONMENT_NAMES } from '../../../components/operators/settings-fields';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { classifyApiError } from '../../../lib/api/errors';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { getSettings } from '../../../lib/api/settings';
import { parseCursor } from '../../../lib/list-query';
import { saveConnectSettings } from './actions';

export const metadata: Metadata = { title: 'Connect' };

export interface ConnectSettingsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The connections, or `null` when the installation's switch is off: every Connect route then
 * answers the one generic 404 (C231.10), which here means "off", never "missing".
 */
async function connectionsOrOff(after: string | undefined): Promise<ConnectionsPage | null> {
  try {
    return await listConnections(after);
  } catch (error) {
    if (classifyApiError(error) === 'not-found') {
      return null;
    }
    throw error;
  }
}

/**
 * Settings → Connect (C242.1): Connect's settings (the organisation's opt-in, the environment's
 * longest token life and consent proof retention) and the connections in both directions, each with
 * its status, counterparty and policy version. Inbound connections are the ones this organisation
 * receives; outbound ones (and a self-connection) are the ones it shares through.
 */
export default async function ConnectSettingsPage({ searchParams }: ConnectSettingsPageProps) {
  const after = parseCursor((await searchParams).after, 'cxn');
  return renderPage({ permissions: ['connect-connections:read'] }, async ({ session }) => {
    const [page, settings] = await Promise.all([
      connectionsOrOff(after),
      hasPermission(session, 'settings:read') ? getSettings() : Promise.resolve(null),
    ]);
    const inbound = page?.connections.filter((each) => each.attributes.direction === 'inbound');
    const outbound = page?.connections.filter((each) => each.attributes.direction !== 'inbound');
    return (
      <PageMain className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Connect' }]}
          title="Connect"
          description="Share a verified person’s data with another organization on this installation, and receive theirs. Every share rests on a consent record."
          actions={
            hasPermission(session, 'connect-share-tokens:read') ? (
              <Link href={`${CONNECT_SETTINGS_PATH}/share-tokens`} className={LINK_CLASS}>
                Share tokens
              </Link>
            ) : undefined
          }
        />
        {page === null && (
          <Alert tone="info" title="Connect is off on this installation">
            The installation’s operator has not turned Connect on, so no connection, share token or
            consent record exists here. The settings below still apply once it is on.
          </Alert>
        )}
        {settings !== null && (
          <PageSection id="connect-settings" title="Settings">
            <ConnectSettingsForm
              settings={settings}
              canWrite={hasPermission(session, 'settings:write')}
              environmentId={session.environment.id}
              environmentName={ENVIRONMENT_NAMES[session.environment.kind]}
              action={saveConnectSettings}
            />
          </PageSection>
        )}
        {page !== null && (
          <>
            <ConnectionsTable
              caption="Inbound connections"
              connections={inbound ?? []}
              emptyMessage="No inbound connection yet."
            />
            <ConnectionsTable
              caption="Outbound connections"
              connections={outbound ?? []}
              emptyMessage="No outbound connection yet. A connection is created through the API by the organization that shares."
            />
            {page.next !== null && (
              <Link
                href={`${CONNECT_SETTINGS_PATH}?after=${encodeURIComponent(page.next)}`}
                className={LINK_CLASS}
              >
                Next connections
              </Link>
            )}
          </>
        )}
      </PageMain>
    );
  });
}
