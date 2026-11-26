/**
 * C40.4 and C40.7 `POST /api/v1/flow/verifications/:id/submit` for a selfie (Workflow 4A
 * Stage 3, api-flow): completeness, the capture consumed once in the transaction that moves the
 * verification (C40.6 lock order), the idempotent repeat, one 409 for every refused capture
 * (`timingSafeEqual`), the bounded and sanitised device snapshot sealed with the capture, the
 * 409 `selfie_capture_required`, and `selfie.submitted` then `verification.submitted`.
 */
import {
  DEVICE_LABEL_MAX_LENGTH,
  eventPayloadSchema,
  flowVerificationDocumentSchema,
  SELFIE_CAPTURE_TTL_SECONDS,
  selfieCaptureResourceSchema,
  type SelfieDeviceSnapshot,
} from '@openverify/contracts';
import {
  getSelfieCapture,
  getVerification,
  openSelfieCaptureDevice,
  setVerificationStatus,
} from '@openverify/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  expectStatus,
  IMAGES,
  PROBLEM_JSON,
  seedVerification,
} from '../../test-support/harness.js';
import {
  createCapture,
  problemCode,
  selfieFlow,
  submitCapture,
  uploadAllPoses,
  uploadFields,
  uploadPose,
  type HeldCapture,
  type SelfieFlow,
} from './selfie.test-support.js';

let api: InquiryTestApi;
let start: Date;

beforeAll(async () => {
  api = await createInquiryTestApi();
  start = api.clock.now();
});

afterEach(() => {
  api.clock.set(start);
});

afterAll(async () => {
  await api.close();
});

const DEVICE: SelfieDeviceSnapshot = {
  label: 'Synthetic Front Camera (1234:5678)',
  settings: { width: 1280, height: 720, 'frame-rate': 30, 'facing-mode': 'user' },
  capabilities: { 'width-max': 1920, 'height-max': 1080, 'facing-modes': ['user'] },
  'frame-stats': { delivered: 412, discarded: 3, total: 415 },
  webdriver: false,
  'image-mirrored': false,
};

/** A selfie flow with a capture whose prompted poses are all uploaded. */
async function readyCapture(): Promise<{ flow: SelfieFlow; capture: HeldCapture }> {
  const flow = await selfieFlow(api);
  const capture = await createCapture(api, flow);
  await uploadAllPoses(api, flow, capture);
  return { flow, capture };
}

function jobsOf(flow: SelfieFlow) {
  return api.queue.jobs.filter((job) => job.verificationId === flow.verificationId);
}

/** The event names about the verification or the capture, in dispatch order. */
function eventNames(flow: SelfieFlow, capture: Pick<HeldCapture, 'id'>) {
  return api.events.events
    .filter((event) => {
      const id = (event.payload.data as { id: string }).id;
      return id === flow.verificationId || id === capture.id;
    })
    .map((event) => event.name);
}

