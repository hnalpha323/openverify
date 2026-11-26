// @vitest-environment node
/**
 * The Workflow 9C clients of `dashboard-settings`: what the role editor may grant (C167.3), user
 * assignments, reactivation, the MFA reset and the invitation resend (C167.2, C168.1, C168.3), the
 * caller's sessions and the step-up (C168.4, C168.1), notification preferences (C169.7), key
 * rotation (C169.1), the delivery search (C165.4) and the audit explorer's new filters (C168.6).
 */
import {
  grantableDocumentSchema,
  notificationPreferencesDocumentSchema,
  rotatedApiKeyDocumentSchema,
  userRoleAssignmentsDocumentSchema,
  userSessionListDocumentSchema,
  type WebhookDeliverySearchQuery,
} from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_IDS, LATER } from '../../components/integrations/testing-fixtures';
import { user } from '../../components/operators/test-fixtures';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import {
  ROLE_IDS,
  SETTINGS_IDS,
  USER_IDS,
  deliverySearchDocument,
  grantableDocument,
  preferencesDocument,
  rotatedKeyDocument,
  sessionsDocument,
  userRoleAssignmentsDocument,
} from '../../testing/routes/settings';
import { SESSION_COOKIE } from '../session-cookie';
import { rotateApiKey } from './api-keys';
import { listAuditLogs } from './audit-logs';
import { getNotificationPreferences, updateNotificationPreferences } from './notifications';
import { getGrantable } from './roles';
import { listMySessions, revokeMySession, revokeOtherSessions, stepUpSession } from './sessions';
import { reactivateUser, resendInvitation, resetUserMfa, setUserRoles } from './users';
import { searchWebhookDeliveries } from './webhook-deliveries';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the fixtures', () => {
  it('pass the answer schemas the clients parse with', () => {
    expect(grantableDocumentSchema.safeParse(grantableDocument()).success).toBe(true);
    expect(userSessionListDocumentSchema.safeParse(sessionsDocument()).success).toBe(true);
    expect(notificationPreferencesDocumentSchema.safeParse(preferencesDocument()).success).toBe(
      true,
    );
    expect(rotatedApiKeyDocumentSchema.safeParse(rotatedKeyDocument()).success).toBe(true);
    expect(
      userRoleAssignmentsDocumentSchema.safeParse(
        userRoleAssignmentsDocument(USER_IDS.reviewer, [
          { 'role-id': ROLE_IDS.reviewer, 'environment-ids': [SETTINGS_IDS.sandbox] },
        ]),
      ).success,
    ).toBe(true);
  });
});

describe('roles and users (C167, C168)', () => {
  it('reads what the caller may grant per scope, organisation-wide last', async () => {
    api.reply(200, grantableDocument());

    const scopes = await getGrantable();

    expect(scopes.map((scope) => scope['environment-id'])).toEqual([
      SETTINGS_IDS.sandbox,
      SETTINGS_IDS.production,
      null,
    ]);
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/roles/grantable' });
    expect(api.last().headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('replaces a user’s assignments and answers them as stored', async () => {
    const assignments = [
      { 'role-id': ROLE_IDS.reviewer, 'environment-ids': [SETTINGS_IDS.sandbox] },
      { 'role-id': ROLE_IDS.viewer, 'environment-ids': null },
    ];
    api.reply(200, userRoleAssignmentsDocument(USER_IDS.reviewer, assignments));

    await expect(setUserRoles(USER_IDS.reviewer, assignments)).resolves.toEqual(assignments);
    expect(api.last()).toMatchObject({
      method: 'PUT',
      path: `/api/v1/dashboard/users/${USER_IDS.reviewer}/roles`,
      body: { assignments },
    });
  });

  it('reactivates through POST /reactivate with an empty body, never a PATCH (AC2)', async () => {
    api.reply(200, { data: user({ id: USER_IDS.deactivated, status: 'invited' }) });

    const reactivated = await reactivateUser(USER_IDS.deactivated);

    expect(reactivated.attributes.status).toBe('invited');
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/users/${USER_IDS.deactivated}/reactivate`,
      body: {},
    });
  });

  it('resets a user’s MFA with an empty body', async () => {
    api.reply(200, { data: user({ id: USER_IDS.reviewer }) });

    await resetUserMfa(USER_IDS.reviewer);

    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/users/${USER_IDS.reviewer}/reset-mfa`,
      body: {},
    });
  });

  it('raises the refusals for the page to say in words (403 step_up_required)', async () => {
    api.replyProblem(403, undefined, { code: 'step_up_required' });

    await expect(resetUserMfa(USER_IDS.reviewer)).rejects.toBeInstanceOf(OpenVerifyApiError);
  });

  it('resends an invitation and answers when the new link expires', async () => {
    api.reply(201, {
      email: 'invited@example.test',
      'role-ids': [ROLE_IDS.viewer],
      'expires-at': '2026-10-27T04:35:00.000Z',
    });

    await expect(resendInvitation(USER_IDS.invited)).resolves.toEqual({
      email: 'invited@example.test',
      roleIds: [ROLE_IDS.viewer],
      expiresAt: '2026-10-27T04:35:00.000Z',
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/invitations/${USER_IDS.invited}/resend`,
      body: {},
    });
  });

  it('encodes an id taken from a URL', async () => {
    api.reply(200, { data: user({ id: USER_IDS.reviewer }) });

    await reactivateUser('usr_a/b');

    expect(api.last().path).toBe('/api/v1/dashboard/users/usr_a%2Fb/reactivate');
  });
});

describe('my sessions and the step-up (C168.4, C168.1)', () => {
  it('lists the caller’s sessions as served', async () => {
    api.reply(200, sessionsDocument());

    const sessions = await listMySessions();

    expect(sessions.map(({ id, attributes }) => [id, attributes.current])).toEqual([
      [SETTINGS_IDS.currentSession, true],
      [SETTINGS_IDS.otherSession, false],
    ]);
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/sessions' });
  });

  it('revokes one session, then every other, answering how many', async () => {
    api.reply(204).reply(200, { meta: { revoked: 2 } });

    await revokeMySession(SETTINGS_IDS.otherSession);
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/dashboard/sessions/${SETTINGS_IDS.otherSession}/revoke`,
      body: {},
    });
    await expect(revokeOtherSessions()).resolves.toBe(2);
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/sessions/revoke-others',
      body: {},
    });
  });

  it('verifies a factor again and answers until when the session may act', async () => {
    api.reply(200, { 'mfa-verified-at': LATER, 'step-up-expires-at': '2026-10-20T04:50:00.000Z' });

    await expect(stepUpSession({ 'totp-code': '123456' })).resolves.toEqual({
      expiresAt: '2026-10-20T04:50:00.000Z',
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/sessions/current/step-up',
      body: { 'totp-code': '123456' },
    });
  });
});

