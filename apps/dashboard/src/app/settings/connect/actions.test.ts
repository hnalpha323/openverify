// @vitest-environment node
import { PERMISSIONS, type Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_PROBLEM_WORDS } from '../../../components/connect/connect-problem-words';
import { CONNECTION_IDS, connection } from '../../../components/connect/connect-fixtures';
import { settings } from '../../../components/operators/test-fixtures';
import { SETTINGS_COPY } from '../../../lib/copy/settings';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { fakeRequest } from '../../../testing/fake-request';
import {
  activateConnectionAction,
  changeSharePolicyAction,
  deactivateConnectionAction,
  reactivateConnectionAction,
  saveConnectSettings,
  startConnectStepUpWebauthn,
} from './actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
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

const ID = CONNECTION_IDS.inbound;
const as = (permissions: readonly Permission[] = PERMISSIONS) => api.me({ permissions });
const formOf = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};
const activation = (values: Record<string, string> = {}) =>
  formOf({
    'connection-id': ID,
    'policy-version': '1',
    'agreement-reference': 'Synthetic agreement DSA-TEST-B',
    acknowledged: 'true',
    'totp-code': '123 456',
    ...values,
  });
const ACTIVATE_PATH = `/dashboard/connect/connections/${ID}/activate`;
const STEP_UP_PATH = '/dashboard/sessions/current/step-up';
const STEP_UP_ANSWER = {
  'mfa-verified-at': '2026-10-20T12:05:00.000Z',
  'step-up-expires-at': '2026-10-20T12:15:00.000Z',
};
const KEY_OPTIONS = { challenge: 'c3ludGhldGljLWNoYWxsZW5nZQ', allowCredentials: [] };

