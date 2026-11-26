/**
 * Phase 11, Workflow 11B Stage 1a, checkpoint (A) (C245, C248): the SSO provider resource and its
 * routes' bodies, the start and callback calls the console's route handlers make (the BFF calls, with
 * the browser binding), the step-up of an SSO session, the organisation's sign-in name and the login
 * hint, and the end-sessions route. Read through the package root, so a name that does not exist yet
 * fails here at run time, never at compile time.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { listFixtures, readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  if (!(found instanceof z.ZodType)) {
    throw new TypeError(`${name} is not exported as a schema`);
  }
  return found;
};
const roundTrip = (name: string, raw: unknown) => {
  const parsed = schema(name).parse(raw);
  expect(parsed).toEqual(raw);
  expect(z.encode(schema(name), parsed)).toEqual(raw);
};

const PROVIDER = 'ssop_01M5CN0000000000000011B200';

describe('the SSO provider id (C248.3)', () => {
  it('holds ssop, ours, in both prefix tables', () => {
    expect(contracts.ID_PREFIXES).toMatchObject({ ssoProvider: 'ssop' });
    expect(contracts.isId('ssop', PROVIDER)).toBe(true);
    expect(contracts.isId('ssp', PROVIDER)).toBe(false);
  });
});

describe('the SSO provider resource (C248.3, C248.5; reviews P06, P07, P19, P21, V13)', () => {
  it('holds the goldens of api/sso/, which Android does not read', () => {
    expect(listFixtures('api/sso')).toEqual(
      [
        'provider.json',
        'provider-list.json',
        'provider-create.json',
        'provider-update.json',
        'start-redirect.json',
        'start-choose.json',
        'callback-query.json',
        'callback-session.json',
        'end-sessions.json',
      ].sort(),
    );
  });

  it('serves a provider with every frozen member and never its client secret', () => {
    const raw = readFixture('api/sso/provider.json') as {
      data: { attributes: Record<string, unknown> };
    };
    roundTrip('ssoProviderDocumentSchema', raw);
    expect(Object.keys(raw.data.attributes).sort()).toEqual(
      [
        'display-name',
        'issuer',
        'client-id',
        'client-secret-set',
        'allowed-email-domains',
        'tenant-pin',
        'required-amr',
        'required-acr',
        'jit-provisioning',
        'default-role-ids',
        'enforced',
        'redirect-uri',
        'created-at',
        'updated-at',
      ].sort(),
    );
    expect(JSON.stringify(raw)).not.toContain('client-secret"');
    expect(
      schema('ssoProviderDocumentSchema').safeParse({
        data: { ...raw.data, attributes: { ...raw.data.attributes, 'client-secret': 'synthetic' } },
      }).success,
    ).toBe(false);
    roundTrip('ssoProviderListDocumentSchema', readFixture('api/sso/provider-list.json'));
  });

  it('takes the client secret on create, write-only, and requires the email domains', () => {
    const raw = readFixture('api/sso/provider-create.json') as {
      data: { attributes: Record<string, unknown> };
    };
    const body = schema('createSsoProviderBodySchema');
    expect(body.parse(raw)).toEqual(raw);
    const without = (member: string) => ({
      data: {
        attributes: Object.fromEntries(
          Object.entries(raw.data.attributes).filter(([key]) => key !== member),
        ),
      },
    });
    expect(body.safeParse(without('client-secret')).success).toBe(false);
    expect(body.safeParse(without('allowed-email-domains')).success).toBe(false);
    const withDomains = (domains: unknown) => ({
      data: { attributes: { ...raw.data.attributes, 'allowed-email-domains': domains } },
    });
    expect(body.safeParse(withDomains([])).success).toBe(false);
    expect(body.safeParse(withDomains(['Example.COM'])).success).toBe(false);
    expect(body.safeParse(withDomains(['@example.com'])).success).toBe(false);
  });

  it('pins a multi-tenant issuer by tid or hd only', () => {
    const raw = readFixture('api/sso/provider-create.json') as {
      data: { attributes: Record<string, unknown> };
    };
    const body = schema('createSsoProviderBodySchema');
    const withPin = (pin: unknown) => ({
      data: { attributes: { ...raw.data.attributes, 'tenant-pin': pin } },
    });
    expect(body.safeParse(withPin({ claim: 'tid', value: 'synthetic-tenant' })).success).toBe(true);
    expect(body.safeParse(withPin({ claim: 'hd', value: 'example.com' })).success).toBe(true);
    expect(body.safeParse(withPin({ claim: 'aud', value: 'x' })).success).toBe(false);
    expect(body.safeParse(withPin(null)).success).toBe(true);
    expect(pick('SSO_TENANT_PIN_CLAIMS')).toEqual(['tid', 'hd']);
  });

  it('takes a partial update, a new secret included, and refuses an empty one', () => {
    const body = schema('updateSsoProviderBodySchema');
    expect(body.parse(readFixture('api/sso/provider-update.json'))).toEqual(
      readFixture('api/sso/provider-update.json'),
    );
    expect(body.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(body.safeParse({ data: { attributes: { 'client-secret': '' } } }).success).toBe(false);
  });

  it('freezes the ID token algorithms and the 10-minute browser binding (C248.4)', () => {
    expect(pick('SSO_ID_TOKEN_ALGORITHMS')).toEqual(['RS256', 'ES256', 'PS256', 'EdDSA']);
    expect(pick('SSO_LOGIN_STATE_TTL_SECONDS')).toBe(600);
  });

  it('refuses a just-in-time role holding an organisation-level or listed permission (C248.5, P21)', () => {
    const refusals = pick('jitRoleRefusals') as
      ((permissions: readonly string[]) => readonly string[]) | undefined;
    expect(pick('JIT_FORBIDDEN_PERMISSIONS')).toEqual([
      'settings:write',
      'api-keys:read',
      'api-keys:write',
      'connect-connections:activate',
      'connect-consent-records:attest',
      'account-access:export',
      'environments:production',
    ]);
    expect(refusals?.(['inquiries:read', 'pii:view'])).toEqual([]);
    expect(refusals?.(['users:read', 'api-keys:write', 'inquiries:read'])).toEqual([
      'users:read',
      'api-keys:write',
    ]);
  });
});

describe('the BFF calls of the SSO route handlers (C248.4; review F21)', () => {
  it('answers a start with the authorization URL and the browser binding, or the providers to choose from', () => {
    roundTrip('ssoStartResponseSchema', readFixture('api/sso/start-redirect.json'));
    roundTrip('ssoStartResponseSchema', readFixture('api/sso/start-choose.json'));
    const query = schema('ssoStartQuerySchema');
    expect(query.safeParse({ 'return-to': '/inquiries?status=needs_review' }).success).toBe(true);
    expect(query.safeParse({ 'return-to': 'https://elsewhere.example.com/' }).success).toBe(false);
    expect(query.safeParse({ 'return-to': '//elsewhere.example.com/' }).success).toBe(false);
    expect(query.safeParse({ 'provider-id': PROVIDER }).success).toBe(true);
  });

  it('names the organisation by its sign-in name in the start path', () => {
    const params = schema('ssoStartParamsSchema');
    expect(params.safeParse({ organizationSlug: 'example-bank' }).success).toBe(true);
    for (const bad of ['Example', 'ex', '-bank', 'bank-', 'a'.repeat(64), 'bank_1']) {
      expect(params.safeParse({ organizationSlug: bad }).success, bad).toBe(false);
    }
  });

  it('takes the callback query as the identity provider sends it, and keeps the binding in a header', () => {
    const query = schema('ssoCallbackQuerySchema');
    const raw = readFixture('api/sso/callback-query.json');
    const parsed = query.parse(raw) as { code?: unknown; state?: unknown };
    expect(typeof parsed.code).toBe('string');
    expect(typeof parsed.state).toBe('string');
    expect(query.safeParse({ ...(raw as object), session_state: 'synthetic' }).success).toBe(true);
    expect(query.safeParse({ code: 'synthetic' }).success).toBe(false);
    expect(pick('SSO_BINDING_HEADER')).toBe('x-openverify-sso-binding');
    expect(pick('SSO_BINDING_COOKIE')).toBe('__Host-openverify-sso');
    expect(pick('SSO_BINDING_COOKIE_INSECURE')).toBe('openverify-sso');
    const binding = schema('ssoBindingSchema');
    expect(binding.safeParse(`ovsb_${'A'.repeat(43)}`).success).toBe(true);
    expect(binding.safeParse(`ovs_${'A'.repeat(43)}`).success).toBe(false);
  });

  it('answers a callback as sign-in does: a session, a second factor, or a step-up', () => {
    const answer = schema('ssoCallbackResponseSchema');
    roundTrip('ssoCallbackResponseSchema', readFixture('api/sso/callback-session.json'));
    expect(
      answer.safeParse({
        'mfa-token': `ovm_${'A'.repeat(43)}`,
        factors: [{ id: 'mfa_01M5CK9R40JYHAVE63SVCY9VZT', type: 'totp' }],
      }).success,
    ).toBe(true);
    expect(
      answer.safeParse({
        'mfa-verified-at': '2026-11-13T12:00:00.000Z',
        'step-up-expires-at': '2026-11-13T12:10:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('marks the secret-bearing members for the API log (C248.4, rule 11)', () => {
    expect(contracts.API_LOG_REDACTED_KEYS as readonly string[]).toEqual(
      expect.arrayContaining(['client-secret', 'binding']),
    );
  });
});

describe('sign-in names, the login hint and the step-up of an SSO session (C248.6, C248.8)', () => {
  it('takes an optional organization on the C4 login, a sign-in name', () => {
    const body = contracts.dashboardLoginBodySchema;
    const base = { email: 'synthetic.operator@example.com', password: 'synthetic-password' };
    expect(body.safeParse(base).success).toBe(true);
    expect(body.safeParse({ ...base, organization: 'example-bank' }).success).toBe(true);
    expect(body.safeParse({ ...base, organization: 'Example Bank' }).success).toBe(false);
  });

  it('serves the organisation sign-in name as an organisation setting, null until set', async () => {
    expect(contracts.DASHBOARD_SETTINGS_DEFAULTS).toMatchObject({ 'organization-slug': null });
    const body = contracts.dashboardUpdateSettingsBodySchema;
    expect(body.safeParse({ 'organization-slug': 'example-bank' }).success).toBe(true);
    expect(body.safeParse({ 'organization-slug': null }).success).toBe(true);
    expect(body.safeParse({ 'organization-slug': 'x' }).success).toBe(false);
    const core = await import('@openverify/core');
    expect(core.settingLevel('organization-slug')).toBe('organization');
  });

  it('starts the re-authentication of an SSO session with no body, as the passkey step-up does', () => {
    expect(schema('ssoStepUpBodySchema').safeParse({}).success).toBe(true);
    expect(schema('ssoStepUpBodySchema').safeParse({ prompt: 'none' }).success).toBe(false);
  });
});

describe('ending one user’s sessions (C245.3)', () => {
  it('takes no body and answers how many sessions it ended', () => {
    expect(schema('endUserSessionsBodySchema').safeParse({}).success).toBe(true);
    roundTrip('endUserSessionsResponseSchema', readFixture('api/sso/end-sessions.json'));
    expect(
      schema('endUserSessionsResponseSchema').safeParse({ 'sessions-ended': -1 }).success,
    ).toBe(false);
  });

  it('names the audit actions 11B writes', () => {
    expect(pick('ACCESS_11B_AUDIT_ACTIONS')).toEqual({
      sessionsEnded: 'user.sessions-ended',
      ssoProviderCreated: 'sso-provider.created',
      ssoProviderUpdated: 'sso-provider.updated',
      ssoProviderDeleted: 'sso-provider.deleted',
      ssoLinked: 'user.sso-linked',
      ssoProvisioned: 'user.sso-provisioned',
      passwordLoginAllowed: 'user.password-login-allowed',
    });
  });
});
