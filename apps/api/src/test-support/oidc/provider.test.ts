import { createHash, randomBytes } from 'node:crypto';
import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
} from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startTestOidcProvider,
  type StartTestOidcProviderOptions,
  type TestOidcProvider,
} from './provider.js';

const CLIENT = {
  clientId: 'synthetic-client-id',
  clientSecret: 'synthetic-client-secret-canary',
  redirectUris: ['https://console.example.com/sso/callback/ssop_01JC0000000000000000000000'],
};
const REDIRECT = CLIENT.redirectUris[0] ?? '';
const USER = { sub: 'subject-0001', email: 'ada@example.com', emailVerified: true };

const providers: TestOidcProvider[] = [];
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

async function start(options: Partial<StartTestOidcProviderOptions> = {}) {
  const provider = await startTestOidcProvider({ shape: 'okta', clients: [CLIENT], ...options });
  providers.push(provider);
  return provider;
}

const verifier = () => randomBytes(32).toString('base64url');
const challengeOf = (value: string) => createHash('sha256').update(value).digest('base64url');

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  [member: string]: unknown;
}

async function discover(provider: TestOidcProvider): Promise<Discovery> {
  const response = await fetch(provider.discoveryUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^application\/json/);
  return (await response.json()) as Discovery;
}

function authorizationUrl(
  discovery: Discovery,
  parameters: Record<string, string | undefined>,
): string {
  const url = new URL(discovery.authorization_endpoint);
  const all: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT.clientId,
    redirect_uri: REDIRECT,
    scope: 'openid email profile',
    state: 'synthetic-state',
    nonce: 'synthetic-nonce',
    code_challenge_method: 'S256',
    ...parameters,
  };
  for (const [name, value] of Object.entries(all)) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  return url.href;
}

async function exchange(
  discovery: Discovery,
  form: Record<string, string>,
  basic: string | null = `${CLIENT.clientId}:${CLIENT.clientSecret}`,
) {
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(basic === null
        ? {}
        : { authorization: `Basic ${Buffer.from(basic).toString('base64')}` }),
    },
    body: new URLSearchParams(form).toString(),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function signIn(
  provider: TestOidcProvider,
  options: Parameters<TestOidcProvider['authorize']>[2] = {},
) {
  const discovery = await discover(provider);
  const codeVerifier = verifier();
  const query = provider.authorize(
    authorizationUrl(discovery, { code_challenge: challengeOf(codeVerifier) }),
    USER,
    options,
  );
  const answer = await exchange(discovery, {
    grant_type: 'authorization_code',
    code: query.get('code') ?? '',
    redirect_uri: REDIRECT,
    code_verifier: codeVerifier,
  });
  return { discovery, query, answer, codeVerifier };
}

async function jwks(discovery: Discovery): Promise<JSONWebKeySet> {
  const response = await fetch(discovery.jwks_uri);
  expect(response.status).toBe(200);
  return (await response.json()) as JSONWebKeySet;
}

