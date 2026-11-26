/**
 * C91.1, C96.4, C96.7 (Workflow 7A Stage 1b (H)): every inquiry session read carries the handoff
 * fields: `device-handoff-method`, `handoff-from-session-id`, `handoff-redeemed-at` and the
 * distance facts. They are `null` on a session no handoff created, and the redeemed session's own
 * values otherwise (written here as `flow-handoff`'s redemption and `api-network`'s distance will
 * write them). None of them is PII. Synthetic values only.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, createInquiry, expectStatus, resumeInquiry } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/inquiry-sessions';
const REDEEMED_AT = new Date('2026-10-20T12:05:00.000Z');
const REJECTED_AT = new Date('2026-10-20T12:07:00.000Z');

async function sessionsOf(inquiryId: string): Promise<string[]> {
  const { rows } = await api.database.client.query<{ id: string }>(
    'select id from inquiry_sessions where inquiry_id = $1 order by created_at, id',
    [inquiryId],
  );
  return rows.map((row) => row.id);
}

const attributesOf = async (id: string, token = api.token) =>
  expectStatus(await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(token) }), 200).data
    .attributes;

const NO_HANDOFF = {
  'device-handoff-method': null,
  'handoff-from-session-id': null,
  'handoff-redeemed-at': null,
  'handoff-rejected-at': null,
  'handoff-distance-meters': null,
  'handoff-country-changed': null,
  'handoff-asn-changed': null,
};

describe('the session handoff fields (C91.1, C96.4, C96.7)', () => {
  it('are null on a session no handoff created', async () => {
    const inquiryId = await createInquiry(api, {});
    await resumeInquiry(api, inquiryId);
    const [sessionId = ''] = await sessionsOf(inquiryId);

    expect(await attributesOf(sessionId)).toMatchObject(NO_HANDOFF);
  });

  it('serve the redeemed session its method, issuing session, time and distance facts, unmasked', async () => {
    const inquiryId = await createInquiry(api, {});
    await resumeInquiry(api, inquiryId);
    await resumeInquiry(api, inquiryId);
    const [desktop = '', phone = ''] = await sessionsOf(inquiryId);
    await api.database.db.execute(
      sql`update inquiry_sessions set device_handoff_method = 'email',
            handoff_from_session_id = ${desktop}, handoff_redeemed_at = ${REDEEMED_AT},
            handoff_rejected_at = ${REJECTED_AT}, handoff_distance_meters = 1200, handoff_country_changed = false,
            handoff_asn_changed = true
          where id = ${phone}`,
    );
    const handedOff = {
      'device-handoff-method': 'email',
      'handoff-from-session-id': desktop,
      'handoff-redeemed-at': REDEEMED_AT.toISOString(),
      'handoff-rejected-at': REJECTED_AT.toISOString(),
      'handoff-distance-meters': 1200,
      'handoff-country-changed': false,
      'handoff-asn-changed': true,
    };
    const masked = api.newUserToken(api.environmentId, { permissions: ['inquiry-sessions:read'] });

    expect(await attributesOf(phone)).toMatchObject(handedOff);
    expect(await attributesOf(phone, masked)).toMatchObject(handedOff);
    expect(await attributesOf(desktop)).toMatchObject(NO_HANDOFF);
    const listed = expectStatus(
      await api.app.inject({
        url: `${BASE}?filter[inquiry-id]=${inquiryId}`,
        headers: bearer(api.token),
      }),
      200,
    ) as unknown as { data: { id: string; attributes: Record<string, unknown> }[] };
    expect(listed.data.find((session) => session.id === phone)?.attributes).toMatchObject(
      handedOff,
    );
  });
});
