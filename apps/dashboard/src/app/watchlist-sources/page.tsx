import type { Metadata } from 'next';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { WatchlistSourcesView } from '../../components/report-config/watchlist-sources-view';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { getWatchlistSources } from './watchlist-sources';

export const metadata: Metadata = { title: 'Watchlist sources' };

/**
 * C72.3, C76, C86: the read-only watchlist sources page (`watchlists:read`, as its API route).
 * The operator changes the lists with `watchlists:sync`, `pep:sync` and `watchlists:rekey`, never
 * from the console.
 */
export default async function WatchlistSourcesPage() {
  return renderPage({ permissions: ['watchlists:read'] }, async ({ session }) => {
    const sources = await getWatchlistSources();
    return (
      <PageMain className="gap-8">
        <PageHeader
          title="Watchlist sources"
          description="The sanctions and PEP lists reports screen, as the API reports them. Read-only: the operator syncs them with watchlists:sync and pep:sync, and re-keys them with watchlists:rekey."
        />
        <WatchlistSourcesView
          sources={sources}
          canReadTemplates={hasPermission(session, 'report-templates:read')}
          environmentKind={session.environment.kind}
        />
      </PageMain>
    );
  });
}
