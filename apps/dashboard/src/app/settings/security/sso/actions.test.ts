// @vitest-environment node
import { PERMISSIONS, type Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../../../../components/operators/test-fixtures';
import { SESSION_COOKIE } from '../../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../../testing/api-routes';
import { fakeRequest } from '../../../../testing/fake-request';
import {
  createSsoProviderAction,
  deleteSsoProviderAction,
  saveSignInName,
  updateSsoProviderAction,
} from './actions';
import { SSO_SETTINGS_PATH, listOf, providerRequestOf } from './sso-form-input';
import { PROVIDER_ID, ssoProvider } from './sso-test-fixtures';

vi.mock('next/headers', () =>
  import('../../../../testing/fake-request').then((m) => m.nextHeaders),
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  vi.mocked(revalidatePath).mockReset();
});

afterEach(() => {
  api.restore();
});

const as = (permissions: readonly Permission[] = PERMISSIONS) => api.me({ permissions });
const SECRET = 'synthetic-client-secret-canary';
const ROLE = 'role_01JC0000000000000000000001';

function formOf(values: Record<string, string | readonly string[]>) {
  const data = new FormData();
  data.set('environment-id', ENVIRONMENTS.sandbox.id);
  for (const [name, value] of Object.entries(values)) {
    for (const each of typeof value === 'string' ? [value] : value) {
      data.append(name, each);
    }
  }
  return data;
}

const PROVIDER_FORM = {
  'display-name': ' Workforce ',
  issuer: 'https://idp.example.com/oauth2/default',
  'client-id': 'synthetic-client-id',
  'client-secret': SECRET,
  'allowed-email-domains': 'Example.com,  example.org\nexample.net',
  'tenant-pin-claim': '',
  'tenant-pin-value': '',
  'required-amr': 'mfa  hwk',
  'required-acr': '',
  'jit-provisioning': 'on',
  'default-role-ids': [ROLE],
};

const STEP_UP_PATH = '/dashboard/sessions/current/step-up';
const STEP_UP_ANSWER = {
  'mfa-verified-at': '2026-11-13T12:05:00.000Z',
  'step-up-expires-at': '2026-11-13T12:15:00.000Z',
};
const problem = (status: number, code: string) => ({
  type: 'about:blank',
  title: 'Refused',
  status,
  detail: 'synthetic detail',
  code,
});

describe('the provider form’s request (C248.3)', () => {
  it('builds the sso-provider document, the secret only when typed', () => {
    expect(providerRequestOf(formOf(PROVIDER_FORM))).toEqual({
      data: {
        type: 'sso-provider',
        attributes: {
          'display-name': 'Workforce',
          issuer: 'https://idp.example.com/oauth2/default',
          'client-id': 'synthetic-client-id',
          'client-secret': SECRET,
          'allowed-email-domains': ['example.com', 'example.org', 'example.net'],
          'tenant-pin': null,
          'required-amr': ['mfa', 'hwk'],
          'required-acr': [],
          'jit-provisioning': true,
          'default-role-ids': [ROLE],
          enforced: false,
        },
      },
    });
    const kept = providerRequestOf(
      formOf({
        ...PROVIDER_FORM,
        'client-secret': '',
        'tenant-pin-claim': 'hd',
        'tenant-pin-value': ' example.com ',
        enforced: 'on',
      }),
    ).data.attributes;
    expect(kept).not.toHaveProperty('client-secret');
    expect(kept['tenant-pin']).toEqual({ claim: 'hd', value: 'example.com' });
    expect(kept.enforced).toBe(true);
    expect(listOf(' a,,b  c\n')).toEqual(['a', 'b', 'c']);
  });
});

