/**
 * Dashboard UI helpers for the C24 specs: signing in through the dashboard as each seeded role
 * (and with TOTP or a security key), creating a fresh operator through an invitation, and a
 * Chromium virtual authenticator for WebAuthn.
 *
 * The dashboard is opened on `stack.dashboardUrl` (`localhost`, the run's WebAuthn origin).
 */
import { randomUUID } from 'node:crypto';
import { expect, type CDPSession, type Page } from '@playwright/test';
import { waitForMail } from '../../src/mailpit.js';
import {
  createSessionKeeper,
  type KeptSession,
  type SessionKeeper,
} from '../../src/session-keeper.js';
import type { StackInfo } from '../../src/stack-info.js';
import { msUntilNextStep, totpCode, totpStep } from '../../src/totp.js';
import { dashboardRequest, signInToApi } from './platform.js';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export type SeededRole = keyof StackInfo['operators'];
export type BuiltinRoleKey = 'admin' | 'developer' | 'reviewer' | 'viewer';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The persistent environment banner every console page shows (C21). */
export function environmentBanner(page: Page) {
  return page.getByRole('status', { name: 'Environment' });
}

/** Fills and submits the sign-in form. With MFA the browser lands on `/login/mfa`. */
export async function submitLogin(page: Page, stack: StackInfo, credentials: Credentials) {
  await page.goto(`${stack.dashboardUrl}/login`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to OpenVerify' }),
  ).toBeVisible();
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Waits until the browser is in the console: past sign-in, with the console header. */
export async function expectConsole(page: Page) {
  await expect(page).not.toHaveURL(/\/login(\/|\?|$)/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(environmentBanner(page)).toBeVisible();
}

/** Signs an operator without MFA in through the dashboard. */
export async function signInThroughUi(page: Page, stack: StackInfo, credentials: Credentials) {
  await submitLogin(page, stack, credentials);
  await expectConsole(page);
}

/**
 * The dashboard's session cookie (`apps/dashboard/src/lib/session-cookie.ts`): the e2e stack serves
 * a production build, whose session cookie is Secure and so named with the `__Host-` prefix (KP11-78).
 */
const SESSION_COOKIE = '__Host-openverify_session';

let keeper: SessionKeeper<SeededRole> | undefined;

/**
 * The seeded operators' sessions, kept for the run (Workflow 5C review P021): every sign-in
 * attempt counts against the API's login limits (C4: 10 per email and 50 per address in 15
 * minutes), which the whole full-stack suite shares from 127.0.0.1.
 */
function sessionKeeper(stack: StackInfo): SessionKeeper<SeededRole> {
  keeper ??= createSessionKeeper<SeededRole>({
    currentEnvironment: async (token) => {
      const me = await dashboardRequest(stack, 'GET', '/me', { token });
      return me.status === 200
        ? (me.body as { meta: { environment: { id: string } } }).meta.environment.id
        : null;
    },
    switchEnvironment: async (token, environmentId) => {
      const answer = await dashboardRequest(stack, 'PUT', '/sessions/current/environment', {
        token,
        body: { 'environment-id': environmentId },
      });
      if (answer.status !== 200) {
        throw new Error(`Switching the kept session back answered ${String(answer.status)}`);
      }
    },
  });
  return keeper;
}

/** A new session's token with the environment its sign-in opened. */
async function keptSessionOf(stack: StackInfo, token: string): Promise<KeptSession> {
  const me = await dashboardRequest(stack, 'GET', '/me', { token });
  if (me.status !== 200) {
    throw new Error(`The new session answered ${String(me.status)} on /me`);
  }
  return {
    token,
    environmentId: (me.body as { meta: { environment: { id: string } } }).meta.environment.id,
  };
}

/**
 * Signs in as one of the seeded operators (admin, developer, reviewer, viewer): through the
 * dashboard the first time in the run, then with the kept session, opening the console where a
 * sign-in lands (`/`).
 */
export async function signInAs(page: Page, stack: StackInfo, role: SeededRole) {
  const attempt = { signedIn: false };
  const { token } = await sessionKeeper(stack).session(role, async () => {
    attempt.signedIn = true;
    await signInThroughUi(page, stack, stack.operators[role]);
    const cookie = (await page.context().cookies(stack.dashboardUrl)).find(
      (candidate) => candidate.name === SESSION_COOKIE,
    );
    if (cookie === undefined) {
      throw new Error('The dashboard set no session cookie');
    }
    return keptSessionOf(stack, cookie.value);
  });
  if (attempt.signedIn) {
    // This call signed in through the dashboard: the page is in the console already.
    return;
  }
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      // A Secure cookie is planted by host and path: Chromium refuses one given with an http URL,
      // and sends it to http://localhost, a potentially trustworthy origin.
      domain: new URL(stack.dashboardUrl).hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(`${stack.dashboardUrl}/`);
  await expectConsole(page);
}

/**
 * The `ovu_` token of a seeded operator's kept session, which the dashboard and server APIs
 * accept (C12), signed in through the dashboard API when the run keeps none yet.
 */
export async function sessionTokenAs(stack: StackInfo, role: SeededRole): Promise<string> {
  const { token } = await sessionKeeper(stack).session(role, async () =>
    keptSessionOf(stack, await signInToApi(stack, stack.operators[role])),
  );
  return token;
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** The last TOTP step this process used per secret: the API refuses a step used before (C15). */
const usedSteps = new Map<string, number>();

/**
 * A code for `secret` from a step this process has not used yet, waiting for the next step when
 * needed (at most 30 seconds).
 */
export async function freshTotpCode(secret: string): Promise<string> {
  let now = new Date();
  const last = usedSteps.get(secret);
  while (last !== undefined && totpStep(now) <= last) {
    await sleep(msUntilNextStep(now) + 250);
    now = new Date();
  }
  usedSteps.set(secret, totpStep(now));
  return totpCode(secret, now);
}

/** The refusal `/login/mfa` shows for a code the API did not accept (C25.1). */
export function mfaCodeRefusal(page: Page) {
  return page.getByText(/^That code is not valid\./);
}

/**
 * Submits one code and waits for this submission's own answer: the console, or a refusal. The
 * page hides the previous refusal while a code is checked (the API counts the attempts, so every
 * refusal reads the same, C25.1), so once the server action has answered, a refusal on the page
 * is this code's.
 */
export async function submitTotpCode(page: Page, code: string): Promise<'signed-in' | 'refused'> {
  await page.getByLabel('Authentication code').fill(code);
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/login/mfa',
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Verify' }).click();
  await answered;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!new URL(page.url()).pathname.startsWith('/login')) {
      return 'signed-in';
    }
    if (await mfaCodeRefusal(page).isVisible()) {
      return 'refused';
    }
    await page.waitForTimeout(200);
  }
  throw new Error('The dashboard did not answer the authenticator code within 30 seconds');
}

/**
 * On `/login/mfa`: enters a current authenticator code and waits for the console. A code of a
 * step another sign-in already used (another spec, the enrolment) is refused as a replay; the
 * next step's code is then tried, once.
 */
export async function enterTotpCode(page: Page, secret: string) {
  if ((await submitTotpCode(page, await freshTotpCode(secret))) === 'refused') {
    await submitTotpCode(page, await freshTotpCode(secret));
  }
  await expectConsole(page);
}

/** Signs in through the dashboard with the password, then a TOTP code of `secret` (C22). */
export async function signInWithTotp(
  page: Page,
  stack: StackInfo,
  credentials: Credentials,
  secret: string,
) {
  await submitLogin(page, stack, credentials);
  await expect(page).toHaveURL(/\/login\/mfa$/);
  await enterTotpCode(page, secret);
}

/** Signs in as the seeded TOTP-enrolled admin (`seed:dev --mfa-admin`). */
export function signInAsMfaAdmin(page: Page, stack: StackInfo) {
  return signInWithTotp(page, stack, stack.mfaAdmin, stack.mfaAdmin.totpSecret);
}

export interface VirtualAuthenticator {
  readonly id: string;
  /** How many credentials the authenticator holds. */
  credentialCount(): Promise<number>;
  remove(): Promise<void>;
}

/**
 * Adds a Chromium virtual authenticator to `page` over CDP: a platform authenticator (CTAP2,
 * internal transport) with user verification that always succeeds, which answers WebAuthn
 * ceremonies on its own. It lives as long as the page.
 */
export async function addVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    id: authenticatorId,
    async credentialCount() {
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      return credentials.length;
    },
    async remove() {
      await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      await cdp.detach();
    },
  };
}

