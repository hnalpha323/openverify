/**
 * C248.3-C248.7 (Workflow 11B, `sso-oidc`): the SSO routes over the dashboard harness and an
 * in-process Okta-shaped provider on 127.0.0.1 (rule 9: keys made per run, synthetic users).
 *
 * - The start and the callback as the console's handlers call them: one generic problem per
 *   failure, a session (201), the local factor (202) or a step-up (200).
 * - The providers: read with `settings:read`, changed with `settings:write` and the step-up, the
 *   client secret never served.
 * - KP11-18: an SSO session without a fresh re-authentication gets 403 `step_up_required` from the
 *   Connect activation, and passes after the SSO step-up (C231.3, C248.6).
 */
import { readFileSync } from 'node:fs';
import {
  SSO_BINDING_HEADER,
  dashboardMfaChallengeResponseSchema,
  dashboardSessionResponseSchema,
  newId,
  problemSchema,
  ssoRedirectSchema,
  ssoStartResponseSchema,
  stepUpResponseSchema,
} from '@openverify/contracts';
import { createConnection, createSsoProvider, setOrganizationSlug } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOutboundHttp, type OutboundHttp } from '../../http/index.js';
import { ssoRedirectUri } from '../../operator-auth/oidc/service.js';
import { totpCode } from '../../operator-auth/totp.js';
import {
  startTestOidcProvider,
  type TestOidcProvider,
  type TestOidcUser,
} from '../../test-support/oidc/provider.js';
import {
  DASHBOARD_URL,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

const SECRET = 'synthetic-client-secret-canary';
const CLIENT_ID = 'synthetic-client-id';
const POLICY = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/api/connect/share-policy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../contracts/fixtures/api/sso/${name}`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;

let database: TestDatabase;
let outbound: OutboundHttp;
let api: DashboardHarness;
let idp: TestOidcProvider;
const redirectUris: string[] = [];
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  outbound = createOutboundHttp();
  api = await createDashboardHarness(database, {
    connect: { enabled: true },
    sso: { outboundHttp: outbound, privateIssuers: [], production: false },
  });
  idp = await startTestOidcProvider({
    shape: 'okta',
    clients: [{ clientId: CLIENT_ID, clientSecret: SECRET, redirectUris }],
    now: () => api.clock.now(),
  });
}, 120_000);

afterAll(async () => {
  await idp.close();
  await api.close();
  await outbound.close();
  await database.close();
});

/** An organisation with a sign-in name, one admin and an Okta-shaped provider needing `mfa`. */
async function organisation(options: { requireMfa?: boolean } = {}) {
  const organization = await api.organization({
    production: true,
    ...(options.requireMfa === true ? { requireMfa: true } : {}),
  });
  counter += 1;
  const slug = `synthetic-sso-${String(counter)}`;
  await setOrganizationSlug(database.db, organization.id, slug);
  const admin = await api.operator(organization, { roles: ['admin'] });
  const providerId = newId('ssop');
  redirectUris.push(ssoRedirectUri(DASHBOARD_URL, providerId) ?? '');
  await createSsoProvider(database.db, {
    id: providerId,
    organizationId: organization.id,
    displayName: 'Workforce',
    issuer: idp.issuer,
    clientId: CLIENT_ID,
    clientSecret: SECRET,
    allowedEmailDomains: ['example.test'],
    tenantPinClaim: null,
    tenantPinValue: null,
    requiredAmr: ['mfa'],
    requiredAcr: [],
    jitProvisioning: false,
    defaultRoleIds: [],
    enforced: false,
    at: api.clock.now(),
  });
  return { organization, slug, providerId, admin };
}

const person = (email: string, amr: readonly string[]): TestOidcUser => ({
  sub: `subject-${email}`,
  email,
  emailVerified: true,
  claims: { amr: [...amr] },
});

async function start(slug: string) {
  const answer = ssoStartResponseSchema.parse(
    expectJson(await api.call('GET', `/sso/${slug}/start`), 200),
  );
  if (answer.kind !== 'redirect') {
    throw new Error('expected a redirect');
  }
  return answer;
}

function callback(providerId: string, query: URLSearchParams, binding: string | undefined) {
  return api.call('GET', `/sso/callback/${providerId}?${query.toString()}`, {
    headers: binding === undefined ? {} : { [SSO_BINDING_HEADER]: binding },
  });
}

async function ssoSignIn(slug: string, providerId: string, user: TestOidcUser) {
  const started = await start(slug);
  const query = idp.authorize(started['authorization-url'], user);
  return callback(providerId, query, started.binding);
}

describe('the SSO start and callback (C248.4, C248.7)', () => {
  it('signs in a user linked by a verified email and answers its session', async () => {
    const { slug, providerId, admin } = await organisation();

    const response = await ssoSignIn(slug, providerId, person(admin.email, ['mfa']));

    const session = dashboardSessionResponseSchema.parse(expectJson(response, 201));
    expect(session.user.id).toBe(admin.user.id);
    expect(response.headers['cache-control']).toBe('no-store');
    expectJson(await api.call('GET', '/me', { token: session.token }), 200);
  });

  it('asks a require-mfa organisation’s user for the local factor when amr falls short', async () => {
    const { slug, providerId, organization } = await organisation({ requireMfa: true });
    const operator = await api.operator(organization, { roles: ['admin'] });
    const enrolment = await api.operatorAuth.mfa.enrollTotp(organization.id, operator.user);
    await api.operatorAuth.mfa.confirmTotp(
      organization.id,
      operator.user.id,
      enrolment.factor.id,
      totpCode(enrolment.secret, api.clock.now()),
    );

    const response = await ssoSignIn(slug, providerId, person(operator.email, ['pwd']));

    expect(dashboardMfaChallengeResponseSchema.parse(expectJson(response, 202))).toMatchObject({
      factors: [{ id: enrolment.factor.id, type: 'totp' }],
    });
  });

  it('answers one generic problem per failure: unknown name, missing binding, replay', async () => {
    const { slug, providerId, admin } = await organisation();

    const unknown = await api.call('GET', '/sso/synthetic-nobody-here/start');
    expect(unknown.statusCode).toBe(404);
    expect(problemSchema.parse(unknown.json())).toMatchObject({ code: 'sso_not_configured' });

    const started = await start(slug);
    const query = idp.authorize(started['authorization-url'], person(admin.email, ['mfa']));
    const missing = await callback(providerId, query, undefined);
    expect(missing.statusCode).toBe(400);
    expect(problemSchema.parse(missing.json())).toMatchObject({ code: 'sso_state_invalid' });

    expect((await callback(providerId, query, started.binding)).statusCode).toBe(201);
    const replay = await callback(providerId, query, started.binding);
    expect(replay.statusCode).toBe(400);
    expect(problemSchema.parse(replay.json())).toMatchObject({
      code: 'sso_state_invalid',
      detail: 'The sign-in attempt could not be matched. Start signing in again.',
    });
    expect(replay.body).not.toContain(admin.email);
  });

  it('refuses an email outside the provider’s domains as an unknown user', async () => {
    const { slug, providerId } = await organisation();

    const response = await ssoSignIn(slug, providerId, person('someone@example.org', ['mfa']));

    expect(response.statusCode).toBe(403);
    expect(problemSchema.parse(response.json())).toMatchObject({ code: 'sso_user_unknown' });
  });
});

describe('the SSO providers (C248.3)', () => {
  it('lists without the secret, and changes only after the step-up', async () => {
    const { organization, admin } = await organisation();
    const token = await api.signIn(admin.email);

    const listed = expectJson<{ data: { attributes: Record<string, unknown> }[] }>(
      await api.call('GET', '/sso-providers', { token }),
      200,
    );
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.attributes).toMatchObject({ 'client-secret-set': true });
    expect(JSON.stringify(listed)).not.toContain(SECRET);

    const refused = await api.call('POST', '/sso-providers', {
      token,
      payload: fixture('provider-create.json'),
    });
    expect(refused.statusCode).toBe(403);
    expect(problemSchema.parse(refused.json())).toMatchObject({ code: 'step_up_required' });

    // After a TOTP step-up: add, read, change and remove, the secret never served.
    const enrolment = await api.operatorAuth.mfa.enrollTotp(organization.id, admin.user);
    await api.operatorAuth.mfa.confirmTotp(
      organization.id,
      admin.user.id,
      enrolment.factor.id,
      totpCode(enrolment.secret, api.clock.now()),
    );
    api.clock.advance(30_000);
    expectJson(
      await api.call('POST', '/sessions/current/step-up', {
        token,
        payload: { 'totp-code': totpCode(enrolment.secret, api.clock.now()) },
      }),
      200,
    );
    const created = expectJson<{ data: { id: string; attributes: Record<string, unknown> } }>(
      await api.call('POST', '/sso-providers', { token, payload: fixture('provider-create.json') }),
      201,
    );
    expect(created.data.id).toMatch(/^ssop_/);
    const path = `/sso-providers/${created.data.id}`;
    expectJson(await api.call('GET', path, { token }), 200);
    const changed = await api.call('PATCH', path, {
      token,
      payload: fixture('provider-update.json'),
    });
    expect(changed.statusCode, changed.body).toBe(200);
    for (const body of [JSON.stringify(created), changed.body]) {
      expect(body).not.toContain('synthetic-client-secret-change-me');
      expect(body).not.toContain('synthetic-rotated-client-secret');
    }
    expect((await api.call('DELETE', path, { token })).statusCode).toBe(204);
    expect((await api.call('GET', path, { token })).statusCode).toBe(404);
  });
});

describe('the SSO step-up reaches the Connect activation (KP11-18; C231.3, C248.6)', () => {
  it('refuses an SSO session without a fresh re-authentication, and passes after one', async () => {
    const { organization, slug, providerId, admin } = await organisation();
    const source = await api.organization({ production: true });
    const connectionId = newId('cxn');
    await database.db.transaction((tx) =>
      createConnection(tx, {
        id: connectionId,
        sourceOrganizationId: source.id,
        destinationOrganizationId: organization.id,
        creatorType: 'api-key',
        creatorId: newId('key'),
        policyId: newId('cxnp'),
        policy: POLICY,
      }),
    );
    const activate = (token: string) =>
      api.call('POST', `/connect/connections/${connectionId}/activate`, {
        token,
        payload: {
          data: {
            attributes: {
              'policy-version': 1,
              'agreement-reference': 'Example data-sharing agreement (synthetic)',
              acknowledged: true,
            },
          },
        },
      });
    // A sign-in whose token did not meet `required-amr` starts no step-up window.
    const { token } = dashboardSessionResponseSchema.parse(
      expectJson(await ssoSignIn(slug, providerId, person(admin.email, ['pwd'])), 201),
    );

    const before = await activate(token);
    expect(before.statusCode, before.body).toBe(403);
    expect(problemSchema.parse(before.json())).toMatchObject({ code: 'step_up_required' });

    const redirect = ssoRedirectSchema.parse(
      expectJson(
        await api.call('POST', '/sessions/current/step-up/sso', { token, payload: {} }),
        200,
      ),
    );
    const url = new URL(redirect['authorization-url']);
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('max_age')).toBe('0');
    const query = idp.authorize(url, person(admin.email, ['mfa']));
    const stepped = stepUpResponseSchema.parse(
      expectJson(await callback(providerId, query, redirect.binding), 200),
    );
    expect(stepped['mfa-verified-at']).toBe(api.clock.now().toISOString());

    const after = await activate(token);
    expect(after.statusCode, after.body).toBe(200);
  });
});
