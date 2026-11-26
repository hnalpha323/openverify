/**
 * C248.3 (Phase 11, Workflow 11B, `sso-oidc`): what the SSO provider form posts, as the request
 * document of `POST` and `PATCH /dashboard/sso-providers`. Lists are typed one per line or separated
 * by commas or spaces. The client secret is sent only when one was typed: the form never holds the
 * current one, which the API never serves.
 */

/** Settings → Security → Single sign-on. */
export const SSO_SETTINGS_PATH = '/settings/security/sso';

/** The form's field names (shared by the form and the actions). */
export const SSO_PROVIDER_FIELDS = Object.freeze({
  providerId: 'provider-id',
  displayName: 'display-name',
  issuer: 'issuer',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  domains: 'allowed-email-domains',
  pinClaim: 'tenant-pin-claim',
  pinValue: 'tenant-pin-value',
  amr: 'required-amr',
  acr: 'required-acr',
  jit: 'jit-provisioning',
  roles: 'default-role-ids',
  enforced: 'enforced',
  stepUpCode: 'step-up-code',
} as const);

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** A list typed one per line, or separated by commas or spaces. */
export function listOf(value: string): string[] {
  return value.split(/[\s,]+/).filter((item) => item !== '');
}

/** The `sso-provider` request document of a submitted form. */
export function providerRequestOf(formData: FormData): {
  data: { type: 'sso-provider'; attributes: Record<string, unknown> };
} {
  const f = SSO_PROVIDER_FIELDS;
  const claim = text(formData, f.pinClaim);
  const secret = formData.get(f.clientSecret);
  return {
    data: {
      type: 'sso-provider',
      attributes: {
        'display-name': text(formData, f.displayName),
        issuer: text(formData, f.issuer),
        'client-id': text(formData, f.clientId),
        ...(typeof secret === 'string' && secret !== '' ? { 'client-secret': secret } : {}),
        'allowed-email-domains': listOf(text(formData, f.domains).toLowerCase()),
        'tenant-pin': claim === '' ? null : { claim, value: text(formData, f.pinValue) },
        'required-amr': listOf(text(formData, f.amr)),
        'required-acr': listOf(text(formData, f.acr)),
        'jit-provisioning': formData.get(f.jit) === 'on',
        'default-role-ids': formData
          .getAll(f.roles)
          .filter((value): value is string => typeof value === 'string'),
        enforced: formData.get(f.enforced) === 'on',
      },
    },
  };
}
