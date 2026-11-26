/**
 * C248.2-C248.4 (Phase 11, Workflow 11B, `sso-oidc`): the authorization code flow through
 * `openid-client` 6.8.8, with PKCE `S256`, `state` and `nonce`.
 *
 * - **Outbound** (C248.3; review P19): discovery, the JWKS and the token call go through the
 *   SSRF-guarded client of `apps/api/src/http/` (vetted DNS answers, no redirect followed, a 1 MiB
 *   cap, 10 s): private and loopback addresses and plain `http` outside production only; in
 *   production a private address only for an issuer the install names in
 *   `OPENVERIFY_SSO_PRIVATE_ISSUERS`, and `https` always.
 * - **Discovery** is read by the platform itself, so the document's `issuer` must be exactly the
 *   stored one (or the Entra shape's `{tenantid}` template filled with the provider's `tid` pin), a
 *   multi-tenant issuer needs its tenant pin, and the algorithms the document lists are narrowed to
 *   RS256, ES256, PS256 and EdDSA (`SSO_ID_TOKEN_ALGORITHMS`; never `none` or an HMAC).
 * - **The ID token** is verified by the library: issuer, audience, `nonce`, expiry, `auth_time`
 *   against `max_age` for a step-up, the signature only by a key of the issuer's JWKS (its
 *   non-repudiation checks, which the library leaves off for a token endpoint by default, are turned
 *   on), and RFC 9207's
 *   `iss` response parameter where the document advertises it. The library's clock is the platform's
 *   injected clock (its `clockSkew`), so both judge time alike.
 *
 * Errors are {@link SsoFlowError}s whose precise code never carries a value from the provider.
 */
import { SSO_ID_TOKEN_ALGORITHMS } from '@openverify/contracts';
import * as oidc from 'openid-client';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import type { Clock } from '../../ports.js';
import type { IdTokenClaims } from './claims.js';
import { SsoFlowError } from './failures.js';
import {
  SHARED_ISSUERS,
  TENANT_ID_PLACEHOLDER,
  discoveryUrlOf,
  expectedIdTokenIssuer,
  isMultiTenantIssuer,
  type SsoTenantPin,
} from './issuer.js';

/** The scopes every sign-in asks for. */
export const SSO_SCOPES = 'openid email profile';

/** Where the platform may reach an issuer (C248.3). */
export interface OidcOutboundPolicy {
  /** Production mode: `https` only, private addresses only for {@link privateIssuers}. */
  production: boolean;
  /** `OPENVERIFY_SSO_PRIVATE_ISSUERS`: exact issuers allowed a private address in production. */
  privateIssuers: readonly string[];
}

/** What the platform holds of one provider to talk to it. */
export interface OidcProviderSettings {
  issuer: string;
  clientId: string;
  /** Opened from its sealed column for this call only. */
  clientSecret: string;
  tenantPin: SsoTenantPin | null;
}

/** A provider whose discovery document was read and checked. */
export interface DiscoveredOidcProvider {
  /** The `iss` every ID token must carry. */
  readonly expectedIssuer: string;
  /** The library's configuration, its clock set to the platform's injected clock as of now. */
  configuration(): oidc.Configuration;
}

export interface AuthorizationRequest {
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** C248.6: a re-authentication (`prompt=login`, `max_age=0`). */
  reauthenticate: boolean;
}

