/**
 * C168.1, C168.4 (Phase 9, Workflow 9B; review P02, contracts B26): verifying a second factor again
 * on the current session, and what an enrolment does to the user's other sessions.
 *
 * - `POST /sessions/current/step-up` takes a TOTP code or a passkey assertion (never a recovery
 *   code), sets the session's `mfa_verified_at` and answers it with the end of the ten-minute window;
 *   a wrong code is 401 `mfa_code_invalid` and moves nothing; guesses count against the user's
 *   sign-in limit (429).
 * - `POST /sessions/current/step-up/webauthn/options` issues the assertion options; the assertion
 *   must answer a challenge issued to this user.
 * - Activating a factor sets `mfa_verified_at` on the enrolling session and revokes every other
 *   session of the user (C168.4).
 *
 * Every value is synthetic.
 */
import { STEP_UP_WINDOW_SECONDS, stepUpResponseSchema } from '@openverify/contracts';
import { userSessions } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSoftwareAuthenticator } from '../../operator-auth/testing/software-authenticator.js';
import { totpCode } from '../../operator-auth/totp.js';
import {
  WEBAUTHN,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function harness() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  return api;
}

const sessionsOf = (userId: string) =>
  database.db.select().from(userSessions).where(eq(userSessions.userId, userId));

/** An operator who enrolled a TOTP factor on a session it keeps. */
async function withTotp(api: DashboardHarness) {
  const organization = await api.organization();
  const operator = await api.operator(organization);
  const token = await api.signIn(operator.email);
  const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
    await api.call('POST', '/me/mfa-factors/totp', { token, payload: {} }),
    201,
  );
  expectJson(
    await api.call('POST', '/me/mfa-factors/totp/confirm', {
      token,
      payload: {
        'factor-id': enrolment.data.id,
        'totp-code': totpCode(enrolment.meta.secret, api.clock.now()),
      },
    }),
    200,
  );
  api.clock.advance(30_000);
  return { organization, operator, token, secret: enrolment.meta.secret };
}

const stepUp = (api: DashboardHarness, token: string, payload: unknown) =>
  api.call('POST', '/sessions/current/step-up', { token, payload });

