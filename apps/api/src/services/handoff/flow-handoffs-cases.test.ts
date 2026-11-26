/**
 * C96 (Workflow 7A, `flow-handoff`): the handoff cases beside the main route walk
 * (`flow-handoffs.test.ts`):
 *
 * - an SMS goes only through the flow's `phone_otp` rules, to a confirmed number, under the Phase 5
 *   SMS-pumping guards; a send the adapter refuses revokes the token (503);
 * - email needs a configured mail server (422 `handoff_method_not_allowed`);
 * - a phone session neither issues nor rejects;
 * - the context screen names the issuing session's country with its source's attribution, and the
 *   organisation's own name if the display name was cleared after the step was published;
 * - the distance facts compare the phone's network with the issuing session's (C96.7);
 * - a rejected handoff's submitted verification sends the inquiry to review when it completes,
 *   with the cause recorded (`review.ts`).
 *
 * Every value is synthetic: documentation addresses, documentation ASNs, fictional points.
 */
import {
  defaultInquiryTemplateAttributes,
  newId,
  parseHandoffFragment,
  type CreateInquiryTemplateAttributes,
} from '@openverify/contracts';
import {
  confirmOtpChallenge,
  createInquirySession,
  createVerification,
  getInquiry,
  getInquirySession,
  hashSessionToken,
  insertOtpChallenge,
  otpDestinationIndex,
  recordSessionNetworkEvaluation,
  updateEnvironmentSettings,
  type NetworkFacts,
} from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { defaultTemplateConfig } from '@openverify/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapturingMailer } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
  seedVerification,
} from '../../test-support/harness.js';
import { DEFAULT_CONSENT_BODY } from '../../flow-engine/testing.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { transitionInquiryInTx } from '../inquiries.js';
import { recordDistanceFacts } from './flow-handoffs.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
  await updateEnvironmentSettings(api.database.db, api.environmentId, {
    'organization-display-name': 'Example Verification Ltd',
  });
});

afterAll(async () => {
  await api.close();
});

const FLOW = '/api/v1/flow';
const PHONE_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const NUMBER = '+12025550123';

function template(
  handoff: Record<string, unknown>,
  extra: Record<string, unknown>[] = [],
): CreateInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  const [consent, ...rest] = attributes.flow.steps;
  attributes.flow.steps = [
    consent ?? ({} as never),
    ...(extra as never[]),
    { id: 'device_handoff', type: 'device_handoff', ...handoff } as never,
    ...rest,
  ];
  if (extra.some((step) => step.type === 'phone_otp')) {
    attributes['verification-config'] = {
      ...attributes['verification-config'],
      'phone-number': defaultTemplateConfig('phone_number'),
    };
  }
  return attributes;
}

async function session(attributes: CreateInquiryTemplateAttributes, harness = api) {
  const templateId = await createTemplate(harness, harness.token, attributes);
  const inquiryId = await createInquiry(harness, { templateId });
  const token = await resumeInquiry(harness, inquiryId);
  expectStatus(await harness.app.inject({ url: `${FLOW}/session`, headers: bearer(token) }), 200);
  // C151.4 (Workflow 9A): the handoff is issued at its own step, so the steps before it are done.
  if (attributes.flow.steps.some((step) => step.type === 'phone_otp')) {
    await seedVerification(harness, harness.environmentId, inquiryId, {
      type: 'phone_number',
      status: 'passed',
    });
  }
  expectStatus(
    await harness.app.inject({
      method: 'POST',
      url: `${FLOW}/consent`,
      headers: bearer(token),
      payload: DEFAULT_CONSENT_BODY,
    }),
    201,
  );
  return { inquiryId, token };
}

const post = (url: string, payload: unknown, token?: string, harness = api, agent?: string) =>
  harness.app.inject({
    method: 'POST',
    url: `${FLOW}${url}`,
    headers: {
      ...(token === undefined ? {} : bearer(token)),
      ...(agent === undefined ? {} : { 'user-agent': agent }),
    },
    payload: payload as Record<string, unknown>,
  });

