/**
 * Workflow 7A Stage 1b (S) (C91.5, C93.2, C94.5; F28): the session paths call the `api-signals`
 * hooks, replaced here by spies that read through the transaction they are given.
 *
 * - The first successful flow call records the session's parsed device fields
 *   (`recordSessionDeviceInTx`) in the start's transaction, once, with the user agent; a failure
 *   rolls the start back.
 * - `resume` and the one-time-link redemption ask `assertSessionCapInTx` under the inquiry's lock,
 *   with the pinned `max-sessions` settings, before creating the session. A limited answer commits
 *   what the hook wrote (an expiry), creates no session and answers 409 `session_limit_reached`;
 *   the redemption checks the token first (P28), so an invalid token never reaches the cap.
 */
import { sql } from 'drizzle-orm';
import type { Db, Inquiry } from '@openverify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleDeps } from '../../services/inquiries.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import type { SessionCapSettings, SessionDeviceTarget } from '../../services/signals/sessions.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  openFlowSession,
} from '../../test-support/harness.js';

interface DeviceCall {
  session: SessionDeviceTarget;
  client: { userAgent: string | null };
  at: Date;
  startedInTx: boolean;
}

interface CapCall {
  inquiry: Inquiry;
  settings: SessionCapSettings;
  hasDeps: boolean;
}

const deviceCalls = vi.hoisted(() => [] as DeviceCall[]);
const capCalls = vi.hoisted(() => [] as CapCall[]);
const control = vi.hoisted(() => ({
  failDevice: false,
  limit: 'no',
}));

vi.mock('../../services/signals/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/signals/sessions.js')>();
  return {
    ...actual,
    recordSessionDeviceInTx: async (
      tx: Db,
      session: SessionDeviceTarget,
      client: { userAgent: string | null },
      at: Date,
    ) => {
      const seen = (await tx.execute(
        sql`select started_at is not null as started from inquiry_sessions where id = ${session.id}`,
      )) as { rows: { started?: boolean }[] };
      deviceCalls.push({ session, client, at, startedInTx: seen.rows[0]?.started === true });
      if (control.failDevice) {
        control.failDevice = false;
        throw new TypeError('synthetic device failure');
      }
    },
    assertSessionCapInTx: async (
      tx: Db,
      deps: LifecycleDeps,
      inquiry: Inquiry,
      settings: SessionCapSettings,
    ) => {
      capCalls.push({ inquiry, settings, hasDeps: typeof deps.clock.now === 'function' });
      if (control.limit === 'no') {
        return { limited: false };
      }
      // A write in the hook's transaction: kept with an expiry, rolled back with a plain refusal.
      await tx.execute(sql`update inquiries set tags = '{capped}' where id = ${inquiry.id}`);
      return control.limit === 'expire'
        ? { limited: true, expired: true, staged: [], storageKeys: [] }
        : { limited: true, expired: false };
    },
  };
});

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  deviceCalls.length = 0;
  capCalls.length = 0;
  control.failDevice = false;
  control.limit = 'no';
});

const SESSION = '/api/v1/flow/session';

async function sessionRows(inquiryId: string) {
  const { rows } = await api.database.client.query<{ started: boolean }>(
    'select started_at is not null as started from inquiry_sessions where inquiry_id = $1',
    [inquiryId],
  );
  return rows.map((row) => row.started);
}

async function tagsOf(inquiryId: string): Promise<string[] | undefined> {
  const { rows } = await api.database.client.query<{ tags: string[] }>(
    'select tags from inquiries where id = $1',
    [inquiryId],
  );
  return rows[0]?.tags;
}

const resume = (inquiryId: string) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${inquiryId}/resume`,
    headers: bearer(api.token),
  });

async function oneTimeToken(inquiryId: string): Promise<string> {
  const document = expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiryId}/generate-one-time-link`,
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