describe('the SSO settings actions (C248.3, C248.8)', () => {
  it('confirms the second factor first, then adds the provider', async () => {
    as();
    api.on('POST', STEP_UP_PATH, 200, STEP_UP_ANSWER);
    api.on('POST', '/dashboard/sso-providers', 201, { data: ssoProvider() });
    await expect(
      createSsoProviderAction(null, formOf({ ...PROVIDER_FORM, 'step-up-code': '123 456' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    const [stepUp, create] = api.requests.filter((request) => request.method === 'POST');
    expect(stepUp?.body).toEqual({ 'totp-code': '123456' });
    expect(create?.path).toBe('/dashboard/sso-providers');
    expect(create?.body).toMatchObject({ data: { attributes: { 'client-secret': SECRET } } });
    expect(revalidatePath).toHaveBeenCalledWith(SSO_SETTINGS_PATH);
  });

  it('says a refused code at its field and calls nothing else', async () => {
    as();
    api.on('POST', STEP_UP_PATH, 401, problem(401, 'mfa_code_invalid'));
    const result = await createSsoProviderAction(
      null,
      formOf({ ...PROVIDER_FORM, 'step-up-code': '000000' }),
    );
    expect(result).toMatchObject({
      ok: false,
      problem: {
        errors: [
          { pointer: '/step-up-code', detail: 'That code is not valid. Enter the current code.' },
        ],
      },
    });
    expect(api.requests.some((request) => request.path === '/dashboard/sso-providers')).toBe(false);
    const malformed = await createSsoProviderAction(
      null,
      formOf({ ...PROVIDER_FORM, 'step-up-code': '12' }),
    );
    expect(malformed).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/step-up-code' }] },
    });
  });

  it('asks for the second factor when the API says the step-up is due', async () => {
    as();
    api.on('POST', '/dashboard/sso-providers', 403, problem(403, 'step_up_required'));
    const result = await createSsoProviderAction(null, formOf(PROVIDER_FORM));
    expect(result).toMatchObject({
      ok: false,
      problem: { code: 'step_up_required', errors: [{ pointer: '/step-up-code' }] },
    });
  });

  it('refuses a form the contract refuses, at its field, without calling the API', async () => {
    as();
    const result = await createSsoProviderAction(
      null,
      formOf({ ...PROVIDER_FORM, 'allowed-email-domains': '' }),
    );
    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/allowed-email-domains' }] },
    });
  });

  it('changes a provider without its secret unless one is typed, and removes one', async () => {
    as();
    api.on('PATCH', `/dashboard/sso-providers/${PROVIDER_ID}`, 200, { data: ssoProvider() });
    await expect(
      updateSsoProviderAction(
        null,
        formOf({ ...PROVIDER_FORM, 'client-secret': '', 'provider-id': PROVIDER_ID }),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    const change = api.find('PATCH', `/dashboard/sso-providers/${PROVIDER_ID}`);
    expect(change).toBeDefined();
    expect(JSON.stringify(change?.body)).not.toContain('client-secret');
    api.on('DELETE', `/dashboard/sso-providers/${PROVIDER_ID}`, 204);
    await expect(
      deleteSsoProviderAction(null, formOf({ 'provider-id': PROVIDER_ID })),
    ).resolves.toEqual({ ok: true, data: undefined });
    const refused = await deleteSsoProviderAction(null, formOf({ 'provider-id': 'ssop_nope' }));
    expect(refused).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/provider-id' }] },
    });
  });

  it('saves the sign-in name, lower-cased, and clears it when empty', async () => {
    as();
    api.on('PATCH', '/dashboard/settings', 200, settings());
    await expect(
      saveSignInName(null, formOf({ 'organization-slug': 'Acme-SSO' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', '/dashboard/settings')?.body).toEqual({
      'organization-slug': 'acme-sso',
    });
    api.on('PATCH', '/dashboard/settings', 200, settings());
    await saveSignInName(null, formOf({ 'organization-slug': '' }));
    expect(api.find('PATCH', '/dashboard/settings')?.body).toEqual({ 'organization-slug': null });
    const refused = await saveSignInName(null, formOf({ 'organization-slug': '-x' }));
    expect(refused).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/organization-slug' }] },
    });
  });

  it('needs settings:write', async () => {
    as(['settings:read']);
    const result = await saveSignInName(null, formOf({ 'organization-slug': 'acme-sso' }));
    expect(result.ok).toBe(false);
  });
});
