import { API_VERSIONS, idSchema } from '@openverify/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EditWebhookForm } from '../../../../components/integrations/webhook-form';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { eventNameGroups } from '../../../../lib/api/events';
import { renderPage } from '../../../../lib/api/page';
import { updateWebhook } from '../../actions';

export const metadata: Metadata = { title: 'Edit webhook' };

export interface EditWebhookPageProps {
  readonly params: Promise<{ id: string }>;
}

/** Changes a webhook's configuration (C14). An archived webhook cannot change. */
export default async function EditWebhookPage({ params }: EditWebhookPageProps) {
  const { id } = await params;
  if (!idSchema('wbh').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['webhooks:read', 'webhooks:write'] }, async ({ api }) => {
    const { data: webhook } = await api.webhooks.retrieve(id);
    const { attributes } = webhook;
    return (
      <PageMain width="narrow">
        <PageHeader
          title="Edit webhook"
          breadcrumbs={[
            { label: 'Webhooks', href: '/webhooks' },
            { label: attributes.url, href: `/webhooks/${id}` },
            { label: 'Edit' },
          ]}
        />
        {attributes.status === 'archived' ? (
          <p className="text-sm text-ink-muted">
            An archived webhook cannot change. Clone it to reuse its configuration.
          </p>
        ) : (
          <EditWebhookForm
            action={updateWebhook}
            webhookId={id}
            groups={eventNameGroups()}
            apiVersions={API_VERSIONS}
            defaults={{
              url: attributes.url,
              enabledEvents: attributes['enabled-events'],
              apiVersion: attributes['api-version'],
              inquiryTemplateIds: attributes.filters?.['inquiry-template-ids'] ?? [],
              workflowIds: attributes.filters?.['workflow-ids'] ?? [],
              caseTemplateIds: attributes.filters?.['case-template-ids'] ?? [],
              listIds: attributes.filters?.['list-ids'] ?? [],
              accountTypeIds: attributes.filters?.['account-type-ids'] ?? [],
              attributeBlocklist: attributes['attribute-blocklist'] ?? [],
              customHeaderNames: Object.keys(attributes['custom-headers'] ?? {}),
              name: attributes.name ?? null,
              description: attributes.description ?? null,
              failureAlert: attributes['failure-alert'] ?? null,
            }}
          />
        )}
      </PageMain>
    );
  });
}
