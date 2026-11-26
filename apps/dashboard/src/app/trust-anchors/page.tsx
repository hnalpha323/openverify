import type { Metadata } from 'next';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { TrustStoreView } from '../../components/trust-store/trust-store-view';
import { renderPage } from '../../lib/api/page';
import { getTrustAnchors } from './trust-anchors';

export const metadata: Metadata = { title: 'Chip trust store' };

/**
 * C62.10, C66: the read-only chip trust store (`settings:read`, as its API route): the country
 * signing CAs NFC passive authentication trusts, their sources and syncs, the withdrawn anchors,
 * the CRLs' freshness and the sandbox anchors. The operator changes the store with
 * `trust-anchors:sync`, never from the console.
 */
export default async function TrustAnchorsPage() {
  return renderPage({ permissions: ['settings:read'] }, async () => {
    const store = await getTrustAnchors();
    return (
      <PageMain className="gap-8">
        <PageHeader
          title="Chip trust store"
          description="The country signing CAs that NFC passive authentication trusts, as the API reports them. Read-only: the operator syncs the store with trust-anchors:sync."
        />
        <TrustStoreView store={store} />
      </PageMain>
    );
  });
}
