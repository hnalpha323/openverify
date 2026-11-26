/**
 * C52.6, C52.8, C53.7, C54.1, C55.6, C55.10: the phone and email hooks.
 * - Attributes: the destination, `confirmed-at`, `sends` and `failed-attempts`, unmasked with
 *   `pii:view`, the destination masked without it and `null` after redaction, in
 *   `GET /verifications/:id`, `?include=verifications`, the `verification.*` payload (as the
 *   Events API serves it) and the stored API log.
 * - Submit: a confirmed code submits; an unconfirmed one only once a limit refused the user or no
 *   code and no send is left (409 `otp_not_confirmed` otherwise); the open code is closed.
 * - Cancel: the open code is closed.
 * - Publish: a phone step needs an SMS sender for the environment's kind, an email step a mailer
 *   (422 `otp_channel_not_configured` pointing at the step).
 * Every number and address is synthetic.
 */
import { PERMISSIONS, type Permission } from '@openverify/core';
import { newId } from '@openverify/contracts';
import {
  createEvent,
  getVerification,
  listApiLogs,
  listOtpChallenges,
  redactInquiryRecords,
} from '@openverify/db';
import { seedOtpChallenge, seedOtpVerificationState } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createTestApi,
  expectStatus,
  type TestApi,
} from '../../test-support/harness.js';
import { cancelSubResources } from '../sub-resources/index.js';
import { cancelInitiatedVerifications } from '../verifications.js';
import {
  TEST_ADDRESS,
  TEST_NUMBER,
  confirmCode,
  createOtpTemplate,
  mailedCode,
  otpOverrides,
  otpTarget,
  otpTemplateAttributes,
  recordingSmsSender,
  sendCode,
  type RecordingSmsSender,
} from './testing.js';

let api: TestApi;
let sms: RecordingSmsSender;
let templateId: string;
/** A dashboard user with every permission but `pii:view`. */
let viewer: string;
/** A dashboard user with every permission. */
let reviewer: string;

beforeAll(async () => {
  api = await createTestApi(
    otpOverrides({
      sms: (defaults) => {
        sms = recordingSmsSender(defaults.cache, defaults.clock);
        return sms;
      },
    }),
  );
  templateId = await createOtpTemplate(api);
  viewer = api.newUserToken(api.environmentId, {
    permissions: PERMISSIONS.filter((permission: Permission) => permission !== 'pii:view'),
  });
  reviewer = api.newUserToken(api.environmentId);
});

afterAll(async () => {
  await api.close();
});

const smsCode = () => sms.sends.at(-1)?.context.code ?? '';

/** A phone verification whose code was sent, one wrong code tried, then confirmed. */
async function confirmedPhone() {
  const target = await otpTarget(api, templateId, 'phone_number');
  await sendCode(api, target.token, target.verificationId, { 'phone-number': TEST_NUMBER });
  await confirmCode(api, target.token, target.verificationId, '000000');
  expectStatus(await confirmCode(api, target.token, target.verificationId, smsCode()), 200);
  return target;
}

function typeAttributes(resource: unknown): Record<string, unknown> {
  const attributes = (resource as { attributes: Record<string, unknown> }).attributes;
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([name]) => !['status', 'checks', 'from-rejected-handoff', 'created-at', 'updated-at'].includes(name),
    ),
  );
}

