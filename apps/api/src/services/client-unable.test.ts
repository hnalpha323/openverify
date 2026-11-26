/**
 * C207.9 (Phase 10, Workflow 10C; `api-nfc`): a client says it cannot read a document chip.
 *
 * - `clientUnableLeave`: the current `nfc` step is left at once through `exhausted`, with the
 *   client-reported reason and platform as notes; `fallback-continue` only where the version
 *   carries `client-unable:<step id>` and the step's `onFallback` is `continue`.
 * - `clientUnableStepOutcomes`: a step last left that way reads as decided without passing, so the
 *   inquiry settles (to review, unless the exit carries `fallback-continue`).
 * - `POST /api/v1/flow/verifications/:id/client-unable`: only at the current `nfc` step with an
 *   `exhausted` edge, once per verification (409 `client_unable_not_allowed` otherwise); the
 *   verification ends `canceled`, the inquiry goes to review, and the answer says nothing of it.
 */
import { CLIENT_UNABLE_REASONS, newId } from '@openverify/contracts';
import {
  createVerification,
  getInquiry,
  getVerification,
  listInquiryFlowSteps,
  listInquirySessions,
  recordInquirySessionConsent,
  recordSessionDeviceFields,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectStatus, resumeInquiry } from '../test-support/harness.js';
import {
  clientUnableLeave,
  clientUnableStepOutcomes,
  type ClientUnableExitInput,
} from './client-unable.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const exit: ClientUnableExitInput = {
  stepId: 'chip',
  onFallback: null,
  hasExhaustedEdge: true,
  acknowledgements: [],
  reason: 'reader_not_installed',
  platform: 'android',
};

const acknowledged = (key: string) => ({
  key,
  'acknowledged-by': 'usr_01M5CK3190XEVBM5ZXA76E1JSM',
  'acknowledged-at': '2026-11-10T00:00:00.000Z',
});

describe('clientUnableLeave (C207.9)', () => {
  it('leaves through exhausted with the client-reported reason and platform', () => {
    expect(clientUnableLeave(exit)).toEqual({
      port: 'exhausted',
      outcome: 'client_unable',
      notes: [
        'client-unable',
        'client-unable-reason:reader_not_installed',
        'client-unable-platform:android',
      ],
    });
  });

  it('names each reason and platform as reported', () => {
    for (const reason of CLIENT_UNABLE_REASONS) {
      expect(clientUnableLeave({ ...exit, reason, platform: 'web' })?.notes).toEqual([
        'client-unable',
        `client-unable-reason:${reason}`,
        'client-unable-platform:web',
      ]);
    }
  });

  it('leaves nothing without an exhausted edge', () => {
    expect(clientUnableLeave({ ...exit, hasExhaustedEdge: false })).toBeNull();
  });

  it('carries fallback-continue only with the acknowledgement of this step and onFallback continue', () => {
    const notesOf = (input: Partial<ClientUnableExitInput>) =>
      clientUnableLeave({ ...exit, ...input })?.notes ?? [];

    expect(
      notesOf({
        onFallback: 'continue',
        acknowledgements: [acknowledged('client-unable:chip')],
      }),
    ).toContain('fallback-continue');
    // Phase 9's `fallback:` covers a person who tried and failed, not this claim.
    expect(
      notesOf({ onFallback: 'continue', acknowledgements: [acknowledged('fallback:chip')] }),
    ).not.toContain('fallback-continue');
    expect(
      notesOf({ onFallback: 'continue', acknowledgements: [acknowledged('client-unable:other')] }),
    ).not.toContain('fallback-continue');
    expect(
      notesOf({ onFallback: 'review', acknowledgements: [acknowledged('client-unable:chip')] }),
    ).not.toContain('fallback-continue');
    expect(notesOf({ acknowledgements: [acknowledged('client-unable:chip')] })).not.toContain(
      'fallback-continue',
    );
    expect(
      notesOf({ onFallback: 'continue', acknowledgements: [null, 'client-unable:chip', 7, {}] }),
    ).not.toContain('fallback-continue');
  });
});

describe('clientUnableStepOutcomes (C207.9)', () => {
  const left = (stepId: string, notes: string[], exitPort: string | null = 'exhausted') => ({
    stepId,
    exitPort,
    notes,
  });

  it('reads a step last left by a client-unable report as decided without passing', () => {
    expect(
      clientUnableStepOutcomes([left('chip', ['client-unable']), left('done', [], null)], {
        chip: 'pending',
        selfie: 'passed',
      }),
    ).toEqual({ chip: 'failed', selfie: 'passed' });
    expect(clientUnableStepOutcomes([left('chip', ['client-unable'])], {})).toEqual({
      chip: 'failed',
    });
  });

  it('leaves every other step as it reads', () => {
    const outcomes = { chip: 'pending', id: 'failed' };

    expect(clientUnableStepOutcomes([left('chip', []), left('id', [])], outcomes)).toEqual(
      outcomes,
    );
    expect(clientUnableStepOutcomes([left('chip', ['client-unable'], 'next')], outcomes)).toEqual(
      outcomes,
    );
  });

  it('keeps a decided outcome, and reads only the step’s last entry', () => {
    expect(clientUnableStepOutcomes([left('chip', ['client-unable'])], { chip: 'passed' })).toEqual(
      { chip: 'passed' },
    );
    expect(
      clientUnableStepOutcomes([left('chip', ['client-unable']), left('chip', [], null)], {
        chip: 'pending',
      }),
    ).toEqual({ chip: 'pending' });
  });

  it('never changes the outcomes it was given', () => {
    const outcomes = Object.freeze({ chip: 'pending' });

    expect(clientUnableStepOutcomes([left('chip', ['client-unable'])], outcomes)).not.toBe(
      outcomes,
    );
  });
});

