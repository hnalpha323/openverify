/**
 * C248.1, C287.1 (Phase 11, Workflow 11B, `sso-oidc`): the in-process OpenID provider every SSO test
 * signs in against. It serves, on `127.0.0.1` from the test's own process, a minimal synthetic
 * discovery document in one of three identity-provider shapes (`okta`, `entra`, `google`: the
 * document's paths and the claims its ID tokens carry, built in code; never a provider's published
 * document), a JWKS of keys generated for this run only (never committed), and a token endpoint that
 * checks the client, the redirect URI, the single-use code and the PKCE verifier before it signs an
 * ID token. No identity provider is ever called (rule 9).
 *
 * The browser's visit to the provider is {@link TestOidcProvider.authorize}: it reads the
 * authorization URL the API built, checks it as a provider would, and answers the callback query
 * (`code`, `state`, and `iss` where the shape advertises RFC 9207) the provider would redirect to.
 * Knobs on each visit ({@link TestAuthorizeOptions}) make the ID token wrong in exactly one way, so a
 * test can prove each refusal.
 *
 * Real identity providers are untested and the operator's to verify (ADR 0002's tier A wording).
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SignJWT,
  UnsecuredJWT,
  exportJWK,
  generateKeyPair,
  generateSecret,
  type CryptoKey,
  type JWK,
} from 'jose';

/** The identity-provider shapes the provider serves (C248.1): paths and claims only. */
export const TEST_OIDC_SHAPES = Object.freeze(['okta', 'entra', 'google'] as const);
export type TestOidcShape = (typeof TEST_OIDC_SHAPES)[number];

/** The signature algorithms the provider can sign with (C248.4's allowlist). */
export type TestSigningAlgorithm = 'RS256' | 'ES256' | 'PS256' | 'EdDSA';

/** A client registered at the provider: what the API's provider row holds. */
export interface TestOidcClient {
  clientId: string;
  clientSecret: string;
  /** Exact redirect URIs; the token endpoint and `authorize` refuse any other. */
  redirectUris: readonly string[];
}

/** The person signing in at the provider. Synthetic only (`example.com`, rule 9). */
export interface TestOidcUser {
  sub: string;
  email?: string | undefined;
  /** Left out, the ID token carries no `email_verified` (C248.4: absent counts as false). */
  emailVerified?: boolean | undefined;
  /** Further ID token claims: `amr`, `acr`, `tid`, `hd`, `name`. */
  claims?: Readonly<Record<string, unknown>> | undefined;
}

/** One way to make the ID token (or the callback) wrong, for a refusal test. */
export interface TestIdTokenTweaks {
  issuer?: string;
  audience?: string;
  /** `null` leaves the nonce out. */
  nonce?: string | null;
  /** Seconds from issue to expiry (default 300); a negative value issues an expired token. */
  expiresInSeconds?: number;
  /** `none` and `HS256` are never accepted by the client (C248.4). */
  algorithm?: TestSigningAlgorithm | 'none' | 'HS256';
  /** Signs with a key of the run that the JWKS does not hold. */
  foreignKey?: boolean;
}

export interface TestAuthorizeOptions {
  /** The `auth_time` claim; defaults to the provider's clock. */
  authTime?: Date | undefined;
  tweaks?: TestIdTokenTweaks | undefined;
  /** RFC 9207: `undefined` sends the shape's own `iss`, `null` none, a string that value. */
  responseIss?: string | null | undefined;
  /** Answers an error (`access_denied`) instead of a code. */
  error?: string | undefined;
}

export interface StartTestOidcProviderOptions {
  shape: TestOidcShape;
  clients: readonly TestOidcClient[];
  /** `entra` only: a tenant id, or `common`/`organizations` for the multi-tenant issuer. */
  tenant?: string | undefined;
  /** Defaults to `RS256`. */
  algorithm?: TestSigningAlgorithm | undefined;
  /** The clock `iat`, `exp` and `auth_time` are stamped from; defaults to the system clock. */
  now?: (() => Date) | undefined;
}

export interface TestOidcProvider {
  readonly shape: TestOidcShape;
  /** The `issuer` of the discovery document (Entra's multi-tenant shape keeps `{tenantid}`). */
  readonly issuer: string;
  /** Where the discovery document is served. */
  readonly discoveryUrl: string;
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** Requests served, by endpoint. */
  readonly served: Readonly<Record<'discovery' | 'jwks' | 'token', number>>;
  /** The browser's visit: checks the authorization URL and answers the callback query. */
  authorize(
    authorizationUrl: string | URL,
    user: TestOidcUser,
    options?: TestAuthorizeOptions,
  ): URLSearchParams;
  close(): Promise<void>;
}

/** A signing key made for this run: its private half signs, its public half is in the JWKS. */
interface SigningKey {
  alg: TestSigningAlgorithm;
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

async function makeSigningKey(alg: TestSigningAlgorithm): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg);
  const kid = randomBytes(8).toString('hex');
  return {
    alg,
    kid,
    privateKey,
    publicJwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' },
  };
}

