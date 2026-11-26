/**
 * Workflow 7A Stage 3 (`api-signals`; C91.1, C91.5, C93.2, C94.5): the session paths.
 *
 * - The first flow call records the session's parsed device from its user agent: bowser for a
 *   browser, the exact SDK header for the Android SDK, nothing for an unparsable one (never a
 *   guess, and the start still commits).
 * - The session cap counts every session the inquiry ever had: a resume or a one-time-link
 *   redemption past `max-sessions` answers 409 `session_limit_reached` and creates nothing; with
 *   `expire-inquiry-on-session-limit` the refused attempt also expires the inquiry.
 * - `expire-all` with `meta.inquiry-ids` expires every active session of each inquiry at once, or
 *   none when one inquiry is not found.
 * - `POST /inquiry-sessions/:id/generate-one-time-link` makes a C10 link for the session's inquiry.
 *
 * Every user agent is synthetic; no address is read.
 */
import {
  defaultInquiryTemplateAttributes,
  type CreateInquiryTemplateAttributes,
} from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  openFlowSession,
  resumeInquiry,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/130.0.0.0 Safari/537.36';

async function startSession(sessionToken: string, userAgent: string | undefined) {
  expectStatus(
    await api.app.inject({
      method: 'GET',
      url: '/api/v1/flow/session',
      headers: {
        ...bearer(sessionToken),
        ...(userAgent === undefined ? {} : { 'user-agent': userAgent }),
      },
    }),
    200,
  );
}

async function sessionsOf(inquiryId: string) {
  const document = expectStatus(
    await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-sessions?filter[inquiry-id]=${inquiryId}`,
      headers: bearer(api.token),
    }),
    200,
  ) as unknown as { data: { id: string; attributes: Record<string, unknown> }[] };
  return document.data;
}

describe('recordSessionDeviceInTx (C93.2, C94.5)', () => {
  it('writes the parsed browser, system and device type of the first flow call', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await startSession(sessionToken, CHROME_WINDOWS);
    const [session] = await sessionsOf(inquiryId);
    expect(session?.attributes).toMatchObject({
      'os-name': 'Windows',
      'browser-name': 'Chrome',
      'browser-full-version': '130.0.0.0',
      'device-type': 'desktop',
      'mobile-sdk-name': null,
      'mobile-sdk-full-version': null,
    });
  });

  it('reads the SDK header exactly, leaving the device type to the SDK’s signal body', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await startSession(sessionToken, 'OpenVerify-Android/1.4.2');
    const [session] = await sessionsOf(inquiryId);
    expect(session?.attributes).toMatchObject({
      'os-name': 'Android',
      'browser-name': null,
      'device-type': null,
      'mobile-sdk-name': 'openverify-android',
      'mobile-sdk-full-version': '1.4.2',
    });
  });

  it('leaves every field null for an unparsable or missing user agent, and the start commits', async () => {
    for (const userAgent of ['\u0001\u0002 not a browser', undefined]) {
      const { inquiryId, sessionToken } = await openFlowSession(api);
      await startSession(sessionToken, userAgent);
      const [session] = await sessionsOf(inquiryId);
      expect(session?.attributes['started-at']).not.toBeNull();
      expect(session?.attributes).toMatchObject({
        'os-name': null,
        'browser-name': null,
        'device-type': null,
        'device-name': null,
        'mobile-sdk-name': null,
      });
    }
  });
});

async function cappedTemplate(settings: CreateInquiryTemplateAttributes['settings']) {
  return createTemplate(api, api.token, { ...defaultInquiryTemplateAttributes(), settings });
}

const resume = (inquiryId: string) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${inquiryId}/resume`,
    headers: bearer(api.token),
  });

async function statusOf(inquiryId: string): Promise<string> {
  const document = expectStatus(
    await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiries/${inquiryId}`,
      headers: bearer(api.token),
    }),
    200,
  );
  return String(document.data.attributes.status);
}

async function oneTimeToken(inquiryId: string, url = `/api/v1/inquiries/${inquiryId}`) {
  const document = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `${url}/generate-one-time-link`,
      headers: bearer(api.token),
    }),
    200,
  );
  const link = new URL(String(document.meta?.['one-time-link']));
  return new URLSearchParams(link.hash.slice(1)).get('one-time-token') ?? '';
}

const redeem = (inquiryId: string, token: string) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/one-time-links/redeem',
    payload: { 'inquiry-id': inquiryId, 'one-time-token': token },
  });

describe('assertSessionCapInTx (C91.5)', () => {
  it('refuses a resume past max-sessions with 409, counting expired sessions, and creates none', async () => {
    const templateId = await cappedTemplate({ 'max-sessions': 2 });
    const inquiryId = await createInquiry(api, { templateId });
    await resumeInquiry(api, inquiryId);
    const [first] = await sessionsOf(inquiryId);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiry-sessions/${first?.id ?? ''}/expire`,
        headers: bearer(api.token),
      }),
      200,
    );
    await resumeInquiry(api, inquiryId);
    const refused = await resume(inquiryId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('session_limit_reached');
    expect(await sessionsOf(inquiryId)).toHaveLength(2);
    expect(await statusOf(inquiryId)).toBe('created');
  });

  it('refuses a one-time-link redemption at the cap, leaving the link unused', async () => {
    const templateId = await cappedTemplate({ 'max-sessions': 1 });
    const inquiryId = await createInquiry(api, { templateId });
    await resumeInquiry(api, inquiryId);
    const token = await oneTimeToken(inquiryId);
    const refused = await redeem(inquiryId, token);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('session_limit_reached');
    expect(await sessionsOf(inquiryId)).toHaveLength(1);
    const { rows } = await api.database.client.query<{ used: boolean }>(
      'select used_at is not null as used from one_time_links where inquiry_id = $1',
      [inquiryId],
    );
    expect(rows.map((row) => row.used)).toEqual([false]);
  });

  it('with expire-inquiry-on-session-limit, expires the inquiry on the refused attempt', async () => {
    const templateId = await cappedTemplate({
      'max-sessions': 1,
      'expire-inquiry-on-session-limit': true,
    });
    const inquiryId = await createInquiry(api, { templateId });
    await resumeInquiry(api, inquiryId);
    const before = api.events.named('inquiry.expired').length;
    const refused = await resume(inquiryId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('session_limit_reached');
    expect(await statusOf(inquiryId)).toBe('expired');
    const expired = api.events.named('inquiry.expired');
    expect(expired).toHaveLength(before + 1);
    expect(await sessionsOf(inquiryId)).toHaveLength(1);
  });

  it('lets an inquiry under its cap open sessions as before (the default is 25)', async () => {
    const { inquiryId } = await openFlowSession(api);
    for (let index = 0; index < 3; index += 1) {
      await resumeInquiry(api, inquiryId);
    }
    expect(await sessionsOf(inquiryId)).toHaveLength(4);
  });
});

