/** Synthetic SSO providers for the Settings → Security → Single sign-on tests (rule 9). */
import type { SsoProviderResource } from '@openverify/contracts';

export const PROVIDER_ID = 'ssop_01JC0000000000000000000001';
export const OTHER_PROVIDER_ID = 'ssop_01JC0000000000000000000002';

/** A provider as the API serves it: `client-secret-set`, never the secret. */
export function ssoProvider(
  overrides: Partial<SsoProviderResource['attributes']> = {},
  id = PROVIDER_ID,
): SsoProviderResource {
  return {
    type: 'sso-provider',
    id,
    attributes: {
      'display-name': 'Workforce',
      issuer: 'https://idp.example.com/oauth2/default',
      'client-id': 'synthetic-client-id',
      'client-secret-set': true,
      'allowed-email-domains': ['example.com'],
      'tenant-pin': null,
      'required-amr': ['mfa'],
      'required-acr': [],
      'jit-provisioning': false,
      'default-role-ids': [],
      enforced: false,
      'redirect-uri': `https://console.example.com/sso/callback/${id}`,
      'created-at': '2026-11-13T12:00:00.000Z',
      'updated-at': '2026-11-13T12:00:00.000Z',
      ...overrides,
    },
  };
}