describe('the in-process OpenID provider (C248.1)', () => {
  it('serves an Okta-shaped discovery document that advertises the iss response parameter', async () => {
    const provider = await start({ shape: 'okta' });
    const discovery = await discover(provider);
    expect(discovery.issuer).toBe(provider.issuer);
    expect(provider.issuer).toBe(`${provider.origin}/oauth2/default`);
    expect(provider.discoveryUrl).toBe(`${provider.issuer}/.well-known/openid-configuration`);
    expect(discovery.authorization_response_iss_parameter_supported).toBe(true);
    expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
    expect(discovery.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(discovery.response_types_supported).toEqual(['code']);
    expect(provider.served.discovery).toBe(1);
  });

  it('serves an Entra-shaped document per tenant, keeping {tenantid} for the multi-tenant issuer', async () => {
    const single = await start({ shape: 'entra', tenant: 'tenant-synthetic-0001' });
    expect(single.issuer).toBe(`${single.origin}/tenant-synthetic-0001/v2.0`);
    expect((await discover(single)).issuer).toBe(single.issuer);
    const common = await start({ shape: 'entra', tenant: 'common' });
    expect(common.discoveryUrl).toBe(
      `${common.origin}/common/v2.0/.well-known/openid-configuration`,
    );
    expect(common.issuer).toBe(`${common.origin}/{tenantid}/v2.0`);
    const discovery = await discover(common);
    expect(discovery.issuer).toBe(common.issuer);
    expect(discovery.authorization_response_iss_parameter_supported).toBeUndefined();
  });

  it('serves a Google-shaped document at the origin', async () => {
    const provider = await start({ shape: 'google', algorithm: 'ES256' });
    expect(provider.issuer).toBe(provider.origin);
    const discovery = await discover(provider);
    expect(discovery.id_token_signing_alg_values_supported).toEqual(['ES256']);
    expect(discovery.claims_supported).toContain('hd');
  });

  it('answers the callback query with a code, the state and the shape iss', async () => {
    const provider = await start();
    const discovery = await discover(provider);
    const query = provider.authorize(
      authorizationUrl(discovery, { code_challenge: challengeOf(verifier()) }),
      USER,
    );
    expect(query.get('state')).toBe('synthetic-state');
    expect(query.get('code')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(query.get('iss')).toBe(provider.issuer);
    expect(
      provider
        .authorize(authorizationUrl(discovery, { code_challenge: challengeOf(verifier()) }), USER, {
          responseIss: null,
        })
        .has('iss'),
    ).toBe(false);
    expect(
      provider
        .authorize(authorizationUrl(discovery, { code_challenge: challengeOf(verifier()) }), USER, {
          error: 'access_denied',
        })
        .get('error'),
    ).toBe('access_denied');
  });

  it('refuses an authorization request a provider would refuse', async () => {
    const provider = await start();
    const discovery = await discover(provider);
    const challenge = challengeOf(verifier());
    const refused = (parameters: Record<string, string | undefined>) => () =>
      provider.authorize(
        authorizationUrl(discovery, { code_challenge: challenge, ...parameters }),
        USER,
      );
    expect(refused({ code_challenge: undefined })).toThrow(/PKCE/);
    expect(refused({ code_challenge_method: 'plain' })).toThrow(/PKCE/);
    expect(refused({ client_id: 'unknown' })).toThrow(/client/);
    expect(refused({ redirect_uri: 'https://elsewhere.example.org/cb' })).toThrow(/redirect/);
    expect(refused({ state: undefined })).toThrow(/state/);
    expect(refused({ nonce: undefined })).toThrow(/nonce/);
    expect(refused({ scope: 'email' })).toThrow(/openid/);
    expect(refused({ response_type: 'token' })).toThrow(/response_type/);
  });

  it('exchanges a code once for an ID token signed by a key of its JWKS', async () => {
    const now = new Date('2026-11-13T12:00:00Z');
    const provider = await start({ now: () => now });
    const { discovery, answer, codeVerifier, query } = await signIn(provider, {
      authTime: new Date('2026-11-13T11:59:00Z'),
    });
    expect(answer.status).toBe(200);
    expect(answer.body.token_type).toBe('Bearer');
    const idToken = String(answer.body.id_token);
    const { payload, protectedHeader } = await jwtVerify(
      idToken,
      createLocalJWKSet(await jwks(discovery)),
      {
        currentDate: now,
      },
    );
    expect(protectedHeader.alg).toBe('RS256');
    expect(payload).toMatchObject({
      iss: provider.issuer,
      aud: CLIENT.clientId,
      sub: USER.sub,
      nonce: 'synthetic-nonce',
      email: USER.email,
      email_verified: true,
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 300,
      auth_time: Date.parse('2026-11-13T11:59:00Z') / 1000,
    });
    const again = await exchange(discovery, {
      grant_type: 'authorization_code',
      code: query.get('code') ?? '',
      redirect_uri: REDIRECT,
      code_verifier: codeVerifier,
    });
    expect(again).toEqual({ status: 400, body: { error: 'invalid_grant' } });
    expect(provider.served.token).toBe(2);
  });

  it('refuses a wrong verifier, client, secret or redirect URI at the token endpoint', async () => {
    const provider = await start();
    const discovery = await discover(provider);
    const attempt = async (
      change: Record<string, string>,
      basic: string | null = `${CLIENT.clientId}:${CLIENT.clientSecret}`,
    ) => {
      const codeVerifier = verifier();
      const query = provider.authorize(
        authorizationUrl(discovery, { code_challenge: challengeOf(codeVerifier) }),
        USER,
      );
      return exchange(
        discovery,
        {
          grant_type: 'authorization_code',
          code: query.get('code') ?? '',
          redirect_uri: REDIRECT,
          code_verifier: codeVerifier,
          ...change,
        },
        basic,
      );
    };
    expect(await attempt({ code_verifier: verifier() })).toEqual({
      status: 400,
      body: { error: 'invalid_grant' },
    });
    expect(await attempt({ redirect_uri: 'https://elsewhere.example.org/cb' })).toEqual({
      status: 400,
      body: { error: 'invalid_grant' },
    });
    expect(await attempt({ grant_type: 'refresh_token' })).toEqual({
      status: 400,
      body: { error: 'unsupported_grant_type' },
    });
    expect(await attempt({}, `${CLIENT.clientId}:wrong-secret`)).toEqual({
      status: 401,
      body: { error: 'invalid_client' },
    });
    // client_secret_post works as well as the basic scheme.
    expect(
      (await attempt({ client_id: CLIENT.clientId, client_secret: CLIENT.clientSecret }, null))
        .status,
    ).toBe(200);
    expect((await attempt({ client_id: CLIENT.clientId }, null)).status).toBe(401);
  });

  it.each(['ES256', 'PS256', 'EdDSA'] as const)('signs with %s when asked', async (algorithm) => {
    const provider = await start({ algorithm });
    const { discovery, answer } = await signIn(provider);
    const { protectedHeader } = await jwtVerify(
      String(answer.body.id_token),
      createLocalJWKSet(await jwks(discovery)),
    );
    expect(protectedHeader.alg).toBe(algorithm);
  });

  it('makes the ID token wrong in exactly the way a test asks', async () => {
    const provider = await start({ shape: 'entra', tenant: 'tenant-synthetic-0001' });
    const unsigned = await signIn(provider, { tweaks: { algorithm: 'none' } });
    expect(decodeProtectedHeader(String(unsigned.answer.body.id_token)).alg).toBe('none');
    const hmac = await signIn(provider, { tweaks: { algorithm: 'HS256' } });
    expect(decodeProtectedHeader(String(hmac.answer.body.id_token)).alg).toBe('HS256');
    const foreign = await signIn(provider, { tweaks: { foreignKey: true } });
    await expect(
      jwtVerify(
        String(foreign.answer.body.id_token),
        createLocalJWKSet(await jwks(foreign.discovery)),
      ),
    ).rejects.toThrow();
    const wrong = await signIn(provider, {
      tweaks: {
        issuer: 'https://other.example.org',
        audience: 'other',
        nonce: null,
        expiresInSeconds: -60,
      },
    });
    const payload = decodeJwt(String(wrong.answer.body.id_token));
    expect(payload.iss).toBe('https://other.example.org');
    expect(payload.aud).toBe('other');
    expect(payload.nonce).toBeUndefined();
    expect(Number(payload.exp)).toBeLessThan(Number(payload.iat));
  });

  it('stamps the tenant of an Entra-shaped tenant and the user claims it is given', async () => {
    const provider = await start({ shape: 'entra', tenant: 'tenant-synthetic-0001' });
    const discovery = await discover(provider);
    const codeVerifier = verifier();
    const query = provider.authorize(
      authorizationUrl(discovery, { code_challenge: challengeOf(codeVerifier) }),
      { sub: 'subject-0002', claims: { amr: ['pwd', 'mfa'], acr: 'urn:synthetic:loa:2' } },
    );
    const answer = await exchange(discovery, {
      grant_type: 'authorization_code',
      code: query.get('code') ?? '',
      redirect_uri: REDIRECT,
      code_verifier: codeVerifier,
    });
    const { payload } = await jwtVerify(
      String(answer.body.id_token),
      createLocalJWKSet(await jwks(discovery)),
    );
    expect(payload).toMatchObject({
      tid: 'tenant-synthetic-0001',
      amr: ['pwd', 'mfa'],
      acr: 'urn:synthetic:loa:2',
    });
    expect(payload.email_verified).toBeUndefined();
    expect(payload.email).toBeUndefined();
  });

  it('issues a multi-tenant Entra-shaped token under the tenant the user claims', async () => {
    const provider = await start({ shape: 'entra', tenant: 'organizations' });
    const discovery = await discover(provider);
    const codeVerifier = verifier();
    const query = provider.authorize(
      authorizationUrl(discovery, { code_challenge: challengeOf(codeVerifier) }),
      { sub: 'subject-0003', claims: { tid: 'tenant-synthetic-0009' } },
    );
    const answer = await exchange(discovery, {
      grant_type: 'authorization_code',
      code: query.get('code') ?? '',
      redirect_uri: REDIRECT,
      code_verifier: codeVerifier,
    });
    const { payload } = await jwtVerify(
      String(answer.body.id_token),
      createLocalJWKSet(await jwks(discovery)),
    );
    expect(payload.iss).toBe(`${provider.origin}/tenant-synthetic-0009/v2.0`);
  });

  it('answers 404 for an unknown path and stops serving once closed', async () => {
    const provider = await startTestOidcProvider({ shape: 'google', clients: [CLIENT] });
    expect((await fetch(`${provider.origin}/nowhere`)).status).toBe(404);
    await provider.close();
    await expect(fetch(provider.discoveryUrl)).rejects.toThrow();
  });
});
