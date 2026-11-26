/**
 * C96 (Workflow 7A, `flow-handoff`): the flow handoff routes end to end on the API, with PGlite.
 *
 * - Issue: a QR answers its fragment and stores only the token's digest; a new token revokes the
 *   previous; email goes only to a destination the inquiry confirmed by code (unless the step asks
 *   for a confirmation code), under the per-environment send budget, which fails closed.
 * - The phone's preview consumes nothing; every failure is the one uniform 410; a decline revokes
 *   the token and shows the step again; a redemption answers a new session token once, after the
 *   token check and only then the session cap, and the new session records its own consent.
 * - While the phone's session is active, the desktop's writes are refused (F13); "this was not
 *   me" ends the phone's session, cancels what it left open and shows the step again.
 * - Mobile sessions skip the step; continue-here records `continued_here` where it is allowed.
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import {
  defaultInquiryTemplateAttributes,
  parseHandoffFragment,
  type CreateInquiryTemplateAttributes,
} from '@openverify/contracts';
import {
  confirmOtpChallenge,
  createFile,
  createVerification,
  getInquiry,
  hashSessionToken,
  insertOtpChallenge,
  otpDestinationIndex,
  updateEnvironmentSettings,
} from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
} from '../../test-support/harness.js';
import { renderedPage, renditionAfter } from '../../test-support/rendition-pages.js';

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
const DESKTOP_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PHONE_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type HandoffOptions = Record<string, unknown>;

function handoffTemplate(options: HandoffOptions = {}): CreateInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  const [consent, ...rest] = attributes.flow.steps;
  if (consent === undefined) {
    throw new Error('the default template has no consent step');
  }
  attributes.flow.steps = [
    consent,
    { id: 'device_handoff', type: 'device_handoff', ...options } as never,
    ...rest,
  ];
  return attributes;
}

interface Desktop {
  inquiryId: string;
  token: string;
}

async function desktop(
  options: HandoffOptions = {},
  extra: Partial<CreateInquiryTemplateAttributes> = {},
): Promise<Desktop> {
  const templateId = await createTemplate(api, api.token, {
    ...handoffTemplate(options),
    ...extra,
  });
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  expectStatus(await get('/session', token), 200);
  expectStatus(await post('/consent', CONSENT_BODY, token), 201);
  return { inquiryId, token };
}

function get(url: string, token?: string, agent = DESKTOP_AGENT) {
  return api.app.inject({
    url: `${FLOW}${url}`,
    headers: { 'user-agent': agent, ...(token === undefined ? {} : bearer(token)) },
  });
}

function post(url: string, payload: unknown, token?: string, agent = DESKTOP_AGENT) {
  return api.app.inject({
    method: 'POST',
    url: `${FLOW}${url}`,
    headers: { 'user-agent': agent, ...(token === undefined ? {} : bearer(token)) },
    payload: payload as Record<string, unknown>,
  });
}

async function issueQr(session: Desktop) {
  const answer = expectStatus(
    await post('/handoffs', { method: 'qr' }, session.token),
    201,
  ) as unknown as { id: string; 'url-fragment': string; 'expires-at': string } & Record<
    string,
    unknown
  >;
  const parsed = parseHandoffFragment(answer['url-fragment']);
  if (parsed === null) {
    throw new Error('the answer carries no handoff fragment');
  }
  return { answer, handoffToken: parsed.handoffToken };
}

const tokenBody = (
  session: Desktop,
  handoffToken: string,
  extra: Record<string, unknown> = {},
) => ({
  'inquiry-id': session.inquiryId,
  'handoff-token': handoffToken,
  ...extra,
});

async function redeem(session: Desktop, handoffToken: string, extra: Record<string, unknown> = {}) {
  return post('/handoffs/redeem', tokenBody(session, handoffToken, extra), undefined, PHONE_AGENT);
}

async function handedOff(options: HandoffOptions = {}) {
  const session = await desktop(options);
  const { handoffToken } = await issueQr(session);
  const redeemed = expectStatus(await redeem(session, handoffToken), 200) as unknown as {
    'session-token': string;
  };
  return { session, handoffToken, phoneToken: redeemed['session-token'] };
}

async function handoffState(token: string, agent = DESKTOP_AGENT) {
  const body = expectStatus(await get('/session', token, agent), 200) as unknown as {
    handoff: { 'step-id': string; state: string } | null;
    'handoff-context': Record<string, unknown> | null;
    consent: unknown;
  };
  return body;
}

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await api.database.db.execute(query)).rows as T[];
}

const problemCode = (response: { json: () => unknown }) =>
  (response.json() as { code?: string }).code;

describe('publishing a device_handoff step (C96.1, F30)', () => {
  it('needs the environment’s organization display name (422 display_name_required)', async () => {
    const tenant = await api.newTenant();
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(tenant.token),
      payload: { data: { type: 'inquiry-template', attributes: handoffTemplate() } },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'display_name_required',
      errors: [expect.objectContaining({ pointer: '/data/attributes/flow/steps/1' })],
    });
  });

  it('refuses SMS where no SMS adapter is bound (422 sms_not_configured)', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'organization-display-name': 'Example Verification Ltd',
    });
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(tenant.token),
      payload: {
        data: {
          type: 'inquiry-template',
          attributes: handoffTemplate({ methods: ['qr', 'sms'] }),
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'sms_not_configured',
      errors: [expect.objectContaining({ pointer: '/data/attributes/flow/steps/1/methods' })],
    });
  });
});

describe('the rejected phone’s inquiry-session.canceled (K7A-15)', () => {
  it('carries the session with its device and network, as every session event does', async () => {
    const { session } = await handedOff();
    const [phone] = await rows<{ id: string }>(
      sql`select id from inquiry_sessions
           where inquiry_id = ${session.inquiryId} and handoff_from_session_id is not null`,
    );
    expectStatus(await post('/handoffs/current/reject', {}, session.token), 200);

    const event = api.events
      .named('inquiry-session.canceled')
      .find((candidate) => (candidate.payload.data as { id: string }).id === phone?.id);
    expect(event?.payload.data).toMatchObject({
      type: 'inquiry-session',
      id: phone?.id,
      attributes: { status: 'canceled' },
      relationships: { inquiry: { data: { id: session.inquiryId } } },
    });
    const included = (event?.payload as { included?: { type: string }[] }).included ?? [];
    expect(included.map(({ type }) => type)).toContain('network');
  });
});

describe('the desktop reloaded while the phone works (K7A-5)', () => {
  it('reads handed-off on its step, and neither the phone nor a later read does', async () => {
    const { session, phoneToken } = await handedOff();

    expect((await handoffState(session.token)).handoff).toEqual({
      'step-id': 'device_handoff',
      state: 'redeemed',
      'handed-off': true,
    });
    expect((await handoffState(phoneToken, PHONE_AGENT)).handoff).toEqual({
      'step-id': 'device_handoff',
      state: 'redeemed',
    });

    expectStatus(await post('/handoffs/current/reject', {}, session.token), 200);

    expect((await handoffState(session.token)).handoff).not.toHaveProperty('handed-off');
  });
});

describe('POST /flow/handoffs (C96.2, C96.3)', () => {
  it('issues a QR handoff: the fragment, a digest at rest, the step issued and the issue audited', async () => {
    const session = await desktop();

    const { answer, handoffToken } = await issueQr(session);

    expect(answer).toMatchObject({
      id: expect.stringMatching(/^hnd_/) as unknown,
      method: 'qr',
      'expires-at': new Date(api.clock.now().getTime() + 300_000).toISOString(),
    });
    expect(answer).not.toHaveProperty('confirmation-code');
    const [stored] = await rows<{ token_hash: string; method: string; step_id: string }>(
      sql`select token_hash, method, step_id from handoff_tokens where id = ${answer.id}`,
    );
    expect(stored).toEqual({
      token_hash: sha256(handoffToken),
      method: 'qr',
      step_id: 'device_handoff',
    });
    expect((await handoffState(session.token)).handoff).toEqual({
      'step-id': 'device_handoff',
      state: 'issued',
    });
    const audited = await rows<{ action: string; actor_type: string }>(
      sql`select action, actor_type from audit_logs
          where environment_id = ${api.environmentId} and resource_id = ${answer.id}`,
    );
    expect(audited).toEqual([{ action: 'handoff.issued', actor_type: 'system' }]);
  });

  it('revokes the session’s previous token when it issues a new one', async () => {
    const session = await desktop();
    const first = await issueQr(session);
    await issueQr(session);

    const response = await redeem(session, first.handoffToken);

    expect(response.statusCode).toBe(410);
    expect(problemCode(response)).toBe('handoff_token_invalid');
  });

  it('never outlives the inquiry', async () => {
    const session = await desktop();
    await api.database.db.execute(
      sql`update inquiries set expires_at = ${new Date(api.clock.now().getTime() + 60_000)}
          where id = ${session.inquiryId}`,
    );

    const { answer } = await issueQr(session);

    expect(answer['expires-at']).toBe(new Date(api.clock.now().getTime() + 60_000).toISOString());
  });

  it('refuses a method the step does not allow, and a flow without a waiting handoff step', async () => {
    const session = await desktop();
    const sms = await post(
      '/handoffs',
      { method: 'sms', destination: '+12025550123' },
      session.token,
    );
    expect(sms.statusCode).toBe(422);
    expect(problemCode(sms)).toBe('handoff_method_not_allowed');

    const plainInquiry = await createInquiry(api);
    const plain = await resumeInquiry(api, plainInquiry);
    const none = await post('/handoffs', { method: 'qr' }, plain);
    expect(none.statusCode).toBe(409);
    expect(problemCode(none)).toBe('handoff_not_available');
  });

  it('sends email only to a destination the inquiry confirmed, and answers no token', async () => {
    const session = await desktop({ methods: ['qr', 'email'] });
    const refused = await post(
      '/handoffs',
      { method: 'email', destination: 'person@example.com' },
      session.token,
    );
    expect(refused.statusCode).toBe(422);
    expect(problemCode(refused)).toBe('destination_not_confirmed');
    expect(api.mailer.messages).toHaveLength(0);

    await confirmEmail(session.inquiryId, 'person@example.com');
    const sent = expectStatus(
      await post(
        '/handoffs',
        { method: 'email', destination: 'Person@Example.com' },
        session.token,
      ),
      201,
    ) as unknown as Record<string, unknown>;

    expect(sent).toMatchObject({ method: 'email' });
    expect(sent).not.toHaveProperty('url-fragment');
    const message = api.mailer.messages.at(-1);
    expect(message?.to).toEqual({ address: 'Person@example.com' });
    expect(message?.text).toContain('https://flow.example.test/#inquiry-id=');
    expect(message?.text).toContain('&handoff-token=ovh_');
    expect(api.rateLimiter.calls.at(-1)).toMatchObject({
      key: `${api.environmentId}|handoff-sends`,
      policy: { limit: 200, windowSeconds: 3600 },
    });
  });

  it('extends the expiry on a redemption as a resume does: max(expires-at, now + after-resume) (FE2, K9-28)', async () => {
    const session = await desktop(
      {},
      {
        settings: {
          'inquiry-expiration-seconds': 3_600,
          'inquiry-expiration-after-resume-seconds': 7_200,
        },
      },
    );
    const { handoffToken } = await issueQr(session);
    const expiry = async () =>
      (await getInquiry(api.database.db, api.environmentId, session.inquiryId))?.expiresAt;
    const before = await expiry();
    api.clock.advance(60_000);

    expectStatus(await redeem(session, handoffToken), 200);

    const after = await expiry();
    expect(after).toEqual(new Date(api.clock.now().getTime() + 7_200_000));
    expect((after?.getTime() ?? 0) > (before?.getTime() ?? 0)).toBe(true);
  });

  it('sends the link from the environment’s mail-sender-name (C169.8, K9-25)', async () => {
    const session = await desktop({ methods: ['qr', 'email'] });
    await confirmEmail(session.inquiryId, 'named@example.com');
    await api.database.db.execute(sql`update environments
      set settings = settings || '{"mail-sender-name": "Synthetic Bank"}'::jsonb
      where id = ${api.environmentId}`);

    try {
      expectStatus(
        await post(
          '/handoffs',
          { method: 'email', destination: 'named@example.com' },
          session.token,
        ),
        201,
      );
    } finally {
      await api.database.db.execute(sql`update environments
        set settings = settings - 'mail-sender-name' where id = ${api.environmentId}`);
    }

    expect(api.mailer.messages.at(-1)?.senderName).toBe('Synthetic Bank');
  });

  it('sends to an unconfirmed destination only with a confirmation code, whose preview withholds the context until the code', async () => {
    const session = await desktop({ methods: ['qr', 'email'], confirmationCode: true });

    const sent = expectStatus(
      await post('/handoffs', { method: 'email', destination: 'other@example.com' }, session.token),
      201,
    ) as unknown as { 'confirmation-code': string };
    const link = api.mailer.messages.at(-1)?.text ?? '';
    const fragment = /#inquiry-id=\S+/.exec(link)?.[0] ?? '';
    const parsed = parseHandoffFragment(fragment);
    if (parsed === null) {
      throw new Error('the email carries no handoff link');
    }

    const preview = expectStatus(
      await post('/handoffs/preview', tokenBody(session, parsed.handoffToken)),
      200,
    ) as unknown as Record<string, unknown>;
    expect(preview).toEqual({
      'organization-display-name': 'Example Verification Ltd',
      method: 'email',
      'confirmation-code-required': true,
      context: null,
    });
    const withCode = expectStatus(
      await post(
        '/handoffs/preview',
        tokenBody(session, parsed.handoffToken, { 'confirmation-code': sent['confirmation-code'] }),
      ),
      200,
    ) as unknown as { context: unknown };
    expect(withCode.context).toMatchObject({ steps: ['government_id', 'selfie'] });
  });

  it('refuses an email or SMS send when the budget is spent (429), and when its store cannot answer (503)', async () => {
    const refusing = await createInquiryTestApi({ rateLimiter: budgetLimiter('refuse') });
    const failing = await createInquiryTestApi({ rateLimiter: budgetLimiter('throw') });
    try {
      for (const [harness, status] of [
        [refusing, 429],
        [failing, 503],
      ] as const) {
        await updateEnvironmentSettings(harness.database.db, harness.environmentId, {
          'organization-display-name': 'Example Verification Ltd',
        });
        const templateId = await createTemplate(
          harness,
          harness.token,
          handoffTemplate({ methods: ['qr', 'email'], confirmationCode: true }),
        );
        const token = await resumeInquiry(harness, await createInquiry(harness, { templateId }));
        const response = await harness.app.inject({
          method: 'POST',
          url: `${FLOW}/handoffs`,
          headers: bearer(token),
          payload: { method: 'email', destination: 'person@example.com' },
        });

        expect(response.statusCode).toBe(status);
        expect(problemCode(response)).toBe('handoff_send_limited');
        expect(harness.mailer.messages).toHaveLength(0);
        const tokens = await harness.database.db.execute(sql`select id from handoff_tokens`);
        expect(tokens.rows).toHaveLength(0);
      }
    } finally {
      await refusing.close();
      await failing.close();
    }
  });
});

describe('the phone’s preview, decline and redemption (C96.3, P15, P28, V04)', () => {
  it('previews without consuming the token: the name, the method and the context', async () => {
    const session = await desktop();
    const { handoffToken } = await issueQr(session);

    for (let count = 0; count < 2; count += 1) {
      const preview = expectStatus(
        await post('/handoffs/preview', tokenBody(session, handoffToken)),
        200,
      ) as unknown as Record<string, unknown>;
      expect(preview).toEqual({
        'organization-display-name': 'Example Verification Ltd',
        method: 'qr',
        'confirmation-code-required': false,
        context: {
          steps: ['government_id', 'selfie'],
          'started-at': expect.any(String) as unknown,
          'issuing-country-code': null,
          attribution: null,
        },
      });
    }
    expectStatus(await redeem(session, handoffToken), 200);
  });

  it('answers every failure with the one uniform 410', async () => {
    const session = await desktop();
    const other = await desktop();
    const { handoffToken } = await issueQr(session);
    const unknown = `ovh_${'A'.repeat(43)}`;

    const failures = [
      await post('/handoffs/preview', tokenBody(session, unknown)),
      await post('/handoffs/preview', tokenBody(other, handoffToken)),
      await post('/handoffs/decline', tokenBody(session, unknown)),
      await redeem(other, handoffToken),
    ];
    api.clock.advance(301_000);
    failures.push(await post('/handoffs/preview', tokenBody(session, handoffToken)));
    failures.push(await redeem(session, handoffToken));

    const bodies = failures.map((response) => ({
      status: response.statusCode,
      code: problemCode(response),
      detail: response.json<{ detail?: string }>().detail,
    }));
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toMatchObject({ status: 410, code: 'handoff_token_invalid' });
  });

  it('redeems once: a new session with its handoff fields, its own consent, and the context screen', async () => {
    const { session, handoffToken, phoneToken } = await handedOff();

    const again = await redeem(session, handoffToken);
    expect(again.statusCode).toBe(410);

    const [phone] = await rows<Record<string, unknown>>(
      sql`select device_handoff_method, handoff_from_session_id, handoff_redeemed_at, started_at
          from inquiry_sessions where token_hash = ${hashSessionToken(phoneToken)}`,
    );
    expect(phone).toMatchObject({
      device_handoff_method: 'qr',
      handoff_from_session_id: expect.stringMatching(/^iqse_/) as unknown,
    });
    expect(phone?.handoff_redeemed_at).not.toBeNull();
    expect(phone?.started_at).not.toBeNull();

    const served = await handoffState(phoneToken, PHONE_AGENT);
    expect(served.consent).toBeNull();
    expect(served.handoff).toEqual({ 'step-id': 'device_handoff', state: 'redeemed' });
    expect(served['handoff-context']).toMatchObject({
      'organization-display-name': 'Example Verification Ltd',
      steps: ['government_id', 'selfie'],
    });
    expect((await handoffState(session.token)).handoff).toEqual({
      'step-id': 'device_handoff',
      state: 'redeemed',
      'handed-off': true,
    });
    expect(api.events.named('inquiry-session.started').length).toBeGreaterThanOrEqual(2);
  });

  it('asks for the confirmation code on redemption, and revokes the token at the fifth wrong one', async () => {
    const session = await desktop({ confirmationCode: true });
    const { answer, handoffToken } = await issueQr(session);
    const code = answer['confirmation-code'] as string;
    expect(code).toMatch(/^[0-9]{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';

    expect((await redeem(session, handoffToken)).statusCode).toBe(410);
    for (let count = 0; count < 4; count += 1) {
      expect((await redeem(session, handoffToken, { 'confirmation-code': wrong })).statusCode).toBe(
        410,
      );
    }
    expect((await redeem(session, handoffToken, { 'confirmation-code': code })).statusCode).toBe(
      410,
    );

    const fresh = await issueQr(session);
    expect(
      (
        await redeem(session, fresh.handoffToken, {
          'confirmation-code': fresh.answer['confirmation-code'],
        })
      ).statusCode,
    ).toBe(200);
  });

  it('declines: the token is revoked and the desktop sees the step again', async () => {
    const session = await desktop();
    const { handoffToken } = await issueQr(session);

    const declined = await post('/handoffs/decline', tokenBody(session, handoffToken));

    expect(declined.statusCode).toBe(200);
    expect(declined.json()).toBeNull();
    expect((await handoffState(session.token)).handoff?.state).toBe('declined');
    expect((await redeem(session, handoffToken)).statusCode).toBe(410);
    const audited = await rows<{ action: string }>(
      sql`select action from audit_logs where environment_id = ${api.environmentId}
          and action = 'handoff.declined'`,
    );
    expect(audited.length).toBeGreaterThanOrEqual(1);
  });

  it('applies the session cap only after the token, and leaves the token unused (C91.5, P28)', async () => {
    const session = await desktop({}, { settings: { 'max-sessions': 1 } });
    const { handoffToken } = await issueQr(session);

    const capped = await redeem(session, handoffToken);

    expect(capped.statusCode).toBe(409);
    expect(problemCode(capped)).toBe('session_limit_reached');
    const [token] = await rows<{ redeemed_at: Date | null }>(
      sql`select redeemed_at from handoff_tokens where token_hash = ${sha256(handoffToken)}`,
    );
    expect(token?.redeemed_at).toBeNull();
    const invalid = await redeem(session, `ovh_${'B'.repeat(43)}`);
    expect(invalid.statusCode).toBe(410);
  });
});

describe('one capturing device at a time, and "this was not me" (C96.3, F13, V02)', () => {
  it('refuses the desktop’s writes while the phone’s session is active', async () => {
    const { session } = await handedOff();

    const refused = await post('/consent', CONSENT_BODY, session.token);

    expect(refused.statusCode).toBe(409);
    expect(problemCode(refused)).toBe('session_handed_off');
    const current = expectStatus(
      await get('/handoffs/current', session.token),
      200,
    ) as unknown as Record<string, unknown>;
    expect(current).toMatchObject({
      status: 'redeemed',
      'redeemed-at': expect.any(String) as unknown,
      'os-name': 'iOS',
      'browser-name': 'Safari',
    });
  });

  it('rejects: the phone’s session ends, its open verification is canceled, and the desktop works again', async () => {
    const { session, phoneToken } = await handedOff();
    expectStatus(await post('/consent', CONSENT_BODY, phoneToken, PHONE_AGENT), 201);
    const created = expectStatus(
      await post('/verifications', { type: 'government-id' }, phoneToken, PHONE_AGENT),
      201,
    );

    const rejected = expectStatus(
      await post('/handoffs/current/reject', {}, session.token),
      200,
    ) as unknown as Record<string, unknown>;

    expect(rejected).toEqual({
      status: 'rejected',
      'redeemed-at': null,
      'os-name': null,
      'browser-name': null,
    });
    expect((await get('/session', phoneToken, PHONE_AGENT)).statusCode).toBe(401);
    const [verification] = await rows<{ status: string }>(
      sql`select status from verifications where id = ${created.data.id}`,
    );
    expect(verification?.status).toBe('canceled');
    expect((await handoffState(session.token)).handoff?.state).toBe('rejected');
    expect((await post('/consent', CONSENT_BODY, session.token)).statusCode).toBe(201);
    expect(api.events.named('inquiry-session.canceled').length).toBeGreaterThanOrEqual(1);
  });

  it('discards the canceled files’ rendition pages and deletes their objects after the commit (K8-29)', async () => {
    const { session, phoneToken } = await handedOff();
    expectStatus(await post('/consent', CONSENT_BODY, phoneToken, PHONE_AGENT), 201);
    const created = expectStatus(
      await post('/verifications', { type: 'government-id' }, phoneToken, PHONE_AGENT),
      201,
    );
    const key = `${api.environmentId}/synthetic-phone-front`;
    await api.storage.put(key, new Uint8Array([1, 2, 3]));
    const file = await createFile(api.database.db, api.environmentId, {
      id: testId('file'),
      verificationId: created.data.id,
      kind: 'front',
      storageKey: key,
      mimeType: 'image/jpeg',
      byteSize: 3,
      sha256: 'c'.repeat(64),
      wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
    });
    const page = await renderedPage(api.database.db, api.storage, api.environmentId, file.id);

    expectStatus(await post('/handoffs/current/reject', {}, session.token), 200);

    expect(await renditionAfter(api.database.db, file.id, page)).toEqual({
      discarded: true,
      status: 'deleted',
    });
    expect(api.storage.keys()).not.toContain(page.storageKey);
    expect(api.storage.keys()).not.toContain(key);
  });

  it('marks a submitted verification of the rejected phone and keeps it', async () => {
    const { session, phoneToken } = await handedOff();
    const [phone] = await rows<{ id: string; inquiry_id: string }>(
      sql`select id, inquiry_id from inquiry_sessions where token_hash = ${hashSessionToken(phoneToken)}`,
    );
    const submitted = await createVerification(api.database.db, api.environmentId, {
      id: testId('ver'),
      inquiryId: phone?.inquiry_id ?? '',
      type: 'government_id',
      createdBySessionId: phone?.id ?? null,
    });
    await api.database.db.execute(
      sql`update verifications set status = 'submitted', submitted_at = now() where id = ${submitted.id}`,
    );

    expectStatus(await post('/handoffs/current/reject', {}, session.token), 200);

    const [marked] = await rows<{ status: string; from_rejected_handoff: boolean }>(
      sql`select status, from_rejected_handoff from verifications where id = ${submitted.id}`,
    );
    expect(marked).toEqual({ status: 'submitted', from_rejected_handoff: true });
  });

  it('refuses a rejection when nothing was redeemed', async () => {
    const session = await desktop();

    const response = await post('/handoffs/current/reject', {}, session.token);

    expect(response.statusCode).toBe(409);
    expect(problemCode(response)).toBe('handoff_not_redeemed');
  });
});

describe('continue-here and mobile sessions (C96.1, C96.3, F01)', () => {
  it('records continued_here where the step allows it, and refuses it where it does not', async () => {
    const allowed = await desktop();
    const answer = expectStatus(
      await post('/handoffs/continue-here', {}, allowed.token),
      200,
    ) as unknown as Record<string, unknown>;
    expect(answer).toMatchObject({ status: 'continued_here' });
    expect((await handoffState(allowed.token)).handoff?.state).toBe('continued_here');

    const refused = await desktop({ allowContinueHere: false });
    const response = await post('/handoffs/continue-here', {}, refused.token);
    expect(response.statusCode).toBe(409);
    expect(problemCode(response)).toBe('continue_here_not_allowed');
  });

  it('skips the step for a smartphone, and for an SDK session', async () => {
    const templateId = await createTemplate(api, api.token, handoffTemplate());
    const phone = await resumeInquiry(api, await createInquiry(api, { templateId }));
    expect((await handoffState(phone, PHONE_AGENT)).handoff?.state).toBe('skipped');

    const sdk = await resumeInquiry(api, await createInquiry(api, { templateId }));
    expect((await handoffState(sdk, 'OpenVerify-Android/1.4.0')).handoff?.state).toBe('skipped');

    const desktopSession = await resumeInquiry(api, await createInquiry(api, { templateId }));
    expect((await handoffState(desktopSession)).handoff?.state).toBe('pending');
  });

  it('serves no handoff for a flow without the step', async () => {
    const plain = await resumeInquiry(api, await createInquiry(api));

    expect(await handoffState(plain)).toMatchObject({ handoff: null, 'handoff-context': null });
  });
});

/** A confirmed email code for `address` on the inquiry, as the OTP confirm would leave it. */
async function confirmEmail(inquiryId: string, address: string): Promise<void> {
  const verification = await createVerification(api.database.db, api.environmentId, {
    id: testId('ver'),
    inquiryId,
    type: 'email_address',
  });
  const id = testId('otpc');
  await insertOtpChallenge(api.database.db, api.environmentId, {
    id,
    verificationId: verification.id,
    inquiryId,
    channel: 'email',
    destination: address,
    destinationIndex: otpDestinationIndex(api.deps.blindIndexKey, {
      environmentId: api.environmentId,
      channel: 'email',
      destination: address,
    }),
    codeHmac: new Uint8Array(32),
    codeKeyId: api.database.keyring.currentKeyId,
    provider: 'smtp',
    sentAt: api.clock.now(),
    expiresAt: new Date(api.clock.now().getTime() + 600_000),
  });
  await confirmOtpChallenge(api.database.db, api.environmentId, id, api.clock.now());
}

/** A limiter that allows everything but the handoff send budget, which it refuses or fails. */
function budgetLimiter(mode: 'refuse' | 'throw'): RateLimiter {
  return {
    consume(key, policy) {
      if (key.endsWith('|handoff-sends')) {
        if (mode === 'throw') {
          return Promise.reject(new Error('the limiter store is down'));
        }
        return Promise.resolve({
          allowed: false,
          limit: policy.limit,
          remaining: 0,
          resetAt: new Date('2030-01-01T00:00:00.000Z'),
          retryAfterSeconds: 60,
        });
      }
      return Promise.resolve({
        allowed: true,
        limit: policy.limit,
        remaining: policy.limit,
        resetAt: new Date('2030-01-01T00:00:00.000Z'),
        retryAfterSeconds: 0,
      });
    },
  };
}