function submit(token: string, verificationId: string) {
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${verificationId}/submit`,
    headers: bearer(token),
  });
}

describe('the attributes (C52.8, C53.7)', () => {
  it('serve the destination, confirmation and counts; masked without pii:view', async () => {
    const { verificationId } = await confirmedPhone();
    const url = `/api/v1/verifications/${verificationId}`;

    const key = expectStatus(await api.app.inject({ url, headers: bearer(api.token) }), 200);
    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    const expected = {
      'phone-number': TEST_NUMBER,
      'confirmed-at': api.clock.now().toISOString(),
      sends: 1,
      'failed-attempts': 1,
    };
    expect(typeAttributes(key.data)).toEqual(expected);
    expect(typeAttributes(seen.data)).toEqual(expected);
    expect(typeAttributes(masked.data)).toEqual({ ...expected, 'phone-number': null });
  });

  it('serve an email verification’s address the same way, and none before a code', async () => {
    const before = await otpTarget(api, templateId, 'email_address');
    const target = await otpTarget(api, templateId, 'email_address');
    await sendCode(api, target.token, target.verificationId, { 'email-address': TEST_ADDRESS });
    await confirmCode(api, target.token, target.verificationId, mailedCode(api));
    const read = (id: string, token = api.token) =>
      api.app.inject({ url: `/api/v1/verifications/${id}`, headers: bearer(token) });

    expect(typeAttributes(expectStatus(await read(before.verificationId), 200).data)).toEqual({
      'email-address': null,
      'confirmed-at': null,
      sends: 0,
      'failed-attempts': 0,
    });
    expect(typeAttributes(expectStatus(await read(target.verificationId), 200).data)).toMatchObject(
      { 'email-address': TEST_ADDRESS, sends: 1 },
    );
    expect(
      typeAttributes(expectStatus(await read(target.verificationId, viewer), 200).data),
    ).toMatchObject({ 'email-address': null, sends: 1 });
  });

  it('are in ?include=verifications, masked there too', async () => {
    const { inquiryId, verificationId } = await confirmedPhone();
    const url = `/api/v1/inquiries/${inquiryId}?include=verifications`;
    const included = (document: { included?: unknown[] }) =>
      document.included?.find((resource) => (resource as { id: string }).id === verificationId);

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(included(seen))).toMatchObject({ 'phone-number': TEST_NUMBER });
    expect(typeAttributes(included(masked))).toMatchObject({ 'phone-number': null, sends: 1 });
  });

  it('are in the verification.submitted payload, which the Events API masks', async () => {
    const { token, verificationId } = await confirmedPhone();
    expectStatus(await submit(token, verificationId), 202);
    const submitted = api.events.events.find(
      (event) =>
        event.name === 'verification.submitted' &&
        (event.payload as { data: { id: string } }).data.id === verificationId,
    );
    expect(typeAttributes(submitted?.payload.data)).toMatchObject({ 'phone-number': TEST_NUMBER });
    const event = await createEvent(api.database.db, api.environmentId, {
      id: newId('evt'),
      name: 'verification.submitted',
      payload: submitted?.payload as never,
    });
    const url = `/api/v1/events/${event.id}`;
    const payload = (document: { data: unknown }) =>
      (document.data as { attributes: { payload: { data: unknown } } }).attributes.payload.data;

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(payload(seen))).toMatchObject({ 'phone-number': TEST_NUMBER });
    expect(typeAttributes(payload(masked))).toMatchObject({ 'phone-number': null });
  });

  it('a stored API log keeps the number for pii:view and masks it without', async () => {
    const { verificationId } = await confirmedPhone();
    const requestId = `req-otp-attributes-${verificationId}`;
    await api.app.inject({
      url: `/api/v1/verifications/${verificationId}`,
      headers: { ...bearer(api.token), 'x-request-id': requestId },
    });
    const logs = await listApiLogs(api.database.db, api.environmentId, { size: 100 });
    const log = logs.items.find((entry) => entry.requestId === requestId);
    const url = `/api/v1/api-logs/${log?.id ?? ''}`;
    const body = (document: { data: unknown }) =>
      (document.data as { attributes: { 'response-body': { data: unknown } } }).attributes[
        'response-body'
      ].data;

    const seen = expectStatus(await api.app.inject({ url, headers: bearer(reviewer) }), 200);
    const masked = expectStatus(await api.app.inject({ url, headers: bearer(viewer) }), 200);

    expect(typeAttributes(body(seen))).toMatchObject({ 'phone-number': TEST_NUMBER });
    expect(typeAttributes(body(masked))).toMatchObject({ 'phone-number': null });
    expect(JSON.stringify(body(masked))).not.toContain('2025550100');
  });

  it('lose the destination once the inquiry is redacted', async () => {
    const { inquiryId, verificationId } = await confirmedPhone();
    await redactInquiryRecords(api.database.db, api.environmentId, inquiryId);

    const document = expectStatus(
      await api.app.inject({
        url: `/api/v1/verifications/${verificationId}`,
        headers: bearer(api.token),
      }),
      200,
    );

    expect(typeAttributes(document.data)).toMatchObject({ 'phone-number': null, sends: 1 });
  });
});

describe('the submit guard (C52.6, C55.6)', () => {
  it('refuses an unconfirmed code while codes are left (409 otp_not_confirmed)', async () => {
    const { token, verificationId } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, { 'phone-number': TEST_NUMBER });

    const response = await submit(token, verificationId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'otp_not_confirmed' });
    expect((await getVerification(api.database.db, api.environmentId, verificationId))?.status).toBe(
      'initiated',
    );
  });

  it('submits once a limit refused the user, closing the open code', async () => {
    const { token, verificationId } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, { 'phone-number': TEST_NUMBER });
    await api.database.client.query(
      `update otp_verification_states set limited_at = now(), limited_reason = 'destination'
        where verification_id = $1`,
      [verificationId],
    );

    const response = await submit(token, verificationId);

    expect(response.statusCode).toBe(202);
    expect(
      (await listOtpChallenges(api.database.db, api.environmentId, verificationId)).map(
        (challenge) => challenge.status,
      ),
    ).toEqual(['superseded']);
  });

  it('submits a verification with no code and no send left (no dead end)', async () => {
    const { inquiryId, token, verificationId } = await otpTarget(api, templateId, 'phone_number');
    await seedOtpChallenge(api.database.db, api.environmentId, {
      verificationId,
      inquiryId,
      channel: 'sms',
      destination: TEST_NUMBER,
      status: 'expired',
    });
    await seedOtpVerificationState(api.database.db, api.environmentId, {
      verificationId,
      inquiryId,
      sends: 5,
    });

    expect((await submit(token, verificationId)).statusCode).toBe(202);
  });

  it('submits a confirmed verification', async () => {
    const { token, verificationId } = await confirmedPhone();

    expect((await submit(token, verificationId)).statusCode).toBe(202);
  });
});

describe('the cancel hook (C54.1)', () => {
  it('closes the open code of a verification canceled by its inquiry’s expiry', async () => {
    const { inquiryId, token, verificationId } = await otpTarget(api, templateId, 'phone_number');
    await sendCode(api, token, verificationId, { 'phone-number': TEST_NUMBER });

    await api.database.db.transaction((tx) =>
      cancelInitiatedVerifications(tx, api.events, api.environmentId, inquiryId, api.clock.now()),
    );

    expect((await getVerification(api.database.db, api.environmentId, verificationId))?.status).toBe(
      'canceled',
    );
    expect(
      (await listOtpChallenges(api.database.db, api.environmentId, verificationId)).map(
        (challenge) => challenge.status,
      ),
    ).toEqual(['superseded']);
  });

  it('stages nothing and deletes no object', async () => {
    const { token, verificationId } = await otpTarget(api, templateId, 'email_address');
    await sendCode(api, token, verificationId, { 'email-address': TEST_ADDRESS });
    const verification = await getVerification(api.database.db, api.environmentId, verificationId);
    if (verification === null) {
      throw new Error('missing verification');
    }

    const canceled = await api.database.db.transaction((tx) =>
      cancelSubResources(tx, api.events, verification),
    );

    expect(canceled).toEqual({ staged: [], storageKeys: [] });
  });
});

describe('the channel guard at publish (C55.10)', () => {
  async function publish(target: TestApi, token: string) {
    return target.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(token),
      payload: { data: { type: 'inquiry-template', attributes: otpTemplateAttributes() } },
    });
  }

  it('publishes where both channels are bound', async () => {
    expect((await publish(api, api.token)).statusCode).toBe(201);
  });

  it('refuses a phone step without an SMS sender and an email step without a mailer', async () => {
    // Workflow 5C review K9: the harness binds the sandbox sender by default; this one has none.
    const unbound = await createTestApi((defaults) => ({
      providers: { sandbox: {}, production: {} },
      mailer: { ...defaults.mailer, configured: false },
    }));
    try {
      const response = await publish(unbound, unbound.token);
      const steps = otpTemplateAttributes().flow.steps;
      const phoneIndex = steps.findIndex((step) => step.type === 'phone_otp');
      const emailIndex = steps.findIndex((step) => step.type === 'email_otp');

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: 'otp_channel_not_configured',
        errors: [
          expect.objectContaining({ pointer: `/data/attributes/flow/steps/${String(phoneIndex)}` }),
          expect.objectContaining({ pointer: `/data/attributes/flow/steps/${String(emailIndex)}` }),
        ],
      });
    } finally {
      await unbound.close();
    }
  });

  it('reads the binding of the environment’s own kind: production has no sandbox sender', async () => {
    const production = await api.newTenant({ kind: 'production' });

    const response = await publish(api, production.token);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'otp_channel_not_configured' });
  });
});