async function confirm(inquiryId: string, channel: 'sms' | 'email', destination: string) {
  const verification = await createVerification(api.database.db, api.environmentId, {
    id: testId('ver'),
    inquiryId,
    type: channel === 'sms' ? 'phone_number' : 'email_address',
  });
  const id = testId('otpc');
  await insertOtpChallenge(api.database.db, api.environmentId, {
    id,
    verificationId: verification.id,
    inquiryId,
    channel,
    destination,
    destinationIndex: otpDestinationIndex(api.deps.blindIndexKey, {
      environmentId: api.environmentId,
      channel,
      destination,
    }),
    codeHmac: new Uint8Array(32),
    codeKeyId: api.database.keyring.currentKeyId,
    provider: 'sandbox',
    sentAt: api.clock.now(),
    expiresAt: new Date(api.clock.now().getTime() + 600_000),
  });
  await confirmOtpChallenge(api.database.db, api.environmentId, id, api.clock.now());
}

const PHONE_STEP = {
  id: 'phone_otp',
  type: 'phone_otp',
  allowedCountries: ['US'],
};

describe('SMS and email sends (C96.3)', () => {
  it('sends an SMS to a confirmed number under the SMS-pumping guards', async () => {
    const { inquiryId, token } = await session(template({ methods: ['qr', 'sms'] }, [PHONE_STEP]));
    await confirm(inquiryId, 'sms', NUMBER);
    const before = api.rateLimiter.calls.length;

    const sent = await post('/handoffs', { method: 'sms', destination: NUMBER }, token);

    expect(sent.statusCode).toBe(201);
    expect(sent.json()).not.toHaveProperty('url-fragment');
    const names = api.rateLimiter.calls.slice(before).map((call) => call.policy.name);
    expect(names).toEqual(
      expect.arrayContaining(['flow-handoffs', 'otp-ip-hour', 'otp-sms-max-per-hour']),
    );
    const sink = await api.cache.listRange(`openverify:sandbox-sms:${api.environmentId}`, 10);
    expect(sink).toHaveLength(1);
  });

  it('refuses an SMS for a flow without a phone step to confirm numbers', async () => {
    const { inquiryId, token } = await session(
      template({ methods: ['qr', 'sms'], confirmationCode: true }),
    );
    await confirm(inquiryId, 'sms', NUMBER);

    const response = await post('/handoffs', { method: 'sms', destination: NUMBER }, token);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: 'destination_not_confirmed' });
  });

  it('revokes the token when the mail server refuses the send (503)', async () => {
    const { inquiryId, token } = await session(template({ methods: ['qr', 'email'] }));
    await confirm(inquiryId, 'email', 'person@example.com');
    api.mailer.failNext(new Error('the mail server refused'));

    const response = await post(
      '/handoffs',
      { method: 'email', destination: 'person@example.com' },
      token,
    );

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'handoff_send_limited' });
    const { rows } = await api.database.db.execute(
      sql`select revoked_at from handoff_tokens where inquiry_id = ${inquiryId}`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { revoked_at: unknown }).revoked_at).not.toBeNull();
  });

  it('refuses email where no mail server is configured', async () => {
    const harness = await createInquiryTestApi({
      mailer: { ...createCapturingMailer(), configured: false },
    });
    try {
      await updateEnvironmentSettings(harness.database.db, harness.environmentId, {
        'organization-display-name': 'Example Verification Ltd',
      });
      const { token } = await session(
        template({ methods: ['qr', 'email'], confirmationCode: true }),
        harness,
      );

      const response = await post(
        '/handoffs',
        { method: 'email', destination: 'person@example.com' },
        token,
        harness,
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'handoff_method_not_allowed' });
    } finally {
      await harness.close();
    }
  });
});