export interface CodeExchange {
  redirectUri: string;
  /** The provider's callback query, as the browser brought it. */
  query: URLSearchParams;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** C248.6: the oldest `auth_time` the library accepts (a step-up's window); none otherwise. */
  maxAgeSeconds?: number | undefined;
}

export interface OidcClientOptions {
  outbound: OutboundHttp;
  policy: OidcOutboundPolicy;
  clock: Clock;
  /** Shared issuers that need a tenant pin; defaults to `SHARED_ISSUERS`. */
  sharedIssuers?: readonly string[] | undefined;
}

export interface OidcClient {
  /** @throws {SsoFlowError} `discovery_failed`, `issuer_mismatch`, `tenant_pin_missing`, ... */
  discover(settings: OidcProviderSettings): Promise<DiscoveredOidcProvider>;
  /** The URL the browser is sent to. */
  authorizationUrl(
    provider: DiscoveredOidcProvider,
    request: AuthorizationRequest,
  ): Promise<string>;
  /**
   * The verified ID token's claims.
   * @throws {SsoFlowError} `provider_error` for an error answer, `token_exchange_failed` otherwise.
   */
  exchange(provider: DiscoveredOidcProvider, exchange: CodeExchange): Promise<IdTokenClaims>;
}

/** What the SSRF-guarded client may reach for one issuer (C248.3; review P19). */
export interface OidcOutboundAllowance {
  allowPrivateNetworks: boolean;
  allowPlainHttp: boolean;
}

export function outboundAllowanceFor(
  issuer: string,
  policy: OidcOutboundPolicy,
): OidcOutboundAllowance {
  if (!policy.production) {
    return { allowPrivateNetworks: true, allowPlainHttp: true };
  }
  return { allowPrivateNetworks: policy.privateIssuers.includes(issuer), allowPlainHttp: false };
}

/**
 * The ID token algorithms the platform accepts from a discovery document's
 * `id_token_signing_alg_values_supported` (RS256 when it lists none, as OpenID Connect Discovery
 * says), narrowed to `SSO_ID_TOKEN_ALGORITHMS`.
 */
export function idTokenAlgorithmsOf(listed: unknown): string[] {
  const values: unknown[] = listed === undefined ? ['RS256'] : Array.isArray(listed) ? listed : [];
  return SSO_ID_TOKEN_ALGORITHMS.filter((algorithm) => values.includes(algorithm));
}

/** The media types discovery, the JWKS and the token endpoint answer with. */
const OIDC_CONTENT_TYPES = ['application/json', 'application/jwk-set+json'];

/** A body `openid-client` hands its fetch, as the outbound client takes it. */
function requestBody(body: oidc.FetchBody): string | Uint8Array | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }
  // A stream is never sent by the authorization code flow.
  throw new SsoFlowError('token_exchange_failed');
}