export interface CreatedOperator extends Credentials {
  readonly name: string;
}

/**
 * A new operator with a built-in role, through the C15 invitation: the seeded admin invites,
 * the email arrives in Mailpit, and the invitee accepts through the dashboard API. Specs that
 * change an operator (MFA enrolment) use one, so the seeded operators stay as the seed left them.
 */
export async function createOperator(
  stack: StackInfo,
  role: BuiltinRoleKey,
): Promise<CreatedOperator> {
  const adminToken = await sessionTokenAs(stack, 'admin');
  const roles = await dashboardRequest(stack, 'GET', '/roles', { token: adminToken });
  const roleId = (
    roles.body as { data: { id: string; attributes: { key: string | null } }[] }
  ).data.find((candidate) => candidate.attributes.key === role)?.id;
  if (roleId === undefined) {
    throw new Error(`No built-in role ${role}`);
  }
  const suffix = randomUUID().slice(0, 8);
  const email = `ui-${role}-${suffix}@example.test`;
  const invited = await dashboardRequest(stack, 'POST', '/users/invitations', {
    token: adminToken,
    body: { email, 'role-ids': [roleId] },
  });
  if (invited.status !== 201) {
    throw new Error(`The invitation answered ${String(invited.status)}`);
  }
  const mail = await waitForMail(stack.mailpitUrl, email, { timeoutMs: 30_000 });
  const token = /#token=(ovi_[A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === undefined) {
    throw new Error('The invitation email carries no invitation link');
  }
  const operator = { email, password: `e2e-${randomUUID()}`, name: `UI ${role} ${suffix}` };
  const accepted = await dashboardRequest(stack, 'POST', '/invitations/accept', {
    body: { token, password: operator.password, name: operator.name },
  });
  if (accepted.status !== 200) {
    throw new Error(`Accepting the invitation answered ${String(accepted.status)}`);
  }
  return operator;
}