describe('submitting a selfie capture (C40.4)', () => {
  it('consumes the capture, moves the verification to submitted and enqueues it', async () => {
    const { flow, capture } = await readyCapture();
    api.clock.advance(9_000);

    const response = await submitCapture(api, flow, capture, DEVICE);

    const document = flowVerificationDocumentSchema.parse(expectStatus(response, 202));
    expect(document.data.attributes.status).toBe('submitted');
    expect(jobsOf(flow)).toEqual([
      { environmentId: api.environmentId, verificationId: flow.verificationId },
    ]);
    const at = new Date(start.getTime() + 9_000);
    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      status: 'submitted',
      submittedAt: at,
      hasDevice: true,
    });
    expect(
      await getVerification(api.database.db, api.environmentId, flow.verificationId),
    ).toMatchObject({ status: 'submitted', submittedAt: at });
  });

  it('publishes selfie.submitted then verification.submitted, after selfie.created', async () => {
    const { flow, capture } = await readyCapture();

    expectStatus(await submitCapture(api, flow, capture), 202);

    expect(eventNames(flow, capture)).toEqual([
      'verification.created',
      'selfie.created',
      'selfie.submitted',
      'verification.submitted',
    ]);
    const submitted = api.events
      .named('selfie.submitted')
      .find((event) => (event.payload.data as { id: string }).id === capture.id);
    const resource = selfieCaptureResourceSchema.parse(
      eventPayloadSchema.parse(submitted?.payload).data,
    );
    expect(resource.attributes).toMatchObject({
      status: 'submitted',
      'submitted-at': start.toISOString(),
      'error-code': null,
    });
    expect(resource.attributes['prompt-timings'].map((timing) => timing.pose)).toEqual(
      capture.prompts,
    );
  });

  it('seals the device snapshot with its label cleaned and cut, and never shows it', async () => {
    const { flow, capture } = await readyCapture();
    const label = `Synthetic\u202e Cam\u0007era ${'x'.repeat(300)}`;

    const response = await submitCapture(api, flow, capture, { ...DEVICE, label });

    expectStatus(response, 202);
    const device = (await openSelfieCaptureDevice(
      api.database.db,
      api.environmentId,
      capture.id,
    )) as SelfieDeviceSnapshot;
    expect(device).toEqual({
      ...DEVICE,
      label: `Synthetic Camera ${'x'.repeat(300)}`.slice(0, DEVICE_LABEL_MAX_LENGTH),
    });
    const { rows } = await api.database.client.query<{ device: string }>(
      'select device from selfie_captures where id = $1',
      [capture.id],
    );
    expect(rows[0]?.device).not.toContain('Synthetic');
    expect(response.body).not.toContain('Synthetic');
    expect(JSON.stringify(api.events.events)).not.toContain('Synthetic');
    expect(JSON.stringify(api.events.events)).not.toContain(capture.nonce);
  });

  it('accepts a submit without a device snapshot', async () => {
    const { flow, capture } = await readyCapture();

    expectStatus(await submitCapture(api, flow, capture), 202);

    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      status: 'submitted',
      hasDevice: false,
    });
  });

  it('answers 409 selfie_capture_incomplete while a prompted pose has no file, and changes nothing', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    expectStatus(await uploadPose(api, flow, capture, 'center'), 201);

    const response = await submitCapture(api, flow, capture);

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(problemCode(response)).toBe('selfie_capture_incomplete');
    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      status: 'initiated',
    });
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('initiated');
    expect(jobsOf(flow)).toEqual([]);
    expect(eventNames(flow, capture)).toEqual(['verification.created', 'selfie.created']);
  });

  it('answers 409 selfie_capture_required for a capture-bound selfie submitted without one (C40.7)', async () => {
    const { flow } = await readyCapture();

    const response = await submitCapture(api, flow, null);

    expect(response.statusCode).toBe(409);
    expect(problemCode(response)).toBe('selfie_capture_required');
    expect(jobsOf(flow)).toEqual([]);
  });

  it('submits a selfie created before Phase 4 without a capture (C40.7)', async () => {
    const flow = await selfieFlow(api);
    await api.database.client.query(
      'update verifications set selfie_capture_required = false where id = $1',
      [flow.verificationId],
    );
    for (const kind of ['selfie-center', 'selfie-left', 'selfie-right']) {
      expectStatus(await uploadFields(api, flow, { kind, file: { bytes: IMAGES.png } }), 201);
    }

    expect((await submitCapture(api, flow, null)).statusCode).toBe(202);
  });

  it('answers 422 for a government ID submitted with a capture', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    // C151.4 (Workflow 9A): the selfie step is the current one, so the ID attempt is seeded.
    const { id: governmentId } = await seedVerification(api, api.environmentId, flow.inquiryId, {
      type: 'government_id',
      files: ['front', 'back'],
    });
    const response = await submitCapture(api, { ...flow, verificationId: governmentId }, capture);

    expect(response.statusCode).toBe(422);
  });

  it.each([
    ['an unknown member', { ...DEVICE, serial: 'x' }],
    ['a label over 1024 characters', { ...DEVICE, label: 'x'.repeat(1025) }],
    ['a frame rate out of range', { ...DEVICE, settings: { 'frame-rate': 5000 } }],
    [
      'five facing modes',
      { capabilities: { 'facing-modes': ['user', 'user', 'user', 'user', 'user'] } },
    ],
  ])('answers 400 for a device snapshot with %s', async (_label, device) => {
    const { flow, capture } = await readyCapture();

    const response = await submitCapture(api, flow, capture, device as SelfieDeviceSnapshot);

    expect(response.statusCode).toBe(400);
    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      status: 'initiated',
    });
  });
});