/** The library's fetch, through one SSRF-guarded outbound client (no redirect, capped, timed). */
function fetchThrough(client: OutboundHttpClient): oidc.CustomFetch {
  return async (url, options) => {
    const method = options.method.toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      throw new SsoFlowError('token_exchange_failed');
    }
    const body = requestBody(options.body);
    const answer = await client.request({
      method,
      url,
      headers: options.headers,
      ...(body === undefined ? {} : { body }),
    });
    const empty = answer.status === 204 || answer.status === 205 || answer.status === 304;
    return new Response(empty ? null : Buffer.from(answer.body), {
      status: answer.status,
      headers: answer.contentType === null ? {} : { 'content-type': answer.contentType },
    });
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEndpoint = (value: unknown): value is string => typeof value === 'string' && value !== '';

export function createOidcClient(options: OidcClientOptions): OidcClient {
  const { outbound, policy, clock } = options;
  const sharedIssuers = options.sharedIssuers ?? SHARED_ISSUERS;
  // One outbound client per allowance, made once: each holds its own connection pool.
  const clients = new Map<string, OutboundHttpClient>();

  function clientFor(issuer: string): OutboundHttpClient {
    const allowance = outboundAllowanceFor(issuer, policy);
    const key = `${String(allowance.allowPrivateNetworks)}:${String(allowance.allowPlainHttp)}`;
    let client = clients.get(key);
    if (client === undefined) {
      client = outbound.client({
        name: 'sso-oidc',
        contentTypes: OIDC_CONTENT_TYPES,
        ...allowance,
      });
      clients.set(key, client);
    }
    return client;
  }

  async function readDiscovery(issuer: string): Promise<Record<string, unknown>> {
    try {
      const answer = await clientFor(issuer).request({
        method: 'GET',
        url: discoveryUrlOf(issuer),
        headers: { accept: 'application/json' },
      });
      const document: unknown =
        answer.status === 200 ? JSON.parse(Buffer.from(answer.body).toString('utf8')) : null;
      if (isRecord(document)) {
        return document;
      }
    } catch {
      // Unreachable, refused by the guard, too large or not JSON: the same refusal.
    }
    throw new SsoFlowError('discovery_failed');
  }

  function clientAuthOf(document: Record<string, unknown>, secret: string): oidc.ClientAuth {
    const methods = document.token_endpoint_auth_methods_supported;
    // OpenID Connect Discovery: absent means client_secret_basic.
    if (
      methods === undefined ||
      (Array.isArray(methods) && methods.includes('client_secret_basic'))
    ) {
      return oidc.ClientSecretBasic(secret);
    }
    if (Array.isArray(methods) && methods.includes('client_secret_post')) {
      return oidc.ClientSecretPost(secret);
    }
    throw new SsoFlowError('client_auth_unsupported');
  }

  return {
    async discover(settings) {
      const document = await readDiscovery(settings.issuer);
      const discovered = document.issuer;
      if (
        !isEndpoint(discovered) ||
        !isEndpoint(document.authorization_endpoint) ||
        !isEndpoint(document.token_endpoint) ||
        !isEndpoint(document.jwks_uri)
      ) {
        throw new SsoFlowError('discovery_failed');
      }
      const multiTenant =
        isMultiTenantIssuer(settings.issuer, sharedIssuers) ||
        discovered.includes(TENANT_ID_PLACEHOLDER);
      if (multiTenant && settings.tenantPin === null) {
        throw new SsoFlowError('tenant_pin_missing');
      }
      const expectedIssuer = expectedIdTokenIssuer(settings.issuer, discovered, settings.tenantPin);
      if (expectedIssuer === null) {
        throw new SsoFlowError('issuer_mismatch');
      }
      const algorithms = idTokenAlgorithmsOf(document.id_token_signing_alg_values_supported);
      if (algorithms.length === 0) {
        throw new SsoFlowError('algorithms_unsupported');
      }
      const clientAuth = clientAuthOf(document, settings.clientSecret);
      // The library checks the ID token's `iss` (and RFC 9207's) against this issuer, and its
      // signature algorithm against this list, before any claim is read.
      const server = {
        ...document,
        issuer: expectedIssuer,
        id_token_signing_alg_values_supported: algorithms,
      } as oidc.ServerMetadata;
      const fetch = fetchThrough(clientFor(settings.issuer));
      return {
        expectedIssuer,
        configuration() {
          const skewSeconds = Math.round((clock.now().getTime() - Date.now()) / 1000);
          const configuration = new oidc.Configuration(
            server,
            settings.clientId,
            { client_secret: settings.clientSecret, [oidc.clockSkew]: skewSeconds },
            clientAuth,
          );
          configuration[oidc.customFetch] = fetch;
          // C248.4 (ASVS 9.1.2, 9.1.3): the ID token's signature is verified by a key of the
          // issuer's JWKS, never left to the transport (the library's default for a token endpoint).
          oidc.enableNonRepudiationChecks(configuration);
          if (!policy.production) {
            // Outside production only: the in-process and development providers speak plain http.
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- marked so it stands out, not withdrawn
            oidc.allowInsecureRequests(configuration);
          }
          return configuration;
        },
      };
    },

    async authorizationUrl(provider, request) {
      const parameters: Record<string, string> = {
        response_type: 'code',
        redirect_uri: request.redirectUri,
        scope: SSO_SCOPES,
        state: request.state,
        nonce: request.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(request.codeVerifier),
        code_challenge_method: 'S256',
      };
      if (request.reauthenticate) {
        // C248.6: a fresh authentication at the provider, whatever its own session holds.
        parameters.prompt = 'login';
        parameters.max_age = '0';
      }
      return oidc.buildAuthorizationUrl(provider.configuration(), parameters).href;
    },

    async exchange(provider, exchange) {
      if (exchange.query.has('error')) {
        throw new SsoFlowError('provider_error');
      }
      const current = new URL(exchange.redirectUri);
      current.search = exchange.query.toString();
      try {
        const tokens = await oidc.authorizationCodeGrant(provider.configuration(), current, {
          pkceCodeVerifier: exchange.codeVerifier,
          expectedState: exchange.state,
          expectedNonce: exchange.nonce,
          idTokenExpected: true,
          ...(exchange.maxAgeSeconds === undefined ? {} : { maxAge: exchange.maxAgeSeconds }),
        });
        const claims = tokens.claims();
        if (claims === undefined) {
          throw new SsoFlowError('token_exchange_failed');
        }
        return { ...claims };
      } catch {
        // The library's own error names the check that failed; none of it reaches the browser.
        throw new SsoFlowError('token_exchange_failed');
      }
    },
  };
}
