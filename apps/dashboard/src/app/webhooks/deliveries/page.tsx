import type { Metadata } from 'next';
import { DeliverySearch } from '../../../components/integrations/delivery-search';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { renderPage } from '../../../lib/api/page';
import { searchDeliveries } from './actions';

export const metadata: Metadata = { title: 'Search deliveries' };

/** C165.4: the deliveries of every webhook of this environment, found by status, event, webhook and time. */
export default async function DeliverySearchPage() {
  return renderPage({ permissions: ['webhooks:read'] }, () => (
    <PageMain>
      <PageHeader
        title="Search deliveries"
        description="Every webhook's deliveries in this environment, newest first, found by status, event name, webhook and when they last changed."
        breadcrumbs={[{ label: 'Webhooks', href: '/webhooks' }, { label: 'Search deliveries' }]}
      />
      <DeliverySearch action={searchDeliveries} />
    </PageMain>
  ));
}
