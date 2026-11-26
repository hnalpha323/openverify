/**
 * Owner decision 5 after Workflow 6C: redaction ends an open inquiry's processing, not its expiry.
 * The sandbox's `start_inquiry`, `complete_inquiry` and `fail_inquiry` on a redacted inquiry answer
 * 409 `invalid-transition`, the answer the simulate route documents (it documents no 410), and
 * change nothing; `expire_inquiry` still expires it. The flow's start (`startInquiry`) moves a
 * redacted `created` inquiry nowhere either and publishes nothing. Synthetic values only.
 */
import type { InquiryStatus } from '@openverify/core';
import { getInquiry, redactInquiryRecords, transitionInquiryStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiry, expectStatus } from '../test-support/harness.js';
import { createRecordingEventPublisher } from '../test-support/fakes.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { startInquiry } from './inquiries.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const INVALID_TRANSITION = 'https://openverify.dev/problems/invalid-transition';

/** A new inquiry moved to `status` (`created` or `pending`) in the database, then redacted. */
async function redactedIn(status: 'created' | 'pending'): Promise<string> {
  const id = await createInquiry(api, { fields: { name_first: 'Avery' } });
  if (status === 'pending') {
    await transitionInquiryStatus(api.database.db, api.environmentId, id, {
      from: 'created',
      to: 'pending',
    });
  }
  await redactInquiryRecords(api.database.db, api.environmentId, id);
  return id;
}

const simulate = (id: string, types: readonly string[]) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${id}/perform-simulate-actions`,
    headers: { authorization: `Bearer ${api.token}` },
    payload: { meta: { actions: types.map((type) => ({ type })) } },
  });

const eventsAbout = (id: string) =>
  api.events.events.filter((event) => event.payload.data.id === id).map((event) => event.name);

const auditsAbout = (id: string) =>
  api.audit.entries.filter((entry) => entry.resourceId === id).map((entry) => entry.action);

describe('the sandbox simulate actions on a redacted open inquiry (owner decision 5 after Workflow 6C)', () => {
  it.each([
    ['created', 'start_inquiry'],
    ['pending', 'complete_inquiry'],
    ['pending', 'fail_inquiry'],
  ] as const)(
    'a redacted %s inquiry: %s answers 409 invalid-transition and changes nothing',
    async (status, type) => {
      const id = await redactedIn(status);
      const before = { events: eventsAbout(id), audits: auditsAbout(id) };

      const response = await simulate(id, [type]);

      expect(response.statusCode, response.body).toBe(409);
      expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
      expect(await getInquiry(api.database.db, api.environmentId, id)).toMatchObject({
        status,
        redactedAt: expect.any(Date) as unknown,
      });
      expect(eventsAbout(id)).toEqual(before.events);
      expect(auditsAbout(id)).toEqual(before.audits);
    },
  );

  it.each(['created', 'pending'] as const)(
    'a redacted %s inquiry still expires by expire_inquiry',
    async (status) => {
      const id = await redactedIn(status);

      const document = expectStatus(await simulate(id, ['expire_inquiry']), 200);

      expect(document.data.attributes.status).toBe('expired' satisfies InquiryStatus);
      expect(eventsAbout(id)).toEqual(
        expect.arrayContaining(['inquiry.expired', 'inquiry.transitioned']),
      );
    },
  );
});

describe('startInquiry on a redacted created inquiry (owner decision 5 after Workflow 6C)', () => {
  it('returns it as it is and publishes nothing', async () => {
    const id = await redactedIn('created');
    const inquiry = await getInquiry(api.database.db, api.environmentId, id);
    if (inquiry === null) {
      throw new Error('the inquiry is gone');
    }
    const events = createRecordingEventPublisher();

    const started = await startInquiry({ ...api.deps, events }, inquiry);

    expect(started).toMatchObject({ id, status: 'created', startedAt: null });
    expect((await getInquiry(api.database.db, api.environmentId, id))?.status).toBe('created');
    expect(events.events).toEqual([]);
  });
});