// The route ------------------------------------------------------------------------------------

const done = { id: 'done', type: 'completion' };
const idCard = {
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['camera'],
};
const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

function v2(name: string, entry: string, steps: unknown[], edges: unknown[]): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: name, version: 1, name },
    entry,
    steps,
    edges,
  });
}

const chipStep = (onFallback?: 'review' | 'continue') => ({
  id: 'chip',
  type: 'nfc',
  androidOnly: true,
  ...(onFallback === undefined ? {} : { onFallback }),
});
const FALLBACK_EDGES = [
  edge('e1', 'chip', 'next', 'done'),
  edge('e2', 'chip', 'exhausted', 'done'),
];
const WITH_FALLBACK = v2('unable-fallback', 'chip', [chipStep(), done], FALLBACK_EDGES);
const CONTINUES = v2('unable-continue', 'chip', [chipStep('continue'), done], FALLBACK_EDGES);
const WITHOUT_FALLBACK = v2(
  'unable-none',
  'chip',
  [chipStep(), done],
  [edge('e1', 'chip', 'next', 'done')],
);
/** The fallback leads to the ID step, so the inquiry stays open after the report. */
const FALLBACK_TO_ID = v2(
  'unable-to-id',
  'chip',
  [chipStep(), idCard, done],
  [
    edge('e1', 'chip', 'next', 'done'),
    edge('e2', 'chip', 'exhausted', 'id_card'),
    edge('e3', 'id_card', 'next', 'done'),
  ],
);
/** The ID step comes first, so the chip step is not the current one. */
const CHIP_LATER = v2(
  'unable-later',
  'id_card',
  [idCard, chipStep(), done],
  [edge('e0', 'id_card', 'next', 'chip'), ...FALLBACK_EDGES],
);

interface Opened {
  inquiryId: string;
  sessionId: string;
  sessionToken: string;
  verificationId: string;
}

/** A positioned, consented session on `flow` with an `initiated` NFC verification. */
async function opened(
  flow: FlowV2,
  options: { sdk?: boolean; acknowledgements?: unknown[] } = {},
): Promise<Opened> {
  const { db } = api.database;
  const { inquiry, template } = await createTestInquiry(db, api.environmentId, { flow });
  if (options.acknowledgements !== undefined) {
    await db.execute(
      sql`update inquiry_template_versions
             set acknowledgements = ${JSON.stringify(options.acknowledgements)}::jsonb
           where id = ${template.latestVersion.id}`,
    );
  }
  const sessionToken = await resumeInquiry(api, inquiry.id);
  const [session] = (await listInquirySessions(db, api.environmentId, { inquiryId: inquiry.id }))
    .items;
  if (session === undefined) {
    throw new Error('the inquiry has no session');
  }
  if (options.sdk === true) {
    await recordSessionDeviceFields(db, api.environmentId, session.id, {
      osName: 'Android',
      osFullVersion: '14',
      browserName: null,
      browserFullVersion: null,
      deviceType: 'smartphone',
      deviceName: null,
      mobileSdkName: 'openverify-android',
      mobileSdkFullVersion: '0.1.0',
    });
  }
  // The session read positions the inquiry (C151.14), before any fact exists, so the record
  // carries no backfill note.
  expectStatus(
    await api.app.inject({
      url: '/api/v1/flow/session',
      headers: { ...bearer(sessionToken), 'openverify-flow-spec': '2' },
    }),
    200,
  );
  await recordInquirySessionConsent(db, api.environmentId, session.id, {
    acceptedAt: new Date(),
    textKeys: ['consent.biometric', 'consent.processing'],
    optionalTextKeys: [],
    locale: 'en',
    ip: null,
    userAgent: null,
  });
  const verification = await createVerification(db, api.environmentId, {
    id: newId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id_nfc',
  });
  return {
    inquiryId: inquiry.id,
    sessionId: session.id,
    sessionToken,
    verificationId: verification.id,
  };
}

