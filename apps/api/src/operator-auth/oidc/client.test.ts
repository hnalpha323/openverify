import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createOutboundHttp, type OutboundHttp } from '../../http/index.js';
import { fixedClock } from '../../test-support/fakes.js';
import {
  startTestOidcProvider,
  type StartTestOidcProviderOptions,
  type TestAuthorizeOptions,
  type TestOidcProvider,
  type TestOidcUser,
} from '../../test-support/oidc/provider.js';
import {
  SSO_SCOPES,
  createOidcClient,
  idTokenAlgorithmsOf,
  outboundAllowanceFor,
  type OidcClient,
  type OidcProviderSettings,
} from './client.js';
import { SsoFlowError, type SsoFailureCode } from './failures.js';

const REDIRECT = 'https://console.example.com/sso/callback/ssop_01JC0000000000000000000000';
const CLIENT = {
  clientId: 'synthetic-client-id',
  clientSecret: 'synthetic-client-secret-canary',
  redirectUris: [REDIRECT],
};
const USER: TestOidcUser = { sub: 'subject-0001', email: 'ada@example.com', emailVerified: true };

let outbound: OutboundHttp;
beforeAll(() => {
  outbound = createOutboundHttp();
});
afterAll(async () => {
  await outbound.close();
});

const providers: TestOidcProvider[] = [];
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

const clock = fixedClock(new Date('2026-11-13T12:00:00Z'));

async function setUp(
  options: Partial<StartTestOidcProviderOptions> = {},
  settings: Partial<OidcProviderSettings> = {},
  sharedIssuers?: readonly string[],
) {
  const provider = await startTestOidcProvider({
    shape: 'okta',
    clients: [CLIENT],
    now: () => clock.now(),
    ...options,
  });
  providers.push(provider);
  const client: OidcClient = createOidcClient({
    outbound,
    policy: { production: false, privateIssuers: [] },
    clock,
    ...(sharedIssuers === undefined ? {} : { sharedIssuers }),
  });
  const providerSettings: OidcProviderSettings = {
    issuer: provider.issuer,
    clientId: CLIENT.clientId,
    clientSecret: CLIENT.clientSecret,
    tenantPin: null,
    ...settings,
  };
  return { provider, client, settings: providerSettings };
}

const fresh = () => ({
  state: randomBytes(16).toString('base64url'),
  nonce: randomBytes(16).toString('base64url'),
  codeVerifier: randomBytes(32).toString('base64url'),
});

async function signIn(
  setup: Awaited<ReturnType<typeof setUp>>,
  {
    user = USER,
    authorize = {},
    reauthenticate = false,
    maxAgeSeconds,
    query: rewrite,
  }: {
    user?: TestOidcUser;
    authorize?: TestAuthorizeOptions;
    reauthenticate?: boolean;
    maxAgeSeconds?: number;
    query?: (query: URLSearchParams) => URLSearchParams;
  } = {},
) {
  const { provider, client, settings } = setup;
  const discovered = await client.discover(settings);
  const attempt = fresh();
  const url = await client.authorizationUrl(discovered, {
    redirectUri: REDIRECT,
    reauthenticate,
    ...attempt,
  });
  const callback = provider.authorize(url, user, authorize);
  const claims = await client.exchange(discovered, {
    redirectUri: REDIRECT,
    query: rewrite === undefined ? callback : rewrite(callback),
    maxAgeSeconds,
    ...attempt,
  });
  return { url: new URL(url), claims, discovered };
}

async function refusal(promise: Promise<unknown>): Promise<SsoFailureCode> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SsoFlowError);
  return (error as SsoFlowError).failure;
}

