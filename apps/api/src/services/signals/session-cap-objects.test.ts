/**
 * K7A-1 (C91.5, C40.2): a session-cap expiry cancels an open selfie capture, and that capture's
 * files must leave storage after the commit, on each of the three paths the cap guards. Their rows
 * are deleted in the transaction, so nothing can find the objects afterwards. Every image is
 * synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  parseHandoffFragment,
  type CreateInquiryTemplateAttributes,
} from '@openverify/contracts';
import { getSelfieCapture, listVerificationFiles, updateEnvironmentSettings } from '@openverify/db';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCapture,
  selfieAfterConsent,
  selfieFlow,
  uploadPose,
  type SelfieFlow,
} from '../../routes/flow/selfie.test-support.js';
import { bearer, createTemplate, expectStatus } from '../../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';

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

const AT_CAP = { 'max-sessions': 1, 'expire-inquiry-on-session-limit': true };

function cappedAttributes(handoff: boolean): CreateInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  if (handoff) {
    attributes.flow.steps = [
      ...attributes.flow.steps,
      { id: 'device_handoff', type: 'device_handoff' } as never,
    ];
  }
  // C151.4 (Workflow 9A): only the current step takes a verification, so the selfie comes first.
  selfieAfterConsent(attributes);
  return { ...attributes, settings: { ...attributes.settings, ...AT_CAP } };
}

/** A selfie flow at its session cap, whose open capture has its centre pose stored. */
async function atCapWithStoredPose(handoff = false) {
  const templateId = await createTemplate(api, api.token, cappedAttributes(handoff));
  const flow = await selfieFlow(api, { templateId });
  const capture = await createCapture(api, flow);
  expectStatus(await uploadPose(api, flow, capture, 'center'), 201);
  const [file] = await listVerificationFiles(api.database.db, api.environmentId, [
    flow.verificationId,
  ]);
  const storageKey = file?.storageKey ?? '';
  expect(api.storage.keys()).toContain(storageKey);
  return { flow, capture, storageKey };
}

async function expectCanceledAndGone(
  flow: SelfieFlow,
  capture: { id: string },
  storageKey: string,
  refused: LightMyRequestResponse,
) {
  expect(refused.statusCode).toBe(409);
  expect(refused.json<{ code: string }>().code).toBe('session_limit_reached');
  expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
    status: 'errored',
    errorCode: 'canceled',
  });
  expect(api.storage.keys()).not.toContain(storageKey);
}

describe('a session-cap expiry deletes the canceled capture’s objects (K7A-1)', () => {
  it('on a resume', async () => {
    const { flow, capture, storageKey } = await atCapWithStoredPose();

    const refused = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${flow.inquiryId}/resume`,
      headers: bearer(api.token),
    });

    await expectCanceledAndGone(flow, capture, storageKey, refused);
  });

  it('on a one-time-link redemption', async () => {
    const { flow, capture, storageKey } = await atCapWithStoredPose();
    const document = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${flow.inquiryId}/generate-one-time-link`,
        headers: bearer(api.token),
        payload: {},
      }),
      200,
    );
    const link = new URL(String(document.meta?.['one-time-link']));

    const refused = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/one-time-links/redeem',
      payload: {
        'inquiry-id': flow.inquiryId,
        'one-time-token': new URLSearchParams(link.hash.slice(1)).get('one-time-token'),
      },
    });

    await expectCanceledAndGone(flow, capture, storageKey, refused);
  });

  it('on a handoff redemption', async () => {
    const { flow, capture, storageKey } = await atCapWithStoredPose(true);
    // C151.4 (Workflow 9A): a handoff is issued only at the handoff step, which a desktop with an
    // open capture no longer reaches through the flow; the position is put there directly, so the
    // cap's cleanup on a redemption (still in the code) stays checked.
    await api.database.db.execute(
      sql`update inquiries set flow_step_id = 'device_handoff' where id = ${flow.inquiryId}`,
    );
    const issued = expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/handoffs',
        headers: bearer(flow.sessionToken),
        payload: { method: 'qr' },
      }),
      201,
    ) as unknown as { 'url-fragment': string };
    const parsed = parseHandoffFragment(issued['url-fragment']);

    const refused = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/handoffs/redeem',
      payload: { 'inquiry-id': flow.inquiryId, 'handoff-token': parsed?.handoffToken },
    });

    await expectCanceledAndGone(flow, capture, storageKey, refused);
  });
});
