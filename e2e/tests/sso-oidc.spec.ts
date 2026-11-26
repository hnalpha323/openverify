/**
 * C248, C287.3 (Workflow 11B, integration-11b): console sign-in through OIDC on the full stack, with
 * the in-process test provider (sso-oidc's `apps/api/src/test-support/oidc/`, an Okta-shaped
 * discovery document, keys made for this run, started by the spec on loopback). Budget: 90 s.
 *
 * The TOTP admin gives the dev organisation a sign-in name and adds the provider (with Phase 9's
 * step-up, which its MFA sign-in satisfies). The browser starts at `/sso/<name>/start` and is sent to
 * the provider's authorization endpoint; the spec answers that visit (`authorize` checks PKCE's
 * challenge, state and nonce, and answers the callback query), and the browser goes on to the
 * per-provider callback with its binding cookie. With just-in-time provisioning off, an unknown person is refused
 * (`sso-user-unknown`) and an existing operator with a verified email in the allowed domain is
 * linked and signed in; with it on, a new person is provisioned with its narrow default role and signed in.
 * Real identity providers are untested here and are the operator's to verify (C248.1). Every value is
 * synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { startTestOidcProvider } from '../../apps/api/src/test-support/oidc/provider.js';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { dashboardRequest } from './support/platform.js';
import { msUntilNextStep } from '../src/totp.js';
import { createOperator, freshTotpCode } from './support/ui.js';

const CLIENT_ID = 'e2e-sso-client';
const CLIENT_SECRET = `synthetic-sso-secret-${'x'.repeat(24)}`;

/** The TOTP admin signed in through the dashboard API with its second factor (a fresh step-up). */
async function mfaAdminToken(stack: StackInfo): Promise<string> {
  const first = await dashboardRequest(stack, 'POST', '/sessions', {
    body: { email: stack.mfaAdmin.email, password: stack.mfaAdmin.password },
  });
  expect(first.status).toBe(202);
  const challenge = first.body as { 'mfa-token': string };
  const answer = () =>
    freshTotpCode(stack.mfaAdmin.totpSecret).then((code) =>
      dashboardRequest(stack, 'POST', '/sessions/mfa', {
        body: { 'mfa-token': challenge['mfa-token'], 'totp-code': code },
      }),
    );
  let second = await answer();
  // Another process (an earlier spec run on this stack) may have used this TOTP step: the API
  // refuses a step used before (C15) and keeps the mfa-token, so the next step's code is sent.
  if (second.status === 401 && (second.body as { code?: string }).code === 'mfa_code_invalid') {
    await new Promise((resolve) => setTimeout(resolve, msUntilNextStep(new Date()) + 250));
    second = await answer();
  }
  expect(second.status, JSON.stringify(second.body)).toBe(201);
  return (second.body as { token: string }).token;
}

/** A browser of its own signs in through the provider as `user`; answers the URL it lands on. */
async function signInThroughProvider(
  browser: Browser,
  stack: StackInfo,
  slug: string,
  redirectUri: string,
  idp: Awaited<ReturnType<typeof startTestOidcProvider>>,
  user: { sub: string; email: string },
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // The browser is sent to the provider's authorization endpoint; the provider here has no login
    // page, so the spec answers that visit (`authorize` checks the PKCE challenge, state and nonce)
    // and the browser continues to the per-provider callback with its binding cookie.
    const visit = page.waitForRequest((request) => request.url().startsWith(idp.origin));
    await page.goto(`${stack.dashboardUrl}/sso/${slug}/start`);
    const query = idp.authorize((await visit).url(), {
      sub: user.sub,
      email: user.email,
      emailVerified: true,
    });
    await page.goto(`${redirectUri}?${query.toString()}`);
    await page.waitForURL((url) => !url.pathname.startsWith('/sso/'), { timeout: 20_000 });
    return page.url();
  } finally {
    await context.close();
  }
}

test('OIDC sign-in with just-in-time provisioning off and on (C248)', async ({ browser }) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const redirectUris: string[] = [];
  const idp = await startTestOidcProvider({
    shape: 'okta',
    clients: [{ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUris }],
  });
  const token = await mfaAdminToken(stack);
  let providerId: string | undefined;
  try {
    const slug = `e2e-sso-${randomUUID().slice(0, 8)}`;
    expect(
      (
        await dashboardRequest(stack, 'PATCH', '/settings', {
          token,
          body: { 'organization-slug': slug },
        })
      ).status,
    ).toBe(200);
    // A just-in-time role may not hold an administrative permission (C248.5), so a narrow role.
    const role = await dashboardRequest(stack, 'POST', '/roles', {
      token,
      body: {
        data: {
          type: 'role',
          attributes: {
            name: `e2e sso ${randomUUID().slice(0, 8)}`,
            permissions: ['inquiries:read'],
          },
        },
      },
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const jitRole = (role.body as { data: { id: string } }).data.id;
    const created = await dashboardRequest(stack, 'POST', '/sso-providers', {
      token,
      body: {
        data: {
          type: 'sso-provider',
          attributes: {
            'display-name': 'Synthetic Okta-shaped provider',
            issuer: idp.issuer,
            'client-id': CLIENT_ID,
            'client-secret': CLIENT_SECRET,
            'allowed-email-domains': ['example.test'],
          },
        },
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const provider = (
      created.body as { data: { id: string; attributes: { 'redirect-uri': string } } }
    ).data;
    providerId = provider.id;
    const redirectUri = provider.attributes['redirect-uri'];
    redirectUris.push(redirectUri);

    // Just-in-time off: an unknown person is refused, generically.
    const unknown = await signInThroughProvider(browser, stack, slug, redirectUri, idp, {
      sub: `sub-${randomUUID()}`,
      email: `unknown-${randomUUID().slice(0, 8)}@example.test`,
    });
    expect(unknown).toMatch(/\/login\?reason=sso-user-unknown$/);

    // An existing operator, matched once by its verified email and then linked by subject.
    const operator = await createOperator(stack, 'viewer');
    const linked = await signInThroughProvider(browser, stack, slug, redirectUri, idp, {
      sub: `sub-${randomUUID()}`,
      email: operator.email,
    });
    expect(linked).not.toMatch(/\/login/);

    // Just-in-time on, with the viewer role: a new person is provisioned and signed in.
    const jit = await dashboardRequest(stack, 'PATCH', `/sso-providers/${provider.id}`, {
      token,
      body: {
        data: {
          type: 'sso-provider',
          attributes: { 'jit-provisioning': true, 'default-role-ids': [jitRole] },
        },
      },
    });
    expect(jit.status, JSON.stringify(jit.body)).toBe(200);
    const jitEmail = `jit-${randomUUID().slice(0, 8)}@example.test`;
    const provisioned = await signInThroughProvider(browser, stack, slug, redirectUri, idp, {
      sub: `sub-${randomUUID()}`,
      email: jitEmail,
    });
    expect(provisioned).not.toMatch(/\/login/);
    const users = (await dashboardRequest(stack, 'GET', '/users?page[size]=100', { token }))
      .body as { data: { attributes: { email: string } }[] };
    expect(users.data.map((user) => user.attributes.email)).toContain(jitEmail);
    expect(idp.served.token).toBeGreaterThanOrEqual(2);
  } finally {
    if (providerId !== undefined) {
      await dashboardRequest(stack, 'DELETE', `/sso-providers/${providerId}`, { token });
    }
    await idp.close();
  }
});