describe('the OIDC client (C248.2-C248.4)', () => {
  it.each(['okta', 'entra', 'google'] as const)(
    'signs in with the authorization code flow, PKCE S256, state and nonce (%s shape)',
    async (shape) => {
      const setup = await setUp({ shape, tenant: 'tenant-synthetic-0001' });
      const { url, claims, discovered } = await signIn(setup);
      expect(discovered.expectedIssuer).toBe(setup.provider.issuer);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId);
      expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
      expect(url.searchParams.get('scope')).toBe(SSO_SCOPES);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(url.searchParams.has('prompt')).toBe(false);
      expect(claims).toMatchObject({ sub: USER.sub, email: USER.email, email_verified: true });
      expect(setup.provider.served).toMatchObject({ discovery: 1, jwks: 1, token: 1 });
    },
  );

  it.each(['ES256', 'PS256', 'EdDSA'] as const)(
    'accepts an ID token signed with %s',
    async (algorithm) => {
      const { claims } = await signIn(await setUp({ algorithm }));
      expect(claims.sub).toBe(USER.sub);
    },
  );

  it.each([
    ['none', { algorithm: 'none' }],
    ['an HMAC', { algorithm: 'HS256' }],
    ['a key outside the JWKS', { foreignKey: true }],
    ['another audience', { audience: 'another-client' }],
    ['another issuer', { issuer: 'https://other.example.org' }],
    ['no nonce', { nonce: null }],
    ['another nonce', { nonce: 'another-nonce' }],
    ['an expired token', { expiresInSeconds: -60 }],
  ] as const)('refuses an ID token with %s', async (_label, tweaks) => {
    const failure = await refusal(signIn(await setUp(), { authorize: { tweaks } }));
    expect(failure).toBe('token_exchange_failed');
  });

  it('checks RFC 9207’s iss where the provider advertises it', async () => {
    expect(
      await refusal(
        signIn(await setUp({ shape: 'okta' }), {
          authorize: { responseIss: 'https://mix-up.example.org' },
        }),
      ),
    ).toBe('token_exchange_failed');
    expect(
      await refusal(signIn(await setUp({ shape: 'okta' }), { authorize: { responseIss: null } })),
    ).toBe('token_exchange_failed');
    // A provider that does not advertise it may leave it out.
    const { claims } = await signIn(await setUp({ shape: 'google' }));
    expect(claims.sub).toBe(USER.sub);
  });

  it('refuses a swapped state, and an error answer as the provider’s', async () => {
    expect(
      await refusal(
        signIn(await setUp(), {
          query: (query) => {
            query.set('state', 'swapped-state');
            return query;
          },
        }),
      ),
    ).toBe('token_exchange_failed');
    expect(await refusal(signIn(await setUp(), { authorize: { error: 'access_denied' } }))).toBe(
      'provider_error',
    );
  });

  it('asks a step-up to re-authenticate and holds auth_time to the window', async () => {
    const setup = await setUp();
    const { url, claims } = await signIn(setup, { reauthenticate: true, maxAgeSeconds: 600 });
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('max_age')).toBe('0');
    expect(claims.auth_time).toBe(clock.now().getTime() / 1000);
    const stale = new Date(clock.now().getTime() - 700_000);
    expect(
      await refusal(
        signIn(setup, { reauthenticate: true, maxAgeSeconds: 600, authorize: { authTime: stale } }),
      ),
    ).toBe('token_exchange_failed');
  });

  it('judges time on the injected clock, not the host’s', async () => {
    const past = fixedClock(new Date('2020-01-01T00:00:00Z'));
    const provider = await startTestOidcProvider({
      shape: 'okta',
      clients: [CLIENT],
      now: () => past.now(),
    });
    providers.push(provider);
    const client = createOidcClient({
      outbound,
      policy: { production: false, privateIssuers: [] },
      clock: past,
    });
    const { claims } = await signIn({
      provider,
      client,
      settings: {
        issuer: provider.issuer,
        clientId: CLIENT.clientId,
        clientSecret: CLIENT.clientSecret,
        tenantPin: null,
      },
    });
    expect(claims.iat).toBe(past.now().getTime() / 1000);
  });

  it('refuses a discovery document whose issuer is not exactly the stored one', async () => {
    const setup = await setUp();
    expect(
      await refusal(
        setup.client.discover({ ...setup.settings, issuer: `${setup.provider.issuer}/` }),
      ),
    ).toBe('issuer_mismatch');
    expect(
      await refusal(
        setup.client.discover({
          ...setup.settings,
          issuer: `${setup.provider.origin}/oauth2/other`,
        }),
      ),
    ).toBe('discovery_failed');
    const google = await setUp({ shape: 'google' });
    expect(
      await refusal(
        google.client.discover({
          ...google.settings,
          issuer: `${google.provider.origin}/elsewhere`,
        }),
      ),
    ).toBe('discovery_failed');
  });

  it('accepts a multi-tenant issuer only with its tenant pin, checked on every token', async () => {
    const common = await setUp({ shape: 'entra', tenant: 'common' });
    const issuer = `${common.provider.origin}/common/v2.0`;
    expect(await refusal(common.client.discover({ ...common.settings, issuer }))).toBe(
      'tenant_pin_missing',
    );
    const pinned = {
      ...common,
      settings: {
        ...common.settings,
        issuer,
        tenantPin: { claim: 'tid' as const, value: 'tenant-synthetic-0001' },
      },
    };
    const { claims, discovered } = await signIn(pinned, {
      user: { ...USER, claims: { tid: 'tenant-synthetic-0001' } },
    });
    expect(discovered.expectedIssuer).toBe(`${common.provider.origin}/tenant-synthetic-0001/v2.0`);
    expect(claims.tid).toBe('tenant-synthetic-0001');
    expect(
      await refusal(
        signIn(pinned, { user: { ...USER, claims: { tid: 'tenant-synthetic-0009' } } }),
      ),
    ).toBe('token_exchange_failed');
    // A shared Google-shaped issuer needs its hd pin too.
    const shared = await setUp({ shape: 'google' });
    const listed = createOidcClient({
      outbound,
      policy: { production: false, privateIssuers: [] },
      clock,
      sharedIssuers: [shared.provider.issuer],
    });
    expect(await refusal(listed.discover(shared.settings))).toBe('tenant_pin_missing');
    await expect(
      listed.discover({ ...shared.settings, tenantPin: { claim: 'hd', value: 'example.com' } }),
    ).resolves.toMatchObject({ expectedIssuer: shared.provider.issuer });
  });

  it('refuses a provider that cannot be reached', async () => {
    const setup = await setUp();
    const port = new URL(setup.provider.origin).port;
    await setup.provider.close();
    providers.splice(0);
    expect(
      await refusal(
        setup.client.discover({
          ...setup.settings,
          issuer: `http://127.0.0.1:${port}/oauth2/default`,
        }),
      ),
    ).toBe('discovery_failed');
  });

  it('narrows the listed algorithms to RS256, ES256, PS256 and EdDSA (C248.4)', () => {
    expect(idTokenAlgorithmsOf(undefined)).toEqual(['RS256']);
    expect(idTokenAlgorithmsOf(['none', 'HS256', 'ES256', 'RS512', 'EdDSA'])).toEqual([
      'ES256',
      'EdDSA',
    ]);
    expect(idTokenAlgorithmsOf(['none', 'HS256'])).toEqual([]);
    expect(idTokenAlgorithmsOf('RS256')).toEqual([]);
  });

  it('reaches private addresses and plain http outside production only (review P19)', () => {
    const local = 'http://idp.internal.example.com';
    const listed = 'https://idp.internal.example.com';
    expect(outboundAllowanceFor(local, { production: false, privateIssuers: [] })).toEqual({
      allowPrivateNetworks: true,
      allowPlainHttp: true,
    });
    expect(outboundAllowanceFor(listed, { production: true, privateIssuers: [] })).toEqual({
      allowPrivateNetworks: false,
      allowPlainHttp: false,
    });
    expect(outboundAllowanceFor(listed, { production: true, privateIssuers: [listed] })).toEqual({
      allowPrivateNetworks: true,
      allowPlainHttp: false,
    });
    expect(
      outboundAllowanceFor(`${listed}/`, { production: true, privateIssuers: [listed] }),
    ).toEqual({ allowPrivateNetworks: false, allowPlainHttp: false });
  });

  it('refuses plain http and loopback in production', async () => {
    const setup = await setUp();
    const production = createOidcClient({
      outbound,
      policy: { production: true, privateIssuers: [setup.provider.issuer] },
      clock,
    });
    expect(await refusal(production.discover(setup.settings))).toBe('discovery_failed');
    expect(setup.provider.served.discovery).toBe(0);
  });
});
