import type { SsoProviderResource } from '@openverify/contracts';
import { Alert, Button } from '@openverify/ui';
import type { Metadata } from 'next';
import { DataTable } from '../../../../components/data-table';
import { PageSection } from '../../../../components/lifecycle/page-section';
import { PageHeader } from '../../../../components/page-header';
import { PageMain } from '../../../../components/page-main';
import { hasPermission } from '../../../../lib/api/me';
import { renderPage } from '../../../../lib/api/page';
import { listAllRoles } from '../../../../lib/api/roles';
import { getSettings } from '../../../../lib/api/settings';
import { stepUpWithSso } from '../../../(auth)/sso/actions';
import {
  createSsoProviderAction,
  deleteSsoProviderAction,
  saveSignInName,
  updateSsoProviderAction,
} from './actions';
import {
  DeleteSsoProviderForm,
  SignInNameForm,
  SsoProviderForm,
  type SsoProviderView,
} from './sso-forms';
import { SSO_SETTINGS_PATH } from './sso-form-input';
import { listSsoProviders } from './sso-providers-api';

export const metadata: Metadata = { title: 'Single sign-on' };

/** A provider as the page passes it to its forms: never its secret (the API serves none). */
function viewOf(provider: SsoProviderResource): SsoProviderView {
  const a = provider.attributes;
  return {
    id: provider.id,
    displayName: a['display-name'],
    issuer: a.issuer,
    clientId: a['client-id'],
    secretSet: a['client-secret-set'],
    domains: a['allowed-email-domains'],
    tenantPin: a['tenant-pin'],
    amr: a['required-amr'],
    acr: a['required-acr'],
    jit: a['jit-provisioning'],
    roleIds: a['default-role-ids'],
    enforced: a.enforced,
  };
}

/**
 * Settings → Security → Single sign-on (C248.3, C248.8): the organisation's sign-in name and its
 * OpenID Connect identity providers. The providers are the organisation's, so changing them needs
 * `settings:write` held through an organisation-wide assignment and a second factor checked in the
 * last 10 minutes; the API answers 403 otherwise.
 */
export default async function SsoSettingsPage() {
  return renderPage({ permissions: ['settings:read'] }, async ({ session }) => {
    const canWrite = hasPermission(session, 'settings:write');
    const [settings, providers, roles] = await Promise.all([
      getSettings(),
      listSsoProviders(),
      canWrite ? listAllRoles() : Promise.resolve([]),
    ]);
    const slug = settings['organization-slug'] ?? null;
    const roleChoices = roles.map((role) => ({ id: role.id, name: role.attributes.name }));
    const environmentId = session.environment.id;
    return (
      <PageMain width="narrow" className="gap-8">
        <PageHeader
          breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Single sign-on' }]}
          title="Single sign-on"
          description="Let your organization’s users sign in through your OpenID Connect identity provider. OpenVerify is tested against Okta-, Entra- and Google-shaped providers it serves in its tests; your own identity provider is yours to verify."
        />
        {canWrite && (
          <form action={stepUpWithSso} className="flex flex-col items-start gap-2">
            <input type="hidden" name="return-to" value={SSO_SETTINGS_PATH} />
            <p className="text-sm text-ink-muted">
              Changing a provider needs a second factor checked in the last 10 minutes. If you sign
              in with single sign-on, confirm it is you at your identity provider.
            </p>
            <Button type="submit" variant="secondary">
              Re-authenticate with single sign-on
            </Button>
          </form>
        )}
        <PageSection
          id="sso-sign-in-name"
          title="Sign-in name"
          description="Single sign-on starts from it. Without one, no provider can be added and no one can start single sign-on."
        >
          {canWrite ? (
            <SignInNameForm slug={slug} environmentId={environmentId} action={saveSignInName} />
          ) : (
            <p className="text-sm">{slug ?? 'Not set'}</p>
          )}
        </PageSection>
        <PageSection id="sso-providers" title="Identity providers">
          <DataTable
            caption="Identity providers"
            rows={providers}
            getRowKey={(row) => row.id}
            emptyMessage="No identity provider yet."
            columns={[
              {
                id: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (row) => row.attributes['display-name'],
              },
              { id: 'issuer', header: 'Issuer', cell: (row) => row.attributes.issuer },
              {
                id: 'secret',
                header: 'Client secret',
                cell: (row) => (row.attributes['client-secret-set'] ? 'Set' : 'Not set'),
              },
              {
                id: 'domains',
                header: 'Email domains',
                cell: (row) => row.attributes['allowed-email-domains'].join(', '),
              },
              {
                id: 'users',
                header: 'New users',
                cell: (row) => (row.attributes['jit-provisioning'] ? 'Created' : 'Not created'),
              },
              {
                id: 'enforced',
                header: 'Password sign-in',
                cell: (row) => (row.attributes.enforced ? 'Refused' : 'Allowed'),
              },
              {
                id: 'redirect',
                header: 'Redirect URI',
                cell: (row) =>
                  row.attributes['redirect-uri'] === null ? (
                    'Not available'
                  ) : (
                    <code className="break-all">{row.attributes['redirect-uri']}</code>
                  ),
              },
            ]}
          />
          {canWrite &&
            providers.map((provider) => (
              <details key={provider.id} className="rounded border border-line p-4">
                <summary className="cursor-pointer font-medium">
                  Change {provider.attributes['display-name']}
                </summary>
                <div className="mt-4 flex flex-col gap-6">
                  <SsoProviderForm
                    provider={viewOf(provider)}
                    roles={roleChoices}
                    environmentId={environmentId}
                    action={updateSsoProviderAction}
                  />
                  <DeleteSsoProviderForm
                    provider={viewOf(provider)}
                    environmentId={environmentId}
                    action={deleteSsoProviderAction}
                  />
                </div>
              </details>
            ))}
        </PageSection>
        {canWrite && (
          <PageSection id="sso-add-provider" title="Add an identity provider">
            {slug === null && (
              <Alert tone="info" title="Set a sign-in name first">
                A provider is saved only once the organization has a sign-in name.
              </Alert>
            )}
            <SsoProviderForm
              roles={roleChoices}
              environmentId={environmentId}
              action={createSsoProviderAction}
            />
          </PageSection>
        )}
      </PageMain>
    );
  });
}