describe('notification preferences (C169.7)', () => {
  it('reads every kind', async () => {
    api.reply(200, preferencesDocument({ 'webhook-failure': { console: true, email: true } }));

    const preferences = await getNotificationPreferences();

    expect(preferences['webhook-failure']).toEqual({ console: true, email: true });
    expect(preferences.assigned).toEqual({ console: true, email: false });
    expect(api.last()).toMatchObject({
      method: 'GET',
      path: '/api/v1/dashboard/notification-preferences',
    });
  });

  it('sets only the kinds named, as a JSON:API document', async () => {
    api.reply(200, preferencesDocument({ 'webhook-failure': { console: false, email: true } }));

    await updateNotificationPreferences({ 'webhook-failure': { console: false, email: true } });

    expect(api.last()).toMatchObject({
      method: 'PUT',
      path: '/api/v1/dashboard/notification-preferences',
      body: {
        data: {
          type: 'notification-preferences',
          attributes: { preferences: { 'webhook-failure': { console: false, email: true } } },
        },
      },
    });
  });
});

describe('key rotation (C169.1)', () => {
  it('rotates with the old token’s window and answers the new token once with the old end', async () => {
    api.reply(201, rotatedKeyDocument('2026-10-21T04:40:00.000Z'));

    const rotated = await rotateApiKey(INTEGRATION_IDS.apiKey, {
      previousExpiresInSeconds: 86_400,
    });

    expect(rotated).toMatchObject({
      previousKeyId: INTEGRATION_IDS.apiKey,
      previousExpiresAt: '2026-10-21T04:40:00.000Z',
    });
    expect(rotated.key.id).toBe(SETTINGS_IDS.rotatedKey);
    expect(rotated.token.startsWith(rotated.key.attributes['token-prefix'])).toBe(true);
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/api-keys/${INTEGRATION_IDS.apiKey}/rotate`,
      body: { meta: { 'previous-expires-in-seconds': 86_400 } },
    });
  });

  it('sends the new name when one is given', async () => {
    api.reply(201, rotatedKeyDocument());

    await rotateApiKey(INTEGRATION_IDS.apiKey, { previousExpiresInSeconds: 0, name: 'CI 2' });

    expect(api.last().body).toEqual({
      meta: { 'previous-expires-in-seconds': 0, name: 'CI 2' },
    });
  });
});

describe('the delivery search (C165.4)', () => {
  it('posts the query and the page, and answers the next cursor as an id', async () => {
    api.reply(
      200,
      deliverySearchDocument(
        '/api/v1/webhook-deliveries/search?page%5Bafter%5D=whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63',
      ),
    );
    const query: WebhookDeliverySearchQuery = {
      and: [
        { attribute: 'status', operator: 'eq', value: 'failed' },
        { not: { attribute: 'event_name', operator: 'eq', value: 'inquiry.approved' } },
      ],
    };

    const answer = await searchWebhookDeliveries({ query, page: { size: 25 } });

    expect(answer.deliveries.map(({ id }) => id)).toEqual([INTEGRATION_IDS.delivery]);
    expect(answer.next).toBe('whd_01J9ZK3M5Q7R8S9T0V1W2X3Y63');
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/webhook-deliveries/search',
      body: { query, page: { size: 25 } },
    });
  });

  it('answers no next page when the API gives none', async () => {
    api.reply(200, deliverySearchDocument(null));

    await expect(
      searchWebhookDeliveries({
        query: { attribute: 'status', operator: 'eq', value: 'failed' },
      }),
    ).resolves.toMatchObject({ next: null });
  });
});

describe('the audit explorer’s filters (C168.6)', () => {
  it('sends the action prefix and the exact address beside the existing filters', async () => {
    api.reply(200, { data: [], links: { next: null } });

    await listAuditLogs({ actionPrefix: 'settings.', ip: '203.0.113.9', action: 'user.updated' });

    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[action]': 'user.updated',
      'filter[action-prefix]': 'settings.',
      'filter[ip]': '203.0.113.9',
      'page[size]': '25',
    });
  });
});