describe('the phone and the context screen (C96.3, F30)', () => {
  async function handedOff(attributes = template({})) {
    const desktop = await session(attributes);
    const issued = expectStatus(
      await post('/handoffs', { method: 'qr' }, desktop.token),
      201,
    ) as unknown as { 'url-fragment': string };
    const handoffToken = parseHandoffFragment(issued['url-fragment'])?.handoffToken ?? '';
    return { desktop, handoffToken };
  }

  it('lets a phone session neither issue nor reject', async () => {
    const { desktop, handoffToken } = await handedOff();
    const redeemed = expectStatus(
      await post(
        '/handoffs/redeem',
        { 'inquiry-id': desktop.inquiryId, 'handoff-token': handoffToken },
        undefined,
        api,
        PHONE_AGENT,
      ),
      200,
    ) as unknown as { 'session-token': string };
    const phone = redeemed['session-token'];

    const issue = await post('/handoffs', { method: 'qr' }, phone, api, PHONE_AGENT);
    expect(issue.json()).toMatchObject({ code: 'handoff_not_available' });
    const reject = await post('/handoffs/current/reject', {}, phone, api, PHONE_AGENT);
    expect(reject.json()).toMatchObject({ code: 'handoff_not_redeemed' });
  });

  it('names the issuing session’s country with its source’s attribution', async () => {
    const { desktop, handoffToken } = await handedOff();
    // The desktop's start evaluated its address against the harness's empty snapshots; this is
    // what a configured DB-IP country source would have written.
    const source = {
      kind: 'sync',
      'source-id': 'dbip-country-lite',
      'sync-id': 'nsy_01M5CK16P0D13FXHZSS4TCFBVH',
      'published-at': '2026-10-01T00:00:00.000Z',
      sha256: 'a'.repeat(64),
    };
    await api.database.db.execute(
      sql`update inquiry_sessions set country_code = 'FR', country_name = 'France'
          where inquiry_id = ${desktop.inquiryId} and handoff_from_session_id is null`,
    );
    await api.database.db.execute(
      sql`update networks set country_code = 'FR', country_name = 'France', asn = 64500,
            sources = ${JSON.stringify([source])}::jsonb
          where inquiry_session_id in (select id from inquiry_sessions
            where inquiry_id = ${desktop.inquiryId} and handoff_from_session_id is null)`,
    );

    const preview = expectStatus(
      await post('/handoffs/preview', {
        'inquiry-id': desktop.inquiryId,
        'handoff-token': handoffToken,
      }),
      200,
    ) as unknown as { context: Record<string, unknown> };

    expect(preview.context).toMatchObject({
      'issuing-country-code': 'FR',
      attribution: 'IP geolocation by DB-IP',
    });
  });

  it('shows the organisation’s own name when the display name was cleared after publishing', async () => {
    const tenant = await api.newTenant();
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'organization-display-name': 'Example Verification Ltd',
    });
    const templateId = await createTemplate(api, tenant.token, template({}));
    const inquiryId = await createInquiry(api, { token: tenant.token, templateId });
    const token = await resumeInquiry(api, inquiryId, tenant.token);
    const issued = expectStatus(
      await post('/handoffs', { method: 'qr' }, token),
      201,
    ) as unknown as {
      'url-fragment': string;
    };
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'organization-display-name': null,
    });

    const preview = expectStatus(
      await post('/handoffs/preview', {
        'inquiry-id': inquiryId,
        'handoff-token': parseHandoffFragment(issued['url-fragment'])?.handoffToken ?? '',
      }),
      200,
    ) as unknown as Record<string, unknown>;

    expect(preview['organization-display-name']).toBe('Example Test Org');
    expect((await post('/handoffs', { method: 'qr' }, token)).json()).toMatchObject({
      code: 'display_name_required',
    });
  });
});