describe('the session start records the parsed device (C93.2, C94.5)', () => {
  it('once, in the transaction that records the start, with the user agent', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const call = () =>
      api.app.inject({
        url: SESSION,
        headers: { ...bearer(sessionToken), 'user-agent': 'Synthetic-Browser/1.0' },
      });

    expectStatus(await call(), 200);
    expectStatus(await call(), 200);

    expect(deviceCalls).toHaveLength(1);
    expect(deviceCalls[0]?.session).toMatchObject({ environmentId: api.environmentId, inquiryId });
    expect(deviceCalls[0]?.client).toEqual({ userAgent: 'Synthetic-Browser/1.0' });
    expect(deviceCalls[0]?.at).toEqual(api.clock.now());
    expect(deviceCalls[0]?.startedInTx).toBe(true);
  });

  it('rolls the start back when the device cannot be recorded', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    control.failDevice = true;

    expect((await api.app.inject({ url: SESSION, headers: bearer(sessionToken) })).statusCode).toBe(
      500,
    );
    expect(await sessionRows(inquiryId)).toEqual([false]);
    expectStatus(await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }), 200);
    expect(await sessionRows(inquiryId)).toEqual([true]);
  });
});

describe('the session cap is asked before a session is created (C91.5)', () => {
  it('by resume, with the locked inquiry and the pinned cap settings', async () => {
    const inquiryId = await createInquiry(api, {});

    expectStatus(await resume(inquiryId), 200);

    expect(capCalls).toHaveLength(1);
    expect(capCalls[0]?.inquiry.id).toBe(inquiryId);
    expect(capCalls[0]?.settings).toMatchObject({
      'max-sessions': 25,
      'expire-inquiry-on-session-limit': false,
    });
    expect(capCalls[0]?.hasDeps).toBe(true);
  });

  it.each([
    ['refuse', []],
    ['expire', ['capped']],
  ] as const)(
    'refuses resume at the cap (%s) with 409 session_limit_reached, creating no session; only an expiry commits',
    async (limit, tags) => {
      const inquiryId = await createInquiry(api, {});
      control.limit = limit;

      const response = await resume(inquiryId);

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe('session_limit_reached');
      expect(await sessionRows(inquiryId)).toEqual([]);
      expect(await tagsOf(inquiryId)).toEqual(tags);
    },
  );

  it('by the one-time-link redemption, after the token', async () => {
    const inquiryId = await createInquiry(api, {});
    const token = await oneTimeToken(inquiryId);

    expectStatus(await redeem(inquiryId, token), 200);

    expect(capCalls.map((call) => call.inquiry.id)).toEqual([inquiryId]);
  });

  it('never for an invalid one-time token (P28), which answers the uniform 401', async () => {
    const inquiryId = await createInquiry(api, {});
    control.limit = 'expire';

    const response = await redeem(inquiryId, `ovo_${'A'.repeat(43)}`);

    expect(response.statusCode).toBe(401);
    expect(capCalls).toEqual([]);
  });

  it('refuses the redemption at the cap with 409, creating no session and leaving the link unused', async () => {
    const inquiryId = await createInquiry(api, {});
    const token = await oneTimeToken(inquiryId);
    control.limit = 'refuse';

    const response = await redeem(inquiryId, token);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('session_limit_reached');
    expect(await sessionRows(inquiryId)).toEqual([]);
    expect(await tagsOf(inquiryId)).toEqual([]);
    control.limit = 'no';
    expectStatus(await redeem(inquiryId, token), 200);
  });

  it('keeps an expiry the cap made at redemption, still answering 409', async () => {
    const inquiryId = await createInquiry(api, {});
    const token = await oneTimeToken(inquiryId);
    control.limit = 'expire';

    const response = await redeem(inquiryId, token);

    expect(response.statusCode).toBe(409);
    expect(await sessionRows(inquiryId)).toEqual([]);
    expect(await tagsOf(inquiryId)).toEqual(['capped']);
  });
});
