/**
 * Phase 2, C12 and C15: dashboard user sessions on the server API with the built-in roles, PII
 * masking, a TOTP login through the dashboard API, and an invitation delivered by email.
 */
import { randomUUID } from 'node:crypto';
import { problemTypeUri } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { waitForMail } from '../src/mailpit.js';
import { readStackInfo } from '../src/stack-info.js';
import { totpCode } from '../src/totp.js';
import { dashboardRequest, recordingClient, signInToApi } from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';

test('a reviewer can approve but cannot create API keys; a viewer sees masked fields', async () => {
  const stack = readStackInfo();
  const { client: admin } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: inquiry } = await admin.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-roles-${randomUUID()}`,
    fields: { name_first: 'Synthetic', name_last: 'Person' },
  });
  await admin.inquiries.performSimulateActions(inquiry.id, {
    actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
  });

  const { client: reviewer } = recordingClient(
    stack.apiUrl,
    await sessionTokenAs(stack, 'reviewer'),
  );
  const { data: approved } = await reviewer.inquiries.approve(inquiry.id);
  expect(approved.attributes.status).toBe('approved');
  // The reviewer holds pii:view: fields are shown.
  expect(approved.attributes.fields).toEqual({ name_first: 'Synthetic', name_last: 'Person' });
  const refused = await reviewer.apiKeys
    .create({ name: 'Not allowed', scopes: ['inquiries:read'] })
    .catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(OpenVerifyApiError);
  expect(refused).toMatchObject({ status: 403, type: problemTypeUri('forbidden') });

  // The audit log names the reviewer as the actor of the approval.
  const { data: entries } = await admin.userAuditLogs.list({
    filter: { action: 'inquiry.approved', 'resource-id': inquiry.id },
  });
  expect(entries.map((entry) => entry.attributes.actor.type)).toEqual(['user']);

  const { client: viewer } = recordingClient(stack.apiUrl, await sessionTokenAs(stack, 'viewer'));
  const { data: masked } = await viewer.inquiries.retrieve(inquiry.id);
  expect(masked.attributes.fields).toEqual({ name_first: null, name_last: null });
  expect(masked.attributes.note).toBeNull();
  const denied = await viewer.inquiries.decline(inquiry.id).catch((error: unknown) => error);
  expect(denied).toMatchObject({ status: 403, type: problemTypeUri('forbidden') });
});

test('an admin enrolled in TOTP signs in with password and code through the dashboard API', async () => {
  const stack = readStackInfo();
  const { mfaAdmin } = stack;

  const login = await dashboardRequest(stack, 'POST', '/sessions', {
    body: { email: mfaAdmin.email, password: mfaAdmin.password },
  });
  expect(login.status).toBe(202);
  const challenge = login.body as { 'mfa-token': string; factors: { type: string }[] };
  expect(challenge['mfa-token']).toMatch(/^ovm_/);
  expect(challenge.factors.map((factor) => factor.type)).toEqual(['totp']);

  // A wrong code is refused, and the challenge stays usable (five wrong codes revoke it).
  // It is none of the codes of the accepted window (the previous, current and next step).
  const now = Date.now();
  const accepted = [-30_000, 0, 30_000].map((offset) =>
    totpCode(mfaAdmin.totpSecret, new Date(now + offset)),
  );
  const wrongCode = ['000000', '111111', '222222', '333333'].find(
    (code) => !accepted.includes(code),
  );
  const wrong = await dashboardRequest(stack, 'POST', '/sessions/mfa', {
    body: { 'mfa-token': challenge['mfa-token'], 'totp-code': wrongCode },
  });
  expect(wrong.status).toBe(401);

  const session = await dashboardRequest(stack, 'POST', '/sessions/mfa', {
    body: {
      'mfa-token': challenge['mfa-token'],
      'totp-code': totpCode(mfaAdmin.totpSecret, new Date()),
    },
  });
  expect(session.status).toBe(201);
  const { token, user } = session.body as {
    token: string;
    user: { attributes: { email: string } };
  };
  expect(token).toMatch(/^ovu_/);
  expect(user.attributes.email).toBe(mfaAdmin.email);

  const me = await dashboardRequest(stack, 'GET', '/me', { token });
  expect(me.status).toBe(200);
  expect((me.body as { meta: Record<string, unknown> }).meta).toMatchObject({
    'mfa-satisfied': true,
    environment: { id: stack.environments.sandbox, kind: 'sandbox' },
  });
  // The MFA-satisfied session works on the server API too.
  const { client } = recordingClient(stack.apiUrl, token);
  // By id: the specs share one stack, so the default template soon leaves a list's first page.
  const { data: template } = await client.inquiryTemplates.retrieve(stack.defaultTemplateId);
  expect(template.id).toBe(stack.defaultTemplateId);

  // The challenge is single use.
  const replay = await dashboardRequest(stack, 'POST', '/sessions/mfa', {
    body: {
      'mfa-token': challenge['mfa-token'],
      'totp-code': totpCode(mfaAdmin.totpSecret, new Date()),
    },
  });
  expect(replay.status).toBe(401);
});

test('an invited operator receives the email through Mailpit and joins with the role given', async () => {
  const stack = readStackInfo();
  const adminToken = await sessionTokenAs(stack, 'admin');
  const roles = await dashboardRequest(stack, 'GET', '/roles', { token: adminToken });
  const viewerRole = (
    roles.body as { data: { id: string; attributes: { key: string | null } }[] }
  ).data.find((role) => role.attributes.key === 'viewer');
  const invitee = `invitee-${randomUUID().slice(0, 8)}@example.test`;

  const invited = await dashboardRequest(stack, 'POST', '/users/invitations', {
    token: adminToken,
    body: { email: invitee, 'role-ids': [viewerRole?.id] },
  });
  expect(invited.status).toBe(201);
  expect(JSON.stringify(invited.body)).not.toContain('ovi_');

  const mail = await waitForMail(stack.mailpitUrl, invitee, { timeoutMs: 30_000 });
  const link = /(https?:\/\/\S+\/accept-invitation#token=(ovi_[A-Za-z0-9_-]{43}))/.exec(mail.text);
  expect(link?.[1]?.startsWith('http://localhost:')).toBe(true);
  const password = `e2e-${randomUUID()}`;
  const joined = await dashboardRequest(stack, 'POST', '/invitations/accept', {
    body: { token: link?.[2], password, name: 'Invited Operator' },
  });
  expect(joined.status).toBe(200);

  const token = await signInToApi(stack, { email: invitee, password });
  const me = await dashboardRequest(stack, 'GET', '/me', { token });
  expect((me.body as { meta: { permissions: string[] } }).meta.permissions).toContain(
    'inquiries:read',
  );
  expect((me.body as { meta: { permissions: string[] } }).meta.permissions).not.toContain(
    'pii:view',
  );
  // The token was single use.
  const again = await dashboardRequest(stack, 'POST', '/invitations/accept', {
    body: { token: link?.[2], password, name: 'Invited Operator' },
  });
  expect(again.status).toBeGreaterThanOrEqual(400);
});