/** The tenants of the Entra shape whose issuer is the multi-tenant `{tenantid}` template. */
const MULTI_TENANT_SEGMENTS: ReadonlySet<string> = new Set([
  'common',
  'organizations',
  'consumers',
]);

/** Where each shape serves its endpoints, and what its discovery document says beyond them. */
interface Layout {
  issuer: string;
  discoveryPath: string;
  authorizePath: string;
  tokenPath: string;
  jwksPath: string;
  /** The `iss` its ID tokens carry for a user (Entra's multi-tenant shape: the user's tenant). */
  tokenIssuer: (user: TestOidcUser) => string;
  /** Claims the shape stamps on every ID token unless the user's own claims name them. */
  stamped: Readonly<Record<string, unknown>>;
  extra: Readonly<Record<string, unknown>>;
}

function layoutOf(shape: TestOidcShape, origin: string, tenant: string | undefined): Layout {
  if (shape === 'okta') {
    const path = '/oauth2/default';
    return {
      issuer: `${origin}${path}`,
      discoveryPath: `${path}/.well-known/openid-configuration`,
      authorizePath: `${path}/v1/authorize`,
      tokenPath: `${path}/v1/token`,
      jwksPath: `${path}/v1/keys`,
      tokenIssuer: () => `${origin}${path}`,
      stamped: {},
      extra: {
        authorization_response_iss_parameter_supported: true,
        claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'amr', 'email'],
      },
    };
  }
  if (shape === 'entra') {
    const segment = tenant ?? 'tenant-synthetic-0000';
    const multi = MULTI_TENANT_SEGMENTS.has(segment);
    const issuerOf = (id: string) => `${origin}/${id}/v2.0`;
    return {
      issuer: issuerOf(multi ? '{tenantid}' : segment),
      discoveryPath: `/${segment}/v2.0/.well-known/openid-configuration`,
      authorizePath: `/${segment}/oauth2/v2.0/authorize`,
      tokenPath: `/${segment}/oauth2/v2.0/token`,
      jwksPath: `/${segment}/discovery/v2.0/keys`,
      tokenIssuer: (user) => {
        const tid = user.claims?.tid;
        return issuerOf(multi ? (typeof tid === 'string' ? tid : '{tenantid}') : segment);
      },
      stamped: multi ? {} : { tid: segment },
      extra: {
        claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'tid', 'email'],
      },
    };
  }
  return {
    issuer: origin,
    discoveryPath: '/.well-known/openid-configuration',
    authorizePath: '/o/oauth2/v2/auth',
    tokenPath: '/token',
    jwksPath: '/oauth2/v3/certs',
    tokenIssuer: () => origin,
    stamped: {},
    extra: {
      claims_supported: [
        'iss',
        'sub',
        'aud',
        'exp',
        'iat',
        'nonce',
        'email',
        'email_verified',
        'hd',
      ],
    },
  };
}

/** A code handed to the browser, until the token endpoint takes it once. */
interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
  user: TestOidcUser;
  authTime: Date | undefined;
  tweaks: TestIdTokenTweaks;
}

const sha256Base64url = (value: string) => createHash('sha256').update(value).digest('base64url');

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json',
) {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The client a token request authenticates as (`client_secret_basic` or `client_secret_post`). */
function authenticatedClient(
  request: IncomingMessage,
  form: URLSearchParams,
  clients: readonly TestOidcClient[],
): TestOidcClient | null {
  const header = request.headers.authorization;
  let id = form.get('client_id');
  let secret = form.get('client_secret');
  if (header?.startsWith('Basic ') === true) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    id = decodeURIComponent(decoded.slice(0, colon));
    secret = decodeURIComponent(decoded.slice(colon + 1));
  }
  const client = clients.find((candidate) => candidate.clientId === id);
  return client?.clientSecret === secret ? client : null;
}