function facts(overrides: Partial<NetworkFacts>): NetworkFacts {
  return {
    isTor: null,
    isDatacenter: null,
    isVpn: null,
    isProxy: null,
    hostingAsn: null,
    hostingAsnConfidence: null,
    privacyRelay: null,
    threatLevel: null,
    countryCode: null,
    countryName: null,
    location: null,
    asn: null,
    organization: null,
    serviceType: null,
    proxyType: null,
    ipConnectionType: null,
    ...overrides,
  };
}

describe('the distance facts (C96.7)', () => {
  it('compares the phone’s network with the issuing session’s, and stays null where either is unknown', async () => {
    const { inquiryId } = await session(template({}));
    const desktopId = newId('iqse');
    const phoneId = newId('iqse');
    for (const id of [desktopId, phoneId]) {
      await createInquirySession(api.database.db, api.environmentId, {
        id,
        inquiryId,
        tokenHash: hashSessionToken(`ovs_${id.slice(5).padEnd(43, 'x')}`),
        expiresAt: new Date(api.clock.now().getTime() + 86_400_000),
      });
    }
    await api.database.db.execute(
      sql`update inquiry_sessions set device_handoff_method = 'qr',
            handoff_from_session_id = ${desktopId}, handoff_redeemed_at = now()
          where id = ${phoneId}`,
    );
    const evaluate = (
      sessionId: string,
      point: { latitude: number; longitude: number },
      asn: number,
    ) =>
      recordSessionNetworkEvaluation(api.database.db, api.environmentId, {
        id: newId('net'),
        inquirySessionId: sessionId,
        ip: '198.51.100.7',
        clientAddressSource: 'socket',
        evaluatedAt: api.clock.now(),
        facts: facts({
          countryCode: 'FR',
          countryName: 'France',
          asn,
          location: { regionCode: null, regionName: null, ...point },
        }),
        reasons: [],
        sources: [],
      });

    await recordDistanceFacts(api.database.db, api.environmentId, phoneId, desktopId);
    expect(await getInquirySession(api.database.db, api.environmentId, phoneId)).toMatchObject({
      handoffDistanceMeters: null,
      handoffCountryChanged: null,
      handoffAsnChanged: null,
    });

    await evaluate(desktopId, { latitude: 0, longitude: -30 }, 64500);
    await evaluate(phoneId, { latitude: 0, longitude: -29 }, 64501);
    await recordDistanceFacts(api.database.db, api.environmentId, phoneId, desktopId);

    expect(await getInquirySession(api.database.db, api.environmentId, phoneId)).toMatchObject({
      handoffDistanceMeters: 111195,
      handoffCountryChanged: false,
      handoffAsnChanged: true,
    });
  });
});

describe('a rejected handoff sends the inquiry to review when it completes (V02)', () => {
  it('follows completed with needs_review and records the cause, only with a marked verification', async () => {
    const run = async (marked: boolean) => {
      const { inquiryId } = await session(template({}));
      const verification = await createVerification(api.database.db, api.environmentId, {
        id: testId('ver'),
        inquiryId,
        type: 'government_id',
      });
      if (marked) {
        await api.database.db.execute(
          sql`update verifications set from_rejected_handoff = true where id = ${verification.id}`,
        );
      }
      const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
      if (inquiry === null) {
        throw new Error('no inquiry');
      }
      const moved = await api.database.db.transaction((tx) =>
        transitionInquiryInTx(tx, { events: api.events, clock: api.clock }, inquiry, 'completed'),
      );
      const audited = await api.database.db.execute(
        sql`select metadata from audit_logs
            where resource_id = ${inquiryId} and action = 'handoff.review-requested'`,
      );
      return { status: moved?.inquiry.status, audited: audited.rows };
    };

    expect(await run(true)).toEqual({
      status: 'needs_review',
      audited: [{ metadata: { cause: 'handoff_rejected' } }],
    });
    expect(await run(false)).toEqual({ status: 'completed', audited: [] });
  });
});
