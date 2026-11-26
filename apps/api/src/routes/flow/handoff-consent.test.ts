/**
 * Workflow 7A Stage 1b (H) (C94.6, C96.3, V02, V03; P01): the shared consent and creator plumbing
 * of device handoff on the flow API.
 *
 * - Every consent gate reads `getEffectiveConsent`, never the inquiry-level read: `GET
 *   /flow/session`, the upload, the selfie capture, the C52.1 preconditions, the selfie job's
 *   matching gate (by the capture's creating session) and the OTP message's language. A phone
 *   session a handoff created never acts on the desktop's consent: the desktop ticks biometric
 *   matching, the phone declines it, and the phone's capture holds no matching consent.
 * - The flow writes the session that created a verification and a selfie capture
 *   (`created_by_session_id`), which a rejection reads (V02).
 *
 * The phone session is written as `flow-handoff`'s redemption will write it: a second session of
 * the inquiry with the handoff fields set. Every value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { getSelfieCapture, getVerification, hashSessionToken } from '@openverify/db';
import { storedFlowView } from '../../services/stored-flow.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowSession } from '../../auth/flow-session.js';
import { matchingConsentHolds } from '../../jobs/selfie.js';
import { requireFlowVerification } from '../../services/flow-preconditions.js';
import { messageLocaleOf } from '../../services/otp/context.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  expectStatus,
  IMAGES,
  multipart,
  resumeInquiry,
} from '../../test-support/harness.js';
import {
  CONSENT_BODY,
  createCapture,
  FLOW,
  selfieFlow,
  type SelfieFlow,
} from './selfie.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const MATCHING = 'consent.biometric-matching';

async function sessionIdOf(sessionToken: string): Promise<string> {
  const { rows } = await api.database.client.query<{ id: string }>(
    'select id from inquiry_sessions where token_hash = $1',
    [hashSessionToken(sessionToken)],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('no session for the token');
  }
  return id;
}

/** The desktop's selfie flow (consented with matching), and a phone session redeemed from it. */
async function handedOff(): Promise<{
  desktop: SelfieFlow & { sessionId: string };
  phone: { sessionToken: string; sessionId: string };
}> {
  const flow = await selfieFlow(api, { consent: false });
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `${FLOW}/consent`,
      headers: bearer(flow.sessionToken),
      payload: { ...CONSENT_BODY, 'optional-text-keys': [MATCHING] },
    }),
    201,
  );
  const desktopId = await sessionIdOf(flow.sessionToken);
  const phoneToken = await resumeInquiry(api, flow.inquiryId);
  const phoneId = await sessionIdOf(phoneToken);
  await api.database.db.execute(
    sql`update inquiry_sessions set device_handoff_method = 'qr',
          handoff_from_session_id = ${desktopId}, handoff_redeemed_at = now()
        where id = ${phoneId}`,
  );
  return {
    desktop: { ...flow, sessionId: desktopId },
    phone: { sessionToken: phoneToken, sessionId: phoneId },
  };
}

const flowSessionOf = (inquiryId: string, sessionId: string): FlowSession => ({
  id: sessionId,
  environmentId: api.environmentId,
  inquiryId,
});

async function phoneConsents(sessionToken: string, optional: string[] = [], locale = 'en') {
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `${FLOW}/consent`,
      headers: bearer(sessionToken),
      payload: { ...CONSENT_BODY, locale, 'optional-text-keys': optional },
    }),
    201,
  );
}

describe('created_by_session_id (V02)', () => {
  it('records the session that created a verification and a selfie capture', async () => {
    const flow = await selfieFlow(api);
    const sessionId = await sessionIdOf(flow.sessionToken);
    const capture = await createCapture(api, flow);

    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))
        ?.createdBySessionId,
    ).toBe(sessionId);
    expect(
      (await getSelfieCapture(api.database.db, api.environmentId, capture.id))?.createdBySessionId,
    ).toBe(sessionId);
  });
});

describe('every consent gate reads getEffectiveConsent (C94.6, V03)', () => {
  it('serves the phone no consent on GET /flow/session until it consents itself', async () => {
    const { phone } = await handedOff();
    const read = async () =>
      expectStatus(
        await api.app.inject({
          method: 'GET',
          url: `${FLOW}/session`,
          headers: bearer(phone.sessionToken),
        }),
        200,
      ) as unknown as { consent: unknown };

    expect((await read()).consent).toBeNull();
    await phoneConsents(phone.sessionToken);
    expect((await read()).consent).not.toBeNull();
  });

  it("refuses the phone an upload and a selfie capture on the desktop's consent", async () => {
    const { desktop, phone } = await handedOff();
    const form = await multipart({ kind: 'selfie-center', file: { bytes: IMAGES.jpeg } });

    const upload = await api.app.inject({
      method: 'POST',
      url: `${FLOW}/verifications/${desktop.verificationId}/files`,
      headers: { ...bearer(phone.sessionToken), ...form.headers },
      payload: form.payload,
    });
    expect(upload.statusCode).toBe(409);
    expect(upload.json<{ detail: string }>().detail).toMatch(/consent/i);
    const capture = await api.app.inject({
      method: 'POST',
      url: `${FLOW}/verifications/${desktop.verificationId}/selfies`,
      headers: bearer(phone.sessionToken),
      payload: { method: 'camera' },
    });
    expect(capture.statusCode).toBe(409);
    expect(capture.json<{ detail: string }>().detail).toMatch(/consent/i);
  });

  it("refuses the phone the C52.1 preconditions on the desktop's consent", async () => {
    const { desktop, phone } = await handedOff();
    const session = flowSessionOf(desktop.inquiryId, phone.sessionId);

    await expect(
      requireFlowVerification(api.deps, session, desktop.verificationId),
    ).rejects.toThrow(/Consent is required/);
    await phoneConsents(phone.sessionToken);
    await expect(
      requireFlowVerification(api.deps, session, desktop.verificationId),
    ).resolves.toMatchObject({ verification: { id: desktop.verificationId } });
  });

  it('holds matching consent by the capture session: the desktop ticked it, the phone declined it', async () => {
    const { desktop, phone } = await handedOff();
    await phoneConsents(phone.sessionToken);
    const { rows } = await api.database.client.query<{ flow: Record<string, unknown> }>(
      `select v.flow from inquiries i
         join inquiry_template_versions v on v.id = i.inquiry_template_version_id
        where i.id = $1`,
      [desktop.inquiryId],
    );
    const flow = storedFlowView(rows[0]?.flow ?? {});
    const holder = (sessionId: string | null) => ({
      environmentId: api.environmentId,
      inquiryId: desktop.inquiryId,
      sessionId,
    });

    expect(await matchingConsentHolds(api.database.db, holder(desktop.sessionId), flow)).toBe(true);
    expect(await matchingConsentHolds(api.database.db, holder(phone.sessionId), flow)).toBe(false);
  });

  it("writes the OTP message in the asking session's language", async () => {
    const { desktop, phone } = await handedOff();
    await phoneConsents(phone.sessionToken, [], 'es');
    await api.database.db.execute(
      sql`update inquiry_sessions
            set consent = jsonb_set(consent, '{accepted_at}', to_jsonb('2000-01-01T00:00:00.000Z'::text))
          where id = ${phone.sessionId}`,
    );
    const holder = (sessionId: string) => ({
      environmentId: api.environmentId,
      inquiryId: desktop.inquiryId,
      sessionId,
    });

    expect(await messageLocaleOf(api.deps, holder(phone.sessionId))).toBe('es');
    expect(await messageLocaleOf(api.deps, holder(desktop.sessionId))).toBe('en');
  });
});