describe('the activation (C231.3)', () => {
  it('verifies the second factor first, then activates the version the operator saw', async () => {
    as();
    api.on('POST', STEP_UP_PATH, 200, STEP_UP_ANSWER);
    api.on('POST', ACTIVATE_PATH, 200, { data: connection('inbound') });

    const result = await activateConnectionAction(null, activation());

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', STEP_UP_PATH)?.body).toEqual({ 'totp-code': '123456' });
    expect(api.find('POST', ACTIVATE_PATH)?.body).toEqual({
      data: {
        type: 'connect/connection',
        attributes: {
          'policy-version': 1,
          'agreement-reference': 'Synthetic agreement DSA-TEST-B',
          acknowledged: true,
        },
      },
    });
    const [stepUp, activate] = api.requests.filter((request) => request.method === 'POST');
    expect([stepUp?.path, activate?.path]).toEqual([STEP_UP_PATH, ACTIVATE_PATH]);
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/connect/connections/${ID}`);
  });

  it('sends a passkey assertion instead of a code when the dialog carries one', async () => {
    as();
    api.on('POST', STEP_UP_PATH, 200, STEP_UP_ANSWER);
    api.on('POST', ACTIVATE_PATH, 200, { data: connection('inbound') });
    const credential = {
      id: 'c3ludGhldGlj',
      rawId: 'c3ludGhldGlj',
      type: 'public-key',
      response: {
        clientDataJSON: 'c3ludGhldGlj',
        authenticatorData: 'c3ludGhldGlj',
        signature: 'c3ludGhldGlj',
      },
      clientExtensionResults: {},
    };

    await activateConnectionAction(
      null,
      activation({ 'totp-code': '', 'step-up-credential': JSON.stringify(credential) }),
    );

    expect(api.find('POST', STEP_UP_PATH)?.body).toEqual({ credential });
  });

  it('refuses without the acknowledgement or the agreement reference, before calling anything', async () => {
    as();

    const result = await activateConnectionAction(
      null,
      activation({ acknowledged: '', 'agreement-reference': '' }),
    );

    expect(result.ok).toBe(false);
    const pointers = result.ok ? [] : (result.problem.errors ?? []).map((error) => error.pointer);
    expect(pointers).toEqual(['/agreement-reference', '/acknowledged']);
    expect(api.all('POST', ACTIVATE_PATH)).toHaveLength(0);
    expect(api.all('POST', STEP_UP_PATH)).toHaveLength(0);
  });

  it('says a wrong code at its field and activates nothing', async () => {
    as();
    api.onProblem('POST', STEP_UP_PATH, 401);

    const result = await activateConnectionAction(null, activation());

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problem.errors).toEqual([
      { pointer: '/totp-code', detail: SETTINGS_COPY.users.codeInvalid },
    ]);
    expect(api.all('POST', ACTIVATE_PATH)).toHaveLength(0);
  });

  it('says the step-up and the changed policy in words', async () => {
    as();
    api.onProblem('POST', ACTIVATE_PATH, 403, undefined, { code: 'step_up_required' });

    const stepUp = await activateConnectionAction(null, activation({ 'totp-code': '' }));
    expect(stepUp).toMatchObject({
      ok: false,
      problem: { title: CONNECT_PROBLEM_WORDS.step_up_required },
    });

    api.onProblem('POST', ACTIVATE_PATH, 409, undefined, { code: 'share_policy_changed' });
    const changed = await activateConnectionAction(null, activation({ 'totp-code': '' }));
    expect(changed).toMatchObject({
      ok: false,
      problem: { title: CONNECT_PROBLEM_WORDS.share_policy_changed },
    });
  });

  it('needs connect-connections:activate', async () => {
    as(['connect-connections:read', 'connect-connections:write']);

    const result = await activateConnectionAction(null, activation());

    expect(result).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('starts a passkey step-up for the activation dialog', async () => {
    as();
    api.on('POST', '/dashboard/sessions/current/step-up/webauthn/options', 200, {
      options: KEY_OPTIONS,
    });

    const result = await startConnectStepUpWebauthn();

    expect(result).toEqual({ ok: true, data: { options: KEY_OPTIONS } });
  });
});

describe('deactivate, reactivate and change the policy (C231.4-C231.6)', () => {
  it('deactivates and reactivates the connection named in the form', async () => {
    as();
    api.on('POST', `/connect/connections/${ID}/deactivate`, 200, {
      data: connection('inbound', { status: 'inactive' }),
    });
    api.on('POST', `/connect/connections/${ID}/reactivate`, 200, {
      data: connection('inbound', { status: 'pending' }),
    });

    expect(await deactivateConnectionAction(null, formOf({ 'connection-id': ID }))).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await reactivateConnectionAction(null, formOf({ 'connection-id': ID }))).toEqual({
      ok: true,
      data: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/connect/connections/${ID}`);
    expect(revalidatePath).toHaveBeenCalledWith('/settings/connect');
  });

  it('says an already inactive connection in words', async () => {
    as();
    api.onProblem('POST', `/connect/connections/${ID}/deactivate`, 409, undefined, {
      code: 'connection_not_active',
    });

    expect(await deactivateConnectionAction(null, formOf({ 'connection-id': ID }))).toMatchObject({
      ok: false,
      problem: { title: CONNECT_PROBLEM_WORDS.connection_not_active },
    });
  });

  it('refuses a malformed connection id before calling anything', async () => {
    as();

    const result = await reactivateConnectionAction(null, formOf({ 'connection-id': 'cxn_bad' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/connection-id' }] },
    });
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('sends a changed policy as version n + 1', async () => {
    as();
    const body = connection('outbound').attributes['share-policy'].body;
    api.on('POST', `/connect/connections/${CONNECTION_IDS.outbound}/share-policy`, 200, {
      data: connection('outbound', { status: 'pending', version: 2 }),
    });

    const result = await changeSharePolicyAction(
      null,
      formOf({
        'connection-id': CONNECTION_IDS.outbound,
        'share-policy': JSON.stringify({
          ...body,
          biometric: false,
          verifications: { ...body.verifications, types: ['government-id'] },
        }),
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(
      api.find('POST', `/connect/connections/${CONNECTION_IDS.outbound}/share-policy`)?.body,
    ).toEqual({
      data: {
        type: 'connect/connection',
        attributes: {
          'share-policy': {
            ...body,
            biometric: false,
            verifications: { ...body.verifications, types: ['government-id'] },
          },
        },
      },
    });
  });

  it('says where a policy is not JSON, or breaks a rule, before calling anything', async () => {
    as();
    const body = connection('outbound').attributes['share-policy'].body;

    const syntax = await changeSharePolicyAction(
      null,
      formOf({ 'connection-id': CONNECTION_IDS.outbound, 'share-policy': '{"purpose":' }),
    );
    expect(syntax).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/share-policy' }] },
    });

    const rule = await changeSharePolicyAction(
      null,
      formOf({
        'connection-id': CONNECTION_IDS.outbound,
        'share-policy': JSON.stringify({ ...body, biometric: false }),
      }),
    );
    expect(rule).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer: '/share-policy/verifications/types/1',
            detail: 'selfie needs biometric: true',
          },
        ],
      },
    });
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('keeps the API’s pointers of share_policy_invalid, titled in words', async () => {
    as();
    const body = connection('outbound').attributes['share-policy'].body;
    api.onProblem(
      'POST',
      `/connect/connections/${CONNECTION_IDS.outbound}/share-policy`,
      422,
      undefined,
      {
        code: 'share_policy_invalid',
        errors: [
          {
            location: 'body',
            pointer: '/data/attributes/share-policy/peek/inquiry.status',
            detail: 'the policy does not share this path',
          },
        ],
      },
    );

    const result = await changeSharePolicyAction(
      null,
      formOf({ 'connection-id': CONNECTION_IDS.outbound, 'share-policy': JSON.stringify(body) }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: CONNECT_PROBLEM_WORDS.share_policy_invalid,
        errors: [
          {
            pointer: '/data/attributes/share-policy/peek/inquiry.status',
            detail: 'the policy does not share this path',
          },
        ],
      },
    });
  });

  it('needs connect-connections:write', async () => {
    as(['connect-connections:read']);

    const result = await deactivateConnectionAction(null, formOf({ 'connection-id': ID }));

    expect(result).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('the Connect settings (C231.10, C232.1, C241.3)', () => {
  const settingsForm = (values: Record<string, string>) =>
    formOf({ 'environment-id': ENVIRONMENTS.sandbox.id, ...values });

  beforeEach(() => {
    api.on(
      'GET',
      '/dashboard/settings',
      200,
      settings({
        'connect-inbound': false,
        'share-token-max-seconds': 1_814_400,
        'consent-proof-retention-days': 0,
      }),
    );
    api.on('PATCH', '/dashboard/settings', 200, settings());
  });

  it('sends only what changed, so the audit entry names exactly that', async () => {
    as();

    const result = await saveConnectSettings(
      null,
      settingsForm({
        'connect-inbound': 'true',
        'share-token-max-seconds': '1814400',
        'consent-proof-retention-days': '30',
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', '/dashboard/settings')?.body).toEqual({
      'connect-inbound': true,
      'consent-proof-retention-days': 30,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/settings/connect');
  });

  it('reads an unticked opt-in as off, and sends nothing when nothing changed', async () => {
    as();

    await saveConnectSettings(
      null,
      settingsForm({ 'share-token-max-seconds': '1814400', 'consent-proof-retention-days': '0' }),
    );

    expect(api.all('PATCH', '/dashboard/settings')).toHaveLength(0);
  });

  it('says a value outside its range at its field', async () => {
    as();

    const result = await saveConnectSettings(
      null,
      settingsForm({ 'share-token-max-seconds': '59', 'consent-proof-retention-days': '3651' }),
    );

    expect(result.ok ? [] : (result.problem.errors ?? []).map((error) => error.pointer)).toEqual([
      '/share-token-max-seconds',
      '/consent-proof-retention-days',
    ]);
    expect(api.all('PATCH', '/dashboard/settings')).toHaveLength(0);
  });

  it('needs settings:write and the page’s environment', async () => {
    as(['settings:read']);
    expect(await saveConnectSettings(null, settingsForm({}))).toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });

    as();
    expect(
      await saveConnectSettings(null, formOf({ 'environment-id': ENVIRONMENTS.production.id })),
    ).toMatchObject({ ok: false, problem: { title: 'The environment changed' } });
  });
});