/** Starts a provider on `127.0.0.1` with keys generated for this run. */
export async function startTestOidcProvider(
  options: StartTestOidcProviderOptions,
): Promise<TestOidcProvider> {
  const { shape, clients } = options;
  const now = options.now ?? (() => new Date());
  const algorithm = options.algorithm ?? 'RS256';
  const key = await makeSigningKey(algorithm);
  // Never in the JWKS: a token it signs must be refused (C248.4: keys only from the issuer's JWKS).
  const foreignKey = await makeSigningKey(algorithm);
  const hmacSecret = await generateSecret('HS256');
  const codes = new Map<string, IssuedCode>();
  const served = { discovery: 0, jwks: 0, token: 0 };

  // The port is known once the server listens; the handler is attached after that.
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(port)}`;
  const layout = layoutOf(shape, origin, options.tenant);
  const discovery: Readonly<Record<string, unknown>> = {
    issuer: layout.issuer,
    authorization_endpoint: `${origin}${layout.authorizePath}`,
    token_endpoint: `${origin}${layout.tokenPath}`,
    jwks_uri: `${origin}${layout.jwksPath}`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: [algorithm],
    scopes_supported: ['openid', 'email', 'profile'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    ...layout.extra,
  };
  const advertisesIss = layout.extra.authorization_response_iss_parameter_supported === true;
  const authorizeEndpoint = `${origin}${layout.authorizePath}`;

  async function idTokenFor(code: IssuedCode): Promise<string> {
    const current = layout;
    const issuedAt = Math.floor(now().getTime() / 1000);
    const { tweaks, user } = code;
    const payload: Record<string, unknown> = {
      ...current.stamped,
      ...user.claims,
      iss: tweaks.issuer ?? current.tokenIssuer(user),
      sub: user.sub,
      aud: tweaks.audience ?? code.clientId,
      iat: issuedAt,
      exp: issuedAt + (tweaks.expiresInSeconds ?? 300),
      auth_time: Math.floor((code.authTime ?? now()).getTime() / 1000),
      ...(tweaks.nonce === null ? {} : { nonce: tweaks.nonce ?? code.nonce }),
      ...(user.email === undefined ? {} : { email: user.email }),
      ...(user.emailVerified === undefined ? {} : { email_verified: user.emailVerified }),
    };
    const signedWith = tweaks.algorithm ?? algorithm;
    if (signedWith === 'none') {
      return new UnsecuredJWT(payload).encode();
    }
    if (signedWith === 'HS256') {
      return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256', kid: key.kid })
        .sign(hmacSecret);
    }
    const signer = tweaks.foreignKey === true ? foreignKey : key;
    const signing = signedWith === signer.alg ? signer : await makeSigningKey(signedWith);
    return new SignJWT(payload)
      .setProtectedHeader({ alg: signing.alg, kid: signing.kid, typ: 'JWT' })
      .sign(signing.privateKey);
  }

  async function token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    served.token += 1;
    const form = new URLSearchParams(await readBody(request));
    const client = authenticatedClient(request, form, clients);
    if (client === null) {
      sendJson(response, 401, { error: 'invalid_client' });
      return;
    }
    if (form.get('grant_type') !== 'authorization_code') {
      sendJson(response, 400, { error: 'unsupported_grant_type' });
      return;
    }
    const value = form.get('code') ?? '';
    const code = codes.get(value);
    codes.delete(value);
    const verifier = form.get('code_verifier') ?? '';
    if (
      code?.clientId !== client.clientId ||
      code.redirectUri !== form.get('redirect_uri') ||
      sha256Base64url(verifier) !== code.codeChallenge
    ) {
      sendJson(response, 400, { error: 'invalid_grant' });
      return;
    }
    sendJson(response, 200, {
      access_token: randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'openid email profile',
      id_token: await idTokenFor(code),
    });
  }

  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    const current = layout;
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && path === current.discoveryPath) {
      served.discovery += 1;
      sendJson(response, 200, discovery);
    } else if (request.method === 'GET' && path === current.jwksPath) {
      served.jwks += 1;
      sendJson(response, 200, { keys: [key.publicJwk] });
    } else if (request.method === 'POST' && path === current.tokenPath) {
      token(request, response).catch(() => {
        sendJson(response, 500, { error: 'server_error' });
      });
    } else {
      sendJson(response, 404, { error: 'not_found' });
    }
  });
  return {
    shape,
    issuer: layout.issuer,
    discoveryUrl: `${origin}${layout.discoveryPath}`,
    origin,
    served,
    authorize(authorizationUrl, user, authorizeOptions = {}) {
      const url = new URL(authorizationUrl);
      const parameter = (name: string) => url.searchParams.get(name);
      if (`${url.origin}${url.pathname}` !== authorizeEndpoint) {
        throw new Error('the URL is not this provider’s authorization endpoint');
      }
      if (parameter('response_type') !== 'code') {
        throw new Error('response_type must be code');
      }
      const client = clients.find((candidate) => candidate.clientId === parameter('client_id'));
      if (client === undefined) {
        throw new Error('unknown client');
      }
      const redirectUri = parameter('redirect_uri') ?? '';
      if (!client.redirectUris.includes(redirectUri)) {
        throw new Error('redirect URI not registered for the client');
      }
      if (!(parameter('scope') ?? '').split(' ').includes('openid')) {
        throw new Error('scope must include openid');
      }
      const state = parameter('state');
      if (state === null) {
        throw new Error('state missing');
      }
      const nonce = parameter('nonce');
      if (nonce === null) {
        throw new Error('nonce missing');
      }
      const codeChallenge = parameter('code_challenge') ?? '';
      if (
        parameter('code_challenge_method') !== 'S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
      ) {
        throw new Error('PKCE with S256 is required');
      }
      const answer = new URLSearchParams();
      const iss =
        authorizeOptions.responseIss === undefined
          ? advertisesIss
            ? layout.issuer
            : null
          : authorizeOptions.responseIss;
      if (authorizeOptions.error !== undefined) {
        answer.set('error', authorizeOptions.error);
      } else {
        const code = randomBytes(32).toString('base64url');
        codes.set(code, {
          clientId: client.clientId,
          redirectUri,
          codeChallenge,
          nonce,
          user,
          authTime: authorizeOptions.authTime,
          tweaks: authorizeOptions.tweaks ?? {},
        });
        answer.set('code', code);
      }
      answer.set('state', state);
      if (iss !== null) {
        answer.set('iss', iss);
      }
      return answer;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        }),
      );
    },
  };
}