describe('POST /sessions/current/step-up (C168.1)', () => {
  it('verifies a TOTP code on the current session, sets mfa_verified_at and answers the window', async () => {
    const api = await harness();
    const { organization, operator, token, secret } = await withTotp(api);
    const at = api.clock.now();

    const body = stepUpResponseSchema.parse(
      expectJson(await stepUp(api, token, { 'totp-code': totpCode(secret, at) }), 200),
    );

    expect(body).toEqual({
      'mfa-verified-at': at.toISOString(),
      'step-up-expires-at': new Date(at.getTime() + STEP_UP_WINDOW_SECONDS * 1000).toISOString(),
    });
    const [session] = await sessionsOf(operator.user.id);
    expect(session?.mfaVerifiedAt).toEqual(at);
    const [entry] = await api.audit(organization.sandboxId, 'user-session.stepped-up');
    expect(entry).toMatchObject({ resourceId: session?.id, metadata: { mfa: 'totp' } });
  });

  it('answers 401 mfa_code_invalid for a wrong or replayed code, moving nothing', async () => {
    const api = await harness();
    const { operator, token, secret } = await withTotp(api);
    const [before] = await sessionsOf(operator.user.id);
    const code = totpCode(secret, api.clock.now());
    expectJson(await stepUp(api, token, { 'totp-code': code }), 200);
    const [after] = await sessionsOf(operator.user.id);

    const replayed = await stepUp(api, token, { 'totp-code': code });
    const wrong = await stepUp(api, token, {
      'totp-code': code === '000000' ? '111111' : '000000',
    });

    for (const response of [replayed, wrong]) {
      expect(response.statusCode, response.body).toBe(401);
      expect(response.json()).toMatchObject({ code: 'mfa_code_invalid' });
    }
    expect(before?.mfaVerifiedAt).not.toEqual(after?.mfaVerifiedAt);
    const [latest] = await sessionsOf(operator.user.id);
    expect(latest?.mfaVerifiedAt).toEqual(after?.mfaVerifiedAt);
    // The session itself is still good.
    expect((await api.call('GET', '/me', { token })).statusCode).toBe(200);
  });

  it('refuses an operator with no factor, and a recovery code (400)', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);
    const token = await api.signIn(operator.email);

    const noFactor = await stepUp(api, token, { 'totp-code': '123456' });
    const recovery = await stepUp(api, token, { 'recovery-code': 'abcd-efgh-ijkl' });

    expect(noFactor.statusCode).toBe(401);
    expect(noFactor.json()).toMatchObject({ code: 'mfa_code_invalid' });
    expect(recovery.statusCode).toBe(400);
  });

  it('counts guesses against the user’s sign-in limit (429)', async () => {
    const api = await harness();
    const { token } = await withTotp(api);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await stepUp(api, token, { 'totp-code': '000000' })).statusCode);
    }

    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeGreaterThan(0);
  });

  it('verifies a passkey assertion for options it issued, and refuses a stranger’s', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);
    const token = await api.signIn(operator.email);
    const authenticator = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const { options: creation } = expectJson<{
      options: Parameters<typeof authenticator.register>[0];
    }>(await api.call('POST', '/me/mfa-factors/webauthn/options', { token, payload: {} }), 200);
    expectJson(
      await api.call('POST', '/me/mfa-factors/webauthn/verify', {
        token,
        payload: { credential: authenticator.register(creation), name: 'Synthetic key' },
      }),
      201,
    );
    api.clock.advance(60_000);
    const options = () =>
      api.call('POST', '/sessions/current/step-up/webauthn/options', { token, payload: {} });

    const issued = expectJson<{ options: Parameters<typeof authenticator.authenticate>[0] }>(
      await options(),
      200,
    );
    const stranger = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const refused = await stepUp(api, token, {
      credential: stranger.authenticate({ challenge: 'c3RyYW5nZXI', rpId: WEBAUTHN.rpId }),
    });
    const at = api.clock.now();
    const accepted = await stepUp(api, token, {
      credential: authenticator.authenticate(issued.options),
    });
    const replayed = await stepUp(api, token, {
      credential: authenticator.authenticate(issued.options),
    });

    expect(refused.statusCode, refused.body).toBe(401);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(stepUpResponseSchema.parse(accepted.json())['mfa-verified-at']).toBe(at.toISOString());
    expect(replayed.statusCode, replayed.body).toBe(401);
  });
});

describe('enrolling a factor (C168.1, C168.4)', () => {
  it('sets mfa_verified_at on the enrolling session and revokes the user’s other sessions', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);
    const other = await api.signIn(operator.email);
    const token = await api.signIn(operator.email);
    const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
      await api.call('POST', '/me/mfa-factors/totp', { token, payload: {} }),
      201,
    );
    const at = api.clock.now();

    expectJson(
      await api.call('POST', '/me/mfa-factors/totp/confirm', {
        token,
        payload: {
          'factor-id': enrolment.data.id,
          'totp-code': totpCode(enrolment.meta.secret, at),
        },
      }),
      200,
    );

    expect((await api.call('GET', '/me', { token: other })).statusCode).toBe(401);
    expect((await api.call('GET', '/me', { token })).statusCode).toBe(200);
    const sessions = await sessionsOf(operator.user.id);
    const live = sessions.filter((session) => session.revokedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0]?.mfaVerifiedAt).toEqual(at);
    const [entry] = await api.audit(organization.sandboxId, 'user-session.others-revoked');
    expect(entry).toMatchObject({ metadata: { revoked: 1, reason: 'mfa-factor-enrolled' } });
  });
});