describe('a refused capture at submit (C40.4): one 409 for every reason', () => {
  function shapeOf(response: Awaited<ReturnType<typeof submitCapture>>) {
    const { type, title, status, detail, code } = response.json<Record<string, unknown>>();
    return JSON.stringify({
      status: response.statusCode,
      type,
      title,
      problem: status,
      detail,
      code,
    });
  }

  it('answers the same selfie_capture_invalid for a wrong nonce, a foreign, a superseded and an expired capture, and changes nothing', async () => {
    const flow = await selfieFlow(api);
    const superseded = await createCapture(api, flow);
    const current = await createCapture(api, flow);
    await uploadAllPoses(api, flow, current);
    const other = await selfieFlow(api);
    const foreign = await createCapture(api, other);

    const responses = [
      await submitCapture(api, flow, { id: current.id, nonce: 'C'.repeat(22) }),
      await submitCapture(api, flow, foreign),
      await submitCapture(api, flow, superseded),
    ];
    api.clock.advance(SELFIE_CAPTURE_TTL_SECONDS * 1000);
    responses.push(await submitCapture(api, flow, current));

    expect(responses.map((response) => response.statusCode)).toEqual([409, 409, 409, 409]);
    expect(new Set(responses.map(problemCode))).toEqual(new Set(['selfie_capture_invalid']));
    expect(new Set(responses.map(shapeOf)).size).toBe(1);
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('initiated');
    expect(await getSelfieCapture(api.database.db, api.environmentId, current.id)).toMatchObject({
      status: 'initiated',
    });
    expect(jobsOf(flow)).toEqual([]);
  });

  it('accepts a submit one millisecond before the expiry', async () => {
    const { flow, capture } = await readyCapture();
    api.clock.advance(SELFIE_CAPTURE_TTL_SECONDS * 1000 - 1);

    expect((await submitCapture(api, flow, capture)).statusCode).toBe(202);
  });
});

describe('a repeated submit (C40.4)', () => {
  it('answers 202 and enqueues again for the capture that submitted the verification, publishing once', async () => {
    const { flow, capture } = await readyCapture();
    expectStatus(await submitCapture(api, flow, capture), 202);

    const again = await submitCapture(api, flow, capture);

    expect(again.statusCode).toBe(202);
    expect(jobsOf(flow)).toHaveLength(2);
    expect(eventNames(flow, capture).filter((name) => name.endsWith('.submitted'))).toEqual([
      'selfie.submitted',
      'verification.submitted',
    ]);
  });

  it('answers 409 for another capture, a wrong nonce or no capture while submitted', async () => {
    const flow = await selfieFlow(api);
    const superseded = await createCapture(api, flow);
    const capture = await createCapture(api, flow);
    await uploadAllPoses(api, flow, capture);
    expectStatus(await submitCapture(api, flow, capture), 202);

    const other = await submitCapture(api, flow, superseded);
    const wrongNonce = await submitCapture(api, flow, { id: capture.id, nonce: 'D'.repeat(22) });
    const none = await submitCapture(api, flow, null);

    expect([other, wrongNonce].map(problemCode)).toEqual([
      'selfie_capture_invalid',
      'selfie_capture_invalid',
    ]);
    expect(problemCode(none)).toBe('selfie_capture_required');
    expect(jobsOf(flow)).toHaveLength(1);
  });

  it('answers 409 once the verification is no longer submitted', async () => {
    const { flow, capture } = await readyCapture();
    expectStatus(await submitCapture(api, flow, capture), 202);
    await setVerificationStatus(api.database.db, api.environmentId, flow.verificationId, {
      to: 'passed',
    });

    const response = await submitCapture(api, flow, capture);

    expect(response.statusCode).toBe(409);
    expect(jobsOf(flow)).toHaveLength(1);
  });

  it('refuses an upload to the consumed capture', async () => {
    const { flow, capture } = await readyCapture();
    expectStatus(await submitCapture(api, flow, capture), 202);

    expect((await uploadPose(api, flow, capture, 'center')).statusCode).toBe(409);
  });
});