const report = (target: Opened, reason = 'nfc_unavailable') =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${target.verificationId}/client-unable`,
    headers: bearer(target.sessionToken),
    payload: { reason },
  });

const recordOf = async (inquiryId: string) =>
  (await listInquiryFlowSteps(api.database.db, api.environmentId, inquiryId)).map((entry) => ({
    stepId: entry.stepId,
    exitPort: entry.exitPort,
    outcome: entry.outcome,
    notes: entry.notes,
  }));

const statusOf = async (inquiryId: string) =>
  (await getInquiry(api.database.db, api.environmentId, inquiryId))?.status;

const verificationStatus = async (id: string) =>
  (await getVerification(api.database.db, api.environmentId, id))?.status;

describe('POST /api/v1/flow/verifications/:id/client-unable (C207.9)', () => {
  it('ends the verification canceled, leaves the nfc step through exhausted and sends the inquiry to review', async () => {
    const target = await opened(WITH_FALLBACK);

    const response = await report(target, 'platform_unsupported');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      'verification-id': target.verificationId,
      status: 'canceled',
    });
    expect(await verificationStatus(target.verificationId)).toBe('canceled');
    expect(await recordOf(target.inquiryId)).toEqual([
      {
        stepId: 'chip',
        exitPort: 'exhausted',
        outcome: 'client_unable',
        notes: [
          'client-unable',
          'client-unable-reason:platform_unsupported',
          'client-unable-platform:web',
        ],
      },
      { stepId: 'done', exitPort: null, outcome: null, notes: [] },
    ]);
    expect(await statusOf(target.inquiryId)).toBe('needs_review');
  });

  it('names an SDK session’s platform, and announces the canceled verification', async () => {
    const target = await opened(WITH_FALLBACK, { sdk: true });
    const before = api.events.events.length;

    expectStatus(await report(target, 'reader_not_installed'), 200);

    expect((await recordOf(target.inquiryId))[0]?.notes).toEqual([
      'client-unable',
      'client-unable-reason:reader_not_installed',
      'client-unable-platform:android',
    ]);
    expect(api.events.events.slice(before).map((event) => event.name)).toContain(
      'verification.canceled',
    );
  });

  it('goes to review whatever onFallback says, without the acknowledgement', async () => {
    const target = await opened(CONTINUES, {
      acknowledgements: [acknowledged('fallback:chip')],
    });

    expectStatus(await report(target), 200);

    expect(await statusOf(target.inquiryId)).toBe('needs_review');
  });

  it('completes without review only where the version carries client-unable:<step id>', async () => {
    const target = await opened(CONTINUES, {
      acknowledgements: [acknowledged('fallback:chip'), acknowledged('client-unable:chip')],
    });

    expectStatus(await report(target), 200);

    expect((await recordOf(target.inquiryId))[0]?.notes).toContain('fallback-continue');
    expect(await statusOf(target.inquiryId)).toBe('completed');
  });

  it('never tells the person where the fallback leads', async () => {
    const target = await opened(WITH_FALLBACK);

    const response = await report(target);

    expect(Object.keys(response.json<Record<string, unknown>>()).sort()).toEqual([
      'status',
      'verification-id',
    ]);
    expect(response.body).not.toMatch(/review/i);
  });

  it('refuses a second report of the same verification (409), and one for a new attempt once the step was left', async () => {
    const target = await opened(FALLBACK_TO_ID);
    expectStatus(await report(target), 200);
    const before = await recordOf(target.inquiryId);
    expect(before.map((entry) => entry.stepId)).toEqual(['chip', 'id_card']);
    expect(await statusOf(target.inquiryId)).toBe('pending');

    const second = await report(target);

    expect(second.statusCode).toBe(409);
    const again = await createVerification(api.database.db, api.environmentId, {
      id: newId('ver'),
      inquiryId: target.inquiryId,
      type: 'government_id_nfc',
    });
    const other = await report({ ...target, verificationId: again.id });
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ code: 'client_unable_not_allowed' });
    expect(await recordOf(target.inquiryId)).toEqual(before);
  });

  it('refuses an nfc step without an exhausted edge and moves nothing (409 client_unable_not_allowed)', async () => {
    const target = await opened(WITHOUT_FALLBACK);

    const response = await report(target);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'client_unable_not_allowed',
      detail: 'The verification cannot be reported as unreadable by this client now.',
    });
    expect(await verificationStatus(target.verificationId)).toBe('initiated');
    expect(await recordOf(target.inquiryId)).toEqual([
      { stepId: 'chip', exitPort: null, outcome: null, notes: [] },
    ]);
    expect(await statusOf(target.inquiryId)).toBe('pending');
  });

  it('refuses while another step is the current one (409 client_unable_not_allowed)', async () => {
    const target = await opened(CHIP_LATER);

    const response = await report(target);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'client_unable_not_allowed' });
    expect(await verificationStatus(target.verificationId)).toBe('initiated');
    expect((await recordOf(target.inquiryId)).map((entry) => entry.exitPort)).toEqual([null]);
  });

  it('keeps C52.1’s preconditions: another type 422, no session 401', async () => {
    const target = await opened(WITH_FALLBACK);
    const selfie = await createVerification(api.database.db, api.environmentId, {
      id: newId('ver'),
      inquiryId: target.inquiryId,
      type: 'selfie',
    });

    expect((await report({ ...target, verificationId: selfie.id })).statusCode).toBe(422);
    expect(
      (
        await api.app.inject({
          method: 'POST',
          url: `/api/v1/flow/verifications/${target.verificationId}/client-unable`,
          payload: { reason: 'nfc_unavailable' },
        })
      ).statusCode,
    ).toBe(401);
  });
});
