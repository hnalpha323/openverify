/**
 * C40.3 `POST /api/v1/flow/verifications/:id/files` with the capture fields (Workflow 4A
 * Stage 3, api-flow): `capture-id`, `nonce` and `client-elapsed-ms` are required for the selfie
 * kinds of a verification that needs a capture (C40.7) and refused for every other kind; the
 * kind must be one of the capture's prompts; the capture must be `initiated` and unexpired,
 * re-checked under the verification lock inside the write transaction; `received_at` comes from
 * the server clock in that transaction; a re-upload of a pose replaces it.
 */
import {
  CLIENT_ELAPSED_MS_FIELD,
  fileDocumentSchema,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  SELFIE_CAPTURE_TTL_SECONDS,
} from '@openverify/contracts';
import { getFile, listVerificationFiles, selfieCapturePromptTimings } from '@openverify/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  expectStatus,
  IMAGES,
  PROBLEM_JSON,
  seedVerification,
} from '../../test-support/harness.js';
import {
  createCapture,
  FLOW,
  postCapture,
  problemCode,
  selfieFlow,
  templateWithSelfie,
  uploadFields,
  uploadPose,
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

async function filesOf(flow: SelfieFlow) {
  return listVerificationFiles(api.database.db, api.environmentId, [flow.verificationId]);
}

/** The parts of a problem that must not tell one refused capture from another. */
function problemShape(response: Awaited<ReturnType<typeof uploadPose>>) {
  const { type, title, status, detail, code } = response.json<Record<string, unknown>>();
  return { status: response.statusCode, type, title, problem: status, detail, code };
}

describe('a selfie pose uploaded under its capture (C40.3)', () => {
  it('stores the pose with its capture, the client elapsed time and the server receipt time', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    api.clock.advance(2_400);

    const response = await uploadPose(api, flow, capture, 'center', { elapsedMs: 2_310 });

    const { data } = fileDocumentSchema.parse(expectStatus(response, 201));
    expect(data.attributes.kind).toBe('selfie-center');
    expect(await getFile(api.database.db, api.environmentId, data.id)).toMatchObject({
      selfieCaptureId: capture.id,
      clientElapsedMs: 2_310,
      receivedAt: new Date(start.getTime() + 2_400),
    });
  });

  it('replaces a pose uploaded again; the latest per pose counts', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    const first = expectStatus(
      await uploadPose(api, flow, capture, 'center', { elapsedMs: 900 }),
      201,
    );
    api.clock.advance(1_000);

    const again = expectStatus(
      await uploadPose(api, flow, capture, 'center', { elapsedMs: 1_950 }),
      201,
    );

    expect((await filesOf(flow)).map((file) => file.id)).toEqual([again.data.id]);
    expect(await getFile(api.database.db, api.environmentId, first.data.id)).toBeNull();
    expect(
      await selfieCapturePromptTimings(api.database.db, api.environmentId, capture.id),
    ).toEqual([
      { pose: 'center', clientElapsedMs: 1_950, receivedAt: new Date(start.getTime() + 1_000) },
    ]);
  });

  it('answers 409 selfie_capture_required for a selfie pose without the capture fields, and stores nothing', async () => {
    const flow = await selfieFlow(api);
    await createCapture(api, flow);
    const stored = api.storage.keys().length;

    const response = await uploadFields(api, flow, {
      kind: 'selfie-center',
      file: { bytes: IMAGES.jpeg },
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(problemCode(response)).toBe('selfie_capture_required');
    expect(await filesOf(flow)).toEqual([]);
    expect(api.storage.keys()).toHaveLength(stored);
  });

  it('still takes a pose without a capture on a verification created before Phase 4 (C40.7)', async () => {
    const flow = await selfieFlow(api);
    await api.database.client.query(
      'update verifications set selfie_capture_required = false where id = $1',
      [flow.verificationId],
    );

    const response = await uploadFields(api, flow, {
      kind: 'selfie-center',
      file: { bytes: IMAGES.jpeg },
    });

    const { data } = fileDocumentSchema.parse(expectStatus(response, 201));
    expect(await getFile(api.database.db, api.environmentId, data.id)).toMatchObject({
      selfieCaptureId: null,
      clientElapsedMs: null,
    });
  });

  it('refuses the capture fields on a government ID with 400', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    // C151.4 (Workflow 9A): the selfie step is the current one, so the ID attempt is seeded.
    const { id: governmentId } = await seedVerification(api, api.environmentId, flow.inquiryId, {
      type: 'government_id',
    });

    const response = await uploadFields(
      api,
      { ...flow, verificationId: governmentId },
      {
        kind: 'front',
        [SELFIE_CAPTURE_ID_FIELD]: capture.id,
        [SELFIE_CAPTURE_NONCE_FIELD]: capture.nonce,
        [CLIENT_ELAPSED_MS_FIELD]: '100',
        file: { bytes: IMAGES.jpeg },
      },
    );

    expect(response.statusCode).toBe(400);
  });

  it.each<[string, Record<string, string | null>, boolean]>([
    ['without the nonce', { [SELFIE_CAPTURE_NONCE_FIELD]: null }, false],
    ['without the elapsed time', { [CLIENT_ELAPSED_MS_FIELD]: null }, false],
    ['with a short nonce', { [SELFIE_CAPTURE_NONCE_FIELD]: 'A'.repeat(21) }, false],
    ['with a malformed capture id', { [SELFIE_CAPTURE_ID_FIELD]: 'self_nope' }, false],
    ['with an elapsed time past ten minutes', { [CLIENT_ELAPSED_MS_FIELD]: '600001' }, false],
    ['with a negative elapsed time', { [CLIENT_ELAPSED_MS_FIELD]: '-1' }, false],
    ['with a repeated field', {}, true],
  ])('answers 400 for capture fields %s', async (_label, change, repeated) => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    const fields = Object.entries<string | null>({
      kind: 'selfie-center',
      [SELFIE_CAPTURE_ID_FIELD]: capture.id,
      [SELFIE_CAPTURE_NONCE_FIELD]: capture.nonce,
      [CLIENT_ELAPSED_MS_FIELD]: '1000',
      ...change,
    });
    const form = new FormData();
    for (const [name, value] of fields) {
      if (value !== null) {
        form.append(name, value);
      }
    }
    if (repeated) {
      form.append(SELFIE_CAPTURE_NONCE_FIELD, capture.nonce);
    }
    form.append('file', new Blob([IMAGES.jpeg], { type: 'image/jpeg' }), 'pose.jpg');
    const request = new Request('http://localhost/', { method: 'POST', body: form });

    const response = await api.app.inject({
      method: 'POST',
      url: `${FLOW}/verifications/${flow.verificationId}/files`,
      headers: {
        ...bearer(flow.sessionToken),
        'content-type': request.headers.get('content-type') ?? '',
      },
      payload: Buffer.from(await request.arrayBuffer()),
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(await filesOf(flow)).toEqual([]);
  });

  it('answers 422 for a pose the capture did not prompt', async () => {
    const templateId = await templateWithSelfie(api, (step) => {
      step.poses = ['center'];
      step.liveness = 'passive';
    });
    const flow = await selfieFlow(api, { templateId });
    const capture = await createCapture(api, flow);

    const response = await uploadPose(api, flow, capture, 'left');

    expect(response.statusCode).toBe(422);
    expect(await filesOf(flow)).toEqual([]);
  });
});

describe('a refused capture (C40.3, C40.4): one 409 for every reason', () => {
  it('answers the same selfie_capture_invalid for a wrong nonce, a foreign, a superseded and an expired capture', async () => {
    const flow = await selfieFlow(api);
    const superseded = await createCapture(api, flow);
    const current = await createCapture(api, flow);
    const other = await selfieFlow(api);
    const foreign = await createCapture(api, other);

    const wrongNonce = await uploadPose(api, flow, current, 'center', { nonce: 'B'.repeat(22) });
    const foreignCapture = await uploadPose(api, flow, foreign, 'center');
    const supersededCapture = await uploadPose(api, flow, superseded, 'center');
    api.clock.advance(SELFIE_CAPTURE_TTL_SECONDS * 1000);
    const expired = await uploadPose(api, flow, current, 'center');

    const shapes = [wrongNonce, foreignCapture, supersededCapture, expired].map(problemShape);
    expect(shapes[0]).toMatchObject({ status: 409, code: 'selfie_capture_invalid' });
    expect(new Set(shapes.map((shape) => JSON.stringify(shape))).size).toBe(1);
    expect(await filesOf(flow)).toEqual([]);
    expect(await filesOf(other)).toEqual([]);
  });

  it('accepts an upload one millisecond before the expiry', async () => {
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    api.clock.advance(SELFIE_CAPTURE_TTL_SECONDS * 1000 - 1);

    expect((await uploadPose(api, flow, capture, 'center')).statusCode).toBe(201);
  });

  it('refuses an upload whose capture is superseded while its object is stored, and keeps nothing', async () => {
    // The stale upload: its checks passed before a new capture committed; the insert is refused.
    const flow = await selfieFlow(api);
    const capture = await createCapture(api, flow);
    const keys = api.storage.keys().length;
    const put = api.storage.put.bind(api.storage);
    const spy = vi.spyOn(api.storage, 'put').mockImplementationOnce(async (key, bytes) => {
      expectStatus(await postCapture(api, flow), 201);
      return put(key, bytes);
    });

    try {
      const response = await uploadPose(api, flow, capture, 'center');

      expect(response.statusCode).toBe(409);
      expect(problemCode(response)).toBe('selfie_capture_invalid');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await filesOf(flow)).toEqual([]);
      expect(api.storage.keys()).toHaveLength(keys);
    } finally {
      spy.mockRestore();
    }
  });
});
