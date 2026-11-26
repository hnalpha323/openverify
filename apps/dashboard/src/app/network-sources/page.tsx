import type { Metadata } from 'next';
import { NetworkSourcesView } from '../../components/network/network-sources-view';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { renderPage } from '../../lib/api/page';
import { getNetworkSources } from './network-sources';

export const metadata: Metadata = { title: 'Network sources' };

/**
 * C92, C108: the read-only network sources page (`settings:read`, as its API route). The operator
 * syncs the sources with `network:sync`, never from the console.
 */
export default async function NetworkSourcesPage() {
  return renderPage({ permissions: ['settings:read'] }, async () => {
    const sources = await getNetworkSources();
    return (
      <PageMain className="gap-8">
        <PageHeader
          title="Network sources"
          description="The IP geolocation, network, Tor exit and cloud range data the API reads, as it reports them. Read-only: the operator syncs it with network:sync."
        />
        <NetworkSourcesView sources={sources} />
      </PageMain>
    );
  });
}
