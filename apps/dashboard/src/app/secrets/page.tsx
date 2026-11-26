import type { Metadata } from 'next';
import { PageSection } from '../../components/lifecycle/page-section';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { CreateSecretForm } from '../../components/workflows/secret-forms';
import { SecretsTable } from '../../components/workflows/secrets-table';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { createSecret, deleteSecret, setSecretValue, updateSecret } from './actions';

export const metadata: Metadata = { title: 'Secrets' };

/** Secrets shown at once: the API caps an organisation well below this in practice. */
const SECRET_PAGE_SIZE = 100;

/**
 * The workflow secrets of the session's environment (C125, C141.7), read with `secrets:read`: keys,
 * descriptions, allowed hosts and the last four of this environment's value, never a value. With
 * `secrets:write`, a key is created, its value set or rotated here, and the key deleted.
 */
export default async function SecretsPage() {
  return renderPage({ permissions: ['secrets:read'] }, async ({ session, api }) => {
    const secrets = await api.workflowSecrets.list({ page: { size: SECRET_PAGE_SIZE } });
    const canWrite = hasPermission(session, 'secrets:write');
    return (
      <PageMain className="gap-8">
        <PageHeader
          title="Secrets"
          description="Credentials workflow steps send to the hosts you allow. A value is set per environment and never shown again; only its last four characters are."
        />
        <SecretsTable
          secrets={secrets.data}
          actions={
            canWrite
              ? { setValue: setSecretValue, remove: deleteSecret, edit: updateSecret }
              : undefined
          }
        />
        {canWrite && (
          <PageSection id="new-secret" title="New secret">
            <CreateSecretForm environmentId={session.environment.id} action={createSecret} />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
