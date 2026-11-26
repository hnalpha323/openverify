import { API_VERSIONS } from '@openverify/contracts';
import type { Metadata } from 'next';
import { CreateWebhookForm } from '../../../components/integrations/webhook-form';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { eventNameGroups } from '../../../lib/api/events';
import { renderPage } from '../../../lib/api/page';
import { createWebhook } from '../actions';

export const metadata: Metadata = { title: 'New webhook' };

/** Adds a webhook (C14); its signing secret is shown once. */
export default async function NewWebhookPage() {
  return renderPage({ permissions: ['webhooks:read', 'webhooks:write'] }, ({ session }) => (
    <PageMain width="narrow">
      <PageHeader
        title="New webhook"
        description="OpenVerify signs every delivery, retries failures for up to 24 hours, and never follows redirects."
        breadcrumbs={[{ label: 'Webhooks', href: '/webhooks' }, { label: 'New webhook' }]}
      />
      <CreateWebhookForm
        action={createWebhook}
        groups={eventNameGroups()}
        apiVersions={API_VERSIONS}
        environmentId={session.environment.id}
      />
    </PageMain>
  ));
}