describe('expire-all with meta.inquiry-ids (C91.5)', () => {
  const expireAll = (meta: Record<string, unknown>) =>
    api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-sessions/expire-all',
      headers: bearer(api.token),
      payload: { meta },
    });

  it('expires every active session of each inquiry, with its event and audit entry', async () => {
    const one = await openFlowSession(api);
    await resumeInquiry(api, one.inquiryId);
    const two = await openFlowSession(api);
    const idle = await createInquiry(api);
    const events = api.events.named('inquiry-session.expired').length;
    const audits = api.audit.withAction('inquiry-session.expired').length;
    const document = expectStatus(
      await expireAll({ 'inquiry-ids': [one.inquiryId, two.inquiryId, idle] }),
      200,
    );
    expect(document.meta).toEqual({ 'expired-count': 3 });
    expect(api.events.named('inquiry-session.expired')).toHaveLength(events + 3);
    expect(api.audit.withAction('inquiry-session.expired')).toHaveLength(audits + 3);
    for (const session of [
      ...(await sessionsOf(one.inquiryId)),
      ...(await sessionsOf(two.inquiryId)),
    ]) {
      expect(session.attributes.status).toBe('expired');
    }
    expect(expectStatus(await expireAll({ 'inquiry-ids': [one.inquiryId] }), 200).meta).toEqual({
      'expired-count': 0,
    });
  });

  it('expires nothing and answers 404 when one inquiry is not in this environment', async () => {
    const mine = await openFlowSession(api);
    const tenant = await api.newTenant();
    const theirs = await createInquiry(api, { token: tenant.token });
    const response = await expireAll({ 'inquiry-ids': [mine.inquiryId, theirs] });
    expect(response.statusCode).toBe(404);
    const [session] = await sessionsOf(mine.inquiryId);
    expect(session?.attributes.status).toBe('active');
  });
});

describe('POST /inquiry-sessions/:id/generate-one-time-link (C91.5)', () => {
  it('makes a C10 link for the session’s inquiry, revoking its older unused links', async () => {
    const { inquiryId } = await openFlowSession(api);
    const [session] = await sessionsOf(inquiryId);
    const older = await oneTimeToken(inquiryId);
    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-sessions/${session?.id ?? ''}/generate-one-time-link`,
      headers: bearer(api.token),
    });
    const document = expectStatus(response, 200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(document.data.id).toBe(session?.id);
    expect(document.meta?.['one-time-link-short']).toBeNull();
    expect(Date.parse(String(document.meta?.['expires-at']))).not.toBeNaN();
    const link = new URL(String(document.meta?.['one-time-link']));
    const fragment = new URLSearchParams(link.hash.slice(1));
    expect(fragment.get('inquiry-id')).toBe(inquiryId);
    expect((await redeem(inquiryId, older)).statusCode).toBe(401);
    expectStatus(await redeem(inquiryId, fragment.get('one-time-token') ?? ''), 200);
    expect(api.audit.withAction('inquiry.one-time-link-generated').at(-1)?.resourceId).toBe(
      inquiryId,
    );
  });

  it('gives the link the requested lifetime (K7A-3)', async () => {
    const { inquiryId } = await openFlowSession(api);
    const [session] = await sessionsOf(inquiryId);

    const document = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiry-sessions/${session?.id ?? ''}/generate-one-time-link`,
        headers: bearer(api.token),
        payload: { meta: { 'expires-in-seconds': 600 } },
      }),
      200,
    );

    expect(document.meta?.['expires-at']).toBe(
      new Date(api.clock.now().getTime() + 600_000).toISOString(),
    );
    const { rows } = await api.database.client.query<{ expires_at: Date }>(
      'select expires_at from one_time_links where inquiry_id = $1 order by created_at desc limit 1',
      [inquiryId],
    );
    expect(rows[0]?.expires_at.toISOString()).toBe(document.meta?.['expires-at']);
  });

  it('answers 404 for a session of another environment', async () => {
    const tenant = await api.newTenant();
    const theirs = await openFlowSession(api, { token: tenant.token });
    const [session] = (
      expectStatus(
        await api.app.inject({
          method: 'GET',
          url: `/api/v1/inquiry-sessions?filter[inquiry-id]=${theirs.inquiryId}`,
          headers: bearer(tenant.token),
        }),
        200,
      ) as unknown as { data: { id: string }[] }
    ).data;
    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiry-sessions/${session?.id ?? ''}/generate-one-time-link`,
      headers: bearer(api.token),
    });
    expect(response.statusCode).toBe(404);
  });
});
