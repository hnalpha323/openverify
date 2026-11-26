/**
 * C94.6, C96.5 (Phase 7) on a flow-spec 2 version (Workflow 9B, api-flow-carry; 9A Stage 3
 * amendment 23, B48): a phone a handoff redeemed after the flow passed its consent step holds no
 * consent of its own. Its session is served that consent step's client view as `step` (its id differs
 * from `position.step-id`), the position unchanged; the phone records its own consent, which moves
 * nothing, and the session then serves the current step. A desktop that consented sees the current
 * step throughout. Driven through the flow routes; every value is synthetic.
 */
import { FLOW_SPEC_HEADER, parseHandoffFragment } from '@openverify/contracts';
import { getInquiry, updateEnvironmentSettings } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, expectStatus, resumeInquiry } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
  // C96.2 (Phase 7): the phone names the organisation, so a handoff needs its display name.
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
const CONSENT_BODY = { accepted: true, 'text-keys': ['consent.processing'], locale: 'en' };

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** consent -> device_handoff -> about (a screen) -> done. */
const HANDED_OFF = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'handoff-v2', version: 1, name: 'Handoff' },
  entry: 'consent',
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.processing'], required: true },
    { id: 'device_handoff', type: 'device_handoff' },
    {
      id: 'about',
      type: 'screen',
      components: [
        { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
      ],
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    edge('e1', 'consent', 'next', 'device_handoff'),
    edge('e2', 'device_handoff', 'next', 'about'),
    edge('e3', 'about', 'next', 'done'),
  ],
});

interface Session {
  position?: { 'step-id': string | null; state: string };
  step?: { id: string; type: string };
  values?: Record<string, unknown>;
  consent: unknown;
}

function request(
  method: 'GET' | 'POST',
  url: string,
  token: string | undefined,
  agent: string,
  payload?: unknown,
) {
  return api.app.inject({
    method,
    url: `${FLOW}${url}`,
    headers: {
      'user-agent': agent,
      [FLOW_SPEC_HEADER.toLowerCase()]: '1, 2',
      ...(token === undefined ? {} : bearer(token)),
    },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const session = async (token: string, agent: string): Promise<Session> =>
  expectStatus(await request('GET', '/session', token, agent), 200) as unknown as Session;

/** A desktop that consented and handed off to a phone, which redeemed the handoff. */
async function handedOff(): Promise<{ inquiryId: string; desktop: string; phone: string }> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
    flow: HANDED_OFF,
    fields: { nickname: 'Ada' },
  });
  const desktop = await resumeInquiry(api, inquiry.id);
  expect((await session(desktop, DESKTOP_AGENT)).step).toMatchObject({ id: 'consent' });
  expectStatus(await request('POST', '/consent', desktop, DESKTOP_AGENT, CONSENT_BODY), 201);
  expect((await session(desktop, DESKTOP_AGENT)).position).toMatchObject({
    'step-id': 'device_handoff',
  });
  const issued = expectStatus(
    await request('POST', '/handoffs', desktop, DESKTOP_AGENT, { method: 'qr' }),
    201,
  ) as unknown as { 'url-fragment': string };
  const parsed = parseHandoffFragment(issued['url-fragment']);
  if (parsed === null) throw new Error('the answer carries no handoff fragment');
  const redeemed = expectStatus(
    await request('POST', '/handoffs/redeem', undefined, PHONE_AGENT, {
      'inquiry-id': inquiry.id,
      'handoff-token': parsed.handoffToken,
    }),
    200,
  ) as unknown as { 'session-token': string };
  return { inquiryId: inquiry.id, desktop, phone: redeemed['session-token'] };
}

describe('the handed-off phone’s own consent on a flow-spec 2 version (C94.6; amendment 23)', () => {
  it('serves the phone the passed consent step first, and records its consent without moving', async () => {
    const { inquiryId, desktop, phone } = await handedOff();

    const before = await session(phone, PHONE_AGENT);
    expect(before.consent).toBeNull();
    expect(before.position).toMatchObject({ 'step-id': 'about', state: 'active' });
    expect(before.step).toMatchObject({ id: 'consent', type: 'consent' });
    expect(before).not.toHaveProperty('values');
    expect((await session(desktop, DESKTOP_AGENT)).step).toMatchObject({ id: 'about' });

    expectStatus(await request('POST', '/consent', phone, PHONE_AGENT, CONSENT_BODY), 201);

    const moved = await getInquiry(api.database.db, api.environmentId, inquiryId);
    expect(moved).toMatchObject({ flowStepId: 'about', flowState: 'active' });
    const after = await session(phone, PHONE_AGENT);
    expect(after.consent).not.toBeNull();
    expect(after.position).toMatchObject({ 'step-id': 'about', state: 'active' });
    expect(after.step).toMatchObject({ id: 'about', type: 'screen' });
    expect(after.values).toEqual({ nickname: 'Ada' });
  });
});
