import { API_VERSIONS } from '@openverify/contracts';
import type { Metadata } from 'next';
import { CreateApiKeyForm } from '../../../components/integrations/api-key-form';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { grantableScopes } from '../../../lib/api/api-keys';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { createApiKey } from '../actions';

export const metadata: Metadata = { title: 'New API key' };

/**
 * Creates an API key (C12) with the scopes the operator's role holds; the API refuses any other.
 * A key made by a role without `pii:view` sees personal data masked, as its maker does.
 */
export default async function NewApiKeyPage() {
  return renderPage({ permissions: ['api-keys:read', 'api-keys:write'] }, ({ session }) => (
    <PageMain width="narrow">
      <PageHeader
        title="New API key"
        breadcrumbs={[{ label: 'API keys', href: '/api-keys' }, { label: 'New API key' }]}
      />
      <CreateApiKeyForm
        action={createApiKey}
        scopes={grantableScopes(session.permissions)}
        apiVersions={API_VERSIONS}
        piiMasked={!hasPermission(session, 'pii:view')}
        environmentId={session.environment.id}
      />
    </PageMain>
  ));
}
